export type Side = 'LONG' | 'SHORT';

export interface EgsiSnapshot {
  /** unix ms */
  t: number;
  value: number;
}

export interface Forecast {
  market: string;
  expectedEgsi: number;
  /** model confidence, 0..1 */
  confidence: number;
  /** P(EGSI > 500) at expiry, 0..1 */
  pTail500: number;
  modelVersion: string;
  updatedAt: number;
}

export interface OrderBookLevel {
  price: number;
  qty: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface Position {
  id: string;
  side: Side;
  qty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  marginLocked: number;
  openedAt: number;
}

export interface HedgeCandidate {
  instrument: string;
  strike: number;
  expiry: string;
  premium: number;
  notional: number;
  delta: number;
  venue: string;
}

export type HedgeState =
  | 'idle'
  | 'evaluating'
  | 'proposed'
  | 'approved'
  | 'executed';

export interface HedgeStatus {
  state: HedgeState;
  /** exchange net ETH-correlated exposure, in USDC notional */
  exposure: number;
  threshold: number;
  candidate?: HedgeCandidate;
  /** Base mainnet transaction digest once executed */
  txDigest?: string;
  executedAt?: number;
  explanation: string;
}

export interface MarketMeta {
  market: string;
  /** unix ms of next settlement */
  expiry: number;
  multiplier: number;
  tickSize: number;
  /** seconds since the last on-chain oracle publish */
  oracleAgeSec: number;
  cycleLabel: string;
}

export interface MarketState {
  egsi: number;
  history: EgsiSnapshot[];
  forecast: Forecast;
  orderBook: OrderBook;
  positions: Position[];
  hedge: HedgeStatus;
  meta: MarketMeta;
}

export interface OrderRequest {
  side: Side;
  qty: number;
  price: number;
}

export interface OrderResult {
  ok: boolean;
  message: string;
  /** Sui transaction digest (live mode) */
  digest?: string;
}

export interface MarketService {
  isMock: boolean;
  start(): void;
  stop(): void;
  subscribe(fn: (state: MarketState) => void): () => void;
  submitOrder(order: OrderRequest): Promise<OrderResult>;
}
