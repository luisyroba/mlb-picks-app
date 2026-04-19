import { NextRequest, NextResponse } from 'next/server';
import { confirmExecution } from '@/lib/confirm-execution';
import {
  getLatestPickForGame,
  getPregameSnapshotById,
  getPregameSnapshotsForGame,
  upsertPickRecord,
  type PregameSnapshotRow
} from '@/lib/db';
import {
  getExecutionConfigForTier,
  type ExecutionRecommendation
} from '@/lib/choose-best-execution';
import type { MarketLine } from '@/lib/market-lines';
import { expectedValue, impliedProbability } from '@/lib/probability-model';

function roundOdds(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
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

function isMarketType(value: unknown): value is 'ML' | 'RL' | 'TOTAL' | 'F5' {
  return value === 'ML' || value === 'RL' || value === 'TOTAL' || value === 'F5';
}

function isSide(
  value: unknown
): value is 'home' | 'away' | 'over' | 'under' {
  return value === 'home' || value === 'away' || value === 'over' || value === 'under';
}

function readLineFromUnknown(value: unknown): MarketLine | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Record<string, unknown>;
  const marketType = candidate.marketType;
  const selection = candidate.selection;
  const odds =
    typeof candidate.odds === 'number'
      ? candidate.odds
      : Number(candidate.odds);

  if (!isMarketType(marketType)) return undefined;
  if (typeof selection !== 'string' || !selection.trim()) return undefined;
  if (!Number.isFinite(odds) || odds <= 1) return undefined;

  const line =
    typeof candidate.line === 'number'
      ? candidate.line
      : candidate.line === null || candidate.line === undefined
        ? undefined
        : Number(candidate.line);

  const side = isSide(candidate.side) ? candidate.side : undefined;

  return {
    marketType,
    selection,
    line: Number.isFinite(line) ? line : undefined,
    odds,
    side
  };
}

function parseExecutionRecommendation(
  payload: Record<string, unknown> | null | undefined
): ExecutionRecommendation | null {
  if (!payload) return null;

  const raw = payload.executionRecommendation;
  if (!raw || typeof raw !== 'object') return null;

  const tier = (raw as Record<string, unknown>).tier;
  const minAcceptedOdds =
    typeof (raw as Record<string, unknown>).minAcceptedOdds === 'number'
      ? ((raw as Record<string, unknown>).minAcceptedOdds as number)
      : Number((raw as Record<string, unknown>).minAcceptedOdds);

  if (tier !== 'A' && tier !== 'B' && tier !== 'C') {
    return null;
  }

  return {
    recommendedLine:
      readLineFromUnknown((raw as Record<string, unknown>).recommendedLine) ?? null,
    alternative1: readLineFromUnknown((raw as Record<string, unknown>).alternative1),
    alternative2: readLineFromUnknown((raw as Record<string, unknown>).alternative2),
    minAcceptedOdds:
      Number.isFinite(minAcceptedOdds)
        ? minAcceptedOdds
        : getExecutionConfigForTier(tier).hardMinOdds,
    tier,
    reason:
      typeof (raw as Record<string, unknown>).reason === 'string'
        ? ((raw as Record<string, unknown>).reason as string)
        : 'Execution recommendation recovered from snapshot'
  };
}

function buildFallbackRecommendation(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>
): ExecutionRecommendation | null {
  if (!pick?.execution_selection) return null;

  const tier: 'A' | 'B' | 'C' =
    pick.confidence === 'A'
      ? 'A'
      : pick.confidence === 'B'
        ? 'B'
        : 'C';

  return {
    recommendedLine: {
      marketType: isMarketType(pick.execution_market) ? pick.execution_market : 'ML',
      selection: pick.execution_selection,
      line: pick.execution_line ?? undefined,
      odds: pick.execution_odds ?? pick.odds ?? 0,
      side: isSide(pick.execution_side) ? pick.execution_side : undefined
    },
    minAcceptedOdds: getExecutionConfigForTier(tier).hardMinOdds,
    tier,
    reason: pick.execution_reason ?? 'Execution recommendation reconstructed from pick'
  };
}

function buildScopedRecommendation(
  recommendation: ExecutionRecommendation,
  slot: 'recommended' | 'alternative1' | 'alternative2'
) {
  const orderedLines = [
    recommendation.recommendedLine,
    recommendation.alternative1,
    recommendation.alternative2
  ].filter((line): line is MarketLine => Boolean(line));

  const slotIndex =
    slot === 'alternative1'
      ? 1
      : slot === 'alternative2'
        ? 2
        : 0;

  const selectedLine = orderedLines[slotIndex] ?? null;
  if (!selectedLine) {
    return {
      ok: false as const,
      error:
        slot === 'recommended'
          ? 'No existe una linea recomendada disponible para ejecutar'
          : `El slot ${slot} no esta disponible en esta actualizacion`
    };
  }

  const nextAlternative = orderedLines[slotIndex + 1];
  const secondNextAlternative = orderedLines[slotIndex + 2];

  return {
    ok: true as const,
    ...recommendation,
    recommendedLine: selectedLine,
    alternative1: nextAlternative,
    alternative2: secondNextAlternative
  };
}

function parseSnapshotPickContext(payload: Record<string, unknown>) {
  const finalPick = payload.finalPick as Record<string, unknown> | undefined;

  return {
    market: safeString(finalPick?.market) || 'PASS',
    selection: safeString(finalPick?.selection) || 'NO BET',
    line: safeNumber(finalPick?.line),
    odds: safeNumber(finalPick?.odds),
    confidence: safeString(finalPick?.confidence) || 'PASS',
    estimatedProbability: safeNumber(finalPick?.estimatedProbability),
    impliedProbability: safeNumber(finalPick?.impliedProbability),
    edge: safeNumber(finalPick?.edge),
    ev: safeNumber(finalPick?.ev),
    reason:
      safeString(finalPick?.executionReason) ||
      safeString(finalPick?.passReason) ||
      'Execution confirmed from snapshot',
    altMarket1: safeString(finalPick?.altMarket1) || null,
    altMarket2: safeString(finalPick?.altMarket2) || null
  };
}

async function resolveSnapshot(
  gameId: string,
  snapshotId?: string | null
): Promise<PregameSnapshotRow | null> {
  if (snapshotId) {
    const direct = await getPregameSnapshotById(snapshotId);
    if (direct) return direct;
  }

  const snapshots = await getPregameSnapshotsForGame(gameId);
  return snapshots.final ?? snapshots.mid ?? snapshots.open ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const gameId = String(body?.gameId ?? '').trim();
    const snapshotId = String(body?.snapshotId ?? '').trim() || null;
    const actualOdds =
      typeof body?.actualOdds === 'number'
        ? body.actualOdds
        : Number(body?.actualOdds);
    const actualLine =
      typeof body?.actualLine === 'number'
        ? body.actualLine
        : body?.actualLine === '' || body?.actualLine === null || body?.actualLine === undefined
          ? undefined
          : Number(body?.actualLine);
    const available =
      typeof body?.available === 'boolean'
        ? body.available
        : true;

    const selectedSlot: 'recommended' | 'alternative1' | 'alternative2' =
      body?.selectedSlot === 'alternative1' || body?.selectedSlot === 'alternative2'
        ? body.selectedSlot
        : 'recommended';

    if (!gameId) {
      return NextResponse.json(
        { ok: false, error: 'Missing gameId' },
        { status: 400 }
      );
    }

    const snapshot = await resolveSnapshot(gameId, snapshotId);
    const existingPick = await getLatestPickForGame(gameId);

    if (!snapshot && !existingPick) {
      return NextResponse.json(
        { ok: false, error: 'No existe snapshot pregame ni pick previo para este juego' },
        { status: 404 }
      );
    }

    const payload =
      snapshot?.payload && typeof snapshot.payload === 'object'
        ? (snapshot.payload as Record<string, unknown>)
        : null;

    const recommendation =
      parseExecutionRecommendation(payload) ?? buildFallbackRecommendation(existingPick);

    if (!recommendation) {
      return NextResponse.json(
        { ok: false, error: 'No existe recomendación ejecutable para este juego' },
        { status: 409 }
      );
    }

    const scopedRecommendation = buildScopedRecommendation(
      recommendation,
      selectedSlot
    );

    if (!scopedRecommendation.ok) {
      return NextResponse.json(
        { ok: false, error: scopedRecommendation.error },
        { status: 409 }
      );
    }

    const result = confirmExecution({
      recommendation: scopedRecommendation,
      actualOdds,
      actualLine: Number.isFinite(actualLine as number) ? (actualLine as number) : undefined,
      available
    });

    if (result.status === 'CONFIRMED') {
      const pickContext = payload
        ? parseSnapshotPickContext(payload)
        : {
            market: existingPick?.market ?? 'PASS',
            selection: existingPick?.selection ?? 'NO BET',
            line: existingPick?.line ?? null,
            odds: existingPick?.odds ?? null,
            confidence: existingPick?.confidence ?? 'PASS',
            estimatedProbability: existingPick?.estimated_probability ?? null,
            impliedProbability: existingPick?.implied_probability ?? null,
            edge: existingPick?.edge ?? null,
            ev: existingPick?.ev ?? null,
            reason: existingPick?.reason ?? 'Execution confirmed from existing pick',
            altMarket1: existingPick?.alt_market_1 ?? null,
            altMarket2: existingPick?.alt_market_2 ?? null
          };

      const usedOdds =
        typeof result.usedOdds === 'number' && Number.isFinite(result.usedOdds)
          ? result.usedOdds
          : undefined;
      const executionImpliedProbability =
        usedOdds !== undefined && usedOdds > 1
          ? impliedProbability(usedOdds)
          : pickContext.impliedProbability;
      const executionEdge =
        typeof pickContext.estimatedProbability === 'number' &&
        Number.isFinite(pickContext.estimatedProbability) &&
        typeof executionImpliedProbability === 'number' &&
        Number.isFinite(executionImpliedProbability)
          ? pickContext.estimatedProbability - executionImpliedProbability
          : pickContext.edge;
      const executionEv =
        typeof pickContext.estimatedProbability === 'number' &&
        Number.isFinite(pickContext.estimatedProbability) &&
        usedOdds !== undefined
          ? expectedValue(pickContext.estimatedProbability, usedOdds)
          : pickContext.ev;

      await upsertPickRecord({
        gameId,
        snapshotId: snapshot?.id ?? existingPick?.snapshot_id ?? null,
        snapshotStage:
          snapshot?.snapshot_stage === 'open' ||
          snapshot?.snapshot_stage === 'mid' ||
          snapshot?.snapshot_stage === 'final'
            ? snapshot.snapshot_stage
            : null,
        sport: 'MLB',

        market: pickContext.market,
        selection: pickContext.selection,
        line: pickContext.line,
        odds: pickContext.odds,

        confidence: pickContext.confidence,
        estimatedProbability: pickContext.estimatedProbability,
        impliedProbability: roundMetric(executionImpliedProbability),
        edge: roundMetric(executionEdge),
        ev: roundMetric(executionEv),

        reason: pickContext.reason,
        altMarket1: pickContext.altMarket1,
        altMarket2: pickContext.altMarket2,

        executionMarket: result.acceptedLine?.marketType ?? null,
        executionSelection: result.acceptedLine?.selection ?? null,
        executionLine: result.acceptedLine?.line ?? null,
        executionOdds: roundOdds(result.usedOdds),
        executionSide: result.acceptedLine?.side ?? null,
        executionReason: result.reason,

        status: 'pending',
        result: null,
        profitUnits: null
      });
    }

    return NextResponse.json({
      ok: true,
      confirmation: {
        status: result.status,
        reason: result.reason,
        acceptedLine: result.acceptedLine
          ? {
              ...result.acceptedLine,
              odds: roundOdds(result.acceptedLine.odds)
            }
          : null,
        usedOdds: roundOdds(result.usedOdds),
        minAcceptedOdds: roundOdds(result.minAcceptedOdds),
        nextAlternative: result.nextAlternative
          ? {
              ...result.nextAlternative,
              odds: roundOdds(result.nextAlternative.odds)
            }
          : null,
        selectedSlot
      }
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
