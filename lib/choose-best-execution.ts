// lib/choose-best-execution.ts

import { EventMarketLines, MarketLine } from './market-lines';
import { evaluateSpecificMarketLineWithDistribution } from './evaluate-markets';
import { buildGameDistribution } from './probability-model';
import {
  LayerAOutput,
  MarketEvaluation,
  NormalizedGameData
} from './types';

export type ExecutionRecommendation = {
  recommendedLine: MarketLine | null;
  alternative1?: MarketLine;
  alternative2?: MarketLine;
  recommendedEvaluation?: MarketEvaluation;
  alternativeEvaluation1?: MarketEvaluation;
  alternativeEvaluation2?: MarketEvaluation;
  minAcceptedOdds: number;
  tier: 'A' | 'B' | 'C';
  reason: string;
};

type TierExecutionConfig = {
  hardMinOdds: number;
  idealMinOdds: number;
  idealMaxOdds: number;
  tooConservativePenalty: number;
  tooAggressivePenalty: number;
  aggressionTolerance: number;
};

function getExecutionConfig(tier: 'A' | 'B' | 'C'): TierExecutionConfig {
  if (tier === 'A') {
    return {
      hardMinOdds: 1.5,
      idealMinOdds: 1.62,
      idealMaxOdds: 1.78,
      tooConservativePenalty: 22,
      tooAggressivePenalty: 18,
      aggressionTolerance: 1
    };
  }

  if (tier === 'B') {
    return {
      hardMinOdds: 1.5,
      idealMinOdds: 1.58,
      idealMaxOdds: 1.72,
      tooConservativePenalty: 14,
      tooAggressivePenalty: 16,
      aggressionTolerance: 1
    };
  }

  return {
    hardMinOdds: 1.5,
    idealMinOdds: 1.6,
    idealMaxOdds: 1.66,
    tooConservativePenalty: 10,
    tooAggressivePenalty: 20,
    aggressionTolerance: 0
  };
}

export function getExecutionConfigForTier(
  tier: 'A' | 'B' | 'C'
): TierExecutionConfig {
  return getExecutionConfig(tier);
}

function isHalfPointLine(line?: number): boolean {
  if (line === undefined || line === null) return true;
  const decimal = Math.abs(line % 1);
  return Math.abs(decimal - 0.5) < 0.001;
}

function matchesExecutionFamily(
  candidate: MarketLine,
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5',
  preferredSide: 'home' | 'away' | 'over' | 'under'
): boolean {
  if (marketType === 'TOTAL') {
    return candidate.marketType === 'TOTAL';
  }

  if (marketType === 'F5') {
    if (preferredSide === 'over' || preferredSide === 'under') {
      return (
        candidate.marketType === 'F5' &&
        (candidate.side === 'over' || candidate.side === 'under')
      );
    }

    return (
      candidate.marketType === 'F5' &&
      (candidate.side === 'home' || candidate.side === 'away')
    );
  }

  return candidate.marketType === 'ML' || candidate.marketType === 'RL';
}

function getRiskThreshold(
  candidate: MarketLine,
  preferredSide: 'home' | 'away' | 'over' | 'under'
): number {
  if (preferredSide === 'over') {
    return candidate.line ?? Number.POSITIVE_INFINITY;
  }

  if (preferredSide === 'under') {
    return candidate.line === undefined || candidate.line === null
      ? Number.POSITIVE_INFINITY
      : -1 * candidate.line;
  }

  if (candidate.line === undefined || candidate.line === null) {
    return 0;
  }

  return -1 * candidate.line;
}

function lineToSafeRank(
  line: MarketLine,
  _marketType: 'ML' | 'RL' | 'TOTAL' | 'F5',
  preferredSide: 'home' | 'away' | 'over' | 'under'
): number {
  return getRiskThreshold(line, preferredSide);
}

function isUsableExecutionLine(
  line: MarketLine,
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5',
  preferredSide: 'home' | 'away' | 'over' | 'under'
): boolean {
  if (!matchesExecutionFamily(line, marketType, preferredSide)) {
    return false;
  }

  if (marketType === 'TOTAL') {
    return typeof line.line === 'number' && isHalfPointLine(line.line);
  }

  if (marketType === 'ML' || marketType === 'RL') {
    if (line.marketType === 'ML') {
      return line.line === undefined;
    }

    return (
      isHalfPointLine(line.line) &&
      typeof line.line === 'number' &&
      Math.abs(line.line) >= 1.5
    );
  }

  if (preferredSide === 'over' || preferredSide === 'under') {
    return typeof line.line === 'number' && isHalfPointLine(line.line);
  }

  if (line.line === undefined || line.line === null) {
    return true;
  }

  return (
    isHalfPointLine(line.line) &&
    typeof line.line === 'number' &&
    Math.abs(line.line) >= 1.5
  );
}

function sortBySaferExecution(
  lines: MarketLine[],
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5',
  preferredSide: 'home' | 'away' | 'over' | 'under'
): MarketLine[] {
  return [...lines].sort((a, b) => {
    const rankA = lineToSafeRank(a, marketType, preferredSide);
    const rankB = lineToSafeRank(b, marketType, preferredSide);

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    return a.odds - b.odds;
  });
}

function getAggressionDistance(safeIndex: number, totalCandidates: number): number {
  if (totalCandidates <= 1) return 0;
  return (totalCandidates - 1) - safeIndex;
}

function getProtectionScore(safeIndex: number, totalCandidates: number): number {
  if (totalCandidates <= 1) return 100;
  return ((totalCandidates - 1 - safeIndex) / (totalCandidates - 1)) * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getReturnScore(odds: number, config: TierExecutionConfig): number {
  if (odds >= config.idealMinOdds && odds <= config.idealMaxOdds) {
    const center = (config.idealMinOdds + config.idealMaxOdds) / 2;
    const halfWidth = (config.idealMaxOdds - config.idealMinOdds) / 2 || 0.01;
    const distance = Math.abs(odds - center);

    return Math.max(70, 100 - (distance / halfWidth) * 20);
  }

  if (odds < config.idealMinOdds) {
    return Math.max(0, 78 - (config.idealMinOdds - odds) * 220);
  }

  return Math.max(0, 82 - (odds - config.idealMaxOdds) * 180);
}

function buildCandidateKey(line: MarketLine): string {
  return `${line.marketType}|${line.side ?? 'na'}|${line.selection}|${line.line ?? 'na'}`;
}

function dedupeExecutionCandidates(
  candidates: MarketLine[],
  config: TierExecutionConfig
): MarketLine[] {
  const center = (config.idealMinOdds + config.idealMaxOdds) / 2;
  const preferredByKey = new Map<string, MarketLine>();

  for (const candidate of candidates) {
    const key = buildCandidateKey(candidate);
    const current = preferredByKey.get(key);

    if (!current) {
      preferredByKey.set(key, candidate);
      continue;
    }

    const currentDistance = Math.abs(current.odds - center);
    const nextDistance = Math.abs(candidate.odds - center);

    if (nextDistance < currentDistance) {
      preferredByKey.set(key, candidate);
    }
  }

  return [...preferredByKey.values()];
}

function getConservativePenalty(
  odds: number,
  config: TierExecutionConfig
): number {
  if (odds >= config.idealMinOdds) return 0;
  return Math.min(
    config.tooConservativePenalty,
    (config.idealMinOdds - odds) * 100 * 0.9
  );
}

function getAggressivePenalty(
  aggressionDistance: number,
  config: TierExecutionConfig
): number {
  const overflow = aggressionDistance - config.aggressionTolerance;
  if (overflow <= 0) return 0;

  return Math.min(
    config.tooAggressivePenalty,
    overflow * (config.tooAggressivePenalty / 2)
  );
}

function getModelScore(evaluation: MarketEvaluation): number {
  const probabilityBaseline = Math.max(0.45, evaluation.impliedProbability);
  const probabilitySpan = Math.max(0.08, 0.9 - probabilityBaseline);
  const probabilityScore = clamp(
    ((evaluation.estimatedProbability - probabilityBaseline) / probabilitySpan) * 100,
    0,
    100
  );
  const edgeScore = clamp((evaluation.edge / 0.12) * 100, 0, 100);
  const evScore = clamp((evaluation.ev / 0.1) * 100, 0, 100);

  return probabilityScore * 0.24 + edgeScore * 0.4 + evScore * 0.36;
}

function buildReason(
  selected: MarketLine,
  protectionScore: number,
  returnScore: number,
  conservativePenalty: number,
  aggressivePenalty: number,
  config: TierExecutionConfig
): string {
  const tags: string[] = [];

  if (selected.odds >= config.idealMinOdds && selected.odds <= config.idealMaxOdds) {
    tags.push('cae en la zona de cuota ideal');
  } else if (selected.odds < config.idealMinOdds) {
    tags.push('protege bien pero sacrifica algo de retorno');
  } else {
    tags.push('ofrece mejor retorno pero sin irse al extremo');
  }

  if (protectionScore >= 70) {
    tags.push('mantiene buena proteccion');
  } else if (protectionScore >= 45) {
    tags.push('mantiene proteccion razonable');
  }

  if (returnScore >= 75) {
    tags.push('retorno utilizable');
  }

  if (conservativePenalty > 0 && aggressivePenalty === 0) {
    tags.push('evita caer demasiado abajo');
  }

  if (aggressivePenalty > 0 && conservativePenalty === 0) {
    tags.push('evita una linea mas agresiva de lo necesario');
  }

  return `Mejor equilibrio entre proteccion y retorno: ${tags.join(', ')}`;
}

export function chooseBestExecution(
  lines: EventMarketLines,
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5',
  preferredSide: 'home' | 'away' | 'over' | 'under',
  tier: 'A' | 'B' | 'C',
  game: NormalizedGameData,
  layerA: LayerAOutput,
  referenceLine?: number | null
): ExecutionRecommendation {
  const config = getExecutionConfig(tier);
  const distribution = buildGameDistribution(game, layerA);
  const referenceMarketType =
    marketType === 'RL'
      ? 'RL'
      : marketType === 'TOTAL'
        ? 'TOTAL'
        : marketType === 'F5'
          ? 'F5'
          : 'ML';
  const referenceCandidate: MarketLine = {
    marketType: referenceMarketType,
    selection: '',
    line: referenceLine ?? undefined,
    odds: config.idealMinOdds,
    side: preferredSide
  };
  const referenceThreshold = getRiskThreshold(referenceCandidate, preferredSide);

  const candidates = lines.lines
    .filter(
      (line) =>
        line.side === preferredSide
    )
    .filter((line) =>
      isUsableExecutionLine(
        line,
        marketType,
        preferredSide
      )
    )
    .filter(
      (line) =>
        getRiskThreshold(line, preferredSide) <= referenceThreshold + 0.001
    )
    .filter((line) => line.odds >= config.hardMinOdds);

  const uniqueCandidates = dedupeExecutionCandidates(candidates, config);

  if (!uniqueCandidates.length) {
    const lineLabel =
      referenceLine === undefined || referenceLine === null
        ? 'sin linea adicional'
        : `en la linea exacta ${referenceLine}`;

    return {
      recommendedLine: null,
      minAcceptedOdds: config.hardMinOdds,
      tier,
      reason: `No hay lineas disponibles ${lineLabel} que superen el piso minimo ${config.hardMinOdds}`
    };
  }

  const sorted = sortBySaferExecution(uniqueCandidates, marketType, preferredSide);

  const scored = sorted.map((line, index) => {
    const evaluation = evaluateSpecificMarketLineWithDistribution(
      game,
      distribution,
      line
    );

    if (!evaluation || evaluation.edge <= 0 || evaluation.ev <= 0) {
      return null;
    }

    const protectionScore = getProtectionScore(index, sorted.length);
    const returnScore = getReturnScore(line.odds, config);
    const aggressionDistance = getAggressionDistance(index, sorted.length);
    const conservativePenalty = getConservativePenalty(line.odds, config);
    const aggressivePenalty = getAggressivePenalty(
      aggressionDistance,
      config
    );
    const modelScore = getModelScore(evaluation);

    let executionScore =
      protectionScore * 0.42 +
      modelScore * 0.34 +
      returnScore * 0.24 -
      conservativePenalty -
      aggressivePenalty;

    if (
      line.odds >= config.idealMinOdds &&
      line.odds <= config.idealMaxOdds
    ) {
      executionScore += 6;
    }

    if (evaluation.confidence === 'A') {
      executionScore += 8;
    } else if (evaluation.confidence === 'B') {
      executionScore += 4;
    }

    return {
      line,
      evaluation,
      executionScore,
      protectionScore,
      modelScore,
      returnScore,
      conservativePenalty,
      aggressivePenalty
    };
  }).filter(
    (
      entry
    ): entry is {
      line: MarketLine;
      evaluation: MarketEvaluation;
      executionScore: number;
      protectionScore: number;
      modelScore: number;
      returnScore: number;
      conservativePenalty: number;
      aggressivePenalty: number;
    } => Boolean(entry)
  );

  scored.sort((a, b) => b.executionScore - a.executionScore);

  const best = scored[0];

  if (!best || best.executionScore < 20) {
    return {
      recommendedLine: null,
      minAcceptedOdds: config.hardMinOdds,
      tier,
      reason:
        'Las lineas disponibles no logran un equilibrio suficiente entre proteccion y retorno'
    };
  }

  return {
    recommendedLine: best.line,
    alternative1: scored[1]?.line,
    alternative2: scored[2]?.line,
    recommendedEvaluation: best.evaluation,
    alternativeEvaluation1: scored[1]?.evaluation,
    alternativeEvaluation2: scored[2]?.evaluation,
    minAcceptedOdds: config.hardMinOdds,
    tier,
    reason: buildReason(
      best.line,
      best.protectionScore,
      best.returnScore,
      best.conservativePenalty,
      best.aggressivePenalty,
      config
    )
  };
}
