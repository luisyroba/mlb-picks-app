import {
  FinalPickDecision,
  LayerAOutput,
  MarketEvaluation,
  NormalizedGameData,
  WeightProfileName
} from './types';
import { evaluateMarkets } from './evaluate-markets';
import { serializeAlternativeMarket } from './pick-alternatives';
import { recalculatePregameScore } from './score-game';

const LOW_CONFIDENCE_EDGE_MIN = 0.03;
const LOW_CONFIDENCE_EV_MIN = 0.01;
type RecalculatedCandidateResult = {
  confirmedCandidate: MarketEvaluation;
  viableAlternatives: MarketEvaluation[];
  fullDebug: NonNullable<FinalPickDecision['debug']>;
};

function getProfileFromMarket(
  market: string
): WeightProfileName {
  if (market === 'F5') return 'F5_SIDE';
  if (market === 'TOTAL') return 'TOTAL_MARKET';
  return 'FULL_GAME_SIDE';
}

function buildPassDecision(
  reason: string,
  debug?: FinalPickDecision['debug']
): FinalPickDecision {
  return {
    market: 'PASS',
    selection: 'NO BET',
    confidence: 'PASS',
    executionReason: reason,
    passReason: reason,
    debug
  };
}

function toFinalPick(
  best: MarketEvaluation,
  alternatives: MarketEvaluation[],
  debug?: FinalPickDecision['debug']
): FinalPickDecision {
  return {
    market: best.market,
    selection: best.selection,
    line: best.line,
    odds: best.odds,

    estimatedProbability: best.estimatedProbability,
    impliedProbability: best.impliedProbability,
    edge: best.edge,
    ev: best.ev,
    selectionScore: best.selectionScore,

    confidence: best.confidence,
    executionReason: best.reason,

    altMarket1: alternatives[0]
      ? serializeAlternativeMarket(alternatives[0]) ?? undefined
      : undefined,

    altMarket2: alternatives[1]
      ? serializeAlternativeMarket(alternatives[1]) ?? undefined
      : undefined,

    debug
  };
}

function isCandidateViable(candidate: MarketEvaluation): boolean {
  if (candidate.edge <= 0 || candidate.ev <= 0) {
    return false;
  }

  if (candidate.confidence === 'A') {
    return candidate.edge >= 0.1 && candidate.ev >= 0.04;
  }

  if (candidate.confidence === 'B') {
    return candidate.edge >= 0.06 && candidate.ev >= 0.015;
  }

  return (
    candidate.edge >= LOW_CONFIDENCE_EDGE_MIN &&
    candidate.ev >= LOW_CONFIDENCE_EV_MIN
  );
}

function isSameCandidate(
  left: MarketEvaluation,
  right: MarketEvaluation
): boolean {
  return (
    left.market === right.market &&
    left.selection === right.selection &&
    (left.line ?? null) === (right.line ?? null)
  );
}

function getAlternativeDiversityScore(
  primary: MarketEvaluation,
  candidate: MarketEvaluation
): number {
  if (candidate.market !== primary.market) {
    return 3;
  }

  if (
    typeof primary.line === 'number' &&
    typeof candidate.line === 'number' &&
    Math.abs(primary.line - candidate.line) >= 1
  ) {
    return 2;
  }

  if (
    typeof primary.line === 'number' &&
    typeof candidate.line === 'number' &&
    Math.abs(primary.line - candidate.line) >= 0.5
  ) {
    return 1;
  }

  return 0;
}

function rankAlternativeCandidates(
  primary: MarketEvaluation,
  candidates: MarketEvaluation[]
): MarketEvaluation[] {
  return [...candidates].sort((left, right) => {
    const diversityGap =
      getAlternativeDiversityScore(primary, right) -
      getAlternativeDiversityScore(primary, left);

    if (diversityGap !== 0) {
      return diversityGap;
    }

    const scoreGap =
      (right.selectionScore ?? right.ev) - (left.selectionScore ?? left.ev);

    if (scoreGap !== 0) {
      return scoreGap;
    }

    if (right.edge !== left.edge) {
      return right.edge - left.edge;
    }

    if (right.ev !== left.ev) {
      return right.ev - left.ev;
    }

    return right.estimatedProbability - left.estimatedProbability;
  });
}

export function chooseBestPick(
  game: NormalizedGameData,
  layerA: LayerAOutput
): FinalPickDecision {
  const initialCandidates = evaluateMarkets(game, layerA);

  const baseDebug: FinalPickDecision['debug'] = {
    initialProfileUsed: layerA.profileUsed,
    initialPregameScore: layerA.pregameScore,
    candidateCountBeforeRecalc: initialCandidates.length
  };

  if (!initialCandidates.length) {
    return buildPassDecision(
      'No hay edge suficiente ni EV positivo en los mercados disponibles',
      baseDebug
    );
  }

  const recalculatedCandidates = initialCandidates
    .map((preliminaryBest) => {
      const recalculatedProfile = getProfileFromMarket(preliminaryBest.market);

      const recalculatedScore = recalculatePregameScore(
        game,
        recalculatedProfile
      );

      const refreshedLayerA: LayerAOutput = {
        ...layerA,
        profileUsed: recalculatedScore.profile,
        pregameScore: recalculatedScore.finalScore,
        blockScores: recalculatedScore.blockScores
      };

      const finalCandidates = evaluateMarkets(game, refreshedLayerA);

      const fullDebug: NonNullable<FinalPickDecision['debug']> = {
        initialProfileUsed: layerA.profileUsed,
        preliminaryBestMarket: preliminaryBest.market,
        recalculatedProfileUsed: recalculatedScore.profile,
        initialPregameScore: layerA.pregameScore,
        recalculatedPregameScore: recalculatedScore.finalScore,
        candidateCountBeforeRecalc: initialCandidates.length,
        candidateCountAfterRecalc: finalCandidates.length
      };

      if (!finalCandidates.length) {
        return null;
      }

      const confirmedCandidate = finalCandidates.find((candidate) =>
        isSameCandidate(candidate, preliminaryBest)
      );

      if (!confirmedCandidate || !isCandidateViable(confirmedCandidate)) {
        return null;
      }

      const viableAlternatives = rankAlternativeCandidates(
        confirmedCandidate,
        finalCandidates.filter(
          (candidate) =>
            !isSameCandidate(candidate, confirmedCandidate) &&
            isCandidateViable(candidate)
        )
      );

      return {
        confirmedCandidate,
        viableAlternatives,
        fullDebug
      } satisfies RecalculatedCandidateResult;
    })
    .filter(
      (entry): entry is RecalculatedCandidateResult => entry !== null
    )
    .sort((left, right) => {
      const scoreGap =
        (right.confirmedCandidate.selectionScore ??
          right.confirmedCandidate.ev) -
        (left.confirmedCandidate.selectionScore ??
          left.confirmedCandidate.ev);

      if (scoreGap !== 0) {
        return scoreGap;
      }

      if (right.confirmedCandidate.edge !== left.confirmedCandidate.edge) {
        return right.confirmedCandidate.edge - left.confirmedCandidate.edge;
      }

      if (right.confirmedCandidate.ev !== left.confirmedCandidate.ev) {
        return right.confirmedCandidate.ev - left.confirmedCandidate.ev;
      }

      return (
        right.confirmedCandidate.estimatedProbability -
        left.confirmedCandidate.estimatedProbability
      );
    });

  if (recalculatedCandidates.length) {
    const bestResult = recalculatedCandidates[0];

    return toFinalPick(
      bestResult.confirmedCandidate,
      bestResult.viableAlternatives,
      bestResult.fullDebug
    );
  }

  return buildPassDecision(
    'Tras recalcular los mercados candidatos, ninguno mantuvo edge suficiente para continuar a ejecucion',
    {
      initialProfileUsed: layerA.profileUsed,
      initialPregameScore: layerA.pregameScore,
      candidateCountBeforeRecalc: initialCandidates.length
    }
  );
}
