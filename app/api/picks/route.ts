import { NextResponse } from 'next/server';
import { getPregameSnapshotsByIds, listConfirmedPicksForLedger } from '@/lib/db';
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

  if ((market === 'TOTAL' || selection.toLowerCase().startsWith('over') || selection.toLowerCase().startsWith('under')) && line !== null) {
    return `${selection} ${line}`;
  }

  if (line !== null) {
    const formattedLine = formatSignedLine(line);
    return formattedLine ? `${selection} ${formattedLine}` : selection;
  }

  return selection;
}

function getGameLabel(snapshotPayload: Record<string, unknown> | null, gameId: string): string {
  const espnGame =
    snapshotPayload?.espnGame && typeof snapshotPayload.espnGame === 'object'
      ? snapshotPayload.espnGame as Record<string, unknown>
      : null;

  const shortName = typeof espnGame?.shortName === 'string' ? espnGame.shortName : null;
  if (shortName) return shortName;

  const engineGame =
    snapshotPayload?.engineGame && typeof snapshotPayload.engineGame === 'object'
      ? snapshotPayload.engineGame as Record<string, unknown>
      : null;
  const homeTeam =
    engineGame?.homeTeam && typeof engineGame.homeTeam === 'object'
      ? engineGame.homeTeam as Record<string, unknown>
      : null;
  const awayTeam =
    engineGame?.awayTeam && typeof engineGame.awayTeam === 'object'
      ? engineGame.awayTeam as Record<string, unknown>
      : null;
  const homeCore =
    homeTeam?.core && typeof homeTeam.core === 'object'
      ? homeTeam.core as Record<string, unknown>
      : null;
  const awayCore =
    awayTeam?.core && typeof awayTeam.core === 'object'
      ? awayTeam.core as Record<string, unknown>
      : null;

  const homeName = typeof homeCore?.teamName === 'string' ? homeCore.teamName : null;
  const awayName = typeof awayCore?.teamName === 'string' ? awayCore.teamName : null;

  if (awayName && homeName) {
    return `${awayName} @ ${homeName}`;
  }

  return gameId;
}

function getTeamIdentity(snapshotPayload: Record<string, unknown> | null): {
  homeName: string | null;
  awayName: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
} {
  const engineGame =
    snapshotPayload?.engineGame && typeof snapshotPayload.engineGame === 'object'
      ? snapshotPayload.engineGame as Record<string, unknown>
      : null;
  const homeTeam =
    engineGame?.homeTeam && typeof engineGame.homeTeam === 'object'
      ? engineGame.homeTeam as Record<string, unknown>
      : null;
  const awayTeam =
    engineGame?.awayTeam && typeof engineGame.awayTeam === 'object'
      ? engineGame.awayTeam as Record<string, unknown>
      : null;
  const homeCore =
    homeTeam?.core && typeof homeTeam.core === 'object'
      ? homeTeam.core as Record<string, unknown>
      : null;
  const awayCore =
    awayTeam?.core && typeof awayTeam.core === 'object'
      ? awayTeam.core as Record<string, unknown>
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

function buildFinalScoreLabel(
  snapshotPayload: Record<string, unknown> | null,
  result?: string | null
): string | null {
  const parsed = parseAutoResult(result);
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
    const data = await listConfirmedPicksForLedger();
    const snapshotIds = [...new Set(
      data
        .map((pick) => pick.snapshot_id ?? '')
        .filter((snapshotId): snapshotId is string => Boolean(snapshotId))
    )];
    let snapshotsById = new Map();

    try {
      snapshotsById = await getPregameSnapshotsByIds(snapshotIds);
    } catch {
      snapshotsById = new Map();
    }

    const picks = (data ?? []).map((pick) => {
      const snapshot = pick.snapshot_id
        ? snapshotsById.get(pick.snapshot_id) ?? null
        : null;
      const snapshotPayload =
        snapshot?.payload && typeof snapshot.payload === 'object'
          ? snapshot.payload as Record<string, unknown>
          : null;

return {
  id: pick.id,
  gameLabel: getGameLabel(snapshotPayload, pick.game_id),
  market: pick.market,
  confidence: pick.confidence,

  executionMarket: pick.execution_market,
  executionOdds: roundOdds(pick.execution_odds),
  modelOdds: roundOdds(pick.odds),
  displayTitle: buildExecutionTitle(pick as Record<string, unknown>),

  edge: roundMetric(getEffectiveEdge(pick as Record<string, unknown>)),
  ev: roundMetric(getEffectiveEv(pick as Record<string, unknown>)),

  status: pick.status,
  finalScoreLabel: buildFinalScoreLabel(snapshotPayload, pick.result),
  profitUnits: roundMetric(pick.profit_units),

  reason: pick.execution_reason || pick.reason,
  gameDay: pick.game_day ?? null,
  gameDate: getGameDate(
  pick.game_day ?? null,
  snapshot?.start_time ?? null,
  pick.created_at
),
  createdAt: pick.created_at,
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
