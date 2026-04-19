import {
  LayerAOutput,
  NormalizedGameData,
  OffenseStats,
  StartingPitcherStats,
  BullpenStats,
  TeamCoreStats,
  LineupContextStats
} from './types';

const LEAGUE_RUNS_PER_TEAM = 4.35;
const LEAGUE_OPS = 0.72;
const LEAGUE_OBP = 0.315;
const LEAGUE_SLG = 0.405;
const LEAGUE_STARTER_RA9 = 4.2;
const LEAGUE_BULLPEN_RA9 = 4.15;
const DEFAULT_STARTER_INNINGS = 5.4;
const BASE_HOME_FIELD_RUNS = 0.14;

export type GameDistribution = {
  muHome: number;
  muAway: number;
  muHomeF5: number;
  muAwayF5: number;
  totalMean: number;
  marginMean: number;
  totalStdDev: number;
  marginStdDev: number;
  f5TotalMean: number;
  f5MarginMean: number;
  f5TotalStdDev: number;
  f5MarginStdDev: number;
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function average(values: Array<number | undefined>, fallback: number): number {
  const active = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!active.length) return fallback;
  return active.reduce((sum, value) => sum + value, 0) / active.length;
}

function weightedAverage(
  entries: Array<{ value?: number; weight: number }>,
  fallback: number
): number {
  const active = entries.filter(
    (entry) => typeof entry.value === 'number' && Number.isFinite(entry.value) && entry.weight > 0
  );

  if (!active.length) return fallback;

  const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return fallback;

  return active.reduce((sum, entry) => {
    return sum + (entry.value ?? 0) * (entry.weight / totalWeight);
  }, 0);
}

function blendOps(offense: OffenseStats, opponentHand?: 'R' | 'L' | 'S'): number {
  const splitOps =
    opponentHand === 'L'
      ? offense.vsLeftOps
      : opponentHand === 'R'
        ? offense.vsRightOps
        : undefined;

  const derivedOps =
    safeNumber(offense.onBasePct) !== undefined && safeNumber(offense.sluggingPct) !== undefined
      ? (offense.onBasePct ?? 0) + (offense.sluggingPct ?? 0)
      : undefined;

  return weightedAverage(
    [
      { value: safeNumber(offense.ops), weight: 0.45 },
      { value: safeNumber(splitOps), weight: 0.35 },
      { value: safeNumber(derivedOps), weight: 0.2 }
    ],
    LEAGUE_OPS
  );
}

function offenseIndex(
  offense: OffenseStats,
  core: TeamCoreStats,
  lineup: LineupContextStats,
  opponentStarterHand?: 'R' | 'L' | 'S'
): number {
  const seasonRuns = weightedAverage(
    [
      { value: safeNumber(offense.runsPerGame), weight: 0.7 },
      { value: safeNumber(core.runsScoredPerGame), weight: 0.3 }
    ],
    LEAGUE_RUNS_PER_TEAM
  );

  const recentRuns = weightedAverage(
    [
      { value: safeNumber(offense.last7RunsPerGame), weight: 0.6 },
      { value: safeNumber(offense.last14RunsPerGame), weight: 0.4 }
    ],
    seasonRuns
  );

  const runsBlend = seasonRuns * 0.68 + recentRuns * 0.32;
  const runsFactor = clamp(1 + ((runsBlend - LEAGUE_RUNS_PER_TEAM) / LEAGUE_RUNS_PER_TEAM) * 0.85, 0.8, 1.22);

  const opsBlend = blendOps(offense, opponentStarterHand);
  const opsFactor = clamp(1 + ((opsBlend - LEAGUE_OPS) / LEAGUE_OPS) * 0.72, 0.84, 1.18);

  const obpFactor = clamp(
    1 + ((safeNumber(offense.onBasePct) ?? LEAGUE_OBP) - LEAGUE_OBP) / LEAGUE_OBP * 0.26,
    0.92,
    1.08
  );

  const slgFactor = clamp(
    1 + ((safeNumber(offense.sluggingPct) ?? LEAGUE_SLG) - LEAGUE_SLG) / LEAGUE_SLG * 0.28,
    0.9,
    1.1
  );

  const lineupFactor = clamp(
    1 +
      (safeNumber(lineup.lineupQualityAdjustment) ?? 0) / 100 * 0.18 -
      (safeNumber(lineup.missingKeyBatCount) ?? 0) * 0.025 -
      (lineup.catcherBackup ? 0.02 : 0),
    0.82,
    1.14
  );

  const formFactor = clamp(1 + ((recentRuns - seasonRuns) / LEAGUE_RUNS_PER_TEAM) * 0.3, 0.9, 1.1);
  const teamFactor = clamp(1 + (safeNumber(core.runDifferentialPerGame) ?? 0) * 0.03, 0.92, 1.08);

  return clamp(
    runsFactor * 0.38 +
      opsFactor * 0.28 +
      lineupFactor * 0.14 +
      formFactor * 0.1 +
      obpFactor * 0.05 +
      slgFactor * 0.05 +
      teamFactor * 0.1,
    0.74,
    1.28
  );
}

function whipToRunsAllowed(whip?: number): number | undefined {
  if (safeNumber(whip) === undefined) return undefined;
  return clamp(4.15 + ((whip ?? 1.28) - 1.28) * 2.35, 2.6, 6.8);
}

function starterAdvancedMetricReliability(starter: StartingPitcherStats): number {
  const innings = safeNumber(starter.inningsPitched) ?? 0;
  return clamp((innings - 12) / 38, 0.05, 1);
}

function starterRunsAllowed(starter: StartingPitcherStats): number {
  const advancedReliability = starterAdvancedMetricReliability(starter);
  const descriptiveReliability = 1 - advancedReliability;

  return weightedAverage(
    [
      { value: safeNumber(starter.xfip), weight: 0.34 * advancedReliability },
      { value: safeNumber(starter.fip), weight: 0.3 * advancedReliability },
      { value: safeNumber(starter.era), weight: 0.22 + descriptiveReliability * 0.2 },
      { value: whipToRunsAllowed(starter.whip), weight: 0.08 + descriptiveReliability * 0.08 },
      { value: safeNumber(starter.recentEra), weight: 0.06 + descriptiveReliability * 0.12 },
      { value: whipToRunsAllowed(starter.recentWhip), weight: 0.04 + descriptiveReliability * 0.06 }
    ],
    LEAGUE_STARTER_RA9
  );
}

function bullpenRunsAllowed(bullpen: BullpenStats): number {
  const fatiguePenalty =
    (safeNumber(bullpen.fatigueScore) ?? 0) / 100 * 0.45 +
    (safeNumber(bullpen.last3DaysInnings) ?? 0) * 0.035 +
    (safeNumber(bullpen.last2DaysInnings) ?? 0) * 0.045;

  const availabilityBonus =
    (bullpen.closerAvailable === false ? 0.12 : 0) +
    (bullpen.setupAvailable === false ? 0.08 : 0);

  const raw = weightedAverage(
    [
      { value: safeNumber(bullpen.fip), weight: 0.42 },
      { value: safeNumber(bullpen.era), weight: 0.36 },
      { value: whipToRunsAllowed(bullpen.whip), weight: 0.22 }
    ],
    LEAGUE_BULLPEN_RA9
  );

  return clamp(raw + fatiguePenalty + availabilityBonus, 2.8, 6.7);
}

function sharedEnvironmentFactor(game: NormalizedGameData): number {
  const parkRuns = safeNumber(game.parkWeather.parkFactorRuns) ?? 100;
  const temp = safeNumber(game.parkWeather.temperatureF) ?? 70;
  const wind = safeNumber(game.parkWeather.windMph) ?? 0;
  const rain = safeNumber(game.parkWeather.rainRiskPct) ?? 0;

  const parkFactor = 1 + ((parkRuns - 100) / 100) * 0.58;
  const tempFactor = 1 + clamp((temp - 70) * 0.0045, -0.08, 0.08);

  let windFactor = 1;
  if (game.parkWeather.windDirection === 'out') {
    windFactor += clamp(wind * 0.008, 0, 0.08);
  } else if (game.parkWeather.windDirection === 'in') {
    windFactor -= clamp(wind * 0.008, 0, 0.08);
  } else if (game.parkWeather.windDirection === 'cross') {
    windFactor += clamp(wind * 0.0015, 0, 0.02);
  }

  const rainFactor = 1 - clamp(rain * 0.00045, 0, 0.04);

  return clamp(parkFactor * tempFactor * windFactor * rainFactor, 0.88, 1.14);
}

function homeFieldRuns(game: NormalizedGameData): number {
  const parkRuns = safeNumber(game.parkWeather.parkFactorRuns) ?? 100;
  const roofClosed = game.parkWeather.roofClosed === true;

  const parkAdjustment = clamp(((parkRuns - 100) / 100) * 0.08, -0.04, 0.05);
  const roofAdjustment = roofClosed ? 0.008 : 0;

  return clamp(BASE_HOME_FIELD_RUNS + parkAdjustment + roofAdjustment, 0.09, 0.23);
}

function getStarterInnings(starter: StartingPitcherStats): number {
  return clamp(safeNumber(starter.expectedInnings) ?? DEFAULT_STARTER_INNINGS, 4.2, 6.8);
}

function fullGamePitchingFactor(starter: StartingPitcherStats, bullpen: BullpenStats): number {
  const starterRa = starterRunsAllowed(starter);
  const bullpenRa = bullpenRunsAllowed(bullpen);
  const starterShare = clamp(getStarterInnings(starter) / 9, 0.42, 0.76);

  const combinedRa = starterRa * starterShare + bullpenRa * (1 - starterShare);
  return clamp(combinedRa / LEAGUE_RUNS_PER_TEAM, 0.76, 1.26);
}

function f5PitchingFactor(starter: StartingPitcherStats, bullpen: BullpenStats): number {
  const starterRa = starterRunsAllowed(starter);
  const bullpenRa = bullpenRunsAllowed(bullpen);
  const starterShare = clamp(getStarterInnings(starter) / 5, 0.72, 0.96);

  const combinedRa = starterRa * starterShare + bullpenRa * (1 - starterShare);
  return clamp(combinedRa / LEAGUE_RUNS_PER_TEAM, 0.72, 1.28);
}

function deriveTotalsFromMeans(
  home: number,
  away: number
): { total: number; margin: number } {
  return {
    total: home + away,
    margin: home - away
  };
}

function projectionBiasFromGameScript(
  layerA: LayerAOutput
): number {
  if (layerA.gameScript.scoringProjection === 'high') return 0.42;
  if (layerA.gameScript.scoringProjection === 'low') return -0.42;
  return 0;
}

function offenseEnvironmentBias(
  game: NormalizedGameData,
  homeOffenseFactor: number,
  awayOffenseFactor: number
): number {
  const seasonRuns = average(
    [
      safeNumber(game.homeTeam.offense.runsPerGame),
      safeNumber(game.awayTeam.offense.runsPerGame),
      safeNumber(game.homeTeam.core.runsScoredPerGame),
      safeNumber(game.awayTeam.core.runsScoredPerGame)
    ],
    LEAGUE_RUNS_PER_TEAM
  );
  const recentRuns = average(
    [
      safeNumber(game.homeTeam.offense.last7RunsPerGame),
      safeNumber(game.awayTeam.offense.last7RunsPerGame),
      safeNumber(game.homeTeam.offense.last14RunsPerGame),
      safeNumber(game.awayTeam.offense.last14RunsPerGame)
    ],
    seasonRuns
  );
  const averageOps = average(
    [
      safeNumber(game.homeTeam.offense.ops),
      safeNumber(game.awayTeam.offense.ops)
    ],
    LEAGUE_OPS
  );
  const averageOffenseFactor = (homeOffenseFactor + awayOffenseFactor) / 2;

  const seasonComponent = clamp(
    ((seasonRuns - LEAGUE_RUNS_PER_TEAM) / LEAGUE_RUNS_PER_TEAM) * 0.36,
    -0.18,
    0.18
  );
  const recentComponent = clamp(
    ((recentRuns - seasonRuns) / LEAGUE_RUNS_PER_TEAM) * 0.26,
    -0.12,
    0.12
  );
  const factorComponent = clamp((averageOffenseFactor - 1) * 0.48, -0.16, 0.16);
  const opsComponent = clamp(
    ((averageOps - LEAGUE_OPS) / LEAGUE_OPS) * 0.18,
    -0.08,
    0.08
  );

  return clamp(
    seasonComponent + recentComponent + factorComponent + opsComponent,
    -0.24,
    0.24
  );
}

function pitchingEnvironmentBias(game: NormalizedGameData): number {
  const averageStarterRa = average(
    [
      starterRunsAllowed(game.homeTeam.starter),
      starterRunsAllowed(game.awayTeam.starter)
    ],
    LEAGUE_STARTER_RA9
  );
  const averageBullpenRa = average(
    [
      bullpenRunsAllowed(game.homeTeam.bullpen),
      bullpenRunsAllowed(game.awayTeam.bullpen)
    ],
    LEAGUE_BULLPEN_RA9
  );

  const starterComponent = clamp(
    ((averageStarterRa - LEAGUE_STARTER_RA9) / LEAGUE_STARTER_RA9) * 0.26,
    -0.14,
    0.14
  );
  const bullpenComponent = clamp(
    ((averageBullpenRa - LEAGUE_BULLPEN_RA9) / LEAGUE_BULLPEN_RA9) * 0.18,
    -0.12,
    0.12
  );

  return clamp(starterComponent + bullpenComponent, -0.22, 0.22);
}

export function buildGameDistribution(
  game: NormalizedGameData,
  layerA: LayerAOutput
): GameDistribution {
  const homeOffense = offenseIndex(
    game.homeTeam.offense,
    game.homeTeam.core,
    game.homeTeam.lineupContext,
    game.awayTeam.starter.handedness
  );
  const awayOffense = offenseIndex(
    game.awayTeam.offense,
    game.awayTeam.core,
    game.awayTeam.lineupContext,
    game.homeTeam.starter.handedness
  );

  const awayPitchingFactor = fullGamePitchingFactor(game.awayTeam.starter, game.awayTeam.bullpen);
  const homePitchingFactor = fullGamePitchingFactor(game.homeTeam.starter, game.homeTeam.bullpen);
  const awayPitchingFactorF5 = f5PitchingFactor(game.awayTeam.starter, game.awayTeam.bullpen);
  const homePitchingFactorF5 = f5PitchingFactor(game.homeTeam.starter, game.homeTeam.bullpen);

  const envFactor = sharedEnvironmentFactor(game);
  const homeAdvantageRuns = homeFieldRuns(game);

  const rawHome = LEAGUE_RUNS_PER_TEAM * homeOffense * awayPitchingFactor * envFactor + homeAdvantageRuns;
  const rawAway = LEAGUE_RUNS_PER_TEAM * awayOffense * homePitchingFactor * envFactor;

  const rawHomeF5 =
    LEAGUE_RUNS_PER_TEAM * (5 / 9) * homeOffense * awayPitchingFactorF5 * envFactor +
    homeAdvantageRuns * 0.55;
  const rawAwayF5 = LEAGUE_RUNS_PER_TEAM * (5 / 9) * awayOffense * homePitchingFactorF5 * envFactor;

  const raw = deriveTotalsFromMeans(rawHome, rawAway);
  const rawF5 = deriveTotalsFromMeans(rawHomeF5, rawAwayF5);

  const projectionBias = projectionBiasFromGameScript(layerA);
  const totalsOffenseBias = offenseEnvironmentBias(game, homeOffense, awayOffense);
  const totalsPitchingBias = pitchingEnvironmentBias(game);
  const totalBias =
    projectionBias +
    clamp(layerA.blockScores.parkWeather / 100 * 0.22, -0.22, 0.22) +
    totalsOffenseBias +
    totalsPitchingBias;

  const sideBias =
    clamp(layerA.pregameScore / 100 * 1.05, -1.05, 1.05) * 0.34 +
    clamp(layerA.blockScores.starter / 100 * 0.55, -0.55, 0.55) * 0.28 +
    clamp(layerA.blockScores.teamStrength / 100 * 0.3, -0.3, 0.3) * 0.16 +
    clamp(layerA.blockScores.lineupContext / 100 * 0.24, -0.24, 0.24) * 0.12 +
    clamp(layerA.blockScores.marketContextLight / 100 * 0.16, -0.16, 0.16) * 0.1;

  const f5SideBias =
    clamp(layerA.blockScores.starter / 100 * 1.15, -1.15, 1.15) * 0.52 +
    clamp(layerA.blockScores.offense / 100 * 0.36, -0.36, 0.36) * 0.18 +
    clamp(layerA.blockScores.lineupContext / 100 * 0.24, -0.24, 0.24) * 0.14 +
    clamp(layerA.blockScores.marketContextLight / 100 * 0.15, -0.15, 0.15) * 0.08 +
    clamp(layerA.blockScores.teamStrength / 100 * 0.16, -0.16, 0.16) * 0.08;

  const adjustedTotal = clamp(raw.total + totalBias, 5.4, 12.8);
  const adjustedMargin = clamp(raw.margin * 0.66 + sideBias, -4.8, 4.8);

  const adjustedF5Total = clamp(rawF5.total + totalBias * 0.58, 2.4, 7.2);
  const adjustedF5Margin = clamp(rawF5.margin * 0.58 + f5SideBias, -3.4, 3.4);

  const muHome = clamp((adjustedTotal + adjustedMargin) / 2, 1.4, 7.2);
  const muAway = clamp((adjustedTotal - adjustedMargin) / 2, 1.2, 7.0);
  const muHomeF5 = clamp((adjustedF5Total + adjustedF5Margin) / 2, 0.7, 4.6);
  const muAwayF5 = clamp((adjustedF5Total - adjustedF5Margin) / 2, 0.7, 4.4);

  const settled = deriveTotalsFromMeans(muHome, muAway);
  const settledF5 = deriveTotalsFromMeans(muHomeF5, muAwayF5);

  const avgBullpenFatigue = average(
    [
      safeNumber(game.homeTeam.bullpen.fatigueScore),
      safeNumber(game.awayTeam.bullpen.fatigueScore)
    ],
    50
  );

  const totalStdDev = clamp(
    2.28 + settled.total * 0.055 + avgBullpenFatigue / 100 * 0.18,
    2.1,
    3.3
  );
  const marginStdDev = clamp(
    2.02 + settled.total * 0.04 + Math.abs(settled.margin) * 0.035,
    1.95,
    3.05
  );
  const f5TotalStdDev = clamp(
    1.6 + settledF5.total * 0.048 + avgBullpenFatigue / 100 * 0.06,
    1.55,
    2.45
  );
  const f5MarginStdDev = clamp(
    1.38 + settledF5.total * 0.04 + Math.abs(settledF5.margin) * 0.03,
    1.32,
    2.2
  );

  return {
    muHome,
    muAway,
    muHomeF5,
    muAwayF5,
    totalMean: settled.total,
    marginMean: settled.margin,
    totalStdDev,
    marginStdDev,
    f5TotalMean: settledF5.total,
    f5MarginMean: settledF5.margin,
    f5TotalStdDev,
    f5MarginStdDev
  };
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absX * absX);

  return sign * y;
}

function normalCdf(x: number, mean: number, stdDev: number): number {
  const sigma = stdDev <= 0 ? 1 : stdDev;
  const z = (x - mean) / (sigma * Math.sqrt(2));
  return clamp(0.5 * (1 + erf(z)), 0.01, 0.99);
}

export function impliedProbability(decimalOdds: number): number {
  if (!decimalOdds || decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}

export function expectedValue(probability: number, odds: number): number {
  return probability * (odds - 1) - (1 - probability);
}

export function fairOdds(probability: number): number {
  return probability > 0 ? 1 / probability : 0;
}

export function probabilityMoneyline(
  distribution: GameDistribution,
  side: 'home' | 'away',
  gameLength: 'full' | 'f5' = 'full'
): number {
  const mean = gameLength === 'full' ? distribution.marginMean : distribution.f5MarginMean;
  const stdDev = gameLength === 'full' ? distribution.marginStdDev : distribution.f5MarginStdDev;
  const teamMargin = side === 'home' ? mean : -mean;
  return clamp(1 - normalCdf(0, teamMargin, stdDev), 0.02, 0.98);
}

export function probabilityRunLine(
  distribution: GameDistribution,
  side: 'home' | 'away',
  line: number,
  gameLength: 'full' | 'f5' = 'full'
): number {
  const mean = gameLength === 'full' ? distribution.marginMean : distribution.f5MarginMean;
  const stdDev = gameLength === 'full' ? distribution.marginStdDev : distribution.f5MarginStdDev;
  const teamMargin = side === 'home' ? mean : -mean;
  const target = -(line ?? 0);
  return clamp(1 - normalCdf(target, teamMargin, stdDev), 0.02, 0.98);
}

export function probabilityTotal(
  distribution: GameDistribution,
  side: 'over' | 'under',
  line: number,
  gameLength: 'full' | 'f5' = 'full'
): number {
  const mean = gameLength === 'full' ? distribution.totalMean : distribution.f5TotalMean;
  const stdDev = gameLength === 'full' ? distribution.totalStdDev : distribution.f5TotalStdDev;

  if (side === 'over') {
    return clamp(1 - normalCdf(line, mean, stdDev), 0.02, 0.98);
  }

  return clamp(normalCdf(line, mean, stdDev), 0.02, 0.98);
}
