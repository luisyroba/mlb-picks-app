'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { LIVE_STATS_CUTOFF_DATE_KEY } from '@/lib/runtime-config';
import { getSlateDayKey } from '@/lib/slate-day';

type PickItem = {
  id: string;
  gameLabel: string;
  market: string;
  confidence: string;
  executionMarket: string | null;
  executionOdds: number | null;
  modelOdds: number | null;
  displayTitle: string;
  edge: number | null;
  ev: number | null;
  status: string;
  finalScoreLabel: string | null;
  profitUnits: number | null;
  reason: string;
  gameDay: string | null;
  gameDate: string | null;
  createdAt: string;
};

type PicksResponse = {
  ok: boolean;
  error?: string;
  picks?: PickItem[];
};

type PicksMode = 'live' | 'testing';

type GroupedDay = {
  key: string;
  items: PickItem[];
  profitUnits: number;
};

function getPickDateKey(pick: PickItem): string | null {
  return getSlateDayKey(pick.gameDay, pick.gameDate, pick.createdAt);
}

function getModeForPick(pick: PickItem): PicksMode | null {
  const dateKey = getPickDateKey(pick);
  if (!dateKey) {
    return null;
  }

  return dateKey >= LIVE_STATS_CUTOFF_DATE_KEY ? 'live' : 'testing';
}

function formatMetric(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatOdds(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-';
}

function formatUnits(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${value.toFixed(2)}u`
    : '-';
}

function formatCompactDateLabel(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric'
  });
}

function formatDateBadgeLabel(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('es-CL', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
}

function statusClasses(status: string) {
  if (status === 'won') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'lost') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 'void') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}

function resultStripClasses(status: string) {
  if (status === 'won') return 'border-emerald-200 bg-emerald-50/90 text-emerald-800';
  if (status === 'lost') return 'border-rose-200 bg-rose-50/90 text-rose-800';
  if (status === 'void') return 'border-amber-200 bg-amber-50/90 text-amber-800';
  return 'border-slate-200 bg-slate-50/90 text-slate-700';
}

function marketBadgeClasses(market?: string | null) {
  if (market === 'ML') return 'border-sky-300/80 bg-[linear-gradient(135deg,rgba(232,247,255,0.98),rgba(196,231,255,0.9))] text-sky-900 shadow-[0_8px_18px_rgba(56,189,248,0.12)]';
  if (market === 'RL') return 'border-fuchsia-300/80 bg-[linear-gradient(135deg,rgba(252,239,255,0.98),rgba(239,213,255,0.9))] text-fuchsia-900 shadow-[0_8px_18px_rgba(217,70,239,0.12)]';
  if (market === 'TOTAL') return 'border-teal-300/80 bg-[linear-gradient(135deg,rgba(235,255,251,0.98),rgba(196,250,235,0.9))] text-teal-900 shadow-[0_8px_18px_rgba(20,184,166,0.12)]';
  if (market === 'F5') return 'border-amber-300/80 bg-[linear-gradient(135deg,rgba(255,249,232,0.98),rgba(254,231,173,0.92))] text-amber-900 shadow-[0_8px_18px_rgba(245,158,11,0.12)]';
  return 'border-[var(--line-soft)] bg-[var(--surface-soft)] text-[var(--ink-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]';
}

function tierBadgeClasses(confidence?: string | null) {
  if (confidence === 'A') return 'border-[#dfc36f] bg-[linear-gradient(135deg,rgba(255,248,224,0.98),rgba(240,209,120,0.9))] text-[#6f5110] shadow-[0_10px_20px_rgba(174,131,32,0.16)]';
  if (confidence === 'B') return 'border-indigo-300/80 bg-[linear-gradient(135deg,rgba(238,242,255,0.98),rgba(199,210,254,0.9))] text-indigo-900 shadow-[0_8px_18px_rgba(99,102,241,0.12)]';
  if (confidence === 'C') return 'border-slate-300/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.98),rgba(226,232,240,0.9))] text-slate-700 shadow-[0_8px_18px_rgba(148,163,184,0.1)]';
  return 'border-[var(--line-soft)] bg-[var(--surface-soft)] text-[var(--ink-soft)]';
}

function groupByDate(picks: PickItem[]) {
  const groups = new Map<string, GroupedDay>();

  for (const pick of picks) {
    const key = getPickDateKey(pick) ?? 'sin-fecha';
    const current = groups.get(key);
    const profitUnits =
      typeof pick.profitUnits === 'number' && Number.isFinite(pick.profitUnits)
        ? pick.profitUnits
        : 0;

    if (current) {
      current.items.push(pick);
      current.profitUnits += profitUnits;
    } else {
      groups.set(key, {
        key,
        items: [pick],
        profitUnits
      });
    }
  }

  return [...groups.values()].sort((left, right) => right.key.localeCompare(left.key));
}

function resolveDefaultDateKey(keys: string[]) {
  return keys[0] ?? '';
}

function PicksProgressBar() {
  return (
    <div className="mt-4 glass-panel rounded-[1.2rem] p-4">
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-soft)]">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--surface-navy)]/50" />
      </div>
      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Cargando ledger...</div>
    </div>
  );
}

const PickCard = memo(function PickCard({ pick }: { pick: PickItem }) {
  const settled = pick.status !== 'pending';
  const displayOdds = pick.executionOdds ?? pick.modelOdds;
  const displayMarket = pick.executionMarket || pick.market;

  return (
    <article
      className="glass-panel rounded-[0.95rem] px-3 py-2.5"
      style={{ contentVisibility: 'auto' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${marketBadgeClasses(displayMarket)}`}>
              {displayMarket}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${tierBadgeClasses(pick.confidence)}`}>
              {pick.confidence}
            </span>
          </div>
          <div className="mt-1 truncate text-[14px] font-semibold text-[var(--surface-navy)]">
            {pick.gameLabel}
          </div>
          <div className="mt-1 truncate text-[13px] font-medium text-[var(--surface-navy)]">
            {pick.displayTitle}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${statusClasses(pick.status)}`}>
            {pick.status}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-[var(--ink-soft)] sm:grid-cols-4">
        <div>
          <span className="text-[var(--ink-muted)]">Cuota</span>{' '}
          <span className="font-semibold text-[var(--surface-navy)]">{formatOdds(displayOdds)}</span>
        </div>
        <div>
          <span className="text-[var(--ink-muted)]">Edge</span>{' '}
          <span className="font-semibold text-[var(--surface-navy)]">{formatMetric(pick.edge)}</span>
        </div>
        <div>
          <span className="text-[var(--ink-muted)]">EV</span>{' '}
          <span className="font-semibold text-[var(--surface-navy)]">{formatMetric(pick.ev)}</span>
        </div>
        <div>
          <span className="text-[var(--ink-muted)]">Units</span>{' '}
          <span className="font-semibold text-[var(--surface-navy)]">
            {settled ? formatUnits(pick.profitUnits) : '-'}
          </span>
        </div>
      </div>

      {pick.finalScoreLabel && (
        <div className={`mt-2 rounded-[0.7rem] border px-2 py-1 text-[11px] font-medium ${resultStripClasses(pick.status)}`}>
          {pick.finalScoreLabel ? (
            <span>{pick.finalScoreLabel}</span>
          ) : null}
        </div>
      )}
    </article>
  );
});

export default function PicksPage() {
  const [picks, setPicks] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PicksMode>('live');
  const [selectedDate, setSelectedDate] = useState('');

  async function loadPicks() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch('/api/picks', { cache: 'no-store' });
      const json = (await res.json()) as PicksResponse;

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'No se pudieron cargar los picks');
      }

      setPicks(json.picks ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Error cargando picks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPicks();
  }, []);

  const segmented = useMemo(() => {
    const live: PickItem[] = [];
    const testing: PickItem[] = [];

    for (const pick of picks) {
      const resolvedMode = getModeForPick(pick);
      if (resolvedMode === 'live') {
        live.push(pick);
      } else if (resolvedMode === 'testing') {
        testing.push(pick);
      }
    }

    return { live, testing };
  }, [picks]);

  const activePicks = mode === 'live' ? segmented.live : segmented.testing;

  const summary = useMemo(() => {
    let pendingCount = 0;
    let settledCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    let profitUnits = 0;

    for (const pick of activePicks) {
      if (pick.status === 'pending') {
        pendingCount += 1;
      } else {
        settledCount += 1;
      }

      if (pick.status === 'won') {
        wonCount += 1;
      }

      if (pick.status === 'lost') {
        lostCount += 1;
      }

      if (typeof pick.profitUnits === 'number' && Number.isFinite(pick.profitUnits)) {
        profitUnits += pick.profitUnits;
      }
    }

    const gradedCount = wonCount + lostCount;

    return {
      totalCount: activePicks.length,
      pendingCount,
      settledCount,
      profitUnits,
      winRate: gradedCount > 0 ? (wonCount / gradedCount) * 100 : null
    };
  }, [activePicks]);

  const grouped = useMemo(() => groupByDate(activePicks), [activePicks]);
  const dateOptions = useMemo(() => grouped.map((group) => group.key), [grouped]);
  const visibleGroup = useMemo(
    () => grouped.find((group) => group.key === selectedDate) ?? grouped[0] ?? null,
    [grouped, selectedDate]
  );

  useEffect(() => {
    setSelectedDate(resolveDefaultDateKey(dateOptions));
  }, [dateOptions, mode]);

  return (
    <main className="px-3 pb-8 pt-4 lg:px-5">
      <div className="mx-auto max-w-[1620px]">
        <section className="glass-panel rounded-[1.9rem] p-4 lg:p-5">
          <div className="flex min-h-[168px] flex-col justify-between gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { value: 'live', label: 'Live' },
                  { value: 'testing', label: 'Testing' }
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setMode(item.value as PicksMode)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                      mode === item.value
                        ? 'bg-[var(--surface-navy)] text-white'
                        : 'border border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => void loadPicks()}
                className="rounded-full border border-[var(--line-soft)] bg-white px-3.5 py-1.5 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
              >
                Recargar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <div className="navy-panel flex min-h-[78px] flex-col justify-between rounded-[0.95rem] px-3 py-2 text-white">
                <div className="text-[9px] uppercase tracking-[0.18em] text-white/60">Total picks</div>
                <div className="text-[1.28rem] font-semibold">{summary.totalCount}</div>
              </div>
              <div className="flex min-h-[78px] flex-col justify-between rounded-[0.95rem] border border-[var(--line-soft)] bg-white px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Pendientes</div>
                <div className="text-[1.28rem] font-semibold text-[var(--ink-strong)]">{summary.pendingCount}</div>
              </div>
              <div className="flex min-h-[78px] flex-col justify-between rounded-[0.95rem] border border-[var(--line-soft)] bg-white px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Cerrados</div>
                <div className="text-[1.28rem] font-semibold text-[var(--ink-strong)]">{summary.settledCount}</div>
              </div>
              <div className="flex min-h-[78px] flex-col justify-between rounded-[0.95rem] border border-[var(--line-soft)] bg-white px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Profit</div>
                <div className="text-[1.28rem] font-semibold text-[var(--ink-strong)]">{formatUnits(summary.profitUnits)}</div>
              </div>
              <div className="flex min-h-[78px] flex-col justify-between rounded-[0.95rem] border border-[var(--line-soft)] bg-white px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Win rate</div>
                <div className="text-[1.28rem] font-semibold text-[var(--ink-strong)]">
                  {summary.winRate === null ? '-' : `${summary.winRate.toFixed(1)}%`}
                </div>
              </div>
            </div>
          </div>
        </section>

        {loading && <PicksProgressBar />}
        {error && <div className="glass-panel mt-4 rounded-[1.1rem] p-4 text-rose-700">{error}</div>}
        {!loading && !error && activePicks.length === 0 && (
          <div className="glass-panel mt-4 rounded-[1.1rem] p-4 text-sm text-[var(--ink-soft)]">
            No hay picks en {mode === 'live' ? 'Live' : 'Testing'}.
          </div>
        )}

        <div className="mt-4 space-y-3">
          {visibleGroup ? (
            <section className="space-y-2" style={{ contentVisibility: 'auto' }}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[0.95rem] border border-[var(--line-soft)] bg-white/70 px-3 py-2">
                <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
                  {dateOptions.map((dateKey) => (
                    <button
                      key={dateKey}
                      type="button"
                      onClick={() => setSelectedDate(dateKey)}
                      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                        selectedDate === dateKey
                          ? 'bg-[var(--surface-navy)] text-white'
                          : 'border border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                      }`}
                    >
                      {formatDateBadgeLabel(dateKey)}
                    </button>
                  ))}
                </div>
                <div className="shrink-0 text-[10px] font-medium text-[var(--ink-soft)]">
                  {visibleGroup.items.length} picks · {formatUnits(visibleGroup.profitUnits)}
                </div>
              </div>

              <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleGroup.items.map((pick) => (
                  <PickCard key={pick.id} pick={pick} />
                ))}
              </div>
            </section>
          ) : (
            <div className="glass-panel rounded-[1.1rem] p-4 text-sm text-[var(--ink-soft)]">
              No hay picks para la fecha seleccionada.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
