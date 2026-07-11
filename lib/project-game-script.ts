// lib/project-game-script.ts

import {
  AdvantageLabel,
  BlockScores,
  GameScriptOutput,
  LayerAOutput,
  NormalizedGameData,
  ScoringProjection,
  WeightProfileName
} from './types';
import { calculatePregameScore } from './score-game';
import { SCORING_THRESHOLDS } from './weights';

function getAdvantageLabel(score: number): AdvantageLabel {
  if (score >= SCORING_THRESHOLDS.strongEdgeMin) return 'strong_home';
  if (score >= SCORING_THRESHOLDS.leanEdgeMin) return 'lean_home';
  if (score <= -SCORING_THRESHOLDS.strongEdgeMin) return 'strong_away';
  if (score <= -SCORING_THRESHOLDS.leanEdgeMin) return 'lean_away';
  return 'neutral';
}

function getScoringProjection(
  game: NormalizedGameData,
  blockScores: BlockScores
): ScoringProjection {
  const averageSeasonRuns =
    [
      game.homeTeam.offense.runsPerGame,
      game.awayTeam.offense.runsPerGame,
      game.homeTeam.core.runsScoredPerGame,
      game.awayTeam.core.runsScoredPerGame
    ]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce((sum, value, _index, values) => sum + value / values.length, 0) || 4.35;

  const averageRecentRuns =
    [
      game.homeTeam.offense.last7RunsPerGame,
      game.awayTeam.offense.last7RunsPerGame,
      game.homeTeam.offense.last14RunsPerGame,
      game.awayTeam.offense.last14RunsPerGame
    ]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce((sum, value, _index, values) => sum + value / values.length, 0) || averageSeasonRuns;

  const averageOps =
    [
      game.homeTeam.offense.ops,
      game.awayTeam.offense.ops
    ]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce((sum, value, _index, values) => sum + value / values.length, 0) || 0.72;

  const averageStarterPrevention =
    [
      game.homeTeam.starter.xfip,
      game.homeTeam.starter.fip,
      game.homeTeam.starter.era,
      game.awayTeam.starter.xfip,
      game.awayTeam.starter.fip,
      game.awayTeam.starter.era
    ]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce((sum, value, _index, values) => sum + value / values.length, 0) || 4.2;

  const averageBullpenPrevention =
    [
      game.homeTeam.bullpen.fip,
      game.homeTeam.bullpen.era,
      game.awayTeam.bullpen.fip,
      game.awayTeam.bullpen.era
    ]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce((sum, value, _index, values) => sum + value / values.length, 0) || 4.15;

  const offenseEnvironment =
    ((averageSeasonRuns - 4.35) / 4.35) * 100 * 0.55 +
    ((averageRecentRuns - averageSeasonRuns) / 4.35) * 100 * 0.25 +
    ((averageOps - 0.72) / 0.72) * 100 * 0.2;

  const pitchingEnvironment =
    ((averageStarterPrevention - 4.2) / 4.2) * 100 * 0.55 +
    ((averageBullpenPrevention - 4.15) / 4.15) * 100 * 0.45;

  const totalEnvironment =
    blockScores.parkWeather * 0.42 +
    offenseEnvironment * 0.34 +
    pitchingEnvironment * 0.24;

  if (totalEnvironment >= SCORING_THRESHOLDS.totalHighMin) {
    return 'high';
  }

  if (totalEnvironment <= SCORING_THRESHOLDS.totalLowMax) {
    return 'low';
  }

  return 'medium';
}

function getF5Viability(blockScores: BlockScores): boolean {
  const starterEdge = Math.abs(blockScores.starter);
  const bullpenRisk = Math.abs(blockScores.bullpen);

  return (
    starterEdge >= SCORING_THRESHOLDS.f5StarterEdgeMin &&
    starterEdge > bullpenRisk
  );
}

function buildGameScript(
  game: NormalizedGameData,
  pregameScore: number,
  blockScores: BlockScores
): GameScriptOutput {
  return {
    advantageSide: getAdvantageLabel(pregameScore),
    scoringProjection: getScoringProjection(game, blockScores),
    starterEdge: getAdvantageLabel(blockScores.starter),
    bullpenEdge: getAdvantageLabel(blockScores.bullpen),
    offenseEdge: getAdvantageLabel(blockScores.offense),
    teamStrengthEdge: getAdvantageLabel(blockScores.teamStrength),
    f5Viable: getF5Viability(blockScores)
  };
}

export function projectGameScript(
  game: NormalizedGameData,
  profile: WeightProfileName = 'FULL_GAME_SIDE'
): LayerAOutput {
  const scoreResult = calculatePregameScore(game, profile);

  const gameScript = buildGameScript(
    game,
    scoreResult.finalScore,
    scoreResult.blockScores
  );

return {
  profileUsed: scoreResult.profile,
  pregameScore: scoreResult.finalScore,
  confidence: scoreResult.confidence,
  lean: scoreResult.lean,
  blockScores: scoreResult.blockScores,
  scoreBreakdown: scoreResult.breakdown,
  gameScript
};
}
