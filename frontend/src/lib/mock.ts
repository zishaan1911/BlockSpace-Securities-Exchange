import type {
  EgsiSnapshot,
  Forecast,
  HedgeCandidate,
  HedgeState,
  MarketMeta,
  MarketService,
  MarketState,
  OrderBook,
  OrderRequest,
  OrderResult,
  Position,
} from './types';

const CYCLE_MS = 60_000; // accelerated "1 hour" for demo purposes
const STEP_MS = 2_500;
const MULTIPLIER = 1; // USDC per index point per contract
const HEDGE_THRESHOLD = 400; // USDC notional of net long exposure

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

export class MockMarketService implements MarketService {
  readonly isMock = true;

  private egsi = 450;
  private trend = 6; // drift per step; regime-switches between calm/rising/spiky
  private history: EgsiSnapshot[] = [];
  private positions: Position[] = [];
  private hedgeState: HedgeState = 'idle';
  private hedgeStepCount = 0;
  private hedgeCandidate?: HedgeCandidate;
  private hedgeDigest?: string;
  private hedgeNote = 'Waiting for positions to create ETH-correlated exposure.';
  private cycleStart = Date.now();
  private lastPublish = Date.now();
  private timer?: ReturnType<typeof setInterval>;
  private listeners = new Set<(state: MarketState) => void>();

  constructor() {
    const now = Date.now();
    let v = 430;
    for (let i = 0; i < 60; i++) {
      v = clamp(v + (Math.random() - 0.5) * 14, 300, 600);
      this.history.push({ t: now - (60 - i) * STEP_MS, value: round1(v) });
    }
    this.egsi = round1(v);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), STEP_MS);
    this.emit();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  subscribe(fn: (state: MarketState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async submitOrder(order: OrderRequest): Promise<OrderResult> {
    const position: Position = {
      id: `pos-${Date.now().toString(36)}`,
      side: order.side,
      qty: order.qty,
      entryPrice: order.price,
      markPrice: this.egsi,
      unrealizedPnl: 0,
      marginLocked: round2(order.price * order.qty * MULTIPLIER),
      openedAt: Date.now(),
    };
    this.positions.push(position);
    if (this.hedgeState === 'idle') {
      this.hedgeState = 'evaluating';
      this.hedgeStepCount = 0;
      this.hedgeNote = 'Risk engine noticed the new position added ETH-correlated exposure.';
    }
    this.emit();
    return {
      ok: true,
      message: `Simulated fill: ${order.side} ${order.qty} contracts @ ${order.price} (mock mode).`,
    };
  }

  private emit(): void {
    const state = this.buildState();
    for (const fn of this.listeners) fn(state);
  }

  private buildState(): MarketState {
    const forecast = this.buildForecast();
    return {
      egsi: this.egsi,
      history: [...this.history],
      forecast,
      orderBook: this.buildOrderBook(),
      positions: this.positions.map((p) => ({ ...p })),
      hedge: {
        state: this.hedgeState,
        exposure: round2(this.longExposure()),
        threshold: HEDGE_THRESHOLD,
        candidate: this.hedgeCandidate,
        txDigest: this.hedgeDigest,
        executedAt: this.hedgeDigest ? this.lastPublish : undefined,
        explanation: this.hedgeNote,
      },
      meta: this.buildMeta(),
    };
  }

  private buildForecast(): Forecast {
    const expected = clamp(this.egsi + this.trend * 3, 0, 1000);
    const confidence = clamp(0.74 + Math.random() * 0.14, 0, 1);
    const pTail500 = clamp((expected - 500) / 140 + 0.12, 0.02, 0.95);
    return {
      market: 'EGSI-1H',
      expectedEgsi: round1(expected),
      confidence: round2(confidence),
      pTail500: round2(pTail500),
      modelVersion: 'egsi-v1',
      updatedAt: Date.now(),
    };
  }

  private buildOrderBook(): OrderBook {
    const spread = 2 + Math.round(Math.random() * 2);
    const bids = [];
    const asks = [];
    for (let i = 0; i < 5; i++) {
      bids.push({ price: this.egsi - spread / 2 - i, qty: 3 + Math.round(Math.random() * 9) });
      asks.push({ price: this.egsi + spread / 2 + i, qty: 3 + Math.round(Math.random() * 9) });
    }
    return { bids, asks };
  }

  private buildMeta(): MarketMeta {
    return {
      market: 'EGSI-1H',
      expiry: this.cycleStart + CYCLE_MS,
      multiplier: MULTIPLIER,
      tickSize: 1,
      oracleAgeSec: Math.max(0, Math.round((Date.now() - this.lastPublish) / 1000)),
      cycleLabel: '1h (accelerated to 60s in mock)',
    };
  }

  private longExposure(): number {
    return this.positions.reduce((sum, p) => {
      const signed = p.side === 'LONG' ? p.qty : -p.qty;
      return sum + signed * p.entryPrice * MULTIPLIER;
    }, 0);
  }

  private step(): void {
    // Regime switching: mostly drift, occasionally a congestion spike.
    if (Math.random() < 0.04) {
      this.trend = Math.random() < 0.6 ? 14 + Math.random() * 12 : -10 - Math.random() * 8;
    }
    const shock = (Math.random() - 0.5) * 10;
    this.egsi = clamp(round1(this.egsi + this.trend + shock), 50, 980);
    this.lastPublish = Date.now();
    this.history.push({ t: Date.now(), value: this.egsi });
    if (this.history.length > 90) this.history.shift();

    // Mark positions and expire the cycle.
    for (const p of this.positions) {
      p.markPrice = this.egsi;
      const signedQty = p.side === 'LONG' ? p.qty : -p.qty;
      p.unrealizedPnl = round2((this.egsi - p.entryPrice) * signedQty * MULTIPLIER);
    }
    if (Date.now() >= this.cycleStart + CYCLE_MS) {
      this.positions = [];
      this.hedgeState = 'idle';
      this.hedgeStepCount = 0;
      this.hedgeCandidate = undefined;
      this.hedgeDigest = undefined;
      this.hedgeNote = 'Cycle settled. Waiting for positions to create ETH-correlated exposure.';
      this.cycleStart = Date.now();
    }

    this.hedgeStep();
    this.emit();
  }

  private hedgeStep(): void {
    const exposure = this.longExposure();
    switch (this.hedgeState) {
      case 'evaluating': {
        this.hedgeStepCount += 1;
        if (this.hedgeStepCount >= 2) {
          this.hedgeCandidate = {
            instrument: 'ETH CALL',
            strike: 2600,
            expiry: '7D',
            premium: round2(12.4 + Math.random() * 4),
            notional: round2(Math.max(HEDGE_THRESHOLD, exposure * 0.5)),
            delta: round2(0.28 + Math.random() * 0.08),
            venue: 'Thetanuts OptionBook',
          };
          this.hedgeState = 'proposed';
          this.hedgeNote =
            'Pulled live Thetanuts MM pricing and RFQ quotes; best candidate proposed to the risk policy.';
        } else {
          this.hedgeNote = `ETH-beta exposure ${round2(exposure)} USDC breaches threshold ${HEDGE_THRESHOLD}. Requesting Thetanuts quotes…`;
        }
        break;
      }
      case 'proposed':
        this.hedgeStepCount += 1;
        if (this.hedgeStepCount >= 4) {
          this.hedgeState = 'approved';
          this.hedgeNote =
            'Hard risk policy approved: within position caps, slippage < 1%, confidence ≥ 70%, tiny isolated budget.';
        }
        break;
      case 'approved':
        this.hedgeStepCount += 1;
        if (this.hedgeStepCount >= 6) {
          this.hedgeState = 'executed';
          this.hedgeDigest = `0x${Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}`;
          this.hedgeNote =
            'Autonomous wallet executed the options trade on Thetanuts OptionBook, Base mainnet, live pricing. Exchange ETH-correlated risk reduced.';
        }
        break;
      default:
        break;
    }
  }
}
