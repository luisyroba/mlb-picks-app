// lib/score-blocks.ts

import {
  BlockScores,
  LINEUP_QUALITY_ADJUSTMENT_DIFF_SCALE,
  NormalizedGameData,
  TeamCoreStats
} from './types';

function clampScore(value: number, min = -100, max = 100): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: number | undefined | null, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function starterAdvancedReliability(inningsPitched?: number | null): number {
  if (!hasNumber(inningsPitched)) return 0.05;
  return Math.max(0.05, Math.min(1, (inningsPitched - 12) / 38));
}

function normalizeDiff(
  homeValue: number,
  awayValue: number,
  scale: number
): number {
  if (!scale || !Number.isFinite(scale)) return 0;
  return clampScore(((homeValue - awayValue) / scale) * 100);
}

function invertNormalizeDiff(
  homeValue: number,
  awayValue: number,
  scale: number
): number {
  if (!scale || !Number.isFinite(scale)) return 0;
  return clampScore(((awayValue - homeValue) / scale) * 100);
}

function boolEdge(
  homeValue: boolean | undefined,
  awayValue: boolean | undefined,
  points: number
): number {
  const home = homeValue === true;
  const away = awayValue === true;

  if (home === away) return 0;
  return home ? points : -points;
}

function combineWeightedSignals(
  signals: Array<{ value: number | null; weight: number }>,
  min = -100,
  max = 100
): number {
  const active = signals.filter(
    (signal) => signal.value !== null && Number.isFinite(signal.value)
  );

  if (!active.length) return 0;

  const totalWeight = active.reduce((sum, signal) => sum + signal.weight, 0);
  if (!totalWeight) return 0;

  const combined = active.reduce((sum, signal) => {
    return sum + (signal.value ?? 0) * (signal.weight / totalWeight);
  }, 0);

  return clampScore(combined, min, max);
}

function getTeamStrengthSubscore(team: TeamCoreStats): number {
  let score = 0;

  const wins = safeNumber(team.wins);
  const losses = safeNumber(team.losses);
  const gamesPlayed = wins + losses;
  const winPct = gamesPlayed > 0 ? wins / gamesPlayed : 0.5;

  score += (winPct - 0.5) * 120;

  const runDiff = safeNumber(team.runDifferentialPerGame);
  score += runDiff * 18;

  if (team.isHome) {
    const hw = safeNumber(team.homeWins);
    const hl = safeNumber(team.homeLosses);
    const hg = hw + hl;
    const homePct = hg > 0 ? hw / hg : 0.5;
    score += (homePct - 0.5) * 40;
  } else {
    const aw = safeNumber(team.awayWins);
    const al = safeNumber(team.awayLosses);
    const ag = aw + al;
    const awayPct = ag > 0 ? aw / ag : 0.5;
    score += (awayPct - 0.5) * 40;
  }

  return clampScore(score);
}

export function scoreStarter(game: NormalizedGameData): number {
  const home = game.homeTeam.starter;
  const away = game.awayTeam.starter;
  const advancedReliability =
    (starterAdvancedReliability(home.inningsPitched) +
      starterAdvancedReliability(away.inningsPitched)) /
    2;
  const descriptiveBoost = 1 - advancedReliability;

  let score = combineWeightedSignals([
    {
      value:
        hasNumber(home.era) && hasNumber(away.era)
          ? invertNormalizeDiff(home.era, away.era, 2.5)
          : null,
      weight: 0.18 + descriptiveBoost * 0.16
    },
    {
      value:
        hasNumber(home.fip) && hasNumber(away.fip)
          ? invertNormalizeDiff(home.fip, away.fip, 2.0)
          : null,
      weight: 0.2 * advancedReliability
    },
    {
      value:
        hasNumber(home.xfip) && hasNumber(away.xfip)
          ? invertNormalizeDiff(home.xfip, away.xfip, 2.0)
          : null,
      weight: 0.12 * advancedReliability
    },
    {
      value:
        hasNumber(home.whip) && hasNumber(away.whip)
          ? invertNormalizeDiff(home.whip, away.whip, 0.5)
          : null,
      weight: 0.14 + descriptiveBoost * 0.08
    },
    {
      value:
        hasNumber(home.strikeoutRate) && hasNumber(away.strikeoutRate)
          ? normalizeDiff(home.strikeoutRate, away.strikeoutRate, 10)
          : null,
      weight: 0.08
    },
    {
      value:
        hasNumber(home.kMinusBbRate) && hasNumber(away.kMinusBbRate)
          ? normalizeDiff(home.kMinusBbRate, away.kMinusBbRate, 18)
          : null,
      weight: 0.08 * advancedReliability
    },
    {
      value:
        hasNumber(home.whiffRate) && hasNumber(away.whiffRate)
          ? normalizeDiff(home.whiffRate, away.whiffRate, 12)
          : null,
      weight: 0.05 * advancedReliability
    },
    {
      value:
        hasNumber(home.walkRate) && hasNumber(away.walkRate)
          ? invertNormalizeDiff(home.walkRate, away.walkRate, 5)
          : null,
      weight: 0.05
    },
    {
      value:
        hasNumber(home.babip) && hasNumber(away.babip)
          ? invertNormalizeDiff(home.babip, away.babip, 0.08)
          : null,
      weight: 0.035 * advancedReliability
    },
    {
      value:
        hasNumber(home.pitchesPerInning) && hasNumber(away.pitchesPerInning)
          ? invertNormalizeDiff(home.pitchesPerInning, away.pitchesPerInning, 4)
          : null,
      weight: 0.035 * advancedReliability
    },
    {
      value:
        hasNumber(home.hrRate) && hasNumber(away.hrRate)
          ? invertNormalizeDiff(home.hrRate, away.hrRate, 0.8)
          : null,
      weight: 0.05
    },
    {
      value:
        hasNumber(home.expectedInnings) && hasNumber(away.expectedInnings)
          ? normalizeDiff(home.expectedInnings, away.expectedInnings, 2)
          : null,
      weight: 0.06
    }
  ]);

  if (home.status === 'confirmed' && away.status !== 'confirmed') score += 4;
  if (away.status === 'confirmed' && home.status !== 'confirmed') score -= 4;

  return clampScore(score);
}

export function scoreBullpen(game: NormalizedGameData): number {
  const home = game.homeTeam.bullpen;
  const away = game.awayTeam.bullpen;

  let score = combineWeightedSignals([
    {
      value:
        hasNumber(home.era) && hasNumber(away.era)
          ? invertNormalizeDiff(home.era, away.era, 3.2)
          : null,
      weight: 0.3
    },
    {
      value:
        hasNumber(home.fip) && hasNumber(away.fip)
          ? invertNormalizeDiff(home.fip, away.fip, 3.0)
          : null,
      weight: 0.24
    },
    {
      value:
        hasNumber(home.whip) && hasNumber(away.whip)
          ? invertNormalizeDiff(home.whip, away.whip, 0.55)
          : null,
      weight: 0.16
    },
    {
      value:
        hasNumber(home.fatigueScore) && hasNumber(away.fatigueScore)
          ? invertNormalizeDiff(home.fatigueScore, away.fatigueScore, 50)
          : null,
      weight: 0.12
    },
    {
      value:
        hasNumber(home.last3DaysInnings) && hasNumber(away.last3DaysInnings)
          ? invertNormalizeDiff(home.last3DaysInnings, away.last3DaysInnings, 10)
          : null,
      weight: 0.1
    },
    {
      value:
        hasNumber(home.last2DaysInnings) && hasNumber(away.last2DaysInnings)
          ? invertNormalizeDiff(home.last2DaysInnings, away.last2DaysInnings, 6)
          : null,
      weight: 0.08
    }
  ], -58, 58);

  if (home.closerAvailable !== undefined || away.closerAvailable !== undefined) {
    score += boolEdge(home.closerAvailable, away.closerAvailable, 6);
  }

  if (home.setupAvailable !== undefined || away.setupAvailable !== undefined) {
    score += boolEdge(home.setupAvailable, away.setupAvailable, 4);
  }

  return clampScore(score, -58, 58);
}

export function scoreOffense(game: NormalizedGameData): number {
  const home = game.homeTeam.offense;
  const away = game.awayTeam.offense;

  const homeStarterHand = game.homeTeam.starter.handedness;
  const awayStarterHand = game.awayTeam.starter.handedness;

  const score = combineWeightedSignals([
    {
      value:
        hasNumber(home.runsPerGame) && hasNumber(away.runsPerGame)
          ? normalizeDiff(home.runsPerGame, away.runsPerGame, 3.0)
          : null,
      weight: 0.26
    },
    {
      value:
        hasNumber(home.ops) && hasNumber(away.ops)
          ? normalizeDiff(home.ops, away.ops, 0.18)
          : null,
      weight: 0.2
    },
    {
      value:
        hasNumber(home.onBasePct) && hasNumber(away.onBasePct)
          ? normalizeDiff(home.onBasePct, away.onBasePct, 0.08)
          : null,
      weight: 0.08
    },
    {
      value:
        hasNumber(home.sluggingPct) && hasNumber(away.sluggingPct)
          ? normalizeDiff(home.sluggingPct, away.sluggingPct, 0.14)
          : null,
      weight: 0.08
    },
    {
      value:
        hasNumber(home.last7RunsPerGame) && hasNumber(away.last7RunsPerGame)
          ? normalizeDiff(home.last7RunsPerGame, away.last7RunsPerGame, 3.0)
          : null,
      weight: 0.08
    },
    {
      value: (() => {
        const homeSplit =
          awayStarterHand === 'L' ? home.vsLeftOps : home.vsRightOps;
        const awaySplit =
          homeStarterHand === 'L' ? away.vsLeftOps : away.vsRightOps;

        if (!hasNumber(homeSplit) || !hasNumber(awaySplit)) {
          return null;
        }

        return normalizeDiff(homeSplit, awaySplit, 0.18);
      })(),
      weight: 0.18
    },
    {
      value:
        hasNumber(home.wrcPlus) && hasNumber(away.wrcPlus)
          ? normalizeDiff(home.wrcPlus, away.wrcPlus, 45)
          : null,
      weight: 0.08
    },
    {
      value:
        hasNumber(home.last14RunsPerGame) && hasNumber(away.last14RunsPerGame)
          ? normalizeDiff(home.last14RunsPerGame, away.last14RunsPerGame, 3.0)
          : null,
      weight: 0.06
    }
  ], -75, 75);
  return score;
}

export function scoreParkWeather(game: NormalizedGameData): number {
  const park = game.parkWeather;
  let score = 0;

  const parkRuns = safeNumber(park.parkFactorRuns, 100);
  const parkHr = safeNumber(park.parkFactorHr, 100);
  const temp = safeNumber(park.temperatureF, 70);
  const wind = safeNumber(park.windMph, 0);
  const rain = safeNumber(park.rainRiskPct, 0);

  const runBoost = (parkRuns - 100) * 0.6;
  const hrBoost = (parkHr - 100) * 0.35;
  const tempBoost = (temp - 70) * 0.7;

  let windBoost = 0;
  if (park.windDirection === 'out') windBoost = wind * 2.4;
  if (park.windDirection === 'in') windBoost = -wind * 2.4;
  if (park.windDirection === 'cross') windBoost = wind * 0.4;

  const rainPenalty = rain * 0.25;

  score += runBoost;
  score += hrBoost;
  score += tempBoost;
  score += windBoost;
  score -= rainPenalty;

  return clampScore(score);
}

export function scoreTeamStrength(game: NormalizedGameData): number {
  const homeScore = getTeamStrengthSubscore(game.homeTeam.core);
  const awayScore = getTeamStrengthSubscore(game.awayTeam.core);

  let score = clampScore(homeScore - awayScore);

  const starterEdge = Math.abs(scoreStarter(game));
  if (starterEdge >= 35) {
    score *= 0.72;
  }

  return clampScore(score);
}

export function scoreLineupContext(game: NormalizedGameData): number {
  const home = game.homeTeam.lineupContext;
  const away = game.awayTeam.lineupContext;

  let score = 0;

  score += normalizeDiff(
    safeNumber(home.lineupQualityAdjustment, 0),
    safeNumber(away.lineupQualityAdjustment, 0),
    LINEUP_QUALITY_ADJUSTMENT_DIFF_SCALE
  ) * 0.45;

  score += invertNormalizeDiff(
    safeNumber(home.missingKeyBatCount, 0),
    safeNumber(away.missingKeyBatCount, 0),
    4
  ) * 0.3;

  score += boolEdge(home.confirmedLineup, away.confirmedLineup, 8);
  score += invertNormalizeDiff(
    Number(home.restDisadvantage === true),
    Number(away.restDisadvantage === true),
    1
  ) * 0.1;

  score += invertNormalizeDiff(
    Number(home.catcherBackup === true),
    Number(away.catcherBackup === true),
    1
  ) * 0.05;

  return clampScore(score);
}

export function scoreMarketContextLight(game: NormalizedGameData): number {
  const market = game.marketContextLight;

  return combineWeightedSignals([
    {
      value:
        hasNumber(market.lineMovementPct)
          ? clampScore(market.lineMovementPct)
          : null,
      weight: 0.45
    },
    {
      value:
        hasNumber(market.sharpSignal)
          ? clampScore(market.sharpSignal)
          : null,
      weight: 0.4
    },
    {
      value:
        hasNumber(market.ticketSplitPctHome) &&
        hasNumber(market.ticketSplitPctAway)
          ? normalizeDiff(market.ticketSplitPctHome, market.ticketSplitPctAway, 50)
          : null,
      weight: 0.15
    }
  ]);
}

export function getAllBlockScores(game: NormalizedGameData): BlockScores {
  return {
    starter: scoreStarter(game),
    bullpen: scoreBullpen(game),
    offense: scoreOffense(game),
    parkWeather: scoreParkWeather(game),
    teamStrength: scoreTeamStrength(game),
    lineupContext: scoreLineupContext(game),
    marketContextLight: scoreMarketContextLight(game)
  };
}
