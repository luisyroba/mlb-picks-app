import { NextRequest, NextResponse } from 'next/server';
import {
  getLatestMarketSnapshotsByGameIds,
  getPregameSnapshotMetadataByIds,
  listConfirmedPicksForLedger,
  type MarketSnapshotRow,
  type PickLedgerRow,
  type PregameSnapshotMetadataRow
} from '@/lib/db';
import { resolveMatchupLabel } from '@/lib/matchup-label';
import { expectedValue, impliedProbability } from '@/lib/probability-model';
import { LIVE_STATS_CUTOFF_DATE_KEY, formatDateKeyForTimezone } from '@/lib/runtime-config';

const CACHE_CONTROL = 'no-store';
const TEMPORARY_SUPABASE_MESSAGE =
  'Supabase temporalmente no respondió. Reintenta en unos segundos.';

type DebugInfo = {
  rangeStart: string;
  rangeEnd: string;
  activeMode: string;
  totalRows: number;
  queryMs: number;
  hydrateMs: number;
  missingTeamNamesCount: number;
  sampleMissingGameIds: string[];
  duplicateGameIds: string[];
  newestUpdatedAt: string | null;
  cacheControl: string;
  supabaseRetryCount: number;
  supabaseErrorCode: string | null;
};

function roundOdds(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function isValidDateKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getSundayOnOrAfterDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const daysUntilSunday = (7 - date.getUTCDay()) % 7;
  return addDaysToDateKey(dateKey, daysUntilSunday);
}

function getMondayOnOrBeforeDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addDaysToDateKey(dateKey, -daysSinceMonday);
}

function resolveRange(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const today = formatDateKeyForTimezone(0, { dashed: true });
  const activeAnchor = today || LIVE_STATS_CUTOFF_DATE_KEY;
  const defaultStart = getMondayOnOrBeforeDateKey(activeAnchor);
  const defaultEnd = getSundayOnOrAfterDateKey(activeAnchor);
  const startDate = params.get('startDate');
  const endDate = params.get('endDate');

  return {
    rangeStart: isValidDateKey(startDate) ? startDate : defaultStart,
    rangeEnd: isValidDateKey(endDate) ? endDate : defaultEnd,
    activeMode: params.get('mode') || 'live'
  };
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
  const effectiveImplied = getEffectiveImpliedProbability(pick);

  if (estimatedProbability !== null && effectiveImplied !== null) {
    return estimatedProbability - effectiveImplied;
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

function parseAutoResult(result?: string | null): {
  market: string;
  awayRuns: number;
  homeRuns: number;
} | null {
  if (!result) return null;

  const match = /^AUTO_(?:WON|LOST|VOID)\s+([A-Z0-9]+)\s+(\d+)-(\d+)$/i.exec(result.trim());
  if (!match) return null;

  return {
    market: match[1].toUpperCase(),
    awayRuns: Number(match[2]),
    homeRuns: Number(match[3])
  };
}

function buildFinalScoreLabel(
  marketSnapshot: MarketSnapshotRow | null,
  result?: string | null
): string | null {
  const parsed = parseAutoResult(result);
  if (!parsed) return null;

  const awayLabel = marketSnapshot?.away_team || 'Away';
  const homeLabel = marketSnapshot?.home_team || 'Home';
  const prefix = parsed.market === 'F5' ? 'F5' : 'Final';

  return `${prefix}: ${awayLabel} ${parsed.awayRuns} - ${homeLabel} ${parsed.homeRuns}`;
}

function getGameDate(
  gameDay?: string | null,
  snapshotStartTime?: string | null,
  fallback?: string | null
): string | null {
  if (gameDay) return gameDay;
  if (snapshotStartTime) return snapshotStartTime;
  return fallback ?? null;
}

function dedupePicks(rows: PickLedgerRow[]) {
  const byKey = new Map<string, PickLedgerRow>();
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = `${String(row.game_id ?? '').trim()}:${row.game_day ?? 'sin-dia'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }

  return {
    picks: [...byKey.values()],
    duplicateGameIds: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key.split(':')[0])
      .filter(Boolean)
  };
}

function getSupabaseErrorCode(error: unknown): string | null {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const code = record?.code ?? record?.status ?? record?.statusCode;
  if (typeof code === 'string' || typeof code === 'number') return String(code);

  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/\b521\b|web server is down|cloudflare/i.test(message)) return '521';
  if (/timeout|timed out|fetch failed|network/i.test(message)) return 'NETWORK';
  return null;
}

function isRetryableSupabaseError(error: unknown) {
  const code = getSupabaseErrorCode(error);
  return code === '521' || code === 'NETWORK';
}

async function withReadRetry<T>(fn: () => Promise<T>, onRetry: () => void): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isRetryableSupabaseError(error)) throw error;
    onRetry();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return fn();
  }
}

function temporarySupabaseResponse(debug: boolean, debugInfo: Partial<DebugInfo>, error: unknown) {
  const payload = {
    ok: false,
    error: 'SUPABASE_TEMPORARY_UNAVAILABLE',
    message: TEMPORARY_SUPABASE_MESSAGE,
    retryable: true,
    ...(debug
      ? {
          debug: {
            ...debugInfo,
            supabaseErrorCode: getSupabaseErrorCode(error)
          }
        }
      : {})
  };

  return NextResponse.json(payload, {
    status: 503,
    headers: { 'Cache-Control': CACHE_CONTROL }
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const debug = req.nextUrl.searchParams.get('debug') === '1';
  const { rangeStart, rangeEnd, activeMode } = resolveRange(req);
  let queryMs = 0;
  let hydrateMs = 0;
  let supabaseRetryCount = 0;

  try {
    const queryStartedAt = Date.now();
    const rawData = await withReadRetry(
      () =>
        listConfirmedPicksForLedger({
          startDate: rangeStart,
          endDate: rangeEnd,
          limit: 500
        }),
      () => {
        supabaseRetryCount += 1;
      }
    );
    queryMs = Date.now() - queryStartedAt;

    const { picks: data, duplicateGameIds } = dedupePicks(Array.isArray(rawData) ? rawData : []);

    const hydrateStartedAt = Date.now();
    const snapshotIds = [
      ...new Set(
        data
          .map((pick) => pick.snapshot_id ?? '')
          .filter((snapshotId): snapshotId is string => Boolean(snapshotId))
      )
    ];
    const gameIds = [
      ...new Set(
        data
          .map((pick) => String(pick.game_id ?? '').trim())
          .filter(Boolean)
      )
    ];

    const [snapshotsById, marketSnapshotsByGameId] = await Promise.all([
      withReadRetry(
        () => getPregameSnapshotMetadataByIds(snapshotIds),
        () => {
          supabaseRetryCount += 1;
        }
      ).catch(() => new Map<string, PregameSnapshotMetadataRow>()),
      withReadRetry(
        () => getLatestMarketSnapshotsByGameIds(gameIds),
        () => {
          supabaseRetryCount += 1;
        }
      ).catch(() => new Map<string, MarketSnapshotRow>())
    ]);
    hydrateMs = Date.now() - hydrateStartedAt;

    const missingTeamNameGameIds: string[] = [];
    const picks = data.map((pick) => {
      const snapshot = pick.snapshot_id ? snapshotsById.get(pick.snapshot_id) ?? null : null;
      const marketSnapshot = marketSnapshotsByGameId.get(String(pick.game_id ?? '')) ?? null;
      const hasTeamNames = Boolean(marketSnapshot?.home_team && marketSnapshot.away_team);
      const gameLabel = resolveMatchupLabel({
        snapshotPayload: null,
        marketSnapshot,
        gameId: String(pick.game_id ?? ''),
        pendingLabel: 'Matchup pendiente',
        allowGameIdFallback: false
      });

      if (!hasTeamNames) {
        missingTeamNameGameIds.push(String(pick.game_id ?? ''));
      }

      return {
        id: pick.id,
        gameId: pick.game_id,
        gameLabel: gameLabel || 'Matchup pendiente',
        market: pick.market,
        confidence: pick.confidence,
        executionMarket: pick.execution_market,
        executionOdds: roundOdds(pick.execution_odds),
        modelOdds: roundOdds(pick.odds),
        displayTitle: buildExecutionTitle(pick as Record<string, unknown>),
        edge: roundMetric(getEffectiveEdge(pick as Record<string, unknown>)),
        ev: roundMetric(getEffectiveEv(pick as Record<string, unknown>)),
        status: pick.status,
        finalScoreLabel: buildFinalScoreLabel(marketSnapshot, pick.result),
        profitUnits: roundMetric(pick.profit_units),
        reason: pick.execution_reason || pick.reason,
        gameDay: pick.game_day ?? null,
        gameDate: getGameDate(pick.game_day ?? null, snapshot?.start_time ?? null, pick.created_at),
        createdAt: pick.created_at,
        updatedAt: pick.updated_at
      };
    });

    picks.sort((left, right) => {
      const leftMs = new Date(String(left.gameDate ?? left.createdAt ?? '')).getTime();
      const rightMs = new Date(String(right.gameDate ?? right.createdAt ?? '')).getTime();
      return rightMs - leftMs;
    });

    const newestUpdatedAt =
      data
        .map((pick) => pick.updated_at)
        .filter(Boolean)
        .sort((left, right) => String(right).localeCompare(String(left)))[0] ?? null;

    const debugInfo: DebugInfo = {
      rangeStart,
      rangeEnd,
      activeMode,
      totalRows: rawData.length,
      queryMs,
      hydrateMs,
      missingTeamNamesCount: missingTeamNameGameIds.length,
      sampleMissingGameIds: [...new Set(missingTeamNameGameIds)].slice(0, 10),
      duplicateGameIds: [...new Set(duplicateGameIds)],
      newestUpdatedAt,
      cacheControl: CACHE_CONTROL,
      supabaseRetryCount,
      supabaseErrorCode: null
    };

    return NextResponse.json(
      {
        ok: true,
        picks,
        ...(debug ? { debug: { ...debugInfo, totalMs: Date.now() - startedAt } } : {})
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } }
    );
  } catch (error) {
    if (isRetryableSupabaseError(error)) {
      return temporarySupabaseResponse(
        debug,
        {
          rangeStart,
          rangeEnd,
          activeMode,
          totalRows: 0,
          queryMs,
          hydrateMs,
          cacheControl: CACHE_CONTROL,
          supabaseRetryCount
        },
        error
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        ok: false,
        error: message,
        ...(debug
          ? {
              debug: {
                rangeStart,
                rangeEnd,
                activeMode,
                totalRows: 0,
                queryMs,
                hydrateMs,
                cacheControl: CACHE_CONTROL,
                supabaseRetryCount,
                supabaseErrorCode: getSupabaseErrorCode(error)
              }
            }
          : {})
      },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL } }
    );
  }
}
