// lib/db.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey
);

const MARKET_SNAPSHOT_COLUMNS = [
  'id',
  'game_id',
  'event_id',
  'sport',
  'home_team',
  'away_team',
  'home_ml',
  'away_ml',
  'home_rl_line',
  'home_rl_odds',
  'away_rl_line',
  'away_rl_odds',
  'total_line',
  'over_odds',
  'under_odds',
  'source',
  'created_at'
].join(',');

const PREGAME_SNAPSHOT_COLUMNS = [
  'id',
  'game_id',
  'snapshot_stage',
  'sport',
  'game_status',
  'start_time',
  'payload',
  'alerts',
  'created_at',
  'updated_at'
].join(',');

const PREGAME_SNAPSHOT_METADATA_COLUMNS = [
  'id',
  'game_id',
  'snapshot_stage',
  'sport',
  'game_status',
  'start_time',
  'created_at',
  'updated_at'
].join(',');

const PICK_COLUMNS = [
  'id',
  'game_id',
  'snapshot_id',
  'snapshot_stage',
  'sport',
  'market',
  'selection',
  'line',
  'odds',
  'confidence',
  'estimated_probability',
  'implied_probability',
  'edge',
  'ev',
  'reason',
  'alt_market_1',
  'alt_market_2',
  'execution_market',
  'execution_selection',
  'execution_line',
  'execution_odds',
  'execution_side',
  'execution_reason',
  'status',
  'result',
  'profit_units',
  'game_day',
  'created_at',
  'updated_at'
].join(',');

const PICK_ANALYSIS_COLUMNS = [
  'id',
  'game_id',
  'market',
  'selection',
  'line',
  'odds',
  'confidence',
  'estimated_probability',
  'edge',
  'ev',
  'execution_market',
  'execution_selection',
  'execution_line',
  'execution_odds',
  'status',
  'updated_at'
].join(',');

const PICK_STORAGE_SAMPLE_COLUMNS = [
  'id',
  'game_id',
  'snapshot_id',
  'snapshot_stage',
  'sport',
  'market',
  'selection',
  'line',
  'odds',
  'confidence',
  'estimated_probability',
  'implied_probability',
  'edge',
  'ev',
  'execution_market',
  'execution_selection',
  'execution_line',
  'execution_odds',
  'execution_side',
  'status',
  'result',
  'profit_units',
  'game_day',
  'created_at',
  'updated_at'
].join(',');

const PICK_LEDGER_COLUMNS = [
  'id',
  'game_id',
  'snapshot_id',
  'market',
  'selection',
  'line',
  'odds',
  'confidence',
  'estimated_probability',
  'implied_probability',
  'edge',
  'ev',
  'reason',
  'execution_market',
  'execution_selection',
  'execution_line',
  'execution_odds',
  'execution_reason',
  'status',
  'result',
  'profit_units',
  'game_day',
  'created_at',
  'updated_at'
].join(',');

const PICK_STATS_COLUMNS = [
  'id',
  'game_id',
  'snapshot_id',
  'market',
  'selection',
  'line',
  'odds',
  'confidence',
  'estimated_probability',
  'implied_probability',
  'edge',
  'ev',
  'execution_market',
  'execution_selection',
  'execution_line',
  'execution_odds',
  'status',
  'profit_units',
  'game_day',
  'closing_odds',
  'closing_line',
  'closing_market',
  'closing_selection',
  'closing_source',
  'closing_snapshot_id',
  'closing_captured_at',
  'clv_decimal',
  'clv_percent',
  'clv_status',
  'clv_notes',
  'created_at',
  'updated_at'
].join(',');

const PICK_STATS_FALLBACK_COLUMNS = [
  'id',
  'game_id',
  'snapshot_id',
  'market',
  'selection',
  'line',
  'odds',
  'confidence',
  'estimated_probability',
  'implied_probability',
  'edge',
  'ev',
  'execution_market',
  'execution_selection',
  'execution_line',
  'execution_odds',
  'status',
  'profit_units',
  'game_day',
  'created_at',
  'updated_at'
].join(',');

const PICK_CLV_CAPTURE_COLUMNS = [
  'id',
  'game_id',
  'snapshot_id',
  'market',
  'selection',
  'line',
  'confidence',
  'execution_market',
  'execution_selection',
  'execution_line',
  'execution_odds',
  'execution_side',
  'status',
  'game_day',
  'closing_odds',
  'closing_line',
  'closing_market',
  'closing_selection',
  'closing_source',
  'closing_snapshot_id',
  'closing_captured_at',
  'clv_decimal',
  'clv_percent',
  'clv_status',
  'clv_notes',
  'created_at',
  'updated_at'
].join(',');

const ODDS_BOARD_CACHE_COLUMNS = [
  'id',
  'board_key',
  'sport',
  'payload',
  'source',
  'created_at',
  'updated_at'
].join(',');

const ODDS_BOARD_CACHE_METADATA_COLUMNS = [
  'id',
  'board_key',
  'sport',
  'source',
  'created_at',
  'updated_at'
].join(',');

const CLV_SNAPSHOT_COLUMNS = [
  'id',
  'game_id',
  'snapshot_stage',
  'start_time',
  'payload',
  'created_at',
  'updated_at'
].join(',');

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export type MarketSnapshotInput = {
  gameId: string;
  eventId?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;

  homeML?: number | null;
  awayML?: number | null;

  homeRLLine?: number | null;
  homeRLOdds?: number | null;
  awayRLLine?: number | null;
  awayRLOdds?: number | null;

  totalLine?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;

  source?: string;
};

export type MarketSnapshotRow = {
  id: string;
  game_id: string;
  event_id: string | null;
  sport: string;
  home_team: string | null;
  away_team: string | null;

  home_ml: number | null;
  away_ml: number | null;

  home_rl_line: number | null;
  home_rl_odds: number | null;
  away_rl_line: number | null;
  away_rl_odds: number | null;

  total_line: number | null;
  over_odds: number | null;
  under_odds: number | null;

  source: string;
  created_at: string;
};

export type SnapshotStage = 'open' | 'mid' | 'final';

export type PregameSnapshotInput = {
  gameId: string;
  snapshotStage: SnapshotStage;
  sport?: 'MLB';
  gameStatus?: string | null;
  startTime?: string | null;
  payload: Record<string, unknown>;
  alerts?: Array<Record<string, unknown> | string>;
};

export type PregameSnapshotRow = {
  id: string;
  game_id: string;
  snapshot_stage: SnapshotStage;
  sport: string;
  game_status: string | null;
  start_time: string | null;
  payload: Record<string, unknown>;
  alerts: Array<Record<string, unknown> | string>;
  created_at: string;
  updated_at: string;
};

export type PregameSnapshotMetadataRow = Omit<PregameSnapshotRow, 'payload' | 'alerts'>;

export type PickRecordUpsertInput = {
  gameDay?: string | null;
  gameId: string;
  snapshotId?: string | null;
  snapshotStage?: SnapshotStage | null;
  sport: 'MLB';

  market: string;
  selection: string;
  line?: number | null;
  odds?: number | null;

  confidence: string;
  estimatedProbability?: number | null;
  impliedProbability?: number | null;
  edge?: number | null;
  ev?: number | null;
  pRaw?: number | null;
  pCalibrated?: number | null;
  edgeRaw?: number | null;
  edgeCalibrated?: number | null;
  evRaw?: number | null;
  evCalibrated?: number | null;

  reason: string;
  altMarket1?: string | null;
  altMarket2?: string | null;

  executionMarket?: string | null;
  executionSelection?: string | null;
  executionLine?: number | null;
  executionOdds?: number | null;
  executionSide?: string | null;
  executionReason?: string | null;

  status?: 'pending' | 'won' | 'lost' | 'void';
  result?: string | null;
  profitUnits?: number | null;
};

export type PickRow = {
  game_day: string | null;
  id: string;
  game_id: string;
  snapshot_id: string | null;
  snapshot_stage: string | null;
  sport: string;

  market: string;
  selection: string;
  line: number | null;
  odds: number | null;

  confidence: string;
  estimated_probability: number | null;
  implied_probability: number | null;
  edge: number | null;
  ev: number | null;
  p_raw?: number | null;
  p_calibrated?: number | null;
  edge_raw?: number | null;
  edge_calibrated?: number | null;
  ev_raw?: number | null;
  ev_calibrated?: number | null;

  reason: string;
  alt_market_1: string | null;
  alt_market_2: string | null;

  execution_market: string | null;
  execution_selection: string | null;
  execution_line: number | null;
  execution_odds: number | null;
  execution_side: string | null;
  execution_reason: string | null;

  status: string;
  result: string | null;
  profit_units: number | null;

  closing_odds?: number | null;
  closing_line?: number | null;
  closing_market?: string | null;
  closing_selection?: string | null;
  closing_source?: string | null;
  closing_snapshot_id?: string | null;
  closing_captured_at?: string | null;
  clv_decimal?: number | null;
  clv_percent?: number | null;
  clv_status?: 'positive' | 'negative' | 'neutral' | 'unavailable' | string | null;
  clv_notes?: string | null;

  created_at: string;
  updated_at: string;
};

export type PickAnalysisSummaryRow = Pick<
  PickRow,
  | 'id'
  | 'game_id'
  | 'market'
  | 'selection'
  | 'line'
  | 'odds'
  | 'confidence'
  | 'estimated_probability'
  | 'edge'
  | 'ev'
  | 'execution_market'
  | 'execution_selection'
  | 'execution_line'
  | 'execution_odds'
  | 'status'
  | 'updated_at'
>;

export type PickLedgerRow = Pick<PickRow,
  | 'id'
  | 'game_id'
  | 'snapshot_id'
  | 'market'
  | 'selection'
  | 'line'
  | 'odds'
  | 'confidence'
  | 'estimated_probability'
  | 'implied_probability'
  | 'edge'
  | 'ev'
  | 'reason'
  | 'execution_market'
  | 'execution_selection'
  | 'execution_line'
  | 'execution_odds'
  | 'execution_reason'
  | 'status'
  | 'result'
  | 'profit_units'
  | 'game_day'
  | 'created_at'
  | 'updated_at'
>;

export type LedgerPickListOptions = {
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
};

export type PickStatsRow = Pick<PickRow,
  | 'id'
  | 'game_id'
  | 'snapshot_id'
  | 'market'
  | 'selection'
  | 'line'
  | 'odds'
  | 'confidence'
  | 'estimated_probability'
  | 'implied_probability'
  | 'edge'
  | 'ev'
  | 'execution_market'
  | 'execution_selection'
  | 'execution_line'
  | 'execution_odds'
  | 'status'
  | 'profit_units'
  | 'game_day'
  | 'closing_odds'
  | 'closing_line'
  | 'closing_market'
  | 'closing_selection'
  | 'closing_source'
  | 'closing_snapshot_id'
  | 'closing_captured_at'
  | 'clv_decimal'
  | 'clv_percent'
  | 'clv_status'
  | 'clv_notes'
  | 'created_at'
  | 'updated_at'
>;

export type PickClvCaptureRow = Pick<PickRow,
  | 'id'
  | 'game_id'
  | 'snapshot_id'
  | 'market'
  | 'selection'
  | 'line'
  | 'confidence'
  | 'execution_market'
  | 'execution_selection'
  | 'execution_line'
  | 'execution_odds'
  | 'execution_side'
  | 'status'
  | 'game_day'
  | 'closing_odds'
  | 'closing_line'
  | 'closing_market'
  | 'closing_selection'
  | 'closing_source'
  | 'closing_snapshot_id'
  | 'closing_captured_at'
  | 'clv_decimal'
  | 'clv_percent'
  | 'clv_status'
  | 'clv_notes'
  | 'created_at'
  | 'updated_at'
>;

export type PickClvUpdateInput = {
  closing_odds: number | null;
  closing_line: number | null;
  closing_market: string | null;
  closing_selection: string | null;
  closing_source: string | null;
  closing_snapshot_id: string | null;
  closing_captured_at: string;
  clv_decimal: number | null;
  clv_percent: number | null;
  clv_status: 'positive' | 'negative' | 'neutral' | 'unavailable';
  clv_notes: string | null;
};

function assertSingleRow<T>(
  data: unknown,
  entityName: string
): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid ${entityName} row returned from database.`);
  }

  return data as T;
}

function assertRowArray<T>(
  data: unknown,
  entityName: string
): T[] {
  if (
    !Array.isArray(data) ||
    data.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new Error(`Invalid ${entityName} rows returned from database.`);
  }

  return data as T[];
}

function isMissingClvColumnError(error: { message?: string } | null | undefined): boolean {
  return Boolean(
    error?.message &&
      /closing_odds|closing_line|closing_market|closing_selection|closing_source|closing_snapshot_id|closing_captured_at|clv_decimal|clv_percent|clv_status|clv_notes/i.test(error.message) &&
      /column|schema cache|could not find|does not exist/i.test(error.message)
  );
}

function readPickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPickNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isNoBetLikePickRecord(
  pick: Partial<PickRow> | Record<string, unknown> | null | undefined
): boolean {
  if (!pick) return true;

  const market = readPickString(
    'execution_market' in pick ? pick.execution_market : undefined
  ) || readPickString('market' in pick ? pick.market : undefined);
  const selection = readPickString(
    'execution_selection' in pick ? pick.execution_selection : undefined
  ) || readPickString('selection' in pick ? pick.selection : undefined);

  return market.toUpperCase() === 'PASS' || selection.toUpperCase() === 'NO BET';
}

export function isConfirmedPickRecord(
  pick: Partial<PickRow> | Record<string, unknown> | null | undefined
): boolean {
  if (!pick || isNoBetLikePickRecord(pick)) return false;

  const status = 'status' in pick ? String(pick.status ?? '') : '';
  if (status === 'won' || status === 'lost' || status === 'void') return true;

  const executionSelection = readPickString(
    'execution_selection' in pick ? pick.execution_selection : undefined
  );
  const executionMarket = readPickString(
    'execution_market' in pick ? pick.execution_market : undefined
  );
  const executionOdds = readPickNumber(
    'execution_odds' in pick ? pick.execution_odds : undefined
  );

  return Boolean(executionSelection || executionMarket || executionOdds);
}

export async function saveMarketSnapshot(
  snapshot: MarketSnapshotInput
) {
  const { error } = await supabase
    .from('market_snapshots')
    .insert({
      game_id: snapshot.gameId,
      event_id: snapshot.eventId ?? null,

      home_team: snapshot.homeTeam ?? null,
      away_team: snapshot.awayTeam ?? null,

      home_ml: snapshot.homeML ?? null,
      away_ml: snapshot.awayML ?? null,

      home_rl_line: snapshot.homeRLLine ?? null,
      home_rl_odds: snapshot.homeRLOdds ?? null,
      away_rl_line: snapshot.awayRLLine ?? null,
      away_rl_odds: snapshot.awayRLOdds ?? null,

      total_line: snapshot.totalLine ?? null,
      over_odds: snapshot.overOdds ?? null,
      under_odds: snapshot.underOdds ?? null,

      source: snapshot.source ?? 'sportsgameodds'
    });

  if (error) {
    throw new Error(`Failed to save market snapshot: ${error.message}`);
  }
}

export async function getLatestMarketSnapshot(
  gameId: string
): Promise<MarketSnapshotRow | null> {
  const { data, error } = await supabase
    .from('market_snapshots')
    .select(MARKET_SNAPSHOT_COLUMNS)
    .eq('game_id', gameId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest market snapshot: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return assertSingleRow<MarketSnapshotRow>(data, 'market snapshot');
}

export async function getLatestMarketSnapshotsByGameIds(
  gameIds: string[]
): Promise<Map<string, MarketSnapshotRow>> {
  const uniqueIds = uniqueNonEmpty(gameIds);
  if (!uniqueIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('market_snapshots')
    .select(MARKET_SNAPSHOT_COLUMNS)
    .in('game_id', uniqueIds)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch market snapshots for games: ${error.message}`);
  }

  const rows = data
    ? assertRowArray<MarketSnapshotRow>(data, 'market snapshot')
    : [];
  const latestByGameId = new Map<string, MarketSnapshotRow>();

  for (const row of rows) {
    if (!latestByGameId.has(row.game_id)) {
      latestByGameId.set(row.game_id, row);
    }
  }

  return latestByGameId;
}

export async function getMarketSnapshotWindow(
  gameId: string
): Promise<{
  first: MarketSnapshotRow | null;
  latest: MarketSnapshotRow | null;
  count: number;
}> {
  const [firstRes, latestRes, countRes] = await Promise.all([
    supabase
      .from('market_snapshots')
      .select(MARKET_SNAPSHOT_COLUMNS)
      .eq('game_id', gameId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('market_snapshots')
      .select(MARKET_SNAPSHOT_COLUMNS)
      .eq('game_id', gameId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('market_snapshots')
      .select('id', { count: 'planned', head: true })
      .eq('game_id', gameId)
  ]);

  if (firstRes.error) {
    throw new Error(`Failed to fetch first market snapshot: ${firstRes.error.message}`);
  }

  if (latestRes.error) {
    throw new Error(`Failed to fetch latest market snapshot: ${latestRes.error.message}`);
  }

  if (countRes.error) {
    throw new Error(`Failed to count market snapshots: ${countRes.error.message}`);
  }

  return {
    first: firstRes.data
      ? assertSingleRow<MarketSnapshotRow>(firstRes.data, 'market snapshot')
      : null,
    latest: latestRes.data
      ? assertSingleRow<MarketSnapshotRow>(latestRes.data, 'market snapshot')
      : null,
    count: countRes.count ?? 0
  };
}

export async function savePregameSnapshot(
  input: PregameSnapshotInput
): Promise<PregameSnapshotRow> {
  const { data, error } = await supabase
    .from('game_snapshots')
    .upsert(
      {
        game_id: input.gameId,
        snapshot_stage: input.snapshotStage,
        sport: input.sport ?? 'MLB',
        game_status: input.gameStatus ?? null,
        start_time: input.startTime ?? null,
        payload: input.payload,
        alerts: input.alerts ?? [],
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'game_id,snapshot_stage'
      }
    )
    .select(PREGAME_SNAPSHOT_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to save pregame snapshot: ${error.message}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Failed to save pregame snapshot: invalid snapshot row returned');
  }

 return assertSingleRow<PregameSnapshotRow>(data, 'pregame snapshot');
}

export async function getPregameSnapshotByStage(
  gameId: string,
  snapshotStage: SnapshotStage
): Promise<PregameSnapshotRow | null> {
  const { data, error } = await supabase
    .from('game_snapshots')
    .select(PREGAME_SNAPSHOT_COLUMNS)
    .eq('game_id', gameId)
    .eq('snapshot_stage', snapshotStage)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch ${snapshotStage} snapshot: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return assertSingleRow<PregameSnapshotRow>(data, 'pregame snapshot');
}

export async function getPregameSnapshotById(
  snapshotId: string
): Promise<PregameSnapshotRow | null> {
  const { data, error } = await supabase
    .from('game_snapshots')
    .select(PREGAME_SNAPSHOT_COLUMNS)
    .eq('id', snapshotId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch snapshot by id: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return assertSingleRow<PregameSnapshotRow>(data, 'pregame snapshot');
}

export async function getPregameSnapshotsForGame(
  gameId: string
): Promise<{
  open: PregameSnapshotRow | null;
  mid: PregameSnapshotRow | null;
  final: PregameSnapshotRow | null;
}> {
  const { data, error } = await supabase
    .from('game_snapshots')
    .select(PREGAME_SNAPSHOT_COLUMNS)
    .eq('game_id', gameId);

  if (error) {
    throw new Error(`Failed to fetch pregame snapshots: ${error.message}`);
  }

  const rows = assertRowArray<PregameSnapshotRow>(data, 'pregame snapshot');

  return {
    open: rows.find((row) => row.snapshot_stage === 'open') ?? null,
    mid: rows.find((row) => row.snapshot_stage === 'mid') ?? null,
    final: rows.find((row) => row.snapshot_stage === 'final') ?? null
  };
}

export async function getPregameSnapshotsByIds(
  snapshotIds: string[]
): Promise<Map<string, PregameSnapshotRow>> {
  const uniqueIds = uniqueNonEmpty(snapshotIds);
  if (!uniqueIds.length) {
    return new Map<string, PregameSnapshotRow>();
  }

  const { data, error } = await supabase
    .from('game_snapshots')
    .select(PREGAME_SNAPSHOT_COLUMNS)
    .in('id', uniqueIds);

  if (error) {
    throw new Error(`Failed to fetch snapshots by ids: ${error.message}`);
  }

  const rows = data
    ? assertRowArray<PregameSnapshotRow>(data, 'pregame snapshot')
    : [];

  return new Map(rows.map((row) => [row.id, row]));
}

export async function getPregameSnapshotMetadataByIds(
  snapshotIds: string[]
): Promise<Map<string, PregameSnapshotMetadataRow>> {
  const uniqueIds = uniqueNonEmpty(snapshotIds);
  if (!uniqueIds.length) {
    return new Map<string, PregameSnapshotMetadataRow>();
  }

  const { data, error } = await supabase
    .from('game_snapshots')
    .select(PREGAME_SNAPSHOT_METADATA_COLUMNS)
    .in('id', uniqueIds);

  if (error) {
    throw new Error(`Failed to fetch snapshot metadata by ids: ${error.message}`);
  }

  const rows = data
    ? assertRowArray<PregameSnapshotMetadataRow>(data, 'pregame snapshot metadata')
    : [];

  return new Map(rows.map((row) => [row.id, row]));
}

export async function getPregameSnapshotsForGames(
  gameIds: string[]
): Promise<
  Map<
    string,
    {
      open: PregameSnapshotRow | null;
      mid: PregameSnapshotRow | null;
      final: PregameSnapshotRow | null;
    }
  >
> {
  const uniqueIds = uniqueNonEmpty(gameIds);
  if (!uniqueIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('game_snapshots')
    .select(PREGAME_SNAPSHOT_COLUMNS)
    .in('game_id', uniqueIds);

  if (error) {
    throw new Error(`Failed to fetch pregame snapshots for games: ${error.message}`);
  }

  const rows = data
  ? assertRowArray<PregameSnapshotRow>(data, 'pregame snapshot')
  : [];
  const grouped = new Map<
    string,
    {
      open: PregameSnapshotRow | null;
      mid: PregameSnapshotRow | null;
      final: PregameSnapshotRow | null;
    }
  >();

  for (const gameId of uniqueIds) {
    grouped.set(gameId, {
      open: null,
      mid: null,
      final: null
    });
  }

  for (const row of rows) {
    const current = grouped.get(row.game_id) ?? {
      open: null,
      mid: null,
      final: null
    };

    if (row.snapshot_stage === 'open') current.open = row;
    if (row.snapshot_stage === 'mid') current.mid = row;
    if (row.snapshot_stage === 'final') current.final = row;

    grouped.set(row.game_id, current);
  }

  return grouped;
}

export async function upsertPickRecord(
  input: PickRecordUpsertInput
): Promise<PickRow> {
  const basePayload = {
    game_day: input.gameDay ?? null,
    game_id: input.gameId,
    snapshot_id: input.snapshotId ?? null,
    snapshot_stage: input.snapshotStage ?? null,
    sport: input.sport,

    market: input.market,
    selection: input.selection,
    line: input.line ?? null,
    odds: input.odds ?? null,

    confidence: input.confidence,
    estimated_probability: input.estimatedProbability ?? null,
    implied_probability: input.impliedProbability ?? null,
    edge: input.edge ?? null,
    ev: input.ev ?? null,

    reason: input.reason,
    alt_market_1: input.altMarket1 ?? null,
    alt_market_2: input.altMarket2 ?? null,

    execution_market: input.executionMarket ?? null,
    execution_selection: input.executionSelection ?? null,
    execution_line: input.executionLine ?? null,
    execution_odds: input.executionOdds ?? null,
    execution_side: input.executionSide ?? null,
    execution_reason: input.executionReason ?? null,

    status: input.status ?? 'pending',
    result: input.result ?? null,
    profit_units: input.profitUnits ?? null,

    updated_at: new Date().toISOString()
  };

  const auditPayload = {
    ...basePayload,
    p_raw: input.pRaw ?? null,
    p_calibrated: input.pCalibrated ?? null,
    edge_raw: input.edgeRaw ?? null,
    edge_calibrated: input.edgeCalibrated ?? null,
    ev_raw: input.evRaw ?? null,
    ev_calibrated: input.evCalibrated ?? null
  };

  const hasAuditMetrics =
    input.pRaw !== undefined ||
    input.pCalibrated !== undefined ||
    input.edgeRaw !== undefined ||
    input.edgeCalibrated !== undefined ||
    input.evRaw !== undefined ||
    input.evCalibrated !== undefined;

  const runUpsert = async (payload: typeof basePayload | typeof auditPayload) =>
    supabase
      .from('picks')
      .upsert(payload, {
        onConflict: 'game_id'
      })
      .select(PICK_COLUMNS)
      .single();

  let { data, error } = await runUpsert(hasAuditMetrics ? auditPayload : basePayload);

  const errorMessage = error?.message ?? '';
  const isMissingAuditColumnError =
    /p_raw|p_calibrated|edge_raw|edge_calibrated|ev_raw|ev_calibrated/i.test(errorMessage) &&
    /column|schema cache|Could not find/i.test(errorMessage);

  if (error && hasAuditMetrics && isMissingAuditColumnError) {
    ({ data, error } = await runUpsert(basePayload));
  }

  if (error) {
    throw new Error(`Failed to save pick record: ${error.message}`);
  }

  return assertSingleRow<PickRow>(data, 'pick');
}

export async function getLatestPickForGame(
  gameId: string
): Promise<PickRow | null> {
  const { data, error } = await supabase
    .from('picks')
    .select(PICK_COLUMNS)
    .eq('game_id', gameId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest pick: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return assertSingleRow<PickRow>(data, 'pick');
}

export async function listPicks(options?: {
  gameIds?: string[];
  statuses?: Array<PickRow['status']>;
  limit?: number;
  includeUnconfirmed?: boolean;
  orderBy?: 'updated_at' | 'created_at';
  ascending?: boolean;
}): Promise<PickRow[]> {
  const gameIds = uniqueNonEmpty(options?.gameIds ?? []);
  if (options?.gameIds && !gameIds.length) {
    return [];
  }

  let query = supabase
    .from('picks')
    .select(PICK_COLUMNS)
    .eq('sport', 'MLB');

  if (gameIds.length) {
    query = query.in('game_id', gameIds);
  }

  if (options?.statuses?.length) {
    query = query.in('status', options.statuses);
  }

  if (!options?.includeUnconfirmed) {
    query = query.or('execution_selection.not.is.null,execution_market.not.is.null,execution_odds.not.is.null,status.in.(won,lost,void)');
  }

  query = query.order(options?.orderBy ?? 'updated_at', {
    ascending: options?.ascending ?? false
  });

  if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch picks: ${error.message}`);
  }

  const rows = data
  ? assertRowArray<PickRow>(data, 'pick')
  : [];
  return options?.includeUnconfirmed
    ? rows
    : rows.filter((pick) => isConfirmedPickRecord(pick));
}

export async function listConfirmedPicks(): Promise<PickRow[]> {
  return listPicks();
}

export async function listConfirmedPicksForStats(): Promise<PickStatsRow[]> {
  const runQuery = (columns: string) =>
    supabase
      .from('picks')
      .select(columns)
      .eq('sport', 'MLB')
      .or('execution_selection.not.is.null,execution_market.not.is.null,execution_odds.not.is.null,status.in.(won,lost,void)')
      .order('updated_at', { ascending: false });

  let { data, error } = await runQuery(PICK_STATS_COLUMNS);

  if (error && isMissingClvColumnError(error)) {
    ({ data, error } = await runQuery(PICK_STATS_FALLBACK_COLUMNS));
  }

  if (error) {
    throw new Error(`Failed to fetch stats picks: ${error.message}`);
  }

  const rows = data
    ? assertRowArray<PickStatsRow>(data, 'stats pick')
    : [];

  return rows.filter((pick) => isConfirmedPickRecord(pick));
}

export async function listPicksForClvCapture(
  startDate: string,
  endDate: string
): Promise<PickClvCaptureRow[]> {
  const { data, error } = await supabase
    .from('picks')
    .select(PICK_CLV_CAPTURE_COLUMNS)
    .eq('sport', 'MLB')
    .gte('game_day', startDate)
    .lte('game_day', endDate)
    .in('status', ['pending', 'won', 'lost'])
    .not('execution_odds', 'is', null)
    .order('game_day', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingClvColumnError(error)) {
      throw new Error('CLV columns are missing on picks. Run scripts/add-picks-clv-columns.sql before capturing CLV.');
    }

    throw new Error(`Failed to fetch picks for CLV capture: ${error.message}`);
  }

  const rows = data
    ? assertRowArray<PickClvCaptureRow>(data, 'CLV pick')
    : [];

  return rows.filter((pick) => isConfirmedPickRecord(pick));
}

export async function updatePickClvAudit(
  pickId: string,
  input: PickClvUpdateInput
): Promise<PickClvCaptureRow> {
  const { data, error } = await supabase
    .from('picks')
    .update({
      ...input,
      updated_at: new Date().toISOString()
    })
    .eq('id', pickId)
    .select(PICK_CLV_CAPTURE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to update pick CLV audit: ${error.message}`);
  }

  return assertSingleRow<PickClvCaptureRow>(data, 'CLV pick');
}

export async function listConfirmedPicksForLedger(
  options: LedgerPickListOptions | number = {}
): Promise<PickLedgerRow[]> {
  const normalizedOptions =
    typeof options === 'number' ? { limit: options } : options;

  let query = supabase
    .from('picks')
    .select(PICK_LEDGER_COLUMNS)
    .eq('sport', 'MLB')
    .or('execution_selection.not.is.null,execution_market.not.is.null,execution_odds.not.is.null,status.in.(won,lost,void)')
    .order('updated_at', { ascending: false });

  if (normalizedOptions.startDate) {
    query = query.gte('game_day', normalizedOptions.startDate);
  }

  if (normalizedOptions.endDate) {
    query = query.lte('game_day', normalizedOptions.endDate);
  }

  query = query.limit(normalizedOptions.limit ?? 300);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch ledger picks: ${error.message}`);
  }

  const rows = data
    ? assertRowArray<PickLedgerRow>(data, 'ledger pick')
    : [];

  return rows.filter((pick) => isConfirmedPickRecord(pick));
}

export async function listConfirmedPicksByGameIds(
  gameIds: string[]
): Promise<PickRow[]> {
  return listPicks({ gameIds });
}

export async function listConfirmedPickAnalysisByGameIds(
  gameIds: string[]
): Promise<PickAnalysisSummaryRow[]> {
  const uniqueIds = uniqueNonEmpty(gameIds);
  if (!uniqueIds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from('picks')
    .select(PICK_ANALYSIS_COLUMNS)
    .eq('sport', 'MLB')
    .in('game_id', uniqueIds);

  if (error) {
    throw new Error(`Failed to fetch pick analysis summaries: ${error.message}`);
  }

  const rows = data
    ? assertRowArray<PickAnalysisSummaryRow>(data, 'pick analysis summary')
    : [];

  return rows.filter((pick) => isConfirmedPickRecord(pick));
}

export async function listPendingConfirmedPicks(): Promise<PickRow[]> {
  return listPicks({
    statuses: ['pending']
  });
}

export async function getPickStatusByGameId(
  gameId: string
): Promise<PickRow['status'] | null> {
  const normalizedGameId = gameId.trim();
  if (!normalizedGameId) {
    return null;
  }

  const { data, error } = await supabase
    .from('picks')
    .select('status')
    .eq('sport', 'MLB')
    .eq('game_id', normalizedGameId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch pick status: ${error.message}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const status = data.status;
  return typeof status === 'string' ? status : null;
}

export function getPickStorageSampleColumns(): string {
  return PICK_STORAGE_SAMPLE_COLUMNS;
}

export async function settlePickRecord(input: {
  pickId?: string;
  gameId?: string;
  status: 'pending' | 'won' | 'lost' | 'void';
  result?: string | null;
  profitUnits?: number | null;
}): Promise<PickRow> {
  let query = supabase
    .from('picks')
    .update({
      status: input.status,
      result: input.result ?? null,
      profit_units: input.profitUnits ?? null,
      updated_at: new Date().toISOString()
    })
    .eq('sport', 'MLB');

  if (input.pickId) {
    query = query.eq('id', input.pickId);
  } else if (input.gameId) {
    query = query.eq('game_id', input.gameId);
  } else {
    throw new Error('settlePickRecord requires pickId or gameId');
  }

  const { data, error } = await query
    .select(PICK_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to settle pick: ${error.message}`);
  }

  return assertSingleRow<PickRow>(data, 'pick');
}

export type OddsBoardCacheRow = {
  id: string;
  board_key: string;
  sport: string;
  payload: Record<string, unknown>;
  source: string;
  created_at: string;
  updated_at: string;
};

export type OddsBoardCacheMetadataRow = Omit<OddsBoardCacheRow, 'payload'>;

export async function saveOddsBoardCache(input: {
  boardKey: string;
  sport?: 'MLB';
  payload: Record<string, unknown>;
  source?: string;
}): Promise<OddsBoardCacheRow> {
  const { data, error } = await supabase
    .from('odds_board_cache')
    .upsert(
      {
        board_key: input.boardKey,
        sport: input.sport ?? 'MLB',
        payload: input.payload,
        source: input.source ?? 'sportsgameodds',
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'board_key'
      }
    )
    .select(ODDS_BOARD_CACHE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to save odds board cache: ${error.message}`);
  }

  return assertSingleRow<OddsBoardCacheRow>(data, 'odds board cache');
}

export async function getOddsBoardCache(
  boardKey: string
): Promise<OddsBoardCacheRow | null> {
  const { data, error } = await supabase
    .from('odds_board_cache')
    .select(ODDS_BOARD_CACHE_COLUMNS)
    .eq('board_key', boardKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch odds board cache: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return assertSingleRow<OddsBoardCacheRow>(data, 'odds board cache');
}

export async function getOddsBoardCacheMetadata(
  boardKey: string
): Promise<OddsBoardCacheMetadataRow | null> {
  const { data, error } = await supabase
    .from('odds_board_cache')
    .select(ODDS_BOARD_CACHE_METADATA_COLUMNS)
    .eq('board_key', boardKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch odds board cache metadata: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return assertSingleRow<OddsBoardCacheMetadataRow>(data, 'odds board cache metadata');
}

export async function listOddsBoardCachesByKeys(
  boardKeys: string[]
): Promise<OddsBoardCacheRow[]> {
  const keys = uniqueNonEmpty(boardKeys);
  if (!keys.length) {
    return [];
  }

  const { data, error } = await supabase
    .from('odds_board_cache')
    .select(ODDS_BOARD_CACHE_COLUMNS)
    .in('board_key', keys)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch odds board caches by key: ${error.message}`);
  }

  return data ? assertRowArray<OddsBoardCacheRow>(data, 'odds board cache') : [];
}

export async function getPremiumDailyLock(
  dateKey: string
): Promise<Record<string, unknown> | null> {
  const row = await getOddsBoardCache(`premium-lock:${dateKey}`).catch(() => null);
  return (row?.payload as Record<string, unknown> | null) ?? null;
}

export async function createPremiumDailyLock(
  dateKey: string,
  payload: Record<string, unknown>
): Promise<{ created: boolean; payload: Record<string, unknown> }> {
  const boardKey = `premium-lock:${dateKey}`;
  const { error } = await supabase
    .from('odds_board_cache')
    .insert({
      board_key: boardKey,
      sport: 'MLB',
      payload,
      source: 'premium-lock',
      updated_at: new Date().toISOString()
    });

  if (error) {
    const isDuplicate =
      error.code === '23505' ||
      error.message?.toLowerCase().includes('duplicate') ||
      error.message?.toLowerCase().includes('unique');
    if (!isDuplicate) throw new Error(`Failed to create premium lock: ${error.message}`);
    // First write already won — read and return the existing record
    const existing = await getOddsBoardCache(boardKey).catch(() => null);
    return { created: false, payload: (existing?.payload as Record<string, unknown>) ?? payload };
  }
  return { created: true, payload };
}

export async function closePremiumDailyLock(
  dateKey: string,
  existingPayload: Record<string, unknown>
): Promise<void> {
  const boardKey = `premium-lock:${dateKey}`;
  const closedPayload = {
    ...existingPayload,
    closed: true,
    closedAt: new Date().toISOString(),
    closeReason: 'game_settled'
  };
  await supabase
    .from('odds_board_cache')
    .update({ payload: closedPayload, updated_at: new Date().toISOString() })
    .eq('board_key', boardKey);
}

export async function listOddsBoardCachesByPrefix(
  prefix: string
): Promise<OddsBoardCacheRow[]> {
  const { data, error } = await supabase
    .from('odds_board_cache')
    .select(ODDS_BOARD_CACHE_COLUMNS)
    .like('board_key', `${prefix}%`)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch odds board cache prefix ${prefix}: ${error.message}`);
  }

  const rows = data
  ? assertRowArray<OddsBoardCacheRow>(data, 'odds board cache')
  : [];

return rows;
}

// ─── Combi Picks ────────────────────────────────────────────────────────────

const COMBI_PICK_COLUMNS = [
  'id',
  'game_day',
  'status',
  'created_at',
  'updated_at',
  'leg_1_game_id',
  'leg_1_market',
  'leg_1_selection',
  'leg_1_line',
  'leg_1_api_odds',
  'leg_1_real_odds',
  'leg_1_status',
  'leg_1_result',
  'leg_1_home_team',
  'leg_1_away_team',
  'leg_2_game_id',
  'leg_2_market',
  'leg_2_selection',
  'leg_2_line',
  'leg_2_api_odds',
  'leg_2_real_odds',
  'leg_2_status',
  'leg_2_result',
  'leg_2_home_team',
  'leg_2_away_team',
  'combined_api_odds',
  'combined_real_odds',
  'profit_units',
  'metadata'
].join(',');

const COMBI_PICK_SUMMARY_COLUMNS = [
  'id',
  'game_day',
  'status',
  'combined_api_odds',
  'combined_real_odds',
  'profit_units'
].join(',');

export type CombiPickRow = {
  id: string;
  game_day: string;
  status: string;
  created_at: string;
  updated_at: string;

  leg_1_game_id: string | null;
  leg_1_market: string | null;
  leg_1_selection: string | null;
  leg_1_line: number | null;
  leg_1_api_odds: number | null;
  leg_1_real_odds: number | null;
  leg_1_status: string;
  leg_1_result: string | null;
  leg_1_home_team: string | null;
  leg_1_away_team: string | null;

  leg_2_game_id: string | null;
  leg_2_market: string | null;
  leg_2_selection: string | null;
  leg_2_line: number | null;
  leg_2_api_odds: number | null;
  leg_2_real_odds: number | null;
  leg_2_status: string;
  leg_2_result: string | null;
  leg_2_home_team: string | null;
  leg_2_away_team: string | null;

  combined_api_odds: number | null;
  combined_real_odds: number | null;
  profit_units: number | null;

  metadata: Record<string, unknown> | null;
};

export type CombiPickInsert = {
  gameDay: string;
  leg1GameId: string;
  leg1Market: string;
  leg1Selection: string;
  leg1Line: number | null;
  leg1ApiOdds: number;
  leg1RealOdds?: number | null;
  leg1HomeTeam: string | null;
  leg1AwayTeam: string | null;
  leg2GameId: string;
  leg2Market: string;
  leg2Selection: string;
  leg2Line: number | null;
  leg2ApiOdds: number;
  leg2RealOdds?: number | null;
  leg2HomeTeam: string | null;
  leg2AwayTeam: string | null;
  combinedApiOdds: number;
  combinedRealOdds?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type CombiStatsSummary = {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  profit_units: number;
  roi: number | null;
  avg_combined_odds: number | null;
};

export type CombiSummaryRow = Pick<
  CombiPickRow,
  | 'id'
  | 'game_day'
  | 'status'
  | 'combined_api_odds'
  | 'combined_real_odds'
  | 'profit_units'
>;

export function buildCombiStatsSummary(rows: CombiSummaryRow[]): CombiStatsSummary {
  let wins = 0;
  let losses = 0;
  let profitUnitsTotal = 0;
  let oddsTotal = 0;
  let oddsCount = 0;

  for (const row of rows) {
    if (row.status === 'won') wins += 1;
    if (row.status === 'lost') losses += 1;

    if (typeof row.profit_units === 'number' && Number.isFinite(row.profit_units)) {
      profitUnitsTotal += row.profit_units;
    }

    const combinedOdds = row.combined_real_odds ?? row.combined_api_odds;
    if (typeof combinedOdds === 'number' && Number.isFinite(combinedOdds)) {
      oddsTotal += combinedOdds;
      oddsCount += 1;
    }
  }

  const settled = wins + losses;

  return {
    total: rows.length,
    settled,
    wins,
    losses,
    win_rate: settled > 0 ? Number((wins / settled).toFixed(4)) : null,
    profit_units: Number(profitUnitsTotal.toFixed(3)),
    roi: settled > 0 ? Number((profitUnitsTotal / settled).toFixed(4)) : null,
    avg_combined_odds: oddsCount > 0 ? Number((oddsTotal / oddsCount).toFixed(3)) : null
  };
}

const COMBI_SNAPSHOT_COLUMNS = [
  'game_id',
  'snapshot_stage',
  'start_time',
  'payload'
].join(',');

export type CombiSnapshotLight = {
  game_id: string;
  snapshot_stage: string;
  start_time: string | null;
  payload: Record<string, unknown>;
};

export type ClvSnapshotRow = {
  id: string;
  game_id: string;
  snapshot_stage: string;
  start_time: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function getCombiPickForDay(
  gameDay: string
): Promise<CombiPickRow | null> {
  const { data, error } = await supabase
    .from('combi_picks')
    .select(COMBI_PICK_COLUMNS)
    .eq('game_day', gameDay)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch combi pick for day ${gameDay}: ${error.message}`);
  }

  if (!data) return null;

  return assertSingleRow<CombiPickRow>(data, 'combi pick');
}

export async function saveCombiPick(
  input: CombiPickInsert
): Promise<CombiPickRow> {
  const { data, error } = await supabase
    .from('combi_picks')
    .insert({
      game_day: input.gameDay,
      status: 'pending',
      leg_1_game_id: input.leg1GameId,
      leg_1_market: input.leg1Market,
      leg_1_selection: input.leg1Selection,
      leg_1_line: input.leg1Line,
      leg_1_api_odds: input.leg1ApiOdds,
      leg_1_real_odds: input.leg1RealOdds ?? null,
      leg_1_status: 'pending',
      leg_1_result: null,
      leg_1_home_team: input.leg1HomeTeam,
      leg_1_away_team: input.leg1AwayTeam,
      leg_2_game_id: input.leg2GameId,
      leg_2_market: input.leg2Market,
      leg_2_selection: input.leg2Selection,
      leg_2_line: input.leg2Line,
      leg_2_api_odds: input.leg2ApiOdds,
      leg_2_real_odds: input.leg2RealOdds ?? null,
      leg_2_status: 'pending',
      leg_2_result: null,
      leg_2_home_team: input.leg2HomeTeam,
      leg_2_away_team: input.leg2AwayTeam,
      combined_api_odds: input.combinedApiOdds,
      combined_real_odds: input.combinedRealOdds ?? null,
      profit_units: null,
      metadata: input.metadata ?? null,
      updated_at: new Date().toISOString()
    })
    .select(COMBI_PICK_COLUMNS)
    .single();

  if (error) {
    const isDuplicate =
      error.code === '23505' ||
      error.message?.toLowerCase().includes('duplicate') ||
      error.message?.toLowerCase().includes('unique');

    if (isDuplicate) {
      const existing = await getCombiPickForDay(input.gameDay);
      if (existing) return existing;
    }

    throw new Error(`Failed to save combi pick: ${error.message}`);
  }

  return assertSingleRow<CombiPickRow>(data, 'combi pick');
}

export async function updateCombiPickOdds(
  id: string,
  leg1RealOdds: number,
  leg2RealOdds: number
): Promise<CombiPickRow> {
  const combinedRealOdds = Number((leg1RealOdds * leg2RealOdds).toFixed(3));

  const { data, error } = await supabase
    .from('combi_picks')
    .update({
      leg_1_real_odds: leg1RealOdds,
      leg_2_real_odds: leg2RealOdds,
      combined_real_odds: combinedRealOdds,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select(COMBI_PICK_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to update combi odds: ${error.message}`);
  }

  return assertSingleRow<CombiPickRow>(data, 'combi pick');
}

export async function replacePendingCombiPick(
  id: string,
  input: CombiPickInsert
): Promise<CombiPickRow> {
  const { data, error } = await supabase
    .from('combi_picks')
    .update({
      game_day: input.gameDay,
      status: 'pending',
      leg_1_game_id: input.leg1GameId,
      leg_1_market: input.leg1Market,
      leg_1_selection: input.leg1Selection,
      leg_1_line: input.leg1Line,
      leg_1_api_odds: input.leg1ApiOdds,
      leg_1_real_odds: input.leg1RealOdds ?? null,
      leg_1_status: 'pending',
      leg_1_result: null,
      leg_1_home_team: input.leg1HomeTeam,
      leg_1_away_team: input.leg1AwayTeam,
      leg_2_game_id: input.leg2GameId,
      leg_2_market: input.leg2Market,
      leg_2_selection: input.leg2Selection,
      leg_2_line: input.leg2Line,
      leg_2_api_odds: input.leg2ApiOdds,
      leg_2_real_odds: input.leg2RealOdds ?? null,
      leg_2_status: 'pending',
      leg_2_result: null,
      leg_2_home_team: input.leg2HomeTeam,
      leg_2_away_team: input.leg2AwayTeam,
      combined_api_odds: input.combinedApiOdds,
      combined_real_odds: input.combinedRealOdds ?? null,
      profit_units: null,
      metadata: input.metadata ?? null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select(COMBI_PICK_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to replace pending combi pick: ${error.message}`);
  }

  return assertSingleRow<CombiPickRow>(data, 'combi pick');
}

export async function discardPendingCombiPick(
  id: string
): Promise<void> {
  const { error } = await supabase
    .from('combi_picks')
    .delete()
    .eq('id', id)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Failed to discard pending combi pick: ${error.message}`);
  }
}

export async function settleCombiLeg(
  id: string,
  leg: 1 | 2,
  status: 'won' | 'lost',
  result?: string | null
): Promise<CombiPickRow> {
  const legField = leg === 1 ? 'leg_1_status' : 'leg_2_status';
  const resultField = leg === 1 ? 'leg_1_result' : 'leg_2_result';

  const { data: current, error: fetchError } = await supabase
    .from('combi_picks')
    .select(COMBI_PICK_COLUMNS)
    .eq('id', id)
    .single();

  if (fetchError || !current) {
    throw new Error(`Failed to fetch combi pick for settle: ${fetchError?.message ?? 'not found'}`);
  }

  const row = assertSingleRow<CombiPickRow>(current, 'combi pick');

  // Prevent re-settling a leg that already has a final result
  const currentLegStatus = leg === 1 ? row.leg_1_status : row.leg_2_status;
  if (currentLegStatus !== 'pending') {
    throw new Error(
      `Leg ${leg} ya fue registrada como "${currentLegStatus}". No se puede modificar.`
    );
  }

  const otherLegStatus = leg === 1 ? row.leg_2_status : row.leg_1_status;

  let newCombiStatus = row.status;
  let newProfitUnits = row.profit_units;

  if (status === 'lost') {
    newCombiStatus = 'lost';
    newProfitUnits = -1;
  } else if (status === 'won' && otherLegStatus === 'won') {
    const realOdds = row.combined_real_odds ?? row.combined_api_odds;
    newCombiStatus = 'won';
    newProfitUnits = realOdds !== null ? Number((realOdds - 1).toFixed(3)) : null;
  }

  const { data, error } = await supabase
    .from('combi_picks')
    .update({
      [legField]: status,
      [resultField]: result ?? null,
      status: newCombiStatus,
      profit_units: newProfitUnits,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select(COMBI_PICK_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to settle combi leg: ${error.message}`);
  }

  return assertSingleRow<CombiPickRow>(data, 'combi pick');
}

export async function listCombiPicks(limit = 60): Promise<CombiPickRow[]> {
  const { data, error } = await supabase
    .from('combi_picks')
    .select(COMBI_PICK_COLUMNS)
    .order('game_day', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list combi picks: ${error.message}`);
  }

  return data ? assertRowArray<CombiPickRow>(data, 'combi pick') : [];
}

export async function listCombiPickSummaries(limit = 60): Promise<CombiSummaryRow[]> {
  const { data, error } = await supabase
    .from('combi_picks')
    .select(COMBI_PICK_SUMMARY_COLUMNS)
    .order('game_day', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list combi pick summaries: ${error.message}`);
  }

  return data ? assertRowArray<CombiSummaryRow>(data, 'combi pick summary') : [];
}

export async function listCombiPicksForRange(
  startDate: string,
  endDate: string
): Promise<CombiPickRow[]> {
  const { data, error } = await supabase
    .from('combi_picks')
    .select(COMBI_PICK_COLUMNS)
    .gte('game_day', startDate)
    .lte('game_day', endDate)
    .order('game_day', { ascending: false });

  if (error) {
    throw new Error(`Failed to list combi picks for range: ${error.message}`);
  }

  return data ? assertRowArray<CombiPickRow>(data, 'combi pick') : [];
}

export async function getSnapshotsForClvCapture(
  gameIds: string[]
): Promise<ClvSnapshotRow[]> {
  const ids = uniqueNonEmpty(gameIds);
  if (!ids.length) {
    return [];
  }

  const { data, error } = await supabase
    .from('game_snapshots')
    .select(CLV_SNAPSHOT_COLUMNS)
    .in('game_id', ids)
    .in('snapshot_stage', ['open', 'mid', 'final'])
    .order('updated_at', { ascending: false })
    .limit(Math.min(Math.max(ids.length * 3, 20), 120));

  if (error) {
    throw new Error(`Failed to fetch snapshots for CLV capture: ${error.message}`);
  }

  return data ? assertRowArray<ClvSnapshotRow>(data, 'CLV snapshot') : [];
}

export async function getCombiStatsSummary(): Promise<CombiStatsSummary> {
  const rows = await listCombiPicks(200);
  return buildCombiStatsSummary(rows);
}

export async function getLatestSnapshotsForCombi(
  startUtc: string,
  endUtc: string
): Promise<CombiSnapshotLight[]> {
  const { data, error } = await supabase
    .from('game_snapshots')
    .select(COMBI_SNAPSHOT_COLUMNS)
    .gte('start_time', startUtc)
    .lt('start_time', endUtc)
    .in('snapshot_stage', ['mid', 'open'])
    .order('updated_at', { ascending: false })
    .limit(40);

  if (error) {
    throw new Error(`Failed to fetch snapshots for combi: ${error.message}`);
  }

  const rows = data ? assertRowArray<CombiSnapshotLight>(data, 'combi snapshot') : [];

  // Keep only the most recent snapshot per game_id (prefer mid over open)
  const byGameId = new Map<string, CombiSnapshotLight>();
  for (const row of rows) {
    const existing = byGameId.get(row.game_id);
    if (!existing) {
      byGameId.set(row.game_id, row);
    } else if (existing.snapshot_stage === 'open' && row.snapshot_stage === 'mid') {
      byGameId.set(row.game_id, row);
    }
  }

  return [...byGameId.values()];
}

// ─── Combi v2: picks-based candidate sourcing ────────────────────────────────

const COMBI_BASE_PICK_COLUMNS = [
  'id',
  'game_id',
  'market',
  'selection',
  'line',
  'odds',
  'confidence',
  'estimated_probability',
  'snapshot_id'
].join(',');

export type CombiBasePickRow = {
  id: string;
  game_id: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  confidence: string;
  estimated_probability: number | null;
  snapshot_id: string | null;
};

export async function getPicksForGameDay(
  gameDay: string
): Promise<CombiBasePickRow[]> {
  const { data, error } = await supabase
    .from('picks')
    .select(COMBI_BASE_PICK_COLUMNS)
    .eq('sport', 'MLB')
    .eq('game_day', gameDay)
    .not('odds', 'is', null)
    .not('market', 'is', null)
    .neq('market', 'PASS')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch picks for game day ${gameDay}: ${error.message}`);
  }

  const rows = data ? assertRowArray<CombiBasePickRow>(data, 'combi base pick') : [];

  return rows.filter((row) => {
    const sel = String(row.selection ?? '').trim().toUpperCase();
    return sel !== 'NO BET' && sel !== 'PASS';
  });
}

export async function getOddsBoardCacheForDate(
  gameDay: string
): Promise<OddsBoardCacheRow | null> {
  return getOddsBoardCache(`mlb_main:${gameDay}`);
}

export async function getSnapshotsByGameIdsForCombi(
  gameIds: string[]
): Promise<CombiSnapshotLight[]> {
  const ids = uniqueNonEmpty(gameIds);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('game_snapshots')
    .select(COMBI_SNAPSHOT_COLUMNS)
    .in('game_id', ids)
    .in('snapshot_stage', ['mid', 'open'])
    .order('updated_at', { ascending: false })
    .limit(40);

  if (error) {
    throw new Error(`Failed to fetch snapshots by game ids for combi: ${error.message}`);
  }

  const rows = data ? assertRowArray<CombiSnapshotLight>(data, 'combi snapshot') : [];

  const byGameId = new Map<string, CombiSnapshotLight>();
  for (const row of rows) {
    const existing = byGameId.get(row.game_id);
    if (!existing) {
      byGameId.set(row.game_id, row);
    } else if (existing.snapshot_stage === 'open' && row.snapshot_stage === 'mid') {
      byGameId.set(row.game_id, row);
    }
  }

  return [...byGameId.values()];
}
