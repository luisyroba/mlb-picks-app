import { NextResponse } from 'next/server';
import {
  getPremiumDailyLock,
  closePremiumDailyLock,
  getPickStatusByGameId
} from '@/lib/db';
import { USER_TIMEZONE } from '@/lib/runtime-config';

function formatDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export async function GET() {
  try {
    const dateKey = formatDateKey();
    const lockPayload = await getPremiumDailyLock(dateKey).catch(() => null);

    if (!lockPayload) {
      return NextResponse.json({ ok: true, dateKey, isLocked: false, isClosed: false });
    }

    const p = lockPayload as Record<string, unknown>;

    if (p.closed === true) {
      return NextResponse.json({ ok: true, dateKey, isLocked: false, isClosed: true });
    }

    const lockedGameId = String(p.gameId ?? '');
    if (lockedGameId) {
      const lockedStatus = await getPickStatusByGameId(lockedGameId).catch(() => null);
      if (lockedStatus && lockedStatus !== 'pending') {
        await closePremiumDailyLock(dateKey, p).catch(() => null);
        return NextResponse.json({ ok: true, dateKey, isLocked: false, isClosed: true });
      }
    }

    return NextResponse.json({ ok: true, dateKey, isLocked: true, isClosed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, isLocked: false, isClosed: false, error: message },
      { status: 500 }
    );
  }
}
