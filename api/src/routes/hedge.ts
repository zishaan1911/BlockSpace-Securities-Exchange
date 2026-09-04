/**
 * ARCHITECTURE.md §10's Hedge Flow, wired end-to-end (except the final
 * execution step — see below).
 *
 * Four routes:
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
 *                                    -> report approve/reject
 *   POST /api/v1/hedge/candidate     re-poll an existing RFQ for offers
 *
 * **What /evaluate deliberately does NOT do: execute.** It stops at
 * §10's "R->>TN: Approve (hard limits passed)" and returns the decision.
 * It never calls Thetanuts' settleQuotationEarly/settleQuotation, so no
 * options position is ever opened by this gateway. That final step is
 * Phase 5's autonomous execution, it spends real money on Base mainnet,
 * and it should be a deliberate, separately-reviewed addition rather
 * than something that quietly starts happening because an exposure
 * threshold tripped. The approval decision this route produces is
 * exactly the input that step would consume.
 *
 * Note that /evaluate DOES have a real on-chain side effect even so:
 * createHedgeRequest submits an RFQ transaction to OptionFactory on Base
 * mainnet, which costs gas and is publicly visible. It is a POST for
 * that reason. It requires a configured hedge wallet
 * (GASX_THETANUTS_HEDGE_WALLET_PRIVATE_KEY) and will fail loudly
 * without one.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../server.js';
import { assessExposure } from '../exposure.js';
import { checkHedgeConfidence, checkHedgeRisk } from '../riskPolicy.js';

interface ExposureBody {
  netContracts?: unknown;
  egsiLevel?: unknown;
}

interface ValidatedExposure {
  netContracts: number;
  egsiLevel: number;
}

/** Validates the caller-supplied position/level inputs shared by
 * /assess and /evaluate. Exported for direct unit testing. */
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
      return { exposure, hedged: false, reason };
    }

    // §8's MIN_MODEL_CONFIDENCE gates the AI-driven hedge path, so the
    // forecast is needed before committing to an RFQ (which costs gas).
    // A missing forecast fails closed: no confidence reading means the
    // confidence floor cannot be shown to be satisfied.
    const forecast = await deps.aiClient.getForecast();
    if (!forecast) {
      return reply.status(503).send({
        exposure,
        hedged: false,
        error: 'no AI forecast available; cannot evaluate MIN_MODEL_CONFIDENCE, so no hedge may proceed',
      });
    }

    // Check confidence BEFORE createHedgeRequest — a hedge that would be
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
        exposure,
        forecast,
        hedged: false,
        approved: false,
        reason: preCheck.reason,
        note: 'rejected before any RFQ was submitted, so no gas was spent',
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
      return reply.status(503).send({
        exposure,
        forecast,
        hedged: false,
        error: `no usable Thetanuts ETH options data: ${(err as Error).message}`,
      });
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
      return reply.status(503).send({
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
      });
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
        exposure,
        forecast,
        request: hedgeRequest,
        hedged: false,
        approved: false,
        reason: 'no market maker offers received for this RFQ yet — poll /api/v1/hedge/candidate to re-check',
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
      exposure,
      forecast,
      request: hedgeRequest,
      candidate,
      quotedNotional,
      approved: finalCheck.accepted,
      reason: finalCheck.accepted ? null : finalCheck.reason,
      hedged: false,
      note: 'evaluation only — this gateway never executes the trade. See this module header.',
    };
  });

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
