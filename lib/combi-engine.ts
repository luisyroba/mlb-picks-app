import type { CombiBasePickRow } from './db';

export const COMBI_MIN_LEG_ODDS = 1.25;
export const COMBI_MAX_LEG_ODDS = 1.45;
export const COMBI_MIN_TOTAL_ODDS = 1.65;
export const COMBI_MAX_TOTAL_ODDS = 1.85;
export const COMBI_IDEAL_TOTAL_ODDS =
  (COMBI_MIN_TOTAL_ODDS + COMBI_MAX_TOTAL_ODDS) / 2;

export type CombiMarket = 'ML' | 'RL' | 'TOTAL' | 'F5';

export type CombiCandidate = {
  id: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  market: CombiMarket;
  selection: string;
  line: number | null;
  apiOdds: number;
  confidence: 'A' | 'B' | 'C';
  selectionScore: number | null;
  estimatedProbability: number | null;
  basePickId: string;
  basePickMarket: string;
  basePickSelection: string;
  basePickLine: number | null;
  altType: string;
  conservativeDelta: number;
  source: 'snapshot_event' | 'odds_board';
};

export type CombiPair = {
  leg1: CombiCandidate;
  leg2: CombiCandidate;
  combinedApiOdds: number;
  combiScore: number;
  inTargetRange: boolean;
};

export type ReplacementCandidate = {
  candidate: CombiCandidate;
  combinedOdds: number;
  inTargetRange: boolean;
  targetDistance: number;
  marketReliability: number;
  baseStrength: number;
  extremeLinePenalty: number;
  score: number;
};

type RawMarketLine = {
  marketType?: unknown;
  selection?: unknown;
  line?: unknown;
  odds?: unknown;
  side?: unknown;
  origin?: unknown;
};

export type GameLinesContext = {
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  lines: RawMarketLine[];
  source: 'snapshot_event' | 'odds_board';
};

type PairRanking = {
  valid: boolean;
  combinedOdds: number;
  inTargetRange: boolean;
  targetDistance: number;
  marketReliability: number;
  baseStrength: number;
  extremeLinePenalty: number;
  score: number;
};

type RejectionStats = {
  invalidLinesRejected: number;
  extremeLinesRejected: number;
  integerLinesRejected: number;
};

type PickAltTrace = {
  pickId: string;
  gameId: string;
  market: string;
  selection: string;
  line: number | null;
  altsCount: number;
  alts: Array<{
    candidateId: string;
    market: string;
    selection: string;
    line: number | null;
    odds: number;
    altType: string;
    source: string;
    deltaVsBase: number;
  }>;
  rejectReason: string | null;
};

export type CombiDiagnostics = {
  basePicksFound: number;
  gamesWithOddsFound: number;
  alternativesGeneratedFromBoard: number;
  alternativesPoolCount: number;
  alternativesByPick: PickAltTrace[];
  rejectedBecauseNoBoard: number;
  rejectedBecauseNoConservativeAlt: number;
  invalidLinesRejected: number;
  extremeLinesRejected: number;
  integerLinesRejected: number;
  finalAlternativesCount: number;
  finalCandidates: number;
  candidatePairsCount: number;
  pairsGenerated: number;
  pairsRejectedByStructure: number;
  bestPairBeforeManualEdit: {
    leg1: {
      candidateId: string;
      gameId: string;
      market: string;
      selection: string;
      line: number | null;
      apiOdds: number;
    };
    leg2: {
      candidateId: string;
      gameId: string;
      market: string;
      selection: string;
      line: number | null;
      apiOdds: number;
    };
    combinedApiOdds: number;
    combiScore: number;
    inTargetRange: boolean;
  } | null;
  selectedPair: {
    leg1: {
      candidateId: string;
      gameId: string;
      market: string;
      selection: string;
      line: number | null;
      apiOdds: number;
    };
    leg2: {
      candidateId: string;
      gameId: string;
      market: string;
      selection: string;
      line: number | null;
      apiOdds: number;
    };
    combinedApiOdds: number;
    combiScore: number;
    inTargetRange: boolean;
  } | null;
};

function isCombiMarket(value: unknown): value is CombiMarket {
  return value === 'ML' || value === 'RL' || value === 'TOTAL' || value === 'F5';
}

function safeNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isHalfPointLine(value: number | null): boolean {
  if (value === null) return true;
  const doubled = value * 2;
  return Number.isInteger(doubled) && Math.abs(doubled % 2) === 1;
}

function isAllowedProtectionLine(value: number | null): boolean {
  return value === 1.5 || value === 2.5;
}

function selectionMatchesSide(
  selection: string,
  teamName: string,
  abbr: string
): boolean {
  const selNorm = selection.toLowerCase();
  if (abbr && selNorm.includes(abbr.toLowerCase())) return true;
  return teamName
    .toLowerCase()
    .split(/\s+/)
    .some((token) => token.length > 3 && selNorm.includes(token));
}

function getMarketReliabilityScore(market: CombiMarket): number {
  if (market === 'TOTAL') return 1.0;
  if (market === 'ML') return 0.97;
  if (market === 'F5') return 0.88;
  if (market === 'RL') return 0.84;
  return 0.8;
}

function buildCandidateId(
  pick: CombiBasePickRow,
  market: CombiMarket,
  selection: string,
  line: number | null
): string {
  return [
    pick.id,
    pick.game_id,
    market,
    selection.trim().toLowerCase(),
    line === null ? 'null' : line.toFixed(2)
  ].join('|');
}

function getConservativeDelta(
  baseLine: number | null,
  candidateLine: number | null
): number {
  if (candidateLine === null || baseLine === null) return 0;
  return Number(Math.abs(candidateLine - baseLine).toFixed(2));
}

function buildCandidate(
  pick: CombiBasePickRow,
  ctx: GameLinesContext,
  market: CombiMarket,
  selection: string,
  line: number | null,
  apiOdds: number,
  altType: string
): CombiCandidate {
  const confidence =
    pick.confidence === 'A' || pick.confidence === 'B' || pick.confidence === 'C'
      ? pick.confidence
      : 'C';

  return {
    id: buildCandidateId(pick, market, selection, line),
    gameId: pick.game_id,
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    market,
    selection,
    line,
    apiOdds,
    confidence,
    selectionScore:
      pick.estimated_probability !== null && pick.estimated_probability !== undefined
        ? Math.round(pick.estimated_probability * 100)
        : null,
    estimatedProbability: pick.estimated_probability ?? null,
    basePickId: pick.id,
    basePickMarket: pick.market,
    basePickSelection: pick.selection,
    basePickLine: pick.line,
    altType,
    conservativeDelta: getConservativeDelta(pick.line, line),
    source: ctx.source
  };
}

function pushRejection(stats: RejectionStats, kind: keyof RejectionStats) {
  stats[kind] += 1;
}

function findAlternativesForPick(
  pick: CombiBasePickRow,
  ctx: GameLinesContext,
  stats: RejectionStats
): CombiCandidate[] {
  const market = String(pick.market ?? '').toUpperCase();
  if (!isCombiMarket(market)) return [];

  const selLower = pick.selection.toLowerCase();
  const isOver = selLower.includes('over');
  const isUnder = selLower.includes('under');
  const isTotalDirection = isOver || isUnder;
  const maxRunDistance = market === 'F5' ? 2 : 3;

  const pickSide: 'home' | 'away' | null = isTotalDirection
    ? null
    : selectionMatchesSide(pick.selection, ctx.homeTeam, ctx.homeAbbr)
      ? 'home'
      : selectionMatchesSide(pick.selection, ctx.awayTeam, ctx.awayAbbr)
        ? 'away'
        : null;

  if (!isTotalDirection && pickSide === null) return [];

  const results: CombiCandidate[] = [];

  for (const raw of ctx.lines) {
    const lineMarket = String(raw.marketType ?? '').toUpperCase();
    const lineSide = String(raw.side ?? '').toLowerCase();
    const lineValue = safeNum(raw.line);
    const lineOdds = safeNum(raw.odds);
    const lineSelection = String(raw.selection ?? '').trim();

    if (lineOdds === null || lineOdds <= 1 || !isCombiMarket(lineMarket)) continue;

    if (!isHalfPointLine(lineValue)) {
      pushRejection(stats, 'integerLinesRejected');
      continue;
    }

    if (isTotalDirection) {
      if (lineMarket !== market) continue;
      if (isOver && lineSide !== 'over') continue;
      if (isUnder && lineSide !== 'under') continue;
      if (pick.line === null || lineValue === null) {
        pushRejection(stats, 'invalidLinesRejected');
        continue;
      }

      if (isOver && lineValue >= pick.line) {
        pushRejection(stats, 'invalidLinesRejected');
        continue;
      }

      if (isUnder && lineValue <= pick.line) {
        pushRejection(stats, 'invalidLinesRejected');
        continue;
      }

      const diff = Number(Math.abs(lineValue - pick.line).toFixed(2));
      if (diff < 0.5) {
        pushRejection(stats, 'invalidLinesRejected');
        continue;
      }

      if (diff > maxRunDistance) {
        pushRejection(stats, 'extremeLinesRejected');
        continue;
      }

      results.push(
        buildCandidate(
          pick,
          ctx,
          lineMarket,
          lineSelection || (isOver ? 'Over' : 'Under'),
          lineValue,
          lineOdds,
          `${market.toLowerCase()}-${isOver ? 'over' : 'under'}-${lineValue}`
        )
      );
      continue;
    }

    if (lineSide !== pickSide) {
      pushRejection(stats, 'invalidLinesRejected');
      continue;
    }

    const teamFallback = pickSide === 'home' ? ctx.homeTeam : ctx.awayTeam;

    if (market === 'ML') {
      if (lineMarket === 'ML' && lineValue === null) {
        results.push(
          buildCandidate(pick, ctx, 'ML', lineSelection || teamFallback, null, lineOdds, 'ml-direct')
        );
        continue;
      }

      if (lineMarket === 'RL') {
        if (!isAllowedProtectionLine(lineValue)) {
          pushRejection(stats, 'invalidLinesRejected');
          continue;
        }

        results.push(
          buildCandidate(
            pick,
            ctx,
            'RL',
            lineSelection || teamFallback,
            lineValue,
            lineOdds,
            `rl+${lineValue}`
          )
        );
      }
      continue;
    }

    if (market === 'RL') {
      if (lineMarket === 'ML' && lineValue === null) {
        results.push(
          buildCandidate(pick, ctx, 'ML', lineSelection || teamFallback, null, lineOdds, 'ml-from-rl')
        );
        continue;
      }

      if (lineMarket === 'RL') {
        if (!isAllowedProtectionLine(lineValue)) {
          pushRejection(stats, 'invalidLinesRejected');
          continue;
        }

        if (pick.line !== null && lineValue !== null && lineValue <= pick.line) {
          pushRejection(stats, 'invalidLinesRejected');
          continue;
        }

        results.push(
          buildCandidate(
            pick,
            ctx,
            'RL',
            lineSelection || teamFallback,
            lineValue,
            lineOdds,
            `rl+${lineValue}`
          )
        );
      }
      continue;
    }

    if (market === 'F5') {
      if (lineMarket !== 'F5') continue;

      if (lineValue !== null) {
        if (!isAllowedProtectionLine(lineValue)) {
          pushRejection(stats, 'invalidLinesRejected');
          continue;
        }
      }

      results.push(
        buildCandidate(
          pick,
          ctx,
          'F5',
          lineSelection || teamFallback,
          lineValue,
          lineOdds,
          lineValue === null ? 'f5-direct' : `f5+${lineValue}`
        )
      );
    }
  }

  return results;
}

function dedupeCandidates(candidates: CombiCandidate[]): CombiCandidate[] {
  const bestByKey = new Map<string, CombiCandidate>();

  for (const candidate of candidates) {
    const key = [
      candidate.gameId,
      candidate.market,
      candidate.selection.trim().toLowerCase(),
      candidate.line === null ? 'null' : candidate.line.toFixed(2)
    ].join('|');
    const current = bestByKey.get(key);
    if (!current || candidate.apiOdds > current.apiOdds) {
      bestByKey.set(key, candidate);
    }
  }

  return [...bestByKey.values()];
}

function rankPair(
  leg1: CombiCandidate,
  leg2: CombiCandidate,
  odds1 = leg1.apiOdds,
  odds2 = leg2.apiOdds
): PairRanking {
  if (leg1.gameId === leg2.gameId || (leg1.market === 'F5' && leg2.market === 'F5')) {
    return {
      valid: false,
      combinedOdds: 0,
      inTargetRange: false,
      targetDistance: Number.POSITIVE_INFINITY,
      marketReliability: 0,
      baseStrength: 0,
      extremeLinePenalty: Number.POSITIVE_INFINITY,
      score: -Infinity
    };
  }

  if (leg1.market === 'RL' && leg2.market === 'RL') {
    return {
      valid: false,
      combinedOdds: 0,
      inTargetRange: false,
      targetDistance: Number.POSITIVE_INFINITY,
      marketReliability: 0,
      baseStrength: 0,
      extremeLinePenalty: Number.POSITIVE_INFINITY,
      score: -Infinity
    };
  }

  const combinedOdds = Number((odds1 * odds2).toFixed(3));
  const inTargetRange =
    combinedOdds >= COMBI_MIN_TOTAL_ODDS && combinedOdds <= COMBI_MAX_TOTAL_ODDS;
  const targetDistance = Math.abs(combinedOdds - COMBI_IDEAL_TOTAL_ODDS);
  const marketReliability =
    (getMarketReliabilityScore(leg1.market) + getMarketReliabilityScore(leg2.market)) / 2;
  const baseStrength = ((leg1.selectionScore ?? 45) + (leg2.selectionScore ?? 45)) / 2;
  const extremeLinePenalty = (leg1.conservativeDelta + leg2.conservativeDelta) * 0.08;
  const sameMarketPenalty = leg1.market === leg2.market ? 0.06 : 0;
  const totalMlBonus =
    (leg1.market === 'TOTAL' && leg2.market === 'ML') ||
    (leg1.market === 'ML' && leg2.market === 'TOTAL')
      ? 0.04
      : 0;

  const score =
    (inTargetRange ? 10 : 0) -
    targetDistance * 3.5 +
    marketReliability +
    baseStrength / 100 +
    totalMlBonus -
    sameMarketPenalty -
    extremeLinePenalty;

  return {
    valid: true,
    combinedOdds,
    inTargetRange,
    targetDistance,
    marketReliability,
    baseStrength,
    extremeLinePenalty,
    score: Number(score.toFixed(4))
  };
}

function comparePairRanking(a: PairRanking, b: PairRanking): number {
  if (a.inTargetRange !== b.inTargetRange) return a.inTargetRange ? -1 : 1;
  if (a.targetDistance !== b.targetDistance) return a.targetDistance - b.targetDistance;
  if (a.marketReliability !== b.marketReliability) return b.marketReliability - a.marketReliability;
  if (a.baseStrength !== b.baseStrength) return b.baseStrength - a.baseStrength;
  if (a.extremeLinePenalty !== b.extremeLinePenalty) {
    return a.extremeLinePenalty - b.extremeLinePenalty;
  }
  return b.score - a.score;
}

function toReplacementCandidate(
  fixedLeg: CombiCandidate,
  candidate: CombiCandidate,
  fixedOdds: number
): ReplacementCandidate {
  const ranking = rankPair(fixedLeg, candidate, fixedOdds, candidate.apiOdds);
  return {
    candidate,
    combinedOdds: ranking.combinedOdds,
    inTargetRange: ranking.inTargetRange,
    targetDistance: ranking.targetDistance,
    marketReliability: ranking.marketReliability,
    baseStrength: ranking.baseStrength,
    extremeLinePenalty: ranking.extremeLinePenalty,
    score: ranking.score
  };
}

function serializePair(best: CombiPair | null) {
  if (!best) return null;
  return {
    leg1: {
      candidateId: best.leg1.id,
      gameId: best.leg1.gameId,
      market: best.leg1.market,
      selection: best.leg1.selection,
      line: best.leg1.line,
      apiOdds: best.leg1.apiOdds
    },
    leg2: {
      candidateId: best.leg2.id,
      gameId: best.leg2.gameId,
      market: best.leg2.market,
      selection: best.leg2.selection,
      line: best.leg2.line,
      apiOdds: best.leg2.apiOdds
    },
    combinedApiOdds: best.combinedApiOdds,
    combiScore: best.combiScore,
    inTargetRange: best.inTargetRange
  };
}

export function buildCombiAlternativesPool(
  basePicks: CombiBasePickRow[],
  contextMap: Map<string, GameLinesContext>
): CombiCandidate[] {
  const pool: CombiCandidate[] = [];
  const stats: RejectionStats = {
    invalidLinesRejected: 0,
    extremeLinesRejected: 0,
    integerLinesRejected: 0
  };

  for (const pick of basePicks) {
    const ctx = contextMap.get(pick.game_id);
    if (!ctx) continue;
    pool.push(...findAlternativesForPick(pick, ctx, stats));
  }

  return dedupeCandidates(pool);
}

export function buildCombiCandidatesFromPicks(
  basePicks: CombiBasePickRow[],
  contextMap: Map<string, GameLinesContext>
): CombiCandidate[] {
  return buildCombiAlternativesPool(basePicks, contextMap);
}

export function generateCombiFromCandidates(
  candidates: CombiCandidate[]
): CombiPair | null {
  if (candidates.length < 2) return null;

  let bestPair: CombiPair | null = null;
  let bestRanking: PairRanking | null = null;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const ranking = rankPair(candidates[i], candidates[j]);
      if (!ranking.valid) continue;

      if (!bestRanking || comparePairRanking(ranking, bestRanking) < 0) {
        bestRanking = ranking;
        bestPair = {
          leg1: candidates[i],
          leg2: candidates[j],
          combinedApiOdds: ranking.combinedOdds,
          combiScore: ranking.score,
          inTargetRange: ranking.inTargetRange
        };
      }
    }
  }

  return bestPair;
}

export function findReplacementCandidates(
  fixedLeg: CombiCandidate,
  pool: CombiCandidate[],
  fixedOdds: number
): ReplacementCandidate[] {
  return pool
    .filter((candidate) => candidate.id !== fixedLeg.id)
    .filter((candidate) => candidate.gameId !== fixedLeg.gameId)
    .map((candidate) => toReplacementCandidate(fixedLeg, candidate, fixedOdds))
    .filter((candidate) => Number.isFinite(candidate.combinedOdds))
    .sort((left, right) =>
      comparePairRanking(
        {
          valid: true,
          combinedOdds: left.combinedOdds,
          inTargetRange: left.inTargetRange,
          targetDistance: left.targetDistance,
          marketReliability: left.marketReliability,
          baseStrength: left.baseStrength,
          extremeLinePenalty: left.extremeLinePenalty,
          score: left.score
        },
        {
          valid: true,
          combinedOdds: right.combinedOdds,
          inTargetRange: right.inTargetRange,
          targetDistance: right.targetDistance,
          marketReliability: right.marketReliability,
          baseStrength: right.baseStrength,
          extremeLinePenalty: right.extremeLinePenalty,
          score: right.score
        }
      )
    );
}

export function buildCombiDiagnostics(
  basePicks: CombiBasePickRow[],
  contextMap: Map<string, GameLinesContext>
): { candidates: CombiCandidate[]; diagnostics: CombiDiagnostics } {
  const gamesWithOddsFound = contextMap.size;
  let alternativesGeneratedFromBoard = 0;
  let rejectedBecauseNoBoard = 0;
  let rejectedBecauseNoConservativeAlt = 0;
  const alternativesByPick: PickAltTrace[] = [];
  const rawCandidates: CombiCandidate[] = [];
  const rejectionStats: RejectionStats = {
    invalidLinesRejected: 0,
    extremeLinesRejected: 0,
    integerLinesRejected: 0
  };

  for (const pick of basePicks) {
    const ctx = contextMap.get(pick.game_id);

    if (!ctx) {
      rejectedBecauseNoBoard++;
      alternativesByPick.push({
        pickId: pick.id,
        gameId: pick.game_id,
        market: pick.market,
        selection: pick.selection,
        line: pick.line,
        altsCount: 0,
        alts: [],
        rejectReason: 'no odds context for game_id'
      });
      continue;
    }

    const alts = findAlternativesForPick(pick, ctx, rejectionStats);
    if (alts.length === 0) rejectedBecauseNoConservativeAlt++;

    alternativesByPick.push({
      pickId: pick.id,
      gameId: pick.game_id,
      market: pick.market,
      selection: pick.selection,
      line: pick.line,
      altsCount: alts.length,
      alts: alts.map((alt) => ({
        candidateId: alt.id,
        market: alt.market,
        selection: alt.selection,
        line: alt.line,
        odds: alt.apiOdds,
        altType: alt.altType,
        source: alt.source,
        deltaVsBase: alt.conservativeDelta
      })),
      rejectReason: alts.length === 0 ? 'no conservative alternatives found' : null
    });

    alternativesGeneratedFromBoard += alts.length;
    rawCandidates.push(...alts);
  }

  const candidates = dedupeCandidates(rawCandidates);
  let pairsGenerated = 0;
  let pairsRejectedByStructure = 0;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const ranking = rankPair(candidates[i], candidates[j]);
      if (!ranking.valid) pairsRejectedByStructure++;
      else pairsGenerated++;
    }
  }

  const best = generateCombiFromCandidates(candidates);

  return {
    candidates,
    diagnostics: {
      basePicksFound: basePicks.length,
      gamesWithOddsFound,
      alternativesGeneratedFromBoard,
      alternativesPoolCount: candidates.length,
      alternativesByPick,
      rejectedBecauseNoBoard,
      rejectedBecauseNoConservativeAlt,
      invalidLinesRejected: rejectionStats.invalidLinesRejected,
      extremeLinesRejected: rejectionStats.extremeLinesRejected,
      integerLinesRejected: rejectionStats.integerLinesRejected,
      finalAlternativesCount: candidates.length,
      finalCandidates: candidates.length,
      candidatePairsCount: pairsGenerated,
      pairsGenerated,
      pairsRejectedByStructure,
      bestPairBeforeManualEdit: serializePair(best),
      selectedPair: serializePair(best)
    }
  };
}
