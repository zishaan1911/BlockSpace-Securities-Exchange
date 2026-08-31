/**
 * Pure display logic for EGSI readings. Kept separate from the
 * components so the banding rules — the thing that decides whether the
 * interface says "nominal" or "critical" — are directly testable
 * without rendering anything.
 */

export type StressBand = 'nominal' | 'elevated' | 'critical';

export const EGSI_MAX = 1000;

/**
 * Bands the 0-1000 index into the three states the palette encodes.
 * 500 is the meaningful boundary because it's the threshold the AI
 * forecast reports a tail probability against (ARCHITECTURE.md §4's
 * `p_tail_500`), so "elevated" starts where the model starts caring.
 */
export function stressBand(score: number): StressBand {
  if (score >= 750) return 'critical';
  if (score >= 500) return 'elevated';
  return 'nominal';
}

/** The human-facing name for each band. Sentence case, plain words —
 * this is a readout, not a warning siren. */
export function bandLabel(band: StressBand): string {
  switch (band) {
    case 'critical':
      return 'Severe congestion';
    case 'elevated':
      return 'Congestion building';
    case 'nominal':
      return 'Running clear';
  }
}

export function bandColorVar(band: StressBand): string {
  return `var(--${band})`;
}

/** Clamps to the gauge's arc so a malformed reading can't draw outside it. */
export function gaugeFraction(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score / EGSI_MAX));
}

/** Component scores arrive as 0-1; shown as whole percentages. */
export function formatComponent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** Human-readable countdown to expiry. Returns null once expired, so
 * callers can render a distinct settled/expired state rather than a
 * misleading "0m". */
export function timeToExpiry(expiryMs: number, nowMs: number): string | null {
  const remaining = expiryMs - nowMs;
  if (remaining <= 0) return null;
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** USD-ish notional formatting for exposure figures. */
export function formatNotional(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
