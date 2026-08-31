/**
 * SuiChainAdapter: the concrete ChainAdapter (types.ts) — wraps a real
 * SuiJsonRpcClient and exposes only GASX-shaped types. Composes
 * fetchMarketState (marketState.ts) and the prepare* functions
 * (orderTx.ts).
 */
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { createSuiClient } from './client.js';
import type { SuiAdapterConfig } from './config.js';
import { fetchMarketState } from './marketState.js';
import { prepareCancelOrder, prepareDeposit, prepareOpenAccount, preparePlaceOrder } from './orderTx.js';
import type {
  CancelOrderParams,
  ChainAdapter,
  DepositParams,
  MarketState,
  OpenAccountParams,
  PlaceOrderParams,
  PreparedTransaction,
} from './types.js';

export class SuiChainAdapter implements ChainAdapter {
  private readonly client: SuiJsonRpcClient;
  private readonly config: SuiAdapterConfig;

  constructor(config: SuiAdapterConfig) {
    this.config = config;
    this.client = createSuiClient(config);
  }

  getMarketState(): Promise<MarketState> {
    return fetchMarketState(this.client, this.config);
  }

  prepareOpenAccount(params: OpenAccountParams): Promise<PreparedTransaction> {
    return prepareOpenAccount(this.client, this.config, params);
  }

  prepareDeposit(params: DepositParams): Promise<PreparedTransaction> {
    return prepareDeposit(this.client, this.config, params);
  }

  preparePlaceOrder(params: PlaceOrderParams): Promise<PreparedTransaction> {
    return preparePlaceOrder(this.client, this.config, params);
  }

  prepareCancelOrder(params: CancelOrderParams): Promise<PreparedTransaction> {
    return prepareCancelOrder(this.client, this.config, params);
  }
}
