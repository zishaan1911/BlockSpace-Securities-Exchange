/**
 * Fastify app factory. Takes dependencies as plain constructor
 * arguments (GatewayDeps) rather than reaching for globals, so tests can
 * inject fakes implementing ChainAdapter/HedgeProvider/AiClient and
 * exercise real route logic (including risk policy checks) via
 * Fastify's `.inject()` without a live network connection anywhere.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { ChainAdapter } from '@gasx/sui-adapter';
import type { HedgeProvider } from '@gasx/thetanuts-adapter';
import type { AiClient } from './aiClient.js';
import { AiServiceError } from './aiClient.js';
import type { RiskPolicyConfig } from './riskPolicy.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerHedgeRoutes } from './routes/hedge.js';
import { registerMarketRoutes } from './routes/market.js';
import { registerOrderRoutes } from './routes/orders.js';

export interface GatewayDeps {
  chainAdapter: ChainAdapter;
  hedgeProvider: HedgeProvider;
  aiClient: AiClient;
  riskPolicy: RiskPolicyConfig;
  /** Defaults to true. Tests pass false to keep output clean. */
  logger?: boolean;
}

export function buildServer(deps: GatewayDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? true });

  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  registerMarketRoutes(app, deps);
  registerOrderRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerHedgeRoutes(app, deps);

  // AiServiceError (POST /cycle failed or was unreachable) maps to 502 —
  // this gateway's fault lies with an upstream dependency, not the
  // caller's request. Everything else falls back to a generic 500
  // rather than leaking internal error details to the caller; the real
  // error is still logged server-side.
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (error instanceof AiServiceError) {
      return reply.status(502).send({ error: error.message });
    }
    return reply.status(500).send({ error: 'internal error' });
  });

  return app;
}
