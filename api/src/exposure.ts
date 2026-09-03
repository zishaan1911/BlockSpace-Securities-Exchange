/**
 * ETH-beta exposure (ARCHITECTURE.md §10's Hedge Flow, first step:
 * "R->>TN: ETH-beta exposure breached threshold"). This is the concept
 * the whole hedge flow starts from, and until now it did not exist
 * anywhere in the codebase.
 *
 * The idea: a trader long EGSI-1H futures is implicitly long Ethereum
 * congestion, which is correlated with broad ETH activity — so a large
 * GASX book carries ETH-correlated risk that ARCHITECTURE.md §7.2 says
 * to offset with Thetanuts options. "ETH-beta" is that correlation
 * coefficient: how much ETH exposure one unit of EGSI exposure implies.
 *
 * Two honest caveats about this module, both structural rather than
 * incidental:
 *
 * 1. **The beta is a configured constant, not a measured one.** A real
 *    implementation would estimate it by regressing EGSI returns
 *    against ETH returns over accumulated history. GASX has no such
 *    history yet (the market has never traded), so there is nothing to
 *    regress. `ethBeta` is therefore a hand-set assumption, and every
 *    number this module produces inherits that assumption's error.
 *    Treat the output as "a threshold-crossing signal computed from a
 *    guess," not as a measured risk figure.
 *
 * 2. **Net position must be supplied by the caller.** This gateway has
 *    no position-read path — there is no indexer (ARCHITECTURE.md §9's
 *    "S-->>I: Trade events" step is unbuilt), so nothing here can
 *    enumerate open Positions on Sui. The caller passes in what it
 *    knows. Whoever supplies it owns its accuracy.
 */

export interface ExposureConfig {
  /** ETH exposure implied per unit of EGSI notional. See caveat 1 in
   * this module's header — this is a configured assumption, not a
   * measured correlation. */
  ethBeta: number;
  /** Absolute ETH-beta notional (USD) above which a hedge is
   * considered warranted (ARCHITECTURE.md §10's "breached threshold"). */
  hedgeThresholdNotional: number;
  /**
   * How many option contracts to request in a hedge RFQ.
   *
   * Fractional is allowed and supported by the Thetanuts SDK, which
   * converts to the on-chain format using the collateral token's
   * decimals. A minimum of 0.01 is enforced in config: below that the
   * premium rounds to nothing useful, and a zero or negative size would
   * produce an RFQ no market maker can quote.
   *
   * Fixed rather than sized from the exposure: ARCHITECTURE.md §8 calls
   * for a "small fixed cap" on autonomous activity, and a fixed size is
   * easier to reason about than a sizing formula that would itself need
   * validating.
   */
  hedgeContracts: number;
  /** Minutes market makers get to respond to a hedge RFQ. */
  offerDeadlineMinutes: number;
  /**
   * How far out to place the hedge's option expiry, in hours.
   *
   * Deliberately NOT the expiry the vol signal reports. That one is the
   * nearest expiry with enough live quotes to measure ATM IV from,
   * which is the right choice for measuring volatility and the wrong
   * one for trading: it can be sooner than the RFQ's own offer
   * deadline, and Thetanuts rejects an option that expires before
   * market makers have finished quoting it.
   *
   * 24h by default — comfortably past any sane offer deadline, and the
   * nearest tenor with real liquidity for an EGSI-1H hedge.
   */
  hedgeExpiryHours: number;
}

export interface ExposureInput {
  /** Signed net position in EGSI-1H contracts: positive = net long,
   * negative = net short, 0 = flat. */
  netContracts: number;
  /** The market's contract multiplier (blockchain/sui's
   * MarketState.contractMultiplier). */
  contractMultiplier: number;
  /** Current EGSI index level, used as the price leg of notional. */
  egsiLevel: number;
}

export interface ExposureAssessment {
  /** Signed EGSI notional: netContracts * multiplier * egsiLevel. */
  egsiNotional: number;
  /** Signed ETH-beta-adjusted notional. */
  ethBetaNotional: number;
  /** True when |ethBetaNotional| exceeds the configured threshold. */
  breached: boolean;
  /** Which way to hedge, or null when not breached. A net-long EGSI
   * book carries downside risk if congestion (and correlated ETH
   * activity) collapses, so it is hedged with PUTs; a net-short book
   * with CALLs. */
  suggestedOptionType: 'CALL' | 'PUT' | null;
}

/**
 * Pure: turns a net position into an ETH-beta exposure assessment.
 * A flat book (netContracts === 0) is never breached, regardless of
 * threshold.
 */
export function assessExposure(input: ExposureInput, config: ExposureConfig): ExposureAssessment {
  const egsiNotional = input.netContracts * input.contractMultiplier * input.egsiLevel;
  const ethBetaNotional = egsiNotional * config.ethBeta;
  const breached = Math.abs(ethBetaNotional) > config.hedgeThresholdNotional;

  let suggestedOptionType: 'CALL' | 'PUT' | null = null;
  if (breached) {
    suggestedOptionType = ethBetaNotional > 0 ? 'PUT' : 'CALL';
  }

  return { egsiNotional, ethBetaNotional, breached, suggestedOptionType };
}
