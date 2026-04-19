// lib/weights.ts

import { ScoringThresholds, WeightProfile, WeightProfileName } from './types';

export const FULL_GAME_SIDE: WeightProfile = {
  starter: 28,
  bullpen: 16,
  offense: 18,
  parkWeather: 10,
  teamStrength: 10,
  lineupContext: 10,
  marketContextLight: 8
};

export const F5_SIDE: WeightProfile = {
  starter: 40,
  bullpen: 8,
  offense: 22,
  parkWeather: 10,
  teamStrength: 8,
  lineupContext: 8,
  marketContextLight: 4
};

export const TOTAL_MARKET: WeightProfile = {
  starter: 22,
  bullpen: 18,
  offense: 20,
  parkWeather: 22,
  teamStrength: 8,
  lineupContext: 6,
  marketContextLight: 4
};

export const WEIGHT_PROFILES: Record<WeightProfileName, WeightProfile> = {
  FULL_GAME_SIDE,
  F5_SIDE,
  TOTAL_MARKET
};

export const DEFAULT_WEIGHT_PROFILE: WeightProfileName = 'FULL_GAME_SIDE';

export const SCORING_THRESHOLDS: ScoringThresholds = {
  strongEdgeMin: 25,
  leanEdgeMin: 10,
  totalHighMin: 18,
  totalLowMax: -18,
  f5StarterEdgeMin: 20
};

export function getWeightProfile(profile: WeightProfileName): WeightProfile {
  return WEIGHT_PROFILES[profile];
}

export function normalizeWeights(profile: WeightProfile): WeightProfile {
  const total =
    profile.starter +
    profile.bullpen +
    profile.offense +
    profile.parkWeather +
    profile.teamStrength +
    profile.lineupContext +
    profile.marketContextLight;

  if (!total) return profile;

  return {
    starter: profile.starter / total,
    bullpen: profile.bullpen / total,
    offense: profile.offense / total,
    parkWeather: profile.parkWeather / total,
    teamStrength: profile.teamStrength / total,
    lineupContext: profile.lineupContext / total,
    marketContextLight: profile.marketContextLight / total
  };
}