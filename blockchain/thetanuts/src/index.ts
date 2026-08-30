/**
 * Public surface of GASX's Thetanuts adapter. Only GASX-shaped types
 * (types.ts) and the ThetanutsHedgeProvider class are exported \u2014
 * @thetanuts-finance/thetanuts-client's own types never leak out
 * (ARCHITECTURE.md §7).
 */
export type {
  HedgeCandidate,
  HedgeDirection,
  HedgeProvider,
  HedgeRequest,
  HedgeRequestParams,
  HedgeUnderlying,
  VolSignal,
} from './types.js';
export { loadConfigFromEnv, THETANUTS_CHAIN_ID, type ThetanutsAdapterConfig } from './config.js';
export { ThetanutsHedgeProvider } from './hedgeProvider.js';
