/**
 * Constructs a real, configured ThetanutsClient (the only place in this
 * module that touches ethers directly) \u2014 hedgeProvider.ts wraps this in
 * the GASX-facing HedgeProvider interface; nothing outside this file and
 * hedgeProvider.ts should need to import the SDK.
 */
import { ethers } from 'ethers';
import { ThetanutsClient } from '@thetanuts-finance/thetanuts-client';
import { THETANUTS_CHAIN_ID, type ThetanutsAdapterConfig } from './config.js';

export function createThetanutsClient(config: ThetanutsAdapterConfig): ThetanutsClient {
  const provider = new ethers.JsonRpcProvider(config.baseRpcUrl);
  const signer = config.hedgeWalletPrivateKey
    ? new ethers.Wallet(config.hedgeWalletPrivateKey, provider)
    : undefined;

  return new ThetanutsClient({
    chainId: THETANUTS_CHAIN_ID,
    provider,
    signer,
  });
}
