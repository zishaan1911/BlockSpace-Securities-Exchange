/**
 * Bridges blockchain/thetanuts's live ETH VolSignal into the Python AI
 * service's EGSI cycle (ai/main.py's POST /cycle, schemas.py's
 * CycleRequest) — closing the gap ai/README.md flagged explicitly:
 * "There's no live process wiring blockchain/thetanuts's TypeScript
 * output into this endpoint yet — that's the API gateway's job once
 * Phase 2 exists." This is that wiring.
 *
 * Deliberately just a read-and-forward: it does not evaluate
 * ARCHITECTURE.md §8's hard risk policy (see riskPolicy.ts's
 * checkHedgeRisk) or settle anything on Thetanuts — this only keeps
 * EGSI's Thetanuts IV component current. Actually requesting a hedge
 * quote (blockchain/thetanuts's createHedgeRequest) and evaluating a
 * candidate against the risk policy is a separate, not-yet-built route;
 * see api/README.md.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../server.js';

export function registerHedgeRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/api/v1/hedge/sync-signal', async () => {
    const signal = await deps.hedgeProvider.getVolSignal('ETH');
    const egsi = await deps.aiClient.runCycle({
      thetanutsAtmIv: signal.atmIv,
      thetanutsSkew25Delta: signal.skew25Delta,
    });
    return { signal, egsi };
  });
}
