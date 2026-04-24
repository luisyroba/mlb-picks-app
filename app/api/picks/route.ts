import { NextResponse } from 'next/server';
import {
  listConfirmedPicksForLedger,
  getPregameSnapshotsByIds
} from '@/lib/db';
import { fetchEspnMlbSummary } from '@/lib/espn';
import { resolveMatchupLabel } from '@/lib/matchup-label';
import { expectedValue, impliedProbability } from '@/lib/probability-model';

function roundOdds(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function getEffectiveImpliedProbability(pick: Record<string, unknown>): number | null {
  const executionOdds =
    typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
      ? pick.execution_odds
      : null;

  if (executionOdds && executionOdds > 1) {
    return impliedProbability(executionOdds);
  }

  const stored =
    typeof pick.implied_probability === 'number' && Number.isFinite(pick.implied_probability)
      ? pick.implied_probability
      : null;

  return stored;
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

function getTeamIdentity(snapshotPayload: Record<string, unknown> | null): {
  homeName: string | null;
  awayName: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
} {
  const engineGame =
    snapshotPayload?.engineGame && typeof snapshotPayload.engineGame === 'object'
      ? (snapshotPayload.engineGame as Record<string, unknown>)
      : null;
  const homeTeam =
    engineGame?.homeTeam && typeof engineGame.homeTeam === 'object'
      ? (engineGame.homeTeam as Record<string, unknown>)
      : null;
  const awayTeam =
    engineGame?.awayTeam && typeof engineGame.awayTeam === 'object'
      ? (engineGame.awayTeam as Record<string, unknown>)
      : null;
  const homeCore =
    homeTeam?.core && typeof homeTeam.core === 'object'
      ? (homeTeam.core as Record<string, unknown>)
      : null;
  const awayCore =
    awayTeam?.core && typeof awayTeam.core === 'object'
      ? (awayTeam.core as Record<string, unknown>)
      : null;

  return {
    homeName: typeof homeCore?.teamName === 'string' ? homeCore.teamName : null,
    awayName: typeof awayCore?.teamName === 'string' ? awayCore.teamName : null,
    homeAbbr: typeof homeCore?.abbreviation === 'string' ? homeCore.abbreviation : null,
    awayAbbr: typeof awayCore?.abbreviation === 'string' ? awayCore.abbreviation : null
  };
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

function isManualSettledTotalPick(pick: Record<string, unknown>, result?: string | null): boolean {
  const market = String(pick.execution_market ?? pick.market ?? '').trim().toUpperCase();
  const status = String(pick.status ?? '').trim().toLowerCase();

  return (
    market === 'TOTAL' &&
    (status === 'won' || status === 'lost') &&
    /^MANUAL_(WON|LOST)$/i.test(String(result ?? '').trim())
  );
}

function readSummaryScore(competitor: unknown): number | null {
  if (!competitor || typeof competitor !== 'object') return null;

  const score = (competitor as { score?: unknown }).score;
  if (typeof score === 'number' && Number.isFinite(score)) {
    return score;
  }

  if (typeof score === 'string') {
    const parsed = Number(score);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseFinalScoreFromSummary(summary: unknown): {
  awayRuns: number;
  homeRuns: number;
} | null {
  if (!summary || typeof summary !== 'object') return null;

  const header = (summary as { header?: unknown }).header;
  if (!header || typeof header !== 'object') return null;

  const competitions = (header as { competitions?: unknown[] }).competitions;
  const competition = Array.isArray(competitions) ? competitions[0] : null;
  if (!competition || typeof competition !== 'object') return null;

  const competitionStatusType = (competition as { status?: { type?: unknown } }).status?.type;
  const headerStatusType = (header as { status?: { type?: unknown } }).status?.type;
  const statusType =
    (competitionStatusType ?? headerStatusType) as {
      completed?: unknown;
      state?: unknown;
      description?: unknown;
      detail?: unknown;
      shortDetail?: unknown;
    } | undefined;

  const statusText = [
    statusType?.description,
    statusType?.detail,
    statusType?.shortDetail
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();

  const isFinal =
    Boolean(statusType?.completed) ||
    String(statusType?.state ?? '').toLowerCase() === 'post' ||
    statusText.includes('final') ||
    statusText.includes('game over') ||
    statusText.includes('completed early');

  if (!isFinal) {
    return null;
  }

  const competitors = (competition as { competitors?: unknown[] }).competitors;
  if (!Array.isArray(competitors)) return null;

  const away = competitors.find((competitor) =>
    competitor &&
    typeof competitor === 'object' &&
    (competitor as { homeAway?: unknown }).homeAway === 'away'
  );
  const home = competitors.find((competitor) =>
    competitor &&
    typeof competitor === 'object' &&
    (competitor as { homeAway?: unknown }).homeAway === 'home'
  );

  const awayRuns = readSummaryScore(away);
  const homeRuns = readSummaryScore(home);

  if (awayRuns === null || homeRuns === null) {
    return null;
  }

  return { awayRuns, homeRuns };
}

function buildFinalScoreLabel(
  snapshotPayload: Record<string, unknown> | null,
  result?: string | null,
  fallbackFinalScore?: { awayRuns: number; homeRuns: number } | null
): string | null {
  const parsed =
    parseAutoResult(result) ??
    (fallbackFinalScore
      ? {
          market: 'TOTAL',
          awayRuns: fallbackFinalScore.awayRuns,
          homeRuns: fallbackFinalScore.homeRuns
        }
      : null);
  if (!parsed) return null;

  const identity = getTeamIdentity(snapshotPayload);
  const awayLabel = identity.awayAbbr || identity.awayName || 'Away';
  const homeLabel = identity.homeAbbr || identity.homeName || 'Home';
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

export async function GET() {
  try {
    const rawData = await listConfirmedPicksForLedger();
    const data = Array.isArray(rawData) ? rawData : [];
    const manualSettledTotalGameIds = [
      ...new Set(
        data
          .filter((pick) => isManualSettledTotalPick(pick as Record<string, unknown>, pick.result))
          .map((pick) => String(pick.game_id ?? '').trim())
          .filter(Boolean)
      )
    ];

    const snapshotIds = [
      ...new Set(
        data
          .map((pick) => pick.snapshot_id ?? '')
          .filter((snapshotId): snapshotId is string => Boolean(snapshotId))
      )
    ];

    let snapshotsById = new Map();

    try {
      snapshotsById = await getPregameSnapshotsByIds(snapshotIds);
    } catch {
      snapshotsById = new Map();
    }

    const manualTotalFinalScores = new Map<string, { awayRuns: number; homeRuns: number }>();

    await Promise.allSettled(
      manualSettledTotalGameIds.map(async (gameId) => {
        const summary = await fetchEspnMlbSummary(gameId);
        const finalScore = parseFinalScoreFromSummary(summary);
        if (finalScore) {
          manualTotalFinalScores.set(gameId, finalScore);
        }
      })
    );

    const picks = data.map((pick) => {
      const snapshot = pick.snapshot_id
        ? snapshotsById.get(pick.snapshot_id) ?? null
        : null;

      const snapshotPayload =
        snapshot?.payload && typeof snapshot.payload === 'object'
          ? (snapshot.payload as Record<string, unknown>)
          : null;

      return {
        id: pick.id,

        gameLabel: resolveMatchupLabel({
          snapshotPayload,
          marketSnapshot: null,
          gameId: pick.game_id
        }),

        market: pick.market,
        confidence: pick.confidence,

        executionMarket: pick.execution_market,
        executionOdds: roundOdds(pick.execution_odds),
        modelOdds: roundOdds(pick.odds),

        displayTitle: buildExecutionTitle(pick as Record<string, unknown>),

        edge: roundMetric(getEffectiveEdge(pick as Record<string, unknown>)),
        ev: roundMetric(getEffectiveEv(pick as Record<string, unknown>)),

        status: pick.status,

        finalScoreLabel: buildFinalScoreLabel(
          snapshotPayload,
          pick.result,
          manualTotalFinalScores.get(String(pick.game_id ?? '').trim()) ?? null
        ),

        profitUnits: roundMetric(pick.profit_units),

        reason: pick.execution_reason || pick.reason,

        gameDay: pick.game_day ?? null,

        gameDate: getGameDate(
          pick.game_day ?? null,
          snapshot?.start_time ?? null,
          pick.created_at
        ),

        createdAt: pick.created_at
      };
    });

    picks.sort((left, right) => {
      const leftMs = new Date(String(left.gameDate ?? left.createdAt ?? '')).getTime();
      const rightMs = new Date(String(right.gameDate ?? right.createdAt ?? '')).getTime();
      return rightMs - leftMs;
    });

    return NextResponse.json({
      ok: true,
      picks
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
