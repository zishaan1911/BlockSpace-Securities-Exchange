/**
 * Constructs a real, configured Sui client.
 *
 * **gRPC, not JSON-RPC.** This was originally built on
 * `SuiJsonRpcClient` as a documented, deliberate choice: the API was
 * deprecated but functional, better documented than the alternatives,
 * and matched the endpoint `setup.md` already configured. That bet
 * expired. Sui has now switched JSON-RPC off on public fullnodes
 * entirely, and every read fails with:
 *
 *   Method not found. JSON-RPC on public fullnodes has been deprecated.
 *   Please migrate to gRPC or GraphQL endpoints.
 *
 * So this is the migration that comment anticipated. gRPC rather than
 * GraphQL because the frontend's dapp-kit already uses `SuiGrpcClient`,
 * which keeps one transport across the project instead of two.
 *
 * Note the URL differs from the JSON-RPC one: gRPC lives on
 * `fullnode.<network>.sui.io:443` without the `/` JSON-RPC path, and
 * `getFullnodeUrl` is not the right helper for it.
 */
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiAdapterConfig } from './config.js';

export function createSuiClient(config: SuiAdapterConfig): SuiGrpcClient {
  return new SuiGrpcClient({
    network: config.network,
    baseUrl: config.rpcUrl,
  });
}
