/**
 * ARCHITECTURE.md §9's Trade Flow: "FE->>API: Get market state;
 * API-->>FE: EGSI + orderbook + forecast." (Orderbook itself isn't
 * exposed here — there's no indexer yet to list resting Order objects;
 * this returns the Market/OracleState config half plus EGSI/forecast.)
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../server.js';

export function registerMarketRoutes(app: FastifyInstance, deps: GatewayDeps): void {
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

    return { market, egsi, forecast };
  });
}
