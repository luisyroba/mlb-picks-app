import { expectedValue, impliedProbability } from './probability-model';

export type AuditMetricSet = {
  p_raw: number | null;
  p_calibrated: number | null;
  edge_raw: number | null;
  edge_calibrated: number | null;
  ev_raw: number | null;
  ev_calibrated: number | null;
};

type BuildAuditMetricsInput = {
  estimatedProbability?: number | null;
  impliedProbability?: number | null;
  odds?: number | null;
  edge?: number | null;
  ev?: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function calibrateProbability(rawProbability: number, marketImplied: number | null): number {
  const anchor = marketImplied ?? 0.5;
  const gap = rawProbability - anchor;
  const shrinkFactor = Math.abs(gap) >= 0.1 ? 0.78 : 0.84;

  return clamp(anchor + gap * shrinkFactor, 0.01, 0.99);
}

export function buildAuditMetrics(input: BuildAuditMetricsInput): AuditMetricSet {
  const pRaw = safeNumber(input.estimatedProbability);
  const explicitImplied = safeNumber(input.impliedProbability);
  const odds = safeNumber(input.odds);
  const effectiveImplied =
    explicitImplied ?? (odds !== null && odds > 1 ? impliedProbability(odds) : null);

  if (pRaw === null) {
    return {
      p_raw: null,
      p_calibrated: null,
      edge_raw: safeNumber(input.edge),
      edge_calibrated: null,
      ev_raw: safeNumber(input.ev),
      ev_calibrated: null
    };
  }

  const boundedRaw = clamp(pRaw, 0.01, 0.99);
  const pCalibrated = calibrateProbability(boundedRaw, effectiveImplied);
  const edgeRaw =
    effectiveImplied !== null
      ? boundedRaw - effectiveImplied
      : safeNumber(input.edge);
  const edgeCalibrated =
    effectiveImplied !== null
      ? pCalibrated - effectiveImplied
      : null;
  const evRaw =
    odds !== null && odds > 1
      ? expectedValue(boundedRaw, odds)
      : safeNumber(input.ev);
  const evCalibrated =
    odds !== null && odds > 1
      ? expectedValue(pCalibrated, odds)
      : null;

  return {
    p_raw: boundedRaw,
    p_calibrated: pCalibrated,
    edge_raw: edgeRaw,
    edge_calibrated: edgeCalibrated,
    ev_raw: evRaw,
    ev_calibrated: evCalibrated
  };
}
