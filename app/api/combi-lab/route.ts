import { NextRequest } from 'next/server';
import {
  getCombiPickForDay,
  getCombiStatsSummary,
  getPicksForGameDay,
  getSnapshotsByGameIdsForCombi,
  getOddsBoardCacheForDate
} from '@/lib/db';
import {
  buildCombiAlternativesPool,
  buildCombiDiagnostics,
  findReplacementCandidates,
  generateCombiFromCandidates,
  type CombiCandidate,
  type GameLinesContext
} from '@/lib/combi-engine';
import { normalizeMarketLines } from '@/lib/market-lines';
import { USER_TIMEZONE } from '@/lib/runtime-config';
import type { CombiSnapshotLight } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type EventMarketLine = ReturnType<typeof normalizeMarketLines>[number];
type BoardSourceUsed = 'none' | 'snapshot_event' | 'odds_board' | 'mixed';

function isValidDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function getTodayDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safePositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function hasConfirmedMetadata(value: unknown): boolean {
  const metadata = asRecord(value);
  return typeof metadata?.confirmedAt === 'string' && metadata.confirmedAt.trim().length > 0;
}

function normalizeEntityName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamNamesMatch(eventName: string, targetNames: string[]): boolean {
  return targetNames.some((targetName) => {
    if (!targetName) return false;
    if (eventName === targetName) return true;

    const shorter = eventName.length < targetName.length ? eventName : targetName;
    const longer = eventName.length < targetName.length ? targetName : eventName;
    return shorter.length >= 4 && longer.includes(shorter);
  });
}

function extractSnapshotTeamInfo(snapshot: CombiSnapshotLight): {
  homeTeam: string | null;
  awayTeam: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
} {
  const payload = asRecord(snapshot.payload);
  const matchingMarketEvent = asRecord(payload?.matchingMarketEvent);
  const engineGame = asRecord(payload?.engineGame);
  const homeTeam = asRecord(engineGame?.homeTeam);
  const awayTeam = asRecord(engineGame?.awayTeam);
  const homeCore = asRecord(homeTeam?.core);
  const awayCore = asRecord(awayTeam?.core);

  return {
    homeTeam:
      asString(matchingMarketEvent?.homeTeam) ??
      asString(homeCore?.teamName),
    awayTeam:
      asString(matchingMarketEvent?.awayTeam) ??
      asString(awayCore?.teamName),
    homeAbbr: asString(homeCore?.abbreviation),
    awayAbbr: asString(awayCore?.abbreviation)
  };
}

function extractSnapshotLines(snapshot: CombiSnapshotLight): unknown[] {
  const payload = asRecord(snapshot.payload);
  const matchingMarketEvent = asRecord(payload?.matchingMarketEvent);
  return asArray(matchingMarketEvent?.lines);
}

function findBoardEventForSnapshot(
  boardEvents: EventMarketLine[],
  snapshot: CombiSnapshotLight
): EventMarketLine | null {
  const teams = extractSnapshotTeamInfo(snapshot);
  const homeNames = [teams.homeTeam, teams.homeAbbr]
    .filter((value): value is string => Boolean(value))
    .map(normalizeEntityName);
  const awayNames = [teams.awayTeam, teams.awayAbbr]
    .filter((value): value is string => Boolean(value))
    .map(normalizeEntityName);

  if (!homeNames.length || !awayNames.length) return null;

  const targetStartMs = snapshot.start_time ? new Date(snapshot.start_time).getTime() : Number.NaN;
  const candidates = boardEvents.filter((event) => {
    const eventHome = normalizeEntityName(event.homeTeam);
    const eventAway = normalizeEntityName(event.awayTeam);
    return teamNamesMatch(eventHome, homeNames) && teamNamesMatch(eventAway, awayNames);
  });

  if (!candidates.length) return null;
  if (candidates.length === 1 || !Number.isFinite(targetStartMs)) return candidates[0];

  return (
    candidates
      .map((event) => {
        const eventStartMs = event.startsAt ? new Date(event.startsAt).getTime() : Number.NaN;
        const distanceMs = Number.isFinite(eventStartMs)
          ? Math.abs(eventStartMs - targetStartMs)
          : Number.POSITIVE_INFINITY;
        return { event, distanceMs };
      })
      .sort((left, right) => left.distanceMs - right.distanceMs)[0]?.event ?? candidates[0]
  );
}

function buildLinesContextMap(
  snapshots: CombiSnapshotLight[],
  boardPayload: Record<string, unknown> | null
): {
  contextMap: Map<string, GameLinesContext>;
  snapshotsMatched: number;
  oddsBoardSourceUsed: BoardSourceUsed;
  oddsBoardFound: boolean;
} {
  const boardEvents = boardPayload ? normalizeMarketLines(boardPayload as never) : [];
  const contextMap = new Map<string, GameLinesContext>();
  let usedSnapshot = 0;
  let usedBoard = 0;

  for (const snapshot of snapshots) {
    const teams = extractSnapshotTeamInfo(snapshot);
    if (!teams.homeTeam || !teams.awayTeam) continue;

    const snapshotLines = extractSnapshotLines(snapshot);
    if (snapshotLines.length) {
      contextMap.set(snapshot.game_id, {
        homeTeam: teams.homeTeam,
        awayTeam: teams.awayTeam,
        homeAbbr: teams.homeAbbr ?? '',
        awayAbbr: teams.awayAbbr ?? '',
        lines: snapshotLines as GameLinesContext['lines'],
        source: 'snapshot_event'
      });
      usedSnapshot++;
      continue;
    }

    const boardEvent = findBoardEventForSnapshot(boardEvents, snapshot);
    if (!boardEvent?.lines?.length) continue;

    contextMap.set(snapshot.game_id, {
      homeTeam: boardEvent.homeTeam || teams.homeTeam,
      awayTeam: boardEvent.awayTeam || teams.awayTeam,
      homeAbbr: teams.homeAbbr ?? '',
      awayAbbr: teams.awayAbbr ?? '',
      lines: boardEvent.lines as GameLinesContext['lines'],
      source: 'odds_board'
    });
    usedBoard++;
  }

  let oddsBoardSourceUsed: BoardSourceUsed = 'none';
  if (usedSnapshot && usedBoard) oddsBoardSourceUsed = 'mixed';
  else if (usedSnapshot) oddsBoardSourceUsed = 'snapshot_event';
  else if (usedBoard) oddsBoardSourceUsed = 'odds_board';

  return {
    contextMap,
    snapshotsMatched: contextMap.size,
    oddsBoardSourceUsed,
    oddsBoardFound: Boolean(boardPayload)
  };
}

function serializeCandidate(candidate: CombiCandidate) {
  return {
    id: candidate.id,
    gameId: candidate.gameId,
    homeTeam: candidate.homeTeam,
    awayTeam: candidate.awayTeam,
    market: candidate.market,
    selection: candidate.selection,
    line: candidate.line,
    apiOdds: candidate.apiOdds,
    confidence: candidate.confidence,
    selectionScore: candidate.selectionScore,
    estimatedProbability: candidate.estimatedProbability,
    basePickId: candidate.basePickId,
    basePickMarket: candidate.basePickMarket,
    basePickSelection: candidate.basePickSelection,
    basePickLine: candidate.basePickLine,
    altType: candidate.altType,
    conservativeDelta: candidate.conservativeDelta,
    source: candidate.source
  };
}

function serializePair(pair: ReturnType<typeof generateCombiFromCandidates>) {
  if (!pair) return null;
  return {
    leg1: serializeCandidate(pair.leg1),
    leg2: serializeCandidate(pair.leg2),
    combinedApiOdds: pair.combinedApiOdds,
    combiScore: pair.combiScore,
    inTargetRange: pair.inTargetRange
  };
}

export async function GET(req: NextRequest) {
  try {
    const dateParam = req.nextUrl.searchParams.get('date');
    const gameDay = isValidDateKey(dateParam) ? dateParam : getTodayDateKey();

    const [existing, stats] = await Promise.all([
      getCombiPickForDay(gameDay),
      getCombiStatsSummary()
    ]);
    const savedCombi = existing && hasConfirmedMetadata(existing.metadata) ? existing : null;
    const stalePendingCombi =
      existing && !hasConfirmedMetadata(existing.metadata) && existing.status === 'pending'
        ? existing
        : null;

    const allBasePicks = await getPicksForGameDay(gameDay);
    const basePicks = allBasePicks.filter((pick) => {
      const confidence = String(pick.confidence ?? '').trim().toUpperCase();
      return confidence === 'A' || confidence === 'B';
    });
    const basePickCounts = {
      basePicksFound: allBasePicks.length,
      basePicksEligibleAB: basePicks.length,
      basePicksRejectedC: allBasePicks.filter(
        (pick) => String(pick.confidence ?? '').trim().toUpperCase() === 'C'
      ).length
    };

    if (!allBasePicks.length) {
      return Response.json(
        {
          ok: true,
          combi: savedCombi,
          stalePendingCombi,
          draft: null,
          stats,
          generated: false,
          reason: 'No hay picks base del slate para este dia. Analiza los partidos primero desde la Consola.',
          debug: basePickCounts
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (basePicks.length < 2) {
      return Response.json(
        {
          ok: true,
          combi: savedCombi,
          stalePendingCombi,
          draft: null,
          stats,
          generated: false,
          reason: 'No hay suficientes picks base A/B para combi segura.',
          debug: {
            ...basePickCounts,
            alternativesGeneratedFromAB: 0,
            selectedPair: null
          }
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const gameIds = [...new Set(basePicks.map((pick) => pick.game_id))];
    const [snapshots, oddsBoardCache] = await Promise.all([
      getSnapshotsByGameIdsForCombi(gameIds),
      getOddsBoardCacheForDate(gameDay)
    ]);

    if (!snapshots.length) {
      return Response.json(
        {
          ok: true,
          combi: savedCombi,
          stalePendingCombi,
          draft: null,
          stats,
          generated: false,
          reason: 'No hay analisis de partidos disponibles para los picks del dia. Vuelve a analizar desde la Consola.'
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const boardPayload = asRecord(oddsBoardCache?.payload ?? null);
    const contextInfo = buildLinesContextMap(snapshots, boardPayload);
    const pool = buildCombiAlternativesPool(basePicks, contextInfo.contextMap);
    const bestPair = generateCombiFromCandidates(pool);

    if (req.nextUrl.searchParams.get('debug') === '1') {
      const { diagnostics } = buildCombiDiagnostics(basePicks, contextInfo.contextMap);
      const fixedCandidateId = req.nextUrl.searchParams.get('fixedCandidateId');
      const fixedRealOdds = safePositiveNumber(req.nextUrl.searchParams.get('fixedRealOdds'));
      const fixedCandidate = pool.find((candidate) => candidate.id === fixedCandidateId) ?? null;
      const replacementCandidates =
        fixedCandidate && fixedRealOdds
          ? findReplacementCandidates(fixedCandidate, pool, fixedRealOdds)
              .slice(0, 12)
              .map((replacement) => ({
                candidate: serializeCandidate(replacement.candidate),
                combinedOdds: replacement.combinedOdds,
                inTargetRange: replacement.inTargetRange,
                targetDistance: replacement.targetDistance,
                marketReliability: replacement.marketReliability,
                baseStrength: replacement.baseStrength,
                extremeLinePenalty: replacement.extremeLinePenalty,
                score: replacement.score
              }))
          : [];

      return Response.json(
        {
          ok: true,
          debug: {
            gameDay,
            snapshotsFound: snapshots.length,
            snapshotsMatched: contextInfo.snapshotsMatched,
            oddsBoardSourceUsed: contextInfo.oddsBoardSourceUsed,
            oddsBoardFound: contextInfo.oddsBoardFound,
            apiCallsMade: 0,
            hasSavedCombi: Boolean(savedCombi),
            savedCombiId: savedCombi?.id ?? null,
            draftSuggestedPairExists: Boolean(bestPair),
            ...basePickCounts,
            alternativesGeneratedFromAB: pool.length,
            ...diagnostics,
            basePicksFound: basePickCounts.basePicksFound,
            basePicksEligibleAB: basePickCounts.basePicksEligibleAB,
            basePicksRejectedC: basePickCounts.basePicksRejectedC,
            suggestedPair: serializePair(bestPair),
            alternativesPool: pool.map(serializeCandidate),
            replacementCandidates
          }
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (!bestPair) {
      const reason =
        pool.length === 0
          ? 'No se encontraron alternativas conservadoras reales en snapshot/cache para los picks del dia.'
          : `Se encontraron ${pool.length} candidato${pool.length === 1 ? '' : 's'} pero ningun par valido de juegos distintos.`;

      return Response.json(
        {
          ok: true,
          combi: savedCombi,
          stalePendingCombi,
          draft: null,
          stats,
          generated: false,
          reason,
          debug: {
            ...basePickCounts,
            alternativesGeneratedFromAB: pool.length,
            selectedPair: null
          }
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const diagnosticsPack = buildCombiDiagnostics(basePicks, contextInfo.contextMap);

    return Response.json(
      {
        ok: true,
        combi: savedCombi,
        stalePendingCombi,
        stats,
        generated: !savedCombi,
        draft: {
          gameDay,
          targetRange: [1.65, 1.85],
          alternativesPoolCount: pool.length,
          candidatePairsCount: diagnosticsPack.diagnostics.candidatePairsCount,
          basePicksFound: basePickCounts.basePicksFound,
          basePicksEligibleAB: basePickCounts.basePicksEligibleAB,
          basePicksRejectedC: basePickCounts.basePicksRejectedC,
          alternativesGeneratedFromAB: pool.length,
          bestPairBeforeManualEdit: serializePair(bestPair),
          suggestedPair: serializePair(bestPair),
          alternativesPool: pool.map(serializeCandidate)
        }
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown combi-lab error'
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' }
      }
    );
  }
}
