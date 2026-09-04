import { Brand } from './Brand';

function EthereumCrystal() {
  return (
    <div className="crystal-stage" aria-hidden="true">
      <div className="orbit orbit-a" />
      <div className="orbit orbit-b" />
      <svg className="eth-crystal" viewBox="0 0 220 280">
        <defs>
          <linearGradient id="ethTop" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#def6ff"/><stop offset="1" stopColor="#73a7ff"/></linearGradient>
          <linearGradient id="ethSide" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7b9cff"/><stop offset="1" stopColor="#2649a8"/></linearGradient>
          <linearGradient id="ethLow" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#4d7eff"/><stop offset="1" stopColor="#1c2e76"/></linearGradient>
        </defs>
        <polygon points="110,10 28,142 110,102" fill="url(#ethTop)"/>
        <polygon points="110,10 192,142 110,102" fill="url(#ethSide)"/>
        <polygon points="28,142 110,190 110,102" fill="#5d89f6"/>
        <polygon points="192,142 110,190 110,102" fill="#24458f"/>
        <polygon points="110,270 28,158 110,206" fill="url(#ethLow)"/>
        <polygon points="110,270 192,158 110,206" fill="#172d69"/>
      </svg>
      <div className="float-card float-predict"><b>✦ Predict</b><span>AI-powered forecasts</span></div>
      <div className="float-card float-trade"><b>↗ Trade</b><span>Gas futures on Sui</span></div>
      <div className="float-card float-hedge"><b>◇ Hedge</b><span>Options on Thetanuts</span></div>
    </div>
  );
}

export function LandingPage({ onLaunch, onConnect }: { onLaunch: () => void; onConnect: () => void }) {
  return (
    <div className="landing-shell">
      <header className="landing-header">
        <Brand />
        <nav>
          <button onClick={onLaunch}>Markets</button>
          <a href="#how-it-works">How it works</a>
          <a href="#ai-agent">AI Agent</a>
          <a href="https://github.com/" target="_blank" rel="noreferrer">Docs</a>
        </nav>
        <button className="button button-outline" onClick={onConnect}>Connect Wallet</button>
      </header>

      <main className="hero">
        <section className="hero-copy">
          <div className="eyebrow"><span /> AI-native gas derivatives</div>
          <h1>Trade and hedge<br />Ethereum gas<br /><em>with AI.</em></h1>
          <p>GASX turns Ethereum blockspace stress into a tradeable 1-hour futures market on Sui, with AI-driven risk hedging through Thetanuts.</p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={onLaunch}>Launch App <span>→</span></button>
            <a className="button button-ghost" href="#how-it-works">Learn More</a>
          </div>
          <div className="hero-proof">
            <span><i className="status-dot" /> Live Ethereum data</span>
            <span>EGSI 0–1000</span>
            <span>Sui + Base</span>
          </div>
        </section>
        <EthereumCrystal />
      </main>

      <section className="feature-row" id="how-it-works">
        <article><div className="feature-icon">✦</div><h3>AI-Powered</h3><p>Real-time EGSI and confidence-scored congestion forecasts.</p></article>
        <article><div className="feature-icon">↗</div><h3>Trade on Sui</h3><p>Low-cost EGSI-1H futures with USDC collateral and settlement.</p></article>
        <article id="ai-agent"><div className="feature-icon">◇</div><h3>Hedge on Thetanuts</h3><p>Live options pricing and policy-gated autonomous hedging on Base.</p></article>
        <article><div className="feature-icon">⌁</div><h3>Hard Risk Controls</h3><p>The AI can request actions, but it cannot bypass configured limits.</p></article>
      </section>
    </div>
  );
}
