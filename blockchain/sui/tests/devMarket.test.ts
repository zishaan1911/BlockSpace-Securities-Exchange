import { describe, expect, it } from 'vitest';
import { DevMarketUnavailableError, SuiChainAdapter } from '../src/chainAdapter.js';
import { fetchDevMarketState } from '../src/devMarket.js';
import type { SuiAdapterConfig } from '../src/config.js';

function devConfig(): SuiAdapterConfig {
  return {
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    network: 'testnet',
    packageId: '',
    marketId: '',
    oracleId: '',
    collateralCoinType: '',
    devMarket: true,
  };
}

describe('dev market', () => {
  it('serves a synthetic market with sane EGSI-1H terms', () => {
    const state = fetchDevMarketState(devConfig());

    expect(state.devMode).toBe(true);
    expect(state.paused).toBe(false);
    expect(state.settled).toBe(false);
    expect(state.contractMultiplier).toBeGreaterThan(0);
    expect(state.tickSize).toBeGreaterThan(0);
    expect(state.oracle.hasPrice).toBe(false);
    expect(state.oracle.maxPrice).toBe(1000);

    const now = Date.now();
    expect(state.expiryMs).toBeGreaterThan(now);
    expect(state.expiryMs - now).toBeLessThanOrEqual(3_600_000);
  });

  it('preparing any transaction throws DevMarketUnavailableError', () => {
    const adapter = new SuiChainAdapter(devConfig());
    const params = {
      trader: '0x1',
      marginAccountId: '0x2',
      isBid: true,
      price: 500,
      quantity: 5,
    };
    expect(() => adapter.preparePlaceOrder(params)).toThrow(DevMarketUnavailableError);
    expect(() => adapter.prepareOpenAccount({ trader: '0x1' })).toThrow(
      DevMarketUnavailableError,
    );
  });
});
