/**
 * Prepares (never signs) margin account transactions — the onboarding
 * half of the trade flow a trader needs before place_order is even
 * callable (contracts/gasx/sources/margin.move requires an existing
 * MarginAccount<C>).
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../server.js';

interface PrepareOpenBody {
  trader?: unknown;
}

interface PrepareDepositBody {
  trader?: unknown;
  marginAccountId?: unknown;
  coinObjectId?: unknown;
}

export function registerAccountRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post<{ Body: PrepareOpenBody }>('/api/v1/account/prepare-open', async (request, reply) => {
    const trader = request.body?.trader;
    if (typeof trader !== 'string' || !trader) {
      return reply.status(400).send({ error: 'trader is required' });
    }
    return deps.chainAdapter.prepareOpenAccount({ trader });
  });

  app.post<{ Body: PrepareDepositBody }>('/api/v1/account/prepare-deposit', async (request, reply) => {
    const { trader, marginAccountId, coinObjectId } = request.body ?? {};
    if (typeof trader !== 'string' || !trader) {
      return reply.status(400).send({ error: 'trader is required' });
    }
    if (typeof marginAccountId !== 'string' || !marginAccountId) {
      return reply.status(400).send({ error: 'marginAccountId is required' });
    }
    if (typeof coinObjectId !== 'string' || !coinObjectId) {
      return reply.status(400).send({ error: 'coinObjectId is required' });
    }
    return deps.chainAdapter.prepareDeposit({ trader, marginAccountId, coinObjectId });
  });
}
