/**
 * ARCHITECTURE.md §9's Trade Flow: "FE->>API: Prepare order (pre-trade
 * risk checks); API-->>FE: Sui transaction payload." Every response
 * here is a PreparedTransaction (blockchain/sui) for the frontend's
 * wallet to sign — this gateway never signs or broadcasts anything.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../server.js';
import { checkOrderRisk } from '../riskPolicy.js';

interface PrepareOrderBody {
  trader?: unknown;
  marginAccountId?: unknown;
  isBid?: unknown;
  price?: unknown;
  quantity?: unknown;
}

interface ValidatedPrepareOrder {
  trader: string;
  marginAccountId: string;
  isBid: boolean;
  price: number;
  quantity: number;
}

export function validatePrepareOrderBody(body: PrepareOrderBody): ValidatedPrepareOrder | string {
  if (typeof body.trader !== 'string' || !body.trader) return 'trader is required';
  if (typeof body.marginAccountId !== 'string' || !body.marginAccountId) return 'marginAccountId is required';
  if (typeof body.isBid !== 'boolean') return 'isBid must be a boolean';
  if (typeof body.price !== 'number') return 'price must be a number';
  if (typeof body.quantity !== 'number') return 'quantity must be a number';
  return { trader: body.trader, marginAccountId: body.marginAccountId, isBid: body.isBid, price: body.price, quantity: body.quantity };
}

interface PrepareCancelBody {
  trader?: unknown;
  orderId?: unknown;
  marginAccountId?: unknown;
}

interface ValidatedPrepareCancel {
  trader: string;
  orderId: string;
  marginAccountId: string;
}

export function validatePrepareCancelBody(body: PrepareCancelBody): ValidatedPrepareCancel | string {
  if (typeof body.trader !== 'string' || !body.trader) return 'trader is required';
  if (typeof body.orderId !== 'string' || !body.orderId) return 'orderId is required';
  if (typeof body.marginAccountId !== 'string' || !body.marginAccountId) return 'marginAccountId is required';
  return { trader: body.trader, orderId: body.orderId, marginAccountId: body.marginAccountId };
}

export function registerOrderRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post<{ Body: PrepareOrderBody }>('/api/v1/orders/prepare', async (request, reply) => {
    const validated = validatePrepareOrderBody(request.body ?? {});
    if (typeof validated === 'string') {
      return reply.status(400).send({ error: validated });
    }

    const market = await deps.chainAdapter.getMarketState();
    const referencePrice = market.oracle.hasPrice ? market.oracle.price : undefined;

    const riskResult = checkOrderRisk(
      {
        price: validated.price,
        quantity: validated.quantity,
        tickSize: market.tickSize,
        marketPaused: market.paused,
        marketSettled: market.settled,
        referencePrice,
      },
      deps.riskPolicy,
    );
    if (!riskResult.accepted) {
      // Rejections are recorded too: which risk rule stopped an order,
      // and how often, is exactly the kind of thing that is impossible
      // to reconstruct later if it was never written down.
      await deps.db?.recordPreparedOrder({
        trader: validated.trader,
        marginAccount: validated.marginAccountId,
        isBid: validated.isBid,
        price: validated.price,
        quantity: validated.quantity,
        outcome: 'rejected',
        rejectReason: riskResult.reason,
      });
      return reply.status(422).send({ error: riskResult.reason });
    }

    const prepared = await deps.chainAdapter.preparePlaceOrder(validated);
    // 'prepared', not 'executed': the gateway cannot know whether the
    // user's wallet went on to sign this. Only the indexer could tell
    // us that, and it does not exist yet (see database/README.md).
    await deps.db?.recordPreparedOrder({
      trader: validated.trader,
      marginAccount: validated.marginAccountId,
      isBid: validated.isBid,
      price: validated.price,
      quantity: validated.quantity,
      outcome: 'prepared',
      rejectReason: null,
    });
    return prepared;
  });

  app.post<{ Body: PrepareCancelBody }>('/api/v1/orders/prepare-cancel', async (request, reply) => {
    const validated = validatePrepareCancelBody(request.body ?? {});
    if (typeof validated === 'string') {
      return reply.status(400).send({ error: validated });
    }
    return deps.chainAdapter.prepareCancelOrder(validated);
  });
}
