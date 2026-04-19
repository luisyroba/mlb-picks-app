import type { NormalizedGameData as EspnNormalizedGameData } from './espn';
import {
  LINEUP_QUALITY_ADJUSTMENT_MAX,
  LINEUP_QUALITY_ADJUSTMENT_MIN
} from './types';
import type {
  BullpenStats,
  NormalizedGameData as EngineGame,
  StartingPitcherStats
} from './types';
import { getSavantParkFactors } from './baseball-savant';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_LIVE_API_BASE = 'https://statsapi.mlb.com/api/v1.1';
const MLB_REGULAR_SEASON = 'R';
const FIP_CONSTANT = 3.2;
const OPEN_METEO_FORECAST_BASE = 'https://api.open-meteo.com/v1';
const OPEN_METEO_GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1';
const EXTERNAL_STATS_TIMEOUT_MS = 7000;

type StatBucket = Record<string, unknown>;

type MlbScheduleTeam = {
  team?: {
    id?: number;
    name?: string;
    abbreviation?: string;
    teamName?: string;
    locationName?: string;
    clubName?: string;
  };
  probablePitcher?: {
    id?: number;
    fullName?: string;
  };
  score?: number;
};

type MlbScheduleGame = {
  gamePk?: number;
  gameType?: string;
  officialDate?: string;
  status?: {
    abstractGameState?: string;
    detailedState?: string;
  };
  teams?: {
    home?: MlbScheduleTeam;
    away?: MlbScheduleTeam;
  };
  venue?: {
    id?: number;
    name?: string;
  };
  lineups?: Record<string, unknown>;
};

type MlbScheduleResponse = {
  dates?: Array<{
    date?: string;
    games?: MlbScheduleGame[];
  }>;
};

type MlbStandingsTeamRecord = {
  team?: {
    id?: number;
  };
  wins?: number;
  losses?: number;
  gamesPlayed?: number;
  runsScored?: number;
  runsAllowed?: number;
  runDifferential?: number;
  divisionRank?: string;
  streak?: {
    streakCode?: string;
    streakNumber?: number;
  };
  records?: {
    splitRecords?: Array<{
      type?: string;
      wins?: number;
      losses?: number;
    }>;
  };
};

type MlbStandingsResponse = {
  records?: Array<{
    teamRecords?: MlbStandingsTeamRecord[];
  }>;
};

type MlbStatSplit = {
  stat?: StatBucket;
  split?: {
    code?: string;
  };
  player?: {
    id?: number;
    fullName?: string;
  };
};

type MlbStatsResponse = {
  stats?: Array<{
    type?: {
      displayName?: string;
    };
    group?: {
      displayName?: string;
    };
    splits?: MlbStatSplit[];
  }>;
};

type MlbRosterResponse = {
  roster?: Array<{
    person?: {
      id?: number;
      fullName?: string;
    };
    position?: {
      type?: string;
      abbreviation?: string;
    };
  }>;
};

type MlbPeopleResponse = {
  people?: Array<{
    id?: number;
    fullName?: string;
    pitchHand?: {
      code?: string;
    };
    stats?: Array<{
      type?: {
        displayName?: string;
      };
      group?: {
        displayName?: string;
      };
      splits?: Array<{
        stat?: StatBucket;
      }>;
    }>;
  }>;
};

type MlbLivePlayerBoxscore = {
  person?: {
    id?: number;
    fullName?: string;
  };
  stats?: {
    pitching?: StatBucket;
  };
};

type MlbLiveTeamBoxscore = {
  team?: {
    id?: number;
  };
  bullpen?: number[];
  players?: Record<string, MlbLivePlayerBoxscore>;
};

type MlbLiveFeedResponse = {
  liveData?: {
    boxscore?: {
      teams?: {
        home?: MlbLiveTeamBoxscore;
        away?: MlbLiveTeamBoxscore;
      };
    };
  };
};

type TeamStandingContext = {
  divisionRank?: number;
  wins?: number;
  losses?: number;
  runsScoredPerGame?: number;
  runsAllowedPerGame?: number;
  runDifferentialPerGame?: number;
  last10Wins?: number;
  last10Losses?: number;
  homeWins?: number;
  homeLosses?: number;
  awayWins?: number;
  awayLosses?: number;
  streakType?: 'W' | 'L' | 'N';
  streakCount?: number;
};

type StandingSplitRecord = {
  type?: string;
  wins?: number;
  losses?: number;
};

type TeamOffenseContext = {
  runsPerGame?: number;
  battingAverage?: number;
  onBasePct?: number;
  sluggingPct?: number;
  ops?: number;
  vsRightOps?: number;
  vsLeftOps?: number;
};

type RecentGame = {
  gamePk: number;
  officialDate: string;
  teamRuns: number;
};

type RecentTeamContext = {
  last7RunsPerGame: number;
  last14RunsPerGame: number;
  playedYesterday: boolean;
  recentGamesForBullpen: RecentGame[];
};

type RelieverSeasonContext = {
  playerId: number;
  name: string;
  saves: number;
  holds: number;
  gamesFinished: number;
  gamesStarted: number;
  gamesPitched: number;
  inningsPitched: number;
  hits: number;
  earnedRuns: number;
  homeRuns: number;
  strikeOuts: number;
  baseOnBalls: number;
  hitBatters: number;
  era?: number;
  whip?: number;
};

type PitcherUsageContext = {
  last2Outs: number;
  last3Outs: number;
  usedYesterday: boolean;
  usedTwoDaysAgo: boolean;
};

type HitterSeasonContext = {
  playerId: number;
  name: string;
  plateAppearances: number;
  ops?: number;
  obp?: number;
  slg?: number;
};

type TeamLineupContext = {
  confirmedLineup: boolean;
  missingKeyBatCount: number;
  missingKeyBatters: string[];
  catcherBackup?: boolean;
  lineupQualityAdjustment: number;
};

type LeaguePitchingContext = {
  hrPerFlyBall: number;
};

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    latitude?: number;
    longitude?: number;
    timezone?: string;
  }>;
};

type OpenMeteoForecastResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    wind_speed_10m?: number[];
  };
};

const openMeteoGeocodeCache = new Map<
  string,
  Promise<{ latitude: number; longitude: number; timezone?: string } | null>
>();
const openMeteoWeatherCache = new Map<
  string,
  Promise<Partial<EngineGame['parkWeather']> | null>
>();

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const cleaned = value.trim();

    if (
      cleaned.length === 0 ||
      cleaned === '-' ||
      cleaned === '--' ||
      cleaned === '.---' ||
      cleaned === '-.--'
    ) {
      return undefined;
    }

    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function parseInnings(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value !== 'string') return undefined;

  const cleaned = value.trim();
  if (!cleaned || cleaned === '-' || cleaned === '.---' || cleaned === '-.--') {
    return undefined;
  }

  const match = cleaned.match(/^(\d+)(?:\.(\d))?$/);
  if (!match) return undefined;

  const whole = Number(match[1]);
  const partial = Number(match[2] ?? 0);

  if (!Number.isFinite(whole)) return undefined;
  if (partial === 0) return whole;
  if (partial === 1) return whole + 1 / 3;
  if (partial === 2) return whole + 2 / 3;

  return undefined;
}

function roundStat(value: number | undefined, digits = 2): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Number(value.toFixed(digits));
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

function getCanonicalNameVariants(value?: string | null): string[] {
  const canonical = canonicalizeTeamName(value);
  const variants = new Set<string>();

  if (canonical) {
    variants.add(canonical);

    const parts = canonical.split(' ').filter(Boolean);

    if (parts.length >= 2) {
      variants.add(parts[parts.length - 1]); // yankees, mets, athletics, etc.
      variants.add(parts.slice(1).join(' ')); // york yankees, angeles angels, etc.
    }
    }

  return [...variants];
}

function canonicalizeTeamName(value?: string | null): string {
  const normalized = normalizeText(value);

  const aliases: Record<string, string> = {
    'bronx yankees': 'new york yankees',
    'flushing mets': 'new york mets',
    'minneapolis twins': 'minnesota twins',
    'anaheim angels': 'los angeles angels'
  };

  return aliases[normalized] ?? normalized;
}

function normalizeAbbreviation(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase();
}

function toOfficialDate(value?: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function shiftDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function average(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function safeResolve<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function calculateFip(stat?: StatBucket): number | undefined {
  if (!stat) return undefined;

  const inningsPitched = parseInnings(stat.inningsPitched);
  const homeRuns = optionalNumber(stat.homeRuns) ?? 0;
  const walks = optionalNumber(stat.baseOnBalls) ?? 0;
  const hitBatters = optionalNumber(stat.hitBatsmen) ?? 0;
  const strikeouts = optionalNumber(stat.strikeOuts) ?? 0;

  if (!inningsPitched || inningsPitched <= 0) return undefined;

  const fip =
    ((13 * homeRuns) + (3 * (walks + hitBatters)) - (2 * strikeouts)) /
      inningsPitched +
    FIP_CONSTANT;

  return roundStat(fip, 2);
}

function calculateXFip(
  seasonStat: StatBucket | undefined,
  advancedStat: StatBucket | undefined,
  leagueHrPerFlyBall: number
): number | undefined {
  if (!seasonStat || !advancedStat || !leagueHrPerFlyBall) {
    return undefined;
  }

  const inningsPitched = parseInnings(seasonStat.inningsPitched);
  const flyOuts = optionalNumber(advancedStat.flyOuts) ?? 0;
  const flyHits = optionalNumber(advancedStat.flyHits) ?? 0;
  const homeRuns = optionalNumber(seasonStat.homeRuns) ?? optionalNumber(advancedStat.homeRuns) ?? 0;
  const walks = optionalNumber(seasonStat.baseOnBalls) ?? 0;
  const hitBatters = optionalNumber(seasonStat.hitBatsmen) ?? 0;
  const strikeouts = optionalNumber(seasonStat.strikeOuts) ?? 0;

  if (!inningsPitched || inningsPitched <= 0) return undefined;

  const totalFlyBalls = flyOuts + flyHits + homeRuns;
  if (totalFlyBalls <= 0) return undefined;

  const expectedHomeRuns = totalFlyBalls * leagueHrPerFlyBall;
  const xfip =
    ((13 * expectedHomeRuns) + (3 * (walks + hitBatters)) - (2 * strikeouts)) /
      inningsPitched +
    FIP_CONSTANT;

  return roundStat(xfip, 2);
}

function getExpectedInningsFromOfficialStat(stat?: StatBucket): number | undefined {
  const inningsPitched = parseInnings(stat?.inningsPitched);
  const gamesStarted = optionalNumber(stat?.gamesStarted);

  if (!inningsPitched || !gamesStarted || gamesStarted <= 0) {
    return undefined;
  }

  return roundStat(inningsPitched / gamesStarted, 1);
}

async function fetchJson<T>(url: string, sourceLabel: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(EXTERNAL_STATS_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`${sourceLabel} request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function fetchMlbJson<T>(url: string): Promise<T> {
  return fetchJson<T>(url, 'MLB Stats API');
}

async function fetchOpenMeteoJson<T>(url: string): Promise<T> {
  return fetchJson<T>(url, 'Open-Meteo');
}

function getOpenMeteoQueries(
  venueName?: string | null,
  city?: string | null,
  state?: string | null
): string[] {
  const queries = [
    [venueName, city, state].filter(Boolean).join(' '),
    [venueName, city].filter(Boolean).join(' '),
    venueName ?? ''
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(queries)];
}

async function geocodeVenueWithOpenMeteo(
  venueName?: string | null,
  city?: string | null,
  state?: string | null
): Promise<{ latitude: number; longitude: number; timezone?: string } | null> {
  for (const query of getOpenMeteoQueries(venueName, city, state)) {
    const cacheKey = normalizeText(query);

    let pending = openMeteoGeocodeCache.get(cacheKey);
    if (!pending) {
      const url =
        `${OPEN_METEO_GEOCODING_BASE}/search?name=${encodeURIComponent(query)}` +
        '&count=1&language=en&format=json';

      pending = fetchOpenMeteoJson<OpenMeteoGeocodingResponse>(url)
        .then((json) => {
          const first = json.results?.[0];
          const latitude = optionalNumber(first?.latitude);
          const longitude = optionalNumber(first?.longitude);

          if (latitude === undefined || longitude === undefined) {
            return null;
          }

          return {
            latitude,
            longitude,
            timezone: typeof first?.timezone === 'string' ? first.timezone : undefined
          };
        })
        .catch(() => null);

      openMeteoGeocodeCache.set(cacheKey, pending);
    }

    const geocoded = await pending;
    if (geocoded) return geocoded;
  }

  return null;
}

function resolveClosestHourlyIndex(times: string[], startTime: string): number | null {
  const targetMs = new Date(startTime).getTime();
  if (!Number.isFinite(targetMs)) return null;

  let closestIndex: number | null = null;
  let closestDelta = Number.POSITIVE_INFINITY;

  for (let index = 0; index < times.length; index += 1) {
    const pointMs = new Date(times[index]).getTime();
    if (!Number.isFinite(pointMs)) continue;

    const delta = Math.abs(pointMs - targetMs);
    if (delta < closestDelta) {
      closestDelta = delta;
      closestIndex = index;
    }
  }

  return closestIndex;
}

async function getOpenMeteoVenueWeather(params: {
  venueName?: string | null;
  city?: string | null;
  state?: string | null;
  startTime?: string | null;
  roofClosed?: boolean | null;
}): Promise<Partial<EngineGame['parkWeather']> | null> {
  if (params.roofClosed || !params.startTime || !params.venueName) {
    return null;
  }

  const geocoded = await geocodeVenueWithOpenMeteo(
    params.venueName,
    params.city,
    params.state
  );

  if (!geocoded) return null;

  const startHourKey = params.startTime.slice(0, 13);
  const cacheKey = `${geocoded.latitude.toFixed(3)}:${geocoded.longitude.toFixed(3)}:${startHourKey}`;

  let pending = openMeteoWeatherCache.get(cacheKey);
  if (!pending) {
    const url =
      `${OPEN_METEO_FORECAST_BASE}/forecast?latitude=${geocoded.latitude}&longitude=${geocoded.longitude}` +
      '&hourly=temperature_2m,precipitation_probability,wind_speed_10m' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=3';

    pending = fetchOpenMeteoJson<OpenMeteoForecastResponse>(url)
      .then((json) => {
        const times = json.hourly?.time ?? [];
        const closestIndex = resolveClosestHourlyIndex(times, params.startTime!);
        if (closestIndex === null) {
          return null;
        }

        return {
          temperatureF: roundStat(json.hourly?.temperature_2m?.[closestIndex], 1),
          windMph: roundStat(json.hourly?.wind_speed_10m?.[closestIndex], 1),
          rainRiskPct: roundStat(json.hourly?.precipitation_probability?.[closestIndex], 0)
        } satisfies Partial<EngineGame['parkWeather']>;
      })
      .catch(() => null);

    openMeteoWeatherCache.set(cacheKey, pending);
  }

  return pending;
}

function getSplitRecord(
  splitRecords: StandingSplitRecord[] | undefined,
  type: string
): { wins: number; losses: number } | null {
  const match = splitRecords?.find((record) => record.type === type);
  const wins = optionalNumber(match?.wins);
  const losses = optionalNumber(match?.losses);

  if (wins === undefined || losses === undefined) {
    return null;
  }

  return { wins, losses };
}

function buildStandingContext(record: MlbStandingsTeamRecord): TeamStandingContext {
  const gamesPlayed = optionalNumber(record.gamesPlayed);
  const runsScored = optionalNumber(record.runsScored);
  const runsAllowed = optionalNumber(record.runsAllowed);
  const runDifferential = optionalNumber(record.runDifferential);
  const splitRecords = record.records?.splitRecords;
  const lastTen = getSplitRecord(splitRecords, 'lastTen');
  const home = getSplitRecord(splitRecords, 'home');
  const away = getSplitRecord(splitRecords, 'away');

  const streakCode = String(record.streak?.streakCode ?? '').toUpperCase();
  const streakType =
    streakCode.startsWith('W') ? 'W' :
    streakCode.startsWith('L') ? 'L' :
    'N';

  const streakCount = optionalNumber(record.streak?.streakNumber) ?? 0;

  return {
    divisionRank: optionalNumber(record.divisionRank),
    wins: optionalNumber(record.wins),
    losses: optionalNumber(record.losses),
    runsScoredPerGame:
      gamesPlayed && runsScored !== undefined
        ? roundStat(runsScored / gamesPlayed, 3)
        : undefined,
    runsAllowedPerGame:
      gamesPlayed && runsAllowed !== undefined
        ? roundStat(runsAllowed / gamesPlayed, 3)
        : undefined,
    runDifferentialPerGame:
      gamesPlayed && runDifferential !== undefined
        ? roundStat(runDifferential / gamesPlayed, 3)
        : undefined,
    last10Wins: lastTen?.wins,
    last10Losses: lastTen?.losses,
    homeWins: home?.wins,
    homeLosses: home?.losses,
    awayWins: away?.wins,
    awayLosses: away?.losses,
    streakType,
    streakCount
  };
}

async function getStandingsMap(season: string): Promise<Map<number, TeamStandingContext>> {
  const json = await fetchMlbJson<MlbStandingsResponse>(
    `${MLB_API_BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`
  );

  const map = new Map<number, TeamStandingContext>();

  for (const recordGroup of json.records ?? []) {
    for (const teamRecord of recordGroup.teamRecords ?? []) {
      const teamId = optionalNumber(teamRecord.team?.id);
      if (!teamId) continue;
      map.set(teamId, buildStandingContext(teamRecord));
    }
  }

  return map;
}

function getTeamDisplayName(team?: MlbScheduleTeam['team']): string {
  const location = team?.locationName;
  const club = team?.clubName || team?.teamName;

  if (location && club) {
    return canonicalizeTeamName(`${location} ${club}`);
  }

  return canonicalizeTeamName(String(team?.name ?? ''));
}

function findScheduleGameForEspnGame(
  schedule: MlbScheduleResponse,
  espnGame: EspnNormalizedGameData
): MlbScheduleGame | null {
  const expectedHome = getCanonicalNameVariants(espnGame.homeTeam.displayName);
  const expectedAway = getCanonicalNameVariants(espnGame.awayTeam.displayName);
  const expectedHomeAbbr = normalizeAbbreviation(espnGame.homeTeam.abbreviation);
  const expectedAwayAbbr = normalizeAbbreviation(espnGame.awayTeam.abbreviation);

  for (const date of schedule.dates ?? []) {
    for (const game of date.games ?? []) {
      const homeTeam = game.teams?.home?.team;
      const awayTeam = game.teams?.away?.team;

      const homeAbbr = normalizeAbbreviation(homeTeam?.abbreviation);
      const awayAbbr = normalizeAbbreviation(awayTeam?.abbreviation);

      if (
        homeAbbr &&
        awayAbbr &&
        homeAbbr === expectedHomeAbbr &&
        awayAbbr === expectedAwayAbbr
      ) {
        return game;
      }

      const homeCandidates = new Set<string>();
      const awayCandidates = new Set<string>();

      for (const candidate of [
        getTeamDisplayName(homeTeam),
        homeTeam?.name,
        [homeTeam?.locationName, homeTeam?.teamName].filter(Boolean).join(' '),
        [homeTeam?.locationName, homeTeam?.clubName].filter(Boolean).join(' ')
      ]) {
        for (const variant of getCanonicalNameVariants(candidate)) {
          homeCandidates.add(variant);
        }
      }

      for (const candidate of [
        getTeamDisplayName(awayTeam),
        awayTeam?.name,
        [awayTeam?.locationName, awayTeam?.teamName].filter(Boolean).join(' '),
        [awayTeam?.locationName, awayTeam?.clubName].filter(Boolean).join(' ')
      ]) {
        for (const variant of getCanonicalNameVariants(candidate)) {
          awayCandidates.add(variant);
        }
      }

      const homeMatches = expectedHome.some((name) => homeCandidates.has(name));
      const awayMatches = expectedAway.some((name) => awayCandidates.has(name));

      if (homeMatches && awayMatches) {
        return game;
      }
    }
  }

  return null;
}

function getSeasonSplit(
  stats: MlbStatsResponse['stats'],
  typeDisplayName: string,
  groupDisplayName: string
): MlbStatSplit | null {
  const entry = stats?.find(
    (stat) =>
      stat.type?.displayName === typeDisplayName &&
      stat.group?.displayName === groupDisplayName
  );

  return entry?.splits?.[0] ?? null;
}

function getSplitByCode(
  stats: MlbStatsResponse['stats'],
  typeDisplayName: string,
  groupDisplayName: string,
  code: string
): MlbStatSplit | null {
  const entry = stats?.find(
    (stat) =>
      stat.type?.displayName === typeDisplayName &&
      stat.group?.displayName === groupDisplayName
  );

  return (
    entry?.splits?.find((split) => split.split?.code === code) ?? null
  );
}

async function getTeamOffenseContext(
  teamId: number,
  season: string
): Promise<TeamOffenseContext> {
  const json = await fetchMlbJson<MlbStatsResponse>(
    `${MLB_API_BASE}/teams/${teamId}/stats?stats=season,statSplits&group=hitting&season=${season}&sitCodes=vr,vl`
  );

  const seasonSplit = getSeasonSplit(json.stats, 'season', 'hitting');
  const vsRightSplit = getSplitByCode(json.stats, 'statSplits', 'hitting', 'vr');
  const vsLeftSplit = getSplitByCode(json.stats, 'statSplits', 'hitting', 'vl');

  const seasonStat = seasonSplit?.stat;

  return {
    runsPerGame:
      (() => {
        const runs = optionalNumber(seasonStat?.runs);
        const gamesPlayed = optionalNumber(seasonStat?.gamesPlayed);

        if (runs === undefined || gamesPlayed === undefined || gamesPlayed <= 0) {
          return undefined;
        }

        return roundStat(runs / gamesPlayed, 3);
      })(),
    battingAverage: optionalNumber(seasonStat?.avg),
    onBasePct: optionalNumber(seasonStat?.obp),
    sluggingPct: optionalNumber(seasonStat?.slg),
    ops: optionalNumber(seasonStat?.ops),
    vsRightOps: optionalNumber(vsRightSplit?.stat?.ops),
    vsLeftOps: optionalNumber(vsLeftSplit?.stat?.ops)
  };
}

async function getTeamBullpenSeasonStat(
  teamId: number,
  season: string
): Promise<StatBucket | undefined> {
  const json = await fetchMlbJson<MlbStatsResponse>(
    `${MLB_API_BASE}/teams/${teamId}/stats?stats=statSplits&group=pitching&season=${season}&sitCodes=rp`
  );

  return getSplitByCode(json.stats, 'statSplits', 'pitching', 'rp')?.stat;
}

function hasRealBullpenShape(stat?: StatBucket): boolean {
  if (!stat) return false;

  return (
    optionalNumber(stat.era) !== undefined ||
    optionalNumber(stat.whip) !== undefined ||
    calculateFip(stat) !== undefined
  );
}

async function getLeaguePitchingContext(
  season: string
): Promise<LeaguePitchingContext> {
  const json = await fetchMlbJson<MlbStatsResponse>(
    `${MLB_API_BASE}/teams/stats?stats=seasonAdvanced&group=pitching&sportIds=1&season=${season}`
  );

  const seasonSplits =
    json.stats?.find(
      (entry) =>
        entry.type?.displayName === 'seasonAdvanced' &&
        entry.group?.displayName === 'pitching'
    )?.splits ?? [];

  let homeRuns = 0;
  let flyOuts = 0;
  let flyHits = 0;

  for (const split of seasonSplits) {
    homeRuns += optionalNumber(split.stat?.homeRuns) ?? 0;
    flyOuts += optionalNumber(split.stat?.flyOuts) ?? 0;
    flyHits += optionalNumber(split.stat?.flyHits) ?? 0;
  }

  const totalFlyBalls = homeRuns + flyOuts + flyHits;

  return {
    hrPerFlyBall:
      totalFlyBalls > 0
        ? homeRuns / totalFlyBalls
        : 0.105
  };
}

async function getTeamHitterSeasons(
  teamId: number,
  season: string
): Promise<{
  allHitters: HitterSeasonContext[];
  activeHitterIds: Set<number>;
  activePlayerPositions: Map<number, string | undefined>;
}> {
  const [roster, stats] = await Promise.all([
    fetchMlbJson<MlbRosterResponse>(
      `${MLB_API_BASE}/teams/${teamId}/roster?rosterType=active`
    ),
    fetchMlbJson<MlbStatsResponse>(
      `${MLB_API_BASE}/stats?stats=season&group=hitting&sportIds=1&season=${season}&playerPool=ALL&teamId=${teamId}&hydrate=team,person`
    )
  ]);

  const activeHitterIds = new Set<number>();
  const activePlayerPositions = new Map<number, string | undefined>();

  for (const player of roster.roster ?? []) {
    const playerId = optionalNumber(player.person?.id);
    if (!playerId) continue;

    if (player.position?.type !== 'Pitcher') {
      activeHitterIds.add(playerId);
    }

    activePlayerPositions.set(
      playerId,
      String(player.position?.abbreviation ?? player.position?.type ?? '').toLowerCase() === 'c' ||
      String(player.position?.type ?? '').toLowerCase() === 'catcher'
        ? 'c'
        : undefined
    );
  }

  const seasonSplits =
    stats.stats?.find(
      (entry) =>
        entry.type?.displayName === 'season' &&
        entry.group?.displayName === 'hitting'
    )?.splits ?? [];

  const allHitters: HitterSeasonContext[] = [];

  for (const split of seasonSplits) {
    const playerId = optionalNumber(split.player?.id);
    const stat = split.stat;

    if (!playerId) continue;

    const plateAppearances =
      optionalNumber(stat?.plateAppearances) ??
      optionalNumber(stat?.atBats) ??
      0;

    allHitters.push({
      playerId,
      name: String(split.player?.fullName ?? 'Unknown hitter'),
      plateAppearances,
      ops: optionalNumber(stat?.ops),
      obp: optionalNumber(stat?.obp),
      slg: optionalNumber(stat?.slg)
    });
  }

  return {
    allHitters,
    activeHitterIds,
    activePlayerPositions
  };
}

async function getRecentTeamContext(
  teamId: number,
  officialDate: string,
  currentGamePk?: number
): Promise<RecentTeamContext> {
  const startDate = shiftDate(officialDate, -20);
  const endDate = shiftDate(officialDate, -1);

  const json = await fetchMlbJson<MlbScheduleResponse>(
    `${MLB_API_BASE}/schedule?teamId=${teamId}&sportId=1&startDate=${startDate}&endDate=${endDate}`
  );

  const games: RecentGame[] = [];

  for (const date of json.dates ?? []) {
    for (const game of date.games ?? []) {
      const gamePk = optionalNumber(game.gamePk);
      const gameDate = String(game.officialDate ?? '');
      const gameType = String(game.gameType ?? '');
      const abstractState = String(game.status?.abstractGameState ?? '');

      if (
        !gamePk ||
        !gameDate ||
        gamePk === currentGamePk ||
        gameType !== MLB_REGULAR_SEASON ||
        abstractState !== 'Final'
      ) {
        continue;
      }

      const homeTeamId = optionalNumber(game.teams?.home?.team?.id);
      const awayTeamId = optionalNumber(game.teams?.away?.team?.id);
      const homeScore = optionalNumber(game.teams?.home?.score);
      const awayScore = optionalNumber(game.teams?.away?.score);

      if (homeTeamId === teamId && homeScore !== undefined) {
        games.push({
          gamePk,
          officialDate: gameDate,
          teamRuns: homeScore
        });
      } else if (awayTeamId === teamId && awayScore !== undefined) {
        games.push({
          gamePk,
          officialDate: gameDate,
          teamRuns: awayScore
        });
      }
    }
  }

  games.sort((left, right) => right.officialDate.localeCompare(left.officialDate));

  const last7Runs = games.slice(0, 7).map((game) => game.teamRuns);
  const last14Runs = games.slice(0, 14).map((game) => game.teamRuns);
  const previousDay = shiftDate(officialDate, -1);
  const last3DayCutoff = shiftDate(officialDate, -3);

  return {
    last7RunsPerGame: roundStat(average(last7Runs, average(last14Runs, 0)), 3) ?? 0,
    last14RunsPerGame: roundStat(average(last14Runs, average(last7Runs, 0)), 3) ?? 0,
    playedYesterday: games.some((game) => game.officialDate === previousDay),
    recentGamesForBullpen: games.filter((game) => game.officialDate >= last3DayCutoff)
  };
}

async function getActiveRelieverSeasons(
  teamId: number,
  season: string
): Promise<RelieverSeasonContext[]> {
  const [roster, stats] = await Promise.all([
    fetchMlbJson<MlbRosterResponse>(
      `${MLB_API_BASE}/teams/${teamId}/roster?rosterType=active`
    ),
    fetchMlbJson<MlbStatsResponse>(
      `${MLB_API_BASE}/stats?stats=season&group=pitching&sportIds=1&season=${season}&playerPool=ALL&teamId=${teamId}&hydrate=team,person`
    )
  ]);

  const activePitcherIds = new Set(
    (roster.roster ?? [])
      .filter((player) => player.position?.type === 'Pitcher')
      .map((player) => optionalNumber(player.person?.id))
      .filter((id): id is number => id !== undefined)
  );

  const seasonSplits =
    stats.stats?.find(
      (entry) =>
        entry.type?.displayName === 'season' &&
        entry.group?.displayName === 'pitching'
    )?.splits ?? [];

  return seasonSplits
    .map((split): RelieverSeasonContext | null => {
      const playerId = optionalNumber(split.player?.id);
      const stat = split.stat;

      if (!playerId || !activePitcherIds.has(playerId)) {
        return null;
      }

      const gamesStarted = optionalNumber(stat?.gamesStarted) ?? 0;
      const gamesPitched = optionalNumber(stat?.gamesPitched) ?? 0;
      const saves = optionalNumber(stat?.saves) ?? 0;
      const holds = optionalNumber(stat?.holds) ?? 0;
      const gamesFinished = optionalNumber(stat?.gamesFinished) ?? 0;
      const inningsPitched = parseInnings(stat?.inningsPitched) ?? 0;

      if (
        gamesPitched <= 0 ||
        (gamesStarted > 0 &&
          gamesPitched - gamesStarted < 3 &&
          saves === 0 &&
          holds === 0 &&
          gamesFinished === 0)
      ) {
        return null;
      }

      const reliever: RelieverSeasonContext = {
        playerId,
        name: String(split.player?.fullName ?? 'Unknown reliever'),
        saves,
        holds,
        gamesFinished,
        gamesStarted,
        gamesPitched,
        inningsPitched,
        hits: optionalNumber(stat?.hits) ?? 0,
        earnedRuns: optionalNumber(stat?.earnedRuns) ?? 0,
        homeRuns: optionalNumber(stat?.homeRuns) ?? 0,
        strikeOuts: optionalNumber(stat?.strikeOuts) ?? 0,
        baseOnBalls: optionalNumber(stat?.baseOnBalls) ?? 0,
        hitBatters:
          optionalNumber(stat?.hitBatsmen) ??
          optionalNumber(stat?.hitByPitch) ??
          0
      };

      const era = optionalNumber(stat?.era);
      const whip = optionalNumber(stat?.whip);

      if (era !== undefined) {
        reliever.era = era;
      }

      if (whip !== undefined) {
        reliever.whip = whip;
      }

      return reliever;
    })
    .filter((split): split is RelieverSeasonContext => split !== null);
}

async function getBullpenUsageContext(
  teamId: number,
  officialDate: string,
  recentGames: RecentGame[]
): Promise<Map<number, PitcherUsageContext>> {
  const usage = new Map<number, PitcherUsageContext>();
  const previousDay = shiftDate(officialDate, -1);
  const twoDaysAgo = shiftDate(officialDate, -2);
  const last2DayCutoff = shiftDate(officialDate, -2);
  const last3DayCutoff = shiftDate(officialDate, -3);

  const feeds = await Promise.all(
    recentGames.map(async (game) => {
      const json = await fetchMlbJson<MlbLiveFeedResponse>(
        `${MLB_LIVE_API_BASE}/game/${game.gamePk}/feed/live`
      );

      return {
        game,
        json
      };
    })
  );

  for (const feed of feeds) {
    const teams = feed.json.liveData?.boxscore?.teams;

    const boxscoreTeam =
      optionalNumber(teams?.home?.team?.id) === teamId
        ? teams?.home
        : optionalNumber(teams?.away?.team?.id) === teamId
          ? teams?.away
          : undefined;

    if (!boxscoreTeam?.bullpen?.length || !boxscoreTeam.players) {
      continue;
    }

    for (const pitcherId of boxscoreTeam.bullpen) {
      const player = boxscoreTeam.players[`ID${pitcherId}`];
      const outs = optionalNumber(player?.stats?.pitching?.outs) ?? 0;

      if (outs <= 0) {
        continue;
      }

      const current = usage.get(pitcherId) ?? {
        last2Outs: 0,
        last3Outs: 0,
        usedYesterday: false,
        usedTwoDaysAgo: false
      };

      if (feed.game.officialDate >= last3DayCutoff) {
        current.last3Outs += outs;
      }

      if (feed.game.officialDate >= last2DayCutoff) {
        current.last2Outs += outs;
      }

      if (feed.game.officialDate === previousDay) {
        current.usedYesterday = true;
      }

      if (feed.game.officialDate === twoDaysAgo) {
        current.usedTwoDaysAgo = true;
      }

      usage.set(pitcherId, current);
    }
  }

  return usage;
}

function buildAvailabilityFlags(
  relievers: RelieverSeasonContext[],
  usage: Map<number, PitcherUsageContext>
): {
  closerAvailable: boolean;
  setupAvailable: boolean;
} {
  const sortedForCloser = [...relievers].sort((left, right) => {
    const leftScore = left.saves * 10 + left.gamesFinished * 2 + left.holds;
    const rightScore = right.saves * 10 + right.gamesFinished * 2 + right.holds;
    return rightScore - leftScore;
  });

  const sortedForSetup = [...relievers].sort((left, right) => {
    const leftScore = left.holds * 4 + left.saves * 2 + left.gamesFinished;
    const rightScore = right.holds * 4 + right.saves * 2 + right.gamesFinished;
    return rightScore - leftScore;
  });

  const isCloserAvailable = (pitcherId: number) => {
    const usageContext = usage.get(pitcherId);
    if (!usageContext) return true;

    return !(
      (usageContext.usedYesterday && usageContext.usedTwoDaysAgo) ||
      usageContext.last2Outs >= 4 ||
      usageContext.last3Outs >= 7
    );
  };

  const isSetupAvailable = (pitcherId: number) => {
    const usageContext = usage.get(pitcherId);
    if (!usageContext) return true;

    return !(
      (usageContext.usedYesterday && usageContext.usedTwoDaysAgo) ||
      usageContext.last2Outs >= 5 ||
      usageContext.last3Outs >= 8
    );
  };

  const closerCandidates = sortedForCloser.slice(0, 2);
  const setupCandidates = sortedForSetup.slice(0, 4);

  return {
    closerAvailable:
      closerCandidates.length > 0
        ? closerCandidates.some((pitcher) => isCloserAvailable(pitcher.playerId))
        : true,
    setupAvailable:
      setupCandidates.length > 0
        ? setupCandidates.some((pitcher) => isSetupAvailable(pitcher.playerId))
        : true
  };
}

function buildBullpenSeasonAggregateFromRelievers(
  relievers: RelieverSeasonContext[]
): StatBucket | undefined {
  const eligible = relievers.filter(
    (reliever) =>
      reliever.gamesPitched > 0 &&
      reliever.inningsPitched > 0
  );

  if (!eligible.length) {
    return undefined;
  }

  const totals = eligible.reduce(
    (accumulator, reliever) => {
      accumulator.inningsPitched += reliever.inningsPitched;
      accumulator.hits += reliever.hits;
      accumulator.earnedRuns += reliever.earnedRuns;
      accumulator.homeRuns += reliever.homeRuns;
      accumulator.strikeOuts += reliever.strikeOuts;
      accumulator.baseOnBalls += reliever.baseOnBalls;
      accumulator.hitBatters += reliever.hitBatters;
      return accumulator;
    },
    {
      inningsPitched: 0,
      hits: 0,
      earnedRuns: 0,
      homeRuns: 0,
      strikeOuts: 0,
      baseOnBalls: 0,
      hitBatters: 0
    }
  );

  if (totals.inningsPitched <= 0) {
    return undefined;
  }

  const era = roundStat((totals.earnedRuns * 9) / totals.inningsPitched, 2);
  const whip = roundStat(
    (totals.hits + totals.baseOnBalls) / totals.inningsPitched,
    2
  );

  return {
    inningsPitched: roundStat(totals.inningsPitched, 1),
    hits: totals.hits,
    earnedRuns: totals.earnedRuns,
    homeRuns: totals.homeRuns,
    strikeOuts: totals.strikeOuts,
    baseOnBalls: totals.baseOnBalls,
    hitBatsmen: totals.hitBatters,
    era,
    whip
  };
}

function buildBullpenFromOfficialData(
  bullpenSeasonStat: StatBucket | undefined,
  usage: Map<number, PitcherUsageContext>,
  availability: {
    closerAvailable: boolean;
    setupAvailable: boolean;
  },
  metadata?: Pick<BullpenStats, 'source' | 'sourceLabel' | 'isFallback' | 'fallbackReason'>
): BullpenStats {
  const last2Outs = [...usage.values()].reduce(
    (sum, pitcher) => sum + pitcher.last2Outs,
    0
  );
  const last3Outs = [...usage.values()].reduce(
    (sum, pitcher) => sum + pitcher.last3Outs,
    0
  );

  const last2DaysInnings = roundStat(last2Outs / 3, 1) ?? 0;
  const last3DaysInnings = roundStat(last3Outs / 3, 1) ?? 0;

  let fatigueScore = 20;
  fatigueScore += last2DaysInnings * 9;
  fatigueScore += last3DaysInnings * 5;

  if (!availability.closerAvailable) fatigueScore += 12;
  if (!availability.setupAvailable) fatigueScore += 8;

  return {
    era: optionalNumber(bullpenSeasonStat?.era),
    fip: calculateFip(bullpenSeasonStat),
    whip: optionalNumber(bullpenSeasonStat?.whip),
    last2DaysInnings,
    last3DaysInnings,
    fatigueScore: Math.max(0, Math.min(100, Math.round(fatigueScore))),
    closerAvailable: availability.closerAvailable,
    setupAvailable: availability.setupAvailable,
    source: metadata?.source,
    sourceLabel: metadata?.sourceLabel,
    isFallback: metadata?.isFallback,
    fallbackReason: metadata?.fallbackReason
  };
}

function buildBullpenDebugLine(teamName: string, bullpen: BullpenStats): string {
  return `[bullpen] ${teamName}: source=${bullpen.source ?? 'unknown'} real=${bullpen.isFallback ? 'no' : 'yes'} reason=${bullpen.fallbackReason ?? 'none'} era=${bullpen.era ?? 'n/a'} fip=${bullpen.fip ?? 'n/a'} whip=${bullpen.whip ?? 'n/a'}`;
}

function resolveBullpenStats(params: {
  teamName: string;
  teamBullpenSeasonStat?: StatBucket;
  relievers: RelieverSeasonContext[];
  usage: Map<number, PitcherUsageContext>;
  availability: {
    closerAvailable: boolean;
    setupAvailable: boolean;
  };
  baseBullpen: BullpenStats;
  teamSplitError?: string | null;
}): BullpenStats {
  const aggregateStat = buildBullpenSeasonAggregateFromRelievers(params.relievers);
  const teamSplitAvailable = hasRealBullpenShape(params.teamBullpenSeasonStat);
  const aggregateAvailable = hasRealBullpenShape(aggregateStat);
  const usageOnlyBullpen = buildBullpenFromOfficialData(
    undefined,
    params.usage,
    params.availability
  );

  if (teamSplitAvailable) {
    const bullpen = buildBullpenFromOfficialData(
      params.teamBullpenSeasonStat,
      params.usage,
      params.availability,
      {
        source: 'team_stat_split',
        sourceLabel: 'MLB team bullpen split',
        isFallback: false,
        fallbackReason: params.teamSplitError
          ? `team split recovered after transient error: ${params.teamSplitError}`
          : undefined
      }
    );
    console.info(buildBullpenDebugLine(params.teamName, bullpen));
    return bullpen;
  }

  if (aggregateAvailable) {
    const reason = params.teamSplitError
      ? `team bullpen split unavailable: ${params.teamSplitError}`
      : 'team bullpen split missing or incomplete';
    const bullpen = buildBullpenFromOfficialData(
      aggregateStat,
      params.usage,
      params.availability,
      {
        source: 'active_reliever_aggregate',
        sourceLabel: 'Active reliever aggregate',
        isFallback: false,
        fallbackReason: reason
      }
    );
    console.info(buildBullpenDebugLine(params.teamName, bullpen));
    return bullpen;
  }

  const bullpen = {
    ...params.baseBullpen,
    last2DaysInnings: usageOnlyBullpen.last2DaysInnings,
    last3DaysInnings: usageOnlyBullpen.last3DaysInnings,
    fatigueScore: usageOnlyBullpen.fatigueScore,
    closerAvailable: params.availability.closerAvailable,
    setupAvailable: params.availability.setupAvailable,
    source: 'espn_base_fallback' as const,
    sourceLabel: 'ESPN/base fallback',
    isFallback: true,
    fallbackReason:
      params.teamSplitError ??
      'No MLB bullpen split and no aggregate reliever stat was available'
  };
  console.warn(buildBullpenDebugLine(params.teamName, bullpen));
  return bullpen;
}

function toStarterHandedness(value?: string | null): 'R' | 'L' | 'S' | undefined {
  const code = String(value ?? '').toUpperCase().trim();

  if (code === 'R') return 'R';
  if (code === 'L') return 'L';
  if (code === 'S') return 'S';

  return undefined;
}

async function getOfficialStarterContext(
  playerId: number,
  season: string,
  leaguePitchingContext: LeaguePitchingContext
): Promise<Partial<StartingPitcherStats>> {
  const json = await fetchMlbJson<MlbPeopleResponse>(
    `${MLB_API_BASE}/people/${playerId}?hydrate=stats(group=[pitching],type=[season,seasonAdvanced],sportId=1,season=${season})`
  );

  const person = json.people?.[0];
  const seasonStat =
    person?.stats?.find(
      (entry) =>
        entry.type?.displayName === 'season' &&
        entry.group?.displayName === 'pitching'
    )?.splits?.[0]?.stat;
  const advancedStat =
    person?.stats?.find(
      (entry) =>
        entry.type?.displayName === 'seasonAdvanced' &&
        entry.group?.displayName === 'pitching'
    )?.splits?.[0]?.stat;

  const inningsPitched = parseInnings(seasonStat?.inningsPitched);
  const strikeoutsPer9 = optionalNumber(seasonStat?.strikeoutsPer9Inn);
  const walksPer9 = optionalNumber(seasonStat?.walksPer9Inn);
  const homeRunsPer9 = optionalNumber(seasonStat?.homeRunsPer9);

  return {
    handedness: toStarterHandedness(person?.pitchHand?.code),
    era: optionalNumber(seasonStat?.era),
    fip: calculateFip(seasonStat),
    xfip: calculateXFip(
      seasonStat,
      advancedStat,
      leaguePitchingContext.hrPerFlyBall
    ),
    whip: optionalNumber(seasonStat?.whip),
    inningsPitched,
    expectedInnings: getExpectedInningsFromOfficialStat(seasonStat),
    strikeoutRate: strikeoutsPer9,
    walkRate: walksPer9,
    hrRate: homeRunsPer9
  };
}

function mergeStarter(
  current: StartingPitcherStats,
  incoming: Partial<StartingPitcherStats>
): StartingPitcherStats {
  return {
    ...current,
    ...incoming,
    status:
      incoming.name || incoming.era !== undefined || incoming.handedness
        ? 'probable'
        : current.status
  };
}

function hasPostedLineupPlayers(lineups: unknown, side: 'home' | 'away'): boolean {
  if (!lineups || typeof lineups !== 'object') return false;

  const record = lineups as Record<string, unknown>;
  const keys = side === 'home'
    ? ['homePlayers', 'homeLineup', 'home']
    : ['awayPlayers', 'awayLineup', 'away'];

  return keys.some((key) => {
    const value = record[key];
    return Array.isArray(value) && value.length > 0;
  });
}

function getHitterQualityScore(hitter: HitterSeasonContext): number {
  let score = 0;

  if (hitter.ops !== undefined) {
    score += (hitter.ops - 0.72) * 180;
  }

  if (hitter.obp !== undefined) {
    score += (hitter.obp - 0.32) * 120;
  }

  if (hitter.slg !== undefined) {
    score += (hitter.slg - 0.4) * 95;
  }

  score += Math.min(16, Math.log10(Math.max(1, hitter.plateAppearances) + 1) * 6);

  return score;
}

function selectTopHitters(
  hitters: HitterSeasonContext[],
  count: number
): HitterSeasonContext[] {
  return [...hitters]
    .filter((hitter) => hitter.plateAppearances > 0)
    .sort((left, right) => {
      if (right.plateAppearances !== left.plateAppearances) {
        return right.plateAppearances - left.plateAppearances;
      }

      return getHitterQualityScore(right) - getHitterQualityScore(left);
    })
    .slice(0, count);
}

function buildTeamLineupContext(
  allHitters: HitterSeasonContext[],
  activeHitterIds: Set<number>,
  confirmedLineup: boolean,
  activePlayerPositions: Map<number, string | undefined>
): TeamLineupContext {
  const expectedLineup = selectTopHitters(allHitters, 9);
  const availableLineup = selectTopHitters(
    allHitters.filter((hitter) => activeHitterIds.has(hitter.playerId)),
    9
  );

  const availableIds = new Set(availableLineup.map((hitter) => hitter.playerId));

  const missingKeyBatters = expectedLineup
    .slice(0, 6)
    .filter((hitter) => !availableIds.has(hitter.playerId))
    .map((hitter) => hitter.name);

  const expectedScore = expectedLineup.reduce(
    (sum, hitter) => sum + getHitterQualityScore(hitter),
    0
  );
  const availableScore = availableLineup.reduce(
    (sum, hitter) => sum + getHitterQualityScore(hitter),
    0
  );

  const primaryExpectedCatcher = expectedLineup.find(
    (hitter) => activePlayerPositions.get(hitter.playerId) === 'c'
  );
  const activeCatchers = availableLineup.filter(
    (hitter) => activePlayerPositions.get(hitter.playerId) === 'c'
  );

  const catcherBackup =
    primaryExpectedCatcher !== undefined &&
    activeCatchers.length > 0 &&
    activeCatchers[0].playerId !== primaryExpectedCatcher.playerId;

  return {
    confirmedLineup,
    missingKeyBatCount: missingKeyBatters.length,
    missingKeyBatters,
    catcherBackup,
    lineupQualityAdjustment: Math.round(
      clamp(
        (availableScore - expectedScore) * 1.75,
        LINEUP_QUALITY_ADJUSTMENT_MIN,
        LINEUP_QUALITY_ADJUSTMENT_MAX
      )
    )
  };
}

export async function enrichEngineGameWithMlbStats(
  baseGame: EngineGame,
  espnGame: EspnNormalizedGameData
): Promise<EngineGame> {
  const officialDate = toOfficialDate(espnGame.date);
  const season = officialDate?.slice(0, 4) ?? String(new Date().getUTCFullYear());

  if (!officialDate) {
    return baseGame;
  }

  const [standingsMap, schedule] = await Promise.all([
    safeResolve(getStandingsMap(season), new Map<number, TeamStandingContext>()),
    fetchMlbJson<MlbScheduleResponse>(
      `${MLB_API_BASE}/schedule?sportId=1&date=${officialDate}&hydrate=probablePitcher,lineups,team`
    )
  ]);

  const scheduleGame = findScheduleGameForEspnGame(schedule, espnGame);

  if (!scheduleGame) {
    return baseGame;
  }

  const homeTeamId = optionalNumber(scheduleGame.teams?.home?.team?.id);
  const awayTeamId = optionalNumber(scheduleGame.teams?.away?.team?.id);
  const gamePk = optionalNumber(scheduleGame.gamePk);
  const homeStarterId = optionalNumber(scheduleGame.teams?.home?.probablePitcher?.id);
  const awayStarterId = optionalNumber(scheduleGame.teams?.away?.probablePitcher?.id);
  const venueId = optionalNumber(scheduleGame.venue?.id);

  if (!homeTeamId || !awayTeamId) {
    return baseGame;
  }

  const emptyRecentContext: RecentTeamContext = {
    last7RunsPerGame: 0,
    last14RunsPerGame: 0,
    playedYesterday: false,
    recentGamesForBullpen: []
  };
  const emptyHitterContext = {
    allHitters: [] as HitterSeasonContext[],
    activeHitterIds: new Set<number>(),
    activePlayerPositions: new Map<number, string | undefined>()
  };

  const leaguePitchingContextPromise = getLeaguePitchingContext(season);
  const homeBullpenSeasonPromise = getTeamBullpenSeasonStat(homeTeamId, season);
  const awayBullpenSeasonPromise = getTeamBullpenSeasonStat(awayTeamId, season);

  const [
    homeOffense,
    awayOffense,
    homeRecent,
    awayRecent,
    homeRelievers,
    awayRelievers,
    homeHitters,
    awayHitters,
    savantParkFactors,
    openMeteoWeather,
    homeStarter,
    awayStarter
  ] = await Promise.all([
    safeResolve(getTeamOffenseContext(homeTeamId, season), {}),
    safeResolve(getTeamOffenseContext(awayTeamId, season), {}),
    safeResolve(getRecentTeamContext(homeTeamId, officialDate, gamePk), emptyRecentContext),
    safeResolve(getRecentTeamContext(awayTeamId, officialDate, gamePk), emptyRecentContext),
    safeResolve(getActiveRelieverSeasons(homeTeamId, season), []),
    safeResolve(getActiveRelieverSeasons(awayTeamId, season), []),
    safeResolve(getTeamHitterSeasons(homeTeamId, season), emptyHitterContext),
    safeResolve(getTeamHitterSeasons(awayTeamId, season), emptyHitterContext),
    venueId ? getSavantParkFactors(venueId, season).catch(() => null) : Promise.resolve(null),
    safeResolve(
      getOpenMeteoVenueWeather({
        venueName: scheduleGame.venue?.name ?? espnGame.venue?.name,
        city: espnGame.venue?.city,
        state: espnGame.venue?.state,
        startTime: baseGame.startTime ?? espnGame.date,
        roofClosed: baseGame.parkWeather.roofClosed ?? espnGame.venue?.indoor ?? false
      }),
      null
    ),
    homeStarterId
      ? safeResolve(
          leaguePitchingContextPromise.then((context) =>
            getOfficialStarterContext(homeStarterId, season, context)
          ),
          {}
        )
      : Promise.resolve({}),
    awayStarterId
      ? safeResolve(
          leaguePitchingContextPromise.then((context) =>
            getOfficialStarterContext(awayStarterId, season, context)
          ),
          {}
        )
      : Promise.resolve({})
  ]);

  const [homeBullpenSeasonResult, awayBullpenSeasonResult] = await Promise.allSettled([
    homeBullpenSeasonPromise,
    awayBullpenSeasonPromise
  ]);

  const homeBullpenSeason =
    homeBullpenSeasonResult.status === 'fulfilled'
      ? homeBullpenSeasonResult.value
      : undefined;
  const awayBullpenSeason =
    awayBullpenSeasonResult.status === 'fulfilled'
      ? awayBullpenSeasonResult.value
      : undefined;
  const homeBullpenSeasonError =
    homeBullpenSeasonResult.status === 'rejected'
      ? homeBullpenSeasonResult.reason instanceof Error
        ? homeBullpenSeasonResult.reason.message
        : String(homeBullpenSeasonResult.reason)
      : null;
  const awayBullpenSeasonError =
    awayBullpenSeasonResult.status === 'rejected'
      ? awayBullpenSeasonResult.reason instanceof Error
        ? awayBullpenSeasonResult.reason.message
        : String(awayBullpenSeasonResult.reason)
      : null;

  const [homeUsage, awayUsage] = await Promise.all([
    safeResolve(
      getBullpenUsageContext(homeTeamId, officialDate, homeRecent.recentGamesForBullpen),
      new Map<number, PitcherUsageContext>()
    ),
    safeResolve(
      getBullpenUsageContext(awayTeamId, officialDate, awayRecent.recentGamesForBullpen),
      new Map<number, PitcherUsageContext>()
    )
  ]);

  const homeAvailability = buildAvailabilityFlags(homeRelievers, homeUsage);
  const awayAvailability = buildAvailabilityFlags(awayRelievers, awayUsage);

  const homeStanding = standingsMap.get(homeTeamId);
  const awayStanding = standingsMap.get(awayTeamId);
  const homeRestDisadvantage = homeRecent.playedYesterday && !awayRecent.playedYesterday;
  const awayRestDisadvantage = awayRecent.playedYesterday && !homeRecent.playedYesterday;
  const homeConfirmedLineup = hasPostedLineupPlayers(scheduleGame.lineups, 'home');
  const awayConfirmedLineup = hasPostedLineupPlayers(scheduleGame.lineups, 'away');
  const homeLineupContext = buildTeamLineupContext(
    homeHitters.allHitters,
    homeHitters.activeHitterIds,
    homeConfirmedLineup,
    homeHitters.activePlayerPositions
  );
  const awayLineupContext = buildTeamLineupContext(
    awayHitters.allHitters,
    awayHitters.activeHitterIds,
    awayConfirmedLineup,
    awayHitters.activePlayerPositions
  );

  return {
    ...baseGame,
    homeTeam: {
      ...baseGame.homeTeam,
      core: {
        ...baseGame.homeTeam.core,
        teamId: String(homeTeamId),
        record:
          homeStanding?.wins !== undefined && homeStanding?.losses !== undefined
            ? `${homeStanding.wins}-${homeStanding.losses}`
            : baseGame.homeTeam.core.record,
        wins: homeStanding?.wins ?? baseGame.homeTeam.core.wins,
        losses: homeStanding?.losses ?? baseGame.homeTeam.core.losses,
        divisionRank: homeStanding?.divisionRank ?? baseGame.homeTeam.core.divisionRank,
        last10Wins: homeStanding?.last10Wins,
        last10Losses: homeStanding?.last10Losses,
        streakType: homeStanding?.streakType,
        streakCount: homeStanding?.streakCount,
        homeWins: homeStanding?.homeWins,
        homeLosses: homeStanding?.homeLosses,
        awayWins: homeStanding?.awayWins,
        awayLosses: homeStanding?.awayLosses,
        runsScoredPerGame:
          homeStanding?.runsScoredPerGame ?? homeOffense.runsPerGame ?? baseGame.homeTeam.core.runsScoredPerGame,
        runsAllowedPerGame:
          homeStanding?.runsAllowedPerGame ?? baseGame.homeTeam.core.runsAllowedPerGame,
        runDifferentialPerGame:
          homeStanding?.runDifferentialPerGame ?? baseGame.homeTeam.core.runDifferentialPerGame
      },
      starter: mergeStarter(baseGame.homeTeam.starter, homeStarter),
      bullpen: resolveBullpenStats({
        teamName: baseGame.homeTeam.core.teamName,
        teamBullpenSeasonStat: homeBullpenSeason,
        relievers: homeRelievers,
        usage: homeUsage,
        availability: homeAvailability,
        baseBullpen: baseGame.homeTeam.bullpen,
        teamSplitError: homeBullpenSeasonError
      }),
      offense: {
        ...baseGame.homeTeam.offense,
        ...homeOffense,
        runsPerGame:
          homeOffense.runsPerGame ?? homeStanding?.runsScoredPerGame ?? baseGame.homeTeam.offense.runsPerGame,
        last7RunsPerGame: homeRecent.last7RunsPerGame,
        last14RunsPerGame: homeRecent.last14RunsPerGame
      },
      lineupContext: {
        ...baseGame.homeTeam.lineupContext,
        ...homeLineupContext,
        restDisadvantage: homeRestDisadvantage
      }
    },
    awayTeam: {
      ...baseGame.awayTeam,
      core: {
        ...baseGame.awayTeam.core,
        teamId: String(awayTeamId),
        record:
          awayStanding?.wins !== undefined && awayStanding?.losses !== undefined
            ? `${awayStanding.wins}-${awayStanding.losses}`
            : baseGame.awayTeam.core.record,
        wins: awayStanding?.wins ?? baseGame.awayTeam.core.wins,
        losses: awayStanding?.losses ?? baseGame.awayTeam.core.losses,
        divisionRank: awayStanding?.divisionRank ?? baseGame.awayTeam.core.divisionRank,
        last10Wins: awayStanding?.last10Wins,
        last10Losses: awayStanding?.last10Losses,
        streakType: awayStanding?.streakType,
        streakCount: awayStanding?.streakCount,
        homeWins: awayStanding?.homeWins,
        homeLosses: awayStanding?.homeLosses,
        awayWins: awayStanding?.awayWins,
        awayLosses: awayStanding?.awayLosses,
        runsScoredPerGame:
          awayStanding?.runsScoredPerGame ?? awayOffense.runsPerGame ?? baseGame.awayTeam.core.runsScoredPerGame,
        runsAllowedPerGame:
          awayStanding?.runsAllowedPerGame ?? baseGame.awayTeam.core.runsAllowedPerGame,
        runDifferentialPerGame:
          awayStanding?.runDifferentialPerGame ?? baseGame.awayTeam.core.runDifferentialPerGame
      },
      starter: mergeStarter(baseGame.awayTeam.starter, awayStarter),
      bullpen: resolveBullpenStats({
        teamName: baseGame.awayTeam.core.teamName,
        teamBullpenSeasonStat: awayBullpenSeason,
        relievers: awayRelievers,
        usage: awayUsage,
        availability: awayAvailability,
        baseBullpen: baseGame.awayTeam.bullpen,
        teamSplitError: awayBullpenSeasonError
      }),
      offense: {
        ...baseGame.awayTeam.offense,
        ...awayOffense,
        runsPerGame:
          awayOffense.runsPerGame ?? awayStanding?.runsScoredPerGame ?? baseGame.awayTeam.offense.runsPerGame,
        last7RunsPerGame: awayRecent.last7RunsPerGame,
        last14RunsPerGame: awayRecent.last14RunsPerGame
      },
      lineupContext: {
        ...baseGame.awayTeam.lineupContext,
        ...awayLineupContext,
        restDisadvantage: awayRestDisadvantage
      }
    },
    parkWeather: {
      ...baseGame.parkWeather,
      venueName: scheduleGame.venue?.name ?? baseGame.parkWeather.venueName,
      parkFactorRuns:
        savantParkFactors?.parkFactorRuns ?? baseGame.parkWeather.parkFactorRuns,
      parkFactorHr:
        savantParkFactors?.parkFactorHr ?? baseGame.parkWeather.parkFactorHr,
      temperatureF: openMeteoWeather?.temperatureF ?? baseGame.parkWeather.temperatureF,
      windMph: openMeteoWeather?.windMph ?? baseGame.parkWeather.windMph,
      rainRiskPct: openMeteoWeather?.rainRiskPct ?? baseGame.parkWeather.rainRiskPct
    }
  };
}
