/**
 * Wallet + app providers.
 *
 * Uses @mysten/dapp-kit-react (the maintained successor), not
 * @mysten/dapp-kit — npm marks the latter deprecated because it only
 * supports Sui's deprecated JSON-RPC API. That is the same deprecation
 * wave that affects blockchain/sui's SuiJsonRpcClient; here there was a
 * maintained replacement available, so this uses it.
 *
 * Network is configurable so the same build can point at testnet, which
 * is where GASX's own market lives (ARCHITECTURE.md §12: "testnet
 * acceptable for GASX").
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createDAppKit } from '@mysten/dapp-kit-core';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import App from './App';

// No stylesheet import: dapp-kit-react's ConnectButton is a web
// component that carries its own styles internally, unlike the older
// @mysten/dapp-kit which shipped a separate CSS file.
import './styles.css';

const network = (import.meta.env.VITE_SUI_NETWORK as 'testnet' | 'mainnet') ?? 'testnet';

const dAppKit = createDAppKit({
  networks: ['testnet', 'mainnet'],
  defaultNetwork: network,
  createClient: (net) =>
    new SuiGrpcClient({ network: net, baseUrl: `https://fullnode.${net}.sui.io:443` }),
  // null disables the bundled Slush wallet entirely. Its initializer
  // fetches https://api.slush.app/api/wallet/metadata at boot, which
  // fails CORS from localhost and spams the console with errors for a
  // wallet nobody in the demo uses.
  slushWalletConfig: null,
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </React.StrictMode>,
);
