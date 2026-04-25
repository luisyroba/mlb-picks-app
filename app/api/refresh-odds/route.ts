// app/api/refresh-odds/route.ts

import { NextResponse } from 'next/server';
import { fetchMlbMarketLines } from '@/lib/market-lines';
import { getOddsBoardCache, saveOddsBoardCache } from '@/lib/db';
import { ODDS_REFRESH_COOLDOWN_MS } from '@/lib/runtime-config';

const BOARD_KEY = 'mlb_main';

function getAgeMs(updatedAt?: string | null): number | null {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Date.now() - ms;
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { ok: false, error: 'Not found' },
      { status: 404 }
    );
  }

  try {
    const existing = await getOddsBoardCache(BOARD_KEY);
    const ageMs = getAgeMs(existing?.updated_at ?? null);

    if (ageMs !== null && ageMs < ODDS_REFRESH_COOLDOWN_MS) {
      return NextResponse.json({
        ok: true,
        refreshed: false,
        reason: 'Cooldown active',
        boardKey: BOARD_KEY,
        updatedAt: existing?.updated_at ?? null,
        ageMs,
        cooldownMs: ODDS_REFRESH_COOLDOWN_MS
      });
    }

    const fresh = await fetchMlbMarketLines();

    const saved = await saveOddsBoardCache({
      boardKey: BOARD_KEY,
      sport: 'MLB',
      payload: fresh as Record<string, unknown>,
      source: 'sportsgameodds'
    });

    return NextResponse.json({
      ok: true,
      refreshed: true,
      boardKey: BOARD_KEY,
      updatedAt: saved.updated_at
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
