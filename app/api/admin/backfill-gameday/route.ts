import { NextResponse } from 'next/server';
import { supabase, getPregameSnapshotsByIds } from '@/lib/db';

function deriveGameDaySantiago(startTime?: string | null): string | null {
  if (!startTime) return null;

  const normalized = startTime.includes('T')
    ? startTime
    : startTime.replace(' ', 'T');

  const date = new Date(normalized);

  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) return null;

  return `${year}-${month}-${day}`;
}

export async function POST() {
  try {
    const { data: nullPicks, error: fetchError } = await supabase
      .from('picks')
      .select('id, game_id, snapshot_id, created_at')
      .eq('sport', 'MLB')
      .is('game_day', null);

    if (fetchError) {
      return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 });
    }

    if (!nullPicks?.length) {
      return NextResponse.json({ ok: true, updated: 0, message: 'No hay picks con game_day null' });
    }

    const snapshotIds = nullPicks
      .map((p) => p.snapshot_id)
      .filter((id): id is string => Boolean(id));

    const snapshotsById = await getPregameSnapshotsByIds(snapshotIds);

    const updates: Array<{ id: string; game_day: string }> = [];

    for (const pick of nullPicks) {
      const snapshot = pick.snapshot_id ? snapshotsById.get(pick.snapshot_id) ?? null : null;
      const startTime = snapshot?.start_time ?? null;
      const gameDay = deriveGameDaySantiago(startTime);

      if (gameDay) {
        updates.push({ id: pick.id, game_day: gameDay });
      }
    }

    let updatedCount = 0;
    const errors: string[] = [];

    for (const update of updates) {
      const { error } = await supabase
        .from('picks')
        .update({ game_day: update.game_day, updated_at: new Date().toISOString() })
        .eq('id', update.id);

      if (error) {
        errors.push(`${update.id}: ${error.message}`);
      } else {
        updatedCount += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      found: nullPicks.length,
      updated: updatedCount,
      errors: errors.length ? errors : undefined,
      picks: updates
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
