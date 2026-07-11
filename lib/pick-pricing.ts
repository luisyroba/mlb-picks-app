import { buildAuditMetrics } from './audit-metrics';
import { expectedValue, impliedProbability } from './probability-model';

export type RepricedPickMetrics = {
  impliedProbability: number | null;
  edge: number | null;
  ev: number | null;
  pRaw: number | null;
  pCalibrated: number | null;
  edgeRaw: number | null;
  edgeCalibrated: number | null;
  evRaw: number | null;
  evCalibrated: number | null;
};

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function repricePickMetrics(input: {
  estimatedProbability?: number | null;
  rawEstimatedProbability?: number | null;
  pRaw?: number | null;
  pCalibrated?: number | null;
  odds?: number | null;
  edge?: number | null;
  ev?: number | null;
}): RepricedPickMetrics {
  const rawProbability =
    safeNumber(input.pRaw) ??
    safeNumber(input.rawEstimatedProbability) ??
    safeNumber(input.estimatedProbability);
  const providedCalibratedProbability = safeNumber(input.pCalibrated);
  const estimatedProbability =
    providedCalibratedProbability ?? safeNumber(input.estimatedProbability);
  const odds = safeNumber(input.odds);
  const implied =
    odds !== null && odds > 1 ? impliedProbability(odds) : null;
  const edge =
    estimatedProbability !== null && implied !== null
      ? estimatedProbability - implied
      : safeNumber(input.edge);
  const ev =
    estimatedProbability !== null && odds !== null && odds > 1
      ? expectedValue(estimatedProbability, odds)
      : safeNumber(input.ev);
  const auditMetrics = buildAuditMetrics({
    estimatedProbability: rawProbability,
    impliedProbability: implied,
    odds,
    edge: safeNumber(input.edge),
    ev: safeNumber(input.ev)
  });
  const pRaw = auditMetrics.p_raw ?? rawProbability;
  const pCalibrated = providedCalibratedProbability ?? auditMetrics.p_calibrated;
  const effectiveEdge =
    pCalibrated !== null && implied !== null
      ? pCalibrated - implied
      : edge;
  const effectiveEv =
    pCalibrated !== null && odds !== null && odds > 1
      ? expectedValue(pCalibrated, odds)
      : ev;

  return {
    impliedProbability: implied,
    edge: effectiveEdge,
    ev: effectiveEv,
    pRaw,
    pCalibrated,
    edgeRaw: auditMetrics.edge_raw,
    edgeCalibrated: effectiveEdge,
    evRaw: auditMetrics.ev_raw,
    evCalibrated: effectiveEv
  };
}
