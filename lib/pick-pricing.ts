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
  odds?: number | null;
  edge?: number | null;
  ev?: number | null;
}): RepricedPickMetrics {
  const estimatedProbability = safeNumber(input.estimatedProbability);
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
    estimatedProbability,
    impliedProbability: implied,
    odds,
    edge,
    ev
  });

  return {
    impliedProbability: implied,
    edge,
    ev,
    pRaw: auditMetrics.p_raw,
    pCalibrated: auditMetrics.p_calibrated,
    edgeRaw: auditMetrics.edge_raw,
    edgeCalibrated: auditMetrics.edge_calibrated,
    evRaw: auditMetrics.ev_raw,
    evCalibrated: auditMetrics.ev_calibrated
  };
}
