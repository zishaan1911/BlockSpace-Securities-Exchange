export type JsonObject = Record<string, unknown>;

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketSnapshot {
  raw: JsonObject;
  egsi: {
    score: number;
    components: Record<string, number>;
    timestamp?: number;
  };
  forecast: {
    expected: number;
    confidence: number;
    tailProbability: number;
    modelVersion: string;
    fallback: boolean;
  };
  market: {
    id: string;
    label: string;
    expiryMs?: number;
    tickSize?: number;
    contractMultiplier?: number;
    marginRate?: number;
    devMode: boolean;
    oracleFresh: boolean;
  };
  quote: {
    bid?: number;
    ask?: number;
    mid?: number;
  };
  orderbook: {
    asks: Array<{ price: number; size: number }>;
    bids: Array<{ price: number; size: number }>;
    indicative: boolean;
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rec(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function first(obj: JsonObject, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function num(obj: JsonObject, keys: string[], fallback = 0): number {
  const value = first(obj, keys);
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(obj: JsonObject, keys: string[], fallback = ''): string {
  const value = first(obj, keys);
  return typeof value === 'string' && value.length ? value : fallback;
}

function bool(obj: JsonObject, keys: string[], fallback = false): boolean {
  const value = first(obj, keys);
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return fallback;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message = isRecord(payload)
      ? str(payload, ['message', 'error', 'detail'], `${response.status} ${response.statusText}`)
      : `${response.status} ${response.statusText}`;

    const error = new Error(message) as Error & {
      status?: number;
      payload?: unknown;
    };

    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function normaliseLevels(value: unknown): Array<{ price: number; size: number }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (Array.isArray(item) && item.length >= 2) {
      const price = Number(item[0]);
      const size = Number(item[1]);

      return Number.isFinite(price) && Number.isFinite(size)
        ? [{ price, size }]
        : [];
    }

    const row = rec(item);
    const price = num(row, ['price', 'px'], Number.NaN);
    const size = num(row, ['size', 'qty', 'quantity'], Number.NaN);

    return Number.isFinite(price) && Number.isFinite(size)
      ? [{ price, size }]
      : [];
  });
}

export function normaliseMarket(payload: unknown): MarketSnapshot {
  const root = rec(payload);
  const egsi = rec(first(root, ['egsi', 'index', 'gas_stress']));
  const forecast = rec(first(root, ['forecast', 'ai_forecast']));
  const market = rec(first(root, ['market', 'instrument']));
  const quote = rec(first(root, ['quote', 'pricing']));
  const orderbook = rec(first(root, ['orderbook', 'book', 'depth']));
  const componentsRaw = rec(first(egsi, ['components', 'drivers', 'inputs']));

  const components: Record<string, number> = {};

  Object.entries(componentsRaw).forEach(([key, value]) => {
    const parsed = Number(
      isRecord(value)
        ? first(value, ['score', 'value', 'contribution'])
        : value,
    );

    if (Number.isFinite(parsed)) {
      components[key] = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
    }
  });

  const bid = num(quote, ['bid', 'best_bid'], Number.NaN);
  const ask = num(quote, ['ask', 'best_ask'], Number.NaN);
  const rawMid = num(quote, ['mid', 'fair', 'fair_value', 'mark'], Number.NaN);

  const mid = Number.isFinite(rawMid)
    ? rawMid
    : Number.isFinite(bid) && Number.isFinite(ask)
      ? (bid + ask) / 2
      : undefined;

  const expiryRaw = first(market, ['expiry_ms', 'expiryMs', 'expires_at', 'expiry']);
  let expiryMs: number | undefined;

  if (typeof expiryRaw === 'number') {
    expiryMs = expiryRaw < 10_000_000_000 ? expiryRaw * 1000 : expiryRaw;
  } else if (typeof expiryRaw === 'string') {
    const numeric = Number(expiryRaw);

    if (Number.isFinite(numeric)) {
      expiryMs = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    } else {
      const parsed = Date.parse(expiryRaw);
      if (Number.isFinite(parsed)) expiryMs = parsed;
    }
  }

  const timestampRaw = first(egsi, [
    'timestamp',
    'updated_at_ms',
    'updatedAt',
    'created_at',
    'time',
  ]);

  let timestamp: number | undefined;
  if (typeof timestampRaw === 'number' && Number.isFinite(timestampRaw)) {
    timestamp = timestampRaw;
  } else if (typeof timestampRaw === 'string') {
    const numeric = Number(timestampRaw);
    if (Number.isFinite(numeric)) timestamp = numeric;
    else {
      const parsed = Date.parse(timestampRaw);
      if (Number.isFinite(parsed)) timestamp = parsed;
    }
  }

  return {
    raw: root,
    egsi: {
      score: num(egsi, ['score', 'value', 'egsi'], num(root, ['egsi_score', 'score'], 0)),
      components,
      timestamp,
    },
    forecast: {
      expected: num(
        forecast,
        ['expected_egsi', 'expected', 'forecast', 'prediction'],
        num(egsi, ['score'], 0),
      ),
      confidence: num(forecast, ['confidence', 'confidence_score'], 0),
      tailProbability: num(
        forecast,
        ['p_tail_500', 'p_tail', 'probability_above_500'],
        0,
      ),
      modelVersion: str(
        forecast,
        ['model_version', 'modelVersion', 'model'],
        'egsi-v1',
      ),
      fallback: bool(
        forecast,
        ['fallback', 'is_fallback', 'fallback_forecast'],
        false,
      ),
    },
    market: {
      id: str(market, ['id', 'market_id', 'marketId'], 'EGSI-1H'),
      label: str(market, ['symbol', 'name', 'label'], 'EGSI-1H'),
      expiryMs,
      tickSize: num(market, ['tick_size', 'tickSize'], Number.NaN),
      contractMultiplier: num(
        market,
        ['contract_multiplier', 'contractMultiplier', 'multiplier'],
        Number.NaN,
      ),
      marginRate: num(
        market,
        ['margin_rate', 'marginRate', 'initial_margin'],
        Number.NaN,
      ),
      devMode: bool(
        market,
        ['dev_mode', 'devMode', 'synthetic'],
        bool(root, ['dev_mode', 'devMarket'], false),
      ),
      oracleFresh: bool(market, ['oracle_fresh', 'oracleFresh'], true),
    },
    quote: {
      bid: Number.isFinite(bid) ? bid : undefined,
      ask: Number.isFinite(ask) ? ask : undefined,
      mid,
    },
    orderbook: {
      asks: normaliseLevels(first(orderbook, ['asks', 'sell'])),
      bids: normaliseLevels(first(orderbook, ['bids', 'buy'])),
      indicative: bool(orderbook, ['indicative'], true),
    },
  };
}

export async function getMarket(): Promise<MarketSnapshot> {
  return normaliseMarket(await request('/api/v1/market'));
}

function parseTime(value: unknown): number {
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : numeric;

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Number.NaN;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  }

  return Number.NaN;
}

function findHistoryArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  const root = rec(payload);
  const direct = first(root, ['candles', 'history', 'readings', 'snapshots', 'items']);
  if (Array.isArray(direct)) return direct;

  const nested = rec(first(root, ['data', 'result']));
  const nestedArray = first(nested, ['candles', 'history', 'readings', 'snapshots', 'items']);
  if (Array.isArray(nestedArray)) return nestedArray;

  const data = first(root, ['data', 'result']);
  return Array.isArray(data) ? data : [];
}

function normaliseCandle(item: unknown): Candle | null {
  /**
   * Accept compact arrays:
   * [timestamp, value]
   * [timestamp, open, high, low, close, volume?]
   */
  if (Array.isArray(item)) {
    const time = parseTime(item[0]);

    if (item.length >= 5) {
      const open = Number(item[1]);
      const high = Number(item[2]);
      const low = Number(item[3]);
      const close = Number(item[4]);
      const volume = Number(item[5]);

      if ([time, open, high, low, close].every(Number.isFinite)) {
        return {
          time,
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : undefined,
        };
      }
    }

    if (item.length >= 2) {
      const value = Number(item[1]);
      if (Number.isFinite(time) && Number.isFinite(value)) {
        return { time, open: value, high: value, low: value, close: value };
      }
    }

    return null;
  }

  const row = rec(item);
  const time = parseTime(
    first(row, [
      'time',
      'timestamp',
      'ts',
      'timestamp_ms',
      'created_at',
      'createdAt',
      'updated_at',
    ]),
  );

  const open = num(row, ['open', 'o'], Number.NaN);
  const high = num(row, ['high', 'h'], Number.NaN);
  const low = num(row, ['low', 'l'], Number.NaN);
  const close = num(row, ['close', 'c'], Number.NaN);
  const volume = num(row, ['volume', 'v'], Number.NaN);

  if ([time, open, high, low, close].every(Number.isFinite)) {
    return {
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : undefined,
    };
  }

  /**
   * Some history endpoints expose raw EGSI snapshots rather than OHLC bars.
   * Treat each real snapshot as a flat candle. This is still real observed
   * data; the frontend is not fabricating intermediate prices.
   */
  const value = num(row, ['value', 'score', 'egsi', 'egsi_score'], Number.NaN);

  if (Number.isFinite(time) && Number.isFinite(value)) {
    return {
      time,
      open: value,
      high: value,
      low: value,
      close: value,
    };
  }

  return null;
}

export async function getCandles(): Promise<Candle[]> {
  const payload = await request('/api/v1/candles');
  const source = findHistoryArray(payload);

  const byTime = new Map<number, Candle>();

  for (const item of source) {
    const candle = normaliseCandle(item);
    if (candle) byTime.set(candle.time, candle);
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

async function postVariants(path: string, variants: JsonObject[]): Promise<unknown> {
  let lastError: unknown;

  for (const body of variants) {
    try {
      return await request(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;

      if (status && ![400, 422].includes(status)) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

export interface PrepareOrderInput {
  marketId: string;
  accountId: string;
  owner: string;
  side: 'long' | 'short';
  price: number;
  quantity: number;
}

export async function prepareOrder(
  input: PrepareOrderInput,
): Promise<{ transaction: string; raw: unknown }> {
  const sideUpper = input.side === 'long' ? 'BUY' : 'SELL';

  const payload = await postVariants('/api/v1/orders/prepare', [
    {
      marketId: input.marketId,
      marginAccountId: input.accountId,
      owner: input.owner,
      side: sideUpper,
      price: input.price,
      quantity: input.quantity,
    },
    {
      market_id: input.marketId,
      margin_account_id: input.accountId,
      owner: input.owner,
      side: sideUpper,
      price: input.price,
      quantity: input.quantity,
    },
    {
      market: input.marketId,
      accountId: input.accountId,
      sender: input.owner,
      side: sideUpper,
      price: input.price,
      size: input.quantity,
    },
  ]);

  const root = rec(payload);
  const transaction = first(root, [
    'transaction',
    'transaction_bytes',
    'transactionBytes',
    'tx_bytes',
    'bytes',
    'serializedTransaction',
  ]);

  if (typeof transaction !== 'string' || !transaction) {
    throw new Error(
      'Gateway approved the order but did not return serialized transaction bytes.',
    );
  }

  return { transaction, raw: payload };
}

export async function assessHedge(
  netPosition: number,
  market = 'EGSI-1H',
): Promise<unknown> {
  return postVariants('/api/v1/hedge/assess', [
    { market, netPosition },
    { market, net_position: netPosition },
    { position: netPosition, market },
  ]);
}

export async function evaluateHedge(
  netPosition: number,
  assessment?: unknown,
  market = 'EGSI-1H',
): Promise<unknown> {
  return postVariants('/api/v1/hedge/evaluate', [
    { market, netPosition, assessment },
    { market, net_position: netPosition, assessment },
    { position: netPosition, assessment, market },
  ]);
}

export function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function pickText(value: unknown, keys: string[], fallback = ''): string {
  return str(rec(value), keys, fallback);
}

export function pickNumber(value: unknown, keys: string[], fallback = Number.NaN): number {
  return num(rec(value), keys, fallback);
}

export function pickBoolean(value: unknown, keys: string[], fallback = false): boolean {
  return bool(rec(value), keys, fallback);
}
