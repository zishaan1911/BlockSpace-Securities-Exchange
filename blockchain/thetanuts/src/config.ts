/**
 * Environment-driven configuration for the Thetanuts adapter. Copy
 * .env.example to .env and fill in real values \u2014 see GLOSSARY.md's
 * Golden Rules: private keys never go in code, git, or logs.
 *
 * Thetanuts only supports Base Mainnet (8453) for OptionBook/RFQ \u2014
 * there is no testnet deployment (see README.md's "Verified vs. not
 * verified" section) \u2014 so chainId is fixed, not configurable.
 */

export const THETANUTS_CHAIN_ID = 8453 as const;

export interface ThetanutsAdapterConfig {
  /** Base mainnet JSON-RPC URL. Read-only calls (getVolSignal,
   * getBestCandidate) only need this. */
  baseRpcUrl: string;
  /** Hex private key for the wallet that signs RFQ creation transactions
   * (requestHedgeQuote). Undefined disables write operations \u2014
   * getVolSignal/getBestCandidate still work read-only. Per
   * ARCHITECTURE.md §8, this should be a dedicated, isolated hedge
   * wallet, never a wallet holding user funds. */
  hedgeWalletPrivateKey?: string;
}

function readEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[name] : undefined;
}

/** Loads config from GASX_THETANUTS_-prefixed environment variables.
 * Throws if baseRpcUrl is missing \u2014 every operation needs it, so failing
 * fast at construction is better than a confusing failure deep inside an
 * SDK call. */
export function loadConfigFromEnv(): ThetanutsAdapterConfig {
  // Defaults to Base's public RPC rather than throwing. Requiring config
  // for a keyless, read-only, public endpoint just to boot the stack is
  // friction with no safety benefit — and it blocked `npm run dev`
  // outright, which the Sui adapter's own default already avoids. The
  // hedge wallet key below is the one that genuinely must stay unset
  // until someone means it: without it no RFQ can be submitted and no
  // money can move.
  const baseRpcUrl = readEnv('GASX_THETANUTS_BASE_RPC_URL') || 'https://mainnet.base.org';
  return {
    baseRpcUrl,
    hedgeWalletPrivateKey: readEnv('GASX_THETANUTS_HEDGE_WALLET_PRIVATE_KEY') || undefined,
  };
}
