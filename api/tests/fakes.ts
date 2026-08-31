import type {
  CancelOrderParams,
  ChainAdapter,
  DepositParams,
  MarketState,
  OpenAccountParams,
  PlaceOrderParams,
  PreparedTransaction,
} from '@gasx/sui-adapter';
import type { HedgeCandidate, HedgeProvider, HedgeRequest, HedgeRequestParams, VolSignal } from '@gasx/thetanuts-adapter';
import type { AiClient, EgsiSnapshotDto, ForecastDto, RunCycleInput } from '../src/aiClient.js';

export function makeMarketState(overrides: Partial<MarketState> = {}): MarketState {
  return {
    marketId: '0xmarket',
    underlying: 'EGSI-1H',
    expiryMs: 1_700_000_000_000,
    contractMultiplier: 10,
    tickSize: 10,
    marginRatioBps: 1000,
    paused: false,
    settled: false,
    settlementPrice: null,
    oracle: {
      oracleId: '0xoracle',
      price: 441,
      hasPrice: true,
      lastUpdateMs: 1_700_000_000_000,
      maxStalenessMs: 60_000,
      isFreshApprox: true,
    },
    ...overrides,
  };
}

export class FakeChainAdapter implements ChainAdapter {
  marketState: MarketState = makeMarketState();
  getMarketStateError: Error | null = null;
  lastPreparePlaceOrderParams: PlaceOrderParams | null = null;
  lastPrepareCancelOrderParams: CancelOrderParams | null = null;
  lastPrepareOpenAccountParams: OpenAccountParams | null = null;
  lastPrepareDepositParams: DepositParams | null = null;

  async getMarketState(): Promise<MarketState> {
    if (this.getMarketStateError) throw this.getMarketStateError;
    return this.marketState;
  }

  async prepareOpenAccount(params: OpenAccountParams): Promise<PreparedTransaction> {
    this.lastPrepareOpenAccountParams = params;
    return { transactionJson: '{"fake":"open-account"}', summary: { action: 'open_account' } };
  }

  async prepareDeposit(params: DepositParams): Promise<PreparedTransaction> {
    this.lastPrepareDepositParams = params;
    return { transactionJson: '{"fake":"deposit"}', summary: { action: 'deposit' } };
  }

  async preparePlaceOrder(params: PlaceOrderParams): Promise<PreparedTransaction> {
    this.lastPreparePlaceOrderParams = params;
    return {
      transactionJson: '{"fake":"place-order"}',
      summary: { action: 'place_order', side: params.isBid ? 'bid' : 'ask', price: params.price, quantity: params.quantity },
    };
  }

  async prepareCancelOrder(params: CancelOrderParams): Promise<PreparedTransaction> {
    this.lastPrepareCancelOrderParams = params;
    return { transactionJson: '{"fake":"cancel-order"}', summary: { action: 'cancel_order', orderId: params.orderId } };
  }
}

export function makeVolSignal(overrides: Partial<VolSignal> = {}): VolSignal {
  return {
    underlying: 'ETH',
    underlyingPrice: 2000,
    atmIv: 0.65,
    skew25Delta: 0.05,
    expiry: 1_700_600_000,
    sampleSize: 12,
    computedAt: Date.now(),
    ...overrides,
  };
}

export class FakeHedgeProvider implements HedgeProvider {
  volSignal: VolSignal = makeVolSignal();
  getVolSignalError: Error | null = null;

  async getVolSignal(): Promise<VolSignal> {
    if (this.getVolSignalError) throw this.getVolSignalError;
    return this.volSignal;
  }

  async requestHedgeQuote(_params: HedgeRequestParams): Promise<HedgeRequest> {
    throw new Error('not implemented in FakeHedgeProvider');
  }

  async getBestCandidate(_request: HedgeRequest): Promise<HedgeCandidate | null> {
    return null;
  }
}

export class FakeAiClient implements AiClient {
  currentEgsi: EgsiSnapshotDto | null = null;
  forecast: ForecastDto | null = null;
  runCycleError: Error | null = null;
  lastRunCycleInput: RunCycleInput | undefined;
  runCycleResult: EgsiSnapshotDto = makeEgsiSnapshot();

  async getCurrentEgsi(): Promise<EgsiSnapshotDto | null> {
    return this.currentEgsi;
  }

  async getForecast(): Promise<ForecastDto | null> {
    return this.forecast;
  }

  async runCycle(input?: RunCycleInput): Promise<EgsiSnapshotDto> {
    if (this.runCycleError) throw this.runCycleError;
    this.lastRunCycleInput = input;
    return this.runCycleResult;
  }
}

export function makeEgsiSnapshot(overrides: Partial<EgsiSnapshotDto> = {}): EgsiSnapshotDto {
  return {
    market: 'EGSI-1H',
    score: 441,
    components: {
      base_fee: 0.4,
      utilization: 0.5,
      mempool_pressure: 0.3,
      fee_momentum: 0.2,
      gas_volatility: 0.1,
      dex_activity: 0.3,
      thetanuts_iv: null,
    },
    block_number: 12345,
    timestamp: 1_700_000_000,
    ...overrides,
  };
}
