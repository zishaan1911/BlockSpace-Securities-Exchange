import React from 'react';
import ReactDOM from 'react-dom/client';
import { createDAppKit, DAppKitProvider } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiClientTypes } from '@mysten/sui/client';
import App from './App';

const configuredNetwork: 'mainnet' | 'testnet' =
  import.meta.env.VITE_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
// Deliberately not `as const`: dapp-kit-core's Networks type is a plain
// mutable Network[], and an `as const` readonly tuple is not assignable
// to it. Array covariance (unlike function-parameter contravariance
// below) makes a plain inferred array assignable here without issue.
const networks = [configuredNetwork];
const grpcUrls = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
} as const;

export const dAppKit = createDAppKit({
  networks,
  // SuiClientTypes.Network is `'mainnet' | 'testnet' | 'devnet' |
  // 'localnet' | (string & {})` -- deliberately open so callers get
  // autocomplete without losing the ability to pass an arbitrary custom
  // network name. A callback narrowed to just 'mainnet' | 'testnet' is
  // not assignable to a callback expecting the wider Network, since the
  // wider type could supply a value the narrower one cannot handle.
  // This app only ever configures 'mainnet' or 'testnet' (configuredNetwork
  // above), so the runtime behaviour is unaffected -- only the type
  // signature needs to accept the interface's real contract.
  createClient(network: SuiClientTypes.Network) {
    const url = grpcUrls[network as 'mainnet' | 'testnet'] ?? grpcUrls.testnet;
    return new SuiGrpcClient({ network, baseUrl: url });
  },
});

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </React.StrictMode>,
);
