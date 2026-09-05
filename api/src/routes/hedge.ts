/**
 * ARCHITECTURE.md §10's Hedge Flow, wired end-to-end, including
 * execution.
 *
 * Five routes:
 *
 *   POST /api/v1/hedge/sync-signal   pulls MM pricing/options data and
 *                                    forwards ETH IV/skew into the AI
 *                                    service's EGSI cycle
 *   POST /api/v1/hedge/assess        computes ETH-beta exposure and
 *                                    reports whether it breached the
 *                                    threshold (§10 step 1)
 *   POST /api/v1/hedge/evaluate      the full chain: assess exposure ->
 *                                    pull a live vol signal -> request an
 *                                    RFQ -> collect the best candidate ->
 *                                    run it through §8's hard risk policy
 *                                    -> report approve/reject. Stops
 *                                    before execution.
 *   POST /api/v1/hedge/execute       re-runs the SAME chain from
 *                                    scratch and, only if that fresh run
 *                                    approves, settles the trade on
 *                                    Base mainnet. Real, non-reversible
 *                                    money. See its own comment below.
 *   POST /api/v1/hedge/candidate     re-poll an existing RFQ for offers
 *
 * /evaluate and /execute share one implementation (runHedgeEvaluation
 * below) rather than two hand-written copies of the same risk-gating
 * logic, specifically because /execute exists: ARCHITECTURE.md §8's
 * guarantee that hard limits cannot be bypassed has to hold at the
 * moment money actually moves, and the only way to be confident of
 * that is for /execute to run the IDENTICAL chain /evaluate does, not
 * a second version that could quietly drift out of sync with it.
 *
 * /execute deliberately never trusts a client-supplied "this was
 * already approved" flag, a previously-returned quotationId, or a
 * previously-returned candidate. It always re-runs the full chain --
 * fresh exposure, fresh forecast, a BRAND NEW RFQ, a fresh risk check
 * -- because an earlier approval says nothing about whether conditions
 * still hold: the market may have moved, a previous RFQ's offer
 * deadline may have lapsed, or risk policy config may have changed
 * since. Accepting a stale approval as authorization would be exactly
 * the kind of bypass §8 exists to prevent.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../server.js';
import { assessExposure } from '../exposure.js';
import { checkHedgeConfidence, checkHedgeRisk } from '../riskPolicy.js';
import type { HedgeCandidate, HedgeRequest } from '@gasx/thetanuts-adapter';

interface ExposureBody {
  netContracts?: unknown;
  egsiLevel?: unknown;
}

interface ValidatedExposure {
  netContracts: number;
  egsiLevel: number;
}

/** Validates the caller-supplied position/level inputs shared by
 * /assess, /evaluate and /execute. Exported for direct unit testing. */
export function validateExposureBody(body: ExposureBody): ValidatedExposure | string {
  if (typeof body.netContracts !== 'number' || !Number.isFinite(body.netContracts)) {
    return 'netContracts must be a finite number (signed: positive = net long, negative = net short)';
  }
  // Fractional is allowed. This is an input to exposure arithmetic, not
  // an on-chain order quantity -- the integer constraint belongs to the
  // Move contract's u64 `quantity`, and applying it here just blocked
  // someone from asking "what if I were 0.5 long?".
  if (typeof body.egsiLevel !== 'number' || !Number.isFinite(body.egsiLevel) || body.egsiLevel <= 0) {
    return 'egsiLevel must be a positive number';
  }
  return { netContracts: body.netContracts, egsiLevel: body.egsiLevel };
}

/** Shared shape for the audit row, so every exit path from /evaluate
 * records the same fields rather than each building its own. */
function auditRow(
  base: { netContracts: number; egsiLevel: number },
  exposure: ReturnType<typeof assessExposure>,
) {
  return {
    netContracts: base.netContracts,
    egsiLevel: base.egsiLevel,
    egsiNotional: exposure.egsiNotional,
    ethBetaNotional: exposure.ethBetaNotional,
    breached: exposure.breached,
    suggestedOptionType: exposure.suggestedOptionType,
    modelConfidence: null as number | null,
    quotationId: null as string | null,
    rfqTxHash: null as string | null,
    offeror: null as string | null,
    pricePerContract: null as number | null,
    quotedNotional: null as number | null,
    approved: null as boolean | null,
    reason: null as string | null,
    // Every exit path from /evaluate builds its audit row from this
    // helper and none of them execute anything -- only /execute's own
    // success path (built separately, not through this helper) ever
    // records executed: true.
    executed: false,
  };
}

interface EvaluationResult {
  status: number;
  body: Record<string, unknown>;
  approved: boolean;
  hedgeRequest?: HedgeRequest;
  candidate?: HedgeCandidate;
}

/**
 * Runs the entire §10 evaluation chain and returns a plain
 * {status, body} pair for the route handler to send, plus whatever
 * intermediate values a caller might need beyond the HTTP body (the
 * raw hedgeRequest/candidate), so /execute can act on the SAME
 * approved candidate this run produced rather than re-deriving them
 * from an already-serialised response body.
 */
async function runHedgeEvaluation(
  deps: GatewayDeps,
  validated: ValidatedExposure,
): Promise<EvaluationResult> {
  const market = await deps.chainAdapter.getMarketState();
  const exposure = assessExposure(
    {
      netContracts: validated.netContracts,
      contractMultiplier: market.contractMultiplier,
      egsiLevel: validated.egsiLevel,
    },
    deps.exposureConfig,
  );

  if (!exposure.breached || !exposure.suggestedOptionType) {
    const reason = 'ETH-beta exposure is within threshold; no hedge warranted';
    await deps.db?.recordHedgeEvaluation({ ...auditRow(validated, exposure), reason });
    return { status: 200, body: { exposure, hedged: false, reason }, approved: false };
  }

  // §8's MIN_MODEL_CONFIDENCE gates the AI-driven hedge path, so the
  // forecast is needed before committing to an RFQ (which costs gas).
  // A missing forecast fails closed: no confidence reading means the
  // confidence floor cannot be shown to be satisfied.
  const forecast = await deps.aiClient.getForecast();
  if (!forecast) {
    return {
      status: 503,
      body: {
        exposure,
        hedged: false,
        error: 'no AI forecast available; cannot evaluate MIN_MODEL_CONFIDENCE, so no hedge may proceed',
      },
      approved: false,
    };
  }

  // Check confidence BEFORE createHedgeRequest -- a hedge that would be
  // rejected on confidence anyway should not first spend real gas
  // submitting an RFQ to Base mainnet. Only the confidence floor is
  // checkable at this point: MAX_HEDGE_NOTIONAL caps the premium
  // actually spent, which isn't known until a market maker quotes. See
  // checkHedgeConfidence's doc comment.
  const preCheck = checkHedgeConfidence(forecast.confidence, deps.riskPolicy);
  if (!preCheck.accepted) {
    await deps.db?.recordHedgeEvaluation({
      ...auditRow(validated, exposure),
      modelConfidence: forecast.confidence,
      approved: false,
      reason: preCheck.reason,
    });
    return {
      status: 200,
      body: {
        exposure,
        forecast,
        hedged: false,
        approved: false,
        reason: preCheck.reason,
        note: 'rejected before any RFQ was submitted, so no gas was spent',
      },
      approved: false,
    };
  }

  // These two calls are where a hedge realistically fails, and the
  // reasons are operational rather than programming errors: Thetanuts
  // may have no live ETH quotes carrying greeks, or no hedge wallet is
  // configured so no RFQ can be signed. Wrapping them turns an opaque
  // 500 into something that says what to fix.
  let signal;
  try {
    signal = await deps.hedgeProvider.getVolSignal('ETH');
  } catch (err) {
    return {
      status: 503,
      body: {
        exposure,
        forecast,
        hedged: false,
        error: `no usable Thetanuts ETH options data: ${(err as Error).message}`,
      },
      approved: false,
    };
  }

  // Floor the tenor at twice the offer deadline so there is always
  // real headroom, even if someone configures a long deadline and a
  // short expiry.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const deadlineSeconds = deps.exposureConfig.offerDeadlineMinutes * 60;
  const hedgeExpiry =
    nowSeconds + Math.max(deps.exposureConfig.hedgeExpiryHours * 3600, deadlineSeconds * 2);

  let hedgeRequest;
  try {
    hedgeRequest = await deps.hedgeProvider.requestHedgeQuote({
      underlying: 'ETH',
      optionType: exposure.suggestedOptionType,
      // At-the-money: the strike closest to spot, rounded to a whole
      // dollar. A more sophisticated hedge would pick a strike from the
      // delta the exposure actually implies; ATM is the simple,
      // defensible default for a first implementation.
      strike: Math.round(signal.underlyingPrice),
      // NOT signal.expiry. That is the nearest expiry the vol signal
      // could measure ATM IV from, which is frequently sooner than the
      // RFQ's own offer deadline -- and Thetanuts rejects an option
      // that expires before market makers have finished quoting it
      // ("Option expiry must be after offer deadline"). The hedge's
      // tenor is its own decision, floored well clear of the deadline.
      expiry: hedgeExpiry,
      numContracts: deps.exposureConfig.hedgeContracts,
      direction: 'BUY',
      offerDeadlineMinutes: deps.exposureConfig.offerDeadlineMinutes,
    });
  } catch (err) {
    return {
      status: 503,
      body: {
        exposure,
        forecast,
        hedged: false,
        // Only mention the wallet when the failure is actually about a
        // signer. Appending it unconditionally sent the reader chasing
        // configuration that was already correct.
        error:
          `could not submit the RFQ: ${(err as Error).message}` +
          (/signer|private key|wallet/i.test((err as Error).message)
            ? '. Set GASX_THETANUTS_HEDGE_WALLET_PRIVATE_KEY and fund that wallet with ETH for gas on Base mainnet.'
            : ''),
      },
      approved: false,
    };
  }

  const candidate = await deps.hedgeProvider.getBestCandidate(hedgeRequest);
  if (!candidate) {
    await deps.db?.recordHedgeEvaluation({
      ...auditRow(validated, exposure),
      modelConfidence: forecast.confidence,
      quotationId: hedgeRequest.quotationId,
      rfqTxHash: hedgeRequest.transactionHash,
      reason: 'no market maker offers received',
    });
    return {
      status: 200,
      body: {
        exposure,
        forecast,
        request: hedgeRequest,
        hedged: false,
        approved: false,
        reason: 'no market maker offers received for this RFQ yet — poll /api/v1/hedge/candidate to re-check',
      },
      approved: false,
      hedgeRequest,
    };
  }

  // Final check against the actual quoted price: the pre-check used
  // the exposure's notional, but what would really be spent is the
  // quoted premium, so MAX_HEDGE_NOTIONAL is re-applied to that.
  const quotedNotional = candidate.pricePerContract * deps.exposureConfig.hedgeContracts;
  const finalCheck = checkHedgeRisk(
    { notional: quotedNotional, modelConfidence: forecast.confidence },
    deps.riskPolicy,
  );

  await deps.db?.recordHedgeEvaluation({
    ...auditRow(validated, exposure),
    modelConfidence: forecast.confidence,
    quotationId: hedgeRequest.quotationId,
    rfqTxHash: hedgeRequest.transactionHash,
    offeror: candidate.offeror,
    pricePerContract: candidate.pricePerContract,
    quotedNotional,
    approved: finalCheck.accepted,
    reason: finalCheck.accepted ? null : finalCheck.reason,
  });

  return {
    status: 200,
    body: {
      exposure,
      forecast,
      request: hedgeRequest,
      candidate,
      quotedNotional,
      approved: finalCheck.accepted,
      reason: finalCheck.accepted ? null : finalCheck.reason,
      hedged: false,
    },
    approved: finalCheck.accepted,
    hedgeRequest,
    candidate,
  };
}

export function registerHedgeRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/api/v1/hedge/sync-signal', async () => {
    const signal = await deps.hedgeProvider.getVolSignal('ETH');
    const egsi = await deps.aiClient.runCycle({
      thetanutsAtmIv: signal.atmIv,
      thetanutsSkew25Delta: signal.skew25Delta,
    });
    return { signal, egsi };
  });

  // §10 step 1, on its own — a read-only "would this warrant a hedge?"
  // check with no on-chain side effects, so a UI can poll it freely.
  app.post<{ Body: ExposureBody }>('/api/v1/hedge/assess', async (request, reply) => {
    const validated = validateExposureBody(request.body ?? {});
    if (typeof validated === 'string') {
      return reply.status(400).send({ error: validated });
    }

    const market = await deps.chainAdapter.getMarketState();
    const exposure = assessExposure(
      {
        netContracts: validated.netContracts,
        contractMultiplier: market.contractMultiplier,
        egsiLevel: validated.egsiLevel,
      },
      deps.exposureConfig,
    );

    return { exposure };
  });

  // §10 steps 1-4: assess -> pull pricing -> RFQ -> best candidate ->
  // hard risk policy -> approve/reject. Stops before execution.
  app.post<{ Body: ExposureBody }>('/api/v1/hedge/evaluate', async (request, reply) => {
    const validated = validateExposureBody(request.body ?? {});
    if (typeof validated === 'string') {
      return reply.status(400).send({ error: validated });
    }

    const result = await runHedgeEvaluation(deps, validated);
    const note =
      result.status === 200 && result.candidate
        ? 'evaluation only — this gateway never executes the trade unless called via POST /api/v1/hedge/execute.'
        : undefined;
    return reply.status(result.status).send(note ? { ...result.body, note } : result.body);
  });

  // §10 step 5: actually settle the approved candidate. Real money on
  // Base mainnet, no reversal — see this module's header comment for
  // the full safety design (fresh re-evaluation every time, never a
  // trusted client-supplied approval).
  //
  // Requires `confirm: true` in the body on top of netContracts/
  // egsiLevel. This is not a strong safety guarantee on its own --
  // anyone who can call this route can set confirm: true -- but it is
  // a real guard against triggering real settlement by copy-pasting an
  // /evaluate request without registering what this route now does.
  app.post<{ Body: ExposureBody & { confirm?: unknown } }>(
    '/api/v1/hedge/execute',
    async (request, reply) => {
      const validated = validateExposureBody(request.body ?? {});
      if (typeof validated === 'string') {
        return reply.status(400).send({ error: validated });
      }
      if (request.body?.confirm !== true) {
        return reply.status(400).send({
          error:
            'this route settles a real options trade on Base mainnet with real funds; pass confirm: true to proceed',
        });
      }

      const result = await runHedgeEvaluation(deps, validated);
      if (result.status !== 200 || !result.approved || !result.hedgeRequest || !result.candidate) {
        // Not approved (or a genuine failure along the way) — return
        // exactly what /evaluate would have, so the caller can see why,
        // without ever reaching executeHedge.
        return reply.status(result.status).send({ ...result.body, executed: false });
      }

      const exposureBody = result.body.exposure as {
        egsiNotional: number;
        ethBetaNotional: number;
        suggestedOptionType: 'CALL' | 'PUT';
      };
      const forecastBody = result.body.forecast as { confidence: number } | undefined;
      const quotedNotional = result.body.quotedNotional as number | undefined;

      try {
        const settlement = await deps.hedgeProvider.executeHedge(result.hedgeRequest, result.candidate);
        await deps.db?.recordHedgeEvaluation({
          netContracts: validated.netContracts,
          egsiLevel: validated.egsiLevel,
          egsiNotional: exposureBody.egsiNotional,
          ethBetaNotional: exposureBody.ethBetaNotional,
          breached: true,
          suggestedOptionType: exposureBody.suggestedOptionType,
          modelConfidence: forecastBody?.confidence ?? null,
          quotationId: result.hedgeRequest.quotationId,
          rfqTxHash: result.hedgeRequest.transactionHash,
          offeror: result.candidate.offeror,
          pricePerContract: result.candidate.pricePerContract,
          quotedNotional: quotedNotional ?? null,
          approved: true,
          reason: null,
          executed: true,
        });
        return { ...result.body, executed: true, transactionHash: settlement.transactionHash };
      } catch (err) {
        // The RFQ and the risk approval both went through; only the
        // final settlement call itself failed (e.g. the offer's
        // deadline lapsed between quoting and settling, or the hedge
        // wallet ran out of gas). Recorded as approved-but-not-executed
        // rather than silently losing that this got as far as approval.
        await deps.db?.recordHedgeEvaluation({
          netContracts: validated.netContracts,
          egsiLevel: validated.egsiLevel,
          egsiNotional: exposureBody.egsiNotional,
          ethBetaNotional: exposureBody.ethBetaNotional,
          breached: true,
          suggestedOptionType: exposureBody.suggestedOptionType,
          modelConfidence: forecastBody?.confidence ?? null,
          quotationId: result.hedgeRequest.quotationId,
          rfqTxHash: result.hedgeRequest.transactionHash,
          offeror: result.candidate.offeror,
          pricePerContract: result.candidate.pricePerContract,
          quotedNotional: quotedNotional ?? null,
          approved: true,
          reason: `settlement failed: ${(err as Error).message}`,
          executed: false,
        });
        return reply.status(502).send({
          ...result.body,
          executed: false,
          error: `approved, but settlement failed: ${(err as Error).message}`,
        });
      }
    },
  );

  // Re-poll an existing RFQ for offers, for the common case where
  // /evaluate ran before any market maker had responded yet.
  app.post<{ Body: { quotationId?: unknown; numContracts?: unknown; direction?: unknown } }>(
    '/api/v1/hedge/candidate',
    async (request, reply) => {
      const { quotationId, numContracts, direction } = request.body ?? {};
      if (typeof quotationId !== 'string' || !quotationId) {
        return reply.status(400).send({ error: 'quotationId is required' });
      }
      if (typeof numContracts !== 'number' || numContracts <= 0) {
        return reply.status(400).send({ error: 'numContracts must be a positive number' });
      }
      if (direction !== 'BUY' && direction !== 'SELL') {
        return reply.status(400).send({ error: "direction must be 'BUY' or 'SELL'" });
      }

      // collectBestCandidate only reads quotationId/numContracts/direction
      // off the request; the remaining fields are placeholders carried to
      // satisfy the HedgeRequest shape.
      const candidate = await deps.hedgeProvider.getBestCandidate({
        quotationId,
        underlying: 'ETH',
        optionType: 'PUT',
        strike: 0,
        expiry: 0,
        numContracts,
        direction,
        offerDeadlineUnixSeconds: 0,
        transactionHash: '',
      });

      return { candidate };
    },
  );
}
