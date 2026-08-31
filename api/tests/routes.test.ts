import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer, type GatewayDeps } from '../src/server.js';
import type { ExposureConfig } from '../src/exposure.js';
import type { RiskPolicyConfig } from '../src/riskPolicy.js';
import { FakeAiClient, FakeChainAdapter, FakeHedgeProvider, makeEgsiSnapshot, makeMarketState } from './fakes.js';

const riskPolicy: RiskPolicyConfig = {
  maxOrderContracts: 100,
  maxPositionContracts: 500,
  maxSlippageBps: 100,
  minModelConfidence: 0.7,
  maxHedgeNotional: 1000,
};

const exposureConfig: ExposureConfig = {
  ethBeta: 0.5,
  hedgeThresholdNotional: 5000,
  hedgeContracts: 1,
  offerDeadlineMinutes: 10,
};

let app: FastifyInstance;
let chainAdapter: FakeChainAdapter;
let hedgeProvider: FakeHedgeProvider;
let aiClient: FakeAiClient;

beforeEach(() => {
  chainAdapter = new FakeChainAdapter();
  hedgeProvider = new FakeHedgeProvider();
  aiClient = new FakeAiClient();
  const deps: GatewayDeps = { chainAdapter, hedgeProvider, aiClient, riskPolicy, exposureConfig, logger: false };
  app = buildServer(deps);
});

describe('GET /api/v1/health', () => {
  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/v1/market', () => {
  it('combines Sui market state with EGSI and forecast', async () => {
    chainAdapter.marketState = makeMarketState({ underlying: 'EGSI-1H' });
    aiClient.currentEgsi = makeEgsiSnapshot({ score: 500 });

    const res = await app.inject({ method: 'GET', url: '/api/v1/market' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.market.underlying).toBe('EGSI-1H');
    expect(body.egsi.score).toBe(500);
  });

  it('still returns market state when the AI service is unreachable (egsi/forecast null)', async () => {
    aiClient.currentEgsi = null;
    aiClient.forecast = null;

    const res = await app.inject({ method: 'GET', url: '/api/v1/market' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.market).toBeDefined();
    expect(body.egsi).toBeNull();
    expect(body.forecast).toBeNull();
  });

  it('returns 500 when the Sui read itself fails', async () => {
    chainAdapter.getMarketStateError = new Error('rpc unreachable');

    const res = await app.inject({ method: 'GET', url: '/api/v1/market' });

    expect(res.statusCode).toBe(500);
  });
});

describe('POST /api/v1/orders/prepare', () => {
  const validBody = {
    trader: '0xtrader',
    marginAccountId: '0xmargin',
    isBid: true,
    price: 500,
    quantity: 10,
  };

  it('accepts a valid order and returns a prepared transaction', async () => {
    chainAdapter.marketState = makeMarketState({
      tickSize: 10,
      oracle: { oracleId: '0xoracle', price: 500, hasPrice: true, lastUpdateMs: 0, maxStalenessMs: 0, maxPrice: 1000, isFreshApprox: true },
    });

    const res = await app.inject({ method: 'POST', url: '/api/v1/orders/prepare', payload: validBody });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transactionJson).toBeDefined();
    expect(chainAdapter.lastPreparePlaceOrderParams).toEqual(validBody);
  });

  it('returns 400 when a required field is missing', async () => {
    const { trader: _drop, ...withoutTrader } = validBody;
    const res = await app.inject({ method: 'POST', url: '/api/v1/orders/prepare', payload: withoutTrader });
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 and does not call prepare when risk policy rejects the order', async () => {
    chainAdapter.marketState = makeMarketState({ paused: true });

    const res = await app.inject({ method: 'POST', url: '/api/v1/orders/prepare', payload: validBody });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/paused/);
    expect(chainAdapter.lastPreparePlaceOrderParams).toBeNull();
  });

  it('returns 422 when quantity exceeds MAX_ORDER_CONTRACTS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/prepare',
      payload: { ...validBody, quantity: 1000 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('passes the oracle price as the slippage reference price', async () => {
    chainAdapter.marketState = makeMarketState({
      tickSize: 1,
      oracle: { oracleId: '0xoracle', price: 500, hasPrice: true, lastUpdateMs: 0, maxStalenessMs: 0, maxPrice: 1000, isFreshApprox: true },
    });

    // 600 vs reference 500 is 20% away — well outside a 1% MAX_SLIPPAGE.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/prepare',
      payload: { ...validBody, price: 600 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/MAX_SLIPPAGE/);
  });
});

describe('POST /api/v1/orders/prepare-cancel', () => {
  it('accepts a valid cancel request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/prepare-cancel',
      payload: { trader: '0xtrader', orderId: '0xorder', marginAccountId: '0xmargin' },
    });
    expect(res.statusCode).toBe(200);
    expect(chainAdapter.lastPrepareCancelOrderParams).toEqual({
      trader: '0xtrader',
      orderId: '0xorder',
      marginAccountId: '0xmargin',
    });
  });

  it('returns 400 when orderId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/prepare-cancel',
      payload: { trader: '0xtrader', marginAccountId: '0xmargin' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/account/prepare-open', () => {
  it('accepts a valid request', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/account/prepare-open', payload: { trader: '0xtrader' } });
    expect(res.statusCode).toBe(200);
    expect(chainAdapter.lastPrepareOpenAccountParams).toEqual({ trader: '0xtrader' });
  });

  it('returns 400 when trader is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/account/prepare-open', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/account/prepare-deposit', () => {
  it('accepts a valid request', async () => {
    const payload = { trader: '0xtrader', marginAccountId: '0xmargin', coinObjectId: '0xcoin' };
    const res = await app.inject({ method: 'POST', url: '/api/v1/account/prepare-deposit', payload });
    expect(res.statusCode).toBe(200);
    expect(chainAdapter.lastPrepareDepositParams).toEqual(payload);
  });

  it('returns 400 when coinObjectId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/account/prepare-deposit',
      payload: { trader: '0xtrader', marginAccountId: '0xmargin' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/hedge/sync-signal', () => {
  it('forwards the live Thetanuts signal into the AI cycle and returns both', async () => {
    hedgeProvider.volSignal = { ...hedgeProvider.volSignal, atmIv: 0.72, skew25Delta: 0.08 };
    aiClient.runCycleResult = makeEgsiSnapshot({ score: 600 });

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/sync-signal' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.signal.atmIv).toBe(0.72);
    expect(body.egsi.score).toBe(600);
    expect(aiClient.lastRunCycleInput).toEqual({ thetanutsAtmIv: 0.72, thetanutsSkew25Delta: 0.08 });
  });

  it('returns 500 when fetching the Thetanuts signal fails', async () => {
    hedgeProvider.getVolSignalError = new Error('no live quotes');
    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/sync-signal' });
    expect(res.statusCode).toBe(500);
  });

  it('returns 502 when the AI service cycle call fails', async () => {
    const { AiServiceError } = await import('../src/aiClient.js');
    aiClient.runCycleError = new AiServiceError('AI service unreachable');
    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/sync-signal' });
    expect(res.statusCode).toBe(502);
  });
});
