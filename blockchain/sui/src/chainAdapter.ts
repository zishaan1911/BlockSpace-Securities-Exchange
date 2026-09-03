/**
 * SuiChainAdapter: the concrete ChainAdapter (types.ts) — wraps a real
 * SuiGrpcClient and exposes only GASX-shaped types. Composes
 * fetchMarketState (marketState.ts) and the prepare* functions
 * (orderTx.ts). In dev-market mode (config.devMarket, devMarket.ts) it
 * serves the synthetic market and refuses to prepare transactions,
 * because there is no on-chain market to sign for.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { createSuiClient } from './client.js';
import type { SuiAdapterConfig } from './config.js';
import { fetchDevMarketState } from './devMarket.js';
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

/** Thrown by prepare* in dev-market mode. The gateway maps it to a 503
 * with the same message so the UI can explain why orders are off. */
export class DevMarketUnavailableError extends Error {
  constructor() {
    super(
      'The gasx contracts are not deployed — running in dev-market mode. ' +
        'Orders need GASX_SUI_PACKAGE_ID/MARKET_ID/ORACLE_ID set ' +
        '(see blockchain/sui/.env.example and README.md).',
    );
    this.name = 'DevMarketUnavailableError';
  }
}

export class SuiChainAdapter implements ChainAdapter {
  private readonly client: SuiGrpcClient;
  private readonly config: SuiAdapterConfig;

  constructor(config: SuiAdapterConfig) {
    this.config = config;
    this.client = createSuiClient(config);
    if (config.devMarket) {
      console.warn(
        '[gasx/sui-adapter] dev-market mode: serving a synthetic market; ' +
          'no transactions can be prepared. Set GASX_SUI_DEV_MARKET=false once deployed.',
      );
    }
  }

  getMarketState(): Promise<MarketState> {
    return this.config.devMarket
      ? Promise.resolve(fetchDevMarketState(this.config))
      : fetchMarketState(this.client, this.config);
  }

  prepareOpenAccount(params: OpenAccountParams): Promise<PreparedTransaction> {
    if (this.config.devMarket) throw new DevMarketUnavailableError();
    return prepareOpenAccount(this.client, this.config, params);
  }

  prepareDeposit(params: DepositParams): Promise<PreparedTransaction> {
    if (this.config.devMarket) throw new DevMarketUnavailableError();
    return prepareDeposit(this.client, this.config, params);
  }

  preparePlaceOrder(params: PlaceOrderParams): Promise<PreparedTransaction> {
    if (this.config.devMarket) throw new DevMarketUnavailableError();
    return preparePlaceOrder(this.client, this.config, params);
  }

  prepareCancelOrder(params: CancelOrderParams): Promise<PreparedTransaction> {
    if (this.config.devMarket) throw new DevMarketUnavailableError();
    return prepareCancelOrder(this.client, this.config, params);
  }
}
