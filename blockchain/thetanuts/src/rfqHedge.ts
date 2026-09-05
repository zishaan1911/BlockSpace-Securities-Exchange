/**
 * Touchpoint 2 ("RFQ hedge") of ARCHITECTURE.md §7: "when GASX's
 * ETH-beta exposure exceeds a threshold, request quotes and present the
 * best candidate to the risk engine." This module covers creating the
 * RFQ, collecting/decrypting/ranking offers into a HedgeCandidate, and
 * (as of executeHedge below) actually settling one -- touchpoint 3,
 * autonomous execution.
 *
 * executeHedge is real money on Base mainnet with no reversal: once
 * settleQuotationEarly lands, the option is open and the premium is
 * spent. It is called from exactly one place, api/src/routes/hedge.ts's
 * POST /hedge/execute, which re-runs the ENTIRE evaluation pipeline
 * itself (fresh exposure assessment, fresh vol signal, a brand-new RFQ,
 * a fresh risk-policy check) rather than trusting a client-supplied
 * "this was approved earlier" flag -- ARCHITECTURE.md §8's guarantee
 * that hard limits cannot be bypassed has to hold at the moment money
 * actually moves, not at some earlier moment whose conditions may have
 * changed. See that route's own comment for the full safety design.
 */
import type { ThetanutsClient } from '@thetanuts-finance/thetanuts-client';
import type { HedgeCandidate, HedgeDirection, HedgeRequest, HedgeRequestParams } from './types.js';

/**
 * Picks the best of a set of already-decrypted candidates, per the same
 * rule the on-chain reveal phase enforces (docs.thetanuts.finance's RFQ
 * Lifecycle page): lowest price wins for BUY (cheapest for the buyer),
 * highest wins for SELL (most valuable for the seller). Pure \u2014 no
 * network \u2014 so it's the fully unit-tested part of this module. Returns
 * null for an empty list.
 */
export function pickBestCandidate(
  candidates: HedgeCandidate[],
  direction: HedgeDirection,
): HedgeCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => {
    if (direction === 'BUY') {
      return candidate.pricePerContract < best.pricePerContract ? candidate : best;
    }
    return candidate.pricePerContract > best.pricePerContract ? candidate : best;
  });
}

/**
 * Submits an RFQ to the OptionFactory and returns a HedgeRequest for
 * polling with collectBestCandidate(). Requires `client` to have been
 * constructed with a signer (config.ts's hedgeWalletPrivateKey) \u2014 this
 * sends a real on-chain transaction on Base mainnet (Thetanuts has no
 * testnet deployment \u2014 see README.md). RFQ creation itself doesn't lock
 * collateral (pulled at settlement, which this module never calls), but
 * it does cost gas and is publicly visible on-chain.
 *
 * NOT exercised against a live Thetanuts endpoint from Claude's sandbox
 * \u2014 no network egress to Base RPC there, and this deliberately never
 * receives a real private key regardless. Needs verification on your
 * machine with a funded, dedicated hedge wallet before you trust it.
 */
export async function createHedgeRequest(
  client: ThetanutsClient,
  params: HedgeRequestParams,
): Promise<HedgeRequest> {
  if (!client.signer) {
    throw new Error(
      'createHedgeRequest requires a signer \u2014 set GASX_THETANUTS_HEDGE_WALLET_PRIVATE_KEY (see .env.example)',
    );
  }
  // The SDK types `requester` as a branded `0x${string}` (a checksummed
  // hex address), narrower than ethers' plain `string` return type here.
  // getAddress() is documented to always return a valid 0x-prefixed
  // address, so this cast reflects a real invariant rather than papering
  // over one.
  const requester = (await client.signer.getAddress()) as `0x${string}`;
  const keyPair = await client.rfqKeys.getOrCreateKeyPair();

  const rfqRequest = client.optionFactory.buildRFQRequest({
    requester,
    underlying: params.underlying,
    optionType: params.optionType,
    // `strikes` (not the deprecated singular `strike`) is what the
    // installed SDK's type actually requires as of 0.3.0, even though
    // some of Thetanuts' own published doc examples still show `strike`
    // — verified against node_modules/@thetanuts-finance/thetanuts-client's
    // .d.ts directly. A bare number here means "vanilla, one strike."
    strikes: params.strike,
    expiry: params.expiry,
    numContracts: params.numContracts,
    isLong: params.direction === 'BUY',
    offerDeadlineMinutes: params.offerDeadlineMinutes,
    collateralToken: 'USDC',
    reservePrice: params.reservePrice,
    requesterPublicKey: keyPair.compressedPublicKey,
  });

  const receipt = await client.optionFactory.requestForQuotation(rfqRequest);
  // The SDK's own quick-start pattern for recovering the new RFQ's id:
  // requestForQuotation() returns a plain TransactionReceipt (no
  // quotationId field), so read the post-creation counter and subtract
  // one. Fine for a single hedge-wallet workflow; would race under
  // concurrent RFQ creation from multiple callers, which GASX's
  // single-publisher hedge wallet never does.
  const quotationCount = await client.optionFactory.getQuotationCount();
  const quotationId = (quotationCount - 1n).toString();

  return {
    quotationId,
    underlying: params.underlying,
    optionType: params.optionType,
    strike: params.strike,
    expiry: params.expiry,
    numContracts: params.numContracts,
    direction: params.direction,
    offerDeadlineUnixSeconds: Math.floor(Date.now() / 1000) + params.offerDeadlineMinutes * 60,
    transactionHash: receipt.hash,
  };
}

/**
 * Decrypts every offer submitted so far for `request.quotationId` and
 * returns the best one per pickBestCandidate \u2014 ARCHITECTURE.md §7.2's
 * "present the best candidate to the risk engine." Never calls
 * settleQuotationEarly/settleQuotation (see this file's header comment).
 *
 * NOT exercised against a live Thetanuts endpoint from Claude's sandbox;
 * see README.md.
 */
export async function collectBestCandidate(
  client: ThetanutsClient,
  request: HedgeRequest,
): Promise<HedgeCandidate | null> {
  const keyPair = await client.rfqKeys.loadKeyPair();
  const allOffers = await client.api.getFactoryOffers();
  const offersForThisRfq = allOffers.filter((o) => o.quotationId === request.quotationId);

  const candidates: HedgeCandidate[] = [];
  for (const offer of offersForThisRfq) {
    try {
      const decrypted = await client.rfqKeys.decryptOffer(
        offer.signedOfferForRequester,
        offer.signingKey,
        keyPair,
      );
      candidates.push({
        quotationId: request.quotationId,
        offeror: offer.offeror,
        pricePerContract: pricePerContractFromOfferAmount(decrypted.offerAmount, request.numContracts),
        raw: { offerAmount: decrypted.offerAmount.toString(), nonce: decrypted.nonce.toString() },
      });
    } catch {
      // An offer this adapter can't decrypt (wrong keypair, corrupted
      // payload, an MM's ephemeral key from a different RFQ, etc.) is
      // simply excluded from the candidate pool rather than failing the
      // whole lookup — other offers may still be usable.
      continue;
    }
  }

  return pickBestCandidate(candidates, request.direction);
}

/** offerAmount is total USDC (6 decimals) for the whole quotation \u2014 per
 * the SDK docs' own decrypt example (`ethers.formatUnits(decrypted.offerAmount, 6)`).
 * Exported for testing; not part of the module's public surface (not
 * re-exported from index.ts). */
export function pricePerContractFromOfferAmount(offerAmount: bigint, numContracts: number): number {
  const totalUsdc = Number(offerAmount) / 1e6;
  return numContracts > 0 ? totalUsdc / numContracts : totalUsdc;
}

/**
 * Settles a specific decrypted offer — ARCHITECTURE.md §7's touchpoint 3,
 * autonomous execution. Calls client.optionFactory.settleQuotationEarly,
 * which pulls collateral from the hedge wallet and opens the option
 * position on Base mainnet. This is the one call in the whole GASX
 * codebase that spends real, non-recoverable money — see this module's
 * header comment for why the safety design (fresh re-evaluation, not a
 * trusted flag) lives in the caller (api/src/routes/hedge.ts), not here.
 *
 * `candidate` must be the SAME quotation `request` was built from —
 * settling a different quotation's candidate against this request would
 * settle the wrong RFQ. Both are threaded through as separate
 * parameters rather than one combined object because HedgeCandidate is
 * already an established type from getBestCandidate(); requiring the
 * caller to supply both is what makes a request/candidate mismatch a
 * compile-time question instead of a runtime one.
 *
 * NOT exercised against a live Thetanuts endpoint from Claude's
 * sandbox — no network egress to Base RPC there, and this deliberately
 * never receives a real private key regardless. This is the single
 * most consequential unverified call in the project: it needs to work
 * correctly the first time it runs for real, because there is no way to
 * rehearse it risk-free (Thetanuts has no testnet). Read this function
 * and its caller carefully before the first live run.
 */
export async function executeHedge(
  client: ThetanutsClient,
  request: HedgeRequest,
  candidate: HedgeCandidate,
): Promise<{ transactionHash: string }> {
  if (!client.signer) {
    throw new Error(
      'executeHedge requires a signer — set GASX_THETANUTS_HEDGE_WALLET_PRIVATE_KEY (see .env.example)',
    );
  }
  if (candidate.quotationId !== request.quotationId) {
    throw new Error(
      `candidate is for quotation ${candidate.quotationId} but request is for ${request.quotationId} — refusing to settle a mismatched pair`,
    );
  }

  const receipt = await client.optionFactory.settleQuotationEarly(
    BigInt(request.quotationId),
    BigInt(candidate.raw.offerAmount),
    BigInt(candidate.raw.nonce),
    candidate.offeror,
  );

  return { transactionHash: receipt.hash };
}
