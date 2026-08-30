/**
 * Touchpoint 1 ("Data") of ARCHITECTURE.md §7: turns live Thetanuts
 * order-book quotes into the aggregate VolSignal that features/egsi.py's
 * Thetanuts IV component (§3) and the AI forecast's IV/skew feature (§4)
 * consume.
 *
 * computeVolSignal() is a pure function \u2014 no network, no SDK client \u2014
 * so it's fully unit-testable against synthetic order fixtures. The only
 * network call lives in fetchVolSignal(), which is a thin wrapper: fetch
 * orders + market data from a real ThetanutsClient, then hand them to
 * computeVolSignal().
 */
import type { ThetanutsClient, OrderWithSignature } from '@thetanuts-finance/thetanuts-client';
import type { HedgeUnderlying, VolSignal } from './types.js';

const TARGET_PUT_DELTA = -0.25;
const TARGET_CALL_DELTA = 0.25;

/**
 * One order's usable signal for this computation \u2014 extracted up front
 * so computeVolSignal doesn't need to know about OrderWithSignature's
 * nested rawApiData/greeks shape throughout its logic.
 */
interface UsableQuote {
  expiry: number;
  strike: number;
  isCall: boolean;
  iv: number;
  delta: number;
}

function extractUsableQuote(order: OrderWithSignature): UsableQuote | null {
  const raw = order.rawApiData;
  if (!raw || !raw.greeks) return null;
  // Vanilla only (single strike) \u2014 a spread/butterfly/condor's per-leg
  // greeks aren't cleanly attributable to "this option's IV" the way a
  // vanilla's are.
  if (!raw.strikes || raw.strikes.length !== 1) return null;
  const strike = Number(raw.strikes[0]) / 1e8; // 8-decimal fixed point, per SDK docs
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const { iv, delta } = raw.greeks;
  if (!Number.isFinite(iv) || !Number.isFinite(delta)) return null;
  return {
    expiry: raw.orderExpiryTimestamp,
    strike,
    isCall: raw.isCall,
    iv,
    delta,
  };
}

function closestBy<T>(items: T[], score: (item: T) => number, target: number): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const distance = Math.abs(score(item) - target);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Computes a VolSignal from a batch of orders already fetched for one
 * chain. `nowUnixSeconds` is injectable (rather than reading Date.now()
 * internally) so tests are deterministic regardless of when they run.
 * Returns null if there's no usable expiry at all (e.g. no live quotes
 * carry greeks yet) \u2014 callers decide how to handle that (fall back to a
 * cached signal, skip the Thetanuts EGSI component for this cycle, etc.)
 * rather than this function inventing a fake zero signal.
 */
export function computeVolSignal(
  orders: OrderWithSignature[],
  underlying: HedgeUnderlying,
  underlyingPrice: number,
  priceFeedAddress: string,
  nowUnixSeconds: number,
): VolSignal | null {
  const normalizedFeed = priceFeedAddress.toLowerCase();
  const usable = orders
    .filter((o) => o.rawApiData?.priceFeed?.toLowerCase() === normalizedFeed)
    .map(extractUsableQuote)
    .filter((q): q is UsableQuote => q !== null && q.expiry > nowUnixSeconds);

  if (usable.length === 0) return null;

  // Nearest expiry with usable quotes.
  const nearestExpiry = usable.reduce(
    (min, q) => (q.expiry < min ? q.expiry : min),
    usable[0]!.expiry,
  );
  const atExpiry = usable.filter((q) => q.expiry === nearestExpiry);

  const atm = closestBy(atExpiry, (q) => q.strike, underlyingPrice);
  if (!atm) return null;

  const puts = atExpiry.filter((q) => !q.isCall);
  const calls = atExpiry.filter((q) => q.isCall);
  const skewPut = closestBy(puts, (q) => q.delta, TARGET_PUT_DELTA);
  const skewCall = closestBy(calls, (q) => q.delta, TARGET_CALL_DELTA);
  const skew25Delta = skewPut && skewCall ? skewPut.iv - skewCall.iv : 0;

  return {
    underlying,
    underlyingPrice,
    atmIv: atm.iv,
    skew25Delta,
    expiry: nearestExpiry,
    sampleSize: atExpiry.length,
    computedAt: Date.now(),
  };
}

/** Fetches live orders + market data from `client` and computes a
 * VolSignal for `underlying`. Not unit-tested directly (it's a thin,
 * side-effecting wrapper around two SDK calls) \u2014 computeVolSignal above
 * carries the actual logic and is what's tested. NOT exercised against a
 * live Thetanuts endpoint from Claude's sandbox; see README.md. */
export async function fetchVolSignal(
  client: ThetanutsClient,
  underlying: HedgeUnderlying,
): Promise<VolSignal | null> {
  const [orders, marketData] = await Promise.all([
    client.api.fetchOrders(),
    client.api.getMarketData(),
  ]);
  const underlyingPrice = Number(marketData.prices[underlying]);
  const priceFeedAddress =
    underlying === 'ETH' ? client.chainConfig.priceFeeds.ETH : client.chainConfig.priceFeeds.BTC;
  if (!priceFeedAddress) {
    throw new Error(`chainConfig has no price feed address for ${underlying} on this chain`);
  }
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  return computeVolSignal(orders, underlying, underlyingPrice, priceFeedAddress, nowUnixSeconds);
}
