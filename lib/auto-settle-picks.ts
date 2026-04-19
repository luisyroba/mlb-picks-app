import { getNormalizedEspnMlbGame } from './espn';
import {
  getPregameSnapshotById,
  getPregameSnapshotsForGame,
  isConfirmedPickRecord,
  isNoBetLikePickRecord,
  listPicks,
  listPendingConfirmedPicks,
  settlePickRecord,
  type PickRow
} from './db';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_LIVE_API_BASE = 'https://statsapi.mlb.com/api/v1.1';

type MlbScheduleTeam = {
  team?: {
    id?: number;
    name?: string;
    abbreviation?: string;
    teamName?: string;
    locationName?: string;
    clubName?: string;
  };
  score?: number;
};

type MlbScheduleGame = {
  gamePk?: number;
  gameDate?: string;
  officialDate?: string;
  status?: {
    abstractGameState?: string;
    detailedState?: string;
  };
  teams?: {
    home?: MlbScheduleTeam;
    away?: MlbScheduleTeam;
  };
};

type MlbScheduleResponse = {
  dates?: Array<{
    date?: string;
    games?: MlbScheduleGame[];
  }>;
};

type MlbInningLine = {
  num?: number;
  home?: {
    runs?: number;
  };
  away?: {
    runs?: number;
  };
};

type MlbLiveFeedResponse = {
  gameData?: {
    status?: {
      abstractGameState?: string;
      detailedState?: string;
    };
  };
  liveData?: {
    linescore?: {
      currentInning?: number;
      inningHalf?: string;
      inningState?: string;
      isTopInning?: boolean;
      innings?: MlbInningLine[];
      teams?: {
        home?: {
          runs?: number;
        };
        away?: {
          runs?: number;
        };
      };
    };
  };
};

type OfficialGameResolution =
  | {
      kind: 'pending';
    }
  | {
      kind: 'live';
      gamePk: number;
      homeTeamName: string;
      awayTeamName: string;
    }
  | {
      kind: 'void';
      reason: string;
    }
  | {
      kind: 'final';
      gamePk: number;
      homeTeamName: string;
      awayTeamName: string;
    };

type PickSettlementContext = {
  officialDate: string | null;
  espnDateTime: string | null;
  espnStatus: string | null;
  homeTeamName: string;
  awayTeamName: string;
};

type ScheduleMatchResult = {
  game: MlbScheduleGame | null;
  ambiguous: boolean;
};

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function normalizeText(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toOfficialDate(value?: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function shiftOfficialDate(
  officialDate: string,
  offsetDays: number
): string {
  const date = new Date(`${officialDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function safeSnapshotString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeResolvedMarket(value: string): 'ML' | 'RL' | 'TOTAL' | 'F5' | null {
  const market = value.trim().toUpperCase();
  if (!market) return null;

  if (market === 'ML' || market === 'MONEYLINE') return 'ML';
  if (market === 'RL' || market === 'RUNLINE' || market === 'RUN_LINE' || market === 'SPREAD') return 'RL';
  if (market === 'TOTAL' || market === 'TOTALS' || market === 'OU') return 'TOTAL';
  if (
    market === 'F5' ||
    market === 'F5_ML' ||
    market === 'F5_RL' ||
    market === 'F5_TOTAL' ||
    market === 'F5_TOTALS' ||
    market === 'FIRST5'
  ) {
    return 'F5';
  }

  return null;
}

function isOfficialFinalStatus(value?: string | null): boolean {
  const normalized = String(value ?? '').toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes('final') ||
    normalized.includes('game over') ||
    normalized.includes('completed early') ||
    normalized.includes('final official') ||
    normalized.includes('final/official')
  );
}

function isEspnPregameStatus(value?: string | null): boolean {
  const normalized = String(value ?? '').toLowerCase();
  if (!normalized) return true;

  return (
    normalized.includes('scheduled') ||
    normalized.includes('pre-game') ||
    normalized.includes('preview') ||
    normalized.includes('warmup') ||
    normalized.includes('delayed') ||
    normalized.includes('postponed') ||
    normalized.includes('suspended') ||
    normalized.includes('not started')
  );
}

function isSettleablePendingPick(pick: PickRow): boolean {
  if (pick.status !== 'pending') return false;
  if (isNoBetLikePickRecord(pick)) return false;
  if (isConfirmedPickRecord(pick)) return true;

  const market = normalizeResolvedMarket(String(pick.execution_market || pick.market || ''));
  const selection = String(pick.execution_selection || pick.selection || '').trim();
  return Boolean(market && selection);
}

async function resolvePickContext(
  pick: PickRow
): Promise<PickSettlementContext | null> {
  const snapshot =
    (pick.snapshot_id
      ? await getPregameSnapshotById(pick.snapshot_id)
      : null) ?? null;

  const fallbackSnapshots =
    snapshot === null
      ? await getPregameSnapshotsForGame(pick.game_id)
      : null;

  const resolvedSnapshot =
    snapshot ??
    fallbackSnapshots?.final ??
    fallbackSnapshots?.mid ??
    fallbackSnapshots?.open ??
    null;

  const payload =
    resolvedSnapshot?.payload && typeof resolvedSnapshot.payload === 'object'
      ? (resolvedSnapshot.payload as Record<string, unknown>)
      : null;

  const espnGame =
    payload?.espnGame && typeof payload.espnGame === 'object'
      ? (payload.espnGame as Record<string, unknown>)
      : null;
  const espnHome =
    espnGame?.homeTeam && typeof espnGame.homeTeam === 'object'
      ? (espnGame.homeTeam as Record<string, unknown>)
      : null;
  const espnAway =
    espnGame?.awayTeam && typeof espnGame.awayTeam === 'object'
      ? (espnGame.awayTeam as Record<string, unknown>)
      : null;

  const engineGame =
    payload?.engineGame && typeof payload.engineGame === 'object'
      ? (payload.engineGame as Record<string, unknown>)
      : null;
  const engineHome =
    engineGame?.homeTeam && typeof engineGame.homeTeam === 'object'
      ? (engineGame.homeTeam as Record<string, unknown>)
      : null;
  const engineAway =
    engineGame?.awayTeam && typeof engineGame.awayTeam === 'object'
      ? (engineGame.awayTeam as Record<string, unknown>)
      : null;
  const engineHomeCore =
    engineHome?.core && typeof engineHome.core === 'object'
      ? (engineHome.core as Record<string, unknown>)
      : null;
  const engineAwayCore =
    engineAway?.core && typeof engineAway.core === 'object'
      ? (engineAway.core as Record<string, unknown>)
      : null;

  const homeTeamName =
    safeSnapshotString(espnHome?.displayName) ||
    safeSnapshotString(engineHomeCore?.teamName);
  const awayTeamName =
    safeSnapshotString(espnAway?.displayName) ||
    safeSnapshotString(engineAwayCore?.teamName);

  const officialDate =
    toOfficialDate(safeSnapshotString(espnGame?.date)) ||
    toOfficialDate(resolvedSnapshot?.start_time ?? null);
  const espnDateTime =
    safeSnapshotString(espnGame?.date) ||
    safeSnapshotString(resolvedSnapshot?.start_time ?? null) ||
    null;
  const snapshotEspnStatus = safeSnapshotString(espnGame?.status) || null;

  let liveEspnStatus: string | null = null;
  try {
    const liveEspnGame = await getNormalizedEspnMlbGame(pick.game_id);
    liveEspnStatus = safeSnapshotString(liveEspnGame.status) || null;
  } catch {
    // Keep snapshot-only context when live ESPN fetch fails.
  }

  if (!officialDate || !homeTeamName || !awayTeamName) {
    try {
      const espnGame = await getNormalizedEspnMlbGame(pick.game_id);
      const liveOfficialDate = toOfficialDate(espnGame.date);

      if (
        liveOfficialDate &&
        espnGame.homeTeam.displayName &&
        espnGame.awayTeam.displayName
      ) {
        return {
          officialDate: liveOfficialDate,
          espnDateTime: safeSnapshotString(espnGame.date),
          espnStatus: safeSnapshotString(espnGame.status) || null,
          homeTeamName: espnGame.homeTeam.displayName,
          awayTeamName: espnGame.awayTeam.displayName
        };
      }
    } catch {
      // Keep null when neither snapshot nor ESPN summary are usable.
    }

    return null;
  }

  return {
    officialDate,
    espnDateTime,
    espnStatus: liveEspnStatus ?? snapshotEspnStatus,
    homeTeamName,
    awayTeamName
  };
}

async function fetchMlbJson<T>(url: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json'
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`MLB settlement request failed: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('MLB settlement request failed');
}

function getTeamDisplayName(team?: MlbScheduleTeam['team']): string {
  const canonicalName = String(team?.name ?? '').trim();
  if (canonicalName) {
    return canonicalName;
  }

  const location = team?.locationName;
  const club = team?.clubName || team?.teamName;

  if (location && club) {
    return `${location} ${club}`;
  }

  return String(team?.name ?? '');
}

function resolveScheduledGameStatus(game: MlbScheduleGame): OfficialGameResolution['kind'] {
  const abstractState = String(game.status?.abstractGameState ?? '').toLowerCase();
  const detailedState = String(game.status?.detailedState ?? '').toLowerCase();

  if (
    detailedState.includes('cancel')
  ) {
    return 'void';
  }

  if (abstractState === 'final' || isOfficialFinalStatus(detailedState)) {
    return 'final';
  }

  return 'pending';
}

function findScheduleGame(
  schedule: MlbScheduleResponse,
  espnDate: string | null,
  homeTeamName: string,
  awayTeamName: string
): ScheduleMatchResult {
  const expectedHome = normalizeText(homeTeamName);
  const expectedAway = normalizeText(awayTeamName);

  const candidates: MlbScheduleGame[] = [];

  for (const date of schedule.dates ?? []) {
    for (const game of date.games ?? []) {
      const gameHome = normalizeText(getTeamDisplayName(game.teams?.home?.team));
      const gameAway = normalizeText(getTeamDisplayName(game.teams?.away?.team));

      if (gameHome === expectedHome && gameAway === expectedAway) {
        candidates.push(game);
      }
    }
  }

  if (!candidates.length) return { game: null, ambiguous: false };
  if (candidates.length === 1) return { game: candidates[0], ambiguous: false };
  if (!espnDate) return { game: null, ambiguous: true };

  const expectedStartMs = new Date(espnDate).getTime();
  if (!Number.isFinite(expectedStartMs)) return { game: null, ambiguous: true };

  const sorted = [...candidates].sort((left, right) => {
    const leftMs = new Date(left.gameDate ?? left.officialDate ?? '').getTime();
    const rightMs = new Date(right.gameDate ?? right.officialDate ?? '').getTime();

    const leftDistance = Number.isFinite(leftMs)
      ? Math.abs(leftMs - expectedStartMs)
      : Number.POSITIVE_INFINITY;
    const rightDistance = Number.isFinite(rightMs)
      ? Math.abs(rightMs - expectedStartMs)
      : Number.POSITIVE_INFINITY;

    return leftDistance - rightDistance;
  });
  const best = sorted[0];
  const second = sorted[1];
  const bestDistance = Math.abs(
    new Date(best.gameDate ?? best.officialDate ?? '').getTime() - expectedStartMs
  );
  const secondDistance = second
    ? Math.abs(
        new Date(second.gameDate ?? second.officialDate ?? '').getTime() - expectedStartMs
      )
    : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(bestDistance) || bestDistance > 6 * 60 * 60 * 1000) {
    return { game: null, ambiguous: true };
  }

  if (
    second &&
    Number.isFinite(secondDistance) &&
    Math.abs(secondDistance - bestDistance) <= 30 * 60 * 1000
  ) {
    return { game: null, ambiguous: true };
  }

  return { game: best, ambiguous: false };
}

function isF5Closed(feed: MlbLiveFeedResponse): boolean {
  const linescore = feed.liveData?.linescore;
  const innings = linescore?.innings ?? [];
  if (innings.length < 5) return false;

  const currentInning = optionalNumber(linescore?.currentInning);
  if (currentInning !== undefined && currentInning >= 6) return true;

  const inningHalf = String(linescore?.inningHalf ?? '').toLowerCase();
  const inningState = String(linescore?.inningState ?? '').toLowerCase();
  const isTopInning = linescore?.isTopInning;

  const mentionsEndOf5 =
    inningHalf.includes('end') ||
    inningHalf.includes('middle') ||
    inningState.includes('end') ||
    inningState.includes('middle');

  if (mentionsEndOf5 && currentInning === 5 && isTopInning === false) {
    return true;
  }

  const abstractStatus = String(feed.gameData?.status?.abstractGameState ?? '');
  const detailedStatus = String(feed.gameData?.status?.detailedState ?? '');
  if (isOfficialFinalStatus(abstractStatus) || isOfficialFinalStatus(detailedStatus)) {
    return true;
  }

  return false;
}

async function resolveOfficialGameForPick(
  pick: PickRow
): Promise<OfficialGameResolution> {
  const context = await resolvePickContext(pick);
  const market = getResolvedMarket(pick);

  if (!context?.officialDate) {
    console.info(`skipped settlement: missing official status ${pick.game_id}`);
    return { kind: 'pending' };
  }
  if (isEspnPregameStatus(context.espnStatus)) {
    console.info(`skipped settlement: game not final ${pick.game_id}`);
    return { kind: 'pending' };
  }
  if (market !== 'F5' && context.espnStatus && !isOfficialFinalStatus(context.espnStatus)) {
    console.info(`skipped settlement: game not final ${pick.game_id}`);
    return { kind: 'pending' };
  }

  const scheduleDates = [
    context.officialDate,
    shiftOfficialDate(context.officialDate, -1),
    shiftOfficialDate(context.officialDate, 1)
  ].filter((value, index, array) => array.indexOf(value) === index);
  let liveCandidate: Extract<OfficialGameResolution, { kind: 'live' }> | null = null;
  let sawAmbiguousMatch = false;

  for (const officialDate of scheduleDates) {
    const schedule = await fetchMlbJson<MlbScheduleResponse>(
      `${MLB_API_BASE}/schedule?sportId=1&date=${officialDate}&hydrate=team`
    );

    const match = findScheduleGame(
      schedule,
      context.espnDateTime ?? `${officialDate}T00:00:00.000Z`,
      context.homeTeamName,
      context.awayTeamName
    );
    if (match.ambiguous) {
      sawAmbiguousMatch = true;
      console.warn(`skipped settlement: ambiguous matchup ${pick.game_id}`);
      continue;
    }
    const game = match.game;

    if (!game) {
      continue;
    }

    const statusKind = resolveScheduledGameStatus(game);

    if (statusKind === 'void') {
      return {
        kind: 'void',
        reason: String(game.status?.detailedState ?? 'Official MLB status voided the game')
      };
    }

    if (statusKind === 'pending') {
      const gamePk = optionalNumber(game.gamePk);

      if (market === 'F5' && gamePk) {
        liveCandidate = {
          kind: 'live',
          gamePk,
          homeTeamName: context.homeTeamName,
          awayTeamName: context.awayTeamName
        };
      }

      continue;
    }

    const gamePk = optionalNumber(game.gamePk);
    if (!gamePk) {
      return { kind: 'pending' };
    }

    return {
      kind: 'final',
      gamePk,
      homeTeamName: context.homeTeamName,
      awayTeamName: context.awayTeamName
    };
  }

  if (liveCandidate) {
    return liveCandidate;
  }
  if (sawAmbiguousMatch) {
    console.warn(`skipped settlement: ambiguous matchup ${pick.game_id}`);
  }

  return { kind: 'pending' };
}

function calculateProfitUnits(
  status: 'won' | 'lost' | 'void',
  odds?: number | null
): number {
  if (status === 'won') {
    if (typeof odds !== 'number' || !Number.isFinite(odds) || odds <= 1) {
      return 0;
    }

    return Number((odds - 1).toFixed(3));
  }

  if (status === 'lost') {
    return -1;
  }

  return 0;
}

function getResolvedMarket(pick: PickRow): 'ML' | 'RL' | 'TOTAL' | 'F5' | null {
  return normalizeResolvedMarket(String(pick.execution_market || pick.market || ''));
}

function getSelectionSide(
  pick: PickRow,
  homeTeamName: string,
  awayTeamName: string
): 'home' | 'away' | 'over' | 'under' | null {
  const storedSide = String(pick.execution_side ?? '').toLowerCase();
  if (
    storedSide === 'home' ||
    storedSide === 'away' ||
    storedSide === 'over' ||
    storedSide === 'under'
  ) {
    return storedSide;
  }

  const selection = normalizeText(pick.execution_selection || pick.selection);

  if (selection.includes('over')) return 'over';
  if (selection.includes('under')) return 'under';
  if (selection.includes(normalizeText(homeTeamName))) return 'home';
  if (selection.includes(normalizeText(awayTeamName))) return 'away';

  return null;
}

function getFinalRuns(feed: MlbLiveFeedResponse): { home: number; away: number } | null {
  const homeRuns = optionalNumber(feed.liveData?.linescore?.teams?.home?.runs);
  const awayRuns = optionalNumber(feed.liveData?.linescore?.teams?.away?.runs);

  if (homeRuns === undefined || awayRuns === undefined) {
    return null;
  }

  return {
    home: homeRuns,
    away: awayRuns
  };
}

function getFirstFiveRuns(feed: MlbLiveFeedResponse): { home: number; away: number } | null {
  const innings = feed.liveData?.linescore?.innings ?? [];
  if (innings.length < 5) return null;

  let home = 0;
  let away = 0;

  for (const inning of innings.slice(0, 5)) {
    home += optionalNumber(inning.home?.runs) ?? 0;
    away += optionalNumber(inning.away?.runs) ?? 0;
  }

  return { home, away };
}

function settleSideMarket(
  side: 'home' | 'away',
  line: number | null,
  runs: { home: number; away: number },
  market: 'ML' | 'RL' | 'F5'
): 'won' | 'lost' | 'void' | null {
  const rawDiff = side === 'home'
    ? runs.home - runs.away
    : runs.away - runs.home;

  if (market === 'ML' && line === null) {
    if (rawDiff > 0) return 'won';
    if (rawDiff < 0) return 'lost';
    return 'void';
  }

  const adjusted = rawDiff + (line ?? 0);

  if (adjusted > 0) return 'won';
  if (adjusted < 0) return 'lost';
  return 'void';
}

function settleTotalMarket(
  side: 'over' | 'under',
  line: number | null,
  runs: { home: number; away: number }
): 'won' | 'lost' | 'void' | null {
  if (line === null || !Number.isFinite(line)) return null;

  const totalRuns = runs.home + runs.away;

  if (side === 'over') {
    if (totalRuns > line) return 'won';
    if (totalRuns < line) return 'lost';
    return 'void';
  }

  if (totalRuns < line) return 'won';
  if (totalRuns > line) return 'lost';
  return 'void';
}

function buildAutoResultLabel(
  status: 'won' | 'lost' | 'void',
  market: 'ML' | 'RL' | 'TOTAL' | 'F5',
  runs: { home: number; away: number }
): string {
  return `AUTO_${status.toUpperCase()} ${market} ${runs.away}-${runs.home}`;
}

async function settleFinalPick(
  pick: PickRow,
  resolved: Extract<OfficialGameResolution, { kind: 'final' | 'live' }>
): Promise<PickRow | null> {
  const market = getResolvedMarket(pick);
  if (!market) return null;

  const side = getSelectionSide(
    pick,
    resolved.homeTeamName,
    resolved.awayTeamName
  );

  if (!side) return null;

  const feed = await fetchMlbJson<MlbLiveFeedResponse>(
    `${MLB_LIVE_API_BASE}/game/${resolved.gamePk}/feed/live`
  );

  const feedStatus = String(
    feed.gameData?.status?.detailedState ??
      feed.gameData?.status?.abstractGameState ??
      ''
  ).toLowerCase();
  const abstractStatus = String(feed.gameData?.status?.abstractGameState ?? '');
  const detailedStatus = String(feed.gameData?.status?.detailedState ?? '');

  if (
    feedStatus.includes('postpon') ||
    feedStatus.includes('cancel') ||
    feedStatus.includes('suspend')
  ) {
    console.info(`skipped settlement: missing official status ${pick.game_id}`);
    return null;
  }

  if (market !== 'F5') {
    if (!(isOfficialFinalStatus(abstractStatus) || isOfficialFinalStatus(detailedStatus))) {
      console.info(`skipped settlement: game not final ${pick.game_id}`);
      return null;
    }
  } else if (!isF5Closed(feed)) {
    console.info(`skipped settlement: f5 not closed ${pick.game_id}`);
    return null;
  }

  const runs =
    market === 'F5'
      ? getFirstFiveRuns(feed)
      : getFinalRuns(feed);

  if (!runs) return null;

  const line =
    typeof pick.execution_line === 'number'
      ? pick.execution_line
      : typeof pick.line === 'number'
        ? pick.line
        : null;

  const status =
    side === 'over' || side === 'under'
      ? settleTotalMarket(side, line, runs)
      : settleSideMarket(
          side,
          line,
          runs,
          market === 'RL' ? 'RL' : market === 'F5' ? 'F5' : 'ML'
        );

  if (!status) return null;

  return settlePickRecord({
    pickId: pick.id,
    status,
    result: buildAutoResultLabel(status, market, runs),
    profitUnits: calculateProfitUnits(status, pick.execution_odds ?? pick.odds)
  });
}

export async function autoSettlePick(pick: PickRow): Promise<PickRow | null> {
  if (!isSettleablePendingPick(pick)) return null;

  const resolved = await resolveOfficialGameForPick(pick);

  if (resolved.kind === 'pending') {
    return null;
  }

  if (resolved.kind === 'void') {
    return settlePickRecord({
      pickId: pick.id,
      status: 'void',
      result: `AUTO_VOID ${resolved.reason}`,
      profitUnits: 0
    });
  }

  return settleFinalPick(pick, resolved);
}

export async function autoSettlePendingPicks(
  picks?: PickRow[]
): Promise<PickRow[]> {
  const sourcePicks = picks ?? await listPendingConfirmedPicks();
  const pending = sourcePicks.filter(
    (pick) => pick.status === 'pending' && isConfirmedPickRecord(pick)
  );

  if (!pending.length) {
    return [];
  }

  const settled: PickRow[] = [];

  for (const pick of pending) {
    try {
      const result = await autoSettlePick(pick);
      if (result) {
        settled.push(result);
      }
    } catch {
      // Ignore individual settlement failures so the rest of the ledger can continue.
    }
  }

  return settled;
}

async function shouldRevertSettledPick(pick: PickRow): Promise<boolean> {
  if (!String(pick.result ?? '').toUpperCase().startsWith('AUTO_')) {
    return false;
  }

  const market = getResolvedMarket(pick);
  if (!market) {
    return true;
  }

  const resolved = await resolveOfficialGameForPick(pick);
  if (resolved.kind === 'pending' || resolved.kind === 'void') {
    return true;
  }

  if (market !== 'F5') {
    if (resolved.kind !== 'final') {
      return true;
    }

    const feed = await fetchMlbJson<MlbLiveFeedResponse>(
      `${MLB_LIVE_API_BASE}/game/${resolved.gamePk}/feed/live`
    );
    const abstractStatus = String(feed.gameData?.status?.abstractGameState ?? '');
    const detailedStatus = String(feed.gameData?.status?.detailedState ?? '');
    return !(isOfficialFinalStatus(abstractStatus) || isOfficialFinalStatus(detailedStatus));
  }

  const feed = await fetchMlbJson<MlbLiveFeedResponse>(
    `${MLB_LIVE_API_BASE}/game/${resolved.gamePk}/feed/live`
  );
  return !isF5Closed(feed);
}

export async function revertIncorrectRecentAutoSettlements(options?: {
  hours?: number;
  limit?: number;
}): Promise<PickRow[]> {
  const hours = Math.max(6, Math.min(72, options?.hours ?? 36));
  const limit = Math.max(20, Math.min(500, options?.limit ?? 250));
  const cutoffMs = Date.now() - hours * 60 * 60 * 1000;

  const settled = await listPicks({
    statuses: ['won', 'lost', 'void'],
    includeUnconfirmed: true,
    orderBy: 'updated_at',
    ascending: false,
    limit
  });

  const candidates = settled.filter((pick) => {
    if (!String(pick.result ?? '').toUpperCase().startsWith('AUTO_')) return false;
    const updatedMs = new Date(pick.updated_at || '').getTime();
    return Number.isFinite(updatedMs) && updatedMs >= cutoffMs;
  });

  const reverted: PickRow[] = [];

  for (const pick of candidates) {
    try {
      const shouldRevert = await shouldRevertSettledPick(pick);
      if (!shouldRevert) continue;

      const row = await settlePickRecord({
        pickId: pick.id,
        status: 'pending',
        result: null,
        profitUnits: null
      });
      reverted.push(row);

      const market = getResolvedMarket(pick);
      if (market === 'F5') {
        console.warn(`reverted incorrect settlement for unresolved f5 ${pick.game_id}`);
      } else {
        console.warn(`reverted incorrect settlement for non-final game ${pick.game_id}`);
      }
    } catch {
      // Continue reverting other picks if one fails.
    }
  }

  return reverted;
}

export async function autoSettleRecentBackfill(options?: {
  days?: number;
  limit?: number;
}): Promise<PickRow[]> {
  const days = Math.max(1, Math.min(14, options?.days ?? 3));
  const limit = Math.max(10, Math.min(500, options?.limit ?? 200));
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const unsettled = await listPicks({
    statuses: ['pending'],
    includeUnconfirmed: true,
    orderBy: 'updated_at',
    ascending: false,
    limit
  });

  const candidates = unsettled.filter((pick) => {
    if (isNoBetLikePickRecord(pick)) return false;
    const anchorMs = new Date(pick.updated_at || pick.created_at || '').getTime();
    if (!Number.isFinite(anchorMs)) return true;
    return anchorMs >= cutoffMs;
  });

  if (!candidates.length) {
    return [];
  }

  const settled: PickRow[] = [];

  for (const pick of candidates) {
    try {
      const result = await autoSettlePick(pick);
      if (result) {
        settled.push(result);
      }
    } catch {
      // Ignore per-pick failures so the backfill can complete.
    }
  }

  return settled;
}
