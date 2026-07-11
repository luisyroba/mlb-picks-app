import type {
  ConfidenceLevel,
  GameOddsInput,
  LayerAOutput,
  MarketEvaluation,
  MarketSuitabilityAudit,
  NormalizedGameData,
  StartingPitcherStats,
  StarterClassification,
  StarterTier
} from './types';
import type { GameDistribution } from './probability-model';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

function getStarterReliability(starter: StartingPitcherStats): number {
  const innings = safeNumber(starter.inningsPitched);
  if (innings === null) return 0.08;
  return clamp((innings - 12) / 58, 0.08, 1);
}

function getKbbRatio(starter: StartingPitcherStats): number | null {
  const strikeouts = safeNumber(starter.strikeouts);
  const walks = safeNumber(starter.walks);
  return safeRatio(strikeouts, walks && walks > 0 ? walks : null);
}

function getBestDefenseIndependentMetric(starter: StartingPitcherStats): number | null {
  const fip = safeNumber(starter.fip);
  const xfip = safeNumber(starter.xfip);
  if (fip !== null && xfip !== null) return Math.min(fip, xfip);
  return fip ?? xfip;
}

function pushReason(reasons: string[], condition: boolean, reason: string) {
  if (condition) reasons.push(reason);
}

export function classifyStarter(starter: StartingPitcherStats): StarterClassification {
  const era = safeNumber(starter.era);
  const whip = safeNumber(starter.whip);
  const innings = safeNumber(starter.inningsPitched);
  const kMinusBb = safeNumber(starter.kMinusBbRate);
  const kbbRatio = getKbbRatio(starter);
  const defenseIndependent = getBestDefenseIndependentMetric(starter);
  const hrRate = safeNumber(starter.hrRate);
  const walkRate = safeNumber(starter.walkRate);
  const reliability = getStarterReliability(starter);
  const reasons: string[] = [];

  if (!starter.name || starter.name === 'TBD' || era === null || whip === null) {
    return {
      tier: 'unknown',
      score: 50,
      reliability,
      label: 'Unknown',
      reasons: ['missing starter identity or core stats']
    };
  }

  const lowSample = innings !== null && innings < 35;
  const runPreventionElite = era <= 3.25 && whip <= 1.16;
  const runPreventionStrong = era <= 3.75 && whip <= 1.24;
  const commandElite =
    (kMinusBb !== null && kMinusBb >= 17) ||
    (kbbRatio !== null && kbbRatio >= 4.2);
  const commandStrong =
    (kMinusBb !== null && kMinusBb >= 12) ||
    (kbbRatio !== null && kbbRatio >= 3.0);
  const defenseElite = defenseIndependent !== null && defenseIndependent <= 3.45;
  const defenseStrong = defenseIndependent !== null && defenseIndependent <= 3.85;
  const descriptiveBad = era >= 4.75 || whip >= 1.38;
  const descriptiveDisaster = era >= 5.25 || whip >= 1.48;
  const supportedBad =
    (defenseIndependent !== null && defenseIndependent >= 4.65) ||
    (walkRate !== null && walkRate >= 3.8) ||
    (hrRate !== null && hrRate >= 1.35);

  pushReason(reasons, runPreventionElite, 'elite ERA/WHIP');
  pushReason(reasons, commandElite, 'elite command/K-BB');
  pushReason(reasons, defenseElite, 'elite FIP/xFIP');
  pushReason(reasons, descriptiveDisaster, 'disaster run prevention');
  pushReason(reasons, supportedBad, 'bad profile supported beyond ERA');
  pushReason(reasons, lowSample, 'low sample');

  let tier: StarterTier = 'average';
  if (lowSample && descriptiveBad && !supportedBad) {
    tier = 'low_sample_risk';
  } else if (descriptiveDisaster && (supportedBad || reliability >= 0.45)) {
    tier = 'disaster';
  } else if (descriptiveBad && supportedBad) {
    tier = 'weak';
  } else if (reliability >= 0.45 && (runPreventionElite || defenseElite) && commandStrong) {
    tier = 'elite';
  } else if (reliability >= 0.35 && (runPreventionStrong || defenseStrong || commandElite)) {
    tier = 'strong';
  } else if (descriptiveBad) {
    tier = 'weak';
  }

  const score =
    tier === 'elite' ? 92 :
    tier === 'strong' ? 78 :
    tier === 'average' ? 55 :
    tier === 'weak' ? 34 :
    tier === 'disaster' ? 15 :
    tier === 'low_sample_risk' ? 42 :
    50;

  const label =
    tier === 'elite' ? 'As' :
    tier === 'strong' ? 'Fuerte' :
    tier === 'average' ? 'Promedio' :
    tier === 'weak' ? 'Debil' :
    tier === 'disaster' ? 'Desastre' :
    tier === 'low_sample_risk' ? 'Muestra baja' :
    'Unknown';

  return {
    tier,
    score,
    reliability,
    label,
    reasons: reasons.length ? reasons : ['league-average profile']
  };
}

function confidenceRank(confidence: ConfidenceLevel): number {
  if (confidence === 'A') return 3;
  if (confidence === 'B') return 2;
  if (confidence === 'C') return 1;
  return 0;
}

export function capConfidence(
  confidence: ConfidenceLevel,
  cap?: Exclude<ConfidenceLevel, 'PASS'>
): ConfidenceLevel {
  if (!cap || confidence === 'PASS') return confidence;
  return confidenceRank(confidence) > confidenceRank(cap) ? cap : confidence;
}

function isOver(selection: string): boolean {
  return /(^|\s)over(\s|$)/i.test(selection);
}

function isUnder(selection: string): boolean {
  return /(^|\s)under(\s|$)/i.test(selection);
}

function isTotalLike(candidate: MarketEvaluation): boolean {
  return (
    candidate.market === 'TOTAL' ||
    (candidate.market === 'F5' && (isOver(candidate.selection) || isUnder(candidate.selection)))
  );
}

function sideFromSelection(
  candidate: MarketEvaluation,
  game: NormalizedGameData
): 'home' | 'away' | null {
  const selection = candidate.selection.toLowerCase();
  const homeName = game.homeTeam.core.teamName.toLowerCase();
  const awayName = game.awayTeam.core.teamName.toLowerCase();
  const homeAbbr = game.homeTeam.core.abbreviation.toLowerCase();
  const awayAbbr = game.awayTeam.core.abbreviation.toLowerCase();

  if (selection.includes(homeName) || selection.includes(homeAbbr)) return 'home';
  if (selection.includes(awayName) || selection.includes(awayAbbr)) return 'away';
  return null;
}

function getProjectedRuns(candidate: MarketEvaluation, distribution: GameDistribution) {
  const isF5 = candidate.market === 'F5';
  return {
    projectedHomeRuns: isF5 ? distribution.muHomeF5 : distribution.muHome,
    projectedAwayRuns: isF5 ? distribution.muAwayF5 : distribution.muAway,
    projectedTotal: isF5 ? distribution.f5TotalMean : distribution.totalMean,
    margin: isF5 ? distribution.f5MarginMean : distribution.marginMean
  };
}

function hasTier(classification: StarterClassification, tiers: StarterTier[]) {
  return tiers.includes(classification.tier);
}

function getLineupOk(game: NormalizedGameData): boolean {
  const home = safeNumber(game.homeTeam.lineupContext.lineupQualityAdjustment) ?? 0;
  const away = safeNumber(game.awayTeam.lineupContext.lineupQualityAdjustment) ?? 0;
  const missingHome = safeNumber(game.homeTeam.lineupContext.missingKeyBatCount) ?? 0;
  const missingAway = safeNumber(game.awayTeam.lineupContext.missingKeyBatCount) ?? 0;
  return home > -35 && away > -35 && missingHome <= 2 && missingAway <= 2;
}

function assessTotalMarket(params: {
  candidate: MarketEvaluation;
  game: NormalizedGameData;
  layerA: LayerAOutput;
  distribution: GameDistribution;
  homeStarter: StarterClassification;
  awayStarter: StarterClassification;
}): Partial<MarketSuitabilityAudit> {
  const { candidate, game, layerA, distribution, homeStarter, awayStarter } = params;
  const projected = getProjectedRuns(candidate, distribution);
  const isF5 = candidate.market === 'F5';
  const over = isOver(candidate.selection);
  const notes: string[] = [];
  const tags: string[] = [];
  let score = 58;
  let scoreAdjustment = 0;
  let confidenceCap: Exclude<ConfidenceLevel, 'PASS'> | undefined;

  const lowTeamThreshold = isF5 ? 1.65 : 3.35;
  const eliteLowThreshold = isF5 ? 1.95 : 3.75;
  const bilateral =
    projected.projectedHomeRuns >= lowTeamThreshold &&
    projected.projectedAwayRuns >= lowTeamThreshold;
  const environmentOk = (safeNumber(game.parkWeather.parkFactorRuns) ?? 100) >= 97 &&
    (safeNumber(game.parkWeather.temperatureF) ?? 70) >= 55 &&
    (safeNumber(game.parkWeather.rainRiskPct) ?? 0) <= 35 &&
    layerA.blockScores.parkWeather >= -2;
  const offenseBlockSupport = layerA.blockScores.offense >= -4;
  const lineupOk = getLineupOk(game);
  const homeElite = hasTier(homeStarter, ['elite', 'strong']);
  const awayElite = hasTier(awayStarter, ['elite', 'strong']);
  const homeDisaster = hasTier(homeStarter, ['disaster', 'weak']);
  const awayDisaster = hasTier(awayStarter, ['disaster', 'weak']);
  const eliteSuppression =
    (homeElite && projected.projectedAwayRuns < eliteLowThreshold) ||
    (awayElite && projected.projectedHomeRuns < eliteLowThreshold);
  const bothWeak = homeDisaster && awayDisaster;

  if (over) {
    if (bilateral) {
      score += 10;
      tags.push('bilateral-total-support');
    } else {
      score -= 20;
      scoreAdjustment -= 18;
      confidenceCap = 'B';
      tags.push('one-sided-over-risk');
      notes.push('Over lacks bilateral run support');
    }

    if (eliteSuppression) {
      score -= 26;
      scoreAdjustment -= 28;
      confidenceCap = 'C';
      tags.push('elite-suppression');
      notes.push('Projected runs against an elite/strong starter are too low for an Over');
    }

    if (!environmentOk) {
      score -= 10;
      scoreAdjustment -= 8;
      confidenceCap = confidenceCap ?? 'B';
      tags.push('environment-not-supportive');
      notes.push('Park/weather does not support an Over');
    }

    if (!offenseBlockSupport) {
      score -= 10;
      scoreAdjustment -= 10;
      confidenceCap = confidenceCap ?? 'B';
      tags.push('offense-not-supportive');
      notes.push('Offense block does not support forcing an Over');
    }

    if (!lineupOk) {
      score -= 10;
      scoreAdjustment -= 8;
      confidenceCap = confidenceCap ?? 'B';
      tags.push('lineup-not-supportive');
      notes.push('Lineup context is not strong enough for an Over');
    }

    if (!bothWeak && (homeElite || awayElite)) {
      score -= 8;
      scoreAdjustment -= 8;
      confidenceCap = confidenceCap ?? 'B';
      tags.push('single-ace-total-risk');
    }

    if (hasTier(homeStarter, ['low_sample_risk']) || hasTier(awayStarter, ['low_sample_risk'])) {
      score -= 8;
      scoreAdjustment -= 8;
      confidenceCap = confidenceCap ?? 'B';
      tags.push('low-sample-over-risk');
      notes.push('Low-sample pitcher stats should not create an automatic Over');
    }

    if (bilateral && environmentOk && lineupOk && !eliteSuppression && (bothWeak || projected.projectedTotal - (candidate.line ?? projected.projectedTotal) >= (isF5 ? 1.15 : 1.75))) {
      score += 8;
      scoreAdjustment += 4;
      tags.push('over-a-supported');
    }
  } else {
    if ((homeElite || awayElite) && !bothWeak) {
      score += 10;
      scoreAdjustment += 8;
      tags.push('starter-under-support');
    }

    if (!environmentOk) {
      score += 6;
      scoreAdjustment += 4;
      tags.push('environment-under-support');
    }
  }

  return {
    score: clamp(score, 0, 100),
    scoreAdjustment,
    confidenceCap,
    tags,
    notes,
    totalSupport: {
      bilateral,
      environmentOk,
      lineupOk,
      eliteSuppression,
      ...projected
    }
  };
}

function assessSideMarket(params: {
  candidate: MarketEvaluation;
  game: NormalizedGameData;
  distribution: GameDistribution;
  homeStarter: StarterClassification;
  awayStarter: StarterClassification;
}): Partial<MarketSuitabilityAudit> {
  const { candidate, game, distribution, homeStarter, awayStarter } = params;
  const selectedSide = sideFromSelection(candidate, game);
  const projected = getProjectedRuns(candidate, distribution);
  const marginForSide =
    selectedSide === 'home' ? projected.margin :
    selectedSide === 'away' ? -projected.margin :
    0;
  const selectedStarter =
    selectedSide === 'home' ? homeStarter :
    selectedSide === 'away' ? awayStarter :
    null;
  const notes: string[] = [];
  const tags: string[] = [];
  let score = 62;
  let scoreAdjustment = 0;
  let confidenceCap: Exclude<ConfidenceLevel, 'PASS'> | undefined;

  if (selectedStarter && hasTier(selectedStarter, ['elite', 'strong']) && marginForSide >= (candidate.market === 'F5' ? 0.38 : 0.62)) {
    score += 18;
    scoreAdjustment += candidate.market === 'F5' ? 18 : 16;
    tags.push('side-priority');
    notes.push('Elite/strong starter with projected side advantage');
  }

  if (candidate.market === 'ML') {
    scoreAdjustment += 6;
    tags.push('historical-ml-prior');
  }

  if (candidate.market === 'F5' && !isTotalLike(candidate)) {
    scoreAdjustment += 8;
    tags.push('starter-f5-prior');
  }

  if (candidate.market === 'RL') {
    const line = safeNumber(candidate.line);
    if (line !== null && line < 0) {
      if (marginForSide >= 1.15 && selectedStarter && hasTier(selectedStarter, ['elite', 'strong', 'average'])) {
        score += 8;
        scoreAdjustment += 8;
        tags.push('favorite-runline-supported');
      } else {
        score -= 14;
        scoreAdjustment -= 12;
        confidenceCap = 'B';
        notes.push('Negative run line lacks enough projected margin');
      }
    }

    if (line !== null && line > 0 && marginForSide > 0.35) {
      score -= 22;
      scoreAdjustment -= 22;
      confidenceCap = 'C';
      tags.push('plus-runline-over-ml-risk');
      notes.push('Projected favorite should not prefer +1.5 over ML');
    }
  }

  return {
    score: clamp(score, 0, 100),
    scoreAdjustment,
    confidenceCap,
    tags,
    notes
  };
}

export function assessMarketSuitability(
  game: NormalizedGameData,
  layerA: LayerAOutput,
  distribution: GameDistribution,
  candidate: MarketEvaluation
): MarketSuitabilityAudit {
  const homeStarter = classifyStarter(game.homeTeam.starter);
  const awayStarter = classifyStarter(game.awayTeam.starter);
  const base: MarketSuitabilityAudit = {
    score: 58,
    scoreAdjustment: 0,
    tags: [],
    notes: [],
    starter: {
      home: homeStarter,
      away: awayStarter
    }
  };

  const assessment = isTotalLike(candidate)
    ? assessTotalMarket({ candidate, game, layerA, distribution, homeStarter, awayStarter })
    : assessSideMarket({ candidate, game, distribution, homeStarter, awayStarter });

  return {
    ...base,
    ...assessment,
    tags: assessment.tags ?? [],
    notes: assessment.notes ?? []
  };
}

export function hasFavoriteRunLineAvailable(
  odds: GameOddsInput | undefined,
  side: 'home' | 'away'
): boolean {
  const line = side === 'home' ? odds?.homeRL?.line : odds?.awayRL?.line;
  return typeof line === 'number' && Number.isFinite(line) && line < 0;
}
