// lib/types.ts

export type MarketType = 'ML' | 'RL' | 'TOTAL' | 'F5' | 'PASS';
export type Side = 'home' | 'away';
export type TotalSide = 'over' | 'under';

export type AdvantageLabel =
  | 'strong_home'
  | 'lean_home'
  | 'neutral'
  | 'lean_away'
  | 'strong_away';

export type ScoringProjection = 'low' | 'medium' | 'high';

export type ConfidenceLevel = 'A' | 'B' | 'C' | 'PASS';
export type StarterTier =
  | 'elite'
  | 'strong'
  | 'average'
  | 'weak'
  | 'disaster'
  | 'low_sample_risk'
  | 'unknown';

export type WeightProfileName =
  | 'FULL_GAME_SIDE'
  | 'F5_SIDE'
  | 'TOTAL_MARKET';

export const LINEUP_QUALITY_ADJUSTMENT_MIN = -45;
export const LINEUP_QUALITY_ADJUSTMENT_MAX = 20;
export const LINEUP_QUALITY_ADJUSTMENT_DIFF_SCALE =
  LINEUP_QUALITY_ADJUSTMENT_MAX - LINEUP_QUALITY_ADJUSTMENT_MIN;

export interface TeamCoreStats {
  teamId?: string;
  teamName: string;
  abbreviation: string;
  isHome: boolean;

  record?: string;
  wins?: number;
  losses?: number;
  divisionRank?: number;

  last10Wins?: number;
  last10Losses?: number;
  streakType?: 'W' | 'L' | 'N';
  streakCount?: number;

  homeWins?: number;
  homeLosses?: number;
  awayWins?: number;
  awayLosses?: number;

  runsScoredPerGame?: number;
  runsAllowedPerGame?: number;
  runDifferentialPerGame?: number;
}

export interface StartingPitcherStats {
  playerId?: string;
  name?: string;
  headshot?: string;
  handedness?: 'R' | 'L' | 'S';

  era?: number;
  fip?: number;
  xfip?: number;
  whip?: number;

  inningsPitched?: number;
  expectedInnings?: number;

  strikeouts?: number;
  walks?: number;
  homeRuns?: number;

  strikeoutRate?: number;
  walkRate?: number;
  hrRate?: number;
  whiffRate?: number;
  kMinusBbRate?: number;
  babip?: number;
  flyBallRate?: number;
  pitchesPerInning?: number;

  recentEra?: number;
  recentWhip?: number;

  status?: 'confirmed' | 'probable' | 'unknown';
  source?: 'mlb_schedule_probable' | 'espn_probable' | 'unknown';
  sourceLabel?: string;
  sourceOk?: boolean;
  invalidReason?: string;
}

export interface BullpenStats {
  era?: number;
  fip?: number;
  whip?: number;

  last3DaysInnings?: number;
  last2DaysInnings?: number;

  closerAvailable?: boolean;
  setupAvailable?: boolean;

  fatigueScore?: number; // 0-100, donde 100 = muy fatigado

  source?: 'team_stat_split' | 'active_reliever_aggregate' | 'espn_base_fallback';
  sourceLabel?: string;
  isFallback?: boolean;
  fallbackReason?: string;
}

export interface OffenseStats {
  runsPerGame?: number;
  battingAverage?: number;
  onBasePct?: number;
  sluggingPct?: number;
  ops?: number;
  wrcPlus?: number;

  vsRightOps?: number;
  vsLeftOps?: number;

  last7RunsPerGame?: number;
  last14RunsPerGame?: number;
}

export interface LineupContextStats {
  confirmedLineup?: boolean;
  missingKeyBatCount?: number;
  missingKeyBatters?: string[];

  catcherBackup?: boolean;
  restDisadvantage?: boolean;

  lineupQualityAdjustment?: number; // -100 a 100
}

export interface ParkWeatherStats {
  venueName?: string;
  parkFactorRuns?: number;
  parkFactorHr?: number;

  temperatureF?: number;
  windMph?: number;
  windDirection?: 'out' | 'in' | 'cross' | 'unknown';

  rainRiskPct?: number;
  roofClosed?: boolean;
}

export interface MarketContextLightStats {
  lineMovementPct?: number; // -100 a 100
  ticketSplitPctHome?: number;
  ticketSplitPctAway?: number;
  sharpSignal?: number; // -100 a 100
}

export interface TeamGameInput {
  core: TeamCoreStats;
  starter: StartingPitcherStats;
  bullpen: BullpenStats;
  offense: OffenseStats;
  lineupContext: LineupContextStats;
}

export interface GameOddsInput {
  homeML?: number;
  awayML?: number;

  homeRL?: {
    line: number;
    odds: number;
  };
  awayRL?: {
    line: number;
    odds: number;
  };

  total?: {
    line: number;
    overOdds: number;
    underOdds: number;
  };

  homeF5ML?: number;
  awayF5ML?: number;

  homeF5RL?: {
    line: number;
    odds: number;
  };
  awayF5RL?: {
    line: number;
    odds: number;
  };

  f5Total?: {
    line: number;
    overOdds: number;
    underOdds: number;
  };
}

export interface NormalizedGameData {
  gameId: string;
  sport: 'MLB';
  league: 'MLB';

  startTime?: string;
  status?: string;

  homeTeam: TeamGameInput;
  awayTeam: TeamGameInput;

  parkWeather: ParkWeatherStats;
  marketContextLight: MarketContextLightStats;

  odds?: GameOddsInput;
}

export interface BlockScores {
  starter: number; // -100 a 100
  bullpen: number; // -100 a 100
  offense: number; // -100 a 100
  parkWeather: number; // -100 a 100
  teamStrength: number; // -100 a 100
  lineupContext: number; // -100 a 100
  marketContextLight: number; // -100 a 100
}

export interface WeightProfile {
  starter: number;
  bullpen: number;
  offense: number;
  parkWeather: number;
  teamStrength: number;
  lineupContext: number;
  marketContextLight: number;
}

export interface PregameScoreResult {
  profile: WeightProfileName;
  weights: WeightProfile;
  blockScores: BlockScores;
  breakdown?: ScoreBreakdownEntry[];
  finalScore: number; // -100 a 100
  lean: 'home' | 'away' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
}

export interface GameScriptOutput {
  advantageSide: AdvantageLabel;
  scoringProjection: ScoringProjection;
  starterEdge: AdvantageLabel;
  bullpenEdge: AdvantageLabel;
  offenseEdge: AdvantageLabel;
  teamStrengthEdge: AdvantageLabel;
  f5Viable: boolean;
}

export interface LayerAOutput {
  profileUsed: WeightProfileName;
  pregameScore: number;
  confidence: 'low' | 'medium' | 'high';
  lean: 'home' | 'away' | 'neutral';
  blockScores: BlockScores;
  scoreBreakdown?: ScoreBreakdownEntry[];
  gameScript: GameScriptOutput;
}

export interface ScoreBreakdownEntry {
  block: keyof BlockScores;
  score: number;
  weight: number;
  contribution: number;
}

export interface MarketEvaluation {
  market: Exclude<MarketType, 'PASS'>;
  selection: string;
  line?: number;

  odds: number;
  estimatedProbability: number; // 0-1
  rawEstimatedProbability?: number;
  impliedProbability: number; // 0-1
  edge: number; // estimated - implied
  ev: number; // expected value
  pRaw?: number | null;
  pCalibrated?: number | null;
  edgeRaw?: number | null;
  edgeCalibrated?: number | null;
  evRaw?: number | null;
  evCalibrated?: number | null;

  confidence: ConfidenceLevel;
  reason: string;
  selectionScore?: number;
  marketSuitability?: MarketSuitabilityAudit;
}

export interface StoredAlternativeMarket {
  market: Exclude<MarketType, 'PASS'>;
  selection: string;
  line?: number;
  odds: number;
  estimatedProbability: number;
  rawEstimatedProbability?: number;
  impliedProbability: number;
  edge: number;
  ev: number;
  pRaw?: number | null;
  pCalibrated?: number | null;
  edgeRaw?: number | null;
  edgeCalibrated?: number | null;
  evRaw?: number | null;
  evCalibrated?: number | null;
  confidence: ConfidenceLevel;
  reason: string;
  selectionScore?: number;
  marketSuitability?: MarketSuitabilityAudit;
}

export interface FinalPickDecision {
  market: MarketType;
  selection: string;
  line?: number;
  odds?: number;

  estimatedProbability?: number;
  rawEstimatedProbability?: number;
  impliedProbability?: number;
  edge?: number;
  ev?: number;
  pRaw?: number | null;
  pCalibrated?: number | null;
  edgeRaw?: number | null;
  edgeCalibrated?: number | null;
  evRaw?: number | null;
  evCalibrated?: number | null;
  selectionScore?: number;

  confidence: ConfidenceLevel;
  executionReason: string;
  marketSuitability?: MarketSuitabilityAudit;

  altMarket1?: string;
  altMarket2?: string;

  passReason?: string;

  debug?: {
    initialProfileUsed?: WeightProfileName;
    preliminaryBestMarket?: MarketType;
    recalculatedProfileUsed?: WeightProfileName;
    initialPregameScore?: number;
    recalculatedPregameScore?: number;
    candidateCountBeforeRecalc?: number;
    candidateCountAfterRecalc?: number;
    recalculatedScoreBreakdown?: ScoreBreakdownEntry[];
    marketAudit?: MarketSuitabilityAudit[];
  };
}

export interface StarterClassification {
  tier: StarterTier;
  score: number;
  reliability: number;
  label: string;
  reasons: string[];
}

export interface MarketSuitabilityAudit {
  score: number;
  scoreAdjustment: number;
  confidenceCap?: Exclude<ConfidenceLevel, 'PASS'>;
  tags: string[];
  notes: string[];
  starter: {
    home: StarterClassification;
    away: StarterClassification;
  };
  totalSupport?: {
    bilateral: boolean;
    environmentOk: boolean;
    lineupOk: boolean;
    eliteSuppression: boolean;
    projectedHomeRuns: number;
    projectedAwayRuns: number;
    projectedTotal: number;
  };
}

export interface ScoringThresholds {
  strongEdgeMin: number;
  leanEdgeMin: number;
  totalHighMin: number;
  totalLowMax: number;
  f5StarterEdgeMin: number;
}

export interface ScoreBlockContext {
  game: NormalizedGameData;
}

export interface PickRecordInsert {
  gameId: string;
  sport: 'MLB';
  market: MarketType;
  selection: string;
  line?: number;
  odds?: number;
  confidence: ConfidenceLevel;
  estimatedProbability?: number;
  impliedProbability?: number;
  edge?: number;
  ev?: number;
  reason: string;
  altMarket1?: string;
  altMarket2?: string;
  status?: 'pending' | 'won' | 'lost' | 'void';
}
