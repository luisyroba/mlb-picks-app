export function formatOdds(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
}

export function formatMetric(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(3);
}

export function formatScore(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(1);
}

export function formatProbability(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}