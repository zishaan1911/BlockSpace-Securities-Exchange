/**
 * Environment-driven configuration for the API gateway. Copy .env.example
 * to .env and fill in real values.
 */
import { loadConfigFromEnv as loadSuiConfig, type SuiAdapterConfig } from '@gasx/sui-adapter';
import { loadConfigFromEnv as loadThetanutsConfig, type ThetanutsAdapterConfig } from '@gasx/thetanuts-adapter';
import type { ExposureConfig } from './exposure.js';
import type { RiskPolicyConfig } from './riskPolicy.js';

export interface GatewayConfig {
  port: number;
  /** Base URL of the Python AI service (ai/main.py's FastAPI app), e.g.
   * http://localhost:8000. */
  aiServiceUrl: string;
  /** MySQL connection URL. Undefined disables persistence entirely —
   * the gateway then runs without durable state (see src/db.ts). */
  databaseUrl: string | undefined;
  sui: SuiAdapterConfig;
  thetanuts: ThetanutsAdapterConfig;
  riskPolicy: RiskPolicyConfig;
  exposureConfig: ExposureConfig;
}

function readEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[name] : undefined;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be an integer, got '${raw}'`);
  }
  return n;
}

function readEnvFloat(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number, got '${raw}'`);
  }
  return n;
}

/** Loads the gateway's own settings plus both chain adapters' configs
 * (each validates its own required variables — see their .env.example
 * files) from GASX_API_-prefixed (gateway) and adapter-specific
 * environment variables. */
export function loadGatewayConfig(): GatewayConfig {
  return {
    port: readEnvInt('GASX_API_PORT', 3000),
    aiServiceUrl: readEnv('GASX_API_AI_SERVICE_URL') || 'http://localhost:8000',
    databaseUrl: readEnv('GASX_API_DATABASE_URL') || undefined,
    sui: loadSuiConfig(),
    thetanuts: loadThetanutsConfig(),
    riskPolicy: {
      // ARCHITECTURE.md §8's defaults — "small fixed cap" left concrete
      // here rather than symbolic; override via env for a different
      // demo budget.
      maxOrderContracts: readEnvInt('GASX_API_MAX_ORDER_CONTRACTS', 100),
      maxPositionContracts: readEnvInt('GASX_API_MAX_POSITION_CONTRACTS', 500),
      maxSlippageBps: readEnvInt('GASX_API_MAX_SLIPPAGE_BPS', 100), // 1%
      minModelConfidence: readEnvInt('GASX_API_MIN_MODEL_CONFIDENCE_PCT', 70) / 100,
      maxHedgeNotional: readEnvInt('GASX_API_MAX_HEDGE_NOTIONAL', 1000),
    },
    exposureConfig: {
      // See exposure.ts's header: this beta is a configured assumption,
      // not a measured correlation — there is no EGSI/ETH price history
      // to regress against yet. 0.5 is a deliberately middling
      // placeholder, not a derived figure.
      ethBeta: readEnvFloat('GASX_API_ETH_BETA', 0.5),
      hedgeThresholdNotional: readEnvInt('GASX_API_HEDGE_THRESHOLD_NOTIONAL', 5000),
      hedgeContracts: readEnvInt('GASX_API_HEDGE_CONTRACTS', 1),
      offerDeadlineMinutes: readEnvInt('GASX_API_HEDGE_OFFER_DEADLINE_MINUTES', 10),
    },
  };
}
