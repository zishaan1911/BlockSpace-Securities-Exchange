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
  /** Deployed contracts/gasx package ID. Empty in dev-market mode. */
  packageId: string;
  /** The EGSI-1H Market object ID (shared object). Empty in dev-market mode. */
  marketId: string;
  /** The OracleState object ID this market references — read once and
   * cached rather than re-read from Market.oracle_id every call, since
   * it never changes after market creation. Empty in dev-market mode. */
  oracleId: string;
  /** Fully-qualified Move type of the collateral coin (Market/MarginAccount's
   * generic `C`) — e.g. testnet USDC's `0x...::usdc::USDC`, or a local
   * test coin's type while developing. Every prepare* call needs this as
   * a type argument. Empty in dev-market mode. */
  collateralCoinType: string;
  /** True when the contracts are not deployed and the adapter serves a
   * synthetic market instead of reading Sui. See devMarket.ts. */
  devMarket: boolean;
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

/**
 * GASX_SUI_DEV_MARKET: 'true' forces the synthetic dev market, 'false'
 * requires every deployed-contract ID to be set (fail fast), and unset
 * (the default) auto-selects: any missing ID means dev-market mode.
 *
 * Dev mode exists so the whole stack (ai → api → frontend) runs before
 * the Move package is published — see devMarket.ts and README.md.
 */
export function loadConfigFromEnv(): SuiAdapterConfig {
  const rpcUrl =
    readEnv('GASX_SUI_RPC_URL') || 'https://fullnode.testnet.sui.io:443';
  const network = readEnv('GASX_SUI_NETWORK') || 'testnet';

  const packageId = readEnv('GASX_SUI_PACKAGE_ID') || '';
  const marketId = readEnv('GASX_SUI_MARKET_ID') || '';
  const oracleId = readEnv('GASX_SUI_ORACLE_ID') || '';
  const collateralCoinType = readEnv('GASX_SUI_COLLATERAL_COIN_TYPE') || '';

  const idsMissing = !packageId || !marketId || !oracleId || !collateralCoinType;
  const forced = readEnv('GASX_SUI_DEV_MARKET');
  const devMarket = forced === 'true' ? true : forced === 'false' ? false : idsMissing;

  if (!devMarket && idsMissing) {
    throw new Error(
      'GASX_SUI_PACKAGE_ID, GASX_SUI_MARKET_ID, GASX_SUI_ORACLE_ID and ' +
        'GASX_SUI_COLLATERAL_COIN_TYPE are all required unless ' +
        'GASX_SUI_DEV_MARKET is set (see blockchain/sui/.env.example)',
    );
  }

  return {
    rpcUrl,
    network,
    packageId,
    marketId,
    oracleId,
    collateralCoinType,
    devMarket,
  };
}
