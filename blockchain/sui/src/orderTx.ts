/**
 * Builds and serializes (never signs) transactions calling
 * contracts/gasx's margin.move/order.move entry functions — the "Prepare
 * order" half of ARCHITECTURE.md §9's Trade Flow: "FE->>API: Prepare
 * order (pre-trade risk checks); API-->>FE: Sui transaction payload;
 * U->>FE: [wallet] Sign + execute on-chain." Pre-trade risk checks
 * themselves live in api/'s risk policy module, not here — this module's
 * only job is turning already-validated parameters into a signable
 * transaction.
 *
 * Every prepare* function is network-touching (SuiGrpcClient needs to
 * resolve shared objects' current versions to serialize a valid
 * transaction), so none of this is a pure function the way
 * marketState.ts's parsers are — the buildXCallArgs helpers below
 * separate out the one part that *is* pure (which Move function, which
 * arguments) so at least that shape is unit-tested without a live
 * connection. NOT exercised end-to-end against a live Sui endpoint from
 * Claude's sandbox; see README.md.
 */
import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiAdapterConfig } from './config.js';
import type {
  CancelOrderParams,
  DepositParams,
  OpenAccountParams,
  PlaceOrderParams,
  PreparedTransaction,
} from './types.js';

async function serialize(tx: Transaction, sender: string, client: SuiGrpcClient): Promise<string> {
  tx.setSender(sender);
  // Without a client, toJSON() can't resolve tx.object(id)'s shared
  // object version or auto-select a gas coin — both needed to produce a
  // transaction actually ready for a wallet to sign, not just a
  // symbolic description of one.
  return tx.toJSON({ client });
}

export function preparePlaceOrder(
  client: SuiGrpcClient,
  config: SuiAdapterConfig,
  params: PlaceOrderParams,
): Promise<PreparedTransaction> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::order::place_order`,
    typeArguments: [config.collateralCoinType],
    arguments: [
      tx.object(config.marketId),
      tx.object(params.marginAccountId),
      tx.pure.bool(params.isBid),
      tx.pure.u64(params.price),
      tx.pure.u64(params.quantity),
    ],
  });
  return serialize(tx, params.trader, client).then((transactionJson) => ({
    transactionJson,
    summary: {
      action: 'place_order',
      side: params.isBid ? 'bid' : 'ask',
      price: params.price,
      quantity: params.quantity,
    },
  }));
}

export function prepareCancelOrder(
  client: SuiGrpcClient,
  config: SuiAdapterConfig,
  params: CancelOrderParams,
): Promise<PreparedTransaction> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::order::cancel_order`,
    typeArguments: [config.collateralCoinType],
    arguments: [tx.object(params.orderId), tx.object(params.marginAccountId)],
  });
  return serialize(tx, params.trader, client).then((transactionJson) => ({
    transactionJson,
    summary: { action: 'cancel_order', orderId: params.orderId },
  }));
}

export function prepareOpenAccount(
  client: SuiGrpcClient,
  config: SuiAdapterConfig,
  params: OpenAccountParams,
): Promise<PreparedTransaction> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::margin::open_account`,
    typeArguments: [config.collateralCoinType],
    arguments: [tx.object(config.marketId)],
  });
  return serialize(tx, params.trader, client).then((transactionJson) => ({
    transactionJson,
    summary: { action: 'open_account' },
  }));
}

export function prepareDeposit(
  client: SuiGrpcClient,
  config: SuiAdapterConfig,
  params: DepositParams,
): Promise<PreparedTransaction> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::margin::deposit`,
    typeArguments: [config.collateralCoinType],
    arguments: [tx.object(params.marginAccountId), tx.object(config.marketId), tx.object(params.coinObjectId)],
  });
  return serialize(tx, params.trader, client).then((transactionJson) => ({
    transactionJson,
    summary: { action: 'deposit', marginAccountId: params.marginAccountId, coinObjectId: params.coinObjectId },
  }));
}
