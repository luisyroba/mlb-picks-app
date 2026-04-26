"use strict";
// lib/weights.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCORING_THRESHOLDS = exports.DEFAULT_WEIGHT_PROFILE = exports.WEIGHT_PROFILES = exports.TOTAL_MARKET = exports.F5_SIDE = exports.FULL_GAME_SIDE = void 0;
exports.getWeightProfile = getWeightProfile;
exports.normalizeWeights = normalizeWeights;
exports.FULL_GAME_SIDE = {
    starter: 28,
    bullpen: 16,
    offense: 18,
    parkWeather: 10,
    teamStrength: 10,
    lineupContext: 10,
    marketContextLight: 8
};
exports.F5_SIDE = {
    starter: 40,
    bullpen: 8,
    offense: 22,
    parkWeather: 10,
    teamStrength: 8,
    lineupContext: 8,
    marketContextLight: 4
};
exports.TOTAL_MARKET = {
    starter: 22,
    bullpen: 18,
    offense: 20,
    parkWeather: 22,
    teamStrength: 8,
    lineupContext: 6,
    marketContextLight: 4
};
exports.WEIGHT_PROFILES = {
    FULL_GAME_SIDE: exports.FULL_GAME_SIDE,
    F5_SIDE: exports.F5_SIDE,
    TOTAL_MARKET: exports.TOTAL_MARKET
};
exports.DEFAULT_WEIGHT_PROFILE = 'FULL_GAME_SIDE';
exports.SCORING_THRESHOLDS = {
    strongEdgeMin: 25,
    leanEdgeMin: 10,
    totalHighMin: 18,
    totalLowMax: -18,
    f5StarterEdgeMin: 20
};
function getWeightProfile(profile) {
    return exports.WEIGHT_PROFILES[profile];
}
function normalizeWeights(profile) {
    const total = profile.starter +
        profile.bullpen +
        profile.offense +
        profile.parkWeather +
        profile.teamStrength +
        profile.lineupContext +
        profile.marketContextLight;
    if (!total)
        return profile;
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
