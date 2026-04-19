import { NextResponse } from 'next/server';
import {
  getPregameSnapshotsByIds,
  getOddsBoardCache,
  listConfirmedPicks,
  getPremiumDailyLock,
  createPremiumDailyLock,
  supabase
} from '@/lib/db';
import { autoSettlePendingPicks } from '@/lib/auto-settle-picks';
import { expectedValue, impliedProbability } from '@/lib/probability-model';
import {
  ODDS_REFRESH_COOLDOWN_MS,
  SOLID_PICK_RESET_DATE_KEYS,
  USER_TIMEZONE
} from '@/lib/runtime-config';
import { buildVercelBudgetSummary } from '@/lib/vercel-ops';

const SUPABASE_FREE_DB_LIMIT_MB = 500;
const ODDS_MONTHLY_LIMIT = 2500;
const ODDS_REFRESH_COOLDOWN_MINUTES = Math.round(ODDS_REFRESH_COOLDOWN_MS / 60000);
const PREMIUM_LOCK_MINUTES = 10;

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

function getGameLabel(snapshotPayload: Record<string, unknown> | null, gameId: string): string {
  const espnGame =
    snapshotPayload?.espnGame && typeof snapshotPayload.espnGame === 'object'
      ? (snapshotPayload.espnGame as Record<string, unknown>)
      : null;

  const shortName = typeof espnGame?.shortName === 'string' ? espnGame.shortName : null;
  if (shortName) return shortName;

  const engineGame =
    snapshotPayload?.engineGame && typeof snapshotPayload.engineGame === 'object'
      ? (snapshotPayload.engineGame as Record<string, unknown>)
      : null;
  const homeTeam =
    engineGame?.homeTeam && typeof engineGame.homeTeam === 'object'
      ? (engineGame.homeTeam as Record<string, unknown>)
      : null;
  const awayTeam =
    engineGame?.awayTeam && typeof engineGame.awayTeam === 'object'
      ? (engineGame.awayTeam as Record<string, unknown>)
      : null;
  const homeCore =
    homeTeam?.core && typeof homeTeam.core === 'object'
      ? (homeTeam.core as Record<string, unknown>)
      : null;
  const awayCore =
    awayTeam?.core && typeof awayTeam.core === 'object'
      ? (awayTeam.core as Record<string, unknown>)
      : null;

  const homeName = typeof homeCore?.teamName === 'string' ? homeCore.teamName : null;
  const awayName = typeof awayCore?.teamName === 'string' ? awayCore.teamName : null;

  if (awayName && homeName) {
    return `${awayName} @ ${homeName}`;
  }

  return gameId;
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function roundMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(3));
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

function normalizeDateKey(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function getPickAuditDateKey(pick: Record<string, unknown>): string | null {
  if (typeof pick.game_date_key === 'string' && pick.game_date_key.trim()) {
    return pick.game_date_key;
  }

  return normalizeDateKey(
    typeof pick.created_at === 'string'
      ? pick.created_at
      : typeof pick.updated_at === 'string'
        ? pick.updated_at
        : null
  );
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

      const leftMs = new Date(String(left.updated_at ?? '')).getTime();
      const rightMs = new Date(String(right.updated_at ?? '')).getTime();
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

function buildSolidPickAudit(
  picks: Array<Record<string, unknown>>
) {
  const auditStartDate =
    [...SOLID_PICK_RESET_DATE_KEYS]
      .sort((left, right) => left.localeCompare(right))
      .at(-1) ?? null;
  const grouped = new Map<string, SolidPickPoint>();

  for (const pick of picks) {
    if (pick.confidence !== 'A') continue;

    const key = getPickAuditDateKey(pick);
    if (!key || (auditStartDate !== null && key < auditStartDate)) continue;

    const candidate: SolidPickPoint = {
      date: key,
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

    const current = grouped.get(key);
    if (!current || candidate.score > current.score) {
      grouped.set(key, candidate);
    }
  }

  const history = [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
  const descendingHistory = [...history].reverse();
  const activeToday = descendingHistory.find((item) => item.status === 'pending') ?? null;

  console.log('[premium-audit] premiumCandidateSource', `${grouped.size} A-tier picks agrupados por fecha`);
  console.log('[premium-audit] premiumSelected', activeToday ? {
    gameId: activeToday.gameId, matchup: activeToday.gameId,
    marketType: activeToday.market, selection: activeToday.selection,
    tier: activeToday.confidence, score: activeToday.score,
    edge: activeToday.edge, ev: activeToday.ev, odds: activeToday.executionOdds
  } : 'null — sin pick pending hoy');
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

function estimateTableBytes(rows: unknown[]): number {
  const rawBytes = rows.reduce<number>(
    (total, row) => total + Buffer.byteLength(JSON.stringify(row), 'utf8'),
    0
  );
  return Math.round(rawBytes * 1.3);
}

function getCounterValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function fetchTableRowCount(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'planned', head: true });

  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

async function buildSampledTableEstimate(config: {
  table: string;
  label: string;
  sampleColumns: string;
  orderBy: string;
  sampleLimit: number;
}): Promise<{ key: string; rows: number; bytes: number }> {
  const [rows, sampleRes] = await Promise.all([
    fetchTableRowCount(config.table),
    supabase
      .from(config.table)
      .select(config.sampleColumns)
      .order(config.orderBy, { ascending: false })
      .limit(config.sampleLimit)
  ]);

  if (sampleRes.error) {
    throw new Error(`Failed to sample ${config.table}: ${sampleRes.error.message}`);
  }

  const sampleRows = ((sampleRes.data ?? []) as unknown) as Record<string, unknown>[];
  const averageBytes =
    sampleRows.length > 0 ? estimateTableBytes(sampleRows) / sampleRows.length : 0;

  return {
    key: config.label,
    rows,
    bytes: Math.round(rows * averageBytes)
  };
}

async function buildStorageEstimate(allPicks: Array<Record<string, unknown>>) {
  const [gameSnapshots, marketSnapshots, oddsCache] = await Promise.all([
    buildSampledTableEstimate({
      table: 'game_snapshots',
      label: 'Game snapshots',
      sampleColumns: 'id,game_id,snapshot_stage,game_status,start_time,sport,alerts,created_at,updated_at',
      orderBy: 'updated_at',
      sampleLimit: 12
    }),
    buildSampledTableEstimate({
      table: 'market_snapshots',
      label: 'Market snapshots',
      sampleColumns: 'id,game_id,event_id,sport,home_team,away_team,home_ml,away_ml,home_rl_line,home_rl_odds,away_rl_line,away_rl_odds,total_line,over_odds,under_odds,source,created_at',
      orderBy: 'created_at',
      sampleLimit: 24
    }),
    buildSampledTableEstimate({
      table: 'odds_board_cache',
      label: 'Odds cache',
      sampleColumns: 'id,board_key,sport,source,created_at,updated_at',
      orderBy: 'updated_at',
      sampleLimit: 5
    })
  ]);

  const breakdownRaw = [
    { key: 'Picks', rows: allPicks.length, bytes: estimateTableBytes(allPicks) },
    gameSnapshots,
    marketSnapshots,
    oddsCache
  ];

  const totalBytes = breakdownRaw.reduce((total, item) => total + item.bytes, 0);
  const estimatedUsedMb = roundMb(totalBytes);
  const remainingMb = Number(Math.max(0, SUPABASE_FREE_DB_LIMIT_MB - estimatedUsedMb).toFixed(3));

  return {
    estimatedUsedMb,
    remainingMb,
    percentUsed: Number(((estimatedUsedMb / SUPABASE_FREE_DB_LIMIT_MB) * 100).toFixed(2)),
    breakdown: breakdownRaw.map<StorageBreakdown>((item) => ({
      key: item.key,
      rows: item.rows,
      approxMb: roundMb(item.bytes)
    })),
    note: 'Estimacion de metadatos por tabla (excluye payloads JSONB). El uso real de PostgreSQL es mayor por indices y overhead del sistema.'
  };
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
    const [, confirmedPicks] = await Promise.all([
      withTimeout(autoSettlePendingPicks(), 4000, undefined),
      listConfirmedPicks()
    ]);
    const allPicks = confirmedPicks;
    const recentPicks = [...confirmedPicks].sort((left, right) => {
      const leftMs = new Date(String(left.created_at ?? left.updated_at ?? '')).getTime();
      const rightMs = new Date(String(right.created_at ?? right.updated_at ?? '')).getTime();
      return rightMs - leftMs;
    });

    let totalProfitUnits = 0;
    let gradedCount = 0;
    let settledCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    let voidCount = 0;
    let pendingCount = 0;
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
      const isGraded = pick.status === 'won' || pick.status === 'lost';

      totalProfitUnits += profitUnits;

      if (isSettled) settledCount += 1;
      if (isGraded) gradedCount += 1;
      if (pick.status === 'won') wonCount += 1;
      if (pick.status === 'lost') lostCount += 1;
      if (pick.status === 'void') voidCount += 1;
      if (pick.status === 'pending') pendingCount += 1;

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

    const edgeBandOrder = ['7%+', '4-7%', '2-4%', '<2%', 'Sin edge'];
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
          edgeBandOrder.indexOf(left.key) - edgeBandOrder.indexOf(right.key)
      );

    const STORAGE_TIMEOUT_FALLBACK = {
      estimatedUsedMb: 0,
      remainingMb: SUPABASE_FREE_DB_LIMIT_MB,
      percentUsed: 0,
      breakdown: [] as StorageBreakdown[],
      note: 'No se pudo estimar el uso de DB (timeout). Reintenta mas tarde.'
    };

    const roi = gradedCount > 0 ? totalProfitUnits / gradedCount : null;
    const [storage, oddsUsage, vercelUsage, snapshotsById] = await Promise.all([
      withTimeout(buildStorageEstimate(allPicks as Array<Record<string, unknown>>), 6000, STORAGE_TIMEOUT_FALLBACK),
      buildOddsUsageSummary(),
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
      getPregameSnapshotsByIds(
        recentPicks
          .map((pick) => pick.snapshot_id ?? '')
          .filter((snapshotId): snapshotId is string => Boolean(snapshotId))
      ).catch(() => new Map())
    ]);
    const recentWithSnapshots = recentPicks.map((pick) => {
      const snapshot = pick.snapshot_id ? snapshotsById.get(pick.snapshot_id) ?? null : null;
      const snapshotPayload =
        snapshot?.payload && typeof snapshot.payload === 'object'
          ? (snapshot.payload as Record<string, unknown>)
          : null;
      const gameDate = getGameDate(snapshot?.start_time ?? null, pick.created_at);

      return {
        pick,
        snapshot,
        snapshotPayload,
        gameDate
      };
    });
    const pickRecords = recentWithSnapshots.map(({ pick, snapshotPayload, gameDate }) => ({
      ...(pick as Record<string, unknown>),
      game_date_key: normalizeDateKey(gameDate),
      game_label: getGameLabel(snapshotPayload, String(pick.game_id ?? ''))
    }));
    const trend = buildTrendSeries(pickRecords);

    const solidPick = buildSolidPickAudit(
      pickRecords
    );

    const todayDateKey = formatUsageDateKey();
    const rawTodayCandidates = recentWithSnapshots
      .filter(({ pick, gameDate }) => {
        const key = normalizeDateKey(gameDate);
        return String(pick.confidence) === 'A' && String(pick.status) === 'pending' && key === todayDateKey;
      })
      .map(({ pick, snapshotPayload, snapshot }) => {
        const estimatedProbability =
          typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
            ? roundMetric(pick.estimated_probability)
            : null;
        const impliedProbability = roundMetric(getEffectiveImpliedProbability(pick as Record<string, unknown>));
        return {
          gameId: String(pick.game_id ?? ''),
          gameLabel: getGameLabel(snapshotPayload, String(pick.game_id ?? '')),
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
          gameStartTime: snapshot?.start_time ?? null
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

    if (rawTodayCandidates.length > dedupGroups.size) {
      console.log('[premium-duplicates-detected]', rawTodayCandidates.length, '->', dedupGroups.size);
    }

    const solidTodayRanking = [...dedupGroups.values()]
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

    console.log('[premium-ranking-final]', solidTodayRanking.map((p) => ({
      gameId: p.gameId, market: p.market, selection: p.selection,
      score: p.score, prevScore: p.prevScore,
      edge: p.edge, ev: p.ev, prob: p.estimatedProbability, odds: p.executionOdds
    })));

    // --- Premium daily lock (DB-backed, cross-device) ---
    let lockPayload = await getPremiumDailyLock(todayDateKey).catch(() => null);

    const liveTop = solidTodayRanking[0];
    if (!lockPayload && liveTop?.gameStartTime) {
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

    const isLocked = lockPayload !== null;
    let premiumPick: PremiumPickResult | null = null;
    let betterPickPostLock = false;
    let betterPick: PremiumPickResult | null = null;

    if (isLocked && lockPayload) {
      const p = lockPayload as Record<string, unknown>;
      premiumPick = {
        gameId: String(p.gameId ?? ''),
        gameLabel: String(p.gameLabel ?? ''),
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

    const recent = recentWithSnapshots.map(({ pick, snapshotPayload, gameDate }) => ({
      id: pick.id,
      gameId: pick.game_id,
      gameLabel: getGameLabel(snapshotPayload, pick.game_id),
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

    return NextResponse.json({
      ok: true,
      summary: {
        totalPicks: confirmedPicks.length,
        settledCount,
        gradedCount,
        pendingCount,
        wonCount,
        lostCount,
        voidCount,
        winRate: gradedCount > 0 ? roundMetric(wonCount / gradedCount) : null,
        totalProfitUnits: roundMetric(totalProfitUnits),
        roi: roundMetric(roi),
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
        todayRanking: solidTodayRanking,
        premiumPick,
        isLocked,
        betterPickPostLock,
        ...(betterPick ? { betterPick } : {})
      },
      recent
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
