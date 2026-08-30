import type {
  MarketService,
  MarketState,
  OrderRequest,
  OrderResult,
} from './types';

const POLL_MS = 5_000;

/**
 * Live backend client. Talks only to stable domain endpoints
 * (ARCHITECTURE.md §2): the UI never knows how the backend is composed.
 */
export class ApiMarketService implements MarketService {
  readonly isMock = false;

  private listeners = new Set<(state: MarketState) => void>();
  private state: MarketState | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private ws?: WebSocket;

  constructor(
    private readonly baseUrl: string,
    private readonly wsUrl: string,
  ) {}

  start(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_MS);
    this.openSocket();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.ws?.close();
    this.ws = undefined;
  }

  subscribe(fn: (state: MarketState) => void): () => void {
    this.listeners.add(fn);
    if (this.state) fn(this.state);
    return () => this.listeners.delete(fn);
  }

  async submitOrder(order: OrderRequest): Promise<OrderResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
    if (!res.ok) {
      return { ok: false, message: `Order rejected (HTTP ${res.status}).` };
    }
    const body = (await res.json()) as { digest?: string };
    return { ok: true, message: 'Order accepted by the API.', digest: body.digest };
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/market-state`);
      if (!res.ok) return;
      this.state = (await res.json()) as MarketState;
      this.emit();
    } catch {
      // Backend down: keep last known state, stay silent.
    }
  }

  private openSocket(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onmessage = (ev: MessageEvent<string>) => {
        try {
          this.state = JSON.parse(ev.data) as MarketState;
          this.emit();
        } catch {
          // Ignore malformed frames.
        }
      };
      this.ws.onclose = () => {
        // Polling continues regardless; optionally reconnect after a beat.
        setTimeout(() => {
          if (this.timer) this.openSocket();
        }, 2_000);
      };
    } catch {
      // WS unavailable: polling still works.
    }
  }

  private emit(): void {
    if (!this.state) return;
    for (const fn of this.listeners) fn(this.state);
  }
}
