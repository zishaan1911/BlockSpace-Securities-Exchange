/**
 * Constructs a real, configured Sui client. Mysten Labs has deprecated
 * the JSON-RPC client (`SuiJsonRpcClient`, from `@mysten/sui/jsonRpc`) in
 * favor of `SuiGrpcClient`/`SuiGraphQLClient` as of the SDK version this
 * adapter is pinned to — verified by introspecting the installed
 * package's .d.ts directly, where every JSON-RPC export carries an
 * explicit `@deprecated` tag.
 *
 * This adapter deliberately still uses the JSON-RPC client for v1:
 * it's functionally complete (not removed, just deprecated), far more
 * widely documented than the newer gRPC-web path, and matches the
 * testnet JSON-RPC endpoint setup.md already has the user configure via
 * the Sui CLI (`sui client new-env --rpc https://fullnode.testnet.sui.io:443`).
 * Migrating to SuiGrpcClient is a reasonable follow-up once there's time
 * to verify gRPC-web works cleanly from a Node.js server context (it's
 * primarily documented for browser use) — not done here to keep this
 * iteration's scope and risk bounded.
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import type { SuiAdapterConfig } from './config.js';

export function createSuiClient(config: SuiAdapterConfig): SuiJsonRpcClient {
  return new SuiJsonRpcClient({
    url: config.rpcUrl,
    network: config.network,
  });
}
