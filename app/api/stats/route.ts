import { NextResponse } from 'next/server';
import {
  getLatestMarketSnapshotsByGameIds,
  getPregameSnapshotsByIds,
  getOddsBoardCache,
  listConfirmedPicks,
  getPremiumDailyLock,
  createPremiumDailyLock,
  closePremiumDailyLock,
  supabase
} from '@/lib/db';
import { resolveMatchupLabel } from '@/lib/matchup-label';
import { expectedValue, impliedProbability } from '@/lib/probability-model';
import {
  ODDS_REFRESH_COOLDOWN_MS,
  LIVE_STATS_CUTOFF_DATE_KEY,
  SOLID_PICK_RESET_DATE_KEYS,
  USER_TIMEZONE
} from '@/lib/runtime-config';
import { getSlateDayKey } from '@/lib/slate-day';
import { buildVercelBudgetSummary } from '@/lib/vercel-ops';

const SUPABASE_FREE_DB_LIMIT_MB = 500;
const ODDS_MONTHLY_LIMIT = 2500;
const ODDS_REFRESH_COOLDOWN_MINUTES = Math.round(ODDS_REFRESH_COOLDOWN_MS / 60000);
const PREMIUM_LOCK_MINUTES = 10;
const RECENT_UI_LIMIT = 40;

type StatsPickRecord = Record<string, unknown> & {
  game_date_key: string | null;
  game_start_time: string | null;
  game_label: string;
};

type PremiumPickResult = {
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  confidence: string;
  score: number;
  edge: number | null;
  ev: number | null;
  estimatedProbability: number | null;
  impliedProbability: number | null;
  executionOdds: number | null;
  gameStartTime: string | null;
  lockedAt?: string;
  lockReason?: string;
};

type BucketSummary = {
  key: string;
  total: number;
  settled: number;
  won: number;
  lost: number;
  void: number;
  pending: number;
  winRate: number | null;
  profitUnits: number;
  avgEdge: number | null;
  avgEv: number | null;
};

type TrendPoint = {
  date: string;
  settled: number;
  graded: number;
  won: number;
  lost: number;
  dailyProfitUnits: number;
  cumulativeProfitUnits: number;
  cumulativeRoi: number | null;
  cumulativeWinRate: number | null;
};

type StorageBreakdown = {
  key: string;
  rows: number;
  approxMb: number;
};

type SolidPickPoint = {
  date: string;
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  confidence: string;
  status: string;
  score: number;
  edge: number | null;
  ev: number | null;
  estimatedProbability: number | null;
  executionOdds: number | null;
  profitUnits: number | null;
  createdAt: string;
  updatedAt: string;
};

type TodayRankingItem = {
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  confidence: string;
  score: number;
  edge: number | null;
  ev: number | null;
  estimatedProbability: number | null;
  impliedProbability: number | null;
  executionOdds: number | null;
  gameStartTime: string | null;
  prevScore: number | null;
  prevEdge: number | null;
  prevEv: number | null;
  prevEstimatedProbability: number | null;
  prevImpliedProbability: number | null;
  prevExecutionOdds: number | null;
};

type SliceSummary = {
  totalPicks: number;
  settledCount: number;
  gradedCount: number;
  pendingCount: number;
  wonCount: number;
  lostCount: number;
  voidCount: number;
  winRate: number | null;
  totalProfitUnits: number;
  roi: number | null;
  avgEdge: number | null;
  avgEv: number | null;
};

type SlicePremiumSummary = {
  total: number;
  settled: number;
  won: number;
  lost: number;
  void: number;
  pending: number;
  winRate: number | null;
  currentStreak: { type: 'won' | 'lost'; count: number } | null;
};

type PremiumRankSummary = {
  rank: 1 | 2 | 3;
  summary: SlicePremiumSummary;
};

type PremiumRankHistory = {
  rank: 1 | 2 | 3;
  summary: SlicePremiumSummary;
  history: SolidPickPoint[];
};

type DailyPremiumTopPick = {
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  confidence: string;
  status: string;
  profitUnits: number | null;
};

type DailySummaryItem = {
  date: string;
  settled: number;
  graded: number;
  won: number;
  lost: number;
  void: number;
  pending: number;
  profitUnits: number;
  roi: number | null;
  premiumTopPick: DailyPremiumTopPick | null;
};

type SlicePremiumView = {
  summary: SlicePremiumSummary;
  rankSummaries: PremiumRankSummary[];
  rankHistories: PremiumRankHistory[];
  history: SolidPickPoint[];
  currentPick: PremiumPickResult | null;
  todayRanking: TodayRankingItem[];
  isLocked: boolean;
  isClosed: boolean;
  betterPickPostLock: boolean;
  betterPick: PremiumPickResult | null;
};

type DisplaySlice = {
  key: string;
  label: string;
  mode: 'testing' | 'live';
  startDate: string | null;
  endDate: string | null;
  summary: SliceSummary;
  byMarket: BucketSummary[];
  byConfidence: BucketSummary[];
  byEdgeRange: BucketSummary[];
  trend: TrendPoint[];
  premium: SlicePremiumView;
  daily: DailySummaryItem[];
};

type LivePeriodMeta = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  hasData: boolean;
};

type CurrentPremiumContext = {
  todayDateKey: string;
  premiumPick: PremiumPickResult | null;
  todayRanking: TodayRankingItem[];
  isLocked: boolean;
  isClosed: boolean;
  betterPickPostLock: boolean;
  betterPick: PremiumPickResult | null;
};

const EDGE_BAND_ORDER = ['7%+', '4-7%', '2-4%', '<2%', 'Sin edge'];

function parseDateKey(dateKey: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }

  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getSundayOnOrAfterDateKey(dateKey: string): string {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;

  const daysUntilSunday = (7 - date.getUTCDay()) % 7;
  return addDaysToDateKey(dateKey, daysUntilSunday);
}

function formatPeriodLabel(startDate: string, endDate: string): string {
  return `${startDate.slice(8)}-${endDate.slice(8)}`;
}

function buildLivePeriods(
  cutoffDateKey: string,
  throughDateKey: string,
  todayDateKey: string,
  picks: Array<Record<string, unknown>>
): LivePeriodMeta[] {
  if (throughDateKey < cutoffDateKey) {
    return [];
  }

  const liveDateKeys = new Set(
    picks
      .map((pick) => getPickAuditDateKey(pick))
      .filter(
        (dateKey): dateKey is string =>
          typeof dateKey === 'string' && dateKey >= cutoffDateKey
      )
  );

  const periods: LivePeriodMeta[] = [];
  let startDate = cutoffDateKey;
  let endDate = getSundayOnOrAfterDateKey(cutoffDateKey);

  while (startDate <= throughDateKey) {
    periods.push({
      key: `${startDate}:${endDate}`,
      label: formatPeriodLabel(startDate, endDate),
      startDate,
      endDate,
      isCurrent: todayDateKey >= startDate && todayDateKey <= endDate,
      hasData: [...liveDateKeys].some((dateKey) => dateKey >= startDate && dateKey <= endDate)
    });

    startDate = addDaysToDateKey(endDate, 1);
    endDate = addDaysToDateKey(startDate, 6);
  }

  return periods;
}

function getGameDate(snapshotStartTime?: string | null, fallback?: string | null): string | null {
  if (snapshotStartTime) return snapshotStartTime;
  return fallback ?? null;
}

function formatSignedLine(line?: number | null): string | null {
  if (typeof line !== 'number' || !Number.isFinite(line)) return null;
  return `${line > 0 ? '+' : ''}${line.toFixed(1)}`;
}

function buildExecutionTitle(pick: Record<string, unknown>): string {
  const market = String(pick.execution_market ?? pick.market ?? '');
  const selection = String(pick.execution_selection ?? pick.selection ?? 'NO BET');
  const line =
    typeof pick.execution_line === 'number'
      ? pick.execution_line
      : typeof pick.line === 'number'
        ? pick.line
        : null;

  if (
    (market === 'TOTAL' ||
      selection.toLowerCase().startsWith('over') ||
      selection.toLowerCase().startsWith('under')) &&
    line !== null
  ) {
    return `${selection} ${line}`;
  }

  if (line !== null) {
    const formattedLine = formatSignedLine(line);
    return formattedLine ? `${selection} ${formattedLine}` : selection;
  }

  return selection;
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}


function getEffectiveImpliedProbability(pick: Record<string, unknown>): number | null {
  const executionOdds =
    typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
      ? pick.execution_odds
      : null;

  if (executionOdds && executionOdds > 1) {
    return impliedProbability(executionOdds);
  }

  return typeof pick.implied_probability === 'number' && Number.isFinite(pick.implied_probability)
    ? pick.implied_probability
    : null;
}

function getEffectiveEdge(pick: Record<string, unknown>): number | null {
  const estimatedProbability =
    typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
      ? pick.estimated_probability
      : null;
  const executionImplied = getEffectiveImpliedProbability(pick);

  if (estimatedProbability !== null && executionImplied !== null) {
    return estimatedProbability - executionImplied;
  }

  return typeof pick.edge === 'number' && Number.isFinite(pick.edge) ? pick.edge : null;
}

function getEffectiveEv(pick: Record<string, unknown>): number | null {
  const estimatedProbability =
    typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
      ? pick.estimated_probability
      : null;
  const executionOdds =
    typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
      ? pick.execution_odds
      : null;

  if (estimatedProbability !== null && executionOdds && executionOdds > 1) {
    return expectedValue(estimatedProbability, executionOdds);
  }

  return typeof pick.ev === 'number' && Number.isFinite(pick.ev) ? pick.ev : null;
}

function getPickAuditDateKey(pick: Record<string, unknown>): string | null {
  if (typeof pick.game_date_key === 'string' && pick.game_date_key.trim()) {
    return pick.game_date_key;
  }
  return null;
}

function buildTrendSeries(picks: Array<Record<string, unknown>>): TrendPoint[] {
  const settled = picks
    .filter((pick) => pick.status !== 'pending')
    .sort((left, right) => {
      const leftKey = getPickAuditDateKey(left) ?? '';
      const rightKey = getPickAuditDateKey(right) ?? '';
      if (leftKey !== rightKey) {
        return leftKey.localeCompare(rightKey);
      }

      const leftMs = new Date(String(left.created_at ?? '')).getTime();
      const rightMs = new Date(String(right.created_at ?? '')).getTime();
      return leftMs - rightMs;
    });

  const byDate = new Map<string, {
    settled: number;
    graded: number;
    won: number;
    lost: number;
    profitUnits: number;
  }>();

  for (const pick of settled) {
    const key = getPickAuditDateKey(pick);
    if (!key) continue;

    const entry = byDate.get(key) ?? {
      settled: 0,
      graded: 0,
      won: 0,
      lost: 0,
      profitUnits: 0
    };

    entry.settled += 1;
    entry.profitUnits += typeof pick.profit_units === 'number' ? pick.profit_units : 0;

    if (pick.status === 'won') {
      entry.graded += 1;
      entry.won += 1;
    } else if (pick.status === 'lost') {
      entry.graded += 1;
      entry.lost += 1;
    }

    byDate.set(key, entry);
  }

  const dates = [...byDate.keys()].sort((left, right) => left.localeCompare(right));

  let cumulativeProfit = 0;
  let cumulativeGraded = 0;
  let cumulativeWon = 0;
  let cumulativeLost = 0;

  return dates.map((date) => {
    const entry = byDate.get(date)!;
    cumulativeProfit += entry.profitUnits;
    cumulativeGraded += entry.graded;
    cumulativeWon += entry.won;
    cumulativeLost += entry.lost;

    const cumulativeWinRate =
      cumulativeWon + cumulativeLost > 0
        ? cumulativeWon / (cumulativeWon + cumulativeLost)
        : null;

    return {
      date,
      settled: entry.settled,
      graded: entry.graded,
      won: entry.won,
      lost: entry.lost,
      dailyProfitUnits: roundMetric(entry.profitUnits) ?? 0,
      cumulativeProfitUnits: roundMetric(cumulativeProfit) ?? 0,
      cumulativeRoi: cumulativeGraded > 0 ? roundMetric(cumulativeProfit / cumulativeGraded) : null,
      cumulativeWinRate: cumulativeWinRate !== null ? roundMetric(cumulativeWinRate) : null
    };
  });
}

function createBucket(key: string): BucketSummary {
  return {
    key,
    total: 0,
    settled: 0,
    won: 0,
    lost: 0,
    void: 0,
    pending: 0,
    winRate: null,
    profitUnits: 0,
    avgEdge: null,
    avgEv: null
  };
}

function getEdgeRangeKey(edge?: number | null): string {
  if (typeof edge !== 'number' || !Number.isFinite(edge)) {
    return 'Sin edge';
  }

  if (edge < 0.02) return '<2%';
  if (edge < 0.04) return '2-4%';
  if (edge < 0.07) return '4-7%';
  return '7%+';
}

function getConfidenceWeight(confidence: unknown): number {
  if (confidence === 'A') return 30;
  if (confidence === 'B') return 18;
  if (confidence === 'C') return 8;
  return 0;
}

function getSolidPickScore(pick: Record<string, unknown>): number {
  const estimatedProbability =
    typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
      ? pick.estimated_probability
      : 0;
  const executionOdds =
    typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
      ? pick.execution_odds
      : typeof pick.odds === 'number' && Number.isFinite(pick.odds)
        ? pick.odds
        : null;
  const edge = getEffectiveEdge(pick) ?? 0;
  const ev = getEffectiveEv(pick) ?? 0;

  let score =
    getConfidenceWeight(pick.confidence) +
    estimatedProbability * 28 +
    edge * 180 +
    ev * 140;

  if (typeof executionOdds === 'number') {
    if (executionOdds < 1.55) {
      score -= 35;
    } else if (executionOdds <= 1.82) {
      score += 6;
    } else if (executionOdds > 2.1) {
      score -= 8;
    }
  }

  return Number(score.toFixed(3));
}

function buildSolidPickCandidate(pick: Record<string, unknown>, dateKey: string): SolidPickPoint {
  return {
    date: dateKey,
    gameId: String(pick.game_id ?? ''),
    gameLabel: typeof pick.game_label === 'string' ? pick.game_label : String(pick.game_id ?? ''),
    market: String(pick.execution_market || pick.market || 'UNKNOWN'),
    selection: String(pick.execution_selection || pick.selection || 'NO BET'),
    confidence: String(pick.confidence ?? 'PASS'),
    status: String(pick.status ?? 'pending'),
    score: getSolidPickScore(pick),
    edge: roundMetric(getEffectiveEdge(pick)),
    ev: roundMetric(getEffectiveEv(pick)),
    estimatedProbability:
      typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
        ? roundMetric(pick.estimated_probability)
        : null,
    executionOdds:
      typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
        ? pick.execution_odds
        : typeof pick.odds === 'number' && Number.isFinite(pick.odds)
          ? pick.odds
          : null,
    profitUnits:
      typeof pick.profit_units === 'number' && Number.isFinite(pick.profit_units)
        ? roundMetric(pick.profit_units)
        : null,
    createdAt: String(pick.created_at ?? ''),
    updatedAt: String(pick.updated_at ?? '')
  };
}

function compareSolidPickCandidates(left: SolidPickPoint, right: SolidPickPoint) {
  return (
    right.score - left.score ||
    (right.edge ?? 0) - (left.edge ?? 0) ||
    (right.ev ?? 0) - (left.ev ?? 0) ||
    left.gameId.localeCompare(right.gameId)
  );
}

function summarizeSolidPickHistory(history: SolidPickPoint[]) {
  const descendingHistory = [...history].reverse();
  const activeToday = descendingHistory.find((item) => item.status === 'pending') ?? null;

  const settledHistory = descendingHistory.filter((item) => item.status !== 'pending');
  const graded = settledHistory.filter((item) => item.status === 'won' || item.status === 'lost');
  const won = graded.filter((item) => item.status === 'won').length;
  const lost = graded.filter((item) => item.status === 'lost').length;
  const voidCount = settledHistory.filter((item) => item.status === 'void').length;
  const pendingCount = activeToday ? 1 : 0;

  let currentStreakType: 'won' | 'lost' | 'none' = 'none';
  let currentStreakCount = 0;
  for (let index = settledHistory.length - 1; index >= 0; index -= 1) {
    const item = settledHistory[index];
    if (item.status !== 'won' && item.status !== 'lost') {
      continue;
    }

    if (currentStreakType === 'none') {
      currentStreakType = item.status;
      currentStreakCount = 1;
      continue;
    }

    if (item.status === currentStreakType) {
      currentStreakCount += 1;
      continue;
    }

    break;
  }

  return {
    today: activeToday,
    summary: {
      total: graded.length,
      settled: settledHistory.length,
      won,
      lost,
      void: voidCount,
      pending: pendingCount,
      winRate: graded.length ? roundMetric(won / graded.length) : null,
      currentStreak:
        currentStreakType === 'none'
          ? null
          : {
              type: currentStreakType,
              count: currentStreakCount
            }
    },
    history: settledHistory
  };
}

function buildSolidPickAuditRange(
  picks: Array<Record<string, unknown>>,
  auditStartDate: string | null,
  rank: number = 1
) {
  const grouped = new Map<string, SolidPickPoint[]>();

  for (const pick of picks) {
    if (pick.confidence !== 'A') continue;

    const key = getPickAuditDateKey(pick);
    if (!key || (auditStartDate !== null && key < auditStartDate)) continue;

    const candidate = buildSolidPickCandidate(pick, key);
    const current = grouped.get(key) ?? [];
    current.push(candidate);
    grouped.set(key, current);
  }

  const history = [...grouped.entries()]
    .map(([dateKey, candidates]) => {
      const sorted = [...candidates].sort(compareSolidPickCandidates);
      const ranked = sorted[rank - 1] ?? null;
      return ranked ? { dateKey, ranked } : null;
    })
    .filter((item): item is { dateKey: string; ranked: SolidPickPoint } => Boolean(item))
    .map((item) => item.ranked)
    .sort((left, right) => left.date.localeCompare(right.date));

  return summarizeSolidPickHistory(history);
}

function buildSolidPickAudit(
  picks: Array<Record<string, unknown>>
) {
  const auditStartDate =
    [...SOLID_PICK_RESET_DATE_KEYS]
      .sort((left, right) => left.localeCompare(right))
      .at(-1) ?? null;

  return buildSolidPickAuditRange(picks, auditStartDate);
}

function buildSliceSummary(
  picks: Array<Record<string, unknown>>
): SliceSummary {
  let edgeTotal = 0;
  let edgeCount = 0;
  let evTotal = 0;
  let evCount = 0;
  let profitUnits = 0;
  let wonCount = 0;
  let lostCount = 0;
  let voidCount = 0;
  let pendingCount = 0;

  for (const pick of picks) {
    if (pick.status === 'won') wonCount += 1;
    if (pick.status === 'lost') lostCount += 1;
    if (pick.status === 'void') voidCount += 1;
    if (pick.status === 'pending') pendingCount += 1;

    profitUnits +=
      typeof pick.profit_units === 'number' && Number.isFinite(pick.profit_units)
        ? pick.profit_units
        : 0;

    const effectiveEdge = getEffectiveEdge(pick);
    if (typeof effectiveEdge === 'number') {
      edgeTotal += effectiveEdge;
      edgeCount += 1;
    }

    const effectiveEv = getEffectiveEv(pick);
    if (typeof effectiveEv === 'number') {
      evTotal += effectiveEv;
      evCount += 1;
    }
  }

  const gradedCount = wonCount + lostCount;
  const settledCount = picks.filter((pick) => pick.status !== 'pending').length;

  return {
    totalPicks: picks.length,
    settledCount,
    gradedCount,
    pendingCount,
    wonCount,
    lostCount,
    voidCount,
    winRate: gradedCount > 0 ? roundMetric(wonCount / gradedCount) : null,
    totalProfitUnits: roundMetric(profitUnits) ?? 0,
    roi: gradedCount > 0 ? roundMetric(profitUnits / gradedCount) : null,
    avgEdge: edgeCount > 0 ? roundMetric(edgeTotal / edgeCount) : null,
    avgEv: evCount > 0 ? roundMetric(evTotal / evCount) : null
  };
}

function buildSliceBuckets(
  picks: Array<Record<string, unknown>>
): {
  byMarket: BucketSummary[];
  byConfidence: BucketSummary[];
  byEdgeRange: BucketSummary[];
} {
  const byMarket = new Map<string, {
    bucket: BucketSummary;
    edgeTotal: number;
    edgeCount: number;
    evTotal: number;
    evCount: number;
  }>();
  const byConfidence = new Map<string, {
    bucket: BucketSummary;
    edgeTotal: number;
    edgeCount: number;
    evTotal: number;
    evCount: number;
  }>();
  const byEdgeRange = new Map<string, {
    bucket: BucketSummary;
    edgeTotal: number;
    edgeCount: number;
    evTotal: number;
    evCount: number;
  }>();

  for (const pick of picks) {
    const profitUnits =
      typeof pick.profit_units === 'number' && Number.isFinite(pick.profit_units)
        ? pick.profit_units
        : 0;
    const isSettled = pick.status !== 'pending';
    const effectiveEdge = getEffectiveEdge(pick);
    const effectiveEv = getEffectiveEv(pick);
    const edgeRangeKey = getEdgeRangeKey(effectiveEdge);
    const marketKey = String(pick.execution_market || pick.market || 'UNKNOWN');
    const confidenceKey = String(pick.confidence || 'UNKNOWN');

    if (!byMarket.has(marketKey)) {
      byMarket.set(marketKey, {
        bucket: createBucket(marketKey),
        edgeTotal: 0,
        edgeCount: 0,
        evTotal: 0,
        evCount: 0
      });
    }

    if (!byConfidence.has(confidenceKey)) {
      byConfidence.set(confidenceKey, {
        bucket: createBucket(confidenceKey),
        edgeTotal: 0,
        edgeCount: 0,
        evTotal: 0,
        evCount: 0
      });
    }

    if (!byEdgeRange.has(edgeRangeKey)) {
      byEdgeRange.set(edgeRangeKey, {
        bucket: createBucket(edgeRangeKey),
        edgeTotal: 0,
        edgeCount: 0,
        evTotal: 0,
        evCount: 0
      });
    }

    for (const target of [
      byMarket.get(marketKey),
      byConfidence.get(confidenceKey),
      byEdgeRange.get(edgeRangeKey)
    ]) {
      if (!target) continue;

      target.bucket.total += 1;
      target.bucket.profitUnits += profitUnits;

      if (isSettled) target.bucket.settled += 1;
      if (pick.status === 'won') target.bucket.won += 1;
      if (pick.status === 'lost') target.bucket.lost += 1;
      if (pick.status === 'void') target.bucket.void += 1;
      if (pick.status === 'pending') target.bucket.pending += 1;

      if (typeof effectiveEdge === 'number') {
        target.edgeTotal += effectiveEdge;
        target.edgeCount += 1;
      }

      if (typeof effectiveEv === 'number') {
        target.evTotal += effectiveEv;
        target.evCount += 1;
      }
    }
  }

  return {
    byMarket: [...byMarket.values()]
      .map((entry) =>
        finalizeBucket(
          entry.bucket,
          entry.edgeTotal,
          entry.edgeCount,
          entry.evTotal,
          entry.evCount
        )
      )
      .sort((left, right) => right.total - left.total),
    byConfidence: [...byConfidence.values()]
      .map((entry) =>
        finalizeBucket(
          entry.bucket,
          entry.edgeTotal,
          entry.edgeCount,
          entry.evTotal,
          entry.evCount
        )
      )
      .sort((left, right) => right.total - left.total),
    byEdgeRange: [...byEdgeRange.values()]
      .map((entry) =>
        finalizeBucket(
          entry.bucket,
          entry.edgeTotal,
          entry.edgeCount,
          entry.evTotal,
          entry.evCount
        )
      )
      .sort(
        (left, right) =>
          EDGE_BAND_ORDER.indexOf(left.key) - EDGE_BAND_ORDER.indexOf(right.key)
      )
  };
}

function toDailyPremiumTopPick(item: SolidPickPoint): DailyPremiumTopPick {
  return {
    gameId: item.gameId,
    gameLabel: item.gameLabel,
    market: item.market,
    selection: item.selection,
    confidence: item.confidence,
    status: item.status,
    profitUnits: item.profitUnits
  };
}

function buildDailySummary(
  picks: Array<Record<string, unknown>>,
  premiumAudit: ReturnType<typeof buildSolidPickAuditRange>,
  currentPremiumContext?: CurrentPremiumContext | null
): DailySummaryItem[] {
  const byDate = new Map<string, {
    settled: number;
    graded: number;
    won: number;
    lost: number;
    void: number;
    pending: number;
    profitUnits: number;
  }>();

  for (const pick of picks) {
    const dateKey = getPickAuditDateKey(pick);
    if (!dateKey) continue;

    const entry = byDate.get(dateKey) ?? {
      settled: 0,
      graded: 0,
      won: 0,
      lost: 0,
      void: 0,
      pending: 0,
      profitUnits: 0
    };

    if (pick.status !== 'pending') entry.settled += 1;
    if (pick.status === 'won') {
      entry.graded += 1;
      entry.won += 1;
    } else if (pick.status === 'lost') {
      entry.graded += 1;
      entry.lost += 1;
    } else if (pick.status === 'void') {
      entry.void += 1;
    } else if (pick.status === 'pending') {
      entry.pending += 1;
    }

    entry.profitUnits +=
      typeof pick.profit_units === 'number' && Number.isFinite(pick.profit_units)
        ? pick.profit_units
        : 0;

    byDate.set(dateKey, entry);
  }

  const premiumByDate = new Map<string, DailyPremiumTopPick>();

  for (const item of premiumAudit.history) {
    premiumByDate.set(item.date, toDailyPremiumTopPick(item));
  }

  if (premiumAudit.today) {
    premiumByDate.set(premiumAudit.today.date, toDailyPremiumTopPick(premiumAudit.today));
  }

  if (currentPremiumContext?.premiumPick) {
    const currentDateKey = currentPremiumContext.todayDateKey;
    premiumByDate.set(currentDateKey, {
      gameId: currentPremiumContext.premiumPick.gameId,
      gameLabel: currentPremiumContext.premiumPick.gameLabel,
      market: currentPremiumContext.premiumPick.market,
      selection: currentPremiumContext.premiumPick.selection,
      confidence: currentPremiumContext.premiumPick.confidence,
      status: 'pending',
      profitUnits: null
    });

    if (!byDate.has(currentDateKey)) {
      byDate.set(currentDateKey, {
        settled: 0,
        graded: 0,
        won: 0,
        lost: 0,
        void: 0,
        pending: 0,
        profitUnits: 0
      });
    }
  }

  return [...byDate.keys()]
    .sort((left, right) => right.localeCompare(left))
    .map((date) => {
      const entry = byDate.get(date)!;
      return {
        date,
        settled: entry.settled,
        graded: entry.graded,
        won: entry.won,
        lost: entry.lost,
        void: entry.void,
        pending: entry.pending,
        profitUnits: roundMetric(entry.profitUnits) ?? 0,
        roi: entry.graded > 0 ? roundMetric(entry.profitUnits / entry.graded) : null,
        premiumTopPick: premiumByDate.get(date) ?? null
      };
    });
}

function buildDisplaySlice(
  picks: StatsPickRecord[],
  options: {
    key: string;
    label: string;
    mode: 'testing' | 'live';
    startDate: string | null;
    endDate: string | null;
    currentPremiumContext?: CurrentPremiumContext | null;
  }
): DisplaySlice {
  const summary = buildSliceSummary(picks);
  const buckets = buildSliceBuckets(picks);
  const premiumAudit = buildSolidPickAuditRange(picks, null);
  const rankAudits: PremiumRankHistory[] = ([1, 2, 3] as const).map((rank) => {
    const audit = buildSolidPickAuditRange(picks, null, rank);
    return {
      rank,
      summary: audit.summary,
      history: audit.history
    };
  });
  const rankSummaries: PremiumRankSummary[] = ([1, 2, 3] as const).map((rank) => ({
    rank,
    summary: rankAudits.find((entry) => entry.rank === rank)?.summary ?? premiumAudit.summary
  }));

  return {
    key: options.key,
    label: options.label,
    mode: options.mode,
    startDate: options.startDate,
    endDate: options.endDate,
    summary,
    byMarket: buckets.byMarket,
    byConfidence: buckets.byConfidence,
    byEdgeRange: buckets.byEdgeRange,
    trend: buildTrendSeries(picks),
    premium: {
      summary: premiumAudit.summary,
      rankSummaries,
      rankHistories: rankAudits,
      history: premiumAudit.history,
      currentPick: options.currentPremiumContext?.premiumPick ?? null,
      todayRanking: options.currentPremiumContext?.todayRanking ?? [],
      isLocked: options.currentPremiumContext?.isLocked ?? false,
      isClosed: options.currentPremiumContext?.isClosed ?? false,
      betterPickPostLock: options.currentPremiumContext?.betterPickPostLock ?? false,
      betterPick: options.currentPremiumContext?.betterPick ?? null
    },
    daily: buildDailySummary(picks, premiumAudit, options.currentPremiumContext)
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } catch {
    return fallback;
  }
}

function finalizeBucket(
  bucket: BucketSummary,
  edgeTotal: number,
  edgeCount: number,
  evTotal: number,
  evCount: number
): BucketSummary {
  const graded = bucket.won + bucket.lost;

  return {
    ...bucket,
    winRate: graded > 0 ? roundMetric(bucket.won / graded) : null,
    profitUnits: roundMetric(bucket.profitUnits) ?? 0,
    avgEdge: edgeCount > 0 ? roundMetric(edgeTotal / edgeCount) : null,
    avgEv: evCount > 0 ? roundMetric(evTotal / evCount) : null
  };
}

function formatUsageDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatUsageMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit'
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type === 'year' || part.type === 'month') {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    }, {});

  return `${parts.year}-${parts.month}`;
}

function getCounterValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function buildOddsUsageSummary() {
  try {
  const now = new Date();
  const dayKey = `ops:odds:daily:${formatUsageDateKey(now)}`;
  const monthKey = `ops:odds:monthly:${formatUsageMonthKey(now)}`;

  const [dailyRow, monthlyRow, oddsBoardRow] = await Promise.all([
    getOddsBoardCache(dayKey).catch(() => null),
    getOddsBoardCache(monthKey).catch(() => null),
    getOddsBoardCache('mlb_main').catch(() => null)
  ]);

  const todayCount = getCounterValue((dailyRow?.payload as Record<string, unknown> | null)?.count);
  const monthCount = getCounterValue((monthlyRow?.payload as Record<string, unknown> | null)?.count);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(now)
    .reduce<Record<string, number>>((accumulator, part) => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
        accumulator[part.type] = Number(part.value);
      }
      return accumulator;
    }, {});

  const year = parts.year ?? now.getUTCFullYear();
  const month = parts.month ?? now.getUTCMonth() + 1;
  const dayOfMonth = parts.day ?? now.getUTCDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth);
  const remainingMonthCalls = Math.max(0, ODDS_MONTHLY_LIMIT - monthCount);
  const averageCallsLeftPerDay =
    daysRemaining > 0 ? Number((remainingMonthCalls / daysRemaining).toFixed(1)) : remainingMonthCalls;
  const projectedMonthCalls =
    dayOfMonth > 0 ? Number(((monthCount / dayOfMonth) * daysInMonth).toFixed(1)) : 0;
  const worstCaseAtCooldown = Math.ceil((daysInMonth * 24 * 60) / ODDS_REFRESH_COOLDOWN_MINUTES);

  return {
    todayCount,
    monthCount,
    monthlyLimit: ODDS_MONTHLY_LIMIT,
    remainingMonthCalls,
    averageCallsLeftPerDay,
    projectedMonthCalls,
    worstCaseAtCooldown,
    withinBudget:
      projectedMonthCalls <= ODDS_MONTHLY_LIMIT &&
      worstCaseAtCooldown <= ODDS_MONTHLY_LIMIT,
    cooldownMinutes: ODDS_REFRESH_COOLDOWN_MINUTES,
    lastExternalRefreshAt: oddsBoardRow?.updated_at ?? null,
    note: 'El contador registra solo refrescos externos reales del board MLB. Las lecturas servidas desde cache no consumen cupo.'
  };
  } catch {
    return {
      todayCount: 0,
      monthCount: 0,
      monthlyLimit: ODDS_MONTHLY_LIMIT,
      remainingMonthCalls: ODDS_MONTHLY_LIMIT,
      averageCallsLeftPerDay: 0,
      projectedMonthCalls: 0,
      worstCaseAtCooldown: 0,
      withinBudget: true,
      cooldownMinutes: ODDS_REFRESH_COOLDOWN_MINUTES,
      lastExternalRefreshAt: null,
      note: 'No se pudo leer historial de odds (timeout DB).'
    };
  }
}

export async function GET() {
  try {
const [confirmedPicks, summaryViewResult] = await Promise.all([
  listConfirmedPicks(),
  supabase
    .from('pick_stats_summary')
    .select('*')
    .single()
]);

    const summaryDb = summaryViewResult.data;
    const recentPicks = [...confirmedPicks].sort((left, right) => {
      const leftMs = new Date(String(left.created_at ?? left.updated_at ?? '')).getTime();
      const rightMs = new Date(String(right.created_at ?? right.updated_at ?? '')).getTime();
      return rightMs - leftMs;
    });

let edgeTotal = 0;
let edgeCount = 0;
let evTotal = 0;
let evCount = 0;

    const byMarket = new Map<string, {
      bucket: BucketSummary;
      edgeTotal: number;
      edgeCount: number;
      evTotal: number;
      evCount: number;
    }>();

    const byConfidence = new Map<string, {
      bucket: BucketSummary;
      edgeTotal: number;
      edgeCount: number;
      evTotal: number;
      evCount: number;
    }>();
    const byEdgeRange = new Map<string, {
      bucket: BucketSummary;
      edgeTotal: number;
      edgeCount: number;
      evTotal: number;
      evCount: number;
    }>();

    for (const pick of confirmedPicks) {
const profitUnits = typeof pick.profit_units === 'number' ? pick.profit_units : 0;
const isSettled = pick.status !== 'pending';

      const effectiveEdge = getEffectiveEdge(pick as Record<string, unknown>);
      const effectiveEv = getEffectiveEv(pick as Record<string, unknown>);
      const edgeRangeKey = getEdgeRangeKey(effectiveEdge);

      if (typeof effectiveEdge === 'number') {
        edgeTotal += effectiveEdge;
        edgeCount += 1;
      }

      if (typeof effectiveEv === 'number') {
        evTotal += effectiveEv;
        evCount += 1;
      }

      const marketKey = pick.execution_market || pick.market || 'UNKNOWN';
      const confidenceKey = pick.confidence || 'UNKNOWN';

      if (!byMarket.has(marketKey)) {
        byMarket.set(marketKey, {
          bucket: createBucket(marketKey),
          edgeTotal: 0,
          edgeCount: 0,
          evTotal: 0,
          evCount: 0
        });
      }

      if (!byConfidence.has(confidenceKey)) {
        byConfidence.set(confidenceKey, {
          bucket: createBucket(confidenceKey),
          edgeTotal: 0,
          edgeCount: 0,
          evTotal: 0,
          evCount: 0
        });
      }

      if (!byEdgeRange.has(edgeRangeKey)) {
        byEdgeRange.set(edgeRangeKey, {
          bucket: createBucket(edgeRangeKey),
          edgeTotal: 0,
          edgeCount: 0,
          evTotal: 0,
          evCount: 0
        });
      }

      for (const target of [
        byMarket.get(marketKey),
        byConfidence.get(confidenceKey),
        byEdgeRange.get(edgeRangeKey)
      ]) {
        if (!target) continue;

        target.bucket.total += 1;
        target.bucket.profitUnits += profitUnits;

        if (isSettled) target.bucket.settled += 1;
        if (pick.status === 'won') target.bucket.won += 1;
        if (pick.status === 'lost') target.bucket.lost += 1;
        if (pick.status === 'void') target.bucket.void += 1;
        if (pick.status === 'pending') target.bucket.pending += 1;

        if (typeof effectiveEdge === 'number') {
          target.edgeTotal += effectiveEdge;
          target.edgeCount += 1;
        }

        if (typeof effectiveEv === 'number') {
          target.evTotal += effectiveEv;
          target.evCount += 1;
        }
      }
    }

    const byMarketSummary = [...byMarket.values()]
      .map((entry) =>
        finalizeBucket(
          entry.bucket,
          entry.edgeTotal,
          entry.edgeCount,
          entry.evTotal,
          entry.evCount
        )
      )
      .sort((left, right) => right.total - left.total);

    const byConfidenceSummary = [...byConfidence.values()]
      .map((entry) =>
        finalizeBucket(
          entry.bucket,
          entry.edgeTotal,
          entry.edgeCount,
          entry.evTotal,
          entry.evCount
        )
      )
      .sort((left, right) => right.total - left.total);

    const byEdgeRangeSummary = [...byEdgeRange.values()]
      .map((entry) =>
        finalizeBucket(
          entry.bucket,
          entry.edgeTotal,
          entry.edgeCount,
          entry.evTotal,
          entry.evCount
        )
      )
      .sort(
        (left, right) =>
          EDGE_BAND_ORDER.indexOf(left.key) - EDGE_BAND_ORDER.indexOf(right.key)
      );

    const STORAGE_TIMEOUT_FALLBACK = {
      estimatedUsedMb: 0,
      remainingMb: SUPABASE_FREE_DB_LIMIT_MB,
      percentUsed: 0,
      breakdown: [] as StorageBreakdown[],
      note: 'No se pudo estimar el uso de DB (timeout). Reintenta mas tarde.'
    };

const [oddsUsage, vercelUsage, snapshotsById, marketSnapshotsByGameId] = await Promise.all([
  // Uso de Odds API: esto sí es parte útil del stats principal.
  buildOddsUsageSummary(),

  // Presupuesto / límites de Vercel: también útil para el panel principal.
  withTimeout(buildVercelBudgetSummary(), 5000, {
    liveUsageAvailable: false,
    planMode: 'Guardrails Hobby / Trial',
    hobbyLimits: {
      deploymentsPerDay: 100,
      maxFunctionDurationSeconds: 300,
      fastDataTransferGb: 100,
      runtimeLogsHours: 1,
      staticFileUploadsMb: 100,
      diskSizeGb: 23
    },
    note: 'No pude leer stats live de Vercel a tiempo. Se muestran guardrails estáticos.',
    live: null
  }),

  // Snapshots recientes para premium/top 3/recent:
  // limitamos a RECENT_UI_LIMIT para no cargar todo el historial.
  withTimeout(
    getPregameSnapshotsByIds(
      recentPicks
        .slice(0, RECENT_UI_LIMIT)
        .map((pick) => pick.snapshot_id ?? '')
        .filter((snapshotId): snapshotId is string => Boolean(snapshotId))
    ).catch(() => new Map()),
    4000,
    new Map()
  ),

  withTimeout(
    getLatestMarketSnapshotsByGameIds(
      recentPicks
        .map((pick) => pick.game_id ?? '')
        .filter((gameId): gameId is string => Boolean(gameId))
    ).catch(() => new Map()),
    4000,
    new Map()
  )
]);

// Storage ya NO se calcula dentro del endpoint principal.
// Dejamos un placeholder liviano para que el frontend pueda mostrar
// que esa tarjeta ahora se carga por separado desde /api/stats/storage.
const storage = {
  ...STORAGE_TIMEOUT_FALLBACK,
  note: 'Storage se carga por separado desde /api/stats/storage.'
};


   const recentWithSnapshots = recentPicks.map((pick) => {
  const snapshot = pick.snapshot_id ? snapshotsById.get(pick.snapshot_id) ?? null : null;
  const snapshotPayload =
    snapshot?.payload && typeof snapshot.payload === 'object'
      ? (snapshot.payload as Record<string, unknown>)
      : null;

  const gameDate = getGameDate(
    snapshot?.start_time ??
      (typeof (pick as { game_date?: unknown }).game_date === 'string'
        ? (pick as { game_date?: string }).game_date
        : null) ??
      (typeof (pick as { gameDate?: unknown }).gameDate === 'string'
        ? (pick as { gameDate?: string }).gameDate
        : null) ??
      (typeof (pick as { event_start_time?: unknown }).event_start_time === 'string'
        ? (pick as { event_start_time?: string }).event_start_time
        : null),
    null
  );

  return {
    pick,
    snapshot,
    snapshotPayload,
    gameDate
  };
});

const pickRecords: StatsPickRecord[] = recentWithSnapshots.map(
  ({ pick, snapshotPayload, gameDate, snapshot }) =>
    ({
      ...(pick as Record<string, unknown>),
      game_date_key: getSlateDayKey(pick.game_day ?? null, gameDate, pick.created_at),
      game_start_time:
        typeof snapshot?.start_time === 'string'
          ? snapshot.start_time
          : typeof gameDate === 'string'
            ? gameDate
            : null,
      game_label: resolveMatchupLabel({
        snapshotPayload,
        marketSnapshot: marketSnapshotsByGameId.get(String(pick.game_id ?? '')) ?? null,
        gameId: String(pick.game_id ?? '')
      })
    }) as StatsPickRecord
);

const trend = buildTrendSeries(pickRecords);

const solidPick = buildSolidPickAudit(pickRecords);

const todayDateKey = formatUsageDateKey();

const rawTodayCandidates = pickRecords
  .filter((pick) => {
    return (
      String(pick.confidence ?? '') === 'A' &&
      String(pick.status ?? '') === 'pending' &&
      String(pick.game_date_key ?? '') === todayDateKey
    );
  })
  .map((pick) => {
    const estimatedProbability =
      typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
        ? roundMetric(pick.estimated_probability)
        : null;

    const impliedProbability = roundMetric(
      getEffectiveImpliedProbability(pick as Record<string, unknown>)
    );

    return {
      gameId: String(pick.game_id ?? ''),
      gameLabel: String(pick.game_label ?? String(pick.game_id ?? '')),
      market: String(pick.execution_market || pick.market || 'UNKNOWN'),
      selection: buildExecutionTitle(pick as Record<string, unknown>),
      confidence: String(pick.confidence ?? ''),
      score: getSolidPickScore(pick as Record<string, unknown>),
      edge: roundMetric(getEffectiveEdge(pick as Record<string, unknown>)),
      ev: roundMetric(getEffectiveEv(pick as Record<string, unknown>)),
      estimatedProbability,
      impliedProbability,
      executionOdds:
        typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
          ? pick.execution_odds
          : typeof pick.odds === 'number' && Number.isFinite(pick.odds)
            ? pick.odds
            : null,
      gameStartTime:
        typeof pick.game_start_time === 'string' ? pick.game_start_time : null
    };
  });

    // Group by dedupKey — highest score = current, second = prev (for delta display)
    const dedupGroups = new Map<string, typeof rawTodayCandidates>();
    for (const candidate of rawTodayCandidates) {
      const dedupKey = `${candidate.gameId}|${candidate.market}|${candidate.selection}`;
      const group = dedupGroups.get(dedupKey) ?? [];
      group.push(candidate);
      dedupGroups.set(dedupKey, group);
    }

    const solidTodayRanking: TodayRankingItem[] = [...dedupGroups.values()]
      .map((group) => {
        const sorted = [...group].sort((a, b) => b.score - a.score);
        const current = sorted[0];
        const prev = sorted.length > 1 ? sorted[1] : null;
        return {
          ...current,
          prevScore: prev?.score ?? null,
          prevEdge: prev?.edge ?? null,
          prevEv: prev?.ev ?? null,
          prevEstimatedProbability: prev?.estimatedProbability ?? null,
          prevImpliedProbability: prev?.impliedProbability ?? null,
          prevExecutionOdds: prev?.executionOdds ?? null,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.edge ?? 0) - (a.edge ?? 0) ||
          (b.ev ?? 0) - (a.ev ?? 0) ||
          a.gameId.localeCompare(b.gameId)
      );

    // --- Premium daily lock (DB-backed, cross-device) ---
    let lockPayload = await getPremiumDailyLock(todayDateKey).catch(() => null);

    // If the locked game has settled, the day is closed — don't reopen to pick a new one
    let premiumClosed = false;
    if (lockPayload) {
      const p = lockPayload as Record<string, unknown>;
      if (p.closed === true) {
        premiumClosed = true;
      } else {
        const lockedGameId = String(p.gameId ?? '');
        const lockedRecord = confirmedPicks.find((pick) => String(pick.game_id) === lockedGameId);
        if (lockedRecord && lockedRecord.status !== 'pending') {
          premiumClosed = true;
          await closePremiumDailyLock(todayDateKey, p).catch(() => null);
        }
      }
    }

    const liveTop = solidTodayRanking[0];
    if (!premiumClosed && !lockPayload && liveTop?.gameStartTime) {
      const lockThreshold = new Date(liveTop.gameStartTime).getTime() - PREMIUM_LOCK_MINUTES * 60 * 1000;
      if (Date.now() >= lockThreshold) {
        const newLockData: Record<string, unknown> = {
          gameId: liveTop.gameId,
          gameLabel: liveTop.gameLabel,
          marketType: liveTop.market,
          selection: liveTop.selection,
          confidence: liveTop.confidence,
          score: liveTop.score,
          odds: liveTop.executionOdds,
          edge: liveTop.edge,
          ev: liveTop.ev,
          probability: liveTop.estimatedProbability,
          impliedProbability: liveTop.impliedProbability,
          gameStartTime: liveTop.gameStartTime,
          lockedAt: new Date().toISOString(),
          lockReason: 'game_start_imminent'
        };
        const result = await createPremiumDailyLock(todayDateKey, newLockData).catch(() => null);
        lockPayload = result?.payload ?? newLockData;
      }
    }

    const isLocked = !premiumClosed && lockPayload !== null;
    let premiumPick: PremiumPickResult | null = null;
    let betterPickPostLock = false;
    let betterPick: PremiumPickResult | null = null;

    if (premiumClosed) {
      // Day closed — locked game settled; don't surface a new pick or ranking
    } else if (isLocked && lockPayload) {
      const p = lockPayload as Record<string, unknown>;
      const lockedGameId = String(p.gameId ?? '');
      const lockedPickRecord = pickRecords.find((pick) => String(pick.game_id ?? '') === lockedGameId);
      premiumPick = {
        gameId: lockedGameId,
        gameLabel:
          lockedPickRecord?.game_label ??
          resolveMatchupLabel({
            fallbackGameLabel: String(p.gameLabel ?? ''),
            marketSnapshot: marketSnapshotsByGameId.get(lockedGameId) ?? null,
            gameId: lockedGameId
          }),
        market: String(p.marketType ?? p.market ?? ''),
        selection: String(p.selection ?? ''),
        confidence: String(p.confidence ?? ''),
        score: typeof p.score === 'number' ? p.score : 0,
        edge: typeof p.edge === 'number' ? p.edge : null,
        ev: typeof p.ev === 'number' ? p.ev : null,
        estimatedProbability: typeof p.probability === 'number' ? p.probability : null,
        impliedProbability: typeof p.impliedProbability === 'number' ? p.impliedProbability : null,
        executionOdds: typeof p.odds === 'number' ? p.odds : null,
        gameStartTime: typeof p.gameStartTime === 'string' ? p.gameStartTime : null,
        lockedAt: typeof p.lockedAt === 'string' ? p.lockedAt : undefined,
        lockReason: typeof p.lockReason === 'string' ? p.lockReason : undefined
      };
      // Better pick post-lock: different identity (gameId|marketType|selection) AND higher score
      const lockedKey = `${premiumPick.gameId}|${premiumPick.market}|${premiumPick.selection}`;
      if (liveTop) {
        const liveKey = `${liveTop.gameId}|${liveTop.market}|${liveTop.selection}`;
        if (liveKey !== lockedKey && liveTop.score > premiumPick.score) {
          betterPickPostLock = true;
          betterPick = {
            gameId: liveTop.gameId,
            gameLabel: liveTop.gameLabel,
            market: liveTop.market,
            selection: liveTop.selection,
            confidence: liveTop.confidence,
            score: liveTop.score,
            edge: liveTop.edge,
            ev: liveTop.ev,
            estimatedProbability: liveTop.estimatedProbability,
            impliedProbability: liveTop.impliedProbability,
            executionOdds: liveTop.executionOdds,
            gameStartTime: liveTop.gameStartTime
          };
        }
      }
    } else if (liveTop) {
      premiumPick = {
        gameId: liveTop.gameId,
        gameLabel: liveTop.gameLabel,
        market: liveTop.market,
        selection: liveTop.selection,
        confidence: liveTop.confidence,
        score: liveTop.score,
        edge: liveTop.edge,
        ev: liveTop.ev,
        estimatedProbability: liveTop.estimatedProbability,
        impliedProbability: liveTop.impliedProbability,
        executionOdds: liveTop.executionOdds,
        gameStartTime: liveTop.gameStartTime
      };
    }
    // --- End premium lock ---

    const recent = recentWithSnapshots.slice(0, RECENT_UI_LIMIT).map(({ pick, snapshotPayload, gameDate }) => ({
      id: pick.id,
      gameId: pick.game_id,
      gameLabel: resolveMatchupLabel({
        snapshotPayload,
        marketSnapshot: marketSnapshotsByGameId.get(String(pick.game_id ?? '')) ?? null,
        gameId: String(pick.game_id ?? '')
      }),
      displayTitle: buildExecutionTitle(pick as Record<string, unknown>),
      market: pick.execution_market || pick.market,
      selection: pick.execution_selection || pick.selection,
      confidence: pick.confidence,
      status: pick.status,
      score: roundMetric(getSolidPickScore(pick as Record<string, unknown>)),
      executionOdds:
        typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
          ? pick.execution_odds
          : typeof pick.odds === 'number' && Number.isFinite(pick.odds)
            ? pick.odds
            : null,
      edge: roundMetric(getEffectiveEdge(pick as Record<string, unknown>)),
      ev: roundMetric(getEffectiveEv(pick as Record<string, unknown>)),
      profitUnits: roundMetric(pick.profit_units),
      gameDate,
      createdAt: pick.created_at,
      updatedAt: pick.updated_at
    }));

    const testingPicks = pickRecords.filter((pick) => {
      const dateKey = getPickAuditDateKey(pick);
      return typeof dateKey === 'string' && dateKey < LIVE_STATS_CUTOFF_DATE_KEY;
    });

    const livePicks = pickRecords.filter((pick) => {
      const dateKey = getPickAuditDateKey(pick);
      return typeof dateKey === 'string' && dateKey >= LIVE_STATS_CUTOFF_DATE_KEY;
    });

    const baseCurrentPremiumContext: CurrentPremiumContext = {
      todayDateKey,
      premiumPick,
      todayRanking: premiumClosed ? [] : solidTodayRanking,
      isLocked,
      isClosed: premiumClosed,
      betterPickPostLock,
      betterPick
    };

    const testingDisplay = buildDisplaySlice(testingPicks, {
      key: 'testing',
      label: 'Testing',
      mode: 'testing',
      startDate: null,
      endDate: addDaysToDateKey(LIVE_STATS_CUTOFF_DATE_KEY, -1),
      currentPremiumContext:
        todayDateKey < LIVE_STATS_CUTOFF_DATE_KEY ? baseCurrentPremiumContext : null
    });

    const maxLiveDateKey =
      livePicks
        .map((pick) => getPickAuditDateKey(pick))
        .filter((dateKey): dateKey is string => Boolean(dateKey))
        .sort((left, right) => left.localeCompare(right))
        .at(-1) ?? null;

    const liveThroughDateKey =
      todayDateKey >= LIVE_STATS_CUTOFF_DATE_KEY
        ? maxLiveDateKey && maxLiveDateKey > todayDateKey
          ? maxLiveDateKey
          : todayDateKey
        : maxLiveDateKey;

    const livePeriods = liveThroughDateKey
      ? buildLivePeriods(
          LIVE_STATS_CUTOFF_DATE_KEY,
          liveThroughDateKey,
          todayDateKey,
          pickRecords
        )
      : [];

    const liveViews = livePeriods.map((period) => {
      const periodPicks = livePicks.filter((pick) => {
        const dateKey = getPickAuditDateKey(pick);
        return (
          typeof dateKey === 'string' &&
          dateKey >= period.startDate &&
          dateKey <= period.endDate
        );
      });

      return {
        ...period,
        ...buildDisplaySlice(periodPicks, {
          key: period.key,
          label: period.label,
          mode: 'live',
          startDate: period.startDate,
          endDate: period.endDate,
          currentPremiumContext:
            period.isCurrent && todayDateKey >= LIVE_STATS_CUTOFF_DATE_KEY
              ? baseCurrentPremiumContext
              : null
        })
      };
    });

    const activeLivePeriodKey =
      liveViews.find((period) => period.isCurrent)?.key ??
      liveViews.at(-1)?.key ??
      null;

    return NextResponse.json({
      ok: true,
summary: {
  totalPicks: summaryDb?.total_picks ?? 0,
  settledCount: (summaryDb?.wins ?? 0) + (summaryDb?.losses ?? 0),
  gradedCount: (summaryDb?.wins ?? 0) + (summaryDb?.losses ?? 0),
  pendingCount: summaryDb?.pending ?? 0,
  wonCount: summaryDb?.wins ?? 0,
  lostCount: summaryDb?.losses ?? 0,
  voidCount: 0,
  winRate: summaryDb?.wr ?? null,
  totalProfitUnits: summaryDb?.profit ?? 0,
  roi: summaryDb?.roi ?? null,
  avgEdge: edgeCount > 0 ? roundMetric(edgeTotal / edgeCount) : null,
  avgEv: evCount > 0 ? roundMetric(evTotal / evCount) : null
},
      byMarket: byMarketSummary,
      byConfidence: byConfidenceSummary,
      byEdgeRange: byEdgeRangeSummary,
      trend,
      usage: {
        db: {
          estimatedUsedMb: storage.estimatedUsedMb,
          remainingMb: storage.remainingMb,
          planLimitMb: SUPABASE_FREE_DB_LIMIT_MB,
          percentUsed: storage.percentUsed,
          breakdown: storage.breakdown,
          note: storage.note
        },
        odds: oddsUsage,
        vercel: vercelUsage
      },
      solidPick: {
        ...solidPick,
        rankSummaries: ([1, 2, 3] as const).map((rank) => {
          const audit = buildSolidPickAuditRange(pickRecords, null, rank);
          return {
            rank,
            summary: audit.summary
          };
        }),
        rankHistories: ([1, 2, 3] as const).map((rank) => {
          const audit = buildSolidPickAuditRange(pickRecords, null, rank);
          return {
            rank,
            summary: audit.summary,
            history: audit.history
          };
        }),
        todayRanking: premiumClosed ? [] : solidTodayRanking,
        premiumPick,
        isLocked,
        isClosed: premiumClosed,
        betterPickPostLock,
        ...(betterPick ? { betterPick } : {})
      },
      recent,
      display: {
        cutoffDate: LIVE_STATS_CUTOFF_DATE_KEY,
        testing: testingDisplay,
        live: {
          activePeriodKey: activeLivePeriodKey,
          periods: liveViews.map((period) => ({
            key: period.key,
            label: period.label,
            startDate: period.startDate,
            endDate: period.endDate,
            isCurrent: period.isCurrent,
            hasData: period.hasData
          })),
          views: liveViews
        }
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
