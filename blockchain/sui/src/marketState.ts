/**
 * Reads and parses contracts/gasx's Market and OracleState shared
 * objects (contracts/gasx/sources/market.move, oracle.move) into GASX's
 * MarketState/OracleState (types.ts).
 *
 * parseMarketFields/parseOracleFields are pure — no network — so they're
 * fully unit-testable against synthetic MoveStruct fixtures shaped like
 * what getObject's JSON-RPC response actually returns. fetchMarketState
 * is the thin network wrapper.
 *
 * A note on field encoding: Sui's JSON-RPC layer represents u64 (and
 * larger) Move integers as decimal strings, not JS numbers, to avoid
 * precision loss — this is long-standing, stable Sui JSON-RPC behavior,
 * not something specific to this SDK version. The move* helpers below
 * accept either shape defensively. This parsing has NOT been verified
 * against a live getObject response (no network egress to Sui RPC from
 * Claude's sandbox) — see README.md.
 */
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiAdapterConfig } from './config.js';
import type { MarketState, OracleState } from './types.js';

type MoveFields = Record<string, unknown>;

function moveU64(value: unknown, field: string): number {
  if (typeof value === 'string' || typeof value === 'number') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`expected a u64-like value for '${field}', got ${JSON.stringify(value)}`);
}

function moveBool(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`expected a bool value for '${field}', got ${JSON.stringify(value)}`);
}

function moveString(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new Error(`expected a string value for '${field}', got ${JSON.stringify(value)}`);
}

function moveAddressOrId(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  throw new Error(`expected an address/ID value for '${field}', got ${JSON.stringify(value)}`);
}

/**
 * Parses gasx::market::Market's fields (contracts/gasx/sources/market.move).
 * `settled` false leaves settlementPrice null rather than reading the
 * on-chain field, which is meaningless (and the Move accessor itself
 * aborts on) before settlement — see market.move's settlement_price().
 */
export function parseMarketFields(
  fields: MoveFields,
): Omit<MarketState, 'marketId' | 'oracle'> & { oracleId: string } {
  const settled = moveBool(fields.settled, 'settled');
  return {
    underlying: moveString(fields.underlying, 'underlying'),
    expiryMs: moveU64(fields.expiry_ms, 'expiry_ms'),
    contractMultiplier: moveU64(fields.contract_multiplier, 'contract_multiplier'),
    tickSize: moveU64(fields.tick_size, 'tick_size'),
    marginRatioBps: moveU64(fields.margin_ratio_bps, 'margin_ratio_bps'),
    paused: moveBool(fields.paused, 'paused'),
    settled,
    settlementPrice: settled ? moveU64(fields.settlement_price, 'settlement_price') : null,
    oracleId: moveAddressOrId(fields.oracle_id, 'oracle_id'),
  };
}

/** Parses gasx::oracle::OracleState's fields
 * (contracts/gasx/sources/oracle.move). `nowMs` is injectable for
 * deterministic tests; defaults to the real clock. */
export function parseOracleFields(
  fields: MoveFields,
  nowMs: number = Date.now(),
): Omit<OracleState, 'oracleId'> {
  const hasPrice = moveBool(fields.has_price, 'has_price');
  const lastUpdateMs = moveU64(fields.last_update_ms, 'last_update_ms');
  const maxStalenessMs = moveU64(fields.max_staleness_ms, 'max_staleness_ms');
  return {
    price: moveU64(fields.price, 'price'),
    hasPrice,
    lastUpdateMs,
    maxStalenessMs,
    maxPrice: moveU64(fields.max_price, 'max_price'),
    isFreshApprox: hasPrice && nowMs - lastUpdateMs <= maxStalenessMs,
  };
}

/** gRPC's `json` include returns the Move struct's fields directly,
 * without the JSON-RPC `{dataType, fields}` envelope. */
function moveObjectFields(json: unknown, objectId: string): MoveFields {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    return json as MoveFields;
  }
  throw new Error(`object ${objectId} returned no Move fields (not found, or wrong id?)`);
}

/** Fetches and parses both Market and OracleState in one call. NOT
 * exercised against a live Sui endpoint from Claude's sandbox; see
 * README.md. */
export async function fetchMarketState(
  client: SuiGrpcClient,
  config: SuiAdapterConfig,
): Promise<MarketState> {
  // `include: { json: true }` returns the Move struct's fields as JSON,
  // which is the same shape the parsers below already expect. The SDK
  // warns that this shape can vary between API implementations and
  // suggests parsing BCS instead for strict consistency; that would mean
  // generating BCS types for every struct, which is more machinery than
  // this needs while the parsers stay defensive about both string and
  // number encodings.
  const [marketResponse, oracleResponse] = await Promise.all([
    client.core.getObject({ objectId: config.marketId, include: { json: true } }),
    client.core.getObject({ objectId: config.oracleId, include: { json: true } }),
  ]);

  const market = parseMarketFields(moveObjectFields(marketResponse.object?.json, config.marketId));
  const oracle = parseOracleFields(moveObjectFields(oracleResponse.object?.json, config.oracleId));

  if (market.oracleId !== config.oracleId) {
    throw new Error(
      `configured GASX_SUI_ORACLE_ID (${config.oracleId}) does not match Market ${config.marketId}'s ` +
        `on-chain oracle_id (${market.oracleId}) — config is likely stale or pointing at the wrong market`,
    );
  }
  const { oracleId: _marketOracleId, ...marketFields } = market;

  return {
    marketId: config.marketId,
    ...marketFields,
    oracle: { oracleId: config.oracleId, ...oracle },
  };
}
