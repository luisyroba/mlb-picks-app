'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readSolidPick,
  writeSolidPick,
  type PersistedSolidPick
} from '@/lib/solid-pick-client';
import {
  SOLID_PICK_RESET_DATE_KEYS,
  USER_TIMEZONE,
  formatDateKeyForTimezone,
  formatDateTimeForTimezone
} from '@/lib/runtime-config';

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
    history: SolidPickHistoryItem[];
    todayRanking?: {
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
};

const SOLID_PICK_RESET_DATES = new Set(SOLID_PICK_RESET_DATE_KEYS);
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

function formatDateTime(value?: string | null) {
  const formatted = formatDateTimeForTimezone(value, 'es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  });
  return formatted ?? value ?? '-';
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


function formatStreak(streak?: { type: 'won' | 'lost'; count: number } | null) {
  if (!streak) return '-';
  return `${streak.type === 'won' ? 'W' : 'L'}${streak.count}`;
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

  // Start from the first date that actually has settled picks
  const firstMeaningfulIndex = validPoints.findIndex((p) => p.settled > 0 || p.graded > 0);
  const chartPoints = firstMeaningfulIndex >= 0 ? validPoints.slice(firstMeaningfulIndex) : validPoints;

  if (!chartPoints.length) {
    return (
      <div className="rounded-[1.3rem] border border-[var(--line-soft)] bg-white p-4 text-sm text-[var(--ink-soft)]">
        Aun no hay picks settled suficientes para dibujar una curva historica.
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
                {`ROI ${formatMetric(pt.cumulativeRoi)}  ·  WR ${formatRate(pt.cumulativeWinRate)}`}
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
  const [activeSolidPick, setActiveSolidPick] = useState<PersistedSolidPick | null>(null);
  const [solidHistoryVisibleCount, setSolidHistoryVisibleCount] = useState(SOLID_HISTORY_PAGE_SIZE);
  const [solidHistoryOpen, setSolidHistoryOpen] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/stats', { cache: 'no-store' });
      const json = (await res.json()) as StatsResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'No se pudieron cargar las stats');
      }
      setStats(json);
    } catch (statsError) {
      setError(statsError instanceof Error ? statsError.message : 'Error cargando stats');
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

  const summary = stats?.summary ?? null;
  const usage = stats?.usage ?? null;
  const trend = stats?.trend ?? [];
  const byConfidence = stats?.byConfidence ?? [];
  const byMarket = stats?.byMarket ?? [];
  const byEdgeRange = stats?.byEdgeRange ?? [];
  const solidPick = useMemo(() => {
    const base = stats?.solidPick ?? {
      today: null,
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
      history: [] as SolidPickHistoryItem[]
    };

    if (!activeSolidPick && SOLID_PICK_RESET_DATES.has(getTodayDateKey())) {
      return {
        today: null,
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
        history: [] as SolidPickHistoryItem[]
      };
    }

    if (!activeSolidPick) {
      return base;
    }

    return {
      ...base,
      summary: {
        ...base.summary,
        pending: Math.max(base.summary.pending, 1)
      },
      today: {
        date: getTodayDateKey(),
        gameId: activeSolidPick.gameId,
        market: activeSolidPick.market,
        selection: activeSolidPick.selection,
        confidence: activeSolidPick.confidence,
        status: 'pending',
        score: activeSolidPick.score,
        edge: activeSolidPick.edge,
        ev: activeSolidPick.ev,
        estimatedProbability: null,
        executionOdds: activeSolidPick.odds,
        profitUnits: null,
        createdAt: activeSolidPick.lockedAt,
        updatedAt: activeSolidPick.lockedAt
      }
    };
  }, [activeSolidPick, stats?.solidPick]);
  const visibleSolidHistory = useMemo(
    () => solidPick.history.slice(0, solidHistoryVisibleCount),
    [solidHistoryVisibleCount, solidPick.history]
  );
  const hasMoreSolidHistory = solidPick.history.length > visibleSolidHistory.length;
  const solidTotalProfit = useMemo(
    () => solidPick.history.reduce((sum, item) => sum + (item.profitUnits ?? 0), 0),
    [solidPick.history]
  );
  const todayTopPicks = useMemo(
    () => stats?.solidPick?.todayRanking?.slice(0, 3) ?? [],
    [stats?.solidPick?.todayRanking]
  );

  useEffect(() => {
    setSolidHistoryVisibleCount(SOLID_HISTORY_PAGE_SIZE);
  }, [solidPick.history]);

  return (
    <main className="px-3 pb-4 pt-3 lg:px-5">
      <div className="mx-auto max-w-[1620px]">
        <section className="glass-panel rounded-[1.9rem] p-4 lg:p-5">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={() => void loadStats()}
              className="rounded-full bg-[var(--surface-navy)] px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(9,28,57,0.18)] transition hover:bg-[rgba(9,28,57,0.92)]"
            >
              Recargar
            </button>
          </div>

          {summary && (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <div className="navy-panel rounded-[1.25rem] p-3 text-white">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/60">Total picks</div>
                <div className="mt-1 text-[1.5rem] font-semibold">{summary.totalPicks}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Win rate</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{formatRate(summary.winRate)}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Profit</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{formatUnits(summary.totalProfitUnits)}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">ROI</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{formatMetric(summary.roi)}</div>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Pendientes</div>
                <div className="mt-1 text-[1.5rem] font-semibold text-[var(--ink-strong)]">{summary.pendingCount}</div>
              </div>
            </div>
          )}
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
            {/* Row 2 — Profit acumulado + Sistema premium */}
            <section className="mt-3 grid gap-3 xl:grid-cols-2">

              {/* Profit acumulado */}
              <div className="glass-panel rounded-[1.7rem] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-heading text-[1.35rem] font-semibold text-[var(--ink-strong)]">Profit acumulado</h2>
                  <div className="rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                    {trend.length} cortes
                  </div>
                </div>
                <div className="mt-3"><ProfitTrendChart points={trend} /></div>
              </div>

              {/* Sistema premium */}
              <section className="relative overflow-hidden rounded-[1.7rem] border border-[#ead18f]/45 bg-[linear-gradient(145deg,rgba(255,248,224,0.92),rgba(255,255,255,0.98))] p-4 shadow-[0_18px_44px_rgba(160,126,50,0.14)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,221,136,0.25),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(189,146,53,0.14),transparent_34%)]" />
                <div className="relative">
                  <div className="text-[10px] uppercase tracking-[0.24em] text-[#9b771c]">Pick solido diario</div>
                  <h3 className="mt-0.5 font-heading text-[1.35rem] font-semibold text-[var(--ink-strong)]">Sistema premium</h3>

                  {/* Metrics 4-col: Record / WR / Profit / Racha */}
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    <div className="rounded-[1.1rem] bg-[linear-gradient(135deg,#7f5a11,#d4a942)] p-2.5 text-white shadow-[0_12px_24px_rgba(127,90,17,0.2)]">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/60">Record</div>
                      <div className="mt-1 text-lg font-semibold">{solidPick?.summary.won ?? 0}/{solidPick?.summary.total ?? 0}</div>
                    </div>
                    <div className="rounded-[1.1rem] border border-[#efe1b8] bg-[rgba(255,255,255,0.74)] p-2.5">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">WR</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">{formatRate(solidPick?.summary.winRate)}</div>
                    </div>
                    <div className="rounded-[1.1rem] border border-[#efe1b8] bg-[rgba(255,255,255,0.74)] p-2.5">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Profit</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">{formatUnits(solidTotalProfit)}</div>
                    </div>
                    <div className="rounded-[1.1rem] border border-[#efe1b8] bg-[rgba(255,255,255,0.74)] p-2.5">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">Racha</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">{formatStreak(solidPick?.summary.currentStreak)}</div>
                    </div>
                  </div>

                  {/* Pick de hoy */}
                  <div className="mt-3 rounded-[1.1rem] border border-[#ead18f] bg-[linear-gradient(135deg,rgba(255,248,224,0.92),rgba(255,255,255,0.9))] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Pick sólido de hoy</div>
                      {stats?.solidPick?.isLocked && (
                        <span className="rounded-full border border-[#ead18f]/70 bg-[rgba(255,248,224,0.9)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8a6115]">Lock</span>
                      )}
                    </div>
                    {stats?.solidPick?.isClosed ? (
                      <>
                        <div className="mt-1.5 text-base font-semibold text-[var(--ink-strong)]">Pick sólido del día finalizado</div>
                        <div className="mt-1.5 text-xs text-[var(--ink-soft)]">
                          El juego de hoy ya fue resuelto. El sistema no abrirá un nuevo pick para este día.
                        </div>
                      </>
                    ) : stats?.solidPick?.premiumPick ? (() => {
                      const pp = stats.solidPick!.premiumPick!;
                      const settlementInfo = activeSolidPick?.gameId === pp.gameId ? activeSolidPick : null;
                      return (
                        <>
                          <div className="mt-1.5 text-base font-semibold text-[var(--ink-strong)]">
                            {pp.market} / {pp.selection}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--ink-soft)]">{pp.gameLabel} · {pp.confidence}</div>
                          <div className="mt-2 grid grid-cols-4 gap-1.5">
                            <div className="rounded-[0.8rem] bg-white/70 px-2 py-1.5">
                              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Cuota</div>
                              <div className="mt-0.5 text-sm font-semibold text-[var(--ink-strong)]">{formatOdds(pp.executionOdds)}</div>
                            </div>
                            <div className="rounded-[0.8rem] bg-white/70 px-2 py-1.5">
                              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Score</div>
                              <div className="mt-0.5 text-sm font-semibold text-[var(--ink-strong)]">{formatMetric(pp.score)}</div>
                            </div>
                            <div className="rounded-[0.8rem] bg-white/70 px-2 py-1.5">
                              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Edge</div>
                              <div className="mt-0.5 text-sm font-semibold text-[var(--ink-strong)]">{formatMetric(pp.edge)}</div>
                            </div>
                            <div className="rounded-[0.8rem] bg-white/70 px-2 py-1.5">
                              <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Estado</div>
                              <div className="mt-0.5 text-sm font-semibold text-[var(--ink-strong)]">
                                {settlementInfo?.settledStatus?.toUpperCase() ?? 'PENDING'}
                              </div>
                              {settlementInfo?.settledStatus && typeof settlementInfo.profitUnits === 'number' && (
                                <div className="text-[10px] text-[var(--ink-soft)]">{formatUnits(settlementInfo.profitUnits)}</div>
                              )}
                            </div>
                          </div>
                          {activeSolidPick?.note && (
                            <div className="mt-2 rounded-[0.8rem] border border-[rgba(210,166,73,0.22)] bg-[rgba(210,166,73,0.08)] px-2.5 py-1.5 text-[11px] text-[#6d5220]">
                              {activeSolidPick.note}
                            </div>
                          )}
                        </>
                      );
                    })() : (
                      <>
                        <div className="mt-1.5 text-base font-semibold text-[var(--ink-strong)]">Sin pick sólido activo hoy</div>
                        <div className="mt-1.5 text-xs text-[var(--ink-soft)]">
                          Se mostrará aquí cuando el slate de hoy deje un pick premium activo.
                        </div>
                      </>
                    )}
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
                        Historial · {solidPick.history.length}
                      </button>
                    </div>

                    {/* Panel: Top score */}
                    {!solidHistoryOpen && (() => {
                      const solidGameId = stats?.solidPick?.premiumPick?.gameId ?? solidPick.today?.gameId ?? activeSolidPick?.gameId;
                      const betterPostLock = stats?.solidPick?.betterPickPostLock;
                      const betterPickData = stats?.solidPick?.betterPick;
                      const topItems = todayTopPicks.map((item, idx) => ({
                        rank: idx + 1,
                        market: item.market,
                        selection: item.selection,
                        gameLabel: item.gameLabel,
                        score: item.score,
                        odds: item.executionOdds ?? null,
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
                            {stats?.solidPick?.isClosed ? 'Día cerrado — sin ranking activo' : 'Sin candidatos para hoy'}
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
                              <div className="text-[10px] text-[#8a6115]">{betterPickData.gameLabel}</div>
                            </div>
                          )}
                          {topItems.map((pick) => (
                            <div
                              key={pick.rank}
                              className={`rounded-[0.9rem] px-2.5 py-2 ${pick.chosen ? 'border border-[#ead18f]/60 bg-[rgba(255,248,224,0.8)]' : 'border border-[var(--line-soft)] bg-[var(--surface-soft)]'}`}
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
                                    const d = (typeof cur === 'number' && typeof prev === 'number' && Math.abs(cur - prev) >= 0.0005) ? cur - prev : null;
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
                      <div className="space-y-1">
                        {visibleSolidHistory.map((item) => (
                          <div key={`${item.date}-${item.gameId}`} className="rounded-[0.85rem] bg-[var(--surface-soft)] px-2.5 py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-[11px] font-semibold text-[var(--ink-strong)]">{formatDateLabel(item.updatedAt)}</div>
                              <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">{item.status} · {item.confidence}</div>
                            </div>
                            {item.gameLabel && item.gameLabel !== item.gameId && (
                              <div className="text-[10px] text-[var(--ink-muted)]">{item.gameLabel}</div>
                            )}
                            <div className="mt-0.5 text-[11px] text-[var(--ink-strong)]">{item.market} · {item.selection}</div>
                            <div className="mt-0.5 text-[10px] text-[var(--ink-soft)]">Score {formatMetric(item.score)} · {formatOdds(item.executionOdds)} · {formatUnits(item.profitUnits)}</div>
                          </div>
                        ))}
                        {hasMoreSolidHistory && (
                          <button
                            type="button"
                            onClick={() => setSolidHistoryVisibleCount((current) => current + SOLID_HISTORY_PAGE_SIZE)}
                            className="w-full rounded-[0.85rem] border border-[var(--line-soft)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                          >
                            Ver más historial
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </section>

            {/* Row 3 — Performance 3-col */}
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

            {/* Row 4 — Infraestructura 3-col */}
            <section className="mt-3 grid gap-3 xl:grid-cols-3">
              <div className="glass-panel rounded-[1.35rem] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">DB</div>
                    <div className="mt-1 text-[1.4rem] font-semibold text-[var(--ink-strong)]">{usage.db.estimatedUsedMb.toFixed(3)} MB</div>
                  </div>
                  <div className="text-right text-[11px] text-[var(--ink-soft)]">
                    {usage.db.percentUsed.toFixed(1)}% de 500 MB
                  </div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, usage.db.percentUsed)}%`,
                      background: usage.db.percentUsed < 70
                        ? 'var(--tone-good)'
                        : usage.db.percentUsed < 90
                          ? 'var(--tone-mid)'
                          : 'var(--tone-bad)'
                    }}
                  />
                </div>
                <div className="mt-1.5 text-[11px] text-[var(--ink-soft)]">
                  {usage.db.estimatedUsedMb > 0
                    ? `Libre aprox. ${usage.db.remainingMb.toFixed(0)} MB · excluye payloads`
                    : usage.db.note}
                </div>
              </div>

              <div className="glass-panel rounded-[1.35rem] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Odds</div>
                    <div className="mt-1 text-[1.4rem] font-semibold text-[var(--ink-strong)]">{usage.odds.monthCount}</div>
                    <div className="text-[11px] text-[var(--ink-soft)]">/ {usage.odds.monthlyLimit} mes</div>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${usage.odds.withinBudget ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-rose-200 bg-rose-50 text-rose-800'}`}>
                    {usage.odds.withinBudget ? 'En rango' : 'Ajustar'}
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-[var(--ink-soft)]">
                  {usage.odds.todayCount} hoy · {usage.odds.remainingMonthCalls} restantes · cooldown {usage.odds.cooldownMinutes}m
                </div>
              </div>

              <div className="glass-panel rounded-[1.35rem] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Vercel</div>
                    <div className="mt-1 text-[1.4rem] font-semibold text-[var(--ink-strong)]">Hobby</div>
                  </div>
                  {usage.vercel.live && (
                    <div className="text-right text-[11px] text-[var(--ink-soft)]">
                      {usage.vercel.live.readyProductionDeployments30d} prod listas
                    </div>
                  )}
                </div>
                <div className="mt-2 text-[11px] text-[var(--ink-soft)]">
                  Deploys 30d {usage.vercel.live?.deployments30d ?? '-'} · logs {usage.vercel.hobbyLimits.runtimeLogsHours}h
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
