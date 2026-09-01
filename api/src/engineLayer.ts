/**
 * The C++ order engine, as an off-chain depth and quote layer.
 *
 * What this is NOT: a replacement for on-chain matching.
 * `contracts/gasx` remains authoritative for the order book, margin and
 * settlement — every real trade is still a Sui transaction the user's
 * wallet signs. Nothing here moves money or is trusted for settlement.
 *
 * What it IS: the two things Sui cannot answer cheaply on every UI poll,
 * because each would otherwise be a chain read:
 *
 *   1. **Indicative depth** — the best bid/ask a screen needs at 5s
 *      refresh. ARCHITECTURE.md §9's trade flow shows an "orderbook" in
 *      the market-state response, and there is no indexer to build one
 *      from chain events (`indexer/` is still an empty scaffold).
 *   2. **A two-sided quote** derived from the AI forecast, using the
 *      engine's QuoteEngine — spread widening with volatility, size
 *      scaling with confidence, refusal below a confidence floor.
 *
 * Because it is indicative rather than authoritative, every response
 * from here is explicitly labelled as such. A screen showing a price
 * that no chain state backs is a real way to mislead someone, so the
 * label travels with the data rather than living only in this comment.
 */
import { Engine, type BookSnapshot, type QuoteResult } from '@gasx/engine';
import type { ForecastDto } from './aiClient.js';

export interface EngineConfig {
  contractMultiplier: number;
  marginRatioBps: number;
  maxOrderQuantity: number;
  maxNetPosition: number;
  minConfidence: number;
}

export interface IndicativeQuote {
  bid: number;
  ask: number;
  fairPrice: number;
  size: number;
  /** Always true. Present in the payload, not just the docs, so a
   * consumer cannot mistake this for an executable price. */
  indicative: true;
}

export interface EngineLayer {
  getBook(): BookSnapshot;
  quoteFromForecast(forecast: ForecastDto | null, netPosition: number): IndicativeQuote | null;
  /** Seeds indicative depth. See seedIndicativeBook's own comment for
   * why this exists and what it is honestly worth. */
  seedIndicativeBook(quote: IndicativeQuote): void;
}

export class CppEngineLayer implements EngineLayer {
  private readonly engine: Engine;
  private seededOrderIds: number[] = [];

  constructor(config: EngineConfig) {
    this.engine = new Engine({
      risk: {
        contractMultiplier: config.contractMultiplier,
        marginRatioBps: config.marginRatioBps,
        maxOrderQuantity: config.maxOrderQuantity,
        maxNetPosition: config.maxNetPosition,
      },
      pricing: {
        // The engine works in integer price ticks and EGSI is already an
        // integer 0-1000 index, so no rescaling is needed.
        priceScale: 1,
        baseHalfSpread: 5,
        volatilitySpreadMultiplier: 0.5,
        minConfidence: config.minConfidence,
        maxQuoteSize: 100,
        minQuoteSize: 5,
      },
    });
  }

  getBook(): BookSnapshot {
    return this.engine.getBookSnapshot();
  }

  /**
   * Turns the AI service's forecast into a two-sided quote via the
   * engine's QuoteEngine. Returns null when the engine refuses — below
   * its confidence floor, no quote is the honest answer, and that
   * refusal is deliberately not overridden here.
   */
  quoteFromForecast(forecast: ForecastDto | null, netPosition: number): IndicativeQuote | null {
    if (!forecast) return null;

    const result: QuoteResult = this.engine.getQuote({
      market: forecast.market,
      expectedValue: forecast.expected_egsi,
      // The forecast carries no explicit volatility, so it is derived
      // from confidence: a less confident forecast implies a wider
      // plausible range, which should widen the spread. Crude, and
      // stated as such rather than dressed up as a volatility model.
      volatility: (1 - forecast.confidence) * 100,
      confidence: forecast.confidence,
      tailProbability: forecast.p_tail_500,
      modelVersion: forecast.model_version,
      netPosition,
    });

    if (!result.hasQuote) return null;
    return {
      bid: result.bid!,
      ask: result.ask!,
      fairPrice: result.fairPrice!,
      size: result.size!,
      indicative: true,
    };
  }

  /**
   * Places the quote into the engine's own book so the UI has depth to
   * render.
   *
   * Being blunt about what this is: with no indexer, there are no real
   * resting orders to show, so this is GASX quoting to itself. It gives
   * the screen a live, forecast-driven book rather than an empty one,
   * and every price it produces is marked indicative. It is not a claim
   * that anyone will trade at these levels.
   *
   * Previous seeds are cancelled first, so the book tracks the current
   * forecast instead of accumulating stale levels.
   */
  seedIndicativeBook(quote: IndicativeQuote): void {
    for (const orderId of this.seededOrderIds) {
      this.engine.cancelOrder(orderId);
    }
    this.seededOrderIds = [];

    // Margin is set high enough that the engine's pre-trade risk check
    // never rejects a seed. That check protects real traders; here it
    // would only stop the screen from rendering.
    const margin = Number.MAX_SAFE_INTEGER / 4;
    for (const [isBid, price] of [
      [true, quote.bid],
      [false, quote.ask],
    ] as const) {
      const placed = this.engine.placeOrder({
        traderId: 'gasx-indicative',
        isBid,
        price,
        quantity: quote.size,
        availableMargin: margin,
      });
      if (placed.accepted) this.seededOrderIds.push(placed.orderId);
    }
  }
}
