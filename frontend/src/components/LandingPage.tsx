function EthereumCrystal() {
  return (
    <div className="crystal-stage" aria-hidden="true">
      <div className="orbit orbit-a" />
      <div className="orbit orbit-b" />
      <img className="eth-crystal" src="/logo.png" alt="" />
      <div className="float-card float-predict"><b>✦ Predict</b><span>AI-powered forecasts</span></div>
      <div className="float-card float-trade"><b>↗ Trade</b><span>Gas futures on Sui</span></div>
      <div className="float-card float-hedge"><b>◇ Hedge</b><span>Options on Thetanuts</span></div>
    </div>
  );
}

export function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing-shell">
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

      <footer className="app-footer">
        <span>© 2026 GASX · AI-native Ethereum gas futures</span>
        <span>Trading on Sui · Hedging on Thetanuts / Base</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Charts by TradingView
        </a>
      </footer>
    </div>
  );
}
