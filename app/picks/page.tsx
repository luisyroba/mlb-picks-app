'use client';

import { useEffect, useMemo, useState } from 'react';

type PickItem = {
  id: string;
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  confidence: string;
  executionMarket: string | null;
  executionSelection: string | null;
  executionLine: number | null;
  executionOdds: number | null;
  modelOdds: number | null;
  displayTitle: string;
  edge: number | null;
  ev: number | null;
  status: string;
  result: string | null;
  finalScoreLabel: string | null;
  profitUnits: number | null;
  reason: string;
  gameDate: string | null;
  createdAt: string;
  updatedAt: string;
};

type PicksResponse = {
  ok: boolean;
  error?: string;
  picks?: PickItem[];
};

type FilterRange = '7d' | '30d' | 'all';

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

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDateLabel(value?: string | null) {
  if (!value) return 'Sin fecha';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function statusClasses(status: string) {
  if (status === 'won') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'lost') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 'void') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}

function finalScoreClasses(status: string) {
  if (status === 'won') return 'border-[rgba(16,185,129,0.22)] bg-[rgba(16,185,129,0.08)] text-emerald-700';
  if (status === 'lost') return 'border-[rgba(244,63,94,0.24)] bg-[rgba(244,63,94,0.08)] text-rose-700';
  if (status === 'void') return 'border-[rgba(245,158,11,0.24)] bg-[rgba(245,158,11,0.08)] text-amber-700';
  return 'border-[rgba(56,189,248,0.2)] bg-[rgba(56,189,248,0.08)] text-sky-700';
}

function filterByRange(picks: PickItem[], range: FilterRange) {
  if (range === 'all') return picks;

  const days = range === '7d' ? 7 : 30;
  const minMs = Date.now() - days * 24 * 60 * 60 * 1000;
  return picks.filter((pick) => {
    const ms = new Date(pick.gameDate || pick.createdAt || pick.updatedAt).getTime();
    return Number.isFinite(ms) && ms >= minMs;
  });
}

function groupByDate(picks: PickItem[]) {
  const groups = new Map<string, PickItem[]>();

  for (const pick of picks) {
    const key = pick.gameDate
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Santiago',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(pick.gameDate))
      : 'sin-fecha';
    groups.set(key, [...(groups.get(key) ?? []), pick]);
  }

  return [...groups.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([key, items]) => ({ key, items }));
}

function getTodayDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resolveDefaultDateKey(keys: string[], preferredKey: string) {
  if (keys.includes(preferredKey)) return preferredKey;
  return keys[0] ?? '';
}

function PicksProgressBar() {
  return (
    <div className="mt-4 glass-panel rounded-[1.4rem] p-4">
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-soft)]">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--surface-navy)]/50" />
      </div>
      <div className="mt-2.5 text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">Cargando picks...</div>
    </div>
  );
}

export default function PicksPage() {
  const [picks, setPicks] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<FilterRange>('30d');
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

  const filtered = useMemo(() => filterByRange(picks, range), [picks, range]);
  const pendingCount = filtered.filter((pick) => pick.status === 'pending').length;
  const settledCount = filtered.length - pendingCount;
  const grouped = useMemo(() => groupByDate(filtered), [filtered]);
  const dateOptions = useMemo(() => grouped.map((group) => group.key), [grouped]);
  const visibleGroup = useMemo(
    () => grouped.find((group) => group.key === selectedDate) ?? grouped[0] ?? null,
    [grouped, selectedDate]
  );

  useEffect(() => {
    setSelectedDate((current) => {
      const next = resolveDefaultDateKey(dateOptions, getTodayDateKey());
      if (!next) return '';
      if (current && dateOptions.includes(current)) return current;
      return next;
    });
  }, [dateOptions]);

  return (
    <main className="px-3 pb-8 pt-4 lg:px-5">
      <div className="mx-auto max-w-[1620px]">
        <section className="glass-panel rounded-[1.9rem] p-4 lg:p-5">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: '7d', label: '7 dÃ­as' },
                { value: '30d', label: '30 dÃ­as' },
                { value: 'all', label: 'Todo' }
              ].map((item) => (
                <button
                  key={`compact-${item.value}`}
                  onClick={() => setRange(item.value as FilterRange)}
                  className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${range === item.value ? 'bg-[var(--surface-navy)] text-white' : 'border border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'}`}
                >
                  {item.label}
                </button>
              ))}
              <button
                onClick={() => void loadPicks()}
                className="rounded-full border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
              >
                Recargar
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="navy-panel rounded-[1.25rem] p-3.5 text-white">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Total</div>
              <div className="mt-1 text-[1.9rem] font-semibold">{filtered.length}</div>
            </div>
            <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3.5">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">Pendientes</div>
              <div className="mt-1 text-[1.9rem] font-semibold text-[var(--ink-strong)]">{pendingCount}</div>
            </div>
            <div className="rounded-[1.25rem] border border-[var(--line-soft)] bg-white p-3.5">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">Settled</div>
              <div className="mt-1 text-[1.9rem] font-semibold text-[var(--ink-strong)]">{settledCount}</div>
            </div>
          </div>
        </section>
        {false && (
        <section className="glass-panel rounded-[2rem] p-5 lg:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--ink-muted)]">Picks ledger</p>
              <h1 className="mt-2 font-heading text-[2rem] font-semibold text-[var(--ink-strong)]">Historial ejecutado</h1>
              <p className="mt-2 max-w-3xl text-sm text-[var(--ink-soft)]">
                Solo se cuentan picks activos ya ejecutados. Los `NO BET` y análisis sin apuesta quedan fuera del ledger y de los pendientes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: '7d', label: '7 días' },
                { value: '30d', label: '30 días' },
                { value: 'all', label: 'Todo' }
              ].map((item) => (
                <button
                  key={item.value}
                  onClick={() => setRange(item.value as FilterRange)}
                  className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${range === item.value ? 'bg-[var(--surface-navy)] text-white' : 'border border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'}`}
                >
                  {item.label}
                </button>
              ))}
              <button
                onClick={() => void loadPicks()}
                className="rounded-full border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
              >
                Recargar
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="navy-panel rounded-[1.4rem] p-4 text-white">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">Total</div>
              <div className="mt-1 text-3xl font-semibold">{filtered.length}</div>
            </div>
            <div className="rounded-[1.4rem] border border-[var(--line-soft)] bg-white p-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">Pendientes</div>
              <div className="mt-1 text-3xl font-semibold text-[var(--ink-strong)]">{pendingCount}</div>
            </div>
            <div className="rounded-[1.4rem] border border-[var(--line-soft)] bg-white p-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">Settled</div>
              <div className="mt-1 text-3xl font-semibold text-[var(--ink-strong)]">{settledCount}</div>
            </div>
          </div>
        </section>
        )}

        {loading && <PicksProgressBar />}
        {error && <div className="glass-panel mt-4 rounded-[1.4rem] p-4 text-rose-700">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="glass-panel mt-4 rounded-[1.4rem] p-5 text-[var(--ink-soft)]">
            No hay picks ejecutados en el rango seleccionado.
          </div>
        )}

        <div className="mt-5 space-y-4">
          {!!dateOptions.length && (
            <div className="flex flex-wrap gap-2">
              {dateOptions.map((dateKey) => (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedDate(dateKey)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    selectedDate === dateKey
                      ? 'bg-[var(--surface-navy)] text-white'
                      : 'border border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                  }`}
                >
                  {formatDateLabel(dateKey)}
                </button>
              ))}
            </div>
          )}

          {visibleGroup ? (
            <section className="space-y-3" style={{ contentVisibility: 'auto' }}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-heading text-[1.4rem] font-semibold text-[var(--ink-strong)]">
                  {formatDateLabel(visibleGroup.items[0]?.gameDate ?? visibleGroup.key)}
                </h2>
                <div className="rounded-full border border-[var(--line-soft)] bg-white px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                  {visibleGroup.items.length} picks
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
                {visibleGroup.items.map((pick) => (
                  <article key={pick.id} className="glass-panel rounded-[1rem] p-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                            {pick.executionMarket || pick.market}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusClasses(pick.status)}`}>
                            {pick.status}
                          </span>
                        </div>
                        <h3 className="mt-1.5 truncate font-heading text-[1rem] font-semibold text-[var(--ink-strong)]">{pick.displayTitle}</h3>
                        <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">{pick.gameLabel}</div>
                      </div>
                      <div className="text-right text-[10px] text-[var(--ink-muted)]">{pick.confidence}</div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
                      <div className="rounded-[0.8rem] bg-[var(--surface-soft)] px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Ejecutada</div>
                        <div className="mt-0.5 font-semibold text-[var(--ink-strong)]">{formatOdds(pick.executionOdds)}</div>
                      </div>
                      <div className="rounded-[0.8rem] bg-[var(--surface-soft)] px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Modelo</div>
                        <div className="mt-0.5 font-semibold text-[var(--ink-strong)]">{formatOdds(pick.modelOdds)}</div>
                      </div>
                      <div className="rounded-[0.8rem] bg-[var(--surface-soft)] px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Edge / EV</div>
                        <div className="mt-0.5 font-semibold text-[var(--ink-strong)]">{formatMetric(pick.edge)} / {formatMetric(pick.ev)}</div>
                      </div>
                      <div className="rounded-[0.8rem] bg-[var(--surface-soft)] px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Units</div>
                        <div className="mt-0.5 font-semibold text-[var(--ink-strong)]">{formatUnits(pick.profitUnits)}</div>
                      </div>
                    </div>

                    {pick.finalScoreLabel && (
                      <div className={`mt-2 rounded-[0.9rem] border px-2.5 py-1.5 text-[11px] font-semibold ${finalScoreClasses(pick.status)}`}>
                        {pick.finalScoreLabel}
                      </div>
                    )}

                    <div className="mt-2 line-clamp-2 text-[11px] leading-5 text-[var(--ink-soft)]">{pick.reason}</div>
                    <div className="mt-1.5 text-[10px] text-[var(--ink-muted)]">{formatDateTime(pick.createdAt)}</div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <div className="glass-panel rounded-[1.2rem] p-4 text-sm text-[var(--ink-soft)]">
              No hay picks ejecutados para la fecha seleccionada.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
