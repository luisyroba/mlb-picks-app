import { NextResponse } from 'next/server';

const ESPN_MLB_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const ESPN_SCOREBOARD_TIMEOUT_MS = 8000;

type EspnScoreboardEvent = {
  status?: {
    type?: {
      state?: string;
      completed?: boolean;
    };
  };
  competitions?: Array<{
    status?: {
      type?: {
        state?: string;
        completed?: boolean;
      };
    };
  }>;
};

type EspnScoreboardResponse = {
  events?: EspnScoreboardEvent[];
};

export async function GET() {
  try {
    const response = await fetch(ESPN_MLB_SCOREBOARD, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPN_SCOREBOARD_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`ESPN scoreboard request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as EspnScoreboardResponse;
    const liveCount = (payload.events ?? []).filter((event) => {
      const statusType = event.competitions?.[0]?.status?.type ?? event.status?.type;
      return statusType?.state === 'in' && !statusType?.completed;
    }).length;

    return NextResponse.json({
      ok: true,
      liveCount
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        ok: false,
        liveCount: 0,
        error: message
      },
      { status: 500 }
    );
  }
}
