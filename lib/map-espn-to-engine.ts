// lib/map-espn-to-engine.ts

import type { NormalizedGameData as EspnNormalizedGameData } from './espn';
import {
  LINEUP_QUALITY_ADJUSTMENT_MIN,
  NormalizedGameData as EngineGame
} from './types';
import { normalizeEntityName } from './text-utils';

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function optionalNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function normalizeText(value?: string | null): string {
  return normalizeEntityName(value);
}

function safeRecordSplit(record?: string | null): { wins: number; losses: number } {
  if (!record) return { wins: 0, losses: 0 };

  const match = record.match(/(\d+)-(\d+)/);
  if (!match) return { wins: 0, losses: 0 };

  return {
    wins: Number(match[1]),
    losses: Number(match[2])
  };
}

function isMissingStatus(status: string): boolean {
  const normalized = normalizeText(status);

  return (
    normalized.includes('out') ||
    normalized.includes('10-day-il') ||
    normalized.includes('15-day-il') ||
    normalized.includes('60-day-il') ||
    normalized.includes('day-to-day')
  );
}

type InjuryEntry = {
  athlete?: {
    displayName?: string;
    position?: {
      abbreviation?: string;
    };
  };
  status?: string;
};

type InjuryBlock = {
  team?: {
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
  };
  injuries?: InjuryEntry[];
};

type MissingBattersInfo = {
  count: number;
  names: string[];
  catcherMissing: boolean;
  impactScore: number;
};

type ParkFactorProfile = {
  parkFactorRuns: number;
  parkFactorHr: number;
};

const DEFAULT_PARK_FACTORS: ParkFactorProfile = {
  parkFactorRuns: 100,
  parkFactorHr: 100
};

const PARK_FACTORS_BY_VENUE: Record<string, ParkFactorProfile> = {
  'angel stadium': { parkFactorRuns: 98, parkFactorHr: 96 },
  'busch stadium': { parkFactorRuns: 95, parkFactorHr: 92 },
  'chase field': { parkFactorRuns: 101, parkFactorHr: 104 },
  'citi field': { parkFactorRuns: 96, parkFactorHr: 94 },
  'citizens bank park': { parkFactorRuns: 103, parkFactorHr: 108 },
  'comerica park': { parkFactorRuns: 98, parkFactorHr: 95 },
  'coors field': { parkFactorRuns: 118, parkFactorHr: 115 },
  'daikin park': { parkFactorRuns: 101, parkFactorHr: 100 },
  'dodger stadium': { parkFactorRuns: 97, parkFactorHr: 100 },
  'fenway park': { parkFactorRuns: 105, parkFactorHr: 102 },
  'george m steinbrenner field': { parkFactorRuns: 101, parkFactorHr: 101 },
  'globe life field': { parkFactorRuns: 97, parkFactorHr: 95 },
  'great american ball park': { parkFactorRuns: 106, parkFactorHr: 112 },
  'guaranteed rate field': { parkFactorRuns: 102, parkFactorHr: 110 },
  'kauffman stadium': { parkFactorRuns: 99, parkFactorHr: 92 },
  'loandepot park': { parkFactorRuns: 95, parkFactorHr: 90 },
  'minute maid park': { parkFactorRuns: 101, parkFactorHr: 102 },
  'nationals park': { parkFactorRuns: 100, parkFactorHr: 101 },
  'oracle park': { parkFactorRuns: 94, parkFactorHr: 88 },
  'oriole park at camden yards': { parkFactorRuns: 98, parkFactorHr: 94 },
  'petco park': { parkFactorRuns: 95, parkFactorHr: 90 },
  'pnc park': { parkFactorRuns: 97, parkFactorHr: 91 },
  'progressive field': { parkFactorRuns: 100, parkFactorHr: 101 },
  'rate field': { parkFactorRuns: 102, parkFactorHr: 110 },
  'rogers centre': { parkFactorRuns: 104, parkFactorHr: 108 },
  'american family field': { parkFactorRuns: 101, parkFactorHr: 103 },
  'target field': { parkFactorRuns: 99, parkFactorHr: 98 },
  't-mobile park': { parkFactorRuns: 95, parkFactorHr: 92 },
  'tropicana field': { parkFactorRuns: 96, parkFactorHr: 93 },
  'truist park': { parkFactorRuns: 102, parkFactorHr: 106 },
  'wrigley field': { parkFactorRuns: 101, parkFactorHr: 103 },
  'yankee stadium': { parkFactorRuns: 103, parkFactorHr: 110 }
};

function isInjuryBlockArray(value: unknown): value is InjuryBlock[] {
  return Array.isArray(value);
}

function isHitterPosition(positionAbbr?: string): boolean {
  const pos = normalizeText(positionAbbr);

  return (
    pos === 'c' ||
    pos === '1b' ||
    pos === '2b' ||
    pos === '3b' ||
    pos === 'ss' ||
    pos === 'lf' ||
    pos === 'cf' ||
    pos === 'rf' ||
    pos === 'of' ||
    pos === 'dh' ||
    pos === 'if'
  );
}

function getBatterInjuryImpact(positionAbbr?: string): number {
  const pos = normalizeText(positionAbbr);

  if (pos === 'c') return 5;
  if (pos === 'ss' || pos === 'cf' || pos === 'dh') return 8;

  if (
    pos === '1b' ||
    pos === '2b' ||
    pos === '3b' ||
    pos === 'lf' ||
    pos === 'rf' ||
    pos === 'of'
  ) {
    return 7;
  }

  return 6;
}

function getMissingBatters(
  injuriesRaw: unknown,
  team: {
    abbreviation: string;
    displayName: string;
  }
): MissingBattersInfo {
  if (!isInjuryBlockArray(injuriesRaw)) {
    return {
      count: 0,
      names: [],
      catcherMissing: false,
      impactScore: 0
    };
  }

  const teamAbbr = normalizeText(team.abbreviation);
  const teamName = normalizeText(team.displayName);

  const block = injuriesRaw.find((injBlock) => {
    const blockAbbr = normalizeText(injBlock?.team?.abbreviation);
    const blockName =
      normalizeText(injBlock?.team?.displayName) ||
      normalizeText(injBlock?.team?.shortDisplayName);

    return blockAbbr === teamAbbr || blockName === teamName;
  });

  if (!block?.injuries?.length) {
    return {
      count: 0,
      names: [],
      catcherMissing: false,
      impactScore: 0
    };
  }

  const missingPlayers = block.injuries.filter((inj) => {
    const statusOk = isMissingStatus(String(inj.status ?? ''));
    const positionOk = isHitterPosition(
      inj.athlete?.position?.abbreviation
    );

    return statusOk && positionOk;
  });

  const names = missingPlayers
    .map((inj) => inj.athlete?.displayName)
    .filter((name): name is string => Boolean(name));

  const catcherMissing = missingPlayers.some(
    (inj) => normalizeText(inj.athlete?.position?.abbreviation) === 'c'
  );

  const impactScore = missingPlayers.reduce((sum, inj) => {
    return sum + getBatterInjuryImpact(inj.athlete?.position?.abbreviation);
  }, 0);

  return {
    count: names.length,
    names,
    catcherMissing,
    impactScore
  };
}

function getExpectedInnings(
  inningsPitched?: number | null,
  era?: number | null
): number | undefined {
  const ip =
    typeof inningsPitched === 'number' && Number.isFinite(inningsPitched)
      ? inningsPitched
      : null;
  const cleanEra =
    typeof era === 'number' && Number.isFinite(era) ? era : null;

  if (ip !== null) {
    if (ip >= 60) return 6.2;
    if (ip >= 40) return 6.0;
    if (ip >= 25) return 5.8;
    if (ip >= 15) return 5.5;
    if (ip >= 8) return 5.2;
  }

  if (cleanEra === null) return undefined;

  if (cleanEra <= 3.2) return 6.0;
  if (cleanEra <= 4.0) return 5.7;
  if (cleanEra <= 4.8) return 5.3;
  return 5.0;
}

function getEspnWindMph(weather?: unknown): number {
  if (!weather || typeof weather !== 'object') {
    return 0;
  }

  const record = weather as Record<string, unknown>;
  const sustainedWind = optionalNum(record.windMph) ?? optionalNum(record.windSpeed);
  return sustainedWind ?? optionalNum(record.gustMph) ?? 0;
}

function inferWindDirection(
  displayValue?: string | null
): 'out' | 'in' | 'cross' | 'unknown' {
  const text = String(displayValue ?? '').toLowerCase();

  if (text.includes('out to')) return 'out';
  if (text.includes('in from')) return 'in';
  if (text.includes('cross')) return 'cross';

  return 'unknown';
}

function getParkFactors(venueName?: string | null): ParkFactorProfile {
  const normalizedVenue = normalizeText(venueName);

  if (!normalizedVenue) {
    return DEFAULT_PARK_FACTORS;
  }

  return PARK_FACTORS_BY_VENUE[normalizedVenue] ?? DEFAULT_PARK_FACTORS;
}

export function mapEspnToEngineGame(
  espnGame: EspnNormalizedGameData
): EngineGame {
  const homeBat = espnGame.homeTeam.statistics.batting;
  const homePitch = espnGame.homeTeam.statistics.pitching;

  const awayBat = espnGame.awayTeam.statistics.batting;
  const awayPitch = espnGame.awayTeam.statistics.pitching;

  const homeRecord = safeRecordSplit(espnGame.homeTeam.recordSummary);
  const awayRecord = safeRecordSplit(espnGame.awayTeam.recordSummary);

  const homeGamesPlayed = Math.max(1, homeRecord.wins + homeRecord.losses);
  const awayGamesPlayed = Math.max(1, awayRecord.wins + awayRecord.losses);

  const homeMissing = getMissingBatters(
    espnGame.injuries,
    {
      abbreviation: espnGame.homeTeam.abbreviation,
      displayName: espnGame.homeTeam.displayName
    }
  );

  const awayMissing = getMissingBatters(
    espnGame.injuries,
    {
      abbreviation: espnGame.awayTeam.abbreviation,
      displayName: espnGame.awayTeam.displayName
    }
  );

  const homeStarterEra = optionalNum(espnGame.homeTeam.probableStarter?.era);
  const awayStarterEra = optionalNum(espnGame.awayTeam.probableStarter?.era);

  const homeExpectedInnings = getExpectedInnings(
    espnGame.homeTeam.probableStarter?.inningsPitched,
    espnGame.homeTeam.probableStarter?.era
  );

  const awayExpectedInnings = getExpectedInnings(
    espnGame.awayTeam.probableStarter?.inningsPitched,
    espnGame.awayTeam.probableStarter?.era
  );

  const parkFactors = getParkFactors(espnGame.venue?.name);

  return {
    gameId: espnGame.gameId,
    sport: 'MLB',
    league: 'MLB',
    startTime: espnGame.date ?? undefined,
    status: espnGame.status ?? undefined,

    homeTeam: {
      core: {
        teamName: espnGame.homeTeam.displayName,
        abbreviation: espnGame.homeTeam.abbreviation,
        isHome: true,
        record: espnGame.homeTeam.recordSummary ?? undefined,
        wins: homeRecord.wins,
        losses: homeRecord.losses,
        runsScoredPerGame: num(homeBat.runs, 0) / homeGamesPlayed,
        runsAllowedPerGame: num(homePitch.runs, 0) / homeGamesPlayed,
        runDifferentialPerGame:
          num(homeBat.runs, 0) / homeGamesPlayed -
          num(homePitch.runs, 0) / homeGamesPlayed
      },

      starter: {
        playerId: espnGame.homeTeam.probableStarter?.playerId || undefined,
        name: espnGame.homeTeam.probableStarter?.name ?? 'TBD',
        handedness: espnGame.homeTeam.probableStarter?.handedness,
        era: homeStarterEra,
        whip: espnGame.homeTeam.probableStarter?.whip ?? undefined,
        inningsPitched:
          espnGame.homeTeam.probableStarter?.inningsPitched ?? undefined,
        strikeouts:
          espnGame.homeTeam.probableStarter?.strikeouts ?? undefined,
        walks:
          espnGame.homeTeam.probableStarter?.walks ?? undefined,
        homeRuns:
          espnGame.homeTeam.probableStarter?.homeRuns ?? undefined,
        strikeoutRate:
          espnGame.homeTeam.probableStarter?.strikeoutRate ?? undefined,
        walkRate:
          espnGame.homeTeam.probableStarter?.walkRate ?? undefined,
        hrRate:
          espnGame.homeTeam.probableStarter?.hrRate ?? undefined,
        expectedInnings: homeExpectedInnings,
        status: espnGame.homeTeam.probableStarter ? 'probable' : 'unknown',
        source: espnGame.homeTeam.probableStarter ? 'espn_probable' : 'unknown',
        sourceLabel: espnGame.homeTeam.probableStarter
          ? 'ESPN competitor.probables'
          : 'No probable starter',
        sourceOk: Boolean(
          espnGame.homeTeam.probableStarter &&
          homeStarterEra !== undefined &&
          espnGame.homeTeam.probableStarter.whip !== null &&
          espnGame.homeTeam.probableStarter.whip !== undefined
        ),
        invalidReason: espnGame.homeTeam.probableStarter
          ? undefined
          : 'ESPN did not provide a probable starter'
      },

      bullpen: {
        // Defensive fallback: if MLB enrichment fails, keep bullpen near league average
        // instead of silently flattening the whole block to neutral/empty.
        era: 4.15,
        fip: 4.2,
        whip: 1.3,
        last3DaysInnings: undefined,
        last2DaysInnings: undefined,
        fatigueScore: 50,
        closerAvailable: true,
        setupAvailable: true,
        source: 'espn_base_fallback',
        sourceLabel: 'ESPN/base fallback',
        isFallback: true,
        fallbackReason: 'MLB enrichment not applied yet'
      },

      offense: {
        runsPerGame: num(homeBat.runs, 0) / homeGamesPlayed,
        battingAverage: num(homeBat.avg, 0.25),
        onBasePct: num(homeBat.onBasePct, 0.32),
        sluggingPct: num(homeBat.slugAvg, 0.4),
        ops: num(homeBat.OPS, 0.72),
        wrcPlus: undefined,
        vsRightOps: undefined,
        vsLeftOps: undefined,
        last7RunsPerGame: undefined,
        last14RunsPerGame: undefined
      },

      lineupContext: {
        confirmedLineup: undefined,
        missingKeyBatCount: homeMissing.count,
        missingKeyBatters: homeMissing.names,
        catcherBackup: homeMissing.catcherMissing,
        restDisadvantage: undefined,
        // ESPN injuries only act as a downside penalty here.
        // Positive lineup edge should come from the MLB enrichment layer.
        lineupQualityAdjustment: Math.max(
          LINEUP_QUALITY_ADJUSTMENT_MIN,
          homeMissing.impactScore > 0 ? -homeMissing.impactScore : 0
        )
      }
    },

    awayTeam: {
      core: {
        teamName: espnGame.awayTeam.displayName,
        abbreviation: espnGame.awayTeam.abbreviation,
        isHome: false,
        record: espnGame.awayTeam.recordSummary ?? undefined,
        wins: awayRecord.wins,
        losses: awayRecord.losses,
        runsScoredPerGame: num(awayBat.runs, 0) / awayGamesPlayed,
        runsAllowedPerGame: num(awayPitch.runs, 0) / awayGamesPlayed,
        runDifferentialPerGame:
          num(awayBat.runs, 0) / awayGamesPlayed -
          num(awayPitch.runs, 0) / awayGamesPlayed
      },

      starter: {
        playerId: espnGame.awayTeam.probableStarter?.playerId || undefined,
        name: espnGame.awayTeam.probableStarter?.name ?? 'TBD',
        handedness: espnGame.awayTeam.probableStarter?.handedness,
        era: awayStarterEra,
        whip: espnGame.awayTeam.probableStarter?.whip ?? undefined,
        inningsPitched:
          espnGame.awayTeam.probableStarter?.inningsPitched ?? undefined,
        strikeouts:
          espnGame.awayTeam.probableStarter?.strikeouts ?? undefined,
        walks:
          espnGame.awayTeam.probableStarter?.walks ?? undefined,
        homeRuns:
          espnGame.awayTeam.probableStarter?.homeRuns ?? undefined,
        strikeoutRate:
          espnGame.awayTeam.probableStarter?.strikeoutRate ?? undefined,
        walkRate:
          espnGame.awayTeam.probableStarter?.walkRate ?? undefined,
        hrRate:
          espnGame.awayTeam.probableStarter?.hrRate ?? undefined,
        expectedInnings: awayExpectedInnings,
        status: espnGame.awayTeam.probableStarter ? 'probable' : 'unknown',
        source: espnGame.awayTeam.probableStarter ? 'espn_probable' : 'unknown',
        sourceLabel: espnGame.awayTeam.probableStarter
          ? 'ESPN competitor.probables'
          : 'No probable starter',
        sourceOk: Boolean(
          espnGame.awayTeam.probableStarter &&
          awayStarterEra !== undefined &&
          espnGame.awayTeam.probableStarter.whip !== null &&
          espnGame.awayTeam.probableStarter.whip !== undefined
        ),
        invalidReason: espnGame.awayTeam.probableStarter
          ? undefined
          : 'ESPN did not provide a probable starter'
      },

      bullpen: {
        era: 4.15,
        fip: 4.2,
        whip: 1.3,
        last3DaysInnings: undefined,
        last2DaysInnings: undefined,
        fatigueScore: 50,
        closerAvailable: true,
        setupAvailable: true,
        source: 'espn_base_fallback',
        sourceLabel: 'ESPN/base fallback',
        isFallback: true,
        fallbackReason: 'MLB enrichment not applied yet'
      },

      offense: {
        runsPerGame: num(awayBat.runs, 0) / awayGamesPlayed,
        battingAverage: num(awayBat.avg, 0.25),
        onBasePct: num(awayBat.onBasePct, 0.32),
        sluggingPct: num(awayBat.slugAvg, 0.4),
        ops: num(awayBat.OPS, 0.72),
        wrcPlus: undefined,
        vsRightOps: undefined,
        vsLeftOps: undefined,
        last7RunsPerGame: undefined,
        last14RunsPerGame: undefined
      },

      lineupContext: {
        confirmedLineup: undefined,
        missingKeyBatCount: awayMissing.count,
        missingKeyBatters: awayMissing.names,
        catcherBackup: awayMissing.catcherMissing,
        restDisadvantage: undefined,
        lineupQualityAdjustment: Math.max(
          LINEUP_QUALITY_ADJUSTMENT_MIN,
          awayMissing.impactScore > 0 ? -awayMissing.impactScore : 0
        )
      }
    },

    parkWeather: {
      venueName: espnGame.venue?.name ?? undefined,
      parkFactorRuns: parkFactors.parkFactorRuns,
      parkFactorHr: parkFactors.parkFactorHr,
      temperatureF: espnGame.weather?.temperature ?? 70,
      windMph: getEspnWindMph(espnGame.weather),
      windDirection: inferWindDirection(espnGame.weather?.displayValue),
      rainRiskPct: espnGame.weather?.precipitationPct ?? 0,
      roofClosed: espnGame.venue?.indoor ?? false
    },

    marketContextLight: {
      lineMovementPct: undefined,
      ticketSplitPctHome: undefined,
      ticketSplitPctAway: undefined,
      sharpSignal: undefined
    },

    odds: undefined
  };
}
