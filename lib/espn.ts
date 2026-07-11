// lib/espn.ts

import type { LiveGameParticipant, LiveGameSituation } from './game-feed';

const ESPN_MLB_SUMMARY_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=';

type Nullable<T> = T | null | undefined;

export interface EspnTeamRef {
  id?: string;
  uid?: string;
  location?: string;
  name?: string;
  abbreviation?: string;
  displayName?: string;
  shortDisplayName?: string;
  color?: string;
  alternateColor?: string;
  logo?: string;
}

export interface EspnRecord {
  name?: string;
  abbreviation?: string;
  type?: string;
  summary?: string;
  displayValue?: string;
  value?: number;
}

export interface EspnStatistic {
  name?: string;
  displayName?: string;
  shortDisplayName?: string;
  description?: string;
  abbreviation?: string;
  value?: number | string;
  displayValue?: string;
}

export interface EspnAthlete {
  id?: string;
  uid?: string;
  fullName?: string;
  displayName?: string;
  shortName?: string;
  headshot?: {
    href?: string;
    alt?: string;
  } | string;
  jersey?: string;
  position?: {
    abbreviation?: string;
    name?: string;
    displayName?: string;
  };
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
  };
  throws?: {
    abbreviation?: string;
    displayValue?: string;
    type?: string;
  };
  statistics?: EspnStatistic[];
}

export interface EspnLeader {
  name?: string;
  displayName?: string;
  shortDisplayName?: string;
  leaders?: Array<{
    displayValue?: string;
    value?: number;
    athlete?: EspnAthlete;
  }>;
}

export interface EspnTeamBlock {
  team?: EspnTeamRef;
  statistics?: EspnStatistic[];
  records?: EspnRecord[];
  leaders?: EspnLeader[];
  athletes?: EspnAthlete[];
}

export interface EspnProbableStatValue {
  value?: number | string;
  displayValue?: string;
}

export interface EspnCompetitorProbable {
  playerId?: string | number;
  athlete?: {
    id?: string | number;
    displayName?: string;
    fullName?: string;
    headshot?: {
      href?: string;
      alt?: string;
    } | string;
    throws?: {
      abbreviation?: string;
      displayValue?: string;
      type?: string;
    };
  };
  statistics?: {
    splits?: {
      categories?: Array<{
        name?: string;
        abbreviation?: string;
        value?: number | string;
        displayValue?: string;
      }>;
    };
  };
}

export interface EspnCompetitor {
  id?: string;
  uid?: string;
  homeAway?: 'home' | 'away' | string;
  winner?: boolean;
  score?: string;
  team?: EspnTeamRef;
  records?: EspnRecord[];
  statistics?: EspnStatistic[];
  leaders?: EspnLeader[];
  probables?: EspnCompetitorProbable[];
  curatedRank?: {
    current?: number;
  };
}

export interface EspnStatusType {
  id?: string;
  name?: string;
  state?: string;
  completed?: boolean;
  description?: string;
  detail?: string;
  shortDetail?: string;
}

export interface EspnStatus {
  clock?: number;
  displayClock?: string;
  period?: number;
  type?: EspnStatusType;
}

export interface EspnCompetition {
  id?: string;
  uid?: string;
  date?: string;
  attendance?: number;
  type?: {
    abbreviation?: string;
  };
  timeValid?: boolean;
  neutralSite?: boolean;
  conferenceCompetition?: boolean;
  playByPlayAvailable?: boolean;
  recent?: boolean;
  venue?: {
    id?: string;
    fullName?: string;
    address?: {
      city?: string;
      state?: string;
    };
    indoor?: boolean;
  };
  competitors?: EspnCompetitor[];
  status?: EspnStatus;
  notes?: Array<{
    type?: string;
    headline?: string;
  }>;
  situation?: unknown;
}

export interface EspnWeather {
  displayValue?: string;
  temperature?: number;
  highTemperature?: number;
  lowTemperature?: number;
  conditionId?: string;
  gust?: number;
  precipitation?: number;
  link?: {
    text?: string;
    href?: string;
  };
}

export interface EspnEvent {
  id?: string;
  uid?: string;
  date?: string;
  name?: string;
  shortName?: string;
  season?: {
    year?: number;
    type?: number;
    slug?: string;
  };
  competitions?: EspnCompetition[];
  status?: EspnStatus;
  weather?: EspnWeather;
  links?: Array<{
    language?: string;
    rel?: string[];
    href?: string;
    text?: string;
    shortText?: string;
    isExternal?: boolean;
    isPremium?: boolean;
  }>;
}

export interface EspnInjuryTeam {
  id?: string;
  uid?: string;
  displayName?: string;
  abbreviation?: string;
}

export interface EspnInjury {
  team?: EspnInjuryTeam;
  injuries?: Array<{
    status?: string;
    date?: string;
    athlete?: EspnAthlete;
    type?: {
      id?: string;
      name?: string;
      abbreviation?: string;
      description?: string;
    };
    details?: {
      type?: string;
      detail?: string;
      side?: string;
      returnDate?: string;
      fantasyStatus?: {
        description?: string;
        abbreviation?: string;
        displayDescription?: string;
      };
    };
  }>;
}

export interface EspnBoxscorePlayerRow {
  active?: boolean;
  athlete?: EspnAthlete;
  batOrder?: number;
  position?: {
    abbreviation?: string;
    name?: string;
    displayName?: string;
  };
  notes?: Array<{
    type?: string;
    text?: string;
  }>;
  statistics?: Array<string | number>;
  stats?: Array<string | number>;
  starter?: boolean;
}

export interface EspnBoxscoreTeam {
  team?: EspnTeamRef;
  statistics?: Array<{
    name?: string;
    displayName?: string;
    stats?: EspnStatistic[];
  }>;
  players?: Array<{
    label?: string;
    displayOrder?: number;
    statistics?: string[];
    athletes?: EspnBoxscorePlayerRow[];
  }>;
}

export interface EspnBoxscore {
  teams?: EspnBoxscoreTeam[];
  players?: Array<{
    team?: EspnTeamRef;
    statistics?: Array<{
      type?: string;
      name?: string;
      keys?: string[];
      labels?: string[];
      athletes?: EspnBoxscorePlayerRow[];
    }>;
  }>;
}

export interface EspnFormat {
  regulation?: {
    periods?: number;
  };
}

export interface EspnGamePackage {
  header?: EspnEvent;
  gameInfo?: {
    attendance?: number;
    venue?: {
      fullName?: string;
      address?: {
        city?: string;
        state?: string;
      };
      indoor?: boolean;
    };
    weather?: EspnWeather;
  };
  boxscore?: EspnBoxscore;
  injuries?: EspnInjury[];
  format?: EspnFormat;
  plays?: Array<Record<string, unknown>>;
}

export interface TeamStatBucket {
  [key: string]: number | string;
}

export interface NormalizedTeamStatistics {
  batting: TeamStatBucket;
  pitching: TeamStatBucket;
  fielding: TeamStatBucket;
}

export interface NormalizedProbableStarter {
  playerId: string;
  name: string;
  headshot?: string | null;
  era: number | null;
  handedness?: 'R' | 'L' | 'S';
  whip?: number | null;
  inningsPitched?: number | null;
  strikeouts?: number | null;
  walks?: number | null;
  homeRuns?: number | null;
  strikeoutRate?: number | null;
  walkRate?: number | null;
  hrRate?: number | null;
}

export interface NormalizedPitcherLine {
  playerId: string;
  name: string;
  starter: boolean;
  stats: Array<string | number>;
}

export interface NormalizedTeamGameData {
  id: string;
  abbreviation: string;
  displayName: string;
  homeAway: 'home' | 'away';
  score: number | null;
  winner: boolean;
  records: string[];
  recordSummary: string | null;
  statistics: NormalizedTeamStatistics;
  probableStarter: NormalizedProbableStarter | null;
  pitchers: NormalizedPitcherLine[];
}

export interface NormalizedGameData {
  gameId: string;
  date: string | null;
  name: string;
  shortName: string;
  status: string;
  period: number | null;
  homeTeam: NormalizedTeamGameData;
  awayTeam: NormalizedTeamGameData;
  weather: {
    temperature: number | null;
    displayValue: string | null;
    gustMph: number | null;
    precipitationPct: number | null;
  };
  venue: {
    name: string | null;
    city: string | null;
    state: string | null;
    indoor: boolean | null;
  };
  injuries: EspnInjury[];
  raw: EspnGamePackage;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d+-.]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringSafe(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toHandedness(value: unknown): 'R' | 'L' | 'S' | undefined {
  const raw = toStringSafe(value).toUpperCase().trim();
  if (raw === 'R' || raw === 'RIGHT') return 'R';
  if (raw === 'L' || raw === 'LEFT') return 'L';
  if (raw === 'S' || raw === 'SWITCH') return 'S';
  return undefined;
}

function getRecordSummaries(records: Nullable<EspnRecord[]>): string[] {
  return (records ?? [])
    .map((r) => r.summary || r.displayValue || r.name)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function getBoxscoreTeamStats(
  summary: EspnGamePackage,
  teamId: string
): NormalizedTeamStatistics {
  const teams = summary.boxscore?.teams ?? [];
  const match = teams.find((t) => t.team?.id === teamId);

  const emptyStats: NormalizedTeamStatistics = {
    batting: {},
    pitching: {},
    fielding: {}
  };

  if (!match) return emptyStats;

  const out: NormalizedTeamStatistics = {
    batting: {},
    pitching: {},
    fielding: {}
  };

  for (const section of match.statistics ?? []) {
    const sectionName = section.name;

    if (
      sectionName !== 'batting' &&
      sectionName !== 'pitching' &&
      sectionName !== 'fielding'
    ) {
      continue;
    }

    for (const stat of section.stats ?? []) {
      const key =
        stat.name ||
        stat.abbreviation ||
        stat.displayName ||
        stat.shortDisplayName;

      if (!key) continue;

      if (typeof stat.value === 'number' || typeof stat.value === 'string') {
        out[sectionName][key] = stat.value;
      } else if (typeof stat.displayValue === 'string') {
        out[sectionName][key] = stat.displayValue;
      }
    }
  }

  return out;
}

function getCompetitorRecordSummary(competitor: EspnCompetitor): string | null {
  const raw = (competitor as { record?: Array<{ summary?: string }> }).record;

  if (Array.isArray(raw)) {
    const found = raw.find((r) => typeof r?.summary === 'string' && r.summary.trim());
    if (found?.summary) return found.summary;
  }

  const records = competitor.records ?? [];
  const fromRecords = records.find((r) => typeof r.summary === 'string' && r.summary.trim());
  if (fromRecords?.summary) return fromRecords.summary;

  return null;
}

function getBoxscorePitchers(
  summary: EspnGamePackage,
  teamId: string
): NormalizedPitcherLine[] {
  const teams = summary.boxscore?.players ?? [];
  const teamBlock = teams.find((t) => t.team?.id === teamId);

  const pitching = teamBlock?.statistics?.find(
    (s) => s.type === 'pitching' || s.name === 'pitching'
  );

  return (pitching?.athletes ?? []).map((p) => {
    const stats =
      Array.isArray(p.stats) ? p.stats :
      Array.isArray(p.statistics) ? p.statistics :
      [];

    return {
      playerId: String(p.athlete?.id ?? ''),
      name:
        p.athlete?.displayName ??
        p.athlete?.fullName ??
        'Unknown',
      starter: Boolean(p.starter),
      stats
    };
  });
}


function extractProbableCategoryStat(
  categories:
    | Array<{
        name?: string;
        abbreviation?: string;
        value?: number | string;
        displayValue?: string;
      }>
    | undefined,
  keys: string[]
): number | null {
  if (!categories?.length) return null;

  const normalizedKeys = keys.map((key) => key.toLowerCase());

  const match = categories.find((item) => {
    const name = String(item.name ?? '').toLowerCase();
    const abbr = String(item.abbreviation ?? '').toLowerCase();

    return (
      normalizedKeys.includes(name) ||
      normalizedKeys.includes(abbr)
    );
  });

  if (!match) return null;

  return (
    toNumber(match.value) ??
    toNumber(match.displayValue) ??
    null
  );
}

function getProbableStarter(
  competitor: EspnCompetitor
): NormalizedProbableStarter | null {
  const probable = competitor.probables?.[0];
  if (!probable) return null;

  const categories = probable.statistics?.splits?.categories;

  const era = extractProbableCategoryStat(categories, [
    'era'
  ]);

  const whip = extractProbableCategoryStat(categories, [
    'whip'
  ]);

  const fullInnings = extractProbableCategoryStat(categories, [
    'fullinnings',
    'fi'
  ]);

  const partInnings = extractProbableCategoryStat(categories, [
    'partinnings',
    'pi'
  ]);

  const inningsPitched =
    fullInnings !== null
      ? fullInnings + ((partInnings ?? 0) / 3)
      : null;

  const strikeouts = extractProbableCategoryStat(categories, [
    'strikeouts',
    'k'
  ]);

  const walks = extractProbableCategoryStat(categories, [
    'walks',
    'bb'
  ]);

  const homeRuns = extractProbableCategoryStat(categories, [
    'homeruns',
    'hr'
  ]);

  const strikeoutRate =
    inningsPitched !== null &&
    inningsPitched > 0 &&
    strikeouts !== null
      ? (strikeouts / inningsPitched) * 9
      : null;

  const walkRate =
    inningsPitched !== null &&
    inningsPitched > 0 &&
    walks !== null
      ? (walks / inningsPitched) * 9
      : null;

  const hrRate =
    inningsPitched !== null &&
    inningsPitched > 0 &&
    homeRuns !== null
      ? (homeRuns / inningsPitched) * 9
      : null;

  const handedness =
    toHandedness(probable.athlete?.throws?.abbreviation) ??
    toHandedness(probable.athlete?.throws?.displayValue) ??
    toHandedness(probable.athlete?.throws?.type);

  return {
    playerId: String(probable.athlete?.id ?? probable.playerId ?? ''),
    name:
      probable.athlete?.displayName ??
      probable.athlete?.fullName ??
      'Unknown',
    headshot: readHeadshotHref(probable.athlete?.headshot),
    era,
    handedness,
    whip,
    inningsPitched,
    strikeouts,
    walks,
    homeRuns,
    strikeoutRate,
    walkRate,
    hrRate
  };
}

function clampCount(value: unknown, max: number) {
  const numeric = toNumber(value);
  if (numeric === null) return 0;
  return Math.max(0, Math.min(max, Math.trunc(numeric)));
}

function readObject(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

function readString(value: unknown): string | null {
  const parsed = toStringSafe(value).trim();
  return parsed ? parsed : null;
}

function readIdentifier(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = value.trim();
    return parsed ? parsed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function readHeadshotHref(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  const payload = readObject(value);
  return readString(payload?.href);
}

function readNestedNumber(
  source: Record<string, unknown> | null,
  keys: string[]
): number | null {
  if (!source) return null;

  for (const key of keys) {
    const value = source[key];
    const numeric = toNumber(value);
    if (numeric !== null) return numeric;

    const nested = readObject(value);
    if (!nested) continue;

    const nestedNumeric =
      toNumber(nested.value) ??
      toNumber(nested.displayValue);

    if (nestedNumeric !== null) return nestedNumeric;
  }

  return null;
}

function hasTruthyValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (['0', 'false', 'empty', 'none', 'no'].includes(normalized)) return false;
    return true;
  }

  if (Array.isArray(value)) return value.length > 0;
  return isObject(value);
}

function getParticipantStatNote(
  athlete: Record<string, unknown>,
  preferredKeys: string[]
): string | null {
  const statistics = Array.isArray(athlete.statistics) ? athlete.statistics : [];

  for (const stat of statistics) {
    if (!isObject(stat)) continue;

    const abbreviation = String(stat.abbreviation ?? '').trim().toUpperCase();
    const name = String(stat.name ?? '').trim().toUpperCase();
    const shortName = String(stat.shortDisplayName ?? '').trim().toUpperCase();

    if (!preferredKeys.some((key) => key === abbreviation || key === name || key === shortName)) {
      continue;
    }

    const display =
      readString(stat.displayValue) ??
      readString(stat.value);

    if (display) {
      return `${abbreviation || preferredKeys[0]} ${display}`;
    }
  }

  return null;
}

type BoxscoreAthleteSummary = {
  id: string;
  name: string;
  shortName: string | null;
  teamAbbr: string | null;
  position: string | null;
  headshot: string | null;
  battingNote: string | null;
  pitchingNote: string | null;
};

function formatBoxscoreBatterNote(
  keys: string[],
  stats: Array<string | number>
): string | null {
  const values = new Map<string, string>();
  keys.forEach((key, index) => {
    const value = stats[index];
    if (value === undefined || value === null) return;
    values.set(key, String(value));
  });

  const hitsAtBats = values.get('hits-atBats');
  const runs = values.get('runs');
  const rbis = values.get('RBIs');

  if (!hitsAtBats) return null;

  const extras = [
    runs && runs !== '0' ? `${runs} R` : null,
    rbis && rbis !== '0' ? `${rbis} RBI` : null
  ].filter(Boolean);

  return extras.length ? `${hitsAtBats}, ${extras.join(', ')}` : hitsAtBats;
}

function formatBoxscorePitcherNote(
  keys: string[],
  stats: Array<string | number>
): string | null {
  const values = new Map<string, string>();
  keys.forEach((key, index) => {
    const value = stats[index];
    if (value === undefined || value === null) return;
    values.set(key, String(value));
  });

  const innings = values.get('fullInnings.partInnings');
  const hits = values.get('hits');
  const earnedRuns = values.get('earnedRuns');
  const walks = values.get('walks');
  const strikeouts = values.get('strikeouts');
  const pitches = values.get('pitches');

  const parts = [
    innings ? `${innings} IP` : null,
    hits ? `${hits} H` : null,
    earnedRuns ? `${earnedRuns} ER` : null,
    walks ? `${walks} BB` : null,
    strikeouts ? `${strikeouts} K` : null,
    pitches ? `${pitches} P` : null
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : null;
}

function buildBoxscoreAthleteLookup(summary: EspnGamePackage) {
  const lookup = new Map<string, BoxscoreAthleteSummary>();

  for (const teamBlock of summary.boxscore?.players ?? []) {
    const teamAbbr = teamBlock.team?.abbreviation ?? null;

    for (const statBlock of teamBlock.statistics ?? []) {
      const sectionType = statBlock.type ?? statBlock.name ?? '';
      const keys = statBlock.keys ?? [];

      for (const row of statBlock.athletes ?? []) {
        const athleteId = readIdentifier(row.athlete?.id);
        if (!athleteId) continue;

        const existing = lookup.get(athleteId);
        const stats = Array.isArray(row.stats)
          ? row.stats
          : Array.isArray(row.statistics)
            ? row.statistics
            : [];
        const position =
          row.position?.abbreviation ??
          row.position?.displayName ??
          row.position?.name ??
          row.athlete?.position?.abbreviation ??
          row.athlete?.position?.displayName ??
          row.athlete?.position?.name ??
          null;

        const summaryRow: BoxscoreAthleteSummary = {
          id: athleteId,
          name:
            row.athlete?.displayName ??
            row.athlete?.fullName ??
            existing?.name ??
            'Unknown',
          shortName: row.athlete?.shortName ?? existing?.shortName ?? null,
          teamAbbr,
          position,
          headshot: readHeadshotHref(row.athlete?.headshot) ?? existing?.headshot ?? null,
          battingNote:
            sectionType === 'batting'
              ? formatBoxscoreBatterNote(keys, stats)
              : existing?.battingNote ?? null,
          pitchingNote:
            sectionType === 'pitching'
              ? formatBoxscorePitcherNote(keys, stats)
              : existing?.pitchingNote ?? null
        };

        lookup.set(athleteId, summaryRow);
      }
    }
  }

  return lookup;
}

function normalizeLiveParticipant(
  value: unknown,
  preferredStatKeys: string[],
  athleteLookup?: Map<string, BoxscoreAthleteSummary>,
  role?: 'batter' | 'pitcher'
): LiveGameParticipant | null {
  const outer = readObject(value);
  if (!outer) return null;

  const athlete = readObject(outer.athlete) ?? outer;
  const athleteId = readIdentifier(athlete.id) ?? readIdentifier(outer.id);
  const lookup = athleteId ? athleteLookup?.get(athleteId) : null;
  const name =
    readString(athlete.displayName) ??
    readString(athlete.fullName) ??
    readString(athlete.shortName) ??
    lookup?.name ??
    lookup?.shortName;

  if (!name) return null;

  const team = readObject(athlete.team) ?? readObject(outer.team);
  const position = readObject(athlete.position) ?? readObject(outer.position);

  return {
    id: athleteId,
    name,
    shortName: readString(athlete.shortName) ?? lookup?.shortName ?? null,
    teamAbbr: readString(team?.abbreviation) ?? lookup?.teamAbbr ?? null,
    position:
      readString(position?.abbreviation) ??
      readString(position?.displayName) ??
      readString(position?.name) ??
      lookup?.position ??
      null,
    headshot:
      readHeadshotHref(athlete.headshot) ??
      readHeadshotHref(outer.headshot) ??
      lookup?.headshot ??
      null,
    note:
      (role === 'pitcher' ? lookup?.pitchingNote : role === 'batter' ? lookup?.battingNote : null) ??
      getParticipantStatNote(athlete, preferredStatKeys)
  };
}

function getLatestMeaningfulPlay(summary: EspnGamePackage) {
  const plays = Array.isArray(summary.plays) ? summary.plays : [];
  const latestPlay = plays.at(-1) ?? null;
  const latestParticipantPlay =
    [...plays].reverse().find((play) => Array.isArray(play?.participants) && play.participants.length > 0) ?? null;

  return {
    latestPlay: readObject(latestPlay),
    latestParticipantPlay: readObject(latestParticipantPlay)
  };
}

function getPlayCountValue(
  play: Record<string, unknown> | null,
  field: 'balls' | 'strikes'
) {
  const resultCount = readObject(play?.resultCount);
  const pitchCount = readObject(play?.pitchCount);

  return clampCount(
    readNestedNumber(resultCount, [field]) ??
      readNestedNumber(pitchCount, [field]),
    field === 'balls' ? 4 : 3
  );
}

function getPlayOuts(play: Record<string, unknown> | null) {
  return clampCount(readNestedNumber(play, ['outs']), 3);
}

function getPlayParticipant(
  play: Record<string, unknown> | null,
  type: string
) {
  const participants = Array.isArray(play?.participants) ? play.participants : [];
  const participant = participants.find((item) => {
    const payload = readObject(item);
    return readString(payload?.type)?.toLowerCase() === type.toLowerCase();
  });

  return readObject(participant);
}

function getPlayBaseOccupied(
  play: Record<string, unknown> | null,
  base: 1 | 2 | 3
) {
  if (!play) return false;

  const key = base === 1 ? 'onFirst' : base === 2 ? 'onSecond' : 'onThird';
  if (key in play) {
    return hasTruthyValue(play[key]);
  }

  const participantType = key.toLowerCase();
  return Boolean(getPlayParticipant(play, participantType));
}

function hasOwnKey(
  source: Record<string, unknown> | null,
  key: string
) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function getLatestBaseStatePlay(summary: EspnGamePackage) {
  const plays = Array.isArray(summary.plays) ? summary.plays : [];

  const latestWithBaseState = [...plays].reverse().find((play) => {
    const payload = readObject(play);
    if (!payload) return false;

    return (
      hasOwnKey(payload, 'onFirst') ||
      hasOwnKey(payload, 'onSecond') ||
      hasOwnKey(payload, 'onThird') ||
      hasOwnKey(payload, 'runners')
    );
  });

  return readObject(latestWithBaseState);
}

function normalizeCompetitor(
  competitor: EspnCompetitor,
  fallbackHomeAway: 'home' | 'away',
  summary: EspnGamePackage
): NormalizedTeamGameData {
  const team = competitor.team ?? {};
  const teamId = toStringSafe(team.id ?? competitor.id);

  const statistics = getBoxscoreTeamStats(summary, teamId);
  const pitchers = getBoxscorePitchers(summary, teamId);
  const probableStarter = getProbableStarter(competitor);


  return {
    id: teamId,
    abbreviation: toStringSafe(team.abbreviation),
    displayName:
      toStringSafe(team.displayName) ||
      toStringSafe(team.shortDisplayName) ||
      [toStringSafe(team.location), toStringSafe(team.name)]
        .filter(Boolean)
        .join(' '),
    homeAway:
      competitor.homeAway === 'home' || competitor.homeAway === 'away'
        ? competitor.homeAway
        : fallbackHomeAway,
    score: toNumber(competitor.score),
    winner: Boolean(competitor.winner),
    records: getRecordSummaries(competitor.records),
    recordSummary: getCompetitorRecordSummary(competitor),
    statistics,
    probableStarter,
    pitchers
  };
}

export async function fetchEspnMlbSummary(gameId: string): Promise<EspnGamePackage> {
  if (!gameId) {
    throw new Error('Missing gameId for ESPN summary fetch.');
  }

  const url = `${ESPN_MLB_SUMMARY_BASE}${encodeURIComponent(gameId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`ESPN summary request failed: ${response.status} ${response.statusText}`);
  }

  const json: unknown = await response.json();

  if (!isObject(json)) {
    throw new Error('ESPN summary payload is not an object.');
  }

  return json as EspnGamePackage;
}

export function normalizeEspnGameData(summary: EspnGamePackage): NormalizedGameData {
  const header = summary.header ?? {};
  const competition = header.competitions?.[0];

  if (!competition) {
    throw new Error('ESPN summary missing competitions[0].');
  }

  const competitors = competition.competitors ?? [];

  if (competitors.length < 2) {
    throw new Error('ESPN summary missing competitors.');
  }

  const homeRaw =
    competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const awayRaw =
    competitors.find((c) => c.homeAway === 'away') ??
    competitors.find((c) => c !== homeRaw) ??
    competitors[1];

  const venue = summary.gameInfo?.venue ?? competition.venue;
  const weather = summary.gameInfo?.weather ?? header.weather;

  const homeTeam = normalizeCompetitor(homeRaw, 'home', summary);
  const awayTeam = normalizeCompetitor(awayRaw, 'away', summary);

  return {
    gameId: toStringSafe(header.id ?? competition.id),
    date:
      typeof (header.date ?? competition.date) === 'string'
        ? (header.date ?? competition.date)!
        : null,
    name: toStringSafe(header.name),
    shortName: toStringSafe(header.shortName),
    status: toStringSafe(
      header.status?.type?.description ?? competition.status?.type?.description
    ),
    period:
      header.status?.period ??
      competition.status?.period ??
      null,
    homeTeam,
    awayTeam,
    weather: {
      temperature: weather?.temperature ?? null,
      displayValue:
        typeof weather?.displayValue === 'string' ? weather.displayValue : null,
      gustMph: toNumber(weather?.gust),
      precipitationPct: toNumber(weather?.precipitation)
    },
    venue: {
      name: typeof venue?.fullName === 'string' ? venue.fullName : null,
      city: typeof venue?.address?.city === 'string' ? venue.address.city : null,
      state: typeof venue?.address?.state === 'string' ? venue.address.state : null,
      indoor:
        typeof venue?.indoor === 'boolean' ? venue.indoor : null
    },
    injuries: summary.injuries ?? [],
    raw: summary
  };
}

export function normalizeEspnLiveSituation(
  summary: EspnGamePackage
): LiveGameSituation | null {
  const competition = summary.header?.competitions?.[0];
  if (!competition) {
    return null;
  }

  const athleteLookup = buildBoxscoreAthleteLookup(summary);
  const { latestPlay, latestParticipantPlay } = getLatestMeaningfulPlay(summary);
  const activePlay = latestPlay ?? latestParticipantPlay;
  const participantPlay = latestParticipantPlay ?? latestPlay;
  const baseStatePlay = getLatestBaseStatePlay(summary) ?? activePlay;
  const lastPlayText =
    readString(activePlay?.text) ??
    readString(participantPlay?.text);
  const batter =
    normalizeLiveParticipant(
      getPlayParticipant(participantPlay, 'batter'),
      ['AVG', 'OPS'],
      athleteLookup,
      'batter'
    ) ??
    normalizeLiveParticipant(
      getPlayParticipant(activePlay, 'batter'),
      ['AVG', 'OPS'],
      athleteLookup,
      'batter'
    );
  const pitcher =
    normalizeLiveParticipant(
      getPlayParticipant(participantPlay, 'pitcher'),
      ['ERA', 'WHIP'],
      athleteLookup,
      'pitcher'
    ) ??
    normalizeLiveParticipant(
      getPlayParticipant(activePlay, 'pitcher'),
      ['ERA', 'WHIP'],
      athleteLookup,
      'pitcher'
    );

  const liveSituation: LiveGameSituation = {
    venueName:
      readString(summary.gameInfo?.venue?.fullName) ??
      readString(competition.venue?.fullName),
    lastPlay: lastPlayText,
    balls: getPlayCountValue(activePlay, 'balls'),
    strikes: getPlayCountValue(activePlay, 'strikes'),
    outs: getPlayOuts(activePlay),
    onFirst: getPlayBaseOccupied(baseStatePlay, 1),
    onSecond: getPlayBaseOccupied(baseStatePlay, 2),
    onThird: getPlayBaseOccupied(baseStatePlay, 3),
    batter,
    pitcher
  };

  const hasMeaningfulState =
    Boolean(liveSituation.venueName) ||
    Boolean(liveSituation.lastPlay) ||
    liveSituation.balls > 0 ||
    liveSituation.strikes > 0 ||
    liveSituation.outs > 0 ||
    liveSituation.onFirst ||
    liveSituation.onSecond ||
    liveSituation.onThird ||
    Boolean(liveSituation.batter) ||
    Boolean(liveSituation.pitcher);

  return hasMeaningfulState ? liveSituation : null;
}

/**
 * Helper opcional por si quieres usar un solo call desde route.ts
 */
export async function getNormalizedEspnMlbGame(gameId: string): Promise<NormalizedGameData> {
  const summary = await fetchEspnMlbSummary(gameId);
  return normalizeEspnGameData(summary);
}
