import { NextResponse } from 'next/server';
import { getPickStorageSampleColumns, supabase } from '@/lib/db';

const SUPABASE_FREE_DB_LIMIT_MB = 500;

type StorageBreakdown = {
  key: string;
  rows: number;
  approxMb: number;
};

function roundMb(bytes: number): number {
  // Convierte bytes a MB con 3 decimales.
  return Number((bytes / (1024 * 1024)).toFixed(3));
}

function estimateTableBytes(rows: unknown[]): number {
  // Estimación simple del tamaño serializado en JSON.
  // Multiplicamos por 1.3 para sumar un poco de overhead.
  const rawBytes = rows.reduce<number>(
    (total, row) => total + Buffer.byteLength(JSON.stringify(row), 'utf8'),
    0
  );

  return Math.round(rawBytes * 1.3);
}

async function fetchTableRowCount(table: string): Promise<number> {
  // Cuenta filas sin traer todo el contenido.
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'planned', head: true });

  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

async function buildSampledTableEstimate(config: {
  table: string;
  label: string;
  sampleColumns: string;
  orderBy: string;
  sampleLimit: number;
}): Promise<{ key: string; rows: number; bytes: number }> {
  // Estimación por muestreo:
  // 1) contamos filas
  // 2) tomamos una muestra pequeña
  // 3) proyectamos tamaño promedio por fila
  const [rows, sampleRes] = await Promise.all([
    fetchTableRowCount(config.table),
    supabase
      .from(config.table)
      .select(config.sampleColumns)
      .order(config.orderBy, { ascending: false })
      .limit(config.sampleLimit)
  ]);

  if (sampleRes.error) {
    throw new Error(`Failed to sample ${config.table}: ${sampleRes.error.message}`);
  }

  const sampleRows = Array.isArray(sampleRes.data)
  ? (sampleRes.data as unknown as Record<string, unknown>[])
  : [];
  const averageBytes =
    sampleRows.length > 0 ? estimateTableBytes(sampleRows) / sampleRows.length : 0;

  return {
    key: config.label,
    rows,
    bytes: Math.round(rows * averageBytes)
  };
}

async function buildStorageEstimate() {
  // Estimamos tablas pesadas/relevantes del proyecto.
  const [picks, gameSnapshots, marketSnapshots, oddsCache] = await Promise.all([
    buildSampledTableEstimate({
      table: 'picks',
      label: 'Picks',
      sampleColumns: getPickStorageSampleColumns(),
      orderBy: 'updated_at',
      sampleLimit: 40
    }),
    buildSampledTableEstimate({
      table: 'game_snapshots',
      label: 'Game snapshots',
      sampleColumns:
        'id,game_id,snapshot_stage,game_status,start_time,sport,alerts,created_at,updated_at',
      orderBy: 'updated_at',
      sampleLimit: 12
    }),
    buildSampledTableEstimate({
      table: 'market_snapshots',
      label: 'Market snapshots',
      sampleColumns:
        'id,game_id,event_id,sport,home_team,away_team,home_ml,away_ml,home_rl_line,home_rl_odds,away_rl_line,away_rl_odds,total_line,over_odds,under_odds,source,created_at',
      orderBy: 'created_at',
      sampleLimit: 24
    }),
    buildSampledTableEstimate({
      table: 'odds_board_cache',
      label: 'Odds cache',
      sampleColumns: 'id,board_key,sport,source,created_at,updated_at',
      orderBy: 'updated_at',
      sampleLimit: 5
    })
  ]);

  // confirmed_picks se estima a partir de la muestra leída arriba.
  const breakdownRaw = [picks, gameSnapshots, marketSnapshots, oddsCache];

  const totalBytes = breakdownRaw.reduce((total, item) => total + item.bytes, 0);
  const estimatedUsedMb = roundMb(totalBytes);
  const remainingMb = Number(Math.max(0, SUPABASE_FREE_DB_LIMIT_MB - estimatedUsedMb).toFixed(3));

  return {
    ok: true,
    estimatedUsedMb,
    remainingMb,
    percentUsed: Number(((estimatedUsedMb / SUPABASE_FREE_DB_LIMIT_MB) * 100).toFixed(2)),
    breakdown: breakdownRaw.map<StorageBreakdown>((item) => ({
      key: item.key,
      rows: item.rows,
      approxMb: roundMb(item.bytes)
    })),
    note: 'Estimacion aproximada por muestreo. Excluye payloads pesados, indices y overhead real de PostgreSQL.'
  };
}

export async function GET() {
  try {
    // Este endpoint calcula solo storage.
    // Ya no frena la carga principal de /api/stats.
    const storage = await buildStorageEstimate();

    return NextResponse.json(storage);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        ok: false,
        estimatedUsedMb: 0,
        remainingMb: SUPABASE_FREE_DB_LIMIT_MB,
        percentUsed: 0,
        breakdown: [],
        note: `No se pudo estimar el uso de DB: ${message}`
      },
      { status: 500 }
    );
  }
}
