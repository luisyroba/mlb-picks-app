import { NextResponse } from 'next/server';
import {
  autoSettlePendingPicks,
  autoSettleRecentBackfill,
  revertIncorrectRecentAutoSettlements
} from '@/lib/auto-settle-picks';

export async function POST() {
  const startedAt = new Date().toISOString();

  try {
    const reverted = await revertIncorrectRecentAutoSettlements({ hours: 36, limit: 300 });
    const settled = await autoSettlePendingPicks();
    const backfilled = await autoSettleRecentBackfill({ days: 5, limit: 250 });

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      revertedCount: reverted.length,
      settledCount: settled.length,
      backfilledCount: backfilled.length
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        revertedCount: 0,
        settledCount: 0,
        backfilledCount: 0,
        error: 'No se pudo ejecutar el autosettlement live.'
      },
      { status: 500 }
    );
  }
}

