import { NextRequest, NextResponse } from 'next/server';
import { getOriginHint, jsonResponseWithAudit } from '@/lib/api-egress-audit';
import {
  closePremiumDailyLock,
  getPickStatusByGameId,
  getPregameSnapshotsByIds,
  getPremiumDailyLock,
  supabase
} from '@/lib/db';
import { resolveMatchupLabel } from '@/lib/matchup-label';
import { USER_TIMEZONE } from '@/lib/runtime-config';

type PremiumPickPayload = {
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  line: number | null;
  confidence: string;
  score: number;
  edge: number | null;
  ev: number | null;
  estimatedProbability: number | null;
  impliedProbability: number | null;
  executionOdds: number | null;
  lockedAt?: string;
  lockReason?: string;
};

type PendingPickRow = {
  game_id: string;
  snapshot_id: string | null;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  confidence: string;
  estimated_probability: number | null;
  implied_probability: number | null;
  edge: number | null;
  ev: number | null;
  execution_market: string | null;
  execution_selection: string | null;
  execution_line: number | null;
  execution_odds: number | null;
  status: string;
  game_day: string | null;
  created_at: string;
  updated_at: string;
};

function formatDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function getConfidenceWeight(confidence: unknown): number {
  if (confidence === 'A') return 30;
  if (confidence === 'B') return 18;
  if (confidence === 'C') return 8;
  return 0;
}

function getEffectiveImpliedProbability(pick: PendingPickRow): number | null {
  return typeof pick.implied_probability === 'number' && Number.isFinite(pick.implied_probability)
    ? pick.implied_probability
    : null;
}

function getEffectiveEdge(pick: PendingPickRow): number | null {
  return typeof pick.edge === 'number' && Number.isFinite(pick.edge) ? pick.edge : null;
}

function getEffectiveEv(pick: PendingPickRow): number | null {
  return typeof pick.ev === 'number' && Number.isFinite(pick.ev) ? pick.ev : null;
}

function getSolidPickScore(pick: PendingPickRow, confidence: string): number {
  const estimatedProbability =
    typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
      ? pick.estimated_probability
      : 0;
  const executionOdds =
    typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
      ? pick.execution_odds
      : typeof pick.odds === 'number' && Number.isFinite(pick.odds)
        ? pick.odds
        : null;
  const edge = getEffectiveEdge(pick) ?? 0;
  const ev = getEffectiveEv(pick) ?? 0;

  let score =
    getConfidenceWeight(confidence) +
    estimatedProbability * 28 +
    edge * 180 +
    ev * 140;

  if (typeof executionOdds === 'number') {
    if (executionOdds < 1.55) {
      score -= 35;
    } else if (executionOdds <= 1.82) {
      score += 6;
    } else if (executionOdds > 2.1) {
      score -= 8;
    }
  }

  return Number(score.toFixed(3));
}

function resolveDisplayConfidence(pick: PendingPickRow): string {
  return String(pick.confidence ?? 'PASS');
}

export async function GET(req: NextRequest) {
  try {
    const dateKey = formatDateKey();
    const originHint = getOriginHint(req.headers);
    const lockPayload = await getPremiumDailyLock(dateKey).catch(() => null);

    if (lockPayload) {
      const payload = lockPayload as Record<string, unknown>;

      if (payload.closed === true) {
        return jsonResponseWithAudit(
          '/api/premium-lock',
          {
            ok: true,
            dateKey,
            isLocked: false,
            isClosed: true,
            premiumPick: null
          },
          {
            originHint,
            dateKey,
            pendingPickRows: 0,
            lockState: 'closed',
            snapshotRows: 0,
            marketSnapshotRows: 0,
            candidates: 0
          }
        );
      }

      const lockedGameId = String(payload.gameId ?? '');
      if (lockedGameId) {
        const lockedStatus = await getPickStatusByGameId(lockedGameId).catch(() => null);
        if (lockedStatus && lockedStatus !== 'pending') {
          await closePremiumDailyLock(dateKey, payload).catch(() => null);
          return jsonResponseWithAudit(
            '/api/premium-lock',
            {
              ok: true,
              dateKey,
              isLocked: false,
              isClosed: true,
              premiumPick: null
            },
            {
              originHint,
              dateKey,
              pendingPickRows: 0,
              lockState: 'auto-closed-settled',
              snapshotRows: 0,
              marketSnapshotRows: 0,
              candidates: 0
            }
          );
        }
      }
    }

    const { data, error } = await supabase
      .from('picks')
      .select([
        'game_id',
        'snapshot_id',
        'market',
        'selection',
        'line',
        'odds',
        'confidence',
        'estimated_probability',
        'implied_probability',
        'edge',
        'ev',
        'execution_market',
        'execution_selection',
        'execution_line',
        'execution_odds',
        'status',
        'game_day',
        'created_at',
        'updated_at'
      ].join(','))
      .eq('sport', 'MLB')
      .eq('status', 'pending')
      .eq('game_day', dateKey)
      .or('execution_selection.not.is.null,execution_market.not.is.null,execution_odds.not.is.null');

    if (error) {
      throw new Error(`Failed to fetch pending premium candidates: ${error.message}`);
    }

    const pendingPicks = Array.isArray(data) ? (data as unknown as PendingPickRow[]) : [];

    if (!pendingPicks.length) {
      return jsonResponseWithAudit(
        '/api/premium-lock',
        {
          ok: true,
          dateKey,
          isLocked: Boolean(lockPayload),
          isClosed: false,
          premiumPick: null
        },
        {
          originHint,
          dateKey,
          pendingPickRows: 0,
          lockState: lockPayload ? 'locked-empty' : 'open-empty',
          snapshotRows: 0,
          marketSnapshotRows: 0,
          candidates: 0
        }
      );
    }

    const snapshotsById = await getPregameSnapshotsByIds(
      pendingPicks
        .map((pick) => pick.snapshot_id ?? '')
        .filter((snapshotId): snapshotId is string => Boolean(snapshotId))
    ).catch(() => new Map());

    const candidates = pendingPicks.map((pick) => {
      const snapshot = pick.snapshot_id ? snapshotsById.get(pick.snapshot_id) ?? null : null;
      const snapshotPayload =
        snapshot?.payload && typeof snapshot.payload === 'object'
          ? (snapshot.payload as Record<string, unknown>)
          : null;
      const confidence = resolveDisplayConfidence(pick);
      const market = pick.execution_market || pick.market || 'UNKNOWN';
      const selection = pick.execution_selection || pick.selection || 'NO BET';
      const line =
        typeof pick.execution_line === 'number'
          ? pick.execution_line
          : typeof pick.line === 'number'
            ? pick.line
            : null;

      return {
        gameId: pick.game_id,
        gameLabel: resolveMatchupLabel({
          snapshotPayload,
          marketSnapshot: null,
          gameId: pick.game_id
        }),
        market,
        selection,
        line,
        confidence,
        score: getSolidPickScore(pick, confidence),
        edge: roundMetric(getEffectiveEdge(pick)),
        ev: roundMetric(getEffectiveEv(pick)),
        estimatedProbability:
          typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
            ? roundMetric(pick.estimated_probability)
            : null,
        impliedProbability: roundMetric(getEffectiveImpliedProbability(pick)),
        executionOdds:
          typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
            ? pick.execution_odds
            : typeof pick.odds === 'number' && Number.isFinite(pick.odds)
              ? pick.odds
              : null,
        createdAt: pick.created_at
      };
    });

    candidates.sort(
      (left, right) =>
        right.score - left.score ||
        (right.edge ?? 0) - (left.edge ?? 0) ||
        (right.ev ?? 0) - (left.ev ?? 0) ||
        left.gameId.localeCompare(right.gameId)
    );

    const liveTop = candidates[0] ?? null;
    const lockData = lockPayload as Record<string, unknown> | null;

    const lockedPick =
      lockData && String(lockData.gameId ?? '')
        ? candidates.find((candidate) => candidate.gameId === String(lockData.gameId ?? '')) ?? null
        : null;

    const premiumPick: PremiumPickPayload | null = lockData
      ? {
          gameId: String(lockData.gameId ?? lockedPick?.gameId ?? ''),
          gameLabel: lockedPick?.gameLabel ?? String(lockData.gameLabel ?? ''),
          market: String(lockData.marketType ?? lockData.market ?? lockedPick?.market ?? ''),
          selection: String(lockData.selection ?? lockedPick?.selection ?? ''),
          line:
            typeof lockData.line === 'number'
              ? lockData.line
              : lockedPick?.line ?? null,
          confidence: String(lockedPick?.confidence ?? lockData.confidence ?? ''),
          score:
            typeof lockData.score === 'number'
              ? lockData.score
              : lockedPick?.score ?? 0,
          edge:
            typeof lockData.edge === 'number'
              ? roundMetric(lockData.edge)
              : lockedPick?.edge ?? null,
          ev:
            typeof lockData.ev === 'number'
              ? roundMetric(lockData.ev)
              : lockedPick?.ev ?? null,
          estimatedProbability:
            typeof lockData.probability === 'number'
              ? roundMetric(lockData.probability)
              : lockedPick?.estimatedProbability ?? null,
          impliedProbability:
            typeof lockData.impliedProbability === 'number'
              ? roundMetric(lockData.impliedProbability)
              : lockedPick?.impliedProbability ?? null,
          executionOdds:
            typeof lockData.odds === 'number'
              ? lockData.odds
              : lockedPick?.executionOdds ?? null,
          lockedAt:
            typeof lockData.lockedAt === 'string'
              ? lockData.lockedAt
              : undefined,
          lockReason:
            typeof lockData.lockReason === 'string'
              ? lockData.lockReason
              : undefined
        }
      : liveTop
        ? {
            gameId: liveTop.gameId,
            gameLabel: liveTop.gameLabel,
            market: liveTop.market,
            selection: liveTop.selection,
            line: liveTop.line,
            confidence: liveTop.confidence,
            score: liveTop.score,
            edge: liveTop.edge,
            ev: liveTop.ev,
            estimatedProbability: liveTop.estimatedProbability,
            impliedProbability: liveTop.impliedProbability,
            executionOdds: liveTop.executionOdds
          }
        : null;

    return jsonResponseWithAudit(
      '/api/premium-lock',
      {
        ok: true,
        dateKey,
        isLocked: Boolean(lockPayload),
        isClosed: false,
        premiumPick
      },
      {
        originHint,
        dateKey,
        pendingPickRows: pendingPicks.length,
        lockState: lockPayload ? 'locked' : 'open',
        snapshotRows: snapshotsById.size,
        marketSnapshotRows: 0,
        candidates: candidates.length
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponseWithAudit(
      '/api/premium-lock',
      { ok: false, isLocked: false, isClosed: false, premiumPick: null, error: message },
      {
        originHint: getOriginHint(req.headers),
        dateKey: formatDateKey(),
        error: message
      },
      { status: 500 }
    );
  }
}
