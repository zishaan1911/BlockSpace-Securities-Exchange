/**
 * Environment-driven configuration for the Sui adapter. Copy .env.example
 * to .env and fill in real values (deployed package/object IDs come from
 * `sui client publish` + `gasx::market::create_market`/`gasx::oracle::create_oracle`'s
 * results — see contracts/gasx/README.md and setup.md).
 */

export interface SuiAdapterConfig {
  /** Sui fullnode JSON-RPC URL (e.g. https://fullnode.testnet.sui.io:443). */
  rpcUrl: string;
  /** 'testnet' | 'mainnet' | 'devnet' | 'localnet' — GASX's own futures
   * market may run on testnet even once Thetanuts hedging is live on
   * Base mainnet (ARCHITECTURE.md's Decisions §12: "Trading/settlement
   * chain: Sui — testnet acceptable for GASX"). */
  network: string;
  /** Deployed contracts/gasx package ID. */
  packageId: string;
  /** The EGSI-1H Market object ID (shared object). */
  marketId: string;
  /** The OracleState object ID this market references — read once and
   * cached rather than re-read from Market.oracle_id every call, since
   * it never changes after market creation. */
  oracleId: string;
  /** Fully-qualified Move type of the collateral coin (Market/MarginAccount's
   * generic `C`) — e.g. testnet USDC's `0x...::usdc::USDC`, or a local
   * test coin's type while developing. Every prepare* call needs this as
   * a type argument. */
  collateralCoinType: string;
}

function readEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[name] : undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} is required (see blockchain/sui/.env.example)`);
  }
  return value;
}

/** Loads config from GASX_SUI_-prefixed environment variables. Throws
 * immediately if anything required is missing, rather than failing
 * confusingly deep inside a later SDK call. */
export function loadConfigFromEnv(): SuiAdapterConfig {
  return {
    rpcUrl: requireEnv('GASX_SUI_RPC_URL'),
    network: readEnv('GASX_SUI_NETWORK') || 'testnet',
    packageId: requireEnv('GASX_SUI_PACKAGE_ID'),
    marketId: requireEnv('GASX_SUI_MARKET_ID'),
    oracleId: requireEnv('GASX_SUI_ORACLE_ID'),
    collateralCoinType: requireEnv('GASX_SUI_COLLATERAL_COIN_TYPE'),
  };
}
