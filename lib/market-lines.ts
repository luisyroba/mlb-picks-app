// lib/market-lines.ts

import { GameOddsInput } from './types';

export type MarketLine = {
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5';
  selection: string;
  line?: number;
  odds: number; // decimal odds
  side?: 'home' | 'away' | 'over' | 'under';
  supportCount?: number;
  primarySupportCount?: number;
  origin?: 'main' | 'alternate';
};

export type EventMarketLines = {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  startsAt?: string | null;
  lines: MarketLine[];
};

type SgoAltLine = {
  odds?: string;
  overUnder?: string | number;
  spread?: string | number;
  available?: boolean;
};

type SgoBookmakerLine = {
  odds?: string;
  overUnder?: string | number;
  spread?: string | number;
  available?: boolean;
  altLines?: SgoAltLine[];
};

type SgoOdd = {
  marketName?: string;
  statID?: string;
  statEntityID?: string;
  periodID?: string;
  betTypeID?: string;
  sideID?: string;
  bookOdds?: string;
  bookOverUnder?: string | number;
  bookSpread?: string | number;
  byBookmaker?: Record<string, SgoBookmakerLine>;
};

type SgoEvent = {
  eventID?: string;
  status?: {
    startsAt?: string;
  };
  teams?: {
    home?: {
      names?: { long?: string; short?: string; medium?: string };
    };
    away?: {
      names?: { long?: string; short?: string; medium?: string };
    };
  };
  odds?: Record<string, SgoOdd>;
};

type SportsGameOddsResponse = {
  success?: boolean;
  data?: SgoEvent[];
  nextCursor?: string | null;
};

type FetchMlbMarketLinesOptions = {
  startsAfter?: string;
  startsBefore?: string;
};

let cachedMarketLinesResponse: SportsGameOddsResponse | null = null;
let cachedMarketLinesAt = 0;
const MARKET_LINES_CACHE_MS = 60 * 1000; // 1 minuto
const ODDS_FETCH_TIMEOUT_MS = 9000;
const ODDS_MAX_PAGES = 5;

function getOddsApiKey(): string | undefined {
  return typeof process !== 'undefined' ? process.env.ODDS_API_KEY : undefined;
}

function getApiKeyLast4(apiKey?: string): string | null {
  if (!apiKey) return null;
  return apiKey.slice(-4);
}

function americanToDecimal(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
  }

  const trimmed = String(value).trim();
  if (!trimmed) return 0;

  const num = Number(trimmed);
  if (!Number.isFinite(num)) return 0;

  return num > 0 ? 1 + num / 100 : 1 + 100 / Math.abs(num);
}

function decimalToImpliedProbability(odds?: number): number {
  if (!odds || !Number.isFinite(odds) || odds <= 1) return 0;
  return 1 / odds;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d+-.]/g, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function isAvailable(flag?: boolean): boolean {
  return flag !== false;
}

function isHalfPointLine(line?: number): boolean {
  if (line === undefined || line === null) return false;
  const decimal = Math.abs(line % 1);
  return Math.abs(decimal - 0.5) < 0.001;
}

function isWholeOrHalfPointLine(line?: number): boolean {
  if (line === undefined || line === null) return false;
  const decimal = Math.abs(line % 1);
  return decimal < 0.001 || Math.abs(decimal - 0.5) < 0.001;
}

function getBookmakerSupportCount(
  byBookmaker?: Record<string, SgoBookmakerLine>
): number {
  const books = Object.values(byBookmaker ?? {}).filter((book) =>
    isAvailable(book?.available)
  );

  return Math.max(1, books.length);
}

function isReasonableMlbTotal(
  line?: number,
  marketType?: MarketLine['marketType']
): boolean {
  if (line === undefined || line === null) return false;

  // Full game MLB totals razonables para tu uso
  if (marketType === 'TOTAL') {
    return line >= 4.5 && line <= 16.5;
  }

  // F5 totals razonables
  if (marketType === 'F5') {
    return line >= 1.5 && line <= 8.5;
  }

  return true;
}

function isReasonableRunLine(
  line?: number,
  marketType?: MarketLine['marketType']
): boolean {
  if (line === undefined || line === null) return false;

  // Para MLB casi siempre te interesa escalera corta y usable
  if (marketType === 'RL') {
    return line >= -3.5 && line <= 3.5;
  }

  if (marketType === 'F5') {
    return line >= -2.5 && line <= 2.5;
  }

  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function hasMonotonicOddsConflict(
  candidate: MarketLine,
  existing: MarketLine[]
): boolean {
  if (
    candidate.marketType !== 'TOTAL' &&
    candidate.marketType !== 'F5'
  ) {
    return false;
  }

  if (
    candidate.side !== 'over' &&
    candidate.side !== 'under'
  ) {
    return false;
  }

  const sameFamily = existing.filter(
    (line) =>
      line.marketType === candidate.marketType &&
      line.side === candidate.side &&
      typeof line.line === 'number'
  );

  for (const line of sameFamily) {
    if (candidate.line === undefined || line.line === undefined) continue;

    // OVER:
    // línea más alta => cuota debería ser igual o mayor
    if (candidate.side === 'over') {
      if (candidate.line > line.line && candidate.odds < line.odds) {
        return true;
      }

      if (candidate.line < line.line && candidate.odds > line.odds) {
        return true;
      }
    }

    // UNDER:
    // línea más alta => cuota debería ser igual o menor
    if (candidate.side === 'under') {
      if (candidate.line > line.line && candidate.odds > line.odds) {
        return true;
      }

      if (candidate.line < line.line && candidate.odds < line.odds) {
        return true;
      }
    }
  }

  return false;
}

function makeLineKey(
  marketType: MarketLine['marketType'],
  side: MarketLine['side'],
  line?: number
): string {
  return `${marketType}|${side ?? 'na'}|${line ?? 'na'}`;
}

function pushUniqueLine(target: MarketLine[], line: MarketLine) {
  // Filtros de sanidad antes de guardar
  if (
    (line.marketType === 'TOTAL' || line.marketType === 'F5') &&
    (line.side === 'over' || line.side === 'under')
  ) {
    if (!isReasonableMlbTotal(line.line, line.marketType)) {
      return;
    }
  }

  if (
    (line.marketType === 'RL' || line.marketType === 'F5') &&
    (line.side === 'home' || line.side === 'away') &&
    line.line !== undefined
  ) {
    if (!isReasonableRunLine(line.line, line.marketType)) {
      return;
    }
  }

  const normalizedLine: MarketLine = {
    ...line,
    supportCount: Math.max(1, line.supportCount ?? 1),
    primarySupportCount: Math.max(0, line.primarySupportCount ?? 0),
    origin:
      Math.max(0, line.primarySupportCount ?? 0) > 0
        ? 'main'
        : (line.origin ?? 'alternate')
  };

  const key = makeLineKey(line.marketType, line.side, line.line);
  const existingIndex = target.findIndex(
    (item) => makeLineKey(item.marketType, item.side, item.line) === key
  );

  if (existingIndex === -1) {
    target.push(normalizedLine);
    return;
  }

  // Conserva la línea cuya cuota esté más cerca del centro del mercado
  const current = target[existingIndex];
  const currentDistance = Math.abs(current.odds - 1.91);
  const nextDistance = Math.abs(normalizedLine.odds - 1.91);
  const representative =
    nextDistance < currentDistance ? normalizedLine : current;

  target[existingIndex] = {
    ...representative,
    supportCount:
      Math.max(1, current.supportCount ?? 1) +
      Math.max(1, normalizedLine.supportCount ?? 1),
    primarySupportCount:
      Math.max(0, current.primarySupportCount ?? 0) +
      Math.max(0, normalizedLine.primarySupportCount ?? 0),
    origin:
      Math.max(
        Math.max(0, current.primarySupportCount ?? 0),
        Math.max(0, normalizedLine.primarySupportCount ?? 0)
      ) > 0
        ? 'main'
        : (representative.origin ?? current.origin ?? normalizedLine.origin ?? 'alternate')
  };
}

function extractAltLines(
  odd: SgoOdd,
  config: {
    marketType: MarketLine['marketType'];
    side: 'home' | 'away' | 'over' | 'under';
    selection: string;
    lineField: 'spread' | 'overUnder';
  }
): MarketLine[] {
  const results: MarketLine[] = [];
  const byBookmaker = odd.byBookmaker ?? {};

  for (const book of Object.values(byBookmaker)) {
    if (!book?.altLines?.length) continue;

    for (const alt of book.altLines) {
      if (!isAvailable(alt.available)) continue;

      const rawLine =
        config.lineField === 'spread' ? alt.spread : alt.overUnder;
      const parsedLine = toNumber(rawLine, Number.NaN);
      const parsedOdds = americanToDecimal(alt.odds);

      if (!Number.isFinite(parsedLine) || !parsedOdds) continue;

      if (config.lineField === 'overUnder') {
        if (!isReasonableMlbTotal(parsedLine, config.marketType)) continue;
      }

      if (config.lineField === 'spread') {
        if (!isReasonableRunLine(parsedLine, config.marketType)) continue;
      }

      results.push({
        marketType: config.marketType,
        selection: config.selection,
        line: parsedLine,
        odds: parsedOdds,
        side: config.side,
        supportCount: 1,
        primarySupportCount: 0,
        origin: 'alternate'
      });
    }
  }

  return results;
}

function getTotalPairsForMarket(
  lines: MarketLine[],
  marketType: 'TOTAL' | 'F5'
): Array<{ line: number; over: MarketLine; under: MarketLine }> {
  const totals = lines.filter(
    (line) =>
      line.marketType === marketType &&
      (line.side === 'over' || line.side === 'under') &&
      isWholeOrHalfPointLine(line.line)
  );

  const grouped = new Map<number, { over?: MarketLine; under?: MarketLine }>();

  for (const line of totals) {
    if (line.line === undefined) continue;

    const key = Number(line.line);
    const current = grouped.get(key) ?? {};

    if (line.side === 'over') current.over = line;
    if (line.side === 'under') current.under = line;

    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .filter(([, pair]) => pair.over && pair.under)
    .map(([line, pair]) => ({
      line,
      over: pair.over!,
      under: pair.under!
    }));
}

function getLineSupport(line?: MarketLine): number {
  return Math.max(1, line?.supportCount ?? 1);
}

function getLinePrimarySupport(line?: MarketLine): number {
  return Math.max(0, line?.primarySupportCount ?? 0);
}

function pickSupportedTotalPair(
  lines: MarketLine[],
  marketType: 'TOTAL' | 'F5',
  options?: {
    requirePrimaryPair?: boolean;
  }
): { line: number; over: MarketLine; under: MarketLine } | null {
  const completePairs = getTotalPairsForMarket(lines, marketType);
  const filteredPairs =
    options?.requirePrimaryPair
      ? completePairs.filter(
          (pair) =>
            getLinePrimarySupport(pair.over) > 0 &&
            getLinePrimarySupport(pair.under) > 0
        )
      : completePairs;

  if (!filteredPairs.length) return null;

  const sortedLines = filteredPairs.map((pair) => pair.line).sort((a, b) => a - b);
  const centerLine = sortedLines[Math.floor((sortedLines.length - 1) / 2)];
  const centerWeight = marketType === 'TOTAL' ? 0.4 : 0.32;

  const scoredPairs = filteredPairs.map((pair) => ({
    ...pair,
    primarySupport:
      getLinePrimarySupport(pair.over) + getLinePrimarySupport(pair.under),
    totalSupport: getLineSupport(pair.over) + getLineSupport(pair.under),
    balanceScore:
      Math.abs(pair.over.odds - 1.91) +
      Math.abs(pair.under.odds - 1.91) +
      Math.abs(pair.over.odds - pair.under.odds) * 0.45 +
      Math.abs(pair.line - centerLine) * centerWeight
  }));

  scoredPairs.sort((a, b) => {
    if (a.primarySupport !== b.primarySupport) {
      return b.primarySupport - a.primarySupport;
    }

    if (a.totalSupport !== b.totalSupport) {
      return b.totalSupport - a.totalSupport;
    }

    if (a.balanceScore !== b.balanceScore) {
      return a.balanceScore - b.balanceScore;
    }

    return Math.abs(a.line - centerLine) - Math.abs(b.line - centerLine);
  });

  return scoredPairs[0] ?? null;
}

function pickAnchorTotalLine(
  lines: MarketLine[],
  marketType: 'TOTAL' | 'F5'
): number | null {
  return pickSupportedTotalPair(lines, marketType)?.line ?? null;
}

function getSpreadPairs(
  lines: MarketLine[],
  marketType: 'RL' | 'F5'
): Array<{ absoluteLine: number; home: MarketLine; away: MarketLine }> {
  const spreads = lines.filter(
    (line) =>
      line.marketType === marketType &&
      (line.side === 'home' || line.side === 'away') &&
      isHalfPointLine(line.line)
  );

  const homeCandidates = spreads.filter((line) => line.side === 'home');
  const awayCandidates = spreads.filter((line) => line.side === 'away');
  const pairs: Array<{ absoluteLine: number; home: MarketLine; away: MarketLine }> = [];

  for (const home of homeCandidates) {
    if (home.line === undefined) continue;

    for (const away of awayCandidates) {
      if (away.line === undefined) continue;

      if (Math.abs(Math.abs(home.line) - Math.abs(away.line)) > 0.001) continue;
      if (Math.sign(home.line) === Math.sign(away.line)) continue;

      pairs.push({
        absoluteLine: Math.abs(home.line),
        home,
        away
      });
    }
  }

  return pairs;
}

function sanitizeTotalSide(
  lines: MarketLine[],
  marketType: 'TOTAL' | 'F5',
  side: 'over' | 'under',
  anchorLine: number
): MarketLine[] {
  const candidates = lines
    .filter(
      (line) =>
        line.marketType === marketType &&
        line.side === side &&
        typeof line.line === 'number' &&
        isWholeOrHalfPointLine(line.line)
    )
    .sort((left, right) => (left.line ?? 0) - (right.line ?? 0));

  if (!candidates.length) return [];

  const anchor =
    candidates.find((candidate) => Math.abs((candidate.line ?? 0) - anchorLine) < 0.001) ??
    [...candidates].sort(
      (left, right) =>
        Math.abs((left.line ?? 0) - anchorLine) - Math.abs((right.line ?? 0) - anchorLine)
    )[0];

  if (!anchor || anchor.line === undefined) return candidates;
  const anchorValue = anchor.line;

  const saferLines =
    side === 'over'
      ? [...candidates.filter((candidate) => (candidate.line ?? 0) < anchorValue)].sort(
          (left, right) => (right.line ?? 0) - (left.line ?? 0)
        )
      : [...candidates.filter((candidate) => (candidate.line ?? 0) > anchorValue)].sort(
          (left, right) => (left.line ?? 0) - (right.line ?? 0)
        );

  const riskierLines =
    side === 'over'
      ? [...candidates.filter((candidate) => (candidate.line ?? 0) > anchorValue)].sort(
          (left, right) => (left.line ?? 0) - (right.line ?? 0)
        )
      : [...candidates.filter((candidate) => (candidate.line ?? 0) < anchorValue)].sort(
          (left, right) => (right.line ?? 0) - (left.line ?? 0)
        );

  const kept = new Map<number, MarketLine>();
  kept.set(anchor.line, anchor);

  let lastSaferOdds = anchor.odds;
  for (const candidate of saferLines) {
    if (candidate.odds <= lastSaferOdds + 0.02) {
      kept.set(candidate.line!, candidate);
      lastSaferOdds = Math.min(lastSaferOdds, candidate.odds);
    }
  }

  let lastRiskierOdds = anchor.odds;
  for (const candidate of riskierLines) {
    if (candidate.odds >= lastRiskierOdds - 0.02) {
      kept.set(candidate.line!, candidate);
      lastRiskierOdds = Math.max(lastRiskierOdds, candidate.odds);
    }
  }

  return [...kept.values()];
}

function sanitizeTotalLadders(lines: MarketLine[]): MarketLine[] {
  let sanitized = [...lines];

  for (const marketType of ['TOTAL', 'F5'] as const) {
    const anchorLine = pickAnchorTotalLine(sanitized, marketType);
    if (anchorLine === null) continue;

    const nonTotals = sanitized.filter(
      (line) =>
        line.marketType !== marketType ||
        (line.side !== 'over' && line.side !== 'under')
    );

    const overLines = sanitizeTotalSide(sanitized, marketType, 'over', anchorLine);
    const underLines = sanitizeTotalSide(sanitized, marketType, 'under', anchorLine);

    sanitized = [...nonTotals, ...overLines, ...underLines];
  }

  return sanitized;
}

function sanitizeOddsRequestUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('apiKey', 'REDACTED');
  return parsed.toString();
}

async function fetchJSON(
  url: string,
  timeoutMs: number
): Promise<{
  json: SportsGameOddsResponse;
  status: number;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal
    });

    if (!res.ok) {
      const error = new Error(`Odds API error ${res.status}`) as Error & {
        status?: number;
      };
      error.status = res.status;
      throw error;
    }

    const json: unknown = await res.json();

    if (!json || typeof json !== 'object') {
    throw new Error('Odds API devolvió una respuesta inválida');
  }

    return {
      json: json as SportsGameOddsResponse,
      status: res.status
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getNextCursor(json: SportsGameOddsResponse): string | null {
  const payload = json as SportsGameOddsResponse & {
    next_cursor?: string | null;
    cursor?: string | null;
    meta?: {
      nextCursor?: string | null;
      next_cursor?: string | null;
    };
  };

  return (
    payload.nextCursor ??
    payload.next_cursor ??
    payload.cursor ??
    payload.meta?.nextCursor ??
    payload.meta?.next_cursor ??
    null
  );
}

function buildEventsUrl(
  options: FetchMlbMarketLinesOptions,
  apiKey: string,
  cursor?: string | null
): string {
  const params = new URLSearchParams({
    leagueID: 'MLB',
    oddsAvailable: 'true',
    includeAltLines: 'true',
    limit: '100',
    apiKey
  });

  if (options.startsAfter) {
    params.set('startsAfter', options.startsAfter);
  }

  if (options.startsBefore) {
    params.set('startsBefore', options.startsBefore);
  }

  if (cursor) {
    params.set('cursor', cursor);
  }

  return `https://api.sportsgameodds.com/v2/events?${params.toString()}`;
}

export async function fetchMlbMarketLines(
  options: FetchMlbMarketLinesOptions = {}
): Promise<SportsGameOddsResponse> {
  const now = Date.now();
  const canUseMemoryCache = !options.startsAfter && !options.startsBefore;
  const startedAt = Date.now();
  const deadline = startedAt + ODDS_FETCH_TIMEOUT_MS;
  const apiKey = getOddsApiKey();
  let oddsRequestUrl: string | null = null;
  let oddsHttpStatus: number | null = null;
  let page = 0;
  let nextCursorSeen = false;
  let refreshFailedReason: string | null = null;
  const allData: SgoEvent[] = [];

  if (!apiKey) {
    refreshFailedReason = 'Falta ODDS_API_KEY en .env.local';
    console.warn('[odds-fetch] market board fetch failed', {
      apiKeyPresent: false,
      apiKeyLast4: null,
      oddsRequestUrl,
      oddsHttpStatus,
      oddsFetchDurationMs: Date.now() - startedAt,
      pageCount: page,
      eventCountFetched: allData.length,
      nextCursorSeen,
      refreshFailedReason
    });
    throw new Error(refreshFailedReason);
  }

  if (
    canUseMemoryCache &&
    cachedMarketLinesResponse &&
    now - cachedMarketLinesAt < MARKET_LINES_CACHE_MS
  ) {
    return cachedMarketLinesResponse;
  }

  let nextCursor: string | null | undefined = null;
  let lastResponse: SportsGameOddsResponse | null = null;

  try {
    do {
      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) {
        throw new Error(`Odds API timeout after ${ODDS_FETCH_TIMEOUT_MS}ms`);
      }

      const url = buildEventsUrl(options, apiKey, nextCursor);
      oddsRequestUrl = oddsRequestUrl ?? sanitizeOddsRequestUrl(url);

      page += 1;

      const fresh = await fetchJSON(url, remainingMs);
      oddsHttpStatus = fresh.status;
      lastResponse = fresh.json;
      allData.push(...(fresh.json.data ?? []));
      nextCursor = getNextCursor(fresh.json);
      nextCursorSeen = nextCursorSeen || Boolean(nextCursor);
    } while (nextCursor && page < ODDS_MAX_PAGES);
  } catch (error) {
    refreshFailedReason =
      error instanceof Error ? error.message : 'Unknown odds error';
    oddsHttpStatus =
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : oddsHttpStatus;

    console.warn('[odds-fetch] market board fetch failed', {
      apiKeyPresent: Boolean(apiKey),
      apiKeyLast4: getApiKeyLast4(apiKey),
      oddsRequestUrl,
      oddsHttpStatus,
      oddsFetchDurationMs: Date.now() - startedAt,
      pageCount: page,
      eventCountFetched: allData.length,
      nextCursorSeen,
      refreshFailedReason
    });

    throw error;
  }

  const fresh: SportsGameOddsResponse = {
    ...(lastResponse ?? {}),
    data: allData,
    nextCursor
  };

  console.warn('[odds-fetch] market board fetch complete', {
    apiKeyPresent: Boolean(apiKey),
    apiKeyLast4: getApiKeyLast4(apiKey),
    oddsRequestUrl,
    oddsHttpStatus,
    oddsFetchDurationMs: Date.now() - startedAt,
    pageCount: page,
    eventCountFetched: allData.length,
    nextCursorSeen,
    refreshFailedReason
  });

  if (canUseMemoryCache) {
    cachedMarketLinesResponse = fresh;
    cachedMarketLinesAt = now;
  }

  return fresh;
}

export function normalizeMarketLines(
  json: SportsGameOddsResponse
): EventMarketLines[] {
  const events = json.data ?? [];

  return events.map((event) => {
    const homeTeam =
      event.teams?.home?.names?.long ??
      event.teams?.home?.names?.medium ??
      event.teams?.home?.names?.short ??
      'HOME';

    const awayTeam =
      event.teams?.away?.names?.long ??
      event.teams?.away?.names?.medium ??
      event.teams?.away?.names?.short ??
      'AWAY';

    const lines: MarketLine[] = [];
    const oddsMap = event.odds ?? {};

    for (const odd of Object.values(oddsMap)) {
      if (!odd) continue;

      const periodID = String(odd.periodID ?? '').toLowerCase();
      const betTypeID = String(odd.betTypeID ?? '').toLowerCase();
      const sideID = String(odd.sideID ?? '').toLowerCase();
      const statID = String(odd.statID ?? '').toLowerCase();
      const statEntityID = String(odd.statEntityID ?? '').toLowerCase();

      const isGame = periodID === 'game';
      const isF5 = periodID === '1ix5';

      // Solo trabajamos full game y F5.
      if (!isGame && !isF5) continue;

      // MONEYLINE
      if (betTypeID === 'ml') {
        const selectionSide: 'home' | 'away' | undefined =
          sideID === 'home' ? 'home' : sideID === 'away' ? 'away' : undefined;

        if (!selectionSide) continue;

        const parsedOdds = americanToDecimal(odd.bookOdds);
        if (!parsedOdds) continue;

        // Para ML no usamos pushUniqueLine aquí,
        // porque eso colapsa cada lado al precio más cercano a 1.91
        // y termina armando pares falsos.
        lines.push({
          marketType: isGame ? 'ML' : 'F5',
          selection: selectionSide === 'home' ? homeTeam : awayTeam,
          odds: parsedOdds,
          side: selectionSide,
          supportCount: getBookmakerSupportCount(odd.byBookmaker),
          primarySupportCount: getBookmakerSupportCount(odd.byBookmaker),
          origin: 'main'
        });

        continue;
      }

      // TOTALS
      if (
        betTypeID === 'ou' &&
        statEntityID === 'all' &&
        statID === 'points'
      ) {
        const selectionSide: 'over' | 'under' | undefined =
          sideID === 'over' ? 'over' : sideID === 'under' ? 'under' : undefined;

        if (!selectionSide) continue;

        const mainLine = toNumber(odd.bookOverUnder, Number.NaN);
        const mainOdds = americanToDecimal(odd.bookOdds);

if (
  Number.isFinite(mainLine) &&
  mainOdds &&
  isReasonableMlbTotal(mainLine, isGame ? 'TOTAL' : 'F5')
) {
  pushUniqueLine(lines, {
    marketType: isGame ? 'TOTAL' : 'F5',
    selection: selectionSide === 'over' ? 'Over' : 'Under',
    line: mainLine,
    odds: mainOdds,
    side: selectionSide,
    supportCount: getBookmakerSupportCount(odd.byBookmaker),
    primarySupportCount: getBookmakerSupportCount(odd.byBookmaker),
    origin: 'main'
  });
}

        const altLines = extractAltLines(odd, {
          marketType: isGame ? 'TOTAL' : 'F5',
          side: selectionSide,
          selection: selectionSide === 'over' ? 'Over' : 'Under',
          lineField: 'overUnder'
        });

        for (const alt of altLines) {
          pushUniqueLine(lines, alt);
        }

        continue;
      }

      // RUN LINE / SPREAD
      if (betTypeID === 'sp') {
        const selectionSide: 'home' | 'away' | undefined =
          sideID === 'home' ? 'home' : sideID === 'away' ? 'away' : undefined;

        if (!selectionSide) continue;

        const mainLine = toNumber(odd.bookSpread, Number.NaN);
        const mainOdds = americanToDecimal(odd.bookOdds);

if (
  Number.isFinite(mainLine) &&
  mainOdds &&
  isReasonableRunLine(mainLine, isGame ? 'RL' : 'F5')
) {
  pushUniqueLine(lines, {
    marketType: isGame ? 'RL' : 'F5',
    selection: selectionSide === 'home' ? homeTeam : awayTeam,
    line: mainLine,
    odds: mainOdds,
    side: selectionSide,
    supportCount: getBookmakerSupportCount(odd.byBookmaker),
    primarySupportCount: getBookmakerSupportCount(odd.byBookmaker),
    origin: 'main'
  });
}

        const altLines = extractAltLines(odd, {
          marketType: isGame ? 'RL' : 'F5',
          side: selectionSide,
          selection: selectionSide === 'home' ? homeTeam : awayTeam,
          lineField: 'spread'
        });

        for (const alt of altLines) {
          pushUniqueLine(lines, alt);
        }

        continue;
      }
    }

    return {
      eventId: String(event.eventID ?? ''),
      homeTeam,
      awayTeam,
      startsAt: event.status?.startsAt ?? null,
      lines: sanitizeTotalLadders(lines)
    };
  });
}

function pickMainMoneylinePair(
  lines: MarketLine[],
  marketType: 'ML' | 'F5' = 'ML'
): { homeML: number; awayML: number } | undefined {
  const homeCandidates = lines.filter(
    (line) =>
      line.marketType === marketType &&
      line.side === 'home' &&
      line.line === undefined
  );

  const awayCandidates = lines.filter(
    (line) =>
      line.marketType === marketType &&
      line.side === 'away' &&
      line.line === undefined
  );

  if (!homeCandidates.length || !awayCandidates.length) {
    return undefined;
  }

  const pairs: Array<{
    homeML: number;
    awayML: number;
    balanceScore: number;
  }> = [];

  for (const home of homeCandidates) {
    for (const away of awayCandidates) {
      const impliedHome = home.odds > 1 ? 1 / home.odds : 0;
      const impliedAway = away.odds > 1 ? 1 / away.odds : 0;
      const overround = impliedHome + impliedAway;

      if (!impliedHome || !impliedAway) continue;

      pairs.push({
        homeML: home.odds,
        awayML: away.odds,
        balanceScore:
          Math.abs(overround - 1.05) + Math.abs(home.odds - away.odds) * 0.02
      });
    }
  }

  if (!pairs.length) return undefined;

  pairs.sort((a, b) => a.balanceScore - b.balanceScore);

  return {
    homeML: pairs[0].homeML,
    awayML: pairs[0].awayML
  };
}

function pickMainRunLine(
  lines: MarketLine[]
): { home: { line: number; odds: number }; away: { line: number; odds: number } } | undefined {
  const candidates = getSpreadPairs(lines, 'RL').filter(
    (pair) =>
      getLinePrimarySupport(pair.home) > 0 &&
      getLinePrimarySupport(pair.away) > 0
  );

  if (!candidates.length) return undefined;

  const sorted = [...candidates].sort((a, b) => {
    const primarySupportA =
      getLinePrimarySupport(a.home) + getLinePrimarySupport(a.away);
    const primarySupportB =
      getLinePrimarySupport(b.home) + getLinePrimarySupport(b.away);

    if (primarySupportA !== primarySupportB) {
      return primarySupportB - primarySupportA;
    }

    const totalSupportA = getLineSupport(a.home) + getLineSupport(a.away);
    const totalSupportB = getLineSupport(b.home) + getLineSupport(b.away);

    if (totalSupportA !== totalSupportB) {
      return totalSupportB - totalSupportA;
    }

    const targetDistanceA = Math.abs(a.absoluteLine - 1.5);
    const targetDistanceB = Math.abs(b.absoluteLine - 1.5);

    if (targetDistanceA !== targetDistanceB) {
      return targetDistanceA - targetDistanceB;
    }

    const balanceScoreA =
      Math.abs(a.home.odds - 1.91) +
      Math.abs(a.away.odds - 1.91) +
      Math.abs(a.home.odds - a.away.odds) * 0.45;
    const balanceScoreB =
      Math.abs(b.home.odds - 1.91) +
      Math.abs(b.away.odds - 1.91) +
      Math.abs(b.home.odds - b.away.odds) * 0.45;

    return balanceScoreA - balanceScoreB;
  });

  const best = sorted[0];
  if (!best || best.home.line === undefined || best.away.line === undefined) {
    return undefined;
  }

  return {
    home: {
      line: best.home.line,
      odds: best.home.odds
    },
    away: {
      line: best.away.line,
      odds: best.away.odds
    }
  };
}

function pickSharedEvaluableTotalPair(
  lines: MarketLine[],
  marketType: 'TOTAL' | 'F5'
): { line: number; overOdds: number; underOdds: number } | undefined {
  const best = pickSupportedTotalPair(lines, marketType, {
    requirePrimaryPair: true
  });

  if (!best) return undefined;

  if (isHalfPointLine(best.line)) {
    return {
      line: best.line,
      overOdds: best.over.odds,
      underOdds: best.under.odds
    };
  }

  const nearbyPairs = getTotalPairsForMarket(lines, marketType)
    .filter(
      (pair) =>
        isHalfPointLine(pair.line) &&
        Math.abs(pair.line - best.line) <= 0.5 + 0.001
    )
    .map((pair) => ({
      ...pair,
      primarySupport:
        getLinePrimarySupport(pair.over) + getLinePrimarySupport(pair.under),
      totalSupport: getLineSupport(pair.over) + getLineSupport(pair.under)
    }));

  const mainOverImplied = decimalToImpliedProbability(best.over.odds);
  const mainUnderImplied = decimalToImpliedProbability(best.under.odds);
  const mainBias = mainOverImplied - mainUnderImplied;
  const preferredLine =
    Math.abs(mainBias) <= 0.0001
      ? null
      : mainBias > 0
        ? best.line + 0.5
        : best.line - 0.5;

  const sortPairs = (
    pairs: typeof nearbyPairs
  ) =>
    [...pairs].sort((left, right) => {
      if (left.primarySupport !== right.primarySupport) {
        return right.primarySupport - left.primarySupport;
      }

      if (left.totalSupport !== right.totalSupport) {
        return right.totalSupport - left.totalSupport;
      }

      return Math.abs(left.line - best.line) - Math.abs(right.line - best.line);
    });

  const preferredPairs =
    preferredLine === null
      ? []
      : nearbyPairs.filter((pair) => Math.abs(pair.line - preferredLine) < 0.001);
  const selected = sortPairs(
    preferredPairs.length ? preferredPairs : nearbyPairs
  )[0];
  if (!selected) return undefined;

  return {
    line: selected.line,
    overOdds: selected.over.odds,
    underOdds: selected.under.odds
  };
}

function pickMainTotalLine(
  lines: MarketLine[]
): { line: number; overOdds: number; underOdds: number } | undefined {
  return pickSharedEvaluableTotalPair(lines, 'TOTAL');
}

function pickMainF5Moneyline(
  lines: MarketLine[]
): { homeML: number; awayML: number } | undefined {
  return pickMainMoneylinePair(lines, 'F5');
}

function pickMainF5Total(
  lines: MarketLine[]
): { line: number; overOdds: number; underOdds: number } | undefined {
  return pickSharedEvaluableTotalPair(lines, 'F5');
}

export function mapEventMarketLinesToGameOdds(
  marketEvent: EventMarketLines | null
): GameOddsInput | undefined {
  if (!marketEvent) return undefined;

  const lines = marketEvent.lines;

  const mainMoneyline = pickMainMoneylinePair(lines);

  const homeML = mainMoneyline?.homeML;
  const awayML = mainMoneyline?.awayML;

  const mainRunLine = pickMainRunLine(lines);
  const homeRL = mainRunLine?.home;
  const awayRL = mainRunLine?.away;

  const total = pickMainTotalLine(lines);

  const mainF5Moneyline = pickMainF5Moneyline(lines);
  const homeF5ML = mainF5Moneyline?.homeML;
  const awayF5ML = mainF5Moneyline?.awayML;

  const f5Total = pickMainF5Total(lines);

  return {
    homeML,
    awayML,
    homeRL,
    awayRL,
    total,
    homeF5ML,
    awayF5ML,
    f5Total
  };
}
