import { NextRequest, NextResponse } from 'next/server';
import { settlePickRecord } from '@/lib/db';

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const pickId = String(body?.pickId ?? '').trim();
    const gameId = String(body?.gameId ?? '').trim();
    const status = String(body?.status ?? '').trim().toLowerCase();
    const result =
      typeof body?.result === 'string' && body.result.trim().length > 0
        ? body.result.trim()
        : null;

    const profitUnits =
      typeof body?.profitUnits === 'number'
        ? body.profitUnits
        : body?.profitUnits === null || body?.profitUnits === undefined
          ? null
          : Number(body?.profitUnits);

    if (!pickId && !gameId) {
      return NextResponse.json(
        { ok: false, error: 'Missing pickId or gameId' },
        { status: 400 }
      );
    }

    if (
      status !== 'pending' &&
      status !== 'won' &&
      status !== 'lost' &&
      status !== 'void'
    ) {
      return NextResponse.json(
        { ok: false, error: 'Invalid status' },
        { status: 400 }
      );
    }

    if (
      profitUnits !== null &&
      (!Number.isFinite(profitUnits) || Number.isNaN(profitUnits))
    ) {
      return NextResponse.json(
        { ok: false, error: 'Invalid profitUnits' },
        { status: 400 }
      );
    }

    const settledPick = await settlePickRecord({
      pickId: pickId || undefined,
      gameId: gameId || undefined,
      status,
      result: result ?? status.toUpperCase(),
      profitUnits
    });

    return NextResponse.json({
      ok: true,
      pick: {
        id: settledPick.id,
        gameId: settledPick.game_id,
        status: settledPick.status,
        result: settledPick.result,
        profitUnits: roundMetric(settledPick.profit_units),
        updatedAt: settledPick.updated_at
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
