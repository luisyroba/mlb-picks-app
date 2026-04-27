import { NextRequest } from 'next/server';
import { supabase } from '@/lib/db';
import { buildAuditMetrics } from '@/lib/audit-metrics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ExportPickRow = Record<string, unknown> & {
  id?: string;
  game_id?: string;
  snapshot_id?: string | null;
  market?: string | null;
  execution_market?: string | null;
  confidence?: string | null;
  status?: string | null;
  edge?: number | null;
  ev?: number | null;
  profit_units?: number | null;
  estimated_probability?: number | null;
  implied_probability?: number | null;
  execution_odds?: number | null;
  odds?: number | null;
  p_raw?: number | null;
  p_calibrated?: number | null;
  edge_raw?: number | null;
  edge_calibrated?: number | null;
  ev_raw?: number | null;
  ev_calibrated?: number | null;
};

type ExportSnapshotRow = Record<string, unknown> & {
  id?: string;
  game_id?: string;
};

const SNAPSHOT_EXPORT_COLUMNS = [
  'id',
  'game_id',
  'snapshot_stage',
  'sport',
  'game_status',
  'start_time',
  'created_at',
  'updated_at'
].join(',');

const MAX_SNAPSHOT_EXPORT_ROWS = 300;

type BucketSummary = {
  key: string;
  total: number;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  pending: number;
  profit_units: number;
  win_rate: number | null;
  avg_edge: number | null;
  avg_ev: number | null;
};

function isValidDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function roundMetric(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(4));
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function getEffectiveMarket(pick: ExportPickRow): string {
  const executionMarket = String(pick.execution_market ?? '').trim();
  const market = String(pick.market ?? '').trim();
  return executionMarket || market || 'UNKNOWN';
}

function getConfidenceKey(pick: ExportPickRow): string {
  const confidence = String(pick.confidence ?? '').trim();
  return confidence || 'UNKNOWN';
}

function getEdgeBucketKey(edge: unknown): string {
  if (typeof edge !== 'number' || !Number.isFinite(edge)) {
    return 'Sin edge';
  }

  if (edge < 0.02) return '<2%';
  if (edge < 0.04) return '2-4%';
  if (edge < 0.07) return '4-7%';
  return '7%+';
}

function createBucket(key: string): {
  summary: BucketSummary;
  edgeTotal: number;
  edgeCount: number;
  evTotal: number;
  evCount: number;
} {
  return {
    summary: {
      key,
      total: 0,
      settled: 0,
      wins: 0,
      losses: 0,
      voids: 0,
      pending: 0,
      profit_units: 0,
      win_rate: null,
      avg_edge: null,
      avg_ev: null
    },
    edgeTotal: 0,
    edgeCount: 0,
    evTotal: 0,
    evCount: 0
  };
}

function finalizeBucket(bucket: ReturnType<typeof createBucket>): BucketSummary {
  const graded = bucket.summary.wins + bucket.summary.losses;

  return {
    ...bucket.summary,
    profit_units: roundMetric(bucket.summary.profit_units) ?? 0,
    win_rate: graded > 0 ? roundMetric(bucket.summary.wins / graded) : null,
    avg_edge: bucket.edgeCount > 0 ? roundMetric(bucket.edgeTotal / bucket.edgeCount) : null,
    avg_ev: bucket.evCount > 0 ? roundMetric(bucket.evTotal / bucket.evCount) : null
  };
}

function buildStatsSummary(picks: ExportPickRow[]) {
  const byMarket = new Map<string, ReturnType<typeof createBucket>>();
  const byConfidence = new Map<string, ReturnType<typeof createBucket>>();
  const byEdgeBucket = new Map<string, ReturnType<typeof createBucket>>();

  let settledPicks = 0;
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let profitUnitsTotal = 0;

  for (const pick of picks) {
    const status = String(pick.status ?? 'pending');
    const profitUnits =
      typeof pick.profit_units === 'number' && Number.isFinite(pick.profit_units)
        ? pick.profit_units
        : 0;
    const edge =
      typeof pick.edge === 'number' && Number.isFinite(pick.edge)
        ? pick.edge
        : null;
    const ev =
      typeof pick.ev === 'number' && Number.isFinite(pick.ev)
        ? pick.ev
        : null;

    if (status !== 'pending') {
      settledPicks += 1;
    }

    if (status === 'won') wins += 1;
    if (status === 'lost') losses += 1;
    if (status === 'void') voids += 1;

    profitUnitsTotal += profitUnits;

    const marketKey = getEffectiveMarket(pick);
    const confidenceKey = getConfidenceKey(pick);
    const edgeBucketKey = getEdgeBucketKey(edge);

    if (!byMarket.has(marketKey)) {
      byMarket.set(marketKey, createBucket(marketKey));
    }

    if (!byConfidence.has(confidenceKey)) {
      byConfidence.set(confidenceKey, createBucket(confidenceKey));
    }

    if (!byEdgeBucket.has(edgeBucketKey)) {
      byEdgeBucket.set(edgeBucketKey, createBucket(edgeBucketKey));
    }

    for (const bucket of [
      byMarket.get(marketKey),
      byConfidence.get(confidenceKey),
      byEdgeBucket.get(edgeBucketKey)
    ]) {
      if (!bucket) continue;

      bucket.summary.total += 1;
      bucket.summary.profit_units += profitUnits;

      if (status !== 'pending') bucket.summary.settled += 1;
      if (status === 'won') bucket.summary.wins += 1;
      if (status === 'lost') bucket.summary.losses += 1;
      if (status === 'void') bucket.summary.voids += 1;
      if (status === 'pending') bucket.summary.pending += 1;

      if (edge !== null) {
        bucket.edgeTotal += edge;
        bucket.edgeCount += 1;
      }

      if (ev !== null) {
        bucket.evTotal += ev;
        bucket.evCount += 1;
      }
    }
  }

  const gradedPicks = wins + losses;

  return {
    total_picks: picks.length,
    settled_picks: settledPicks,
    wins,
    losses,
    voids,
    profit_units_total: roundMetric(profitUnitsTotal) ?? 0,
    win_rate: gradedPicks > 0 ? roundMetric(wins / gradedPicks) : null,
    roi: gradedPicks > 0 ? roundMetric(profitUnitsTotal / gradedPicks) : null,
    by_market: [...byMarket.values()]
      .map(finalizeBucket)
      .sort((left, right) => right.total - left.total),
    by_confidence: [...byConfidence.values()]
      .map(finalizeBucket)
      .sort((left, right) => right.total - left.total),
    by_edge_bucket: [...byEdgeBucket.values()]
      .map(finalizeBucket)
      .sort((left, right) => left.key.localeCompare(right.key))
  };
}

function enrichPickWithAuditMetrics(pick: ExportPickRow) {
  const computedMetrics = buildAuditMetrics({
    estimatedProbability:
      typeof pick.estimated_probability === 'number' && Number.isFinite(pick.estimated_probability)
        ? pick.estimated_probability
        : null,
    impliedProbability:
      typeof pick.implied_probability === 'number' && Number.isFinite(pick.implied_probability)
        ? pick.implied_probability
        : null,
    odds:
      typeof pick.execution_odds === 'number' && Number.isFinite(pick.execution_odds)
        ? pick.execution_odds
        : typeof pick.odds === 'number' && Number.isFinite(pick.odds)
          ? pick.odds
          : null,
    edge:
      typeof pick.edge === 'number' && Number.isFinite(pick.edge)
        ? pick.edge
        : null,
    ev:
      typeof pick.ev === 'number' && Number.isFinite(pick.ev)
        ? pick.ev
        : null
  });

  return {
    ...pick,
    p_raw:
      typeof pick.p_raw === 'number' && Number.isFinite(pick.p_raw)
        ? pick.p_raw
        : computedMetrics.p_raw,
    p_calibrated:
      typeof pick.p_calibrated === 'number' && Number.isFinite(pick.p_calibrated)
        ? pick.p_calibrated
        : computedMetrics.p_calibrated,
    edge_raw:
      typeof pick.edge_raw === 'number' && Number.isFinite(pick.edge_raw)
        ? pick.edge_raw
        : computedMetrics.edge_raw,
    edge_calibrated:
      typeof pick.edge_calibrated === 'number' && Number.isFinite(pick.edge_calibrated)
        ? pick.edge_calibrated
        : computedMetrics.edge_calibrated,
    ev_raw:
      typeof pick.ev_raw === 'number' && Number.isFinite(pick.ev_raw)
        ? pick.ev_raw
        : computedMetrics.ev_raw,
    ev_calibrated:
      typeof pick.ev_calibrated === 'number' && Number.isFinite(pick.ev_calibrated)
        ? pick.ev_calibrated
        : computedMetrics.ev_calibrated
  };
}

async function fetchPicksForRange(startDate: string, endDate: string): Promise<ExportPickRow[]> {
  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .eq('sport', 'MLB')
    .gte('game_day', startDate)
    .lte('game_day', endDate)
    .order('game_day', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch picks for audit export: ${error.message}`);
  }

  return Array.isArray(data) ? (data as ExportPickRow[]) : [];
}

async function fetchSnapshotsForPicks(picks: ExportPickRow[]): Promise<ExportSnapshotRow[]> {
  const gameIds = uniqueNonEmpty(picks.map((pick) => pick.game_id as string | null | undefined));
  const snapshotIds = uniqueNonEmpty(
    picks.map((pick) => pick.snapshot_id as string | null | undefined)
  );
  const snapshotsById = new Map<string, ExportSnapshotRow>();

  if (snapshotIds.length) {
    const { data, error } = await supabase
      .from('game_snapshots')
      .select(SNAPSHOT_EXPORT_COLUMNS)
      .in('id', snapshotIds)
      .order('created_at', { ascending: false })
      .limit(MAX_SNAPSHOT_EXPORT_ROWS);

    if (error) {
      throw new Error(`Failed to fetch game snapshots by snapshot id: ${error.message}`);
    }

    const rows = Array.isArray(data) ? (data as unknown as ExportSnapshotRow[]) : [];

    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (id) {
        snapshotsById.set(id, row);
      }
    }
  }

  if (gameIds.length && snapshotsById.size < MAX_SNAPSHOT_EXPORT_ROWS) {
    const remainingLimit = MAX_SNAPSHOT_EXPORT_ROWS - snapshotsById.size;
    const { data, error } = await supabase
      .from('game_snapshots')
      .select(SNAPSHOT_EXPORT_COLUMNS)
      .in('game_id', gameIds)
      .order('created_at', { ascending: false })
      .limit(remainingLimit);

    if (error) {
      throw new Error(`Failed to fetch game snapshots by game id: ${error.message}`);
    }

    const rows = Array.isArray(data) ? (data as unknown as ExportSnapshotRow[]) : [];

    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (id) {
        snapshotsById.set(id, row);
      }
    }
  }

  return [...snapshotsById.values()].sort((left, right) => {
    const leftCreatedAt = String(left.created_at ?? '');
    const rightCreatedAt = String(right.created_at ?? '');
    return rightCreatedAt.localeCompare(leftCreatedAt);
  });
}

export async function GET(req: NextRequest) {
  try {
    const startDate = req.nextUrl.searchParams.get('startDate');
    const endDate = req.nextUrl.searchParams.get('endDate');

    if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
      return Response.json(
        {
          ok: false,
          error: 'startDate y endDate deben usar formato YYYY-MM-DD'
        },
        { status: 400 }
      );
    }

    if (startDate > endDate) {
      return Response.json(
        {
          ok: false,
          error: 'startDate no puede ser mayor que endDate'
        },
        { status: 400 }
      );
    }

    const picks = await fetchPicksForRange(startDate, endDate);
    const exportedPicks = picks.map(enrichPickWithAuditMetrics);
    const gameSnapshots = await fetchSnapshotsForPicks(exportedPicks);
    const statsSummary = buildStatsSummary(exportedPicks);

    const payload = {
      metadata: {
        startDate,
        endDate,
        generatedAt: new Date().toISOString(),
        totalPicks: exportedPicks.length,
        totalSnapshots: gameSnapshots.length,
        snapshot_export_mode: 'metadata_only',
        snapshot_payload_included: false
      },
      stats_summary: statsSummary,
      picks: exportedPicks,
      game_snapshots: gameSnapshots
    };

    const fileName = `mlb-audit-${startDate}-${endDate}.json`;

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown audit export error'
      },
      { status: 500 }
    );
  }
}
