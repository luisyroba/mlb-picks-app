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

const ODDS_BOARD_CACHE_COLUMNS = [
  'id',
  'board_key',
  'sport',
  'payload',
  'source',
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

export async function listConfirmedPicksForLedger(): Promise<PickLedgerRow[]> {
  const { data, error } = await supabase
    .from('picks')
    .select(PICK_LEDGER_COLUMNS)
    .eq('sport', 'MLB')
    .or('execution_selection.not.is.null,execution_market.not.is.null,execution_odds.not.is.null,status.in.(won,lost,void)')
    .order('updated_at', { ascending: false })
    .limit(60);

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
