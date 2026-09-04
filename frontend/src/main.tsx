import React from 'react';
import ReactDOM from 'react-dom/client';
import { createDAppKit, DAppKitProvider } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import App from './App';

const configuredNetwork = import.meta.env.VITE_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const networks = configuredNetwork === 'mainnet' ? (['mainnet'] as const) : (['testnet'] as const);
const grpcUrls = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
} as const;

export const dAppKit = createDAppKit({
  networks,
  createClient(network: 'mainnet' | 'testnet') {
    return new SuiGrpcClient({ network, baseUrl: grpcUrls[network] });
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
