import {
  useCurrentNetwork,
  useDAppKit,
  useWalletConnection,
} from '@mysten/dapp-kit-react';
import { Brand } from './Brand';
import { useTheme } from '../theme';

// Section ids on the single, unified Markets page (App.tsx). These are no
// longer separate views to switch between -- clicking one just scrolls
// the already-rendered section into view.
export const MARKET_SECTIONS = [
  { id: 'section-overview', label: 'Overview' },
  { id: 'section-trade', label: 'Trade' },
  { id: 'section-hedge', label: 'Hedge' },
  { id: 'section-analytics', label: 'Analytics' },
] as const;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function networkLabel(network: string) {
  return network.replace(/^./, (character) => character.toUpperCase());
}

export function AppHeader({
  onMarkets,
  onConnect,
  onHome,
}: {
  /** Ensures the single Markets page is showing, then scrolls to it.
   * Called both by "Markets" itself and, with a target section, by
   * each of the four in-page shortcuts. */
  onMarkets: (sectionId?: string) => void;
  onConnect: () => void;
  onHome: () => void;
}) {
  const network = useCurrentNetwork();
  const connection = useWalletConnection();
  const dAppKit = useDAppKit();
  const { theme, toggle } = useTheme();

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
        {/* Explicit Home entry -- previously only reachable by clicking the
            brand mark, which is a common but not especially discoverable
            pattern. Kept the brand-click behaviour too; this just adds a
            labelled way to do the same thing. */}
        <button onClick={onHome}>Home</button>

        {/* All four used to be separate top-level views, each showing only
            its own page -- clicking "Trade" hid the market overview
            entirely, and there was no single place that showed
            everything at once. They now all render together on one
            Markets page (App.tsx); these buttons just jump to a section
            of it rather than switching what is rendered. */}
        {MARKET_SECTIONS.map((section) => (
          <button key={section.id} onClick={() => onMarkets(section.id)}>
            {section.label}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        <button
          className="theme-toggle"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggle}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

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
