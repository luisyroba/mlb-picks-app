// app/api/analyze/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getOriginHint, jsonResponseWithAudit } from '@/lib/api-egress-audit';
import { getNormalizedEspnMlbGame } from '@/lib/espn';
import { mapEspnToEngineGame } from '@/lib/map-espn-to-engine';
import { enrichEngineGameWithMlbStats } from '@/lib/mlb-stats';
import { projectGameScript } from '@/lib/project-game-script';
import { evaluateMarkets } from '@/lib/evaluate-markets';
import { chooseBestPick } from '@/lib/choose-best-pick';
import { chooseBestExecution } from '@/lib/choose-best-execution';
import { serializeAlternativeMarket } from '@/lib/pick-alternatives';
import {
  GAME_START_GRACE_PERIOD_MS,
  ODDS_REFRESH_COOLDOWN_MS,
  USER_TIMEZONE
} from '@/lib/runtime-config';
import { normalizeEntityName } from '@/lib/text-utils';
import {
  fetchMlbMarketLines,
  normalizeMarketLines,
  mapEventMarketLinesToGameOdds
} from '@/lib/market-lines';
import {
  saveMarketSnapshot,
  getLatestMarketSnapshot,
  getMarketSnapshotWindow,
  getLatestPickForGame,
  getPregameSnapshotsForGame,
  isConfirmedPickRecord,
  savePregameSnapshot,
  getOddsBoardCache,
  saveOddsBoardCache,
  upsertPickRecord,
  type SnapshotStage,
  type PregameSnapshotRow
} from '@/lib/db';
import { autoSettlePick } from '@/lib/auto-settle-picks';

function roundOdds(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function roundScore(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(1));
}

const ODDS_BOARD_KEY = 'mlb_main';
const ODDS_BOARD_WINDOW_HOURS = 18;
const ODDS_CACHE_SAVE_TIMEOUT_MS = 1500;

type NormalizeMarketLinesInput = Parameters<typeof normalizeMarketLines>[0];
type NormalizedMarketLines = ReturnType<typeof normalizeMarketLines>;
type OddsBoardWindow = ReturnType<typeof getOddsBoardWindow>;

type OddsBoardWindowStats = {
  eventsInsideWindow: number;
  eventsOutsideWindow: number;
  cacheValidForWindow: boolean;
};

type OddsBoardDiagnostics = OddsBoardWindowStats & {
  cacheHit: boolean;
  refreshAttempted: boolean;
  refreshFailedReason: string | null;
  calledExternalOddsApi: boolean;
  eventCountFetched: number;
  estimatedObjectsConsumed: number;
  reason: string;
};

type OddsBoardCacheCandidate = {
  source: 'db' | 'runtime';
  payload: NormalizeMarketLinesInput;
  normalizedLines: NormalizedMarketLines;
  updatedAt: string;
  ageMs: number | null;
  windowStats: OddsBoardWindowStats;
};

type OddsBoardRuntimeCacheEntry = {
  payload: NormalizeMarketLinesInput;
  updatedAt: string;
};

const runtimeOddsBoardCache = new Map<string, OddsBoardRuntimeCacheEntry>();
const inflightOddsBoardRefreshes = new Map<
  string,
  Promise<{
    normalizedLines: NormalizedMarketLines;
    oddsCacheUpdatedAt: string | null;
    oddsRefreshUsed: boolean;
    oddsFetchWarning: string | null;
    diagnostics: OddsBoardDiagnostics;
  }>
>();

function getAgeMs(updatedAt?: string | null): number | null {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Date.now() - ms;
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

function getOddsBoardKey(startTime?: string | null): string {
  if (!startTime) return ODDS_BOARD_KEY;

  const startDate = new Date(startTime);
  if (!Number.isFinite(startDate.getTime())) return ODDS_BOARD_KEY;

  return `${ODDS_BOARD_KEY}:${formatUsageDateKey(startDate)}`;
}

function getOddsBoardWindow(startTime?: string | null): {
  startsAfter?: string;
  startsBefore?: string;
} {
  if (!startTime) return {};

  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) return {};

  const windowMs = ODDS_BOARD_WINDOW_HOURS * 60 * 60 * 1000;

  return {
    startsAfter: new Date(startMs - windowMs).toISOString(),
    startsBefore: new Date(startMs + windowMs).toISOString()
  };
}

function getMarketLinesWindowStats(
  normalizedLines: NormalizedMarketLines,
  window: OddsBoardWindow
): OddsBoardWindowStats {
  const startsAfterMs = new Date(window.startsAfter ?? '').getTime();
  const startsBeforeMs = new Date(window.startsBefore ?? '').getTime();

  if (!Number.isFinite(startsAfterMs) || !Number.isFinite(startsBeforeMs)) {
    return {
      eventsInsideWindow: normalizedLines.length,
      eventsOutsideWindow: 0,
      cacheValidForWindow: true
    };
  }

  let eventsInsideWindow = 0;
  let eventsOutsideWindow = 0;

  for (const event of normalizedLines) {
    const startsAtMs = new Date(event.startsAt ?? '').getTime();

    if (
      Number.isFinite(startsAtMs) &&
      startsAtMs >= startsAfterMs &&
      startsAtMs <= startsBeforeMs
    ) {
      eventsInsideWindow += 1;
    } else {
      eventsOutsideWindow += 1;
    }
  }

  return {
    eventsInsideWindow,
    eventsOutsideWindow,
    cacheValidForWindow:
      eventsInsideWindow > 0 && eventsInsideWindow >= eventsOutsideWindow
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function bumpOddsUsageCounter(boardKey: string, date = new Date()) {
  const current = await getOddsBoardCache(boardKey);
  const currentPayload =
    current?.payload && typeof current.payload === 'object'
      ? (current.payload as Record<string, unknown>)
      : null;
  const currentCount =
    typeof currentPayload?.count === 'number' && Number.isFinite(currentPayload.count)
      ? currentPayload.count
      : typeof currentPayload?.count === 'string'
        ? Number(currentPayload.count)
        : 0;

  await saveOddsBoardCache({
    boardKey,
    sport: 'MLB',
    payload: {
      count: Number.isFinite(currentCount) ? currentCount + 1 : 1,
      lastCallAt: date.toISOString(),
      cooldownMinutes: Math.round(ODDS_REFRESH_COOLDOWN_MS / 60000)
    },
    source: 'ops'
  });
}

async function recordOddsApiRefreshUsage(date = new Date()) {
  const dailyKey = `ops:odds:daily:${formatUsageDateKey(date)}`;
  const monthlyKey = `ops:odds:monthly:${formatUsageMonthKey(date)}`;

  await Promise.all([
    bumpOddsUsageCounter(dailyKey, date),
    bumpOddsUsageCounter(monthlyKey, date)
  ]);
}

function getEstimatedObjectsConsumed(eventCountFetched: number): number {
  return Math.max(0, eventCountFetched);
}

function toOddsBoardCacheCandidate(
  source: OddsBoardCacheCandidate['source'],
  payload: NormalizeMarketLinesInput | undefined,
  updatedAt: string | null | undefined,
  window: OddsBoardWindow
): OddsBoardCacheCandidate | null {
  if (!payload || !updatedAt) return null;

  const normalizedLines = normalizeMarketLines(payload);

  return {
    source,
    payload,
    normalizedLines,
    updatedAt,
    ageMs: getAgeMs(updatedAt),
    windowStats: getMarketLinesWindowStats(normalizedLines, window)
  };
}

function pickNewestCandidate(
  candidates: Array<OddsBoardCacheCandidate | null>
): OddsBoardCacheCandidate | null {
  return candidates
    .filter((candidate): candidate is OddsBoardCacheCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )[0] ?? null;
}

function getValidCandidate(
  candidates: Array<OddsBoardCacheCandidate | null>
): OddsBoardCacheCandidate | null {
  return pickNewestCandidate(
    candidates.filter((candidate) => candidate?.windowStats.cacheValidForWindow)
  );
}

function getRuntimeOddsBoardCandidate(
  boardKey: string,
  window: OddsBoardWindow
): OddsBoardCacheCandidate | null {
  const runtimeCached = runtimeOddsBoardCache.get(boardKey);
  return toOddsBoardCacheCandidate(
    'runtime',
    runtimeCached?.payload,
    runtimeCached?.updatedAt,
    window
  );
}

function setRuntimeOddsBoardCache(
  boardKey: string,
  payload: NormalizeMarketLinesInput
): string {
  const updatedAt = new Date().toISOString();
  runtimeOddsBoardCache.set(boardKey, {
    payload,
    updatedAt
  });
  return updatedAt;
}

function buildOddsDiagnostics(
  candidate: OddsBoardCacheCandidate | null,
  input: {
    refreshAttempted: boolean;
    refreshFailedReason: string | null;
    calledExternalOddsApi: boolean;
    eventCountFetched: number;
    reason: string;
  }
): OddsBoardDiagnostics {
  const eventCountFetched = Math.max(0, input.eventCountFetched);

  return {
    cacheHit: Boolean(candidate),
    eventsInsideWindow: candidate?.windowStats.eventsInsideWindow ?? 0,
    eventsOutsideWindow: candidate?.windowStats.eventsOutsideWindow ?? 0,
    cacheValidForWindow: candidate?.windowStats.cacheValidForWindow ?? false,
    refreshAttempted: input.refreshAttempted,
    refreshFailedReason: input.refreshFailedReason,
    calledExternalOddsApi: input.calledExternalOddsApi,
    eventCountFetched,
    estimatedObjectsConsumed:
      input.calledExternalOddsApi
        ? getEstimatedObjectsConsumed(eventCountFetched)
        : 0,
    reason: input.reason
  };
}

function logOddsUsage(payload: {
  gameId: string;
  boardKey: string;
  diagnostics: OddsBoardDiagnostics;
}) {
  console.warn('[odds-usage] route', {
    route: '/api/analyze',
    gameId: payload.gameId,
    boardKey: payload.boardKey,
    cacheHit: payload.diagnostics.cacheHit,
    cacheValidForWindow: payload.diagnostics.cacheValidForWindow,
    calledExternalOddsApi: payload.diagnostics.calledExternalOddsApi,
    eventCountFetched: payload.diagnostics.eventCountFetched,
    estimatedObjectsConsumed: payload.diagnostics.estimatedObjectsConsumed,
    reason: payload.diagnostics.reason
  });
}

async function getNormalizedMarketLinesForBoard(
  boardKey: string,
  window: OddsBoardWindow,
  cached: Awaited<ReturnType<typeof getOddsBoardCache>> | null = null
): Promise<{
  normalizedLines: NormalizedMarketLines;
  oddsCacheUpdatedAt: string | null;
  oddsRefreshUsed: boolean;
  oddsFetchWarning: string | null;
  diagnostics: OddsBoardDiagnostics;
}> {
  const currentCached = cached ?? (await getOddsBoardCache(boardKey));
  const boardCandidates = [
    getRuntimeOddsBoardCandidate(boardKey, window),
    toOddsBoardCacheCandidate(
      'db',
      currentCached?.payload as NormalizeMarketLinesInput | undefined,
      currentCached?.updated_at ?? null,
      window
    )
  ];
  const validCurrentCandidate = getValidCandidate(boardCandidates);

  if (validCurrentCandidate) {
    return {
      normalizedLines: validCurrentCandidate.normalizedLines,
      oddsCacheUpdatedAt: validCurrentCandidate.updatedAt,
      oddsRefreshUsed: false,
      oddsFetchWarning: null,
      diagnostics: buildOddsDiagnostics(validCurrentCandidate, {
        refreshAttempted: false,
        refreshFailedReason: null,
        calledExternalOddsApi: false,
        eventCountFetched: 0,
        reason: `cache-valid-${validCurrentCandidate.source}`
      })
    };
  }

  if (boardKey !== ODDS_BOARD_KEY) {
    const globalCached = await getOddsBoardCache(ODDS_BOARD_KEY).catch(() => null);
    const globalCandidates = [
      getRuntimeOddsBoardCandidate(ODDS_BOARD_KEY, window),
      toOddsBoardCacheCandidate(
        'db',
        globalCached?.payload as NormalizeMarketLinesInput | undefined,
        globalCached?.updated_at ?? null,
        window
      )
    ];
    const validGlobalCandidate = getValidCandidate(globalCandidates);

    if (validGlobalCandidate) {
      return {
        normalizedLines: validGlobalCandidate.normalizedLines,
        oddsCacheUpdatedAt: validGlobalCandidate.updatedAt,
        oddsRefreshUsed: false,
        oddsFetchWarning: null,
        diagnostics: buildOddsDiagnostics(validGlobalCandidate, {
          refreshAttempted: false,
          refreshFailedReason: null,
          calledExternalOddsApi: false,
          eventCountFetched: 0,
          reason: `global-cache-valid-${validGlobalCandidate.source}`
        })
      };
    }
  }

  const freshestCurrentCandidate = pickNewestCandidate(boardCandidates);
  if (
    freshestCurrentCandidate &&
    freshestCurrentCandidate?.ageMs !== null &&
    freshestCurrentCandidate.ageMs < ODDS_REFRESH_COOLDOWN_MS
  ) {
    const reason = 'cooldown-active-no-valid-cache';
    return {
      normalizedLines: [],
      oddsCacheUpdatedAt: freshestCurrentCandidate.updatedAt,
      oddsRefreshUsed: false,
      oddsFetchWarning: 'Cooldown active and no valid odds board cache available yet',
      diagnostics: buildOddsDiagnostics(freshestCurrentCandidate, {
        refreshAttempted: false,
        refreshFailedReason: null,
        calledExternalOddsApi: false,
        eventCountFetched: 0,
        reason
      })
    };
  }

  const sharedInflightRefresh = inflightOddsBoardRefreshes.has(boardKey);
  let refreshPromise = inflightOddsBoardRefreshes.get(boardKey);

  if (!refreshPromise) {
    refreshPromise = (async () => {
      let eventCountFetched = 0;

      try {
        const fresh = await fetchMlbMarketLines(window);
        eventCountFetched = fresh.data?.length ?? 0;
        const runtimeUpdatedAt = setRuntimeOddsBoardCache(boardKey, fresh);
        const freshLines = normalizeMarketLines(fresh);
        const freshWindowStats = getMarketLinesWindowStats(freshLines, window);

        if (!freshWindowStats.cacheValidForWindow) {
          const invalidCandidate = toOddsBoardCacheCandidate(
            'runtime',
            fresh,
            runtimeUpdatedAt,
            window
          );

          return {
            normalizedLines: [],
            oddsCacheUpdatedAt: runtimeUpdatedAt,
            oddsRefreshUsed: true,
            oddsFetchWarning:
              `Odds board fuera de ventana: ${freshWindowStats.eventsInsideWindow} dentro, ${freshWindowStats.eventsOutsideWindow} fuera`,
            diagnostics: buildOddsDiagnostics(invalidCandidate, {
              refreshAttempted: true,
              refreshFailedReason:
                `Odds board fuera de ventana: ${freshWindowStats.eventsInsideWindow} dentro, ${freshWindowStats.eventsOutsideWindow} fuera`,
              calledExternalOddsApi: true,
              eventCountFetched,
              reason: 'external-refresh-invalid-window'
            })
          };
        }

        let savedUpdatedAt = runtimeUpdatedAt;
        let saveWarning: string | null = null;

        try {
          const saved = await withTimeout(
            saveOddsBoardCache({
              boardKey,
              sport: 'MLB',
              payload: fresh as unknown as Record<string, unknown>,
              source: 'sportsgameodds'
            }),
            ODDS_CACHE_SAVE_TIMEOUT_MS,
            'save odds board cache'
          );
          savedUpdatedAt = saved.updated_at;
          runtimeOddsBoardCache.set(boardKey, {
            payload: fresh,
            updatedAt: saved.updated_at
          });
          void recordOddsApiRefreshUsage().catch((error) => {
            console.warn('[odds-match] odds usage counter save failed', {
              boardKey,
              refreshFailedReason:
                error instanceof Error ? error.message : 'Unknown odds usage save error'
            });
          });
        } catch (error) {
          saveWarning =
            error instanceof Error ? error.message : 'Unknown odds cache save error';
          console.warn('[odds-match] odds board cache save failed; using fresh board in-memory', {
            boardKey,
            cacheHit: false,
            cacheValidForWindow: freshWindowStats.cacheValidForWindow,
            eventsInsideWindow: freshWindowStats.eventsInsideWindow,
            eventsOutsideWindow: freshWindowStats.eventsOutsideWindow,
            refreshAttempted: true,
            refreshFailedReason: saveWarning
          });
        }

        const refreshedCandidate = toOddsBoardCacheCandidate(
          'runtime',
          fresh,
          savedUpdatedAt,
          window
        );

        return {
          normalizedLines: freshLines,
          oddsCacheUpdatedAt: savedUpdatedAt,
          oddsRefreshUsed: true,
          oddsFetchWarning: saveWarning,
          diagnostics: buildOddsDiagnostics(refreshedCandidate, {
            refreshAttempted: true,
            refreshFailedReason: saveWarning,
            calledExternalOddsApi: true,
            eventCountFetched,
            reason: saveWarning
              ? 'external-refresh-cache-save-failed-runtime-only'
              : 'external-refresh'
          })
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown odds error';

        return {
          normalizedLines: [],
          oddsCacheUpdatedAt: freshestCurrentCandidate?.updatedAt ?? null,
          oddsRefreshUsed: false,
          oddsFetchWarning: message,
          diagnostics: buildOddsDiagnostics(freshestCurrentCandidate, {
            refreshAttempted: true,
            refreshFailedReason: message,
            calledExternalOddsApi: true,
            eventCountFetched,
            reason: 'external-refresh-failed'
          })
        };
      }
    })().finally(() => {
      inflightOddsBoardRefreshes.delete(boardKey);
    });

    inflightOddsBoardRefreshes.set(boardKey, refreshPromise);
  }

  try {
    const refreshed = await refreshPromise;

    if (sharedInflightRefresh) {
      return {
        ...refreshed,
        diagnostics: {
          ...refreshed.diagnostics,
          calledExternalOddsApi: false,
          estimatedObjectsConsumed: 0,
          eventCountFetched: 0,
          reason: 'inflight-refresh-shared'
        }
      };
    }

    return {
      ...refreshed
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown odds error';

    return {
      normalizedLines: [],
      oddsCacheUpdatedAt: freshestCurrentCandidate?.updatedAt ?? null,
      oddsRefreshUsed: false,
      oddsFetchWarning: message,
      diagnostics: buildOddsDiagnostics(freshestCurrentCandidate, {
        refreshAttempted: true,
        refreshFailedReason: message,
        calledExternalOddsApi: false,
        eventCountFetched: 0,
        reason: 'unexpected-refresh-wrapper-error'
      })
    };
  }
}

function isGameStarted(
  status?: string | null,
  startTime?: string | null
): boolean {
  const normalizedStatus = String(status ?? '').toLowerCase();

  if (
    normalizedStatus.includes('in progress') ||
    normalizedStatus.includes('final') ||
    normalizedStatus.includes('completed') ||
    normalizedStatus.includes('game over')
  ) {
    return true;
  }

  if (startTime) {
    const startMs = new Date(startTime).getTime();

    if (
      Number.isFinite(startMs) &&
      Date.now() >= startMs + GAME_START_GRACE_PERIOD_MS
    ) {
      return true;
    }
  }

  return false;
}

function mapFinalPickToExecutionInput(
  finalPick: ReturnType<typeof chooseBestPick>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
): {
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5';
  preferredSide: 'home' | 'away' | 'over' | 'under';
  tier: 'A' | 'B' | 'C';
  referenceLine: number | null;
} | null {
  if (finalPick.market === 'PASS') return null;

  const executionMarket =
    finalPick.market === 'ML' ||
    finalPick.market === 'RL' ||
    finalPick.market === 'TOTAL' ||
    finalPick.market === 'F5'
      ? finalPick.market
      : null;

  if (!executionMarket) return null;

  const selection = normalizeEntityName(finalPick.selection);

  let preferredSide: 'home' | 'away' | 'over' | 'under' = 'home';

  if (
    executionMarket === 'TOTAL' ||
    selection.includes('over') ||
    selection.includes('under')
  ) {
    preferredSide = selection.includes('under') ? 'under' : 'over';
  } else {
    const awayName = normalizeEntityName(engineGame.awayTeam.core.teamName);
    const homeName = normalizeEntityName(engineGame.homeTeam.core.teamName);
    const awayAbbr = normalizeEntityName(engineGame.awayTeam.core.abbreviation);
    const homeAbbr = normalizeEntityName(engineGame.homeTeam.core.abbreviation);

    if (selection.includes(awayName) || selection.includes(awayAbbr)) {
      preferredSide = 'away';
    } else if (selection.includes(homeName) || selection.includes(homeAbbr)) {
      preferredSide = 'home';
    }
  }

  const tier: 'A' | 'B' | 'C' =
    finalPick.confidence === 'A'
      ? 'A'
      : finalPick.confidence === 'B'
        ? 'B'
        : 'C';

  return {
    marketType: executionMarket,
    preferredSide,
    tier,
    referenceLine:
      typeof finalPick.line === 'number' && Number.isFinite(finalPick.line)
        ? finalPick.line
        : null
  };
}

function getVisibleMarketReason(
  visibleMarket:
    | ReturnType<typeof chooseBestPick>
    | ReturnType<typeof evaluateMarkets>[number]
): string {
  if ('executionReason' in visibleMarket) {
    return visibleMarket.executionReason;
  }

  if ('reason' in visibleMarket) {
    return visibleMarket.reason;
  }

  return 'Mercado visible para UI';
}

function buildMarketView(
  marketCandidates: ReturnType<typeof evaluateMarkets>,
  finalPick: ReturnType<typeof chooseBestPick>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
) {
  const visibleMarket =
    finalPick.market !== 'PASS'
      ? finalPick
      : marketCandidates[0] ?? null;

  if (!visibleMarket) return null;

  const selection = String(visibleMarket.selection ?? '');
  const normalizedSelection = normalizeEntityName(selection);

  const homeName = normalizeEntityName(engineGame.homeTeam.core.teamName);
  const awayName = normalizeEntityName(engineGame.awayTeam.core.teamName);
  const homeAbbr = normalizeEntityName(engineGame.homeTeam.core.abbreviation);
  const awayAbbr = normalizeEntityName(engineGame.awayTeam.core.abbreviation);

  let direction: 'home' | 'away' | 'over' | 'under' = 'home';

  if (normalizedSelection.includes('under')) {
    direction = 'under';
  } else if (normalizedSelection.includes('over')) {
    direction = 'over';
  } else if (
    normalizedSelection.includes(awayName) ||
    normalizedSelection.includes(awayAbbr)
  ) {
    direction = 'away';
  } else if (
    normalizedSelection.includes(homeName) ||
    normalizedSelection.includes(homeAbbr)
  ) {
    direction = 'home';
  }

  return {
    marketFamily: visibleMarket.market,
    selection,
    direction,
    referenceLine: visibleMarket.line ?? null,
    confidence: visibleMarket.confidence,
    reason: getVisibleMarketReason(visibleMarket)
  };
}

function buildFinalDecision(
  finalPick: ReturnType<typeof chooseBestPick>,
  executionRecommendation: ReturnType<typeof chooseBestExecution> | null
) {
  if (finalPick.market === 'PASS') {
    return {
      status: 'NO_BET',
      reason:
        finalPick.passReason ??
        finalPick.executionReason ??
        'No bet por edge insuficiente'
    };
  }

  if (!executionRecommendation?.recommendedLine) {
    return {
      status: 'NO_BET',
      reason:
        executionRecommendation?.reason ??
        'No hay línea ejecutable'
    };
  }

  return {
    status: 'BET',
    reason: executionRecommendation.reason,
    recommendedLine: executionRecommendation.recommendedLine
  };
}

function findMatchingMarketEvent(
  normalizedLines: ReturnType<typeof normalizeMarketLines>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
) {
  const homeNames = [
    engineGame.homeTeam.core.teamName,
    engineGame.homeTeam.core.abbreviation
  ]
    .map((value) => normalizeEntityName(value))
    .filter(Boolean);
  const awayNames = [
    engineGame.awayTeam.core.teamName,
    engineGame.awayTeam.core.abbreviation
  ]
    .map((value) => normalizeEntityName(value))
    .filter(Boolean);
  const targetStartMs = new Date(engineGame.startTime ?? '').getTime();

  const candidates = normalizedLines.filter((event) => {
    const eventHome = normalizeEntityName(event.homeTeam);
    const eventAway = normalizeEntityName(event.awayTeam);

    return (
      teamNamesMatch(eventHome, homeNames) &&
      teamNamesMatch(eventAway, awayNames)
    );
  });

  if (!candidates.length) {
    return null;
  }

  if (candidates.length === 1 || !Number.isFinite(targetStartMs)) {
    return candidates[0] ?? null;
  }

  const ranked = candidates
    .map((event) => {
      const eventStartMs = new Date(event.startsAt ?? '').getTime();
      const distanceMs = Number.isFinite(eventStartMs)
        ? Math.abs(eventStartMs - targetStartMs)
        : Number.POSITIVE_INFINITY;

      return {
        event,
        distanceMs
      };
    })
    .sort((left, right) => left.distanceMs - right.distanceMs);

  return ranked[0]?.event ?? candidates[0] ?? null;
}

function teamNamesMatch(
  eventName: string,
  targetNames: string[]
): boolean {
  return targetNames.some((targetName) => {
    if (!targetName) return false;
    if (eventName === targetName) return true;

    const shorter = eventName.length < targetName.length ? eventName : targetName;
    const longer = eventName.length < targetName.length ? targetName : eventName;

    return shorter.length >= 4 && longer.includes(shorter);
  });
}

function getTeamMatchScore(eventName: string, targetNames: string[]): number {
  if (teamNamesMatch(eventName, targetNames)) return 1;

  const eventTokens = new Set(eventName.split(' ').filter((token) => token.length >= 3));
  const targetTokens = targetNames.flatMap((name) =>
    name.split(' ').filter((token) => token.length >= 3)
  );

  if (!eventTokens.size || !targetTokens.length) return 0;

  const overlap = targetTokens.filter((token) => eventTokens.has(token)).length;
  return overlap / Math.max(eventTokens.size, targetTokens.length);
}

function getClosestMarketEventsForLog(
  normalizedLines: ReturnType<typeof normalizeMarketLines>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
) {
  const homeNames = [
    engineGame.homeTeam.core.teamName,
    engineGame.homeTeam.core.abbreviation
  ]
    .map((value) => normalizeEntityName(value))
    .filter(Boolean);
  const awayNames = [
    engineGame.awayTeam.core.teamName,
    engineGame.awayTeam.core.abbreviation
  ]
    .map((value) => normalizeEntityName(value))
    .filter(Boolean);
  const targetStartMs = new Date(engineGame.startTime ?? '').getTime();

  return normalizedLines
    .map((event) => {
      const eventStartMs = new Date(event.startsAt ?? '').getTime();
      const timeDistanceHours =
        Number.isFinite(eventStartMs) && Number.isFinite(targetStartMs)
          ? Math.abs(eventStartMs - targetStartMs) / (60 * 60 * 1000)
          : 99;
      const nameScore =
        getTeamMatchScore(normalizeEntityName(event.homeTeam), homeNames) +
        getTeamMatchScore(normalizeEntityName(event.awayTeam), awayNames);

      return {
        eventId: event.eventId,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        startsAt: event.startsAt,
        linesCount: event.lines.length,
        score: nameScore * 10 - timeDistanceHours
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((event) => ({
      eventId: event.eventId,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      startsAt: event.startsAt,
      linesCount: event.linesCount
    }));
}

function logOddsNoMatch(
  normalizedLines: NormalizedMarketLines,
  engineGame: ReturnType<typeof mapEspnToEngineGame>,
  oddsCacheUpdatedAt: string | null,
  oddsRefreshUsed: boolean,
  boardKey: string,
  window: OddsBoardWindow,
  diagnostics: OddsBoardDiagnostics
) {
  console.warn('[odds-match] no market event match', {
    gameId: engineGame.gameId,
    boardKey,
    oddsCacheUpdatedAt,
    oddsRefreshUsed,
    cacheHit: diagnostics.cacheHit,
    cacheValidForWindow: diagnostics.cacheValidForWindow,
    eventsInsideWindow: diagnostics.eventsInsideWindow,
    eventsOutsideWindow: diagnostics.eventsOutsideWindow,
    refreshAttempted: diagnostics.refreshAttempted,
    refreshFailedReason: diagnostics.refreshFailedReason,
    oddsBoardWindow: window,
    oddsBoardEventCount: normalizedLines.length,
    espnHome: engineGame.homeTeam.core.teamName,
    espnAway: engineGame.awayTeam.core.teamName,
    espnStartTime: engineGame.startTime,
    availableEvents: normalizedLines.slice(0, 5).map((event) => ({
      eventId: event.eventId,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      startsAt: event.startsAt,
      linesCount: event.lines.length
    })),
    closestEvents: getClosestMarketEventsForLog(normalizedLines, engineGame)
  });
}

function percentMove(current: number, opening: number): number {
  if (!opening || !Number.isFinite(opening) || !Number.isFinite(current)) {
    return 0;
  }

  return ((current - opening) / opening) * 100;
}

function moneylineSignalFromOdds(
  homeML?: number,
  awayML?: number
): number {
  if (!homeML || !awayML || homeML <= 1 || awayML <= 1) {
    return 0;
  }

  const homeImp = 1 / homeML;
  const awayImp = 1 / awayML;

  return Math.max(-25, Math.min(25, (homeImp - awayImp) * 100));
}

function buildMarketContextLight(
  snapshotWindow: Awaited<ReturnType<typeof getMarketSnapshotWindow>>,
  currentOdds: ReturnType<typeof mapEventMarketLinesToGameOdds>
) {
  const first = snapshotWindow.first;
  const latest = snapshotWindow.latest;

  const currentHomeML = currentOdds?.homeML ?? null;
  const currentAwayML = currentOdds?.awayML ?? null;

  const openingHomeML =
    first?.home_ml !== null && first?.home_ml !== undefined
      ? Number(first.home_ml)
      : null;

  const openingAwayML =
    first?.away_ml !== null && first?.away_ml !== undefined
      ? Number(first.away_ml)
      : null;

  const latestHomeML =
    latest?.home_ml !== null && latest?.home_ml !== undefined
      ? Number(latest.home_ml)
      : currentHomeML;

  const latestAwayML =
    latest?.away_ml !== null && latest?.away_ml !== undefined
      ? Number(latest.away_ml)
      : currentAwayML;

  const moveHome =
    openingHomeML && latestHomeML
      ? percentMove(latestHomeML, openingHomeML)
      : 0;

  const moveAway =
    openingAwayML && latestAwayML
      ? percentMove(latestAwayML, openingAwayML)
      : 0;

  const lineMovementPct = Math.max(
    -100,
    Math.min(100, moveAway - moveHome)
  );

  const sharpSignal = moneylineSignalFromOdds(
    currentHomeML ?? undefined,
    currentAwayML ?? undefined
  );

  return {
    lineMovementPct,
    ticketSplitPctHome: undefined,
    ticketSplitPctAway: undefined,
    sharpSignal
  };
}

function buildExecutionAdjustedFinalPick(
  finalPick: ReturnType<typeof chooseBestPick>,
  executionRecommendation: ReturnType<typeof chooseBestExecution> | null
): ReturnType<typeof chooseBestPick> {
  const evaluatedRecommendation = executionRecommendation?.recommendedEvaluation;

  if (!evaluatedRecommendation || finalPick.market === 'PASS') {
    return finalPick;
  }

  return {
    ...finalPick,
    market: evaluatedRecommendation.market,
    selection: evaluatedRecommendation.selection,
    line: evaluatedRecommendation.line,
    odds: evaluatedRecommendation.odds,
    estimatedProbability: evaluatedRecommendation.estimatedProbability,
    impliedProbability: evaluatedRecommendation.impliedProbability,
    edge: evaluatedRecommendation.edge,
    ev: evaluatedRecommendation.ev,
    selectionScore: evaluatedRecommendation.selectionScore,
    confidence: evaluatedRecommendation.confidence,
    executionReason: evaluatedRecommendation.reason,
    altMarket1: executionRecommendation?.alternativeEvaluation1
      ? serializeAlternativeMarket(executionRecommendation.alternativeEvaluation1) ?? finalPick.altMarket1
      : finalPick.altMarket1,
    altMarket2: executionRecommendation?.alternativeEvaluation2
      ? serializeAlternativeMarket(executionRecommendation.alternativeEvaluation2) ?? finalPick.altMarket2
      : finalPick.altMarket2
  };
}

function normalizeSelectionForTeamMatch(selection: string) {
  return normalizeEntityName(
    selection
      .replace(/[+-]?\d+(?:\.\d+)?/g, ' ')
      .replace(/\bf5\b/gi, ' ')
      .replace(/\bml\b|\brl\b/gi, ' ')
  );
}

function resolveSelectedSide(
  engineGame: ReturnType<typeof mapEspnToEngineGame>,
  selection: string
): 'home' | 'away' | null {
  const normalizedSelection = normalizeSelectionForTeamMatch(selection);

  const homeCandidates = [
    engineGame.homeTeam.core.teamName,
    engineGame.homeTeam.core.abbreviation
  ]
    .filter(Boolean)
    .map((value) => normalizeEntityName(String(value)));
  const awayCandidates = [
    engineGame.awayTeam.core.teamName,
    engineGame.awayTeam.core.abbreviation
  ]
    .filter(Boolean)
    .map((value) => normalizeEntityName(String(value)));

  if (
    homeCandidates.some(
      (candidate) =>
        normalizedSelection === candidate ||
        normalizedSelection.startsWith(`${candidate} `)
    )
  ) {
    return 'home';
  }

  if (
    awayCandidates.some(
      (candidate) =>
        normalizedSelection === candidate ||
        normalizedSelection.startsWith(`${candidate} `)
    )
  ) {
    return 'away';
  }

  return null;
}

function applyAdverseMarketGuard(
  finalPick: ReturnType<typeof chooseBestPick>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
): ReturnType<typeof chooseBestPick> {
  if (
    finalPick.market === 'PASS' ||
    finalPick.market === 'TOTAL' ||
    /(^|\s)(over|under)(\s|$)/i.test(finalPick.selection)
  ) {
    return finalPick;
  }

  const movement = engineGame.marketContextLight.lineMovementPct;
  const sharp = engineGame.marketContextLight.sharpSignal;

  if (
    typeof movement !== 'number' ||
    !Number.isFinite(movement) ||
    typeof sharp !== 'number' ||
    !Number.isFinite(sharp)
  ) {
    return finalPick;
  }

  const selectedSide = resolveSelectedSide(engineGame, finalPick.selection);
  if (!selectedSide) {
    return finalPick;
  }

  const directionalScore = movement + sharp;
  const marketSide =
    directionalScore > 0 ? 'home' : directionalScore < 0 ? 'away' : null;

  if (!marketSide || marketSide === selectedSide) {
    return finalPick;
  }

  const adverseMove =
    selectedSide === 'home' ? movement <= -6 : movement >= 6;
  const adverseSharp =
    selectedSide === 'home' ? sharp <= -4 : sharp >= 4;

  if (
    !adverseMove ||
    !adverseSharp ||
    Math.abs(directionalScore) < 10
  ) {
    return finalPick;
  }

  const selectedTeam =
    selectedSide === 'home'
      ? engineGame.homeTeam.core.teamName
      : engineGame.awayTeam.core.teamName;
  const marketTeam =
    marketSide === 'home'
      ? engineGame.homeTeam.core.teamName
      : engineGame.awayTeam.core.teamName;
  const reason =
    `No bet: el mercado se movió en contra de ${selectedTeam}. ` +
    `${marketTeam} toma la corriente con movimiento ${movement.toFixed(1)}% ` +
    `y señal sharp ${sharp.toFixed(0)}, así que el side queda sin confirmación suficiente.`;

  return {
    ...finalPick,
    market: 'PASS',
    selection: 'NO BET',
    line: undefined,
    odds: undefined,
    estimatedProbability: undefined,
    impliedProbability: undefined,
    edge: undefined,
    ev: undefined,
    confidence: 'PASS',
    executionReason: reason,
    passReason: reason,
    altMarket1: undefined,
    altMarket2: undefined
  };
}

function nearlyEqual(
  a?: number | null,
  b?: number | null,
  tolerance = 0.0001
): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) <= tolerance;
}

function shouldSaveNewSnapshot(
  latestSnapshot: Awaited<ReturnType<typeof getLatestMarketSnapshot>>,
  currentOdds: ReturnType<typeof mapEventMarketLinesToGameOdds>
): boolean {
  if (!latestSnapshot) return true;

  const createdAtMs = new Date(latestSnapshot.created_at).getTime();
  const nowMs = Date.now();
  const minutesSinceLast = (nowMs - createdAtMs) / (1000 * 60);

  const sameHomeML = nearlyEqual(
    latestSnapshot.home_ml,
    currentOdds?.homeML ?? null
  );
  const sameAwayML = nearlyEqual(
    latestSnapshot.away_ml,
    currentOdds?.awayML ?? null
  );

  const sameHomeRLLine = nearlyEqual(
    latestSnapshot.home_rl_line,
    currentOdds?.homeRL?.line ?? null
  );
  const sameHomeRLOdds = nearlyEqual(
    latestSnapshot.home_rl_odds,
    currentOdds?.homeRL?.odds ?? null
  );

  const sameAwayRLLine = nearlyEqual(
    latestSnapshot.away_rl_line,
    currentOdds?.awayRL?.line ?? null
  );
  const sameAwayRLOdds = nearlyEqual(
    latestSnapshot.away_rl_odds,
    currentOdds?.awayRL?.odds ?? null
  );

  const sameTotalLine = nearlyEqual(
    latestSnapshot.total_line,
    currentOdds?.total?.line ?? null
  );
  const sameOverOdds = nearlyEqual(
    latestSnapshot.over_odds,
    currentOdds?.total?.overOdds ?? null
  );
  const sameUnderOdds = nearlyEqual(
    latestSnapshot.under_odds,
    currentOdds?.total?.underOdds ?? null
  );

  const noMeaningfulChange =
    sameHomeML &&
    sameAwayML &&
    sameHomeRLLine &&
    sameHomeRLOdds &&
    sameAwayRLLine &&
    sameAwayRLOdds &&
    sameTotalLine &&
    sameOverOdds &&
    sameUnderOdds;

  if (minutesSinceLast < 10 && noMeaningfulChange) {
    return false;
  }

  return true;
}

function buildAnalyzePayload(
  espnGame: Awaited<ReturnType<typeof getNormalizedEspnMlbGame>>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>,
  layerA: ReturnType<typeof projectGameScript>,
  marketCandidates: ReturnType<typeof evaluateMarkets>,
  marketView: ReturnType<typeof buildMarketView>,
  finalDecision: ReturnType<typeof buildFinalDecision>,
  finalPick: ReturnType<typeof chooseBestPick>,
  matchingMarketEvent: ReturnType<typeof findMatchingMarketEvent>,
  executionRecommendation: ReturnType<typeof chooseBestExecution> | null
) {
  const normalizedExecutionRecommendation = executionRecommendation
    ? {
        ...executionRecommendation,
        tier:
          executionRecommendation.recommendedEvaluation?.confidence ??
          executionRecommendation.tier
      }
    : null;

  return {
    ok: true,
    espnGame,
    engineGame,
    blockScores: layerA.blockScores,
    layerA,
    marketCandidates,
    marketView,
    finalDecision,
    finalPick,
    matchingMarketEvent,
    executionRecommendation: normalizedExecutionRecommendation,

    uiSummary: {
      pregameScore: roundScore(layerA.pregameScore),
      lean: layerA.lean,
      confidence: layerA.confidence,

      marketView: marketView
        ? {
            marketFamily: marketView.marketFamily,
            selection: marketView.selection,
            direction: marketView.direction,
            confidence: marketView.confidence,
            reason: marketView.reason
          }
        : null,

      finalPick:
        finalPick.market !== 'PASS'
          ? {
              market: finalPick.market,
              selection: finalPick.selection,
              confidence: finalPick.confidence,
              probability: roundMetric(finalPick.estimatedProbability),
              edge: roundMetric(finalPick.edge),
              ev: roundMetric(finalPick.ev)
            }
          : {
              market: 'PASS',
              selection: 'NO BET',
              confidence: 'PASS',
              probability: null,
              edge: null,
              ev: null
            },

      execution:
        executionRecommendation?.recommendedLine
          ? {
              status: finalDecision.status,
              selection: executionRecommendation.recommendedLine.selection,
              line: executionRecommendation.recommendedLine.line ?? null,
              odds: roundOdds(executionRecommendation.recommendedLine.odds),
              reason: executionRecommendation.reason
            }
          : {
              status: finalDecision.status,
              selection: null,
              line: null,
              odds: null,
              reason: finalDecision.reason
            }
    },

    resultSummary: {
      status: 'pending',
      result: null,
      profitUnits: null
    }
  };
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sameNumericValue(left?: number | null, right?: number | null): boolean {
  if (left === undefined || left === null) {
    return right === undefined || right === null;
  }

  if (right === undefined || right === null) {
    return false;
  }

  return Math.abs(left - right) < 0.001;
}

function formatAlertLineValue(
  market: string,
  selection: string,
  line?: number | null
): string {
  if (line === undefined || line === null) return '';

  const normalizedSelection = selection.toLowerCase();
  const isTotalLike =
    market === 'TOTAL' ||
    normalizedSelection.startsWith('over') ||
    normalizedSelection.startsWith('under');

  return isTotalLike
    ? line.toFixed(1)
    : `${line > 0 ? '+' : ''}${line.toFixed(1)}`;
}

function describeExecutionDescriptor(input: {
  market: string;
  selection: string;
  line?: number | null;
}): string {
  const suffix = formatAlertLineValue(input.market, input.selection, input.line);
  const pickLabel = suffix ? `${input.selection} ${suffix}` : input.selection;
  return input.market ? `${input.market} ${pickLabel}` : pickLabel;
}

function getExecutionDescriptorFromPick(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>
) {
  if (!pick || !isConfirmedPickRecord(pick)) return null;

  return {
    market: safeString(pick.execution_market) || safeString(pick.market),
    selection: safeString(pick.execution_selection) || safeString(pick.selection),
    line:
      typeof pick.execution_line === 'number'
        ? pick.execution_line
        : pick.line
  };
}

function getExecutionDescriptorFromRecommendation(
  recommendation: ReturnType<typeof chooseBestExecution> | null
) {
  const line = recommendation?.recommendedLine;
  if (!line) return null;

  return {
    market: line.marketType,
    selection: line.selection,
    line: typeof line.line === 'number' ? line.line : null
  };
}

function sameExecutionDescriptor(
  left: ReturnType<typeof getExecutionDescriptorFromPick>,
  right: ReturnType<typeof getExecutionDescriptorFromRecommendation>
): boolean {
  if (!left || !right) return false;

  return (
    left.market.toUpperCase() === right.market.toUpperCase() &&
    normalizeEntityName(left.selection) === normalizeEntityName(right.selection) &&
    sameNumericValue(left.line, right.line)
  );
}

function resolvePendingPickResetReason(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>,
  currentDecision: { status?: string | null } | null,
  recommendation: ReturnType<typeof chooseBestExecution> | null
): string | null {
  if (!pick || !isConfirmedPickRecord(pick)) return null;
  if (safeString(pick.status).toLowerCase() !== 'pending') return null;

  if (
    safeString(currentDecision?.status) === 'NO_BET' ||
    !recommendation?.recommendedLine
  ) {
    return 'El modelo paso a NO BET y se libero el pick ejecutado pendiente.';
  }

  const currentExecution = getExecutionDescriptorFromRecommendation(recommendation);
  const confirmedExecution = getExecutionDescriptorFromPick(pick);

  if (sameExecutionDescriptor(confirmedExecution, currentExecution)) {
    return null;
  }

  if (!currentExecution || !confirmedExecution) {
    return 'La recomendacion activa ya no coincide con el pick ejecutado pendiente.';
  }

  return `La recomendacion cambio de ${describeExecutionDescriptor(confirmedExecution)} a ${describeExecutionDescriptor(currentExecution)}; se libero el pick ejecutado pendiente.`;
}

function shouldSyncConfirmedPickCanonicalFields(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>,
  finalPick: ReturnType<typeof chooseBestPick>
): boolean {
  if (!pick || !isConfirmedPickRecord(pick) || finalPick.market === 'PASS') {
    return false;
  }

  return (
    safeString(pick.market).toUpperCase() !== finalPick.market.toUpperCase() ||
    normalizeEntityName(safeString(pick.selection)) !== normalizeEntityName(finalPick.selection) ||
    !sameNumericValue(pick.line, finalPick.line ?? null) ||
    !sameNumericValue(pick.odds, finalPick.odds ?? null) ||
    safeString(pick.confidence) !== finalPick.confidence ||
    !sameNumericValue(pick.estimated_probability, finalPick.estimatedProbability ?? null) ||
    !sameNumericValue(pick.implied_probability, finalPick.impliedProbability ?? null) ||
    !sameNumericValue(pick.edge, finalPick.edge ?? null) ||
    !sameNumericValue(pick.ev, finalPick.ev ?? null)
  );
}

function buildResultSummaryFromPick(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>
) {
  return {
    status: pick?.status ?? 'pending',
    result: pick?.result ?? null,
    profitUnits: roundMetric(pick?.profit_units)
  };
}

function buildConfirmedPickSummary(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>
) {
  if (!pick || !isConfirmedPickRecord(pick)) return null;

  return {
    market: pick.execution_market || pick.market,
    selection: pick.execution_selection || pick.selection,
    line:
      typeof pick.execution_line === 'number'
        ? pick.execution_line
        : pick.line,
    odds: roundOdds(pick.execution_odds ?? pick.odds),
    status: pick.status,
    reason: pick.execution_reason || pick.reason
  };
}

function buildAlerts(
  previousPayload: Record<string, unknown> | null,
  currentPayload: Record<string, unknown>
): string[] {
  if (!previousPayload) return [];

  const alerts: string[] = [];

  const previousFinalPick =
    previousPayload.finalPick as Record<string, unknown> | undefined;
  const currentFinalPick =
    currentPayload.finalPick as Record<string, unknown> | undefined;

  const prevMarket = safeString(previousFinalPick?.market);
  const currMarket = safeString(currentFinalPick?.market);

  const prevSelection = safeString(previousFinalPick?.selection);
  const currSelection = safeString(currentFinalPick?.selection);
  const prevLine = safeNumber(previousFinalPick?.line);
  const currLine = safeNumber(currentFinalPick?.line);
  const previousDecision =
    previousPayload.finalDecision as Record<string, unknown> | undefined;
  const currentDecision =
    currentPayload.finalDecision as Record<string, unknown> | undefined;
  const currReason = safeString(currentDecision?.reason);
  const wasNoBet =
    safeString(previousDecision?.status) === 'NO_BET' ||
    prevMarket === 'PASS' ||
    prevSelection?.toUpperCase() === 'NO BET';
  const isBetNow =
    safeString(currentDecision?.status) === 'BET' &&
    currMarket !== 'PASS' &&
    currSelection?.toUpperCase() !== 'NO BET';

  const lineSuffix =
    currLine !== null
      ? ` ${currMarket === 'TOTAL' || currSelection?.toLowerCase().startsWith('over') || currSelection?.toLowerCase().startsWith('under') ? currLine.toFixed(1) : `${currLine > 0 ? '+' : ''}${currLine.toFixed(1)}`}`
      : '';

  if (wasNoBet && isBetNow && currMarket && currSelection) {
    alerts.push(
      `Pasó de NO BET a BET: ahora ${currMarket} / ${currSelection}${lineSuffix}. ${currReason ?? 'El edge y la ejecución ya quedaron dentro de rango.'}`
    );
  }

  if (!wasNoBet && !isBetNow && safeString(currentDecision?.status) === 'NO_BET') {
    alerts.push(
      `Pasó de BET a NO BET: ${currReason ?? 'el mercado dejó de respaldar la ejecución.'}`
    );
  }

  if (prevMarket && currMarket && prevMarket !== currMarket) {
    alerts.push(`Cambio de mercado: ${prevMarket} → ${currMarket}`);
  }

  if (prevSelection && currSelection && prevSelection !== currSelection) {
    alerts.push(`Cambio de pick: ${prevSelection} → ${currSelection}`);
  }

  if (
    prevSelection &&
    currSelection &&
    prevSelection === currSelection &&
    prevMarket &&
    currMarket &&
    prevMarket === currMarket &&
    !sameNumericValue(prevLine, currLine)
  ) {
    alerts.push(
      `Cambio de linea recomendada: ${prevSelection} ${formatAlertLineValue(prevMarket, prevSelection, prevLine)} -> ${currSelection} ${formatAlertLineValue(currMarket, currSelection, currLine)}`.trim()
    );
  }

  const prevEngineGame =
    previousPayload.engineGame as Record<string, unknown> | undefined;
  const currEngineGame =
    currentPayload.engineGame as Record<string, unknown> | undefined;

  const prevHomeTeam =
    prevEngineGame?.homeTeam as Record<string, unknown> | undefined;
  const prevAwayTeam =
    prevEngineGame?.awayTeam as Record<string, unknown> | undefined;
  const currHomeTeam =
    currEngineGame?.homeTeam as Record<string, unknown> | undefined;
  const currAwayTeam =
    currEngineGame?.awayTeam as Record<string, unknown> | undefined;

  const prevHomeStarter =
    (prevHomeTeam?.starter as Record<string, unknown> | undefined)?.name;
  const currHomeStarter =
    (currHomeTeam?.starter as Record<string, unknown> | undefined)?.name;
  const prevAwayStarter =
    (prevAwayTeam?.starter as Record<string, unknown> | undefined)?.name;
  const currAwayStarter =
    (currAwayTeam?.starter as Record<string, unknown> | undefined)?.name;

  if (
    safeString(prevHomeStarter) &&
    safeString(currHomeStarter) &&
    prevHomeStarter !== currHomeStarter
  ) {
    alerts.push(
      `Starter local cambió: ${safeString(prevHomeStarter)} → ${safeString(currHomeStarter)}`
    );
  }

  if (
    safeString(prevAwayStarter) &&
    safeString(currAwayStarter) &&
    prevAwayStarter !== currAwayStarter
  ) {
    alerts.push(
      `Starter visitante cambió: ${safeString(prevAwayStarter)} → ${safeString(currAwayStarter)}`
    );
  }

  const prevOdds = prevEngineGame?.odds as Record<string, unknown> | undefined;
  const currOdds = currEngineGame?.odds as Record<string, unknown> | undefined;

  const prevHomeML = safeNumber(prevOdds?.homeML);
  const currHomeML = safeNumber(currOdds?.homeML);
  const prevAwayML = safeNumber(prevOdds?.awayML);
  const currAwayML = safeNumber(currOdds?.awayML);

  if (
    prevHomeML &&
    currHomeML &&
    Math.abs(((currHomeML - prevHomeML) / prevHomeML) * 100) >= 8
  ) {
    alerts.push(
      `Movimiento fuerte en ML local: ${prevHomeML.toFixed(2)} → ${currHomeML.toFixed(2)}`
    );
  }

  if (
    prevAwayML &&
    currAwayML &&
    Math.abs(((currAwayML - prevAwayML) / prevAwayML) * 100) >= 8
  ) {
    alerts.push(
      `Movimiento fuerte en ML visitante: ${prevAwayML.toFixed(2)} → ${currAwayML.toFixed(2)}`
    );
  }

  const prevTotal = prevOdds?.total as Record<string, unknown> | undefined;
  const currTotal = currOdds?.total as Record<string, unknown> | undefined;

  const prevTotalLine = safeNumber(prevTotal?.line);
  const currTotalLine = safeNumber(currTotal?.line);

  if (
    prevTotalLine !== null &&
    currTotalLine !== null &&
    prevTotalLine !== currTotalLine
  ) {
    alerts.push(`Cambio en total principal: ${prevTotalLine} → ${currTotalLine}`);
  }

  return alerts;
}

function normalizeStoredAlert(alert: Record<string, unknown> | string): string | null {
  if (typeof alert === 'string') {
    const trimmed = alert.trim();
    return trimmed || null;
  }

  if (alert && typeof alert === 'object') {
    const message = safeString((alert as Record<string, unknown>).message);
    return message || null;
  }

  return null;
}

function mergeAlertHistory(
  existingAlerts: Array<Record<string, unknown> | string> | null | undefined,
  nextAlerts: string[]
): string[] {
  const merged = [
    ...(existingAlerts ?? []).map(normalizeStoredAlert).filter((value): value is string => Boolean(value)),
    ...nextAlerts
  ];

  return merged.filter((value, index) => merged.indexOf(value) === index);
}

function serializeSnapshotValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return String(value);
  }
}

async function saveCurrentPregameLock(
  gameId: string,
  espnGame: Awaited<ReturnType<typeof getNormalizedEspnMlbGame>>,
  payload: Record<string, unknown>
) {
  const existing = await getPregameSnapshotsForGame(gameId);

  const previousPayload =
    (existing.mid?.payload as Record<string, unknown> | null) ??
    (existing.open?.payload as Record<string, unknown> | null) ??
    null;

  const alerts = mergeAlertHistory(
    existing.mid?.alerts,
    buildAlerts(previousPayload, payload)
  );

  const stage: SnapshotStage =
    existing.open === null ? 'open' : 'mid';
  const currentSnapshot =
    stage === 'open'
      ? existing.open
      : existing.mid ?? existing.open;

  if (
    currentSnapshot &&
    serializeSnapshotValue(currentSnapshot.payload) === serializeSnapshotValue(payload) &&
    serializeSnapshotValue(currentSnapshot.alerts ?? []) === serializeSnapshotValue(alerts)
  ) {
    return {
      snapshot: currentSnapshot,
      alerts: (currentSnapshot.alerts ?? [])
        .map(normalizeStoredAlert)
        .filter((value): value is string => Boolean(value)),
      stage:
        currentSnapshot.snapshot_stage === 'open' ||
        currentSnapshot.snapshot_stage === 'mid' ||
        currentSnapshot.snapshot_stage === 'final'
          ? currentSnapshot.snapshot_stage
          : stage
    };
  }

  const snapshot = await savePregameSnapshot({
    gameId,
    snapshotStage: stage,
    sport: 'MLB',
    gameStatus: espnGame.status ?? null,
    startTime: espnGame.date ?? null,
    payload,
    alerts
  });

  return {
    snapshot,
    alerts,
    stage
  };
}

async function getOrCreateFinalLockedSnapshot(
  gameId: string,
  espnGame: Awaited<ReturnType<typeof getNormalizedEspnMlbGame>>
): Promise<PregameSnapshotRow | null> {
  const existing = await getPregameSnapshotsForGame(gameId);

  if (existing.final) {
    return existing.final;
  }

  const source = existing.mid ?? existing.open ?? null;
  if (!source) return null;

  const finalSnapshot = await savePregameSnapshot({
    gameId,
    snapshotStage: 'final',
    sport: 'MLB',
    gameStatus: espnGame.status ?? null,
    startTime: espnGame.date ?? null,
    payload: source.payload,
    alerts: source.alerts
  });

  return finalSnapshot;
}

export async function GET(req: NextRequest) {
  try {
    const gameId = req.nextUrl.searchParams.get('gameId');
    const originHint = getOriginHint(req.headers);

    if (!gameId) {
      return jsonResponseWithAudit(
        '/api/analyze',
        { ok: false, error: 'Missing gameId' },
        {
          originHint,
          gameId: null,
          error: 'Missing gameId'
        },
        { status: 400 }
      );
    }

    const espnGame = await getNormalizedEspnMlbGame(gameId);

    if (isGameStarted(espnGame.status, espnGame.date)) {
      const finalSnapshot = await getOrCreateFinalLockedSnapshot(
        gameId,
        espnGame
      );

      if (!finalSnapshot) {
        return jsonResponseWithAudit(
          '/api/analyze',
          {
            ok: false,
            error: 'El juego ya empezó y no existe snapshot pregame previo para congelar'
          },
          {
            originHint,
            gameId,
            mode: 'frozen',
            finalSnapshotFound: false
          },
          { status: 409 }
        );
      }

      const frozenPayload =
        typeof finalSnapshot.payload === 'object' &&
        finalSnapshot.payload !== null
          ? finalSnapshot.payload
          : {};
      const latestPick = await getLatestPickForGame(gameId);
      const settledPick =
        latestPick?.status === 'pending'
          ? await autoSettlePick(latestPick)
          : latestPick;

      return jsonResponseWithAudit(
        '/api/analyze',
        {
          ...frozenPayload,
          ok: true,
          frozenPregame: true,
          statsFetchWarning: null,
          oddsFetchWarning: null,
          oddsCacheUpdatedAt: null,
          oddsRefreshUsed: false,
          confirmedPick: buildConfirmedPickSummary(settledPick ?? latestPick),
          resultSummary: buildResultSummaryFromPick(settledPick ?? latestPick),
          pickLock: {
            snapshotId: finalSnapshot.id,
            stage: 'FINAL',
            lastUpdatedAt: finalSnapshot.updated_at,
            alerts: finalSnapshot.alerts ?? []
          }
        },
        {
          originHint,
          gameId,
          mode: 'frozen',
          finalSnapshotFound: true,
          alertCount: finalSnapshot.alerts?.length ?? 0
        }
      );
    }

    let engineGame = mapEspnToEngineGame(espnGame);
    let statsFetchWarning: string | null = null;

    try {
      engineGame = await enrichEngineGameWithMlbStats(
        engineGame,
        espnGame
      );
    } catch (error) {
      statsFetchWarning =
        error instanceof Error ? error.message : 'Unknown MLB stats error';
    }

    let matchingMarketEvent: ReturnType<typeof findMatchingMarketEvent> = null;
    let oddsFetchWarning: string | null = null;
    let oddsCacheUpdatedAt: string | null = null;
    let oddsRefreshUsed = false;
    let latestStoredMarket: Awaited<ReturnType<typeof getLatestMarketSnapshot>> = null;
    const oddsBoardKey = getOddsBoardKey(engineGame.startTime);
    const oddsBoardWindow = getOddsBoardWindow(engineGame.startTime);

    try {
      const autoOdds = await getNormalizedMarketLinesForBoard(
        oddsBoardKey,
        oddsBoardWindow
      );

      oddsFetchWarning = autoOdds.oddsFetchWarning;
      oddsCacheUpdatedAt = autoOdds.oddsCacheUpdatedAt;
      oddsRefreshUsed = autoOdds.oddsRefreshUsed;
      logOddsUsage({
        gameId,
        boardKey: oddsBoardKey,
        diagnostics: autoOdds.diagnostics
      });

      matchingMarketEvent = findMatchingMarketEvent(
        autoOdds.normalizedLines,
        engineGame
      );

      engineGame.odds = mapEventMarketLinesToGameOdds(matchingMarketEvent);

      if (!matchingMarketEvent) {
        logOddsNoMatch(
          autoOdds.normalizedLines,
          engineGame,
          oddsCacheUpdatedAt,
          oddsRefreshUsed,
          oddsBoardKey,
          oddsBoardWindow,
          autoOdds.diagnostics
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown odds error';

      oddsFetchWarning = message;
      logOddsUsage({
        gameId,
        boardKey: oddsBoardKey,
        diagnostics: {
          cacheHit: false,
          cacheValidForWindow: false,
          eventsInsideWindow: 0,
          eventsOutsideWindow: 0,
          refreshAttempted: true,
          refreshFailedReason: message,
          calledExternalOddsApi: false,
          eventCountFetched: 0,
          estimatedObjectsConsumed: 0,
          reason: 'analyze-odds-error'
        }
      });
      console.warn('[odds-match] odds refresh failed before matching', {
        gameId: engineGame.gameId,
        boardKey: oddsBoardKey,
        oddsBoardWindow,
        cacheHit: false,
        cacheValidForWindow: false,
        eventsInsideWindow: 0,
        eventsOutsideWindow: 0,
        refreshAttempted: true,
        refreshFailedReason: message
      });
    }

    if (!engineGame.odds) {
      try {
        latestStoredMarket = await getLatestMarketSnapshot(gameId);

        if (latestStoredMarket) {
          engineGame.odds = {
            homeML: latestStoredMarket.home_ml ?? undefined,
            awayML: latestStoredMarket.away_ml ?? undefined,
            homeRL:
              latestStoredMarket.home_rl_line !== null &&
              latestStoredMarket.home_rl_odds !== null
                ? {
                    line: Number(latestStoredMarket.home_rl_line),
                    odds: Number(latestStoredMarket.home_rl_odds)
                  }
                : undefined,
            awayRL:
              latestStoredMarket.away_rl_line !== null &&
              latestStoredMarket.away_rl_odds !== null
                ? {
                    line: Number(latestStoredMarket.away_rl_line),
                    odds: Number(latestStoredMarket.away_rl_odds)
                  }
                : undefined,
            total:
              latestStoredMarket.total_line !== null &&
              latestStoredMarket.over_odds !== null &&
              latestStoredMarket.under_odds !== null
                ? {
                    line: Number(latestStoredMarket.total_line),
                    overOdds: Number(latestStoredMarket.over_odds),
                    underOdds: Number(latestStoredMarket.under_odds)
                  }
                : undefined
          };
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase market snapshot error';

        oddsFetchWarning = oddsFetchWarning ?? message;
      }
    }

    if (matchingMarketEvent) {
      if (!latestStoredMarket) {
        try {
          latestStoredMarket = await getLatestMarketSnapshot(gameId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown Supabase market snapshot error';

          oddsFetchWarning = oddsFetchWarning ?? message;
        }
      }

      try {
        if (shouldSaveNewSnapshot(latestStoredMarket, engineGame.odds)) {
          await saveMarketSnapshot({
            gameId,
            eventId: matchingMarketEvent.eventId,
            homeTeam: matchingMarketEvent.homeTeam,
            awayTeam: matchingMarketEvent.awayTeam,

            homeML: engineGame.odds?.homeML ?? null,
            awayML: engineGame.odds?.awayML ?? null,

            homeRLLine: engineGame.odds?.homeRL?.line ?? null,
            homeRLOdds: engineGame.odds?.homeRL?.odds ?? null,
            awayRLLine: engineGame.odds?.awayRL?.line ?? null,
            awayRLOdds: engineGame.odds?.awayRL?.odds ?? null,

            totalLine: engineGame.odds?.total?.line ?? null,
            overOdds: engineGame.odds?.total?.overOdds ?? null,
            underOdds: engineGame.odds?.total?.underOdds ?? null
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase market save error';

        oddsFetchWarning = oddsFetchWarning ?? message;
      }

      try {
        const snapshotWindow = await getMarketSnapshotWindow(gameId);

        engineGame.marketContextLight = buildMarketContextLight(
          snapshotWindow,
          engineGame.odds
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase market context error';

        oddsFetchWarning = oddsFetchWarning ?? message;
      }
    }

    const layerA = projectGameScript(engineGame);
    const marketCandidates = evaluateMarkets(engineGame, layerA);
    const finalPick = chooseBestPick(engineGame, layerA);

    const executionInput = mapFinalPickToExecutionInput(
      finalPick,
      engineGame
    );

    const executionRecommendation =
      matchingMarketEvent && executionInput
        ? chooseBestExecution(
            matchingMarketEvent,
            executionInput.marketType,
            executionInput.preferredSide,
            executionInput.tier,
            engineGame,
            layerA,
            executionInput.referenceLine
          )
        : null;

    const resolvedFinalPick = buildExecutionAdjustedFinalPick(
      finalPick,
      executionRecommendation
    );
    const guardedFinalPick = applyAdverseMarketGuard(
      resolvedFinalPick,
      engineGame
    );
    const effectiveExecutionRecommendation =
      guardedFinalPick.market === 'PASS'
        ? null
        : executionRecommendation;

    const marketView = buildMarketView(
      marketCandidates,
      guardedFinalPick,
      engineGame
    );

    const finalDecision = buildFinalDecision(
      guardedFinalPick,
      effectiveExecutionRecommendation
    );

    const payload = buildAnalyzePayload(
      espnGame,
      engineGame,
      layerA,
      marketCandidates,
      marketView,
      finalDecision,
      guardedFinalPick,
      matchingMarketEvent,
      effectiveExecutionRecommendation
    );

    let saved: Awaited<ReturnType<typeof saveCurrentPregameLock>> | null = null;

    try {
      saved = await saveCurrentPregameLock(
        gameId,
        espnGame,
        payload
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Supabase pregame snapshot error';

      statsFetchWarning = statsFetchWarning ?? message;
    }

    let latestPick: Awaited<ReturnType<typeof getLatestPickForGame>> = null;

    try {
      latestPick = await getLatestPickForGame(gameId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Supabase pick lookup error';

      statsFetchWarning = statsFetchWarning ?? message;
    }

    let pendingPickResetAlert: string | null = null;
    const pendingPickResetReason = resolvePendingPickResetReason(
      latestPick,
      finalDecision,
      effectiveExecutionRecommendation
    );

    if (pendingPickResetReason && latestPick) {
      try {
        latestPick = await upsertPickRecord({
          gameDay: latestPick.game_day,
          gameId,
          snapshotId: saved?.snapshot.id ?? latestPick.snapshot_id ?? null,
          snapshotStage:
            saved?.stage ??
            (latestPick.snapshot_stage === 'open' ||
            latestPick.snapshot_stage === 'mid' ||
            latestPick.snapshot_stage === 'final'
              ? latestPick.snapshot_stage
              : null),
          sport: 'MLB',
          market: guardedFinalPick.market,
          selection: guardedFinalPick.selection,
          line: guardedFinalPick.line ?? null,
          odds: guardedFinalPick.odds ?? null,
          confidence: guardedFinalPick.confidence,
          estimatedProbability: guardedFinalPick.estimatedProbability ?? null,
          impliedProbability: guardedFinalPick.impliedProbability ?? null,
          edge: guardedFinalPick.edge ?? null,
          ev: guardedFinalPick.ev ?? null,
          reason: pendingPickResetReason,
          altMarket1: guardedFinalPick.altMarket1 ?? null,
          altMarket2: guardedFinalPick.altMarket2 ?? null,
          executionMarket: null,
          executionSelection: null,
          executionLine: null,
          executionOdds: null,
          executionSide: null,
          executionReason: null,
          status: 'pending',
          result: null,
          profitUnits: null
        });
        pendingPickResetAlert = pendingPickResetReason;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase pending pick reset error';

        statsFetchWarning = statsFetchWarning ?? message;
      }
    }

    if (
      !pendingPickResetReason &&
      latestPick &&
      shouldSyncConfirmedPickCanonicalFields(latestPick, guardedFinalPick)
    ) {
      try {
        latestPick = await upsertPickRecord({
          gameDay: latestPick.game_day,
          gameId,
          snapshotId: saved?.snapshot.id ?? latestPick.snapshot_id ?? null,
          snapshotStage:
            saved?.stage ??
            (latestPick.snapshot_stage === 'open' ||
            latestPick.snapshot_stage === 'mid' ||
            latestPick.snapshot_stage === 'final'
              ? latestPick.snapshot_stage
              : null),
          sport: 'MLB',
          market: guardedFinalPick.market,
          selection: guardedFinalPick.selection,
          line: guardedFinalPick.line ?? null,
          odds: guardedFinalPick.odds ?? null,
          confidence: guardedFinalPick.confidence,
          estimatedProbability: guardedFinalPick.estimatedProbability ?? null,
          impliedProbability: guardedFinalPick.impliedProbability ?? null,
          edge: guardedFinalPick.edge ?? null,
          ev: guardedFinalPick.ev ?? null,
          reason: guardedFinalPick.executionReason,
          altMarket1: guardedFinalPick.altMarket1 ?? null,
          altMarket2: guardedFinalPick.altMarket2 ?? null,
          executionMarket: latestPick.execution_market,
          executionSelection: latestPick.execution_selection,
          executionLine: latestPick.execution_line,
          executionOdds: latestPick.execution_odds,
          executionSide: latestPick.execution_side,
          executionReason: latestPick.execution_reason,
          status:
            latestPick.status === 'pending' ||
            latestPick.status === 'won' ||
            latestPick.status === 'lost' ||
            latestPick.status === 'void'
              ? latestPick.status
              : undefined,
          result: latestPick.result,
          profitUnits: latestPick.profit_units
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase pick sync error';

        statsFetchWarning = statsFetchWarning ?? message;
      }
    }

    const responseAlerts = [
      ...(saved?.alerts ?? []),
      ...(pendingPickResetAlert ? [pendingPickResetAlert] : [])
    ];

    return jsonResponseWithAudit(
      '/api/analyze',
      {
        ...payload,
        frozenPregame: false,
        statsFetchWarning,
        oddsFetchWarning,
        oddsCacheUpdatedAt,
        oddsRefreshUsed,
        confirmedPick: buildConfirmedPickSummary(latestPick),
        resultSummary: buildResultSummaryFromPick(latestPick),
        pickLock: {
          snapshotId: saved?.snapshot.id ?? null,
          stage: saved?.stage.toUpperCase() ?? 'UNSAVED',
          lastUpdatedAt: saved?.snapshot.updated_at ?? new Date().toISOString(),
          alerts: responseAlerts
        }
      },
      {
        originHint,
        gameId,
        mode: 'pregame',
        marketCandidates: marketCandidates.length,
        hasMatchingMarketEvent: Boolean(matchingMarketEvent),
        savedSnapshot: Boolean(saved?.snapshot?.id),
        savedStage: saved?.stage ?? null,
        latestPickStatus: latestPick?.status ?? null,
        responseAlerts: responseAlerts.length
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return jsonResponseWithAudit(
      '/api/analyze',
      { ok: false, error: message },
      {
        originHint: getOriginHint(req.headers),
        gameId: req.nextUrl.searchParams.get('gameId'),
        error: message
      },
      { status: 500 }
    );
  }
}
