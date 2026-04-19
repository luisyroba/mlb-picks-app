'use client';

import { useEffect, useMemo, useState } from 'react';
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

function formatPickLine(selection: string, line?: number | null, market?: string | null) {
  if (typeof line !== 'number' || !Number.isFinite(line)) return selection;
  const normalized = selection.trim().toLowerCase();
  const isTotal = market === 'TOTAL' || normalized.startsWith('over') || normalized.startsWith('under');
  return `${selection} ${isTotal ? Math.abs(line).toFixed(1) : `${line > 0 ? '+' : ''}${line.toFixed(1)}`}`;
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
  const validPoints = points.filter(
    (point) =>
      typeof point.cumulativeProfitUnits === 'number' &&
      Number.isFinite(point.cumulativeProfitUnits)
  );

  if (!validPoints.length) {
    return (
      <div className="rounded-[1.3rem] border border-[var(--line-soft)] bg-white p-4 text-sm text-[var(--ink-soft)]">
        Aun no hay picks settled suficientes para dibujar una curva historica.
      </div>
    );
  }

  const width = 720;
  const height = 130;
  const paddingX = 26;
  const paddingY = 14;
  const values = validPoints.map((point) => point.cumulativeProfitUnits);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const valueRange = Math.max(0.001, maxValue - minValue);
  const lastPoint = validPoints[validPoints.length - 1];
  const tone = getPerformanceTone(lastPoint?.cumulativeWinRate ?? null, lastPoint?.cumulativeProfitUnits ?? null, lastPoint?.cumulativeRoi ?? null);
  const stroke = performanceStroke(tone);
  const area = performanceAreaFill(tone);

  const xAt = (index: number) =>
    paddingX + (index / Math.max(1, validPoints.length - 1)) * (width - paddingX * 2);
  const yAt = (value: number) =>
    height - paddingY - ((value - minValue) / valueRange) * (height - paddingY * 2);
  const zeroY = yAt(0);
  const areaPath = [
    `M ${xAt(0)} ${height - paddingY}`,
    ...validPoints.map((point, index) => `L ${xAt(index)} ${yAt(point.cumulativeProfitUnits)}`),
    `L ${xAt(validPoints.length - 1)} ${height - paddingY}`,
    'Z'
  ].join(' ');

  return (
    <div className="rounded-[1.35rem] border border-[var(--line-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,244,237,0.96))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="h-auto min-h-[10rem] w-full">
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
          points={validPoints.map((point, index) => `${xAt(index)},${yAt(point.cumulativeProfitUnits)}`).join(' ')}
          stroke={stroke}
          strokeWidth="4.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {validPoints.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle cx={xAt(index)} cy={yAt(point.cumulativeProfitUnits)} r="4.2" fill="#ffffff" stroke={stroke} strokeOpacity="0.32" />
            <text x={xAt(index)} y={height - 4} textAnchor="middle" fill="color-mix(in oklch, var(--surface-navy) 44%, white)" fontSize="11" fontWeight="600">
              {formatShortDate(point.date)}
            </text>
          </g>
        ))}
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

  async function loadStats() {
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
  }

  useEffect(() => {
    void loadStats();
  }, []);

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
            <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <div className="glass-panel rounded-[1.7rem] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-heading text-[1.35rem] font-semibold text-[var(--ink-strong)]">Profit acumulado</h2>
                  <div className="rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                    {trend.length} cortes
                  </div>
                </div>
                <div className="mt-3"><ProfitTrendChart points={trend} /></div>
                <div className="mt-2 grid gap-2 md:grid-cols-4">
                  {trend.slice(-4).map((point) => (
                    <div key={point.date} className="rounded-[1rem] bg-[var(--surface-soft)] px-2.5 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{formatShortDate(point.date)}</div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink-strong)]">{formatUnits(point.cumulativeProfitUnits)}</div>
                      <div className="mt-1 text-[11px] text-[var(--ink-soft)]">ROI {formatMetric(point.cumulativeRoi)} / WR {formatRate(point.cumulativeWinRate)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
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
              </div>
            </section>

            <section className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="space-y-3">
                <section className="relative overflow-hidden rounded-[1.6rem] border border-[#ead18f]/45 bg-[linear-gradient(145deg,rgba(255,248,224,0.92),rgba(255,255,255,0.98))] p-3 shadow-[0_18px_44px_rgba(160,126,50,0.14)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,221,136,0.25),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(189,146,53,0.14),transparent_34%)]" />
                    <div className="relative flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[#9b771c]">Pick solido diario</div>
                        <h3 className="mt-1 font-heading text-[1.4rem] font-semibold text-[var(--ink-strong)]">Sistema premium</h3>
                      </div>
                      <div className="rounded-full border border-[#ead18f] bg-[rgba(255,249,229,0.92)] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[#8a6115]">
                        WR {formatRate(solidPick?.summary.winRate)}
                      </div>
                    </div>

                    <div className="relative mt-3 grid gap-2 md:grid-cols-4">
                      <div className="rounded-[1.2rem] bg-[linear-gradient(135deg,#7f5a11,#d4a942)] p-3 text-white shadow-[0_18px_30px_rgba(127,90,17,0.22)]">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-white/60">Record</div>
                        <div className="mt-1 text-xl font-semibold">{solidPick?.summary.won ?? 0}/{solidPick?.summary.total ?? 0}</div>
                      </div>
                      <div className="rounded-[1.2rem] border border-[#efe1b8] bg-[rgba(255,255,255,0.74)] p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Settled</div>
                        <div className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">{solidPick?.summary.settled ?? 0}</div>
                      </div>
                      <div className="rounded-[1.2rem] border border-[#efe1b8] bg-[rgba(255,255,255,0.74)] p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">WR</div>
                        <div className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">{formatRate(solidPick?.summary.winRate)}</div>
                      </div>
                      <div className="rounded-[1.2rem] border border-[#efe1b8] bg-[rgba(255,255,255,0.74)] p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Racha</div>
                        <div className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">{formatStreak(solidPick?.summary.currentStreak)}</div>
                      </div>
                    </div>

                    <div className="relative mt-4 grid gap-4">
                      <div className="rounded-[1.2rem] border border-[#ead18f] bg-[linear-gradient(135deg,rgba(255,248,224,0.92),rgba(255,255,255,0.9))] p-4">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Pick solido de hoy</div>
                        <div className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">
                          {activeSolidPick
                            ? `${activeSolidPick.market} / ${formatPickLine(activeSolidPick.selection, activeSolidPick.line, activeSolidPick.market)}`
                            : 'Sin pick solido activo hoy'}
                        </div>
                        <div className="hidden">
                          {solidPick.today ? `${formatDateLabel(solidPick.today.updatedAt)} · ${solidPick.today.confidence}` : 'Necesita picks confirmados para crear historial.'}
                        </div>
                        <div className="mt-1 text-sm text-[var(--ink-soft)]">
                          {activeSolidPick
                            ? `${activeSolidPick.gameLabel} · ${activeSolidPick.confidence}`
                            : 'Se mostrara aqui cuando el slate de hoy deje un pick premium activo.'}
                        </div>
                        {activeSolidPick && (
                          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded-[0.95rem] bg-white/70 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Cuota</div>
                              <div className="mt-1 font-semibold text-[var(--ink-strong)]">{formatOdds(activeSolidPick.odds)}</div>
                            </div>
                            <div className="rounded-[0.95rem] bg-white/70 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Score</div>
                              <div className="mt-1 font-semibold text-[var(--ink-strong)]">{formatMetric(activeSolidPick.score)}</div>
                            </div>
                            <div className="rounded-[0.95rem] bg-white/70 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Edge / EV</div>
                              <div className="mt-1 font-semibold text-[var(--ink-strong)]">{formatMetric(activeSolidPick.edge)} / {formatMetric(activeSolidPick.ev)}</div>
                            </div>
                            <div className="rounded-[0.95rem] bg-white/70 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Estado</div>
                              <div className="mt-1 font-semibold text-[var(--ink-strong)]">
                                {activeSolidPick.settledStatus?.toUpperCase() ?? 'PENDING'}
                              </div>
                              {activeSolidPick.settledStatus && typeof activeSolidPick.profitUnits === 'number' && (
                                <div className="mt-0.5 text-xs text-[var(--ink-soft)]">{formatUnits(activeSolidPick.profitUnits)}</div>
                              )}
                            </div>
                          </div>
                        )}
                        {!activeSolidPick && (
                          <div className="mt-3 rounded-[0.95rem] bg-white/70 px-3 py-3 text-sm text-[var(--ink-soft)]">
                            Hoy todavia no hay un pick solido activo pendiente. Cuando el sistema fije uno, aparecera aqui y se mantendra estable salvo que el mercado lo invalide.
                          </div>
                        )}
                        {activeSolidPick?.note && (
                          <div className="mt-3 rounded-[0.95rem] border border-[rgba(210,166,73,0.22)] bg-[rgba(210,166,73,0.08)] px-3 py-2 text-xs text-[#6d5220]">
                            {activeSolidPick.note}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Historial sólido</div>
                          <div className="text-[11px] text-[var(--ink-soft)]">{solidPick.history.length} settles</div>
                        </div>
                        {visibleSolidHistory.map((item) => (
                          <div key={`${item.date}-${item.gameId}`} className="rounded-[1.05rem] bg-[var(--surface-soft)] p-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-[var(--ink-strong)]">{formatDateLabel(item.updatedAt)}</div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{item.status} / {item.confidence}</div>
                            </div>
                            <div className="mt-1 text-sm text-[var(--ink-strong)]">{item.market} / {item.selection}</div>
                            <div className="mt-1 text-xs text-[var(--ink-soft)]">Score {formatMetric(item.score)} · Cuota {formatOdds(item.executionOdds)} · {formatUnits(item.profitUnits)}</div>
                          </div>
                        ))}
                        {hasMoreSolidHistory && (
                          <button
                            type="button"
                            onClick={() => setSolidHistoryVisibleCount((current) => current + SOLID_HISTORY_PAGE_SIZE)}
                            className="w-full rounded-[0.95rem] border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                          >
                            Ver más historial
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
              </div>

              <div className="space-y-3">
                <section className="glass-panel rounded-[1.6rem] p-3">
                  <h3 className="font-heading text-[1.3rem] font-semibold text-[var(--ink-strong)]">Por confianza</h3>
                  <div className="mt-3 space-y-3">
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
              </div>

            </section>

          </>
        )}
      </div>
    </main>
  );
}
