import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer, type GatewayDeps } from '../src/server.js';
import type { ExposureConfig } from '../src/exposure.js';
import type { RiskPolicyConfig } from '../src/riskPolicy.js';
import {
  FakeAiClient,
  FakeChainAdapter,
  FakeHedgeProvider,
  makeHedgeCandidate,
  makeMarketState,
} from './fakes.js';

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

/** Enough net-long exposure to breach: 10 * 10 * 500 * 0.5 = 25_000. */
const BREACHING = { netContracts: 10, egsiLevel: 500 };
/** Well under threshold: 1 * 10 * 500 * 0.5 = 2_500. */
const WITHIN = { netContracts: 1, egsiLevel: 500 };

function confidentForecast(confidence = 0.9) {
  return {
    market: 'EGSI-1H',
    expected_egsi: 520,
    confidence,
    p_tail_500: 0.6,
    model_version: 'egsi-v1',
  };
}

beforeEach(() => {
  chainAdapter = new FakeChainAdapter();
  chainAdapter.marketState = makeMarketState({ contractMultiplier: 10 });
  hedgeProvider = new FakeHedgeProvider();
  aiClient = new FakeAiClient();
  aiClient.forecast = confidentForecast();
  const deps: GatewayDeps = { chainAdapter, hedgeProvider, aiClient, riskPolicy, exposureConfig, logger: false };
  app = buildServer(deps);
});

describe('POST /api/v1/hedge/assess', () => {
  it('reports a breaching net-long book with a PUT suggestion', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/assess', payload: BREACHING });
    expect(res.statusCode).toBe(200);
    const { exposure } = res.json();
    expect(exposure.breached).toBe(true);
    expect(exposure.suggestedOptionType).toBe('PUT');
    expect(exposure.ethBetaNotional).toBe(25_000);
  });

  it('reports a within-threshold book as not breached', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/assess', payload: WITHIN });
    expect(res.json().exposure.breached).toBe(false);
  });

  it('returns 400 for a non-integer contract count', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/assess',
      payload: { netContracts: 1.5, egsiLevel: 500 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for a non-positive EGSI level', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/assess',
      payload: { netContracts: 10, egsiLevel: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('has no on-chain side effect (never submits an RFQ)', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/hedge/assess', payload: BREACHING });
    expect(hedgeProvider.lastRequestHedgeQuoteParams).toBeNull();
  });
});

describe('POST /api/v1/hedge/evaluate', () => {
  it('does not submit an RFQ when exposure is within threshold', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: WITHIN });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.exposure.breached).toBe(false);
    expect(body.hedged).toBe(false);
    expect(hedgeProvider.lastRequestHedgeQuoteParams).toBeNull();
  });

  it('runs the full chain and approves a within-limits hedge', async () => {
    hedgeProvider.bestCandidate = makeHedgeCandidate({ pricePerContract: 50 });

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.exposure.breached).toBe(true);
    expect(body.candidate.pricePerContract).toBe(50);
    expect(body.quotedNotional).toBe(50); // 50 * 1 contract
    expect(body.approved).toBe(true);
    // Never executes, no matter what.
    expect(body.hedged).toBe(false);
  });

  it('requests the option type the exposure implies (PUT for net long)', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });
    expect(hedgeProvider.lastRequestHedgeQuoteParams?.optionType).toBe('PUT');
  });

  it('requests a CALL hedge for a breaching net-short book', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/evaluate',
      payload: { netContracts: -10, egsiLevel: 500 },
    });
    expect(hedgeProvider.lastRequestHedgeQuoteParams?.optionType).toBe('CALL');
  });

  it('rejects on low model confidence BEFORE spending gas on an RFQ', async () => {
    aiClient.forecast = confidentForecast(0.5); // below the 0.7 floor

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approved).toBe(false);
    expect(body.reason).toMatch(/MIN_MODEL_CONFIDENCE/);
    // The important part: no RFQ was submitted, so no real gas was spent.
    expect(hedgeProvider.lastRequestHedgeQuoteParams).toBeNull();
  });

  it('fails closed with 503 when no forecast is available', async () => {
    aiClient.forecast = null;

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    expect(res.statusCode).toBe(503);
    expect(hedgeProvider.lastRequestHedgeQuoteParams).toBeNull();
  });

  it('reports not-approved when the quoted premium exceeds MAX_HEDGE_NOTIONAL', async () => {
    hedgeProvider.bestCandidate = makeHedgeCandidate({ pricePerContract: 5000 }); // over the 1000 cap

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    const body = res.json();
    expect(body.approved).toBe(false);
    expect(body.reason).toMatch(/MAX_HEDGE_NOTIONAL/);
    expect(body.hedged).toBe(false);
  });

  it('handles an RFQ with no market maker offers yet', async () => {
    hedgeProvider.bestCandidate = null;

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidate).toBeUndefined();
    expect(body.approved).toBe(false);
    expect(body.reason).toMatch(/no market maker offers/);
    // The RFQ itself was still submitted, so the caller gets its id back
    // to poll with.
    expect(body.request.quotationId).toBe('42');
  });

  it('returns 500 when RFQ submission itself fails', async () => {
    hedgeProvider.requestHedgeQuoteError = new Error('no hedge wallet configured');
    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /api/v1/hedge/candidate', () => {
  it('returns the best candidate for an existing RFQ', async () => {
    hedgeProvider.bestCandidate = makeHedgeCandidate({ pricePerContract: 42 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/candidate',
      payload: { quotationId: '42', numContracts: 1, direction: 'BUY' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().candidate.pricePerContract).toBe(42);
  });

  it('returns null when no offers have arrived', async () => {
    hedgeProvider.bestCandidate = null;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/candidate',
      payload: { quotationId: '42', numContracts: 1, direction: 'BUY' },
    });
    expect(res.json().candidate).toBeNull();
  });

  it('returns 400 for a missing quotationId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/candidate',
      payload: { numContracts: 1, direction: 'BUY' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an invalid direction', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/candidate',
      payload: { quotationId: '42', numContracts: 1, direction: 'SIDEWAYS' },
    });
    expect(res.statusCode).toBe(400);
  });
});
