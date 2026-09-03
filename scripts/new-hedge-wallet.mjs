#!/usr/bin/env node
/**
 * Generates a fresh, isolated wallet for autonomous Thetanuts hedging.
 *
 *   node scripts/new-hedge-wallet.mjs
 *
 * ARCHITECTURE.md §8 requires the hedge wallet be "isolated from user
 * funds; Base + [ETH, USDC] only". The tempting shortcut is to reuse an
 * existing wallet, which quietly breaks that: an agent authorised to
 * spend from a wallet can spend everything in it, and MAX_HEDGE_NOTIONAL
 * is enforced by this gateway rather than by the chain. A separate
 * wallet holding only what a hedge needs is what makes the cap real.
 *
 * This only generates a keypair. It never touches the network, never
 * writes the key anywhere, and cannot fund anything.
 */
// ethers is a dependency of blockchain/thetanuts, not of the repo root,
// so resolve it from there rather than requiring a root-level install.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'blockchain', 'thetanuts', 'package.json'));
const { Wallet } = require('ethers');

const wallet = Wallet.createRandom();

console.log(`
  A fresh hedge wallet
  ${'─'.repeat(66)}

  Address      ${wallet.address}
  Private key  ${wallet.privateKey}

  ${'─'.repeat(66)}

  1. Put the private key in blockchain/thetanuts/.env:

       GASX_THETANUTS_HEDGE_WALLET_PRIVATE_KEY=${wallet.privateKey}

  2. Fund the ADDRESS on Base mainnet:

       ETH   a few dollars covers RFQ gas; Base transactions are cheap.
       USDC  enough for one option premium. Find out what that is before
             sending anything -- POST /api/v1/hedge/evaluate returns
             quotedNotional, and requesting a quote costs only gas. No
             market maker is paid unless a quote is settled, and this
             build never settles.

  3. Keep GASX_API_MAX_HEDGE_NOTIONAL at or below what you funded.

  Notes worth taking seriously:

  * This key is printed once and stored nowhere. Copy it now.
  * .env is gitignored. Keep it that way.
  * Fund only what a hedge needs. This wallet is handed to an automated
    process; the cap that protects it lives in this gateway's config,
    not on-chain, so the balance is the real backstop.
  * Thetanuts has no testnet. Base mainnet is the only option, which is
    why this is the one part of GASX that spends real money.
`);
