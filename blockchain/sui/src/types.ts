/**
 * GASX's own view of Sui — mirrors blockchain/thetanuts's "adapter, not a
 * leaky wrapper" convention. Everything here is shaped for GASX's
 * callers (api/'s routes); @mysten/sui's own request/response types
 * don't cross this boundary.
 */

/** Live state of the EGSI-1H market — GET /api/v1/market's Sui half
 * (ARCHITECTURE.md §9's "Get market state" -> "EGSI + orderbook +
 * forecast"; orderbook/forecast come from elsewhere, this is the
 * on-chain config + oracle half). */
export interface MarketState {
  marketId: string;
  underlying: string;
  expiryMs: number;
  contractMultiplier: number;
  tickSize: number;
  marginRatioBps: number;
  paused: boolean;
  settled: boolean;
  /** Only meaningful when settled is true. */
  settlementPrice: number | null;
  oracle: OracleState;
}

export interface OracleState {
  oracleId: string;
  price: number;
  hasPrice: boolean;
  lastUpdateMs: number;
  maxStalenessMs: number;
  /** Computed client-side from lastUpdateMs/maxStalenessMs against the
   * time the read happened — not read from chain (the Move contract's
   * own is_fresh() takes a live Clock; this is an approximation for
   * display, not something settlement/margin logic should ever trust). */
  isFreshApprox: boolean;
}

/** A transaction built and serialized server-side, ready for a wallet to
 * deserialize (`Transaction.from(json)`) and sign — this adapter never
 * signs anything itself. `summary` restates the key parameters in plain
 * fields so a caller (or the person, via the frontend) can sanity-check
 * what they're about to sign without deserializing the transaction. */
export interface PreparedTransaction {
  transactionJson: string;
  summary: Record<string, string | number | boolean>;
}

export interface OpenAccountParams {
  trader: string;
}

export interface DepositParams {
  trader: string;
  marginAccountId: string;
  /** The Coin<C> object to deposit whole — Sui coin merging/splitting to
   * hit an exact amount is the frontend/wallet's job, not this adapter's. */
  coinObjectId: string;
}

export interface PlaceOrderParams {
  trader: string;
  marginAccountId: string;
  isBid: boolean;
  price: number;
  quantity: number;
}

export interface CancelOrderParams {
  trader: string;
  orderId: string;
  marginAccountId: string;
}

/** GASX's narrow view of Sui. Implemented by SuiChainAdapter (client.ts
 * wraps the real SDK); tests use synthetic MoveStruct fixtures for the
 * pure parsing logic and never touch a live network. */
export interface ChainAdapter {
  getMarketState(): Promise<MarketState>;
  prepareOpenAccount(params: OpenAccountParams): Promise<PreparedTransaction>;
  prepareDeposit(params: DepositParams): Promise<PreparedTransaction>;
  preparePlaceOrder(params: PlaceOrderParams): Promise<PreparedTransaction>;
  prepareCancelOrder(params: CancelOrderParams): Promise<PreparedTransaction>;
}
