'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readSolidPick,
  writeSolidPick,
  type PersistedSolidPick
} from '@/lib/solid-pick-client';
import {
  USER_TIMEZONE,
  formatDateKeyForTimezone,
} from '@/lib/runtime-config';

type DbUsage = NonNullable<StatsResponse['usage']>['db'];

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

type StakeSummary = {
  total_picks: number;
  staked_picks: number;
  settled_picks: number;
  wins: number;
  losses: number;
  voids: number;
  pending: number;
  staked_units: number;
  profit_units: number;
  win_rate: number | null;
  roi: number | null;
};

type StakeSummaries = {
  all_flat_summary: StakeSummary;
  main_system_summary: StakeSummary;
  optional_c_summary: StakeSummary;
  weighted_summary: StakeSummary;
  conservative_summary: StakeSummary;
};

type CombiStatsSummary = {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  profit_units: number;
  roi: number | null;
  avg_combined_odds: number | null;
};

type ClvBucketSummary = {
  key: string;
  total: number;
  total_with_clv: number;
  positive: number;
  negative: number;
  neutral: number;
  unavailable: number;
  avg_clv_percent: number | null;
};

type ClvSummary = {
  total_with_clv: number;
  positive: number;
  negative: number;
  neutral: number;
  unavailable: number;
  avg_clv_percent: number | null;
  avg_clv_by_confidence: ClvBucketSummary[];
  avg_clv_by_market: ClvBucketSummary[];
};

type RecentItem = {
  id: string;
  gameId: string;
  gameLabel: string;
  displayTitle: string;
  market: string;
  selection: string;
  confidence: string;
  status: string;
  score: number | null;
  executionOdds: number | null;
  edge: number | null;
  ev: number | null;
  profitUnits: number | null;
  gameDate: string | null;
  createdAt: string;
  updatedAt: string;
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

type SolidPickHistoryItem = {
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

type PremiumPanelPick = {
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  confidence: string;
  score: number;
  edge: number | null;
  ev: number | null;
  executionOdds: number | null;
  lockedAt?: string;
  lockReason?: string;
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

type PremiumRankSummary = {
  rank: 1 | 2 | 3;
  summary: {
    total: number;
    settled: number;
    won: number;
    lost: number;
    void: number;
    pending: number;
    winRate: number | null;
    currentStreak: { type: 'won' | 'lost'; count: number } | null;
  };
};

type PremiumRankHistory = {
  rank: 1 | 2 | 3;
  summary: {
    total: number;
    settled: number;
    won: number;
    lost: number;
    void: number;
    pending: number;
    winRate: number | null;
    currentStreak: { type: 'won' | 'lost'; count: number } | null;
  };
  history: SolidPickHistoryItem[];
};

type SegmentedPremiumView = {
  summary: {
    total: number;
    settled: number;
    won: number;
    lost: number;
    void: number;
    pending: number;
    winRate: number | null;
    currentStreak: { type: 'won' | 'lost'; count: number } | null;
  };
  rankSummaries: PremiumRankSummary[];
  rankHistories: PremiumRankHistory[];
  history: SolidPickHistoryItem[];
  currentPick: PremiumPanelPick | null;
  todayRanking: {
    rank: 1 | 2 | 3;
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
    impliedProbability: number | null;
    executionOdds: number | null;
    profitUnits: number | null;
    gameStartTime: string | null;
    prevScore: number | null;
    prevEdge: number | null;
    prevEv: number | null;
    prevEstimatedProbability: number | null;
    prevImpliedProbability: number | null;
    prevExecutionOdds: number | null;
  }[];
  isLocked: boolean;
  isClosed: boolean;
  betterPickPostLock: boolean;
  betterPick: PremiumPanelPick | null;
};

type SegmentedStatsSlice = {
  key: string;
  label: string;
  mode: 'testing' | 'live';
  startDate: string | null;
  endDate: string | null;
  summary: {
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
  stakeSummaries: StakeSummaries;
  byMarket: BucketSummary[];
  byConfidence: BucketSummary[];
  byEdgeRange: BucketSummary[];
  trend: TrendPoint[];
  premium: SegmentedPremiumView;
  daily: DailySummaryItem[];
  combiSummary: CombiStatsSummary;
  clvSummary: ClvSummary;
};

type LiveStatsView = SegmentedStatsSlice & {
  isCurrent: boolean;
  hasData: boolean;
};

type StatsResponse = {
  ok: boolean;
  error?: string;
  summary?: {
    totalPicks: number;
    settledCount: number;
    gradedCount: number;
    pendingCount: number;
    wonCount: number;
    lostCount: number;
    voidCount: number;
    winRate: number | null;
    totalProfitUnits: number | null;
    roi: number | null;
    avgEdge: number | null;
    avgEv: number | null;
  };
  byMarket?: BucketSummary[];
  byConfidence?: BucketSummary[];
  byEdgeRange?: BucketSummary[];
  trend?: TrendPoint[];
  recent?: RecentItem[];
  solidPick?: {
    today: SolidPickHistoryItem | null;
    summary: {
      total: number;
      settled: number;
      won: number;
      lost: number;
      void: number;
      pending: number;
      winRate: number | null;
      currentStreak: { type: 'won' | 'lost'; count: number } | null;
    };
    rankSummaries?: PremiumRankSummary[];
    rankHistories?: PremiumRankHistory[];
    history: SolidPickHistoryItem[];
    todayRanking?: {
      rank: 1 | 2 | 3;
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
      impliedProbability: number | null;
      executionOdds: number | null;
      profitUnits: number | null;
      gameStartTime: string | null;
      prevScore: number | null;
      prevEdge: number | null;
      prevEv: number | null;
      prevEstimatedProbability: number | null;
      prevImpliedProbability: number | null;
      prevExecutionOdds: number | null;
    }[];
    premiumPick?: {
      gameId: string;
      gameLabel: string;
      market: string;
      selection: string;
      confidence: string;
      score: number;
      edge: number | null;
      ev: number | null;
      executionOdds: number | null;
      lockedAt?: string;
      lockReason?: string;
    } | null;
    isLocked?: boolean;
    isClosed?: boolean;
    betterPickPostLock?: boolean;
    betterPick?: {
      gameId: string;
      gameLabel: string;
      market: string;
      selection: string;
      score: number;
      edge: number | null;
      ev: number | null;
      executionOdds: number | null;
    } | null;
  };
  usage?: {
    db: {
      estimatedUsedMb: number;
      remainingMb: number;
      planLimitMb: number;
      percentUsed: number;
      breakdown: Array<{ key: string; rows: number; approxMb: number }>;
      note: string;
    };
    odds: {
      todayCount: number;
      monthCount: number;
      monthlyLimit: number;
      remainingMonthCalls: number;
      averageCallsLeftPerDay: number;
      projectedMonthCalls: number;
      worstCaseAtCooldown: number;
      withinBudget: boolean;
      cooldownMinutes: number;
      lastExternalRefreshAt: string | null;
      note: string;
    };
    vercel: {
      liveUsageAvailable: boolean;
      planMode: string;
      hobbyLimits: {
        deploymentsPerDay: number;
        maxFunctionDurationSeconds: number;
        fastDataTransferGb: number;
        runtimeLogsHours: number;
        staticFileUploadsMb: number;
        diskSizeGb: number;
      };
      note: string;
      live: {
        projectName: string;
        projectId: string;
        teamId: string;
        deployments30d: number;
        productionDeployments30d: number;
        readyProductionDeployments30d: number;
        lastDeployment: {
          id: string | null;
          state: string;
          target: string;
          source: string;
          url: string | null;
          createdAt: string | null;
        } | null;
      } | null;
    };
  };
  display?: {
    cutoffDate: string;
    testing: SegmentedStatsSlice;
    live: {
      activePeriodKey: string | null;
      periods: Array<{
        key: string;
        label: string;
        startDate: string;
        endDate: string;
        isCurrent: boolean;
        hasData: boolean;
      }>;
      views: LiveStatsView[];
    };
  };
};
const SOLID_HISTORY_PAGE_SIZE = 8;

function parseUiDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMetric(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(3);
}

function formatUnits(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}u`;
}

function formatRate(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function formatRecord(won: number, lost: number) {
  return `${won}-${lost}`;
}

function formatDateLabel(value?: string | null) {
  const date = parseUiDate(value);
  if (!date) return value ?? 'Sin fecha';
  return date.toLocaleDateString('es-CL', {
    timeZone: USER_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function getTodayDateKey() {
  return formatDateKeyForTimezone(0, { dashed: true });
}

function formatShortDate(value?: string | null) {
  const date = parseUiDate(value);
  if (!date) return value ?? '-';
  return date.toLocaleDateString('es-CL', {
    timeZone: USER_TIMEZONE,
    month: 'short',
    day: 'numeric'
  });
}

function formatOdds(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
}

function formatGameLabel(gameLabel?: string | null) {
  if (!gameLabel) return 'Partido desconocido';

  const trimmed = gameLabel.trim();
  if (!trimmed) return 'Partido desconocido';

  return /^\d+$/.test(trimmed) ? 'Partido desconocido' : trimmed;
}

function resolveMatchupLabel(
  gameId: string,
  fallbackGameLabel?: string | null,
  recent?: RecentItem[] | null
) {
  const recentMatch = (recent ?? []).find(
    (item) => String(item.gameId) === String(gameId)
  );

  const recentGameLabel = recentMatch?.gameLabel?.trim();
  if (recentGameLabel && formatGameLabel(recentGameLabel) !== 'Partido desconocido') {
    return recentGameLabel;
  }

  return formatGameLabel(fallbackGameLabel);
}

function formatStreak(streak?: { type: 'won' | 'lost'; count: number } | null) {
  if (!streak) return '-';
  return `${streak.type === 'won' ? 'W' : 'L'}${streak.count}`;
}

function getPremiumRankFrame(rank: 1 | 2 | 3) {
  if (rank === 1) {
    return {
      shell: 'border-[#ead18f]/55 bg-[linear-gradient(145deg,rgba(255,248,224,0.96),rgba(255,255,255,0.98))] shadow-[0_18px_42px_rgba(160,126,50,0.14)]',
      hero: 'bg-[linear-gradient(135deg,#7f5a11,#d4a942)] text-white shadow-[0_12px_24px_rgba(127,90,17,0.2)]',
      card: 'border-[#efe1b8] bg-[rgba(255,255,255,0.74)]',
      label: 'text-[#9b771c]'
    };
  }

  if (rank === 2) {
    return {
      shell: 'border-[#d6dbe4]/70 bg-[linear-gradient(145deg,rgba(243,246,251,0.96),rgba(255,255,255,0.98))] shadow-[0_18px_42px_rgba(122,134,154,0.12)]',
      hero: 'bg-[linear-gradient(135deg,#7d8797,#dce2eb)] text-white shadow-[0_12px_24px_rgba(122,134,154,0.18)]',
      card: 'border-[#d9dee7] bg-[rgba(255,255,255,0.78)]',
      label: 'text-[#758093]'
    };
  }

  return {
    shell: 'border-[#dbc4aa]/70 bg-[linear-gradient(145deg,rgba(247,239,232,0.96),rgba(255,255,255,0.98))] shadow-[0_18px_42px_rgba(150,110,76,0.12)]',
    hero: 'bg-[linear-gradient(135deg,#8a5a37,#c78f66)] text-white shadow-[0_12px_24px_rgba(138,90,55,0.18)]',
    card: 'border-[#e2cdb8] bg-[rgba(255,255,255,0.78)]',
    label: 'text-[#8e6444]'
  };
}

function pillThemeStyle(theme: {
  border: string;
  from: string;
  to: string;
  text: string;
}) {
  return {
    borderColor: theme.border,
    background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
    color: theme.text
  };
}

function marketPillStyle(market: string) {
  if (market === 'ML') {
    return pillThemeStyle({
      border: 'var(--pill-ml-border)',
      from: 'var(--pill-ml-from)',
      to: 'var(--pill-ml-to)',
      text: 'var(--pill-ml-text)'
    });
  }
  if (market === 'RL') {
    return pillThemeStyle({
      border: 'var(--pill-rl-border)',
      from: 'var(--pill-rl-from)',
      to: 'var(--pill-rl-to)',
      text: 'var(--pill-rl-text)'
    });
  }
  if (market === 'TOTAL') {
    return pillThemeStyle({
      border: 'var(--pill-total-border)',
      from: 'var(--pill-total-from)',
      to: 'var(--pill-total-to)',
      text: 'var(--pill-total-text)'
    });
  }
  if (market === 'F5') {
    return pillThemeStyle({
      border: 'var(--pill-f5-border)',
      from: 'var(--pill-f5-from)',
      to: 'var(--pill-f5-to)',
      text: 'var(--pill-f5-text)'
    });
  }
  if (market === '7%+') {
    return pillThemeStyle({
      border: 'color-mix(in oklch, var(--tone-good) 22%, white)',
      from: 'color-mix(in oklch, var(--tone-good) 12%, white)',
      to: 'color-mix(in oklch, var(--tone-good) 22%, white)',
      text: 'var(--tone-good)'
    });
  }
  if (market === '4-7%') {
    return pillThemeStyle({
      border: 'color-mix(in oklch, var(--accent-blue) 24%, white)',
      from: 'color-mix(in oklch, var(--accent-blue) 10%, white)',
      to: 'color-mix(in oklch, var(--accent-blue) 20%, white)',
      text: 'var(--pill-ml-text)'
    });
  }
  if (market === '2-4%') {
    return pillThemeStyle({
      border: 'color-mix(in oklch, var(--tone-mid) 26%, white)',
      from: 'color-mix(in oklch, var(--tone-mid) 12%, white)',
      to: 'color-mix(in oklch, var(--tone-mid) 22%, white)',
      text: 'var(--tone-mid)'
    });
  }
  if (market === '<2%' || market === 'Sin edge') {
    return pillThemeStyle({
      border: 'color-mix(in oklch, var(--tone-bad) 24%, white)',
      from: 'color-mix(in oklch, var(--tone-bad) 10%, white)',
      to: 'color-mix(in oklch, var(--tone-bad) 18%, white)',
      text: 'var(--tone-bad)'
    });
  }

  return pillThemeStyle({
    border: 'var(--line-soft)',
    from: 'var(--surface-soft)',
    to: 'var(--surface)',
    text: 'var(--ink-soft)'
  });
}

function confidencePillStyle(confidence: string) {
  if (confidence === 'A') {
    return pillThemeStyle({
      border: 'color-mix(in oklch, var(--accent-amber) 36%, white)',
      from: 'color-mix(in oklch, var(--accent-amber) 14%, white)',
      to: 'color-mix(in oklch, var(--accent-amber) 26%, white)',
      text: 'var(--pill-f5-text)'
    });
  }
  if (confidence === 'B') {
    return pillThemeStyle({
      border: 'color-mix(in oklch, var(--accent-blue) 28%, white)',
      from: 'color-mix(in oklch, var(--accent-blue) 10%, white)',
      to: 'color-mix(in oklch, var(--accent-blue) 22%, white)',
      text: 'var(--pill-ml-text)'
    });
  }

  return pillThemeStyle({
    border: 'var(--line-soft)',
    from: 'color-mix(in oklch, var(--surface-soft) 92%, white)',
    to: 'color-mix(in oklch, var(--surface-soft) 68%, white)',
    text: 'var(--ink-soft)'
  });
}

type PerformanceTone = 'good' | 'mid' | 'bad';

function getPerformanceTone(winRate?: number | null, profitUnits?: number | null, roi?: number | null): PerformanceTone {
  const wr = typeof winRate === 'number' ? winRate : null;
  const profit = typeof profitUnits === 'number' ? profitUnits : null;
  const roiValue = typeof roi === 'number' ? roi : null;

  if ((profit !== null && profit < 0) || (wr !== null && wr < 0.48) || (roiValue !== null && roiValue < -0.03)) {
    return 'bad';
  }

  if ((profit !== null && profit > 0.2) || (wr !== null && wr >= 0.55) || (roiValue !== null && roiValue >= 0.04)) {
    return 'good';
  }

  return 'mid';
}

function performanceTextClasses(tone: PerformanceTone) {
  if (tone === 'good') return 'text-[var(--tone-good)]';
  if (tone === 'mid') return 'text-[var(--tone-mid)]';
  return 'text-[var(--tone-bad)]';
}

function performanceStroke(tone: PerformanceTone) {
  if (tone === 'good') return 'var(--tone-good)';
  if (tone === 'mid') return 'var(--tone-mid)';
  return 'var(--tone-bad)';
}

function performanceAreaFill(tone: PerformanceTone) {
  if (tone === 'good') return 'var(--tone-good-soft)';
  if (tone === 'mid') return 'var(--tone-mid-soft)';
  return 'var(--tone-bad-soft)';
}

function performanceBarStyle(tone: PerformanceTone) {
  const color =
    tone === 'good'
      ? 'var(--tone-good)'
      : tone === 'mid'
        ? 'var(--tone-mid)'
        : 'var(--tone-bad)';

  return {
    background: `linear-gradient(90deg, color-mix(in oklch, ${color} 72%, white), ${color})`
  };
}

function BucketPerformanceBar({ bucket }: { bucket: BucketSummary }) {
  const fill = Math.max(10, Math.min(100, (bucket.winRate ?? 0) * 100));
  const tone = getPerformanceTone(bucket.winRate, bucket.profitUnits, bucket.avgEv);

  return (
    <div className="rounded-[1.1rem] border border-[var(--line-soft)] bg-white px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={marketPillStyle(bucket.key)}
          >
            {bucket.key}
          </span>
          <div className="text-sm font-semibold text-[var(--ink-strong)]">
            {bucket.total} picks · WR {formatRate(bucket.winRate)}
          </div>
        </div>
        <div className={`text-sm font-semibold ${performanceTextClasses(tone)}`}>{formatUnits(bucket.profitUnits)}</div>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface-soft)]">
        <div className="h-full rounded-full" style={{ ...performanceBarStyle(tone), width: `${fill}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
        <span>Edge {formatMetric(bucket.avgEdge)}</span>
        <span>EV {formatMetric(bucket.avgEv)}</span>
      </div>
    </div>
  );
}

function ProfitTrendChart({ points }: { points: TrendPoint[] }) {
  const [hoveredPoint, setHoveredPoint] = useState<{ index: number; x: number; y: number } | null>(null);

  const validPoints = points.filter(
    (point) =>
      typeof point.cumulativeProfitUnits === 'number' &&
      Number.isFinite(point.cumulativeProfitUnits)
  );

const chartPoints = validPoints;

if (!chartPoints.length) {
  return (
    <div className="rounded-[1.3rem] border border-[var(--line-soft)] bg-white p-4 text-sm text-[var(--ink-soft)]">
      Aun no hay datos suficientes para dibujar una curva historica.
    </div>
  );
}

  const width = 720;
  const height = 160;
  const paddingX = 26;
  const paddingY = 14;
  const values = chartPoints.map((point) => point.cumulativeProfitUnits);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const valueRange = Math.max(0.001, maxValue - minValue);
  const lastPoint = chartPoints[chartPoints.length - 1];
  const tone = getPerformanceTone(lastPoint?.cumulativeWinRate ?? null, lastPoint?.cumulativeProfitUnits ?? null, lastPoint?.cumulativeRoi ?? null);
  const stroke = performanceStroke(tone);
  const area = performanceAreaFill(tone);

  const xAt = (index: number) =>
    paddingX + (index / Math.max(1, chartPoints.length - 1)) * (width - paddingX * 2);
  const yAt = (value: number) =>
    height - paddingY - ((value - minValue) / valueRange) * (height - paddingY * 2);
  const zeroY = yAt(0);
  const areaPath = [
    `M ${xAt(0)} ${height - paddingY}`,
    ...chartPoints.map((point, index) => `L ${xAt(index)} ${yAt(point.cumulativeProfitUnits)}`),
    `L ${xAt(chartPoints.length - 1)} ${height - paddingY}`,
    'Z'
  ].join(' ');

  return (
    <div className="rounded-[1.35rem] border border-[var(--line-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,244,237,0.96))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="h-auto w-full">
        <path d={areaPath} fill={area} />
        <line x1={paddingX} x2={width - paddingX} y1={zeroY} y2={zeroY} stroke="color-mix(in oklch, var(--surface-navy) 14%, transparent)" strokeDasharray="5 5" />
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={paddingX}
            x2={width - paddingX}
            y1={paddingY + ratio * (height - paddingY * 2)}
            y2={paddingY + ratio * (height - paddingY * 2)}
            stroke="color-mix(in oklch, var(--surface-navy) 8%, transparent)"
          />
        ))}

        <polyline
          fill="none"
          points={chartPoints.map((point, index) => `${xAt(index)},${yAt(point.cumulativeProfitUnits)}`).join(' ')}
          stroke={stroke}
          strokeWidth="4.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {chartPoints.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle cx={xAt(index)} cy={yAt(point.cumulativeProfitUnits)} r="6" fill="#ffffff" stroke={stroke} strokeOpacity="0.32" />
            <circle
              cx={xAt(index)} cy={yAt(point.cumulativeProfitUnits)} r="14" fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredPoint({ index, x: xAt(index), y: yAt(point.cumulativeProfitUnits) })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
            <text x={xAt(index)} y={height - 4} textAnchor="middle" fill="color-mix(in oklch, var(--surface-navy) 44%, white)" fontSize="11" fontWeight="600">
              {formatShortDate(point.date)}
            </text>
          </g>
        ))}

        {hoveredPoint !== null && (() => {
          const pt = chartPoints[hoveredPoint.index];
          const tx = hoveredPoint.x;
          const ty = hoveredPoint.y;
          const boxW = 160;
          const boxH = 80;
          const boxX = Math.min(Math.max(tx - boxW / 2, paddingX), width - paddingX - boxW);
          const safeTop = paddingY + 2;
          const safeBottom = height - paddingY - boxH - 2;
          const rawBoxY = ty - boxH - 12;
          const boxY = Math.min(Math.max(rawBoxY, safeTop), safeBottom);
          return (
            <g pointerEvents="none">
              <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="8" ry="8"
                fill="white" stroke="rgba(9,28,57,0.10)" strokeWidth="1"
                style={{ filter: 'drop-shadow(0 4px 12px rgba(9,28,57,0.12))' }} />
              <text x={boxX + 10} y={boxY + 20} fontSize="13" fontWeight="700" fill="rgba(9,28,57,0.5)" letterSpacing="0.12em">
                {formatShortDate(pt.date).toUpperCase()}
              </text>
              <text x={boxX + 10} y={boxY + 42} fontSize="17" fontWeight="700" fill={stroke}>
                {formatUnits(pt.cumulativeProfitUnits)}
              </text>
              <text x={boxX + 10} y={boxY + 58} fontSize="12" fill="rgba(9,28,57,0.45)">
                {`ROI ${formatMetric(pt.cumulativeRoi)} · WR ${formatRate(pt.cumulativeWinRate)}`}
              </text>
              <text x={boxX + 10} y={boxY + 73} fontSize="12" fill="rgba(9,28,57,0.35)">
                {`${pt.graded ?? 0} graded · ${pt.won ?? 0}W ${pt.lost ?? 0}L`}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
// Storage separado: mismo shape que usage.db
  const [storageData, setStorageData] = useState<DbUsage | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [activeSolidPick, setActiveSolidPick] = useState<PersistedSolidPick | null>(null);
  const [solidHistoryVisibleCount, setSolidHistoryVisibleCount] = useState(SOLID_HISTORY_PAGE_SIZE);
  const [solidHistoryOpen, setSolidHistoryOpen] = useState(false);
  const [selectedDataMode, setSelectedDataMode] = useState<'live' | 'testing'>('live');
  const [selectedLivePeriodKey, setSelectedLivePeriodKey] = useState<string | null>(null);

const loadStats = useCallback(async () => {
  try {
    // Carga principal del panel.
    setLoading(true);
    setError(null);

    // Storage se maneja aparte para no frenar el render principal.
    setStorageData(null);
    setStorageLoading(true);

    // 1) Stats principal.
    const res = await fetch('/api/stats', {
      cache: 'no-store',
      headers: {
        'x-origin-hint': 'stats-page'
      }
    });
    const json = (await res.json()) as StatsResponse;

    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'No se pudieron cargar las stats');
    }

    setStats(json);

    // 2) Storage separado.
    void fetch('/api/stats/storage', {
      cache: 'no-store',
      headers: {
        'x-origin-hint': 'stats-page'
      }
    })
      .then(async (storageRes) => {
        const storageJson = await storageRes.json();
        setStorageData(storageJson as DbUsage);
      })
      .catch(() => {
        setStorageData(null);
      })
      .finally(() => {
        setStorageLoading(false);
      });
  } catch (statsError) {
    setError(statsError instanceof Error ? statsError.message : 'Error cargando stats');
    setStorageLoading(false);
  } finally {
    setLoading(false);
  }
}, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    const dateKey = getTodayDateKey();
    const stored = readSolidPick(dateKey);

    if (!stored) {
      setActiveSolidPick(null);
      return;
    }

    const matchingPick = (stats?.recent ?? []).find((item) => item.gameId === stored.gameId);
    if (matchingPick && matchingPick.status !== 'pending') {
      const settled: PersistedSolidPick = {
        ...stored,
        settledStatus: matchingPick.status as 'won' | 'lost' | 'void',
        profitUnits: matchingPick.profitUnits ?? null
      };
      writeSolidPick(settled);
      setActiveSolidPick(settled);
      return;
    }

    setActiveSolidPick(stored);
  }, [stats?.recent]);

const usage = stats?.usage ?? null;
const display = stats?.display ?? null;
const livePeriods = display?.live?.periods ?? [];
const liveViews = display?.live?.views ?? [];

  useEffect(() => {
    const activeKey = display?.live?.activePeriodKey ?? liveViews[0]?.key ?? null;
    if (!activeKey) return;

    setSelectedLivePeriodKey((current) => {
      if (current && liveViews.some((view) => view.key === current)) {
        return current;
      }

      return activeKey;
    });
  }, [display?.live?.activePeriodKey, liveViews]);

const selectedLiveView = useMemo(
  () =>
    liveViews.find((view) => view.key === selectedLivePeriodKey) ??
    liveViews.find((view) => view.key === display?.live?.activePeriodKey) ??
    liveViews[0] ??
    null,
  [display?.live?.activePeriodKey, liveViews, selectedLivePeriodKey]
);

const selectedView = useMemo<SegmentedStatsSlice | LiveStatsView | null>(() => {
  if (selectedDataMode === 'testing') {
    return display?.testing ?? null;
  }

  return selectedLiveView ?? display?.testing ?? null;
}, [display?.testing, selectedDataMode, selectedLiveView]);

const summary = selectedView?.summary ?? null;
const stakeSummaries = selectedView?.stakeSummaries ?? null;
const mainSystemSummary = stakeSummaries?.main_system_summary ?? null;
const allFlatSummary = stakeSummaries?.all_flat_summary ?? null;
const optionalCSummary = stakeSummaries?.optional_c_summary ?? null;
const weightedSummary = stakeSummaries?.weighted_summary ?? null;
const combiSummary = selectedView?.combiSummary ?? null;
const trend = selectedView?.trend ?? [];
const byConfidence = selectedView?.byConfidence ?? [];
const byMarket = selectedView?.byMarket ?? [];
const byEdgeRange = selectedView?.byEdgeRange ?? [];
const dailySummary = selectedView?.daily ?? [];
const clvSummary = selectedView?.clvSummary ?? null;
const clvPositiveRate =
  clvSummary && clvSummary.total_with_clv > 0
    ? clvSummary.positive / clvSummary.total_with_clv
    : null;
const clvNegativeRate =
  clvSummary && clvSummary.total_with_clv > 0
    ? clvSummary.negative / clvSummary.total_with_clv
    : null;
const premiumView = selectedView?.premium ?? {
  summary: {
    total: 0,
    settled: 0,
    won: 0,
    lost: 0,
    void: 0,
    pending: 0,
    winRate: null,
    currentStreak: null
  },
  rankSummaries: [] as PremiumRankSummary[],
  rankHistories: [] as PremiumRankHistory[],
  history: [] as SolidPickHistoryItem[],
  currentPick: null,
  todayRanking: [],
  isLocked: false,
  isClosed: false,
  betterPickPostLock: false,
  betterPick: null
};
const selectedScopeLabel =
  selectedDataMode === 'testing'
    ? 'Testing'
    : selectedLiveView?.label ?? 'Live';
const isLiveCurrentPeriod =
  selectedDataMode === 'live' && Boolean(selectedLiveView?.isCurrent);

// DB card: si ya llegÃ³ el endpoint separado, usamos ese.
// Si todavÃ­a no llega, usamos usage.db del payload principal.
const dbUsage: DbUsage | null = storageData ?? usage?.db ?? null;

const currentPremiumPick = useMemo<PremiumPanelPick | null>(() => {
  if (premiumView.currentPick) {
    return premiumView.currentPick;
  }

  if (selectedDataMode === 'testing' || !isLiveCurrentPeriod) {
    const latestSlicePick = premiumView.history[0];
    if (!latestSlicePick) {
      return null;
    }

    return {
      gameId: latestSlicePick.gameId,
      gameLabel: latestSlicePick.gameLabel,
      market: latestSlicePick.market,
      selection: latestSlicePick.selection,
      confidence: latestSlicePick.confidence,
      score: latestSlicePick.score,
      edge: latestSlicePick.edge,
      ev: latestSlicePick.ev,
      executionOdds: latestSlicePick.executionOdds
    };
  }

  return null;
}, [isLiveCurrentPeriod, premiumView.currentPick, premiumView.history, selectedDataMode]);
  const todayTopPicks = useMemo(
    () => premiumView.todayRanking.slice(0, 3),
    [premiumView.todayRanking]
  );
  const premiumRankCards = useMemo(() => {
    const rankMap = new Map(
      premiumView.rankSummaries.map((entry) => [entry.rank, entry.summary] as const)
    );

    return ([1, 2, 3] as const).map((rank) => ({
      rank,
      summary:
        premiumView.rankHistories.find((entry) => entry.rank === rank)?.summary ??
        rankMap.get(rank) ??
        (rank === 1
          ? premiumView.summary
          : {
              total: 0,
              settled: 0,
              won: 0,
              lost: 0,
              void: 0,
              pending: 0,
              winRate: null,
              currentStreak: null
            }),
      profit:
        premiumView.rankHistories
          .find((entry) => entry.rank === rank)
          ?.history.reduce((sum, item) => sum + (item.profitUnits ?? 0), 0) ?? 0
    }));
  }, [premiumView.rankHistories, premiumView.rankSummaries, premiumView.summary]);
  const premiumHistoryColumns = useMemo(() => {
    return ([1, 2, 3] as const).map((rank) => {
      const entry = premiumView.rankHistories.find((item) => item.rank === rank);
      return {
        rank,
        summary: entry?.summary ?? null,
        items: (entry?.history ?? []).slice(0, solidHistoryVisibleCount)
      };
    });
  }, [premiumView.rankHistories, solidHistoryVisibleCount]);
  const hasMoreSolidHistory = useMemo(
    () =>
      premiumHistoryColumns.some((column) => {
        const total = premiumView.rankHistories.find((entry) => entry.rank === column.rank)?.history.length ?? 0;
        return total > column.items.length;
      }),
    [premiumHistoryColumns, premiumView.rankHistories]
  );
  const premiumSettlementInfo =
    isLiveCurrentPeriod &&
    currentPremiumPick &&
    activeSolidPick?.gameId === currentPremiumPick.gameId
      ? activeSolidPick
      : null;
  const rankingEmptyMessage =
    selectedDataMode === 'testing'
      ? 'Testing no tiene top 3 diario persistido; se muestra solo el historial premium.'
      : isLiveCurrentPeriod
        ? premiumView.isClosed
          ? 'Dia cerrado - sin ranking activo'
          : 'Sin candidatos para hoy'
        : 'No hay top 3 persistido para este periodo live.';

  useEffect(() => {
    setSolidHistoryVisibleCount(SOLID_HISTORY_PAGE_SIZE);
  }, [premiumView.history]);

  return (
    <main className="px-3 pb-4 pt-3 lg:px-5">
      <div className="mx-auto max-w-[1620px]">
        <section className="glass-panel rounded-[1.9rem] p-4 lg:p-5">
          <div className="flex min-h-[168px] flex-col justify-between gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Vista activa</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDataMode('testing')}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                    selectedDataMode === 'testing'
                      ? 'border-[var(--surface-navy)] bg-[var(--surface-navy)] text-white'
                      : 'border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                  }`}
                >
                  Testing
                </button>
                {livePeriods.map((period) => (
                  <button
                    key={period.key}
                    type="button"
                    onClick={() => {
                      setSelectedDataMode('live');
                      setSelectedLivePeriodKey(period.key);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition ${
                      selectedDataMode === 'live' && selectedLivePeriodKey === period.key
                        ? 'border-[var(--surface-navy)] bg-[var(--surface-navy)] text-white'
                        : 'border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                    }`}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                {selectedScopeLabel}
              </div>
              <button
                onClick={() => void loadStats()}
                className="rounded-full bg-[var(--surface-navy)] px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(9,28,57,0.18)] transition hover:bg-[rgba(9,28,57,0.92)]"
              >
                Recargar
              </button>
            </div>
            </div>

            {(mainSystemSummary ?? summary) && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="navy-panel rounded-[1.25rem] p-3 text-white">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/60">Sistema A/B</div>
                <div className="mt-1 text-[1.5rem] font-semibold">{mainSystemSummary?.total_picks ?? summary?.totalPicks ?? 0}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Win rate</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{formatRate(mainSystemSummary?.win_rate ?? summary?.winRate)}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Profit</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{formatUnits(mainSystemSummary?.profit_units ?? summary?.totalProfitUnits)}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">ROI</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{formatRate(mainSystemSummary?.roi ?? summary?.roi)}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Pendientes</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{mainSystemSummary?.pending ?? summary?.pendingCount ?? 0}</div>
              </div>
              </div>
            )}
            {stakeSummaries && (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: 'Weighted A/B/C', item: weightedSummary, detail: 'A 1u · B 0.5u · C 0.25u' },
                  { label: 'Flat total', item: allFlatSummary, detail: 'A/B/C a 1u' },
                  { label: 'Optional C', item: optionalCSummary, detail: 'Riesgo separado' },
                  { label: 'Combi Lab', item: combiSummary, detail: 'Solo combinadas' }
                ].map(({ label, item, detail }) => (
                  <div key={label} className="rounded-[1rem] border border-[var(--line-soft)] bg-white/80 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</div>
                      <div className="text-[11px] text-[var(--ink-soft)]">{detail}</div>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <div className="text-[1.05rem] font-semibold text-[var(--ink-strong)]">
                        {formatUnits(item && 'profit_units' in item ? item.profit_units : null)}
                      </div>
                      <div className="text-xs text-[var(--ink-soft)]">
                        WR {formatRate(item && 'win_rate' in item ? item.win_rate : null)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {clvSummary && (
              <div className="rounded-[1.2rem] border border-[var(--line-soft)] bg-white/82 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">CLV</div>
                    <div className="mt-1 text-sm font-semibold text-[var(--ink-strong)]">
                      {clvSummary.total_with_clv > 0
                        ? `${clvSummary.total_with_clv} picks con cierre`
                        : 'CLV todavia no capturado'}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-right">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Positivo</div>
                      <div className="text-sm font-semibold text-[var(--tone-good)]">{formatRate(clvPositiveRate)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Negativo</div>
                      <div className="text-sm font-semibold text-[var(--tone-bad)]">{formatRate(clvNegativeRate)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Avg CLV</div>
                      <div className="text-sm font-semibold text-[var(--ink-strong)]">{formatRate(clvSummary.avg_clv_percent)}</div>
                    </div>
                  </div>
                </div>

                {clvSummary.total_with_clv > 0 && (
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    <div className="rounded-[0.95rem] bg-[var(--surface-soft)] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Por mercado</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {clvSummary.avg_clv_by_market.slice(0, 6).map((bucket) => (
                          <span
                            key={`clv-market-${bucket.key}`}
                            className="rounded-full border border-[var(--line-soft)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-soft)]"
                          >
                            {bucket.key} {formatRate(bucket.avg_clv_percent)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[0.95rem] bg-[var(--surface-soft)] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Por tier</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {clvSummary.avg_clv_by_confidence.slice(0, 6).map((bucket) => (
                          <span
                            key={`clv-tier-${bucket.key}`}
                            className="rounded-full border border-[var(--line-soft)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-soft)]"
                          >
                            {bucket.key} {formatRate(bucket.avg_clv_percent)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {loading && (
          <div className="glass-panel mt-4 rounded-[1.4rem] p-4">
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-soft)]">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--surface-navy)]/50" />
            </div>
            <div className="mt-2.5 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Cargando stats...</div>
          </div>
        )}
        {error && <div className="glass-panel mt-4 rounded-[1.4rem] p-4 text-rose-700">{error}</div>}

        {!loading && !error && summary && usage && (
          <>
            {/* Row 2 â€” Profit acumulado + Sistema premium */}
            <section className="mt-3 grid gap-3 xl:grid-cols-2">

              {/* Profit acumulado */}
              <div className="glass-panel rounded-[1.7rem] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-[1.35rem] font-semibold text-[var(--ink-strong)]">Profit acumulado</h2>
                  </div>
                  <div className="rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                    {selectedScopeLabel}
                  </div>
                </div>
                <div className="mt-3">
                  <ProfitTrendChart points={trend} />
                </div>
                <div className="mt-3 rounded-[1.2rem] border border-[var(--line-soft)] bg-white/90 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Resumen diario</div>
                    <div className="text-[11px] text-[var(--ink-soft)]">{dailySummary.length} dias</div>
                  </div>
                  {dailySummary.length > 0 ? (
                    <div className="mt-2 max-h-[280px] space-y-1.5 overflow-auto pr-1">
                      {dailySummary.map((day) => (
                        <div
                          key={day.date}
                          className="rounded-[0.95rem] border border-[var(--line-soft)] bg-[var(--surface-soft)] px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold text-[var(--ink-strong)]">{formatDateLabel(day.date)}</div>
                            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                              {formatRecord(day.won, day.lost)} · {formatUnits(day.profitUnits)}
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-[var(--ink-soft)]">
                            <span>ROI {formatMetric(day.roi)}</span>
                            <span>{day.graded} graded</span>
                            <span>{day.pending} pendientes</span>
                          </div>
                          {day.premiumTopPick && (
                            <div className="mt-1.5 rounded-[0.75rem] bg-white/80 px-2 py-1.5 text-[10px] text-[var(--ink-soft)]">
                              <span className="font-semibold text-[var(--ink-strong)]">Premium:</span>{' '}
                              {resolveMatchupLabel(day.premiumTopPick.gameId, day.premiumTopPick.gameLabel, stats?.recent)} ·{' '}
                              {day.premiumTopPick.market} · {day.premiumTopPick.selection}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 rounded-[0.95rem] border border-[var(--line-soft)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--ink-soft)]">
                      Aun no hay dias suficientes para este periodo.
                    </div>
                  )}
                </div>
              </div>

              {/* Sistema premium */}
              <section className="relative overflow-hidden rounded-[1.7rem] border border-[#ead18f]/45 bg-[linear-gradient(145deg,rgba(255,248,224,0.92),rgba(255,255,255,0.98))] p-4 shadow-[0_18px_44px_rgba(160,126,50,0.14)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,221,136,0.25),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(189,146,53,0.14),transparent_34%)]" />
                <div className="relative">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-heading text-[1.35rem] font-semibold text-[var(--ink-strong)]">Sistema premium</h3>
                    <div className="rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                      {selectedScopeLabel}
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    {premiumRankCards.map((entry) => {
                      const frame = getPremiumRankFrame(entry.rank);

                      return (
                        <div key={`premium-rank-card-${entry.rank}`} className={`rounded-[1.2rem] border p-3 ${frame.shell}`}>
                          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                            <div className={`rounded-[1.05rem] p-2.5 ${frame.hero}`}>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-current/60">Record</div>
                              <div className="mt-1 text-lg font-semibold">{entry.summary.won}/{entry.summary.total}</div>
                            </div>
                            <div className={`rounded-[1.05rem] border p-2.5 ${frame.card}`}>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">WR</div>
                              <div className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">{formatRate(entry.summary.winRate)}</div>
                            </div>
                            <div className={`rounded-[1.05rem] border p-2.5 ${frame.card}`}>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Profit</div>
                              <div className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">{formatUnits(entry.profit)}</div>
                            </div>
                            <div className={`rounded-[1.05rem] border p-2.5 ${frame.card}`}>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Racha</div>
                              <div className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">{formatStreak(entry.summary.currentStreak)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Panel swap: Top Score / Historial */}
                  <div className="mt-3">
                    {/* Tab switcher */}
                    <div className="mb-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSolidHistoryOpen(false)}
                        className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                          !solidHistoryOpen
                            ? 'border-[#ead18f] bg-[rgba(255,248,224,1)] text-[#8a6115]'
                            : 'border-[#efe1b8] bg-transparent text-[var(--ink-muted)] hover:bg-[rgba(255,248,224,0.5)]'
                        }`}
                      >
                        Top score
                      </button>
                      <button
                        type="button"
                        onClick={() => setSolidHistoryOpen(true)}
                        className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition ${
                          solidHistoryOpen
                            ? 'border-[#ead18f] bg-[rgba(255,248,224,1)] text-[#8a6115]'
                            : 'border-[#efe1b8] bg-transparent text-[var(--ink-muted)] hover:bg-[rgba(255,248,224,0.5)]'
                        }`}
                      >
                        Historial
                      </button>
                    </div>

                    {/* Panel: Top score */}
                    {!solidHistoryOpen && (() => {
                      const solidGameId =
                        currentPremiumPick?.gameId ??
                        premiumSettlementInfo?.gameId ??
                        activeSolidPick?.gameId ??
                        null;
                      const betterPostLock = selectedDataMode === 'live' && premiumView.betterPickPostLock;
                      const betterPickData = premiumView.betterPick;
                      const topItems = todayTopPicks.map((item) => ({
                        rank: item.rank,
                        gameId: item.gameId,
                        market: item.market,
                        selection: item.selection,
                        confidence: item.confidence,
                        status: item.status,
                        gameLabel: resolveMatchupLabel(item.gameId, item.gameLabel, stats?.recent),
                        score: item.score,
                        odds: item.executionOdds ?? null,
                        profitUnits: item.profitUnits ?? null,
                        edge: item.edge ?? null,
                        ev: item.ev ?? null,
                        estimatedProbability: item.estimatedProbability ?? null,
                        impliedProbability: item.impliedProbability ?? null,
                        prevScore: item.prevScore ?? null,
                        prevOdds: item.prevExecutionOdds ?? null,
                        prevEdge: item.prevEdge ?? null,
                        prevEv: item.prevEv ?? null,
                        prevEstimatedProbability: item.prevEstimatedProbability ?? null,
                        prevImpliedProbability: item.prevImpliedProbability ?? null,
                        chosen: item.gameId === solidGameId,
                      }));

                      if (!topItems.length) {
                        return (
                          <div className="py-2 text-[11px] text-[var(--ink-soft)]">
                            {rankingEmptyMessage}
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-1.5">
                          {betterPostLock && betterPickData && (
                            <div className="rounded-[0.8rem] border border-[#ead18f]/50 bg-[rgba(255,248,224,0.6)] px-2.5 py-1.5">
                              <div className="text-[9px] uppercase tracking-[0.14em] text-[#9b771c]">Mejor pick post-lock detectado</div>
                              <div className="mt-0.5 text-[11px] font-semibold text-[var(--ink-strong)]">
                                {betterPickData.market} · {betterPickData.selection} · Score {formatMetric(betterPickData.score)}
                              </div>
                              <div className="text-[10px] text-[#8a6115]">
                                {resolveMatchupLabel(betterPickData.gameId, betterPickData.gameLabel, stats?.recent)}
                              </div>
                            </div>
                          )}
                          {topItems.map((pick) => (
                            <div
                              key={pick.rank}
                              className={
                                pick.rank === 1
                                  ? 'rounded-[0.95rem] border border-[#ead18f]/60 bg-[rgba(255,248,224,0.82)] px-2.5 py-2'
                                  : pick.rank === 2
                                    ? 'rounded-[0.95rem] border border-[#d9dee7] bg-[linear-gradient(145deg,rgba(243,246,251,0.94),rgba(255,255,255,0.98))] px-2.5 py-2'
                                    : 'rounded-[0.95rem] border border-[#e2cdb8] bg-[linear-gradient(145deg,rgba(247,239,232,0.94),rgba(255,255,255,0.98))] px-2.5 py-2'
                              }
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-4 shrink-0 text-[10px] font-bold text-[var(--ink-muted)]">#{pick.rank}</span>
                                <span
                                  className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                  style={marketPillStyle(pick.market)}
                                >
                                  {pick.market}
                                </span>
                                <span className="truncate text-[11px] font-semibold text-[var(--ink-strong)]">{pick.selection}</span>
                                {pick.rank === 1 && (
                                  <span className="ml-auto shrink-0 rounded-full border border-[#ead18f]/70 bg-[rgba(255,248,224,0.96)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8a6115]">
                                    Pick solido de hoy
                                  </span>
                                )}
                              </div>
                              {pick.gameLabel && (
                                <div className="mt-0.5 pl-6 text-[10px] text-[var(--ink-muted)]">{pick.gameLabel}</div>
                              )}
                              <div className="mt-1.5 grid grid-cols-3 gap-1 pl-6">
                                {(() => {
                                  const metrics: Array<{ label: string; cur: number | null; prev: number | null; fmt: (v?: number | null) => string; inv?: boolean }> = [
                                    { label: 'Score', cur: pick.score, prev: pick.prevScore, fmt: formatMetric },
                                    { label: 'Prob', cur: pick.estimatedProbability, prev: pick.prevEstimatedProbability, fmt: formatRate },
                                    { label: 'Impl', cur: pick.impliedProbability, prev: pick.prevImpliedProbability, fmt: formatRate, inv: true },
                                    { label: 'Edge', cur: pick.edge, prev: pick.prevEdge, fmt: formatMetric },
                                    { label: 'EV', cur: pick.ev, prev: pick.prevEv, fmt: formatMetric },
                                    { label: 'Odds', cur: pick.odds, prev: pick.prevOdds, fmt: formatOdds, inv: true },
                                  ];
                                  return metrics.map(({ label, cur, prev, fmt, inv }) => {
                                    const d = typeof cur === 'number' && typeof prev === 'number' && Math.abs(cur - prev) >= 0.0005 ? cur - prev : null;
                                    const dc = d !== null ? ((inv ? d < 0 : d > 0) ? 'text-emerald-600' : 'text-rose-500') : '';
                                    return (
                                      <div key={label} className="rounded-[0.6rem] bg-white/60 px-1.5 py-1">
                                        <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">{label}</div>
                                        <div className="mt-0.5 flex items-baseline gap-1">
                                          <span className="text-[11px] font-semibold text-[var(--ink-strong)]">{fmt(cur)}</span>
                                          {d !== null && <span className={`text-[9px] font-medium ${dc}`}>{d > 0 ? '+' : ''}{d.toFixed(3)}</span>}
                                        </div>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Panel: Historial */}
                    {solidHistoryOpen && (
                      <div className="grid gap-2 xl:grid-cols-3">
                        {premiumHistoryColumns.map((column) => (
                          <div key={`premium-history-rank-${column.rank}`} className="space-y-1">
                            <div className="rounded-[0.85rem] border border-[var(--line-soft)] bg-white/70 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                              Historial · {column.rank}
                            </div>
                            {column.items.length ? (
                              column.items.map((item) => (
                                <div key={`${column.rank}-${item.date}-${item.gameId}`} className="rounded-[0.85rem] bg-[var(--surface-soft)] px-2.5 py-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-[11px] font-semibold text-[var(--ink-strong)]">{formatDateLabel(item.date)}</div>
                                    <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">{item.status} · {item.confidence}</div>
                                  </div>
                                  <div className="text-[10px] text-[var(--ink-muted)]">{resolveMatchupLabel(item.gameId, item.gameLabel, stats?.recent)}</div>
                                  <div className="mt-0.5 text-[11px] text-[var(--ink-strong)]">{item.market} · {item.selection}</div>
                                  <div className="mt-0.5 text-[10px] text-[var(--ink-soft)]">Score {formatMetric(item.score)} · {formatOdds(item.executionOdds)} · {formatUnits(item.profitUnits)}</div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-[0.85rem] bg-[var(--surface-soft)] px-2.5 py-2 text-[11px] text-[var(--ink-soft)]">
                                Sin historial visible para top #{column.rank}.
                              </div>
                            )}
                          </div>
                        ))}
                        {hasMoreSolidHistory && (
                          <div className="xl:col-span-3">
                            <button
                              type="button"
                              onClick={() => setSolidHistoryVisibleCount((current) => current + SOLID_HISTORY_PAGE_SIZE)}
                              className="w-full rounded-[0.85rem] border border-[var(--line-soft)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                            >
                              Ver más historial
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </section>
            {/* Row 3 â€” Performance 3-col */}
            <section className="mt-3 grid gap-3 xl:grid-cols-3">
              <section className="glass-panel rounded-[1.6rem] p-3">
                <h3 className="font-heading text-[1.3rem] font-semibold text-[var(--ink-strong)]">Por confianza</h3>
                <div className="mt-3 space-y-2">
                  {byConfidence.map((bucket) => {
                    const tone = getPerformanceTone(bucket.winRate, bucket.profitUnits, bucket.avgEv);
                    const fill = Math.max(10, Math.min(100, (bucket.winRate ?? 0) * 100));
                    return (
                      <div key={bucket.key} className="rounded-[1.1rem] border border-[var(--line-soft)] bg-white px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
                              style={confidencePillStyle(bucket.key)}
                            >
                              Tier {bucket.key}
                            </span>
                            <div className="text-sm font-semibold text-[var(--ink-strong)]">
                              {bucket.total} picks · WR {formatRate(bucket.winRate)}
                            </div>
                          </div>
                          <div className={`text-sm font-semibold ${performanceTextClasses(tone)}`}>{formatUnits(bucket.profitUnits)}</div>
                        </div>
                        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                          <div className="h-full rounded-full" style={{ ...performanceBarStyle(tone), width: `${fill}%` }} />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
                          <span>Edge {formatMetric(bucket.avgEdge)}</span>
                          <span>EV {formatMetric(bucket.avgEv)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="glass-panel rounded-[1.6rem] p-3">
                <h3 className="font-heading text-[1.3rem] font-semibold text-[var(--ink-strong)]">Rendimiento por Mercado</h3>
                <div className="mt-3 space-y-3">
                  {byMarket.map((bucket) => (
                    <BucketPerformanceBar key={bucket.key} bucket={bucket} />
                  ))}
                </div>
              </section>

              <section className="glass-panel rounded-[1.6rem] p-3">
                <h3 className="font-heading text-[1.3rem] font-semibold text-[var(--ink-strong)]">Backtesting por Edge</h3>
                <div className="mt-3 space-y-3">
                  {byEdgeRange.map((bucket) => (
                    <BucketPerformanceBar key={bucket.key} bucket={bucket} />
                  ))}
                </div>
              </section>
            </section>

{/* Row 4 â€” Infraestructura 3-col */}
<section className="mt-3 grid gap-3 xl:grid-cols-3">
  <div className="glass-panel rounded-[1.35rem] p-3.5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">DB</div>
        <div className="mt-1 text-[1.4rem] font-semibold text-[var(--ink-strong)]">
          {dbUsage ? dbUsage.estimatedUsedMb.toFixed(3) : '0.000'} MB
        </div>
      </div>
      <div className="text-right text-[11px] text-[var(--ink-soft)]">
        {dbUsage ? dbUsage.percentUsed.toFixed(1) : '0.0'}% de 500 MB
      </div>
    </div>

    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--surface-soft)]">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, dbUsage?.percentUsed ?? 0)}%`,
          background:
            (dbUsage?.percentUsed ?? 0) < 70
              ? 'var(--tone-good)'
              : (dbUsage?.percentUsed ?? 0) < 90
                ? 'var(--tone-mid)'
                : 'var(--tone-bad)'
        }}
      />
    </div>

    <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-[var(--ink-soft)]">
      <div>
        {dbUsage
          ? dbUsage.estimatedUsedMb > 0
            ? `Libre aprox. ${dbUsage.remainingMb.toFixed(0)} MB · excluye payloads`
            : dbUsage.note
          : 'No se pudo cargar storage'}
      </div>

      {storageLoading && (
        <div className="shrink-0 uppercase tracking-[0.16em] text-[10px] text-[var(--ink-muted)]">
          Cargando...
        </div>
      )}
    </div>
  </div>

<div className="glass-panel rounded-[1.35rem] p-3.5">
  <div className="flex items-center justify-between gap-3">
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
        Odds
      </div>

      {/* ðŸ”¥ Conteo principal: MES */}
      <div className="mt-1 text-[1.4rem] font-semibold text-[var(--ink-strong)]">
        {usage?.odds?.monthCount ?? 0}
      </div>
    </div>

    {/* Estado de presupuesto */}
    <div
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
        usage?.odds?.withinBudget
          ? 'border-[var(--tone-good)]/35 bg-[var(--tone-good)]/10 text-[var(--tone-good)]'
          : 'border-[var(--tone-bad)]/35 bg-[var(--tone-bad)]/10 text-[var(--tone-bad)]'
      }`}
    >
      {usage?.odds?.withinBudget ? 'EN RANGO' : 'FUERA DE RANGO'}
    </div>
  </div>

  {/* ðŸ”¥ Detalle: HOY + LÃMITE */}
  <div className="mt-1 text-[11px] text-[var(--ink-soft)]">
    Hoy: {usage?.odds?.todayCount ?? 0} · / {usage?.odds?.monthlyLimit ?? 2500} mes
  </div>

  <div className="mt-2 text-[12px] text-[var(--ink-soft)]">
    {usage?.odds?.note ?? 'Sin datos de uso de odds'}
  </div>
</div>

  <div className="glass-panel rounded-[1.35rem] p-3.5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Vercel</div>
        <div className="mt-1 text-[1.4rem] font-semibold text-[var(--ink-strong)]">
          {usage?.vercel?.planMode ?? 'N/A'}
        </div>
      </div>
<div className="text-right text-[11px] text-[var(--ink-soft)]">
  {usage?.vercel?.live?.readyProductionDeployments30d != null
    ? `${usage.vercel.live.readyProductionDeployments30d} prod listas`
    : ''}
</div>
    </div>

    <div className="mt-2 text-[12px] text-[var(--ink-soft)]">
      {usage?.vercel?.note ?? 'Sin datos de Vercel'}
    </div>
  </div>
</section>
          </>
        )}
      </div>
    </main>
  );
}

