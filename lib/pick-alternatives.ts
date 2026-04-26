import type {
  MarketEvaluation,
  StoredAlternativeMarket
} from './types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toStoredAlternativeMarket(
  candidate: MarketEvaluation | StoredAlternativeMarket
): StoredAlternativeMarket {
  return {
    market: candidate.market,
    selection: candidate.selection,
    line: candidate.line,
    odds: candidate.odds,
    estimatedProbability: candidate.estimatedProbability,
    impliedProbability: candidate.impliedProbability,
    edge: candidate.edge,
    ev: candidate.ev,
    confidence: candidate.confidence,
    reason: candidate.reason,
    selectionScore: isFiniteNumber(candidate.selectionScore)
      ? candidate.selectionScore
      : undefined
  };
}

export function serializeAlternativeMarket(
  candidate?: MarketEvaluation | StoredAlternativeMarket | null
): string | null {
  if (!candidate) return null;
  return JSON.stringify(toStoredAlternativeMarket(candidate));
}

export function parseStoredAlternativeMarket(
  value?: string | null
): StoredAlternativeMarket | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<StoredAlternativeMarket>;
    if (
      !parsed ||
      typeof parsed.market !== 'string' ||
      typeof parsed.selection !== 'string' ||
      !isFiniteNumber(parsed.odds) ||
      !isFiniteNumber(parsed.estimatedProbability) ||
      !isFiniteNumber(parsed.impliedProbability) ||
      !isFiniteNumber(parsed.edge) ||
      !isFiniteNumber(parsed.ev) ||
      typeof parsed.confidence !== 'string' ||
      typeof parsed.reason !== 'string'
    ) {
      return null;
    }

    return {
      market: parsed.market as StoredAlternativeMarket['market'],
      selection: parsed.selection,
      line: isFiniteNumber(parsed.line) ? parsed.line : undefined,
      odds: parsed.odds,
      estimatedProbability: parsed.estimatedProbability,
      impliedProbability: parsed.impliedProbability,
      edge: parsed.edge,
      ev: parsed.ev,
      confidence: parsed.confidence as StoredAlternativeMarket['confidence'],
      reason: parsed.reason,
      selectionScore: isFiniteNumber(parsed.selectionScore)
        ? parsed.selectionScore
        : undefined
    };
  } catch {
    const [market, selection] = value.split('|').map((part) => part.trim());
    if (!market || !selection) return null;

    return {
      market: market as StoredAlternativeMarket['market'],
      selection,
      odds: 0,
      estimatedProbability: 0,
      impliedProbability: 0,
      edge: 0,
      ev: 0,
      confidence: 'PASS',
      reason: 'Legacy alternative market entry'
    };
  }
}

export function formatStoredAlternativeLabel(value?: string | null): string | null {
  const parsed = parseStoredAlternativeMarket(value);
  if (!parsed) return value ?? null;
  return `${parsed.market} | ${parsed.selection}`;
}
