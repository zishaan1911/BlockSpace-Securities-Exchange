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
  hedgeExpiryHours: 24,
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

  it('accepts a fractional position, since this is exposure math not an order', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/assess',
      payload: { netContracts: 0.5, egsiLevel: 500 },
    });
    expect(res.statusCode).toBe(200);
    // 0.5 * 10 multiplier * 500 * 0.5 beta = 1250
    expect(res.json().exposure.ethBetaNotional).toBeCloseTo(1250, 6);
  });

  it('still rejects a non-numeric position', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/assess',
      payload: { netContracts: 'lots', egsiLevel: 500 },
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

  it('places the hedge expiry well after the offer deadline', async () => {
    // Regression guard. The expiry was originally taken from the vol
    // signal, which reports the nearest expiry it could measure ATM IV
    // from -- frequently sooner than the RFQ's own offer deadline.
    // Thetanuts rejects that outright: "Option expiry must be after
    // offer deadline."
    hedgeProvider.volSignal = { ...hedgeProvider.volSignal, expiry: Math.floor(Date.now() / 1000) + 60 };

    await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    const params = hedgeProvider.lastRequestHedgeQuoteParams!;
    const deadlineAt = Math.floor(Date.now() / 1000) + exposureConfig.offerDeadlineMinutes * 60;
    expect(params.expiry).toBeGreaterThan(deadlineAt);
    // Not the vol signal's near expiry, which is what caused the bug.
    expect(params.expiry).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3600);
  });

  it('floors the tenor clear of the deadline even when configured short', async () => {
    const deps: GatewayDeps = {
      chainAdapter, hedgeProvider, aiClient, riskPolicy, logger: false,
      exposureConfig: { ...exposureConfig, hedgeExpiryHours: 0, offerDeadlineMinutes: 60 },
    };
    const shortApp = buildServer(deps);

    await shortApp.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    const params = hedgeProvider.lastRequestHedgeQuoteParams!;
    // Twice the deadline, so a long deadline plus a short tenor still
    // leaves headroom rather than producing an invalid request.
    expect(params.expiry).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60 * 60);
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

  it('explains what to fix when RFQ submission fails, rather than a bare 500', async () => {
    hedgeProvider.requestHedgeQuoteError = new Error('no hedge wallet configured');

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    // 503, not 500: the fault is missing configuration, not a bug.
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toMatch(/no hedge wallet configured/);
    // Names the thing to set, so the UI is actionable on its own.
    expect(body.error).toMatch(/GASX_THETANUTS_HEDGE_WALLET_PRIVATE_KEY/);
    // The exposure work already done is still returned.
    expect(body.exposure.breached).toBe(true);
  });

  it('explains a missing Thetanuts vol signal rather than failing opaquely', async () => {
    hedgeProvider.getVolSignalError = new Error('no usable ETH options quotes with greeks');

    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/Thetanuts ETH options data/);
    // No RFQ was submitted, so no gas was spent chasing a hedge that
    // could not be priced.
    expect(hedgeProvider.lastRequestHedgeQuoteParams).toBeNull();
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

describe('POST /api/v1/hedge/execute', () => {
  it('refuses without confirm: true, before touching anything', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/hedge/execute', payload: BREACHING });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/confirm: true/);
    expect(hedgeProvider.lastRequestHedgeQuoteParams).toBeNull();
    expect(hedgeProvider.lastExecuteHedgeCall).toBeNull();
  });

  it('refuses confirm: false the same as confirm missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { ...BREACHING, confirm: false },
    });
    expect(res.statusCode).toBe(400);
    expect(hedgeProvider.lastExecuteHedgeCall).toBeNull();
  });

  it('does not execute when exposure is within threshold, even with confirm: true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { ...WITHIN, confirm: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().executed).toBe(false);
    expect(hedgeProvider.lastExecuteHedgeCall).toBeNull();
  });

  it('does not execute when confidence is below the floor, even with confirm: true', async () => {
    aiClient.forecast = { ...aiClient.forecast!, confidence: 0.5 };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { ...BREACHING, confirm: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approved).toBe(false);
    expect(body.executed).toBe(false);
    // Confidence rejects before any RFQ, same as /evaluate.
    expect(hedgeProvider.lastRequestHedgeQuoteParams).toBeNull();
    expect(hedgeProvider.lastExecuteHedgeCall).toBeNull();
  });

  it('does not execute when the quoted premium exceeds MAX_HEDGE_NOTIONAL', async () => {
    hedgeProvider.bestCandidate = makeHedgeCandidate({ pricePerContract: 5000 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { ...BREACHING, confirm: true },
    });

    const body = res.json();
    expect(body.approved).toBe(false);
    expect(body.executed).toBe(false);
    // The RFQ WAS submitted (notional is only knowable after a quote),
    // but settlement must never have been attempted on a rejected quote.
    expect(hedgeProvider.lastExecuteHedgeCall).toBeNull();
  });

  it('does not execute when no market maker has responded to the RFQ', async () => {
    hedgeProvider.bestCandidate = null;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { ...BREACHING, confirm: true },
    });

    expect(res.json().executed).toBe(false);
    expect(hedgeProvider.lastExecuteHedgeCall).toBeNull();
  });

  it('executes and returns a transaction hash for a genuinely approved hedge', async () => {
    hedgeProvider.bestCandidate = makeHedgeCandidate({ pricePerContract: 50 });
    hedgeProvider.executeHedgeResult = { transactionHash: '0xrealtx123' };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { ...BREACHING, confirm: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.approved).toBe(true);
    expect(body.executed).toBe(true);
    expect(body.transactionHash).toBe('0xrealtx123');

    // Confirms the SAME request/candidate this run produced was what
    // got settled -- not a stale or client-supplied pair.
    expect(hedgeProvider.lastExecuteHedgeCall).not.toBeNull();
    expect(hedgeProvider.lastExecuteHedgeCall!.candidate.pricePerContract).toBe(50);
    expect(hedgeProvider.lastExecuteHedgeCall!.request.quotationId).toBe('42');
  });

  it('submits a FRESH RFQ rather than reusing any previous one', async () => {
    // Call evaluate first (as a UI naturally would, to preview the
    // decision), THEN execute. Execute must not reuse evaluate's RFQ --
    // it must run its own fresh chain end to end.
    await app.inject({ method: 'POST', url: '/api/v1/hedge/evaluate', payload: BREACHING });
    const evaluateCallCount = hedgeProvider.lastRequestHedgeQuoteParams ? 1 : 0;
    expect(evaluateCallCount).toBe(1);

    let requestQuoteCalls = 0;
    const originalRequestQuote = hedgeProvider.requestHedgeQuote.bind(hedgeProvider);
    hedgeProvider.requestHedgeQuote = async (params) => {
      requestQuoteCalls++;
      return originalRequestQuote(params);
    };

    await app.inject({ method: 'POST', url: '/api/v1/hedge/execute', payload: { ...BREACHING, confirm: true } });

    expect(requestQuoteCalls).toBe(1);
  });

  it('reports a clear 502, recording approved-but-not-executed, when settlement itself fails', async () => {
    hedgeProvider.bestCandidate = makeHedgeCandidate({ pricePerContract: 50 });
    hedgeProvider.executeHedgeError = new Error('offer deadline lapsed');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { ...BREACHING, confirm: true },
    });

    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.executed).toBe(false);
    expect(body.error).toMatch(/approved, but settlement failed: offer deadline lapsed/);
  });

  it('rejects a non-numeric netContracts before ever reaching the pipeline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/hedge/execute',
      payload: { netContracts: 'lots', egsiLevel: 500, confirm: true },
    });
    expect(res.statusCode).toBe(400);
    expect(hedgeProvider.lastExecuteHedgeCall).toBeNull();
  });
});
