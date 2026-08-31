/**
 * Environment-driven configuration for the API gateway. Copy .env.example
 * to .env and fill in real values.
 */
import { loadConfigFromEnv as loadSuiConfig, type SuiAdapterConfig } from '@gasx/sui-adapter';
import { loadConfigFromEnv as loadThetanutsConfig, type ThetanutsAdapterConfig } from '@gasx/thetanuts-adapter';
import type { RiskPolicyConfig } from './riskPolicy.js';

export interface GatewayConfig {
  port: number;
  /** Base URL of the Python AI service (ai/main.py's FastAPI app), e.g.
   * http://localhost:8000. */
  aiServiceUrl: string;
  sui: SuiAdapterConfig;
  thetanuts: ThetanutsAdapterConfig;
  riskPolicy: RiskPolicyConfig;
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

/** Loads the gateway's own settings plus both chain adapters' configs
 * (each validates its own required variables — see their .env.example
 * files) from GASX_API_-prefixed (gateway) and adapter-specific
 * environment variables. */
export function loadGatewayConfig(): GatewayConfig {
  return {
    port: readEnvInt('GASX_API_PORT', 3000),
    aiServiceUrl: readEnv('GASX_API_AI_SERVICE_URL') || 'http://localhost:8000',
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
  };
}
