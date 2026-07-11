import { NextRequest } from 'next/server';
import { getOriginHint, jsonResponseWithAudit } from '@/lib/api-egress-audit';
import { formatDateKeyForTimezone } from '@/lib/runtime-config';

export const dynamic = 'force-dynamic';

const ESPN_MLB_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const ESPN_SCOREBOARD_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 3;

type EspnScoreboardEvent = {
  id?: string;
  name?: string;
  shortName?: string;
  date?: string;
  status?: {
    type?: {
      state?: string;
      completed?: boolean;
      description?: string;
      shortDetail?: string;
      detail?: string;
    };
  };
  competitions?: Array<{
    status?: {
      type?: {
        state?: string;
        completed?: boolean;
        description?: string;
        shortDetail?: string;
        detail?: string;
      };
    };
  }>;
};

type EspnScoreboardResponse = {
  events?: EspnScoreboardEvent[];
};

type AnalyzeSlateResult = {
  gameId: string;
  name: string | null;
  state: string | null;
  statusDetail: string | null;
  ok: boolean;
  market: string | null;
  selection: string | null;
  pendingManualOdds: boolean;
  deferredAutoSave: boolean;
  autoSaved: boolean;
  noBet: boolean;
  alerts: string[];
  error: string | null;
};

function normalizeDateParam(value: string | null): string {
  const fallback = formatDateKeyForTimezone(0);
  if (!value) return fallback;

  const compact = value.replace(/[^\d]/g, '');

  return compact.length === 8 ? compact : fallback;
}

function clampConcurrency(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;

  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(parsed)));
}

function getStatusType(event: EspnScoreboardEvent) {
  return event.competitions?.[0]?.status?.type ?? event.status?.type ?? null;
}

function getEventGameId(event: EspnScoreboardEvent): string | null {
  const gameId = String(event.id ?? '').trim();

  return gameId ? gameId : null;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.SLATE_ANALYZE_SECRET;

  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }

  const auth = req.headers.get('authorization');
  const tokenFromHeader = auth?.replace(/^Bearer\s+/i, '').trim();
  const tokenFromQuery = req.nextUrl.searchParams.get('secret')?.trim();

  return tokenFromHeader === secret || tokenFromQuery === secret;
}

async function fetchScoreboard(dateKey: string): Promise<EspnScoreboardEvent[]> {
  const url = `${ESPN_MLB_SCOREBOARD}?dates=${encodeURIComponent(dateKey)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(ESPN_SCOREBOARD_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(
      `ESPN scoreboard request failed: ${response.status} ${response.statusText}`
    );
  }

  const json = (await response.json()) as EspnScoreboardResponse;

  return json.events ?? [];
}

function extractPickSummary(
  json: Record<string, unknown>
): Pick<
  AnalyzeSlateResult,
  | 'market'
  | 'selection'
  | 'pendingManualOdds'
  | 'deferredAutoSave'
  | 'autoSaved'
  | 'noBet'
  | 'alerts'
> {
  const finalPick =
    json.finalPick && typeof json.finalPick === 'object'
      ? (json.finalPick as Record<string, unknown>)
      : null;
  const confirmedPick =
    json.confirmedPick && typeof json.confirmedPick === 'object'
      ? (json.confirmedPick as Record<string, unknown>)
      : null;
  const pickLock =
    json.pickLock && typeof json.pickLock === 'object'
      ? (json.pickLock as Record<string, unknown>)
      : null;
  const alerts = Array.isArray(pickLock?.alerts)
    ? pickLock.alerts.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0
      )
    : [];
  const market =
    typeof finalPick?.market === 'string'
      ? finalPick.market
      : typeof confirmedPick?.market === 'string'
        ? confirmedPick.market
        : null;
  const selection =
    typeof finalPick?.selection === 'string'
      ? finalPick.selection
      : typeof confirmedPick?.selection === 'string'
        ? confirmedPick.selection
        : null;

  return {
    market,
    selection,
    pendingManualOdds: alerts.some((alert) =>
      alert.toLowerCase().includes('pendiente de confirmar cuota manual')
    ),
    deferredAutoSave: alerts.some((alert) =>
      alert.toLowerCase().includes('auto-save diferido')
    ),
    autoSaved: alerts.some((alert) =>
      alert.toLowerCase().includes('guardado automaticamente')
    ),
    noBet:
      String(market ?? '').toUpperCase() === 'PASS' ||
      String(selection ?? '').toUpperCase() === 'NO BET',
    alerts
  };
}

async function analyzeGame(
  req: NextRequest,
  event: EspnScoreboardEvent
): Promise<AnalyzeSlateResult> {
  const gameId = getEventGameId(event);
  const statusType = getStatusType(event);

  if (!gameId) {
    return {
      gameId: '',
      name: event.name ?? event.shortName ?? null,
      state: statusType?.state ?? null,
      statusDetail:
        statusType?.shortDetail ??
        statusType?.detail ??
        statusType?.description ??
        null,
      ok: false,
      market: null,
      selection: null,
      pendingManualOdds: false,
      deferredAutoSave: false,
      autoSaved: false,
      noBet: false,
      alerts: [],
      error: 'Missing ESPN game id'
    };
  }

  const analyzeUrl = new URL('/api/analyze', req.nextUrl.origin);
  analyzeUrl.searchParams.set('gameId', gameId);

  try {
    const response = await fetch(analyzeUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-origin-hint': 'slate-auto-save'
      },
      cache: 'no-store'
    });
    const json = (await response.json()) as Record<string, unknown>;
    const summary = extractPickSummary(json);

    return {
      gameId,
      name: event.name ?? event.shortName ?? null,
      state: statusType?.state ?? null,
      statusDetail:
        statusType?.shortDetail ??
        statusType?.detail ??
        statusType?.description ??
        null,
      ok: response.ok && json.error === undefined,
      ...summary,
      error:
        typeof json.error === 'string'
          ? json.error
          : response.ok
            ? null
            : `Analyze request failed: ${response.status}`
    };
  } catch (error) {
    return {
      gameId,
      name: event.name ?? event.shortName ?? null,
      state: statusType?.state ?? null,
      statusDetail:
        statusType?.shortDetail ??
        statusType?.detail ??
        statusType?.description ??
        null,
      ok: false,
      market: null,
      selection: null,
      pendingManualOdds: false,
      deferredAutoSave: false,
      autoSaved: false,
      noBet: false,
      alerts: [],
      error: error instanceof Error ? error.message : 'Unknown analyze error'
    };
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<AnalyzeSlateResult>
): Promise<AnalyzeSlateResult[]> {
  const results: AnalyzeSlateResult[] = [];
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => next())
  );

  return results;
}

async function handleAnalyzeSlate(req: NextRequest) {
  const originHint = getOriginHint(req.headers);
  const dateKey = normalizeDateParam(req.nextUrl.searchParams.get('date'));
  const includeStarted = req.nextUrl.searchParams.get('includeStarted') === '1';
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
  const concurrency = clampConcurrency(req.nextUrl.searchParams.get('concurrency'));

  if (!isAuthorized(req)) {
    return jsonResponseWithAudit(
      '/api/analyze-slate',
      {
        ok: false,
        error:
          'Unauthorized. Set SLATE_ANALYZE_SECRET and call with Authorization: Bearer <secret>.'
      },
      {
        originHint,
        dateKey,
        authorized: false
      },
      { status: 401 }
    );
  }

  try {
    const events = await fetchScoreboard(dateKey);
    const targetEvents = events.filter((event) => {
      const gameId = getEventGameId(event);
      const statusType = getStatusType(event);

      if (!gameId || statusType?.completed) return false;
      if (includeStarted) return statusType?.state !== 'post';

      return statusType?.state === 'pre';
    });
    const results = dryRun
      ? targetEvents.map((event): AnalyzeSlateResult => {
          const statusType = getStatusType(event);
          return {
            gameId: getEventGameId(event) ?? '',
            name: event.name ?? event.shortName ?? null,
            state: statusType?.state ?? null,
            statusDetail:
              statusType?.shortDetail ??
              statusType?.detail ??
              statusType?.description ??
              null,
            ok: true,
            market: null,
            selection: null,
            pendingManualOdds: false,
            deferredAutoSave: false,
            autoSaved: false,
            noBet: false,
            alerts: ['Dry run: no se llamo /api/analyze'],
            error: null
          };
        })
      : await runWithConcurrency(targetEvents, concurrency, (event) =>
          analyzeGame(req, event)
        );
    const okResults = results.filter((result) => result.ok);
    const failedResults = results.filter((result) => !result.ok);
    const f5PendingManualOdds = results.filter(
      (result) => result.pendingManualOdds
    );
    const deferredAutoSave = results.filter(
      (result) => result.deferredAutoSave
    );
    const autoSaved = results.filter((result) => result.autoSaved);
    const noBet = results.filter((result) => result.noBet);

    return jsonResponseWithAudit(
      '/api/analyze-slate',
      {
        ok: failedResults.length === 0,
        dateKey,
        dryRun,
        includeStarted,
        concurrency,
        summary: {
          scoreboardEvents: events.length,
          targetedGames: targetEvents.length,
          analyzedGames: okResults.length,
          failedGames: failedResults.length,
          autoSaved: autoSaved.length,
          deferredAutoSave: deferredAutoSave.length,
          f5PendingManualOdds: f5PendingManualOdds.length,
          noBet: noBet.length
        },
        results
      },
      {
        originHint,
        dateKey,
        dryRun,
        includeStarted,
        concurrency,
        scoreboardEvents: events.length,
        targetedGames: targetEvents.length,
        analyzedGames: okResults.length,
        failedGames: failedResults.length,
        autoSaved: autoSaved.length,
        deferredAutoSave: deferredAutoSave.length,
        f5PendingManualOdds: f5PendingManualOdds.length,
        noBet: noBet.length
      },
      { status: failedResults.length ? 207 : 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown analyze slate error';

    return jsonResponseWithAudit(
      '/api/analyze-slate',
      { ok: false, error: message },
      {
        originHint,
        dateKey,
        dryRun,
        includeStarted,
        concurrency,
        error: message
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleAnalyzeSlate(req);
}

export async function POST(req: NextRequest) {
  return handleAnalyzeSlate(req);
}
