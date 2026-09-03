/**
 * The frontend's only contact with the backend (ARCHITECTURE.md §2:
 * "the UI only talks to stable domain APIs"). Nothing here imports a
 * Sui or Thetanuts SDK — the gateway hides both. The single exception
 * is signing, which by definition must happen in the user's own wallet;
 * the gateway hands back a serialized transaction and the wallet signs
 * it (see components/OrderTicket.tsx).
 */

export interface OracleState {
  oracleId: string;
  price: number;
  hasPrice: boolean;
  lastUpdateMs: number;
  maxStalenessMs: number;
  maxPrice: number;
  isFreshApprox: boolean;
}

export interface MarketState {
  marketId: string;
  underlying: string;
  expiryMs: number;
  contractMultiplier: number;
  tickSize: number;
  marginRatioBps: number;
  paused: boolean;
  settled: boolean;
  settlementPrice: number | null;
  oracle: OracleState;
  /** True when the gateway is serving the synthetic dev market
   * (blockchain/sui's dev-market mode) — the UI labels it as such. */
  devMode?: boolean;
  /** The Sui network the (real) market lives on. */
  network?: string;
}

export interface EgsiComponents {
  base_fee: number;
  utilization: number;
  mempool_pressure: number;
  fee_momentum: number;
  gas_volatility: number;
  dex_activity: number;
  thetanuts_iv: number | null;
}

export interface EgsiSnapshot {
  market: string;
  score: number;
  components: EgsiComponents;
  block_number: number;
  timestamp: number;
}

export interface Forecast {
  market: string;
  expected_egsi: number;
  confidence: number;
  p_tail_500: number;
  model_version: string;
}

/** Depth from the C++ engine. Indicative: contracts/gasx owns the real
 * book and there is no indexer to read it from, so these levels are
 * GASX's own quote, not resting orders anyone placed. The flag rides in
 * the payload precisely so the UI cannot forget to say so. */
export interface BookLevel {
  price: number;
  quantity: number;
  traderId: string;
}

export interface OrderBook {
  bestBid: BookLevel | null;
  bestAsk: BookLevel | null;
  indicative: true;
}

export interface IndicativeQuote {
  bid: number;
  ask: number;
  fairPrice: number;
  size: number;
  indicative: true;
}

export interface MarketResponse {
  market: MarketState;
  egsi: EgsiSnapshot | null;
  forecast: Forecast | null;
  orderbook: OrderBook | null;
  quote: IndicativeQuote | null;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  samples: number;
}

export interface HistoryPoint {
  score: number;
  blockNumber: number;
}

export interface PreparedTransaction {
  transactionJson: string;
  summary: Record<string, string | number | boolean>;
}

export interface Exposure {
  egsiNotional: number;
  ethBetaNotional: number;
  breached: boolean;
  suggestedOptionType: 'CALL' | 'PUT' | null;
}

export interface HedgeCandidate {
  quotationId: string;
  offeror: string;
  pricePerContract: number;
}

export interface HedgeEvaluation {
  exposure: Exposure;
  forecast?: Forecast;
  candidate?: HedgeCandidate;
  quotedNotional?: number;
  approved?: boolean;
  reason?: string | null;
  hedged: boolean;
  note?: string;
}

/** Carries the HTTP status so callers can distinguish a rejected
 * request (422 risk policy, 400 validation) from an outage (502/503),
 * which the UI reports very differently. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the GASX gateway. Is it running?', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const api = {
  getMarket: () => request<MarketResponse>('/api/v1/market'),

  /** EGSI as OHLC candles. `interval` is bucket width in seconds. */
  getCandles: (interval = 300, limit = 300) =>
    request<{ interval: number; count: number; candles: Candle[] }>(
      `/api/v1/candles?interval=${interval}&limit=${limit}`,
    ),

  /** Recent EGSI readings for the sparkline. Fails soft: a terminal
   * without a chart is still usable, so callers treat this as optional. */
  getHistory: (limit = 240) =>
    request<{ count: number; history: HistoryPoint[] }>(`/api/v1/history?limit=${limit}`),

  prepareOrder: (input: {
    trader: string;
    marginAccountId: string;
    isBid: boolean;
    price: number;
    quantity: number;
  }) => request<PreparedTransaction>('/api/v1/orders/prepare', { method: 'POST', body: JSON.stringify(input) }),

  prepareOpenAccount: (trader: string) =>
    request<PreparedTransaction>('/api/v1/account/prepare-open', {
      method: 'POST',
      body: JSON.stringify({ trader }),
    }),

  assessHedge: (input: { netContracts: number; egsiLevel: number }) =>
    request<{ exposure: Exposure }>('/api/v1/hedge/assess', { method: 'POST', body: JSON.stringify(input) }),

  evaluateHedge: (input: { netContracts: number; egsiLevel: number }) =>
    request<HedgeEvaluation>('/api/v1/hedge/evaluate', { method: 'POST', body: JSON.stringify(input) }),
};
