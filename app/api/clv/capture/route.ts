import { NextRequest } from 'next/server';
import {
  getSnapshotsForClvCapture,
  listOddsBoardCachesByKeys,
  listPicksForClvCapture,
  updatePickClvAudit,
  type ClvSnapshotRow,
  type OddsBoardCacheRow,
  type PickClvCaptureRow,
  type PickClvUpdateInput
} from '@/lib/db';
import { normalizeMarketLines, type EventMarketLines, type MarketLine } from '@/lib/market-lines';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ClvStatus = PickClvUpdateInput['clv_status'];

type CaptureBody = {
  startDate?: unknown;
  endDate?: unknown;
  dryRun?: unknown;
  force?: unknown;
};

type ClosingMatch = {
  odds: number | null;
  line: number | null;
  market: string | null;
  selection: string | null;
  source: string | null;
  snapshotId: string | null;
  status: ClvStatus;
  notes: string | null;
};

type PreviewRow = {
  pickId: string;
  gameId: string;
  gameDay: string | null;
  market: string | null;
  selection: string | null;
  executionOdds: number | null;
  executionLine: number | null;
  closingOdds: number | null;
  closingLine: number | null;
  closingMarket: string | null;
  closingSelection: string | null;
  closingSource: string | null;
  closingSnapshotId: string | null;
  clvDecimal: number | null;
  clvPercent: number | null;
  clvStatus: ClvStatus;
  clvNotes: string | null;
  action: 'preview' | 'updated' | 'skipped_existing';
};

function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function roundMetric(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(4));
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(left: unknown, right: unknown): boolean {
  const leftName = normalizeText(left);
  const rightName = normalizeText(right);
  if (!leftName || !rightName) return false;
  if (leftName === rightName) return true;

  const shorter = leftName.length < rightName.length ? leftName : rightName;
  const longer = leftName.length < rightName.length ? rightName : leftName;
  return shorter.length >= 4 && longer.includes(shorter);
}

function normalizeMarket(value: unknown): string | null {
  const market = String(value ?? '').trim().toUpperCase();
  if (market === 'ML' || market === 'MONEYLINE') return 'ML';
  if (market === 'RL' || market === 'RUN_LINE' || market === 'RUNLINE') return 'RL';
  if (market === 'TOTAL' || market === 'TOTALS') return 'TOTAL';
  if (market === 'F5' || market === 'FIRST_FIVE') return 'F5';
  return market || null;
}

function normalizeSide(value: unknown): MarketLine['side'] | null {
  const side = String(value ?? '').trim().toLowerCase();
  if (side === 'home' || side === 'away' || side === 'over' || side === 'under') {
    return side;
  }

  return null;
}

function inferSideFromSelection(selection: unknown): MarketLine['side'] | null {
  const normalized = normalizeText(selection);
  if (normalized.startsWith('over') || normalized.includes(' over ')) return 'over';
  if (normalized.startsWith('under') || normalized.includes(' under ')) return 'under';
  return null;
}

function lineMatches(left: number | null, right: number | null): boolean {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return Math.abs(left - right) < 0.001;
}

function extractSnapshotEvent(snapshot: ClvSnapshotRow): EventMarketLines | null {
  const payload = asRecord(snapshot.payload);
  const event = asRecord(payload?.matchingMarketEvent);
  const lines = asArray(event?.lines);
  if (!event || !lines.length) return null;

  return {
    eventId: String(event.eventId ?? event.eventID ?? snapshot.game_id),
    homeTeam: String(event.homeTeam ?? ''),
    awayTeam: String(event.awayTeam ?? ''),
    startsAt: typeof event.startsAt === 'string' ? event.startsAt : snapshot.start_time,
    lines: lines as MarketLine[]
  };
}

function findBoardEventForSnapshot(
  boardEvents: EventMarketLines[],
  snapshot: ClvSnapshotRow
): EventMarketLines | null {
  const snapshotEvent = extractSnapshotEvent(snapshot);
  if (!snapshotEvent?.homeTeam || !snapshotEvent.awayTeam) {
    return null;
  }

  const targetStartMs = snapshot.start_time ? new Date(snapshot.start_time).getTime() : Number.NaN;
  const candidates = boardEvents.filter((event) => {
    return (
      namesMatch(event.homeTeam, snapshotEvent.homeTeam) &&
      namesMatch(event.awayTeam, snapshotEvent.awayTeam)
    );
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

function getSnapshotsByGameId(snapshots: ClvSnapshotRow[]): Map<string, ClvSnapshotRow[]> {
  const byGame = new Map<string, ClvSnapshotRow[]>();

  for (const snapshot of snapshots) {
    const rows = byGame.get(snapshot.game_id) ?? [];
    rows.push(snapshot);
    byGame.set(snapshot.game_id, rows);
  }

  for (const [gameId, rows] of byGame) {
    byGame.set(
      gameId,
      rows.sort((left, right) => {
        const leftMs = new Date(left.updated_at ?? left.created_at).getTime();
        const rightMs = new Date(right.updated_at ?? right.created_at).getTime();
        return rightMs - leftMs;
      })
    );
  }

  return byGame;
}

function selectClosingSnapshot(snapshots: ClvSnapshotRow[]): ClvSnapshotRow | null {
  if (!snapshots.length) return null;

  const firstStartMs = snapshots
    .map((snapshot) => snapshot.start_time ? new Date(snapshot.start_time).getTime() : Number.NaN)
    .find((value) => Number.isFinite(value));
  const startMs = firstStartMs ?? Number.NaN;

  if (!Number.isFinite(startMs)) {
    return snapshots[0] ?? null;
  }

  return (
    snapshots.find((snapshot) => {
      const updatedMs = new Date(snapshot.updated_at ?? snapshot.created_at).getTime();
      return Number.isFinite(updatedMs) && updatedMs <= startMs;
    }) ?? null
  );
}

function findLineForPick(
  pick: PickClvCaptureRow,
  lines: MarketLine[]
): { exact: MarketLine | null; mismatch: MarketLine | null } {
  const market = normalizeMarket(pick.execution_market ?? pick.market);
  const selection = pick.execution_selection ?? pick.selection;
  const requestedLine = readNumber(pick.execution_line ?? pick.line);
  const requestedSide =
    normalizeSide(pick.execution_side) ??
    inferSideFromSelection(selection);

  const candidates = lines.filter((line) => {
    const lineMarket = normalizeMarket(line.marketType);
    if (!market || lineMarket !== market) return false;

    const lineSide = normalizeSide(line.side);
    if (requestedSide && lineSide && requestedSide !== lineSide) return false;

    if (!requestedSide && lineSide !== 'over' && lineSide !== 'under') {
      return namesMatch(selection, line.selection);
    }

    return true;
  });

  if (!candidates.length) {
    return { exact: null, mismatch: null };
  }

  const needsLine = market !== 'ML';
  const exact = candidates.find((line) => {
    const lineValue = readNumber(line.line);
    if (!needsLine) return true;
    return lineMatches(requestedLine, lineValue);
  }) ?? null;

  if (exact) {
    return { exact, mismatch: null };
  }

  const mismatch =
    candidates
      .map((line) => {
        const lineValue = readNumber(line.line);
        const distance =
          requestedLine !== null && lineValue !== null
            ? Math.abs(requestedLine - lineValue)
            : Number.POSITIVE_INFINITY;
        return { line, distance };
      })
      .sort((left, right) => left.distance - right.distance)[0]?.line ?? null;

  return { exact: null, mismatch };
}

function calculateClv(
  executionOdds: number | null,
  closingOdds: number | null
): { decimal: number | null; percent: number | null; status: ClvStatus } {
  if (
    executionOdds === null ||
    closingOdds === null ||
    executionOdds <= 1 ||
    closingOdds <= 1
  ) {
    return { decimal: null, percent: null, status: 'unavailable' };
  }

  const decimal = roundMetric(executionOdds - closingOdds);
  const percent = roundMetric(executionOdds / closingOdds - 1);

  if (percent === null) {
    return { decimal, percent, status: 'unavailable' };
  }

  if (percent > 0.01) return { decimal, percent, status: 'positive' };
  if (percent < -0.01) return { decimal, percent, status: 'negative' };
  return { decimal, percent, status: 'neutral' };
}

function buildLineMatch(
  pick: PickClvCaptureRow,
  lines: MarketLine[],
  source: string,
  snapshotId: string | null
): ClosingMatch | null {
  const { exact, mismatch } = findLineForPick(pick, lines);
  const market = normalizeMarket(pick.execution_market ?? pick.market);

  if (exact) {
    const closingOdds = readNumber(exact.odds);
    const closingLine = readNumber(exact.line);
    const { decimal, percent, status } = calculateClv(
      readNumber(pick.execution_odds),
      closingOdds
    );

    return {
      odds: closingOdds,
      line: market === 'ML' ? null : closingLine,
      market,
      selection: String(exact.selection ?? pick.execution_selection ?? pick.selection ?? ''),
      source,
      snapshotId,
      status,
      notes: status === 'unavailable' ? 'missing closing odds' : null,
      clvDecimal: decimal,
      clvPercent: percent
    } as ClosingMatch & { clvDecimal: number | null; clvPercent: number | null };
  }

  if (mismatch) {
    return {
      odds: readNumber(mismatch.odds),
      line: readNumber(mismatch.line),
      market,
      selection: String(mismatch.selection ?? pick.execution_selection ?? pick.selection ?? ''),
      source,
      snapshotId,
      status: 'unavailable',
      notes: 'line mismatch'
    };
  }

  return null;
}

function getComputedClv(match: ClosingMatch, pick: PickClvCaptureRow) {
  if (match.status === 'unavailable') {
    return { decimal: null, percent: null, status: match.status };
  }

  return calculateClv(readNumber(pick.execution_odds), match.odds);
}

function findClosingMatchForPick(
  pick: PickClvCaptureRow,
  snapshots: ClvSnapshotRow[],
  board: OddsBoardCacheRow | null
): ClosingMatch {
  const closingSnapshot = selectClosingSnapshot(snapshots);
  const startMs = closingSnapshot?.start_time
    ? new Date(closingSnapshot.start_time).getTime()
    : Number.NaN;

  if (board && closingSnapshot && Number.isFinite(startMs)) {
    const boardUpdatedMs = new Date(board.updated_at ?? board.created_at).getTime();
    if (Number.isFinite(boardUpdatedMs) && boardUpdatedMs <= startMs) {
      const boardEvents = normalizeMarketLines(board.payload as never);
      const boardEvent = findBoardEventForSnapshot(boardEvents, closingSnapshot);
      if (boardEvent?.lines?.length) {
        const boardMatch = buildLineMatch(
          pick,
          boardEvent.lines,
          `odds_board_cache:${board.board_key}`,
          null
        );
        if (boardMatch) return boardMatch;
      }
    }
  }

  if (closingSnapshot) {
    const snapshotEvent = extractSnapshotEvent(closingSnapshot);
    if (snapshotEvent?.lines?.length) {
      const snapshotMatch = buildLineMatch(
        pick,
        snapshotEvent.lines,
        'snapshot_payload',
        closingSnapshot.id
      );
      if (snapshotMatch) return snapshotMatch;
    }
  }

  return {
    odds: null,
    line: null,
    market: normalizeMarket(pick.execution_market ?? pick.market),
    selection: String(pick.execution_selection ?? pick.selection ?? ''),
    source: null,
    snapshotId: null,
    status: 'unavailable',
    notes: closingSnapshot ? 'no exact closing market match' : 'no closing snapshot/cache available'
  };
}

function toUpdateInput(match: ClosingMatch, pick: PickClvCaptureRow): PickClvUpdateInput {
  const computed = getComputedClv(match, pick);

  return {
    closing_odds: match.odds,
    closing_line: match.line,
    closing_market: match.market,
    closing_selection: match.selection,
    closing_source: match.source,
    closing_snapshot_id: match.snapshotId,
    closing_captured_at: new Date().toISOString(),
    clv_decimal: computed.decimal,
    clv_percent: computed.percent,
    clv_status: computed.status,
    clv_notes: match.notes
  };
}

function toPreviewRow(
  pick: PickClvCaptureRow,
  input: PickClvUpdateInput,
  action: PreviewRow['action']
): PreviewRow {
  return {
    pickId: pick.id,
    gameId: pick.game_id,
    gameDay: pick.game_day,
    market: pick.execution_market ?? pick.market,
    selection: pick.execution_selection ?? pick.selection,
    executionOdds: readNumber(pick.execution_odds),
    executionLine: readNumber(pick.execution_line ?? pick.line),
    closingOdds: input.closing_odds,
    closingLine: input.closing_line,
    closingMarket: input.closing_market,
    closingSelection: input.closing_selection,
    closingSource: input.closing_source,
    closingSnapshotId: input.closing_snapshot_id,
    clvDecimal: input.clv_decimal,
    clvPercent: input.clv_percent,
    clvStatus: input.clv_status,
    clvNotes: input.clv_notes,
    action
  };
}

function summarizeRows(rows: PreviewRow[]) {
  return {
    matched: rows.filter((row) => row.clvStatus !== 'unavailable' && row.clvPercent !== null).length,
    unavailable: rows.filter((row) => row.clvStatus === 'unavailable').length,
    positive: rows.filter((row) => row.clvStatus === 'positive').length,
    negative: rows.filter((row) => row.clvStatus === 'negative').length,
    neutral: rows.filter((row) => row.clvStatus === 'neutral').length
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as CaptureBody;
    const startDate = body.startDate;
    const endDate = body.endDate;
    const dryRun = body.dryRun !== false;
    const force = body.force === true;

    if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
      return Response.json(
        {
          ok: false,
          error: 'startDate y endDate deben usar formato YYYY-MM-DD'
        },
        { status: 400 }
      );
    }

    if (startDate > endDate) {
      return Response.json(
        {
          ok: false,
          error: 'startDate no puede ser mayor que endDate'
        },
        { status: 400 }
      );
    }

    const picks = await listPicksForClvCapture(startDate, endDate);
    const gameIds = [...new Set(picks.map((pick) => pick.game_id).filter(Boolean))];
    const gameDays = [...new Set(picks.map((pick) => pick.game_day).filter(Boolean))] as string[];
    const boardKeys = gameDays.map((gameDay) => `mlb_main:${gameDay}`);

    const [snapshots, boards] = await Promise.all([
      getSnapshotsForClvCapture(gameIds),
      listOddsBoardCachesByKeys(boardKeys)
    ]);

    const snapshotsByGameId = getSnapshotsByGameId(snapshots);
    const boardsByKey = new Map(boards.map((board) => [board.board_key, board]));
    const rows: PreviewRow[] = [];
    const updates: Array<{ pick: PickClvCaptureRow; input: PickClvUpdateInput }> = [];

    for (const pick of picks) {
      if (!force && readNumber(pick.closing_odds) !== null) {
        rows.push(
          toPreviewRow(
            pick,
            {
              closing_odds: readNumber(pick.closing_odds),
              closing_line: readNumber(pick.closing_line),
              closing_market: pick.closing_market ?? null,
              closing_selection: pick.closing_selection ?? null,
              closing_source: pick.closing_source ?? null,
              closing_snapshot_id: pick.closing_snapshot_id ?? null,
              closing_captured_at: pick.closing_captured_at ?? new Date().toISOString(),
              clv_decimal: readNumber(pick.clv_decimal),
              clv_percent: readNumber(pick.clv_percent),
              clv_status:
                pick.clv_status === 'positive' ||
                pick.clv_status === 'negative' ||
                pick.clv_status === 'neutral' ||
                pick.clv_status === 'unavailable'
                  ? pick.clv_status
                  : 'unavailable',
              clv_notes: pick.clv_notes ?? null
            },
            'skipped_existing'
          )
        );
        continue;
      }

      const board = pick.game_day ? boardsByKey.get(`mlb_main:${pick.game_day}`) ?? null : null;
      const match = findClosingMatchForPick(
        pick,
        snapshotsByGameId.get(pick.game_id) ?? [],
        board
      );
      const input = toUpdateInput(match, pick);

      rows.push(toPreviewRow(pick, input, dryRun ? 'preview' : 'updated'));
      updates.push({ pick, input });
    }

    if (!dryRun && updates.length) {
      await Promise.all(
        updates.map(({ pick, input }) => updatePickClvAudit(pick.id, input))
      );
    }

    const summary = summarizeRows(rows);

    return Response.json(
      {
        ok: true,
        dryRun,
        force,
        totalPicks: picks.length,
        ...summary,
        apiCallsMade: 0,
        rows
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown CLV capture error',
        apiCallsMade: 0
      },
      { status: 500 }
    );
  }
}
