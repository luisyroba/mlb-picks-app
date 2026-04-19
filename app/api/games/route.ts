import { NextRequest, NextResponse } from 'next/server';
import {
  getPregameSnapshotsForGames,
  listConfirmedPicksByGameIds
} from '@/lib/db';

const ESPN_MLB_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const ESPN_SCOREBOARD_TIMEOUT_MS = 8000;

type EspnScoreboardCompetitor = {
  homeAway?: 'home' | 'away' | string;
  team?: {
    displayName?: string;
    abbreviation?: string;
    logo?: string;
    color?: string;
    alternateColor?: string;
  };
  score?: string;
  records?: Array<{ summary?: string; displayValue?: string }>;
  linescores?: Array<{
    value?: number;
    displayValue?: string;
    period?: number;
  }>;
  statistics?: Array<{
    name?: string;
    abbreviation?: string;
    displayValue?: string;
  }>;
};

type EspnScoreboardEvent = {
  id?: string;
  date?: string;
  name?: string;
  shortName?: string;
  status?: {
    type?: {
      description?: string;
      shortDetail?: string;
      detail?: string;
      state?: string;
      completed?: boolean;
    };
  };
  competitions?: Array<{
    competitors?: EspnScoreboardCompetitor[];
    status?: {
      type?: {
        description?: string;
        shortDetail?: string;
        detail?: string;
        state?: string;
        completed?: boolean;
      };
    };
  }>;
};

type EspnScoreboardResponse = {
  events?: EspnScoreboardEvent[];
};

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function getRecordSummary(competitor?: EspnScoreboardCompetitor): string | null {
  const record = competitor?.records?.find((item) => safeString(item.summary) || safeString(item.displayValue));
  return safeString(record?.summary) || safeString(record?.displayValue);
}

function getStatDisplay(
  competitor: EspnScoreboardCompetitor | undefined,
  abbreviation: string
): string | null {
  const stat = competitor?.statistics?.find(
    (item) => String(item.abbreviation ?? '').toUpperCase() === abbreviation.toUpperCase()
  );
  return safeString(stat?.displayValue);
}

function getLineScores(competitor?: EspnScoreboardCompetitor): string[] {
  return (competitor?.linescores ?? []).map((line) => safeString(line.displayValue) ?? '-');
}

function getGamePriority(state?: string, completed?: boolean) {
  if (state === 'in') return 0;
  if (!completed && state === 'pre') return 1;
  if (!completed) return 2;
  return 3;
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date');
    const url = date
      ? `${ESPN_MLB_SCOREBOARD}?dates=${encodeURIComponent(date)}`
      : ESPN_MLB_SCOREBOARD;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPN_SCOREBOARD_TIMEOUT_MS)
    });

    if (!res.ok) {
      throw new Error(`ESPN scoreboard request failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as EspnScoreboardResponse;
    const events = json.events ?? [];
    const gameIds = events
      .map((event) => String(event.id ?? '').trim())
      .filter((gameId) => Boolean(gameId));

    const [picksRes, snapshotsRes] = await Promise.allSettled([
      listConfirmedPicksByGameIds(gameIds),
      getPregameSnapshotsForGames(gameIds)
    ]);

    const picks = picksRes.status === 'fulfilled' ? picksRes.value : [];
    const snapshotsByGameId =
      snapshotsRes.status === 'fulfilled' ? snapshotsRes.value : new Map();
    const picksByGameId = new Map(
      picks.map((pick) => [
        pick.game_id,
        {
          analyzed: true,
          hasActivePick: true,
          status: pick.status,
          confidence: pick.confidence,
          selection: pick.execution_selection || pick.selection,
          market: pick.execution_market || pick.market,
          line:
            typeof pick.execution_line === 'number'
              ? pick.execution_line
              : typeof pick.line === 'number'
                ? pick.line
                : null,
          odds:
            typeof pick.execution_odds === 'number'
              ? pick.execution_odds
              : typeof pick.odds === 'number'
                ? pick.odds
                : null,
          probability: safeNumber(pick.estimated_probability),
          edge:
            typeof pick.execution_odds === 'number' &&
            Number.isFinite(pick.execution_odds) &&
            typeof pick.estimated_probability === 'number' &&
            Number.isFinite(pick.estimated_probability)
              ? safeNumber(pick.estimated_probability - 1 / pick.execution_odds)
              : safeNumber(pick.edge),
          ev: safeNumber(pick.ev),
          updatedAt: pick.updated_at
        }
      ])
    );

    const games = await Promise.all(
      events.map(async (event) => {
        const competition = event.competitions?.[0];
        const competitors = competition?.competitors ?? [];
        const home = competitors.find((competitor) => competitor.homeAway === 'home') ?? competitors[0];
        const away =
          competitors.find((competitor) => competitor.homeAway === 'away') ??
          competitors.find((competitor) => competitor !== home) ??
          competitors[1];

        const pickAnalysis = picksByGameId.get(event.id ?? '');
        const snapshotState =
          event.id
            ? snapshotsByGameId.get(event.id) ?? { open: null, mid: null, final: null }
            : { open: null, mid: null, final: null };
        const latestSnapshot =
          snapshotState.final ?? snapshotState.mid ?? snapshotState.open ?? null;
        const snapshotPayload =
          latestSnapshot?.payload && typeof latestSnapshot.payload === 'object'
            ? (latestSnapshot.payload as Record<string, unknown>)
            : null;
        const snapshotFinalPick =
          snapshotPayload?.finalPick && typeof snapshotPayload.finalPick === 'object'
            ? (snapshotPayload.finalPick as Record<string, unknown>)
            : null;
        const snapshotFinalDecision =
          snapshotPayload?.finalDecision && typeof snapshotPayload.finalDecision === 'object'
            ? (snapshotPayload.finalDecision as Record<string, unknown>)
            : null;

        const statusType = competition?.status?.type ?? event.status?.type;
        const snapshotMarket = safeString(snapshotFinalPick?.market);
        const snapshotSelection = safeString(snapshotFinalPick?.selection);
        const snapshotDecisionStatus = safeString(snapshotFinalDecision?.status);
        const isSnapshotNoBet =
          snapshotDecisionStatus === 'NO_BET' ||
          snapshotMarket?.toUpperCase() === 'PASS' ||
          snapshotSelection?.toUpperCase() === 'NO BET';

        return {
          gameId: event.id ?? '',
          date: event.date ?? null,
          name: event.name ?? '',
          shortName: event.shortName ?? '',
          status: statusType?.description ?? 'Unknown',
          statusDetail: statusType?.shortDetail ?? statusType?.detail ?? statusType?.description ?? 'Sin detalle',
          state: statusType?.state ?? 'pre',
          completed: Boolean(statusType?.completed),
          innings: Math.max(getLineScores(home).length, getLineScores(away).length),
          homeTeam: {
            name: home?.team?.displayName ?? 'HOME',
            abbr: home?.team?.abbreviation ?? 'HOME',
            logo: home?.team?.logo ?? null,
            color: home?.team?.color ?? null,
            alternateColor: home?.team?.alternateColor ?? null,
            score: home?.score ?? null,
            record: getRecordSummary(home),
            linescores: getLineScores(home),
            hits: getStatDisplay(home, 'H'),
            errors: getStatDisplay(home, 'E')
          },
          awayTeam: {
            name: away?.team?.displayName ?? 'AWAY',
            abbr: away?.team?.abbreviation ?? 'AWAY',
            logo: away?.team?.logo ?? null,
            color: away?.team?.color ?? null,
            alternateColor: away?.team?.alternateColor ?? null,
            score: away?.score ?? null,
            record: getRecordSummary(away),
            linescores: getLineScores(away),
            hits: getStatDisplay(away, 'H'),
            errors: getStatDisplay(away, 'E')
          },
          analysis:
            pickAnalysis ??
            (latestSnapshot
              ? {
                  analyzed: true,
                  hasActivePick: false,
                  status: isSnapshotNoBet ? 'no_bet' : 'analyzed',
                  confidence: isSnapshotNoBet ? null : safeString(snapshotFinalPick?.confidence),
                  selection: isSnapshotNoBet ? null : safeString(snapshotFinalPick?.selection),
                  market: isSnapshotNoBet ? null : safeString(snapshotFinalPick?.market),
                  line:
                    isSnapshotNoBet
                      ? null
                      : typeof snapshotFinalPick?.line === 'number'
                        ? snapshotFinalPick.line
                        : null,
                  odds:
                    isSnapshotNoBet
                      ? null
                      : typeof snapshotFinalPick?.odds === 'number'
                        ? snapshotFinalPick.odds
                        : null,
                  probability:
                    isSnapshotNoBet
                      ? null
                      : safeNumber(snapshotFinalPick?.estimatedProbability),
                  edge:
                    isSnapshotNoBet
                      ? null
                      : safeNumber(snapshotFinalPick?.edge),
                  ev:
                    isSnapshotNoBet
                      ? null
                      : safeNumber(snapshotFinalPick?.ev),
                  updatedAt: latestSnapshot.updated_at
                }
              : {
                  analyzed: false,
                  hasActivePick: false,
                  status: 'new',
                  confidence: null,
                  selection: null,
                  market: null,
                  line: null,
                  odds: null,
                  probability: null,
                  edge: null,
                  ev: null,
                  updatedAt: null
                })
        };
      })
    );

    games.sort((left, right) => {
      const priorityDiff =
        getGamePriority(left.state, left.completed) - getGamePriority(right.state, right.completed);
      if (priorityDiff !== 0) return priorityDiff;

      const leftDate = new Date(left.date ?? '').getTime();
      const rightDate = new Date(right.date ?? '').getTime();
      if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
        return leftDate - rightDate;
      }

      return left.name.localeCompare(right.name);
    });

    return NextResponse.json({
      ok: true,
      games
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
