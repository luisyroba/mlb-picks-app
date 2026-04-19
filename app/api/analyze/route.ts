// app/api/analyze/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getNormalizedEspnMlbGame } from '@/lib/espn';
import { mapEspnToEngineGame } from '@/lib/map-espn-to-engine';
import { enrichEngineGameWithMlbStats } from '@/lib/mlb-stats';
import { projectGameScript } from '@/lib/project-game-script';
import { evaluateMarkets } from '@/lib/evaluate-markets';
import { chooseBestPick } from '@/lib/choose-best-pick';
import { chooseBestExecution } from '@/lib/choose-best-execution';
import { serializeAlternativeMarket } from '@/lib/pick-alternatives';
import {
  GAME_START_GRACE_PERIOD_MS,
  ODDS_REFRESH_COOLDOWN_MS,
  USER_TIMEZONE
} from '@/lib/runtime-config';
import { normalizeEntityName } from '@/lib/text-utils';
import {
  fetchMlbMarketLines,
  normalizeMarketLines,
  mapEventMarketLinesToGameOdds
} from '@/lib/market-lines';
import {
  saveMarketSnapshot,
  getLatestMarketSnapshot,
  getMarketSnapshotWindow,
  getLatestPickForGame,
  getPregameSnapshotsForGame,
  savePregameSnapshot,
  getOddsBoardCache,
  saveOddsBoardCache,
  type SnapshotStage,
  type PregameSnapshotRow
} from '@/lib/db';
import { autoSettlePick } from '@/lib/auto-settle-picks';

function roundOdds(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(2));
}

function roundMetric(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function roundScore(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(1));
}

const ODDS_BOARD_KEY = 'mlb_main';

type NormalizeMarketLinesInput = Parameters<typeof normalizeMarketLines>[0];

function getAgeMs(updatedAt?: string | null): number | null {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Date.now() - ms;
}

function formatUsageDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatUsageMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit'
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type === 'year' || part.type === 'month') {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    }, {});

  return `${parts.year}-${parts.month}`;
}

async function bumpOddsUsageCounter(boardKey: string, date = new Date()) {
  const current = await getOddsBoardCache(boardKey);
  const currentPayload =
    current?.payload && typeof current.payload === 'object'
      ? (current.payload as Record<string, unknown>)
      : null;
  const currentCount =
    typeof currentPayload?.count === 'number' && Number.isFinite(currentPayload.count)
      ? currentPayload.count
      : typeof currentPayload?.count === 'string'
        ? Number(currentPayload.count)
        : 0;

  await saveOddsBoardCache({
    boardKey,
    sport: 'MLB',
    payload: {
      count: Number.isFinite(currentCount) ? currentCount + 1 : 1,
      lastCallAt: date.toISOString(),
      cooldownMinutes: Math.round(ODDS_REFRESH_COOLDOWN_MS / 60000)
    },
    source: 'ops'
  });
}

async function recordOddsApiRefreshUsage(date = new Date()) {
  const dailyKey = `ops:odds:daily:${formatUsageDateKey(date)}`;
  const monthlyKey = `ops:odds:monthly:${formatUsageMonthKey(date)}`;

  await Promise.all([
    bumpOddsUsageCounter(dailyKey, date),
    bumpOddsUsageCounter(monthlyKey, date)
  ]);
}

async function getNormalizedMarketLinesAuto(): Promise<{
  normalizedLines: ReturnType<typeof normalizeMarketLines>;
  oddsCacheUpdatedAt: string | null;
  oddsRefreshUsed: boolean;
  oddsFetchWarning: string | null;
}> {
  const cached = await getOddsBoardCache(ODDS_BOARD_KEY);
  const ageMs = getAgeMs(cached?.updated_at ?? null);

  if (
    cached?.payload &&
    ageMs !== null &&
    ageMs < ODDS_REFRESH_COOLDOWN_MS
  ) {
const cachedPayload =
  cached.payload as unknown as NormalizeMarketLinesInput;

    return {
      normalizedLines: normalizeMarketLines(cachedPayload),
      oddsCacheUpdatedAt: cached.updated_at,
      oddsRefreshUsed: false,
      oddsFetchWarning: null
    };
  }

  try {
    const fresh = await fetchMlbMarketLines();

    const saved = await saveOddsBoardCache({
      boardKey: ODDS_BOARD_KEY,
      sport: 'MLB',
      payload: fresh as unknown as Record<string, unknown>,
      source: 'sportsgameodds'
    });
    await recordOddsApiRefreshUsage();

    return {
      normalizedLines: normalizeMarketLines(fresh),
      oddsCacheUpdatedAt: saved.updated_at,
      oddsRefreshUsed: true,
      oddsFetchWarning: null
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown odds error';

    if (cached?.payload) {
const cachedPayload =
  cached.payload as unknown as NormalizeMarketLinesInput;

      return {
        normalizedLines: normalizeMarketLines(cachedPayload),
        oddsCacheUpdatedAt: cached.updated_at,
        oddsRefreshUsed: false,
        oddsFetchWarning: message
      };
    }

    throw error;
  }
}

function isGameStarted(
  status?: string | null,
  startTime?: string | null
): boolean {
  const normalizedStatus = String(status ?? '').toLowerCase();

  if (
    normalizedStatus.includes('in progress') ||
    normalizedStatus.includes('final') ||
    normalizedStatus.includes('completed') ||
    normalizedStatus.includes('game over')
  ) {
    return true;
  }

  if (startTime) {
    const startMs = new Date(startTime).getTime();

    if (
      Number.isFinite(startMs) &&
      Date.now() >= startMs + GAME_START_GRACE_PERIOD_MS
    ) {
      return true;
    }
  }

  return false;
}

function mapFinalPickToExecutionInput(
  finalPick: ReturnType<typeof chooseBestPick>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
): {
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5';
  preferredSide: 'home' | 'away' | 'over' | 'under';
  tier: 'A' | 'B' | 'C';
  referenceLine: number | null;
} | null {
  if (finalPick.market === 'PASS') return null;

  const executionMarket =
    finalPick.market === 'ML' ||
    finalPick.market === 'RL' ||
    finalPick.market === 'TOTAL' ||
    finalPick.market === 'F5'
      ? finalPick.market
      : null;

  if (!executionMarket) return null;

  const selection = normalizeEntityName(finalPick.selection);

  let preferredSide: 'home' | 'away' | 'over' | 'under' = 'home';

  if (
    executionMarket === 'TOTAL' ||
    selection.includes('over') ||
    selection.includes('under')
  ) {
    preferredSide = selection.includes('under') ? 'under' : 'over';
  } else {
    const awayName = normalizeEntityName(engineGame.awayTeam.core.teamName);
    const homeName = normalizeEntityName(engineGame.homeTeam.core.teamName);
    const awayAbbr = normalizeEntityName(engineGame.awayTeam.core.abbreviation);
    const homeAbbr = normalizeEntityName(engineGame.homeTeam.core.abbreviation);

    if (selection.includes(awayName) || selection.includes(awayAbbr)) {
      preferredSide = 'away';
    } else if (selection.includes(homeName) || selection.includes(homeAbbr)) {
      preferredSide = 'home';
    }
  }

  const tier: 'A' | 'B' | 'C' =
    finalPick.confidence === 'A'
      ? 'A'
      : finalPick.confidence === 'B'
        ? 'B'
        : 'C';

  return {
    marketType: executionMarket,
    preferredSide,
    tier,
    referenceLine:
      typeof finalPick.line === 'number' && Number.isFinite(finalPick.line)
        ? finalPick.line
        : null
  };
}

function getVisibleMarketReason(
  visibleMarket:
    | ReturnType<typeof chooseBestPick>
    | ReturnType<typeof evaluateMarkets>[number]
): string {
  if ('executionReason' in visibleMarket) {
    return visibleMarket.executionReason;
  }

  if ('reason' in visibleMarket) {
    return visibleMarket.reason;
  }

  return 'Mercado visible para UI';
}

function buildMarketView(
  marketCandidates: ReturnType<typeof evaluateMarkets>,
  finalPick: ReturnType<typeof chooseBestPick>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
) {
  const visibleMarket =
    finalPick.market !== 'PASS'
      ? finalPick
      : marketCandidates[0] ?? null;

  if (!visibleMarket) return null;

  const selection = String(visibleMarket.selection ?? '');
  const normalizedSelection = normalizeEntityName(selection);

  const homeName = normalizeEntityName(engineGame.homeTeam.core.teamName);
  const awayName = normalizeEntityName(engineGame.awayTeam.core.teamName);
  const homeAbbr = normalizeEntityName(engineGame.homeTeam.core.abbreviation);
  const awayAbbr = normalizeEntityName(engineGame.awayTeam.core.abbreviation);

  let direction: 'home' | 'away' | 'over' | 'under' = 'home';

  if (normalizedSelection.includes('under')) {
    direction = 'under';
  } else if (normalizedSelection.includes('over')) {
    direction = 'over';
  } else if (
    normalizedSelection.includes(awayName) ||
    normalizedSelection.includes(awayAbbr)
  ) {
    direction = 'away';
  } else if (
    normalizedSelection.includes(homeName) ||
    normalizedSelection.includes(homeAbbr)
  ) {
    direction = 'home';
  }

  return {
    marketFamily: visibleMarket.market,
    selection,
    direction,
    referenceLine: visibleMarket.line ?? null,
    confidence: visibleMarket.confidence,
    reason: getVisibleMarketReason(visibleMarket)
  };
}

function buildFinalDecision(
  finalPick: ReturnType<typeof chooseBestPick>,
  executionRecommendation: ReturnType<typeof chooseBestExecution> | null
) {
  if (finalPick.market === 'PASS') {
    return {
      status: 'NO_BET',
      reason:
        finalPick.passReason ??
        finalPick.executionReason ??
        'No bet por edge insuficiente'
    };
  }

  if (!executionRecommendation?.recommendedLine) {
    return {
      status: 'NO_BET',
      reason:
        executionRecommendation?.reason ??
        'No hay línea ejecutable'
    };
  }

  return {
    status: 'BET',
    reason: executionRecommendation.reason,
    recommendedLine: executionRecommendation.recommendedLine
  };
}

function findMatchingMarketEvent(
  normalizedLines: ReturnType<typeof normalizeMarketLines>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
) {
  const home = normalizeEntityName(engineGame.homeTeam.core.teamName);
  const away = normalizeEntityName(engineGame.awayTeam.core.teamName);

  return (
    normalizedLines.find((event) => {
      const eventHome = normalizeEntityName(event.homeTeam);
      const eventAway = normalizeEntityName(event.awayTeam);

      return eventHome === home && eventAway === away;
    }) ?? null
  );
}

function percentMove(current: number, opening: number): number {
  if (!opening || !Number.isFinite(opening) || !Number.isFinite(current)) {
    return 0;
  }

  return ((current - opening) / opening) * 100;
}

function moneylineSignalFromOdds(
  homeML?: number,
  awayML?: number
): number {
  if (!homeML || !awayML || homeML <= 1 || awayML <= 1) {
    return 0;
  }

  const homeImp = 1 / homeML;
  const awayImp = 1 / awayML;

  return Math.max(-25, Math.min(25, (homeImp - awayImp) * 100));
}

function buildMarketContextLight(
  snapshotWindow: Awaited<ReturnType<typeof getMarketSnapshotWindow>>,
  currentOdds: ReturnType<typeof mapEventMarketLinesToGameOdds>
) {
  const first = snapshotWindow.first;
  const latest = snapshotWindow.latest;

  const currentHomeML = currentOdds?.homeML ?? null;
  const currentAwayML = currentOdds?.awayML ?? null;

  const openingHomeML =
    first?.home_ml !== null && first?.home_ml !== undefined
      ? Number(first.home_ml)
      : null;

  const openingAwayML =
    first?.away_ml !== null && first?.away_ml !== undefined
      ? Number(first.away_ml)
      : null;

  const latestHomeML =
    latest?.home_ml !== null && latest?.home_ml !== undefined
      ? Number(latest.home_ml)
      : currentHomeML;

  const latestAwayML =
    latest?.away_ml !== null && latest?.away_ml !== undefined
      ? Number(latest.away_ml)
      : currentAwayML;

  const moveHome =
    openingHomeML && latestHomeML
      ? percentMove(latestHomeML, openingHomeML)
      : 0;

  const moveAway =
    openingAwayML && latestAwayML
      ? percentMove(latestAwayML, openingAwayML)
      : 0;

  const lineMovementPct = Math.max(
    -100,
    Math.min(100, moveAway - moveHome)
  );

  const sharpSignal = moneylineSignalFromOdds(
    currentHomeML ?? undefined,
    currentAwayML ?? undefined
  );

  return {
    lineMovementPct,
    ticketSplitPctHome: undefined,
    ticketSplitPctAway: undefined,
    sharpSignal
  };
}

function buildExecutionAdjustedFinalPick(
  finalPick: ReturnType<typeof chooseBestPick>,
  executionRecommendation: ReturnType<typeof chooseBestExecution> | null
): ReturnType<typeof chooseBestPick> {
  const evaluatedRecommendation = executionRecommendation?.recommendedEvaluation;

  if (!evaluatedRecommendation || finalPick.market === 'PASS') {
    return finalPick;
  }

  return {
    ...finalPick,
    market: evaluatedRecommendation.market,
    selection: evaluatedRecommendation.selection,
    line: evaluatedRecommendation.line,
    odds: evaluatedRecommendation.odds,
    estimatedProbability: evaluatedRecommendation.estimatedProbability,
    impliedProbability: evaluatedRecommendation.impliedProbability,
    edge: evaluatedRecommendation.edge,
    ev: evaluatedRecommendation.ev,
    confidence: evaluatedRecommendation.confidence,
    executionReason: evaluatedRecommendation.reason,
    altMarket1: executionRecommendation?.alternativeEvaluation1
      ? serializeAlternativeMarket(executionRecommendation.alternativeEvaluation1) ?? finalPick.altMarket1
      : finalPick.altMarket1,
    altMarket2: executionRecommendation?.alternativeEvaluation2
      ? serializeAlternativeMarket(executionRecommendation.alternativeEvaluation2) ?? finalPick.altMarket2
      : finalPick.altMarket2
  };
}

function normalizeSelectionForTeamMatch(selection: string) {
  return normalizeEntityName(
    selection
      .replace(/[+-]?\d+(?:\.\d+)?/g, ' ')
      .replace(/\bf5\b/gi, ' ')
      .replace(/\bml\b|\brl\b/gi, ' ')
  );
}

function resolveSelectedSide(
  engineGame: ReturnType<typeof mapEspnToEngineGame>,
  selection: string
): 'home' | 'away' | null {
  const normalizedSelection = normalizeSelectionForTeamMatch(selection);

  const homeCandidates = [
    engineGame.homeTeam.core.teamName,
    engineGame.homeTeam.core.abbreviation
  ]
    .filter(Boolean)
    .map((value) => normalizeEntityName(String(value)));
  const awayCandidates = [
    engineGame.awayTeam.core.teamName,
    engineGame.awayTeam.core.abbreviation
  ]
    .filter(Boolean)
    .map((value) => normalizeEntityName(String(value)));

  if (
    homeCandidates.some(
      (candidate) =>
        normalizedSelection === candidate ||
        normalizedSelection.startsWith(`${candidate} `)
    )
  ) {
    return 'home';
  }

  if (
    awayCandidates.some(
      (candidate) =>
        normalizedSelection === candidate ||
        normalizedSelection.startsWith(`${candidate} `)
    )
  ) {
    return 'away';
  }

  return null;
}

function applyAdverseMarketGuard(
  finalPick: ReturnType<typeof chooseBestPick>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>
): ReturnType<typeof chooseBestPick> {
  if (
    finalPick.market === 'PASS' ||
    finalPick.market === 'TOTAL' ||
    /(^|\s)(over|under)(\s|$)/i.test(finalPick.selection)
  ) {
    return finalPick;
  }

  const movement = engineGame.marketContextLight.lineMovementPct;
  const sharp = engineGame.marketContextLight.sharpSignal;

  if (
    typeof movement !== 'number' ||
    !Number.isFinite(movement) ||
    typeof sharp !== 'number' ||
    !Number.isFinite(sharp)
  ) {
    return finalPick;
  }

  const selectedSide = resolveSelectedSide(engineGame, finalPick.selection);
  if (!selectedSide) {
    return finalPick;
  }

  const directionalScore = movement + sharp;
  const marketSide =
    directionalScore > 0 ? 'home' : directionalScore < 0 ? 'away' : null;

  if (!marketSide || marketSide === selectedSide) {
    return finalPick;
  }

  const adverseMove =
    selectedSide === 'home' ? movement <= -6 : movement >= 6;
  const adverseSharp =
    selectedSide === 'home' ? sharp <= -4 : sharp >= 4;

  if (
    !adverseMove ||
    !adverseSharp ||
    Math.abs(directionalScore) < 10
  ) {
    return finalPick;
  }

  const selectedTeam =
    selectedSide === 'home'
      ? engineGame.homeTeam.core.teamName
      : engineGame.awayTeam.core.teamName;
  const marketTeam =
    marketSide === 'home'
      ? engineGame.homeTeam.core.teamName
      : engineGame.awayTeam.core.teamName;
  const reason =
    `No bet: el mercado se movió en contra de ${selectedTeam}. ` +
    `${marketTeam} toma la corriente con movimiento ${movement.toFixed(1)}% ` +
    `y señal sharp ${sharp.toFixed(0)}, así que el side queda sin confirmación suficiente.`;

  return {
    ...finalPick,
    market: 'PASS',
    selection: 'NO BET',
    line: undefined,
    odds: undefined,
    estimatedProbability: undefined,
    impliedProbability: undefined,
    edge: undefined,
    ev: undefined,
    confidence: 'PASS',
    executionReason: reason,
    passReason: reason,
    altMarket1: undefined,
    altMarket2: undefined
  };
}

function nearlyEqual(
  a?: number | null,
  b?: number | null,
  tolerance = 0.0001
): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) <= tolerance;
}

function shouldSaveNewSnapshot(
  latestSnapshot: Awaited<ReturnType<typeof getLatestMarketSnapshot>>,
  currentOdds: ReturnType<typeof mapEventMarketLinesToGameOdds>
): boolean {
  if (!latestSnapshot) return true;

  const createdAtMs = new Date(latestSnapshot.created_at).getTime();
  const nowMs = Date.now();
  const minutesSinceLast = (nowMs - createdAtMs) / (1000 * 60);

  const sameHomeML = nearlyEqual(
    latestSnapshot.home_ml,
    currentOdds?.homeML ?? null
  );
  const sameAwayML = nearlyEqual(
    latestSnapshot.away_ml,
    currentOdds?.awayML ?? null
  );

  const sameHomeRLLine = nearlyEqual(
    latestSnapshot.home_rl_line,
    currentOdds?.homeRL?.line ?? null
  );
  const sameHomeRLOdds = nearlyEqual(
    latestSnapshot.home_rl_odds,
    currentOdds?.homeRL?.odds ?? null
  );

  const sameAwayRLLine = nearlyEqual(
    latestSnapshot.away_rl_line,
    currentOdds?.awayRL?.line ?? null
  );
  const sameAwayRLOdds = nearlyEqual(
    latestSnapshot.away_rl_odds,
    currentOdds?.awayRL?.odds ?? null
  );

  const sameTotalLine = nearlyEqual(
    latestSnapshot.total_line,
    currentOdds?.total?.line ?? null
  );
  const sameOverOdds = nearlyEqual(
    latestSnapshot.over_odds,
    currentOdds?.total?.overOdds ?? null
  );
  const sameUnderOdds = nearlyEqual(
    latestSnapshot.under_odds,
    currentOdds?.total?.underOdds ?? null
  );

  const noMeaningfulChange =
    sameHomeML &&
    sameAwayML &&
    sameHomeRLLine &&
    sameHomeRLOdds &&
    sameAwayRLLine &&
    sameAwayRLOdds &&
    sameTotalLine &&
    sameOverOdds &&
    sameUnderOdds;

  if (minutesSinceLast < 10 && noMeaningfulChange) {
    return false;
  }

  return true;
}

function buildAnalyzePayload(
  espnGame: Awaited<ReturnType<typeof getNormalizedEspnMlbGame>>,
  engineGame: ReturnType<typeof mapEspnToEngineGame>,
  layerA: ReturnType<typeof projectGameScript>,
  marketCandidates: ReturnType<typeof evaluateMarkets>,
  marketView: ReturnType<typeof buildMarketView>,
  finalDecision: ReturnType<typeof buildFinalDecision>,
  finalPick: ReturnType<typeof chooseBestPick>,
  matchingMarketEvent: ReturnType<typeof findMatchingMarketEvent>,
  executionRecommendation: ReturnType<typeof chooseBestExecution> | null
) {
  return {
    ok: true,
    espnGame,
    engineGame,
    blockScores: layerA.blockScores,
    layerA,
    marketCandidates,
    marketView,
    finalDecision,
    finalPick,
    matchingMarketEvent,
    executionRecommendation,

    uiSummary: {
      pregameScore: roundScore(layerA.pregameScore),
      lean: layerA.lean,
      confidence: layerA.confidence,

      marketView: marketView
        ? {
            marketFamily: marketView.marketFamily,
            selection: marketView.selection,
            direction: marketView.direction,
            confidence: marketView.confidence,
            reason: marketView.reason
          }
        : null,

      finalPick:
        finalPick.market !== 'PASS'
          ? {
              market: finalPick.market,
              selection: finalPick.selection,
              confidence: finalPick.confidence,
              probability: roundMetric(finalPick.estimatedProbability),
              edge: roundMetric(finalPick.edge),
              ev: roundMetric(finalPick.ev)
            }
          : {
              market: 'PASS',
              selection: 'NO BET',
              confidence: 'PASS',
              probability: null,
              edge: null,
              ev: null
            },

      execution:
        executionRecommendation?.recommendedLine
          ? {
              status: finalDecision.status,
              selection: executionRecommendation.recommendedLine.selection,
              line: executionRecommendation.recommendedLine.line ?? null,
              odds: roundOdds(executionRecommendation.recommendedLine.odds),
              reason: executionRecommendation.reason
            }
          : {
              status: finalDecision.status,
              selection: null,
              line: null,
              odds: null,
              reason: finalDecision.reason
            }
    },

    resultSummary: {
      status: 'pending',
      result: null,
      profitUnits: null
    }
  };
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildResultSummaryFromPick(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>
) {
  return {
    status: pick?.status ?? 'pending',
    result: pick?.result ?? null,
    profitUnits: roundMetric(pick?.profit_units)
  };
}

function buildConfirmedPickSummary(
  pick: Awaited<ReturnType<typeof getLatestPickForGame>>
) {
  if (!pick) return null;

  return {
    market: pick.execution_market || pick.market,
    selection: pick.execution_selection || pick.selection,
    line:
      typeof pick.execution_line === 'number'
        ? pick.execution_line
        : pick.line,
    odds: roundOdds(pick.execution_odds ?? pick.odds),
    status: pick.status,
    reason: pick.execution_reason || pick.reason
  };
}

function buildAlerts(
  previousPayload: Record<string, unknown> | null,
  currentPayload: Record<string, unknown>
): string[] {
  if (!previousPayload) return [];

  const alerts: string[] = [];

  const previousFinalPick =
    previousPayload.finalPick as Record<string, unknown> | undefined;
  const currentFinalPick =
    currentPayload.finalPick as Record<string, unknown> | undefined;

  const prevMarket = safeString(previousFinalPick?.market);
  const currMarket = safeString(currentFinalPick?.market);

  const prevSelection = safeString(previousFinalPick?.selection);
  const currSelection = safeString(currentFinalPick?.selection);
  const currLine = safeNumber(currentFinalPick?.line);
  const previousDecision =
    previousPayload.finalDecision as Record<string, unknown> | undefined;
  const currentDecision =
    currentPayload.finalDecision as Record<string, unknown> | undefined;
  const currReason = safeString(currentDecision?.reason);
  const wasNoBet =
    safeString(previousDecision?.status) === 'NO_BET' ||
    prevMarket === 'PASS' ||
    prevSelection?.toUpperCase() === 'NO BET';
  const isBetNow =
    safeString(currentDecision?.status) === 'BET' &&
    currMarket !== 'PASS' &&
    currSelection?.toUpperCase() !== 'NO BET';

  const lineSuffix =
    currLine !== null
      ? ` ${currMarket === 'TOTAL' || currSelection?.toLowerCase().startsWith('over') || currSelection?.toLowerCase().startsWith('under') ? currLine.toFixed(1) : `${currLine > 0 ? '+' : ''}${currLine.toFixed(1)}`}`
      : '';

  if (wasNoBet && isBetNow && currMarket && currSelection) {
    alerts.push(
      `Pasó de NO BET a BET: ahora ${currMarket} / ${currSelection}${lineSuffix}. ${currReason ?? 'El edge y la ejecución ya quedaron dentro de rango.'}`
    );
  }

  if (!wasNoBet && !isBetNow && safeString(currentDecision?.status) === 'NO_BET') {
    alerts.push(
      `Pasó de BET a NO BET: ${currReason ?? 'el mercado dejó de respaldar la ejecución.'}`
    );
  }

  if (prevMarket && currMarket && prevMarket !== currMarket) {
    alerts.push(`Cambio de mercado: ${prevMarket} → ${currMarket}`);
  }

  if (prevSelection && currSelection && prevSelection !== currSelection) {
    alerts.push(`Cambio de pick: ${prevSelection} → ${currSelection}`);
  }

  const prevEngineGame =
    previousPayload.engineGame as Record<string, unknown> | undefined;
  const currEngineGame =
    currentPayload.engineGame as Record<string, unknown> | undefined;

  const prevHomeTeam =
    prevEngineGame?.homeTeam as Record<string, unknown> | undefined;
  const prevAwayTeam =
    prevEngineGame?.awayTeam as Record<string, unknown> | undefined;
  const currHomeTeam =
    currEngineGame?.homeTeam as Record<string, unknown> | undefined;
  const currAwayTeam =
    currEngineGame?.awayTeam as Record<string, unknown> | undefined;

  const prevHomeStarter =
    (prevHomeTeam?.starter as Record<string, unknown> | undefined)?.name;
  const currHomeStarter =
    (currHomeTeam?.starter as Record<string, unknown> | undefined)?.name;
  const prevAwayStarter =
    (prevAwayTeam?.starter as Record<string, unknown> | undefined)?.name;
  const currAwayStarter =
    (currAwayTeam?.starter as Record<string, unknown> | undefined)?.name;

  if (
    safeString(prevHomeStarter) &&
    safeString(currHomeStarter) &&
    prevHomeStarter !== currHomeStarter
  ) {
    alerts.push(
      `Starter local cambió: ${safeString(prevHomeStarter)} → ${safeString(currHomeStarter)}`
    );
  }

  if (
    safeString(prevAwayStarter) &&
    safeString(currAwayStarter) &&
    prevAwayStarter !== currAwayStarter
  ) {
    alerts.push(
      `Starter visitante cambió: ${safeString(prevAwayStarter)} → ${safeString(currAwayStarter)}`
    );
  }

  const prevOdds = prevEngineGame?.odds as Record<string, unknown> | undefined;
  const currOdds = currEngineGame?.odds as Record<string, unknown> | undefined;

  const prevHomeML = safeNumber(prevOdds?.homeML);
  const currHomeML = safeNumber(currOdds?.homeML);
  const prevAwayML = safeNumber(prevOdds?.awayML);
  const currAwayML = safeNumber(currOdds?.awayML);

  if (
    prevHomeML &&
    currHomeML &&
    Math.abs(((currHomeML - prevHomeML) / prevHomeML) * 100) >= 8
  ) {
    alerts.push(
      `Movimiento fuerte en ML local: ${prevHomeML.toFixed(2)} → ${currHomeML.toFixed(2)}`
    );
  }

  if (
    prevAwayML &&
    currAwayML &&
    Math.abs(((currAwayML - prevAwayML) / prevAwayML) * 100) >= 8
  ) {
    alerts.push(
      `Movimiento fuerte en ML visitante: ${prevAwayML.toFixed(2)} → ${currAwayML.toFixed(2)}`
    );
  }

  const prevTotal = prevOdds?.total as Record<string, unknown> | undefined;
  const currTotal = currOdds?.total as Record<string, unknown> | undefined;

  const prevTotalLine = safeNumber(prevTotal?.line);
  const currTotalLine = safeNumber(currTotal?.line);

  if (
    prevTotalLine !== null &&
    currTotalLine !== null &&
    prevTotalLine !== currTotalLine
  ) {
    alerts.push(`Cambio en total principal: ${prevTotalLine} → ${currTotalLine}`);
  }

  return alerts;
}

async function saveCurrentPregameLock(
  gameId: string,
  espnGame: Awaited<ReturnType<typeof getNormalizedEspnMlbGame>>,
  payload: Record<string, unknown>
) {
  const existing = await getPregameSnapshotsForGame(gameId);

  const previousPayload =
    (existing.mid?.payload as Record<string, unknown> | null) ??
    (existing.open?.payload as Record<string, unknown> | null) ??
    null;

  const alerts = buildAlerts(previousPayload, payload);

  const stage: SnapshotStage =
    existing.open === null ? 'open' : 'mid';

  const snapshot = await savePregameSnapshot({
    gameId,
    snapshotStage: stage,
    sport: 'MLB',
    gameStatus: espnGame.status ?? null,
    startTime: espnGame.date ?? null,
    payload,
    alerts
  });

  return {
    snapshot,
    alerts,
    stage
  };
}

async function getOrCreateFinalLockedSnapshot(
  gameId: string,
  espnGame: Awaited<ReturnType<typeof getNormalizedEspnMlbGame>>
): Promise<PregameSnapshotRow | null> {
  const existing = await getPregameSnapshotsForGame(gameId);

  if (existing.final) {
    return existing.final;
  }

  const source = existing.mid ?? existing.open ?? null;
  if (!source) return null;

  const finalSnapshot = await savePregameSnapshot({
    gameId,
    snapshotStage: 'final',
    sport: 'MLB',
    gameStatus: espnGame.status ?? null,
    startTime: espnGame.date ?? null,
    payload: source.payload,
    alerts: source.alerts
  });

  return finalSnapshot;
}

export async function GET(req: NextRequest) {
  try {
    const gameId = req.nextUrl.searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json(
        { ok: false, error: 'Missing gameId' },
        { status: 400 }
      );
    }

    const espnGame = await getNormalizedEspnMlbGame(gameId);

    if (isGameStarted(espnGame.status, espnGame.date)) {
      const finalSnapshot = await getOrCreateFinalLockedSnapshot(
        gameId,
        espnGame
      );

      if (!finalSnapshot) {
        return NextResponse.json(
          {
            ok: false,
            error: 'El juego ya empezó y no existe snapshot pregame previo para congelar'
          },
          { status: 409 }
        );
      }

      const frozenPayload =
        typeof finalSnapshot.payload === 'object' &&
        finalSnapshot.payload !== null
          ? finalSnapshot.payload
          : {};
      const latestPick = await getLatestPickForGame(gameId);
      const settledPick =
        latestPick?.status === 'pending'
          ? await autoSettlePick(latestPick)
          : latestPick;

      return NextResponse.json({
        ...frozenPayload,
        ok: true,
        frozenPregame: true,
        statsFetchWarning: null,
        oddsFetchWarning: null,
        oddsCacheUpdatedAt: null,
        oddsRefreshUsed: false,
        confirmedPick: buildConfirmedPickSummary(settledPick ?? latestPick),
        resultSummary: buildResultSummaryFromPick(settledPick ?? latestPick),
        pickLock: {
          snapshotId: finalSnapshot.id,
          stage: 'FINAL',
          lastUpdatedAt: finalSnapshot.updated_at,
          alerts: finalSnapshot.alerts ?? []
        }
      });
    }

    let engineGame = mapEspnToEngineGame(espnGame);
    let statsFetchWarning: string | null = null;

    try {
      engineGame = await enrichEngineGameWithMlbStats(
        engineGame,
        espnGame
      );
    } catch (error) {
      statsFetchWarning =
        error instanceof Error ? error.message : 'Unknown MLB stats error';
    }

    let matchingMarketEvent: ReturnType<typeof findMatchingMarketEvent> = null;
    let oddsFetchWarning: string | null = null;
    let oddsCacheUpdatedAt: string | null = null;
    let oddsRefreshUsed = false;
    let latestStoredMarket: Awaited<ReturnType<typeof getLatestMarketSnapshot>> = null;

    try {
      const autoOdds = await getNormalizedMarketLinesAuto();

      oddsFetchWarning = autoOdds.oddsFetchWarning;
      oddsCacheUpdatedAt = autoOdds.oddsCacheUpdatedAt;
      oddsRefreshUsed = autoOdds.oddsRefreshUsed;

      matchingMarketEvent = findMatchingMarketEvent(
        autoOdds.normalizedLines,
        engineGame
      );

      engineGame.odds = mapEventMarketLinesToGameOdds(matchingMarketEvent);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown odds error';

      oddsFetchWarning = message;
    }

    if (!engineGame.odds) {
      try {
        latestStoredMarket = await getLatestMarketSnapshot(gameId);

        if (latestStoredMarket) {
          engineGame.odds = {
            homeML: latestStoredMarket.home_ml ?? undefined,
            awayML: latestStoredMarket.away_ml ?? undefined,
            homeRL:
              latestStoredMarket.home_rl_line !== null &&
              latestStoredMarket.home_rl_odds !== null
                ? {
                    line: Number(latestStoredMarket.home_rl_line),
                    odds: Number(latestStoredMarket.home_rl_odds)
                  }
                : undefined,
            awayRL:
              latestStoredMarket.away_rl_line !== null &&
              latestStoredMarket.away_rl_odds !== null
                ? {
                    line: Number(latestStoredMarket.away_rl_line),
                    odds: Number(latestStoredMarket.away_rl_odds)
                  }
                : undefined,
            total:
              latestStoredMarket.total_line !== null &&
              latestStoredMarket.over_odds !== null &&
              latestStoredMarket.under_odds !== null
                ? {
                    line: Number(latestStoredMarket.total_line),
                    overOdds: Number(latestStoredMarket.over_odds),
                    underOdds: Number(latestStoredMarket.under_odds)
                  }
                : undefined
          };
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase market snapshot error';

        oddsFetchWarning = oddsFetchWarning ?? message;
      }
    }

    if (matchingMarketEvent) {
      if (!latestStoredMarket) {
        try {
          latestStoredMarket = await getLatestMarketSnapshot(gameId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown Supabase market snapshot error';

          oddsFetchWarning = oddsFetchWarning ?? message;
        }
      }

      try {
        if (shouldSaveNewSnapshot(latestStoredMarket, engineGame.odds)) {
          await saveMarketSnapshot({
            gameId,
            eventId: matchingMarketEvent.eventId,
            homeTeam: matchingMarketEvent.homeTeam,
            awayTeam: matchingMarketEvent.awayTeam,

            homeML: engineGame.odds?.homeML ?? null,
            awayML: engineGame.odds?.awayML ?? null,

            homeRLLine: engineGame.odds?.homeRL?.line ?? null,
            homeRLOdds: engineGame.odds?.homeRL?.odds ?? null,
            awayRLLine: engineGame.odds?.awayRL?.line ?? null,
            awayRLOdds: engineGame.odds?.awayRL?.odds ?? null,

            totalLine: engineGame.odds?.total?.line ?? null,
            overOdds: engineGame.odds?.total?.overOdds ?? null,
            underOdds: engineGame.odds?.total?.underOdds ?? null
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase market save error';

        oddsFetchWarning = oddsFetchWarning ?? message;
      }

      try {
        const snapshotWindow = await getMarketSnapshotWindow(gameId);

        engineGame.marketContextLight = buildMarketContextLight(
          snapshotWindow,
          engineGame.odds
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown Supabase market context error';

        oddsFetchWarning = oddsFetchWarning ?? message;
      }
    }

    const layerA = projectGameScript(engineGame);
    const marketCandidates = evaluateMarkets(engineGame, layerA);
    const finalPick = chooseBestPick(engineGame, layerA);

    const executionInput = mapFinalPickToExecutionInput(
      finalPick,
      engineGame
    );

    const executionRecommendation =
      matchingMarketEvent && executionInput
        ? chooseBestExecution(
            matchingMarketEvent,
            executionInput.marketType,
            executionInput.preferredSide,
            executionInput.tier,
            engineGame,
            layerA,
            executionInput.referenceLine
          )
        : null;

    const resolvedFinalPick = buildExecutionAdjustedFinalPick(
      finalPick,
      executionRecommendation
    );
    const guardedFinalPick = applyAdverseMarketGuard(
      resolvedFinalPick,
      engineGame
    );
    const effectiveExecutionRecommendation =
      guardedFinalPick.market === 'PASS'
        ? null
        : executionRecommendation;

    const marketView = buildMarketView(
      marketCandidates,
      guardedFinalPick,
      engineGame
    );

    const finalDecision = buildFinalDecision(
      guardedFinalPick,
      effectiveExecutionRecommendation
    );

    const payload = buildAnalyzePayload(
      espnGame,
      engineGame,
      layerA,
      marketCandidates,
      marketView,
      finalDecision,
      guardedFinalPick,
      matchingMarketEvent,
      effectiveExecutionRecommendation
    );

    let saved: Awaited<ReturnType<typeof saveCurrentPregameLock>> | null = null;

    try {
      saved = await saveCurrentPregameLock(
        gameId,
        espnGame,
        payload
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Supabase pregame snapshot error';

      statsFetchWarning = statsFetchWarning ?? message;
    }

    let latestPick: Awaited<ReturnType<typeof getLatestPickForGame>> = null;

    try {
      latestPick = await getLatestPickForGame(gameId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Supabase pick lookup error';

      statsFetchWarning = statsFetchWarning ?? message;
    }

    return NextResponse.json({
      ...payload,
      frozenPregame: false,
      statsFetchWarning,
      oddsFetchWarning,
      oddsCacheUpdatedAt,
      oddsRefreshUsed,
      confirmedPick: buildConfirmedPickSummary(latestPick),
      resultSummary: buildResultSummaryFromPick(latestPick),
      pickLock: {
        snapshotId: saved?.snapshot.id ?? null,
        stage: saved?.stage.toUpperCase() ?? 'UNSAVED',
        lastUpdatedAt: saved?.snapshot.updated_at ?? new Date().toISOString(),
        alerts: saved?.alerts ?? []
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
