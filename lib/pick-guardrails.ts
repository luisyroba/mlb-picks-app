import { buildGameDistribution } from './probability-model';
import { repricePickMetrics } from './pick-pricing';
import {
  FinalPickDecision,
  LayerAOutput,
  NormalizedGameData,
  StartingPitcherStats
} from './types';

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isOverPick(pick: FinalPickDecision): boolean {
  return (
    pick.market !== 'PASS' &&
    /(^|\s)over(\s|$)/i.test(pick.selection)
  );
}

function isTotalLikePick(pick: FinalPickDecision): boolean {
  if (pick.market === 'TOTAL') return true;
  return pick.market === 'F5' && /(^|\s)(over|under)(\s|$)/i.test(pick.selection);
}

function isEliteStarter(starter: StartingPitcherStats): boolean {
  const era = safeNumber(starter.era);
  const whip = safeNumber(starter.whip);
  const fip = safeNumber(starter.fip);
  const xfip = safeNumber(starter.xfip);
  const innings = safeNumber(starter.inningsPitched);
  const enoughWork = innings === null || innings >= 20;
  const runPreventionElite =
    era !== null &&
    era <= 3.25 &&
    whip !== null &&
    whip <= 1.16;
  const defenseIndependentElite =
    (fip !== null && fip <= 3.35) ||
    (xfip !== null && xfip <= 3.45);

  return enoughWork && (runPreventionElite || defenseIndependentElite);
}

function isLowSampleRunPreventionRisk(starter: StartingPitcherStats): boolean {
  const innings = safeNumber(starter.inningsPitched);
  const era = safeNumber(starter.era);
  const whip = safeNumber(starter.whip);
  const fip = safeNumber(starter.fip);
  const xfip = safeNumber(starter.xfip);

  if (innings !== null && innings >= 24) return false;

  const uglyDescriptiveStats =
    (era !== null && era >= 5.15) ||
    (whip !== null && whip >= 1.45);
  const supportedByAdvancedStats =
    (fip !== null && fip >= 4.75) ||
    (xfip !== null && xfip >= 4.75);

  return uglyDescriptiveStats && !supportedByAdvancedStats;
}

function makePass(pick: FinalPickDecision, reason: string): FinalPickDecision {
  return {
    ...pick,
    market: 'PASS',
    selection: 'NO BET',
    line: undefined,
    odds: undefined,
    estimatedProbability: undefined,
    impliedProbability: undefined,
    edge: undefined,
    ev: undefined,
    selectionScore: undefined,
    confidence: 'PASS',
    executionReason: reason,
    passReason: reason,
    altMarket1: undefined,
    altMarket2: undefined
  };
}

export function applyTotalPitchingGuardrails(
  pick: FinalPickDecision,
  game: NormalizedGameData,
  layerA: LayerAOutput
): FinalPickDecision {
  if (!isTotalLikePick(pick) || !isOverPick(pick)) {
    return pick;
  }

  const line = safeNumber(pick.line);
  if (line === null) return pick;

  const metrics = repricePickMetrics({
    estimatedProbability: pick.estimatedProbability ?? null,
    odds: pick.odds ?? null,
    edge: pick.edge ?? null,
    ev: pick.ev ?? null
  });
  const distribution = buildGameDistribution(game, layerA);
  const projectedTotal =
    pick.market === 'F5'
      ? distribution.f5TotalMean
      : distribution.totalMean;
  const lineDelta = projectedTotal - line;
  const homeStarter = game.homeTeam.starter;
  const awayStarter = game.awayTeam.starter;
  const bothElite =
    isEliteStarter(homeStarter) && isEliteStarter(awayStarter);
  const lowSampleRisk =
    isLowSampleRunPreventionRisk(homeStarter) ||
    isLowSampleRunPreventionRisk(awayStarter);
  const edgeCalibrated = metrics.edgeCalibrated ?? -1;
  const evCalibrated = metrics.evCalibrated ?? -1;

  if (
    bothElite &&
    (edgeCalibrated < 0.12 || evCalibrated < 0.08 || lineDelta < 0.75)
  ) {
    return makePass(
      pick,
      `No bet: over bloqueado por dos abridores elite. Delta ${lineDelta.toFixed(2)} carreras, edge calibrado ${(edgeCalibrated * 100).toFixed(1)}pp y EV calibrado ${evCalibrated.toFixed(3)} no superan el umbral especial.`
    );
  }

  if (
    lowSampleRisk &&
    (edgeCalibrated < 0.14 || evCalibrated < 0.1 || lineDelta < 1)
  ) {
    return makePass(
      pick,
      `No bet: over bloqueado por abridor con muestra baja y stats descriptivas inestables. Delta ${lineDelta.toFixed(2)} carreras, edge calibrado ${(edgeCalibrated * 100).toFixed(1)}pp y EV calibrado ${evCalibrated.toFixed(3)} no compensan la incertidumbre.`
    );
  }

  return pick;
}
