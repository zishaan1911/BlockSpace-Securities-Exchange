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
    return { market, egsi, forecast };
  });
}
