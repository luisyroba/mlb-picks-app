'use client';

import Image from 'next/image';
import Link from 'next/link';
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isGameLive, type GameFeedItem, type GamesResponse, type LiveGameParticipant } from '@/lib/game-feed';
import { formatDateKeyForTimezone } from '@/lib/runtime-config';

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

function formatOdds(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : null;
}

function formatCountBadge(count: number) {
  if (count <= 0) return 'Sin juegos en vivo';
  if (count === 1) return '1 juego en vivo';
  return `${count} juegos en vivo`;
}

function isTotalMarketLabel(selection: string, market?: string | null) {
  const normalized = selection.trim().toLowerCase();
  return (
    market === 'TOTAL' ||
    normalized.startsWith('over') ||
    normalized.startsWith('under') ||
    normalized.startsWith('f5 over') ||
    normalized.startsWith('f5 under')
  );
}

function formatDisplayLine(line: number, selection: string, market?: string | null) {
  if (isTotalMarketLabel(selection, market)) {
    return Math.abs(line).toFixed(1);
  }

  return `${line > 0 ? '+' : ''}${line.toFixed(1)}`;
}

function renderPickLabel(selection: string, line?: number | null, market?: string | null) {
  return typeof line === 'number' && Number.isFinite(line)
    ? `${selection} ${formatDisplayLine(line, selection, market)}`
    : selection;
}

function formatPickSummary(game: GameFeedItem) {
  if (!game.analysis.selection) {
    return 'Sin pick vigente';
  }

  const renderedSelection = renderPickLabel(
    game.analysis.selection,
    game.analysis.line,
    game.analysis.market
  );
  const renderedOdds = formatOdds(game.analysis.odds);

  return `${renderedSelection}${renderedOdds ? ` @ ${renderedOdds}` : ''}`;
}

function marketBadgeClasses(market?: string | null) {
  if (market === 'ML') return 'border-sky-300/80 bg-[linear-gradient(135deg,rgba(232,247,255,0.98),rgba(196,231,255,0.9))] text-sky-900 shadow-[0_8px_18px_rgba(56,189,248,0.12)]';
  if (market === 'RL') return 'border-fuchsia-300/80 bg-[linear-gradient(135deg,rgba(252,239,255,0.98),rgba(239,213,255,0.9))] text-fuchsia-900 shadow-[0_8px_18px_rgba(217,70,239,0.12)]';
  if (market === 'TOTAL') return 'border-teal-300/80 bg-[linear-gradient(135deg,rgba(235,255,251,0.98),rgba(196,250,235,0.9))] text-teal-900 shadow-[0_8px_18px_rgba(20,184,166,0.12)]';
  if (market === 'F5') return 'border-amber-300/80 bg-[linear-gradient(135deg,rgba(255,249,232,0.98),rgba(254,231,173,0.92))] text-amber-900 shadow-[0_8px_18px_rgba(245,158,11,0.12)]';
  return 'border-[var(--line-soft)] bg-[var(--surface-soft)] text-[var(--ink-soft)]';
}

function tierBadgeClasses(confidence?: string | null) {
  if (confidence === 'A') return 'border-[#dfc36f] bg-[linear-gradient(135deg,rgba(255,248,224,0.98),rgba(240,209,120,0.9))] text-[#6f5110] shadow-[0_10px_20px_rgba(174,131,32,0.16)]';
  if (confidence === 'B') return 'border-indigo-300/80 bg-[linear-gradient(135deg,rgba(238,242,255,0.98),rgba(199,210,254,0.9))] text-indigo-900 shadow-[0_8px_18px_rgba(99,102,241,0.12)]';
  if (confidence === 'C') return 'border-slate-300/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.98),rgba(226,232,240,0.9))] text-slate-700 shadow-[0_8px_18px_rgba(148,163,184,0.1)]';
  return 'border-[var(--line-soft)] bg-[var(--surface-soft)] text-[var(--ink-soft)]';
}

function TeamLogo({
  src,
  alt
}: {
  src: string | null;
  alt: string;
}) {
  return src ? (
    <Image
      src={src}
      alt={alt}
      width={48}
      height={48}
      className="h-12 w-12 rounded-full border border-[rgba(9,28,57,0.08)] bg-white object-contain p-1.5 shadow-[0_12px_28px_rgba(9,28,57,0.08)]"
      unoptimized
    />
  ) : (
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line-soft)] bg-white text-sm font-semibold text-[var(--ink-strong)]">
      {alt.slice(0, 3).toUpperCase()}
    </div>
  );
}

function getInningHeaders(game: GameFeedItem) {
  if (game.innings <= 0) return [];
  return Array.from({ length: Math.min(Math.max(game.innings, 5), 10) }, (_, index) => index + 1);
}

function LinescoreTable({ game }: { game: GameFeedItem }) {
  const headers = getInningHeaders(game);

  if (!headers.length) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-[1rem] bg-white/80 px-3 py-2 text-sm text-[var(--ink-soft)]">
          {game.awayTeam.record ?? game.awayTeam.name}
        </div>
        <div className="rounded-[1rem] bg-white/80 px-3 py-2 text-sm text-[var(--ink-soft)]">
          {game.homeTeam.record ?? game.homeTeam.name}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-center text-[11px] text-[var(--ink-soft)]">
        <thead className="uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          <tr>
            <th className="pb-2 pr-2 text-left">Club</th>
            {headers.map((inning) => (
              <th key={`${game.gameId}-${inning}`} className="px-1 pb-2">{inning}</th>
            ))}
            <th className="px-1 pb-2">R</th>
            <th className="px-1 pb-2">H</th>
            <th className="px-1 pb-2">E</th>
          </tr>
        </thead>
        <tbody>
          {[game.awayTeam, game.homeTeam].map((team) => (
            <tr key={`${game.gameId}-${team.abbr}`} className="border-t border-[rgba(9,28,57,0.06)]">
              <td className="py-2 pr-2 text-left font-semibold text-[var(--ink-strong)]">{team.abbr}</td>
              {headers.map((inning) => (
                <td key={`${team.abbr}-${inning}`} className="px-1 py-2">{team.linescores[inning - 1] ?? '-'}</td>
              ))}
              <td className="px-1 py-2 font-semibold text-[var(--ink-strong)]">{team.score ?? '-'}</td>
              <td className="px-1 py-2">{team.hits ?? '-'}</td>
              <td className="px-1 py-2">{team.errors ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountDots({
  label,
  value,
  max,
  activeClass
}: {
  label: string;
  value: number;
  max: number;
  activeClass: string;
}) {
  return (
    <div className="rounded-[0.95rem] border border-[rgba(9,28,57,0.08)] bg-white/84 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--ink-strong)]">{label}</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: max }, (_, index) => {
              const active = index < value;
              return (
                <span
                  key={`${label}-${index}`}
                  className={`h-2.5 w-2.5 rounded-full border ${active ? activeClass : 'border-[rgba(9,28,57,0.08)] bg-transparent'}`}
                />
              );
            })}
          </div>
          <span className="text-sm font-semibold text-[var(--ink-strong)]">{value}</span>
        </div>
      </div>
    </div>
  );
}

function BaseDiamond({
  onFirst,
  onSecond,
  onThird
}: {
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
}) {
  const baseClass = (active: boolean) =>
    `h-4 w-4 rotate-45 rounded-[0.3rem] border transition ${
      active
        ? 'border-amber-300 bg-[linear-gradient(145deg,rgba(254,215,94,0.96),rgba(245,158,11,0.86))] shadow-[0_10px_18px_rgba(245,158,11,0.2)]'
        : 'border-[rgba(9,28,57,0.12)] bg-white/75'
    }`;

  return (
    <div className="flex min-w-[104px] items-center justify-center rounded-[1rem] border border-[rgba(9,28,57,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(255,255,255,0.72))] px-3 py-2">
      <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
        <span />
        <span className={baseClass(onSecond)} />
        <span />
        <span className={baseClass(onThird)} />
        <span className="h-4 w-4 rounded-full bg-[rgba(8,26,53,0.06)]" />
        <span className={baseClass(onFirst)} />
        <span />
        <span className="h-2.5 w-2.5 self-center justify-self-center rounded-full bg-[var(--surface-navy)]/16" />
        <span />
      </div>
    </div>
  );
}

const ParticipantStrip = memo(function ParticipantStrip({
  title,
  participant,
  emptyLabel
}: {
  title: string;
  participant: LiveGameParticipant | null;
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">{title}</div>
      {participant ? (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {participant.headshot ? (
            <Image
              src={participant.headshot}
              alt={participant.name}
              width={56}
              height={56}
              className="h-14 w-14 rounded-full border border-[rgba(9,28,57,0.08)] bg-white object-cover shadow-[0_10px_22px_rgba(9,28,57,0.08)]"
              unoptimized
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--line-soft)] bg-[var(--surface-soft)] text-sm font-semibold text-[var(--ink-strong)]">
              {participant.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-[var(--ink-strong)]">{participant.name}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              {[participant.teamAbbr, participant.position].filter(Boolean).join(' / ') || 'Sin detalle'}
            </div>
            {participant.note && (
              <div className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">{participant.note}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2.5 text-sm text-[var(--ink-soft)]">{emptyLabel}</div>
      )}
    </div>
  );
});

const LiveGameCard = memo(function LiveGameCard({ game }: { game: GameFeedItem }) {
  const liveSituation = game.liveSituation;

  return (
    <article className="glass-panel overflow-hidden rounded-[1.65rem] p-4 shadow-[0_24px_60px_rgba(9,28,57,0.1)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">
            En vivo
          </span>
          <span className="rounded-full border border-[rgba(9,28,57,0.08)] bg-white px-3 py-1 text-[10px] font-semibold tracking-[0.16em] text-[var(--ink-soft)]">
            {game.statusDetail}
          </span>
        </div>
        <div className="max-w-[19rem] text-right">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {game.analysis.market && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${marketBadgeClasses(game.analysis.market)}`}>
                {game.analysis.market}
              </span>
            )}
            {game.analysis.confidence && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${tierBadgeClasses(game.analysis.confidence)}`}>
                Tier {game.analysis.confidence}
              </span>
            )}
            <span className="max-w-[13rem] truncate text-[12px] font-semibold leading-5 text-[var(--ink-strong)]">
              {formatPickSummary(game)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.48fr)_minmax(190px,0.52fr)]">
        <div>
          <div className="rounded-[1.35rem] border border-[rgba(9,28,57,0.08)] bg-white/86 px-4 py-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <TeamLogo src={game.awayTeam.logo} alt={game.awayTeam.abbr} />
                <div className="min-w-0">
                  <div className="truncate text-[16px] font-semibold text-[var(--ink-strong)]">{game.awayTeam.name}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{game.awayTeam.abbr}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-1">
                <span className="font-heading text-[2.2rem] font-semibold text-[var(--ink-strong)]">
                  {game.awayTeam.score ?? '-'}
                </span>
                <span className="text-[1.4rem] font-semibold text-[var(--ink-muted)]">-</span>
                <span className="font-heading text-[2.2rem] font-semibold text-[var(--ink-strong)]">
                  {game.homeTeam.score ?? '-'}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-3">
                <div className="min-w-0 text-right">
                  <div className="truncate text-[16px] font-semibold text-[var(--ink-strong)]">{game.homeTeam.name}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{game.homeTeam.abbr}</div>
                </div>
                <TeamLogo src={game.homeTeam.logo} alt={game.homeTeam.abbr} />
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-[1.25rem] border border-[rgba(9,28,57,0.08)] bg-[rgba(235,231,220,0.72)] px-3 py-2.5">
            <LinescoreTable game={game} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-2 sm:grid-cols-3">
              <CountDots label="B" value={liveSituation?.balls ?? 0} max={4} activeClass="border-emerald-300 bg-emerald-400" />
              <CountDots label="S" value={liveSituation?.strikes ?? 0} max={3} activeClass="border-amber-300 bg-amber-400" />
              <CountDots label="O" value={liveSituation?.outs ?? 0} max={3} activeClass="border-rose-300 bg-rose-400" />
            </div>
            <BaseDiamond
              onFirst={liveSituation?.onFirst ?? false}
              onSecond={liveSituation?.onSecond ?? false}
              onThird={liveSituation?.onThird ?? false}
            />
          </div>

          {liveSituation?.lastPlay && (
            <div className="mt-3 rounded-[1.05rem] border border-[rgba(9,28,57,0.08)] bg-white/84 px-3.5 py-3 text-sm text-[var(--ink-soft)]">
              {liveSituation.lastPlay}
            </div>
          )}
        </div>

        <aside className="rounded-[1.15rem] border border-[rgba(9,28,57,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,244,236,0.92))] p-3">
          <div className="space-y-3">
            <ParticipantStrip
              title="Pitcher"
              participant={liveSituation?.pitcher ?? null}
              emptyLabel="ESPN aun no reporta pitcher activo."
            />
            <div className="h-px bg-[rgba(9,28,57,0.08)]" />
            <ParticipantStrip
              title="Bateador"
              participant={liveSituation?.batter ?? null}
              emptyLabel="ESPN aun no reporta bateador al plato."
            />
          </div>
        </aside>
      </div>
    </article>
  );
});

export default function LivePage() {
  const [runState, setRunState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [summary, setSummary] = useState<LiveSettlementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<GameFeedItem[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState<string | null>(null);

  const settlementInFlightRef = useRef(false);
  const gamesAbortRef = useRef<AbortController | null>(null);

  const runSettlementSweep = useCallback(async (silent = false) => {
    if (settlementInFlightRef.current) {
      return;
    }

    settlementInFlightRef.current = true;

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
      settlementInFlightRef.current = false;
    }
  }, []);

  const loadLiveGames = useCallback(async (silent = false) => {
    gamesAbortRef.current?.abort();
    const controller = new AbortController();
    gamesAbortRef.current = controller;

    if (!silent) {
      setGamesLoading(true);
    }
    setGamesError(null);

    try {
      const response = await fetch(
        `/api/games?date=${formatDateKeyForTimezone(0)}&includeLiveDetails=1`,
        {
          cache: 'no-store',
          signal: controller.signal
        }
      );
      const payload = (await response.json()) as GamesResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'No se pudo cargar el tablero live.');
      }

      startTransition(() => {
        setGames(payload.games ?? []);
      });
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.name === 'AbortError') {
        return;
      }

      setGamesError(caughtError instanceof Error ? caughtError.message : 'No se pudo cargar el tablero live.');
    } finally {
      if (gamesAbortRef.current === controller) {
        gamesAbortRef.current = null;
        setGamesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void Promise.allSettled([runSettlementSweep(), loadLiveGames()]);

    return () => {
      gamesAbortRef.current?.abort();
    };
  }, [loadLiveGames, runSettlementSweep]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void Promise.allSettled([runSettlementSweep(true), loadLiveGames(true)]);
    }, LIVE_SETTLEMENT_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [loadLiveGames, runSettlementSweep]);

  const liveGames = useMemo(
    () => games.filter(isGameLive),
    [games]
  );
  const liveCount = liveGames.length;
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
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-700">
                    Live
                  </span>
                  <span className="rounded-full border border-[rgba(9,28,57,0.08)] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    {formatCountBadge(liveCount)}
                  </span>
                  <span className="rounded-full border border-[rgba(9,28,57,0.08)] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    Settlement cada 30s
                  </span>
                </div>
                <h1 className="mt-3 font-heading text-[2rem] font-semibold leading-none text-[var(--ink-strong)]">
                  Juegos en vivo y settlement operativo
                </h1>
                <p className="mt-3 text-sm text-[var(--ink-soft)]">
                  Console conserva solo el slate pregame. Cuando un juego entra en vivo aparece aqui con su pick vigente,
                  conteo, bases, pitcher y bateador, mientras esta misma vista sigue corriendo el autosettlement.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void Promise.allSettled([runSettlementSweep(), loadLiveGames()]);
                  }}
                  className="rounded-full bg-[var(--surface-navy)] px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(9,28,57,0.18)] transition hover:bg-[rgba(9,28,57,0.92)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={runState === 'loading' || gamesLoading}
                >
                  {runState === 'loading' || gamesLoading ? 'Actualizando...' : 'Actualizar live'}
                </button>
                <Link
                  href="/"
                  className="rounded-full border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                >
                  Console
                </Link>
                <Link
                  href="/picks"
                  className="rounded-full border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
                >
                  Picks
                </Link>
              </div>
            </div>

            <div className={`rounded-[1.25rem] border px-4 py-3 ${
              liveCount > 0
                ? 'border-rose-200 bg-[linear-gradient(135deg,rgba(255,242,244,0.98),rgba(255,255,255,0.9))]'
                : 'border-[var(--line-soft)] bg-white/78'
            }`}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.18em]">
                <span className={liveCount > 0 ? 'text-rose-700' : 'text-[var(--ink-muted)]'}>
                  {liveCount > 0 ? `Hay ${liveCount} juego${liveCount === 1 ? '' : 's'} en vivo en este momento` : 'Esperando el primer pitch'}
                </span>
                <span className="text-[var(--ink-muted)]">
                  Estado {runState === 'error' ? 'error' : runState === 'success' ? 'activo' : runState === 'loading' ? 'ejecutando' : 'en espera'}
                </span>
                <span className="text-[var(--ink-muted)]">Board auto refresh 30s</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="navy-panel flex min-h-[92px] flex-col justify-between rounded-[1.2rem] px-4 py-3 text-white">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/62">Juegos live</div>
            <div className="text-[1.75rem] font-semibold">{liveCount}</div>
          </article>
          <article className="glass-panel rounded-[1.2rem] p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Ultima corrida</div>
            <div className="mt-2 text-base font-semibold text-[var(--ink-strong)]">
              {formatRunTime(summary?.finishedAt)}
            </div>
          </article>
          <article className="glass-panel rounded-[1.2rem] p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Liquidados</div>
            <div className="mt-2 text-[1.75rem] font-semibold text-[var(--ink-strong)]">
              {summary?.settledCount ?? 0}
            </div>
          </article>
          <article className="glass-panel rounded-[1.2rem] p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">Barrido total</div>
            <div className="mt-2 text-[1.75rem] font-semibold text-[var(--ink-strong)]">
              {totalTouched}
            </div>
          </article>
        </section>

        {(error || gamesError) && (
          <div className="glass-panel mt-4 rounded-[1.25rem] p-4 text-sm text-rose-700">
            {gamesError ?? error}
          </div>
        )}

        <section className="mt-4">
          {gamesLoading && !liveGames.length ? (
            <div className="glass-panel rounded-[1.4rem] p-5 text-sm text-[var(--ink-soft)]">
              Cargando juegos en vivo...
            </div>
          ) : liveGames.length === 0 ? (
            <div className="glass-panel rounded-[1.45rem] p-6">
              <div className="max-w-2xl">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                  Live standby
                </div>
                <h2 className="mt-2 font-heading text-[1.55rem] font-semibold text-[var(--ink-strong)]">
                  No hay juegos en vivo ahora mismo
                </h2>
                <p className="mt-3 text-sm text-[var(--ink-soft)]">
                  En cuanto un partido entre en juego, saldra del slate de Console y aparecera aqui automaticamente.
                  Cuando termine, desaparecera de esta vista en el siguiente refresh del tablero.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2" style={{ contentVisibility: 'auto' }}>
              {liveGames.map((game) => (
                <LiveGameCard key={game.gameId} game={game} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
