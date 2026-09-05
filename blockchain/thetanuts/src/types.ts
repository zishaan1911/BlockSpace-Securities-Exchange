/**
 * GASX's own view of Thetanuts — ARCHITECTURE.md §7: "one adapter
 * (HedgeProvider-style interface so Thetanuts types never leak)." Every
 * type in this file is shaped for GASX's callers (features/egsi.py's
 * Thetanuts IV input, the AI forecast's IV/skew feature, the future risk
 * engine); none of them are re-exports of @thetanuts-finance/thetanuts-client
 * types. hedgeProvider.ts is the only file that imports the SDK directly.
 */

/** Underlying assets Thetanuts prices options on that GASX cares about
 * (Thetanuts also supports SOL/DOGE/XRP/BNB/PAXG/AVAX via RFQ, but GASX's
 * hedge is specifically ETH-correlated risk — ARCHITECTURE.md §7). */
export type HedgeUnderlying = 'ETH' | 'BTC';

/**
 * Aggregate ETH options volatility signal — the "Data" touchpoint
 * (ARCHITECTURE.md §7.1). Feeds features/egsi.py's Thetanuts IV
 * component (§3) and the AI forecast's IV/skew feature (§4).
 */
export interface VolSignal {
  underlying: HedgeUnderlying;
  /** Spot price Thetanuts is pricing options against, USD. */
  underlyingPrice: number;
  /** Near-term at-the-money implied volatility, as a decimal (0.65 = 65%),
   * from the nearest expiry with enough live quotes to be meaningful. */
  atmIv: number;
  /** 25-delta risk-reversal-style skew: IV(put, delta \u2248 -0.25) \u2212
   * IV(call, delta \u2248 +0.25). Positive = puts bid up relative to calls
   * (the market pricing in more downside fear than upside). 0 if either
   * leg couldn't be found (e.g. too few live quotes near that delta). */
  skew25Delta: number;
  /** Unix seconds of the expiry atmIv/skew25Delta were computed from. */
  expiry: number;
  /** How many live quotes contributed to atmIv/skew25Delta \u2014 a crude
   * liquidity/confidence signal for the caller; few contributing quotes
   * means treat the signal cautiously. */
  sampleSize: number;
  /** When this signal was computed, unix ms. */
  computedAt: number;
}

/** BUY = GASX is going long the option (paying premium); SELL = GASX is
 * going short (receiving premium, posting collateral). Maps directly to
 * the SDK's own isLong convention \u2014 kept as an explicit union here
 * rather than a bare boolean so call sites read clearly. */
export type HedgeDirection = 'BUY' | 'SELL';

export interface HedgeRequestParams {
  underlying: HedgeUnderlying;
  optionType: 'CALL' | 'PUT';
  strike: number;
  /** Unix seconds; must be far enough out to exceed offerDeadlineMinutes. */
  expiry: number;
  numContracts: number;
  direction: HedgeDirection;
  /** Minutes market makers have to respond. */
  offerDeadlineMinutes: number;
  /** Max (BUY) or min (SELL) acceptable price per contract; omit for no
   * price protection (accepts any offer). */
  reservePrice?: number;
}

/** A submitted RFQ (ARCHITECTURE.md §7.2), ready to be polled for offers. */
export interface HedgeRequest {
  quotationId: string;
  underlying: HedgeUnderlying;
  optionType: 'CALL' | 'PUT';
  strike: number;
  expiry: number;
  numContracts: number;
  direction: HedgeDirection;
  offerDeadlineUnixSeconds: number;
  /** On-chain transaction hash that created this RFQ. */
  transactionHash: string;
}

/**
 * One decrypted, comparable market-maker offer for a HedgeRequest.
 * ARCHITECTURE.md §7.2's "present the best candidate to the risk engine"
 * is exactly this object. Evaluating it against ARCHITECTURE.md §8's
 * hard risk policy and actually settling it are NOT done in this module
 * \u2014 RFQ creation and quote collection is Phase 4 (GOALS.md); settling
 * a quote is Phase 5's autonomous-execution step, which needs the hard
 * risk checks in front of it first.
 */
export interface HedgeCandidate {
  quotationId: string;
  offeror: string;
  /** Price per contract, in the RFQ's collateral token's human units. */
  pricePerContract: number;
  /** offerAmount/nonce needed to actually settle this specific offer
   * later (the SDK's encodeSettleQuotationEarly) \u2014 opaque to callers,
   * passed straight through from the SDK's decrypted offer as strings
   * (bigints don't survive JSON without a custom serializer, and this
   * type is meant to cross a future API boundary). */
  raw: { offerAmount: string; nonce: string };
}

/**
 * GASX's narrow view of Thetanuts. Implemented by ThetanutsHedgeProvider
 * (hedgeProvider.ts wraps the real SDK); tests use a hand-rolled fake
 * implementing this same interface, never a live network connection.
 */
export interface HedgeProvider {
  getVolSignal(underlying: HedgeUnderlying): Promise<VolSignal>;
  requestHedgeQuote(params: HedgeRequestParams): Promise<HedgeRequest>;
  getBestCandidate(request: HedgeRequest): Promise<HedgeCandidate | null>;
  /** Settles `candidate` (which must be for `request`'s quotation) —
   * real money on Base mainnet, no reversal. See rfqHedge.ts's
   * executeHedge for the full safety design; this interface method
   * carries no safety logic of its own, by design, so that the one
   * place callers can rely on for hard-limit enforcement is the
   * gateway route that calls it, not this adapter layer. */
  executeHedge(request: HedgeRequest, candidate: HedgeCandidate): Promise<{ transactionHash: string }>;
}
