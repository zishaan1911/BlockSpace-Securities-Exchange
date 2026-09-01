/**
 * ARCHITECTURE.md §9's Trade Flow: "FE->>API: Get market state;
 * API-->>FE: EGSI + orderbook + forecast." (Orderbook itself isn't
 * exposed here — there's no indexer yet to list resting Order objects;
 * this returns the Market/OracleState config half plus EGSI/forecast.)
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../server.js';

export function registerMarketRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  /**
   * Durable EGSI history, oldest first. Exists so ai/inference/train.py
   * can train on real accumulated readings instead of synthetic data,
   * without the AI service connecting to the database itself —
   * ARCHITECTURE.md §2 makes this gateway the only database client, so
   * history reaches the trainer through here.
   */
  app.get<{ Querystring: { limit?: string; market?: string } }>(
    '/api/v1/history',
    async (request, reply) => {
      if (!deps.db) {
        return reply.status(503).send({
          error: 'no database configured; set GASX_API_DATABASE_URL (see database/README.md)',
        });
      }
      const market = request.query.market || 'EGSI-1H';
      const limit = Number.parseInt(request.query.limit ?? '5000', 10);
      const history = await deps.db.getEgsiHistory(market, Number.isFinite(limit) ? limit : 5000);
      return { market, count: history.length, history };
    },
  );

  app.get('/api/v1/market', async () => {
    // Sui read failures propagate (caught by the server's default error
    // handler) — market state is this endpoint's core purpose, unlike
    // egsi/forecast below, which degrade gracefully instead (see
    // AiClient's doc comments).
    const market = await deps.chainAdapter.getMarketState();
    const [egsi, forecast] = await Promise.all([deps.aiClient.getCurrentEgsi(), deps.aiClient.getForecast()]);

    // Durable history (ARCHITECTURE.md §2: the live values above stay
    // cached in memory; this is the persisted record behind them).
    // Deliberately not awaited into the response path beyond the writes
    // themselves — they are best-effort and never fail the request.
    if (deps.db && egsi) {
      const snapshotId = await deps.db.recordEgsiSnapshot({
        market: egsi.market,
        score: egsi.score,
        blockNumber: egsi.block_number,
        blockTimestamp: egsi.timestamp,
        baseFee: egsi.components.base_fee,
        utilization: egsi.components.utilization,
        mempoolPressure: egsi.components.mempool_pressure,
        feeMomentum: egsi.components.fee_momentum,
        gasVolatility: egsi.components.gas_volatility,
        dexActivity: egsi.components.dex_activity,
        thetanutsIv: egsi.components.thetanuts_iv,
        thetanutsSkew: null,
      });
      if (forecast) {
        await deps.db.recordForecast(
          {
            market: forecast.market,
            expectedEgsi: forecast.expected_egsi,
            confidence: forecast.confidence,
            pTail500: forecast.p_tail_500,
            modelVersion: forecast.model_version,
          },
          snapshotId,
        );
      }
    }

    // Indicative depth and quote from the C++ engine. Explicitly not
    // authoritative: contracts/gasx owns the real book, and there is no
    // indexer to read it from yet. Marked as indicative in the payload.
    let orderbook = null;
    let quote = null;
    if (deps.engine) {
      quote = deps.engine.quoteFromForecast(forecast, 0);
      if (quote) deps.engine.seedIndicativeBook(quote);
      orderbook = { ...deps.engine.getBook(), indicative: true as const };
    }

    return { market, egsi, forecast, orderbook, quote };
  });
}
