import { NextRequest, NextResponse } from 'next/server';
import { settlePickRecord, supabase } from '@/lib/db';
import { fetchEspnMlbSummary } from '@/lib/espn';

type ManualSettleStatus = 'won' | 'lost';

type ManualSettleBody = {
  pickId?: unknown;
  status?: unknown;
};

function isManualSettleStatus(value: unknown): value is ManualSettleStatus {
  return value === 'won' || value === 'lost';
}

function calculateProfitUnits(status: ManualSettleStatus, odds?: number | null): number {
  if (status === 'won') {
    if (typeof odds !== 'number' || !Number.isFinite(odds) || odds <= 1) {
      return 0;
    }

    return Number((odds - 1).toFixed(3));
  }

  return -1;
}

function normalizeMarket(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function readRunsFromLine(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { value?: unknown; displayValue?: unknown };
  if (typeof candidate.value === 'number' && Number.isFinite(candidate.value)) {
    return candidate.value;
  }

  if (typeof candidate.displayValue === 'string') {
    const parsed = Number(candidate.displayValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readCompetitorScore(competitor: unknown): number | null {
  if (!competitor || typeof competitor !== 'object') {
    return null;
  }

  const score = (competitor as { score?: unknown }).score;
  if (typeof score === 'number' && Number.isFinite(score)) {
    return score;
  }

  if (typeof score === 'string') {
    const parsed = Number(score);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getFirstFiveRuns(competitor: unknown): number | null {
  if (!competitor || typeof competitor !== 'object') {
    return null;
  }

  const linescores = (competitor as { linescores?: unknown[] }).linescores;
  if (!Array.isArray(linescores) || linescores.length < 5) {
    return null;
  }

  const firstFive = linescores
    .slice(0, 5)
    .map((line) => readRunsFromLine(line));

  if (firstFive.some((runs) => runs === null)) {
    return null;
  }

  return (firstFive as number[]).reduce((total, runs) => total + runs, 0);
}

async function buildManualResultLabel(
  gameId: string,
  market: string,
  status: ManualSettleStatus
): Promise<string> {
  const fallback = `MANUAL_${status.toUpperCase()}`;

  try {
    const summary = await fetchEspnMlbSummary(gameId);
    const competition = summary.header?.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    const home = competitors.find((competitor) => competitor.homeAway === 'home');
    const away = competitors.find((competitor) => competitor.homeAway === 'away');
    const statusType = competition?.status?.type ?? summary.header?.status?.type;
    const statusText = [
      statusType?.description,
      statusType?.detail,
      statusType?.shortDetail
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase();
    const isGameFinal =
      Boolean(statusType?.completed) ||
      String(statusType?.state ?? '').toLowerCase() === 'post' ||
      statusText.includes('final') ||
      statusText.includes('game over') ||
      statusText.includes('completed early');

    if (market === 'F5') {
      const homeRuns = getFirstFiveRuns(home);
      const awayRuns = getFirstFiveRuns(away);

      if (homeRuns === null || awayRuns === null) {
        return fallback;
      }

      return `AUTO_${status.toUpperCase()} F5 ${awayRuns}-${homeRuns}`;
    }

    if (market === 'TOTAL' && isGameFinal) {
      const finalHomeRuns = readCompetitorScore(home);
      const finalAwayRuns = readCompetitorScore(away);

      if (finalHomeRuns === null || finalAwayRuns === null) {
        return fallback;
      }

      return `AUTO_${status.toUpperCase()} TOTAL ${finalAwayRuns}-${finalHomeRuns}`;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ManualSettleBody;
    const pickId = typeof body?.pickId === 'string' ? body.pickId.trim() : '';
    const status = typeof body?.status === 'string' ? body.status.trim().toLowerCase() : '';

    if (!pickId) {
      return NextResponse.json(
        { ok: false, error: 'Missing pickId' },
        { status: 400 }
      );
    }

    if (!isManualSettleStatus(status)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid status. Use won or lost.' },
        { status: 400 }
      );
    }

    const { data: existingPick, error: fetchError } = await supabase
      .from('picks')
      .select('id, game_id, market, execution_market, odds, execution_odds, status')
      .eq('id', pickId)
      .eq('sport', 'MLB')
      .single();

    if (fetchError) {
      const notFound =
        fetchError.code === 'PGRST116' ||
        fetchError.message.toLowerCase().includes('0 rows');

      if (notFound) {
        return NextResponse.json(
          { ok: false, error: 'Pick not found' },
          { status: 404 }
        );
      }

      throw new Error(fetchError.message);
    }

    const market = normalizeMarket(existingPick.execution_market ?? existingPick.market);
    const result = await buildManualResultLabel(existingPick.game_id, market, status);

    const settledPick = await settlePickRecord({
      pickId,
      status,
      result,
      profitUnits: calculateProfitUnits(
        status,
        existingPick.execution_odds ?? existingPick.odds
      )
    });

    return NextResponse.json({
      ok: true,
      pick: {
        id: settledPick.id,
        status: settledPick.status,
        result: settledPick.result,
        profitUnits: settledPick.profit_units,
        updatedAt: settledPick.updated_at
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to settle pick manually';

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
