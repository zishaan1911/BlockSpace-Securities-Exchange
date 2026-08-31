/**
 * Dev-market mode: a synthetic, clearly-marked EGSI-1H market served
 * when the Move contracts are not yet deployed (config.devMarket).
 *
 * It exists so the whole stack — AI service, API gateway, frontend —
 * runs end-to-end before anyone has published contracts/gasx to Sui.
 * Everything that reads the market (GET /api/v1/market, hedge exposure
 * math) works; everything that would build a transaction to sign
 * (prepare*) refuses, because there is no on-chain market to sign for.
 *
 * The synthetic market mirrors the real on-chain configuration:
 * 1-hour expiry rolling to the next whole hour, multiplier 1, tick 1,
 * 50% initial margin, unpaused, unsettled. The oracle has never
 * published (the AI service's oracle publishing is disabled without a
 * deployed OracleState), which the frontend displays honestly as
 * "never published" — the live EGSI value itself still comes from the
 * AI service through the gateway, not from this synthetic market.
 */
import type { SuiAdapterConfig } from './config.js';
import type { MarketState } from './types.js';

export function fetchDevMarketState(config: SuiAdapterConfig): MarketState {
  const now = Date.now();
  const hourMs = 3_600_000;
  const expiryMs = Math.floor(now / hourMs) * hourMs + hourMs;

  return {
    marketId: 'dev-market',
    underlying: 'Ethereum Gas Stress Index',
    expiryMs,
    contractMultiplier: 1,
    tickSize: 1,
    marginRatioBps: 5000,
    paused: false,
    settled: false,
    settlementPrice: null,
    oracle: {
      oracleId: 'dev-oracle',
      price: 0,
      hasPrice: false,
      lastUpdateMs: 0,
      maxStalenessMs: hourMs,
      maxPrice: 1000,
      isFreshApprox: false,
    },
    devMode: true,
    network: config.network,
  };
}
