import {
  useCurrentNetwork,
  useDAppKit,
  useWalletConnection,
} from '@mysten/dapp-kit-react';
import { Brand } from './Brand';

export type AppTab = 'market' | 'trade' | 'hedge' | 'analytics';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function networkLabel(network: string) {
  return network.replace(/^./, (character) => character.toUpperCase());
}

export function AppHeader({
  active,
  onTab,
  onConnect,
  onHome,
}: {
  active: AppTab;
  onTab: (tab: AppTab) => void;
  onConnect: () => void;
  onHome: () => void;
}) {
  const network = useCurrentNetwork();
  const connection = useWalletConnection();
  const dAppKit = useDAppKit();

  const walletConnected = connection.status === 'connected' && connection.account !== null;
  const walletBusy = connection.status === 'connecting' || connection.status === 'reconnecting';

  const statusText = walletConnected
    ? 'wallet connected'
    : walletBusy
      ? 'connecting wallet'
      : 'configured';

  async function disconnect() {
    try {
      await dAppKit.disconnectWallet();
    } catch (error) {
      console.error('Wallet disconnect failed', error);
    }
  }

  return (
    <header className="app-header">
      <button className="brand-button" onClick={onHome}>
        <Brand />
      </button>

      <nav className="app-nav">
        {(['market', 'trade', 'hedge', 'analytics'] as AppTab[]).map((tab) => (
          <button
            key={tab}
            className={active === tab ? 'active' : ''}
            onClick={() => onTab(tab)}
          >
            {tab[0]!.toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <div
          className={`network-pill ${walletConnected ? 'wallet-connected' : 'wallet-disconnected'}`}
          title={`Selected Sui network: ${network}. ${walletConnected ? 'A wallet is connected.' : 'No browser wallet is connected.'}`}
        >
          <i />
          <span>Sui {networkLabel(String(network))}</span>
          <small className="network-state">{statusText}</small>
        </div>

        {walletConnected && connection.account ? (
          <div className="account-pill">
            <span>◉</span>
            {shortAddress(connection.account.address)}
            <button title="Disconnect wallet" onClick={() => void disconnect()}>
              ×
            </button>
          </div>
        ) : (
          <button
            className="button button-small button-primary"
            onClick={onConnect}
            disabled={walletBusy}
          >
            {walletBusy ? 'Connecting…' : 'Connect Wallet'}
          </button>
        )}
      </div>
    </header>
  );
}
