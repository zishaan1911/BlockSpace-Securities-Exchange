export type StressBand = 'nominal' | 'elevated' | 'critical';

export function stressBand(score: number): StressBand {
  if (score >= 750) return 'critical';
  if (score >= 500) return 'elevated';
  return 'nominal';
}

export function bandLabel(band: StressBand): string {
  if (band === 'critical') return 'Severe congestion';
  if (band === 'elevated') return 'Congestion building';
  return 'Running clear';
}

export function gaugeFraction(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score / 1000));
}

export function formatComponent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

export function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

export function timeToExpiry(expiryMs: number, now = Date.now()): string | null {
  const remaining = expiryMs - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const totalMinutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 1) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatNotional(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}
