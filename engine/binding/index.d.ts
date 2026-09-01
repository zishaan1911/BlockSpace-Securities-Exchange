/** Types for the C++ engine binding (engine/protocol/EngineService). */

export interface EngineOptions {
  risk?: {
    contractMultiplier?: number;
    marginRatioBps?: number;
    /** 0 means unlimited. */
    maxOrderQuantity?: number;
    maxNetPosition?: number;
  };
  pricing?: {
    priceScale?: number;
    baseHalfSpread?: number;
    volatilitySpreadMultiplier?: number;
    minConfidence?: number;
    maxQuoteSize?: number;
    minQuoteSize?: number;
    inventorySkewPerUnit?: number;
  };
}

export interface Fill {
  price: number;
  quantity: number;
  restingTraderId: string;
  incomingTraderId: string;
  incomingSide: 'BUY' | 'SELL';
}

export interface PlaceOrderResult {
  accepted: boolean;
  /** Valid only when accepted. */
  orderId: number;
  /** Populated only when rejected. */
  rejectReason: string;
  fills: Fill[];
}

export interface QuoteResult {
  hasQuote: boolean;
  bid?: number;
  ask?: number;
  fairPrice?: number;
  size?: number;
}

export interface BookLevel {
  price: number;
  quantity: number;
  traderId: string;
}

export interface BookSnapshot {
  bestBid: BookLevel | null;
  bestAsk: BookLevel | null;
}

/** One instance is one market, matching the C++ class's own contract. */
export class Engine {
  constructor(options?: EngineOptions);
  placeOrder(request: {
    traderId: string;
    isBid: boolean;
    price: number;
    quantity: number;
    availableMargin: number;
  }): PlaceOrderResult;
  cancelOrder(orderId: number): { cancelled: boolean };
  getQuote(request: {
    market?: string;
    expectedValue: number;
    volatility: number;
    confidence: number;
    tailProbability?: number;
    modelVersion?: string;
    netPosition?: number;
  }): QuoteResult;
  getBookSnapshot(): BookSnapshot;
  netPosition(traderId: string): number;
}
