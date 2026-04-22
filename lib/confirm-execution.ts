// lib/confirm-execution.ts

import {
  ExecutionRecommendation
} from './choose-best-execution';
import { MarketLine } from './market-lines';

export type ExecutionConfirmStatus =
  | 'CONFIRMED'
  | 'TRY_NEXT'
  | 'NO_BET'
  | 'NOT_AVAILABLE';

export type ExecutionConfirmationInput = {
  recommendation: ExecutionRecommendation;
  actualOdds?: number;
  actualLine?: number;
  available: boolean;
};

export type ExecutionConfirmationResult = {
  status: ExecutionConfirmStatus;
  acceptedLine: MarketLine | null;
  usedOdds?: number;
  minAcceptedOdds: number;
  nextAlternative?: MarketLine;
  reason: string;
};

function buildNoBet(
  recommendation: ExecutionRecommendation,
  reason: string
): ExecutionConfirmationResult {
  return {
    status: 'NO_BET',
    acceptedLine: null,
    minAcceptedOdds: recommendation.minAcceptedOdds,
    reason
  };
}

function buildTryNext(
  recommendation: ExecutionRecommendation,
  nextAlternative: MarketLine | undefined,
  reason: string
): ExecutionConfirmationResult {
  if (!nextAlternative) {
    return buildNoBet(
      recommendation,
      'No quedan alternativas viables despues de rechazar la linea sugerida'
    );
  }

  return {
    status: 'TRY_NEXT',
    acceptedLine: null,
    minAcceptedOdds: recommendation.minAcceptedOdds,
    nextAlternative,
    reason
  };
}

function sameLineValue(left?: number | null, right?: number | null): boolean {
  if (left === undefined || left === null) {
    return right === undefined || right === null;
  }

  if (right === undefined || right === null) {
    return false;
  }

  return Math.abs(left - right) < 0.001;
}

export function confirmExecution(
  input: ExecutionConfirmationInput
): ExecutionConfirmationResult {
  const { recommendation, actualOdds, actualLine, available } = input;

  if (!recommendation.recommendedLine) {
    return buildNoBet(
      recommendation,
      'No existe linea recomendada para confirmar'
    );
  }

  if (!available) {
    return buildTryNext(
      recommendation,
      recommendation.alternative1,
      'La linea sugerida no esta disponible en tu casa'
    );
  }

  if (!actualOdds || actualOdds <= 1) {
    return buildTryNext(
      recommendation,
      recommendation.alternative1,
      'La cuota ingresada no es valida'
    );
  }

  if (recommendation.recommendedLine.line !== undefined) {
    if (typeof actualLine !== 'number' || !Number.isFinite(actualLine)) {
      return buildTryNext(
        recommendation,
        recommendation.alternative1,
        'Debes ingresar la linea real de tu book para confirmar este pick'
      );
    }

    if (!sameLineValue(actualLine, recommendation.recommendedLine.line)) {
      return buildTryNext(
        recommendation,
        recommendation.alternative1,
        `La linea ${actualLine} no coincide con la recomendada ${recommendation.recommendedLine.line}`
      );
    }
  } else if (typeof actualLine === 'number' && Number.isFinite(actualLine)) {
    return buildTryNext(
      recommendation,
      recommendation.alternative1,
      'La recomendacion activa es moneyline/F5 ML y no lleva linea adicional'
    );
  }

  if (actualOdds < recommendation.minAcceptedOdds) {
    return buildTryNext(
      recommendation,
      recommendation.alternative1,
      `La cuota ${actualOdds} esta por debajo del piso minimo permitido ${recommendation.minAcceptedOdds}`
    );
  }

  return {
    status: 'CONFIRMED',
    acceptedLine: recommendation.recommendedLine,
    usedOdds: actualOdds,
    minAcceptedOdds: recommendation.minAcceptedOdds,
    reason:
      'La ejecucion respeta el piso minimo y mantiene la misma linea recomendada por el modelo'
  };
}
