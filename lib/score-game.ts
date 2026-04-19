// lib/score-game.ts

import {
  BlockScores,
  NormalizedGameData,
  PregameScoreResult,
  WeightProfile,
  WeightProfileName
} from './types';
import {
  DEFAULT_WEIGHT_PROFILE,
  getWeightProfile,
  normalizeWeights
} from './weights';
import { getAllBlockScores } from './score-blocks';

function clampScore(value: number, min = -100, max = 100): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function weightedScore(blockScores: BlockScores, weights: WeightProfile): number {
  return (
    blockScores.starter * weights.starter +
    blockScores.bullpen * weights.bullpen +
    blockScores.offense * weights.offense +
    blockScores.parkWeather * weights.parkWeather +
    blockScores.teamStrength * weights.teamStrength +
    blockScores.lineupContext * weights.lineupContext +
    blockScores.marketContextLight * weights.marketContextLight
  );
}

export function calculatePregameScore(
  game: NormalizedGameData,
  profileName: WeightProfileName = DEFAULT_WEIGHT_PROFILE
): PregameScoreResult {
  const rawProfile = getWeightProfile(profileName);
  const weights = normalizeWeights(rawProfile);

  const blockScores = getAllBlockScores(game);
  const finalScore = clampScore(weightedScore(blockScores, weights));

  const lean =
    finalScore > 0 ? 'home' :
    finalScore < 0 ? 'away' :
    'neutral';

  const absScore = Math.abs(finalScore);

  const confidence =
    absScore >= 25 ? 'high' :
    absScore >= 12 ? 'medium' :
    'low';

  return {
    profile: profileName,
    weights,
    blockScores,
    finalScore,
    lean,
    confidence
  };
}

export function recalculatePregameScore(
  game: NormalizedGameData,
  profileName: WeightProfileName
): PregameScoreResult {
  return calculatePregameScore(game, profileName);
}

export function calculatePregameScoreFromBlocks(
  blockScores: BlockScores,
  profileName: WeightProfileName = DEFAULT_WEIGHT_PROFILE
): PregameScoreResult {
  const rawProfile = getWeightProfile(profileName);
  const weights = normalizeWeights(rawProfile);

  const finalScore = clampScore(weightedScore(blockScores, weights));

  const lean =
    finalScore > 0 ? 'home' :
    finalScore < 0 ? 'away' :
    'neutral';

  const absScore = Math.abs(finalScore);

  const confidence =
    absScore >= 25 ? 'high' :
    absScore >= 12 ? 'medium' :
    'low';

  return {
    profile: profileName,
    weights,
    blockScores,
    finalScore,
    lean,
    confidence
  };
}