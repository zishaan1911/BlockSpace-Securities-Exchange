import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { createRoot } from 'react-dom/client';
import '@mysten/dapp-kit/dist/index.css';
import './styles.css';
import App from './App';
import { DEFAULT_NETWORK, networkConfig } from './lib/sui';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <SuiClientProvider networks={networkConfig} defaultNetwork={DEFAULT_NETWORK}>
      <WalletProvider autoConnect>
        <App />
      </WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>,
);
