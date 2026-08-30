import { createNetworkConfig } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import type { OrderRequest } from './types';

const TESTNET_URL = 'https://fullnode.testnet.sui.io:443';
const MAINNET_URL = 'https://fullnode.mainnet.sui.io:443';

export const { networkConfig } = createNetworkConfig({
  testnet: { url: TESTNET_URL, network: 'testnet' },
  mainnet: { url: MAINNET_URL, network: 'mainnet' },
});

export const DEFAULT_NETWORK: 'testnet' | 'mainnet' =
  import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

export const NETWORK_CHAIN: 'sui:mainnet' | 'sui:testnet' =
  DEFAULT_NETWORK === 'mainnet' ? 'sui:mainnet' : 'sui:testnet';

export const GASX_PACKAGE_ID = import.meta.env.VITE_GASX_PACKAGE_ID as
  | string
  | undefined;

export const USDC_COIN_TYPE = import.meta.env.VITE_USDC_COIN_TYPE as
  | string
  | undefined;

/**
 * Builds the on-chain order transaction for contracts/gasx.
 *
 * Returns null until a package is deployed (VITE_GASX_PACKAGE_ID) —
 * until then the UI falls back to the simulated flow.
 *
 * TODO(Phase 1 deployment): select the signer's USDC coin and pass it as
 * the payment argument; wire `order::place_limit_order`'s exact signature
 * from contracts/gasx/sources/order.move.
 */
export function buildPlaceOrderTx(order: OrderRequest): Transaction | null {
  if (!GASX_PACKAGE_ID || !USDC_COIN_TYPE) return null;

  const tx = new Transaction();
  tx.setSender(''); // filled by the wallet on sign
  tx.moveCall({
    target: `${GASX_PACKAGE_ID}::order::place_limit_order`,
    typeArguments: [USDC_COIN_TYPE],
    arguments: [
      tx.object('0x0'), // TODO: market object id (or shared-object reference)
      tx.pure.u64(order.qty),
      tx.pure.u64(order.price),
      tx.pure.bool(order.side === 'LONG'),
      tx.object('0x0'), // TODO: signer's USDC coin
    ],
  });
  return tx;
}
