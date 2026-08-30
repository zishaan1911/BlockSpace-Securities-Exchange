import { useMarketState } from './hooks/useMarketState';
import { EGSIChart } from './components/EGSIChart';
import { EGSIGauge } from './components/EGSIGauge';
import { ForecastCard } from './components/ForecastCard';
import { Header } from './components/Header';
import { HedgeView } from './components/HedgeView';
import { MarketMetaCard } from './components/MarketMeta';
import { OrderBook } from './components/OrderBook';
import { OrderForm } from './components/OrderForm';
import { PositionsTable } from './components/PositionsTable';

export default function App() {
  const { state, mode, submitting, submitOrder } = useMarketState();

  if (!state) {
    return (
      <div className="boot">
        <Header mode="mock" />
        <div className="boot-note">Connecting to market feed…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header mode={mode} />
      <main className="grid">
        <section className="col-left">
          <div className="card">
            <h2>Ethereum Gas Stress Index</h2>
            <EGSIGauge value={state.egsi} />
          </div>
          <MarketMetaCard meta={state.meta} />
        </section>

        <section className="col-mid">
          <div className="card chart-card">
            <h2>EGSI — last 3 minutes + forecast</h2>
            <EGSIChart history={state.history} forecast={state.forecast} />
          </div>
          <ForecastCard forecast={state.forecast} current={state.egsi} />
        </section>

        <section className="col-right">
          <OrderBook book={state.orderBook} />
          <OrderForm
            state={state}
            mode={mode}
            submitting={submitting}
            onSubmit={submitOrder}
          />
        </section>

        <section className="col-bottom-a">
          <PositionsTable positions={state.positions} />
        </section>
        <section className="col-bottom-b">
          <HedgeView hedge={state.hedge} />
        </section>
      </main>
    </div>
  );
}
