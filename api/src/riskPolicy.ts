/**
 * ARCHITECTURE.md §8's Hard Risk Policy: "AI can request an action. It
 * cannot bypass policy." — enforced here, outside any model, per §8's
 * own framing ("Enforced outside the language model, in the API/
 * contracts"). Pure functions, no I/O, fully unit-tested.
 *
 * Not every documented policy constant is enforced by every check below
 * yet — each function's doc comment says exactly which constants it
 * applies and why the others don't apply to that particular action. See
 * README.md for the full accounting.
 */

export interface RiskPolicyConfig {
  /** MAX_ORDER_CONTRACTS — cap on a single order's quantity. */
  maxOrderContracts: number;
  /** MAX_POSITION_CONTRACTS — cap on a trader's net position size.
   * Defined per ARCHITECTURE.md §8 but NOT enforced by checkOrderRisk
   * below: doing so needs a live position read this gateway doesn't
   * have yet (no indexer/position-query path built). Revisit once one
   * exists. */
  maxPositionContracts: number;
  /** MAX_SLIPPAGE, in basis points — how far an order's price may sit
   * from a supplied reference price. Only enforced by checkOrderRisk
   * when a reference price is actually supplied (e.g. from the latest
   * oracle EGSI value) — omitting one skips this check entirely rather
   * than failing closed on missing data. */
  maxSlippageBps: number;
  /** MIN_MODEL_CONFIDENCE — minimum AI forecast confidence required
   * before the AI-driven hedge path (ARCHITECTURE.md §7.2, §10) may
   * proceed. NOT applied to manual, trader-initiated order placement
   * (checkOrderRisk) — a human placing their own order isn't "the AI
   * requesting an action," so gating it on model confidence would be a
   * category error. Used by checkHedgeRisk instead. */
  minModelConfidence: number;
  /** MAX_HEDGE_NOTIONAL — cap on the AI agent's autonomous hedge
   * notional (ARCHITECTURE.md §8, §10). Used by checkHedgeRisk. */
  maxHedgeNotional: number;
}

export type RiskCheckResult = { accepted: true } | { accepted: false; reason: string };

function accept(): RiskCheckResult {
  return { accepted: true };
}

function reject(reason: string): RiskCheckResult {
  return { accepted: false, reason };
}

export interface OrderRiskCheckInput {
  price: number;
  quantity: number;
  /** From the live Market object (blockchain/sui's MarketState.tickSize).
   * 0 disables the tick-alignment check. */
  tickSize: number;
  marketPaused: boolean;
  marketSettled: boolean;
  /** Optional reference price (e.g. the latest oracle EGSI value) —
   * enables the MAX_SLIPPAGE check when supplied. */
  referencePrice?: number;
}

/**
 * Pre-trade risk check for manual order placement (ARCHITECTURE.md §9's
 * "Prepare order (pre-trade risk checks)"). Applies MAX_ORDER_CONTRACTS
 * and, when a reference price is supplied, MAX_SLIPPAGE — see
 * RiskPolicyConfig's field docs for which constants don't apply here and
 * why.
 */
export function checkOrderRisk(input: OrderRiskCheckInput, policy: RiskPolicyConfig): RiskCheckResult {
  if (input.marketPaused) return reject('market is paused');
  if (input.marketSettled) return reject('market is already settled');
  if (!Number.isInteger(input.price) || input.price <= 0) return reject('price must be a positive integer');
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return reject('quantity must be a positive integer');
  }
  if (input.tickSize > 0 && input.price % input.tickSize !== 0) {
    return reject(`price must be a multiple of the market tick size (${input.tickSize})`);
  }
  if (input.quantity > policy.maxOrderContracts) {
    return reject(`quantity exceeds MAX_ORDER_CONTRACTS (${policy.maxOrderContracts})`);
  }
  if (input.referencePrice !== undefined && policy.maxSlippageBps > 0) {
    if (input.referencePrice <= 0) return reject('referencePrice must be positive when supplied');
    const diffBps = (Math.abs(input.price - input.referencePrice) / input.referencePrice) * 10_000;
    if (diffBps > policy.maxSlippageBps) {
      return reject(
        `price is more than MAX_SLIPPAGE (${policy.maxSlippageBps} bps) from the reference price (${input.referencePrice})`,
      );
    }
  }
  return accept();
}

export interface HedgeRiskCheckInput {
  notional: number;
  modelConfidence: number;
}

/**
 * Risk check for the AI-driven hedge path (ARCHITECTURE.md §7.2, §8,
 * §10's "Approve (hard limits passed)" step). Applies
 * MIN_MODEL_CONFIDENCE and MAX_HEDGE_NOTIONAL. This governs whether a
 * hedge *candidate* (blockchain/thetanuts's HedgeCandidate) may be
 * settled — it does not itself settle anything; that's Phase 5's
 * autonomous-execution step (GOALS.md), which this gateway does not
 * implement.
 */
export function checkHedgeRisk(input: HedgeRiskCheckInput, policy: RiskPolicyConfig): RiskCheckResult {
  if (!Number.isFinite(input.notional) || input.notional <= 0) {
    return reject('notional must be a positive number');
  }
  if (input.modelConfidence < policy.minModelConfidence) {
    return reject(
      `model confidence (${input.modelConfidence}) is below MIN_MODEL_CONFIDENCE (${policy.minModelConfidence})`,
    );
  }
  if (input.notional > policy.maxHedgeNotional) {
    return reject(`notional (${input.notional}) exceeds MAX_HEDGE_NOTIONAL (${policy.maxHedgeNotional})`);
  }
  return accept();
}
