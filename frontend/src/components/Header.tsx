import { ConnectButton } from '@mysten/dapp-kit';

interface HeaderProps {
  mode: 'mock' | 'live';
}

export function Header({ mode }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-brand">
        <span className="header-logo">GASX</span>
        <span className="header-tagline">Ethereum Gas Futures Exchange</span>
      </div>
      <div className="header-right">
        <span className={`mode-badge ${mode}`}>
          {mode === 'mock' ? 'SIMULATED FEED' : 'LIVE FEED'}
        </span>
        <ConnectButton connectText="Connect Wallet" />
      </div>
    </header>
  );
}
