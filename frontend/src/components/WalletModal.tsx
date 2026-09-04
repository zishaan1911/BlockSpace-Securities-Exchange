import {
  useDAppKit,
  useWalletConnection,
  useWallets,
} from '@mysten/dapp-kit-react';
import { useEffect, useState, type MouseEvent } from 'react';

export function WalletModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const wallets = useWallets();
  const connection = useWalletConnection();
  const dAppKit = useDAppKit();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (connection.status === 'connected' && open) {
      onClose();
    }
  }, [connection.status, open, onClose]);

  useEffect(() => {
    if (!open) {
      setBusy(null);
      setError('');
    }
  }, [open]);

  if (!open) return null;

  async function connect(wallet: (typeof wallets)[number]) {
    setBusy(wallet.name);
    setError('');

    try {
      const result = await dAppKit.connectWallet({ wallet });

      if (!result.accounts.length) {
        throw new Error('The wallet connected but did not expose a Sui account.');
      }

      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect wallet';

      if (message.toLowerCase().includes('invalid character')) {
        setError(
          'The previous web-wallet session was invalid. This build disables the web redirect. Refresh the page and connect through an installed Sui browser-wallet extension.',
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className="wallet-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Connect your wallet"
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="modal-icon">⌁</div>
        <h2>Connect Your Wallet</h2>
        <p>Choose an installed Sui-compatible browser wallet to connect to GASX.</p>

        <div className="wallet-grid">
          {wallets.length ? (
            wallets.map((wallet, index) => (
              <button
                key={`${wallet.name}-${index}`}
                className="wallet-option"
                onClick={() => void connect(wallet)}
                disabled={busy !== null}
              >
                <span className="wallet-logo-wrap">
                  {wallet.icon ? (
                    <img src={wallet.icon} alt="" />
                  ) : (
                    <span>{wallet.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </span>

                <strong>{wallet.name}</strong>
                <small>{busy === wallet.name ? 'Connecting…' : 'Browser wallet'}</small>
              </button>
            ))
          ) : (
            <div className="wallet-empty">
              <b>No Sui browser wallet detected.</b>
              <span>
                Installing the Sui CLI in WSL/Terminal does not install a browser wallet and the
                website cannot read your CLI keystore. Install a Sui Wallet Standard extension such
                as Slush or Suiet, unlock it, then refresh this page.
              </span>
            </div>
          )}
        </div>

        {error && <div className="inline-error">{error}</div>}

        <div className="wallet-help">
          <b>Using the Sui CLI?</b>
          <span>
            Keep it for deploying the GASX Move package and managing testnet from the terminal. Use
            a browser wallet for website signing.
          </span>
        </div>

        <div className="wallet-legal">
          GASX never receives your private key. Transactions are approved inside your wallet.
        </div>
      </div>
    </div>
  );
}
