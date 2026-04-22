'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const LIVE_SETTLEMENT_REFRESH_MS = 30_000;

type LiveSettlementResponse = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  revertedCount: number;
  settledCount: number;
  backfilledCount: number;
  error?: string;
};

function formatRunTime(value?: string | null): string {
  if (!value) {
    return 'Sin ejecucion';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Sin ejecucion';
  }

  return date.toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

export default function LivePage() {
  const [runState, setRunState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [summary, setSummary] = useState<LiveSettlementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const runSettlementSweep = useCallback(async (silent = false) => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;

    if (!silent) {
      setRunState('loading');
    }
    setError(null);

    try {
      const response = await fetch('/api/live/settlement', {
        method: 'POST',
        cache: 'no-store'
      });
      const payload = (await response.json()) as LiveSettlementResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'No se pudo ejecutar el autosettlement live.');
      }

      setSummary(payload);
      setRunState('success');
    } catch (caughtError) {
      setRunState('error');
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo ejecutar el autosettlement live.');
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void runSettlementSweep();
  }, [runSettlementSweep]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void runSettlementSweep(true);
    }, LIVE_SETTLEMENT_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [runSettlementSweep]);

  const totalTouched = useMemo(() => {
    if (!summary) {
      return 0;
    }

    return summary.revertedCount + summary.settledCount + summary.backfilledCount;
  }, [summary]);

  return (
    <main className="px-3 pb-8 pt-4 lg:px-5">
      <div className="mx-auto max-w-[1620px]">
        <section className="glass-panel rounded-[1.9rem] p-4 lg:p-5 shadow-[0_24px_60px_rgba(9,28,57,0.08)]">
          <div className="flex min-h-[168px] flex-col justify-between gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                  Live
                </div>
                <h1 className="mt-2 font-heading text-[2rem] font-semibold leading-none text-[var(--ink-strong)]">
                  Settlement en vivo
                </h1>
                <p className="mt-3 text-sm text-[var(--ink-soft)]">
                  Esta vista es el nuevo disparador operativo del autosettlement. Ejecuta el barrido en backend al abrirse
                  y vuelve a refrescar mientras la pestana esta visible.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void runSettlementSweep();
                  }}
                  className="rounded-full bg-[var(--surface-navy)] px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(9,28,57,0.18)] transition hover:bg-[rgba(9,28,57,0.92)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={runState === 'loading'}
                >
                  {runState === 'loading' ? 'Actualizando...' : 'Actualizar settlement'}
                </button>
                <Link
                  href="/picks"
                  className="rounded-full border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                >
                  Ver picks
                </Link>
                <Link
                  href="/stats"
                  className="rounded-full border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                >
                  Ver stats
                </Link>
              </div>
            </div>

            <div className="rounded-[1.2rem] border border-[var(--line-soft)] bg-white/78 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                <span>Endpoint dedicado</span>
                <span>Refresh cada 30s</span>
                <span>Estado {runState === 'error' ? 'error' : runState === 'success' ? 'activo' : runState === 'loading' ? 'ejecutando' : 'en espera'}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-3 md:grid-cols-4">
          <article className="glass-panel rounded-[1.35rem] p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-muted)]">
              Ultima corrida
            </div>
            <div className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">
              {formatRunTime(summary?.finishedAt)}
            </div>
          </article>
          <article className="glass-panel rounded-[1.35rem] p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-muted)]">
              Revertidos
            </div>
            <div className="mt-2 text-2xl font-semibold text-[var(--ink-strong)]">
              {summary?.revertedCount ?? 0}
            </div>
          </article>
          <article className="glass-panel rounded-[1.35rem] p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-muted)]">
              Liquidados
            </div>
            <div className="mt-2 text-2xl font-semibold text-[var(--ink-strong)]">
              {summary?.settledCount ?? 0}
            </div>
          </article>
          <article className="glass-panel rounded-[1.35rem] p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-muted)]">
              Barrido total
            </div>
            <div className="mt-2 text-2xl font-semibold text-[var(--ink-strong)]">
              {totalTouched}
            </div>
          </article>
        </section>

        <section className="glass-panel mt-4 rounded-[1.6rem] p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--ink-muted)]">
            Estado del flujo
          </div>
          <div className="mt-3 space-y-2 text-sm text-[var(--ink-soft)]">
            <p>
              Stats y Picks ya no disparan settlement. Esta vista llama un endpoint backend dedicado y deja los demas
              paneles leyendo estado asentado.
            </p>
            <p>
              El barrido vuelve a correr cada 30 segundos mientras esta pestana siga visible, sin congelar la logica en
              React.
            </p>
            <p>
              Estado actual:{' '}
              <span className="font-semibold text-[var(--ink-strong)]">
                {runState === 'error' ? 'Error' : runState === 'success' ? 'Activo' : runState === 'loading' ? 'Ejecutando' : 'En espera'}
              </span>
            </p>
            {error ? (
              <p className="text-[var(--accent-red)]">{error}</p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
