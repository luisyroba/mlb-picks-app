import { NextRequest, NextResponse } from 'next/server';
import { recalculateTodayF5Picks } from '@/lib/auto-settle-picks';

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

export async function POST(_req: NextRequest) {
  try {
    const { reverted, resettled } = await recalculateTodayF5Picks();

    const leftPending = reverted.length - resettled.length;

    const summary = resettled.map((p) =>
      `  [${p.status.toUpperCase()}] ${p.game_id} → ${p.result ?? '—'} (${roundMetric(p.profit_units) ?? 0}u)`
    );

    if (leftPending > 0) {
      summary.push(`  [PENDING] ${leftPending} pick(s) sin datos suficientes para liquidar aún`);
    }

    return NextResponse.json({
      ok: true,
      date: new Date().toISOString().slice(0, 10),
      reverted: reverted.length,
      resettled: resettled.length,
      leftPending,
      summary,
      picks: resettled.map((p) => ({
        id: p.id,
        gameId: p.game_id,
        status: p.status,
        result: p.result,
        profitUnits: roundMetric(p.profit_units)
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
