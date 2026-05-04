export type ClvStatus = 'positive' | 'negative' | 'neutral' | 'unavailable';

export type ClvSummaryInput = {
  confidence?: unknown;
  market?: unknown;
  execution_market?: unknown;
  clv_percent?: unknown;
  clv_status?: unknown;
};

export type ClvBucketSummary = {
  key: string;
  total: number;
  total_with_clv: number;
  positive: number;
  negative: number;
  neutral: number;
  unavailable: number;
  avg_clv_percent: number | null;
};

export type ClvSummary = {
  total_with_clv: number;
  positive: number;
  negative: number;
  neutral: number;
  unavailable: number;
  avg_clv_percent: number | null;
  avg_clv_by_confidence: ClvBucketSummary[];
  avg_clv_by_market: ClvBucketSummary[];
};

function roundMetric(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(4));
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readStatus(value: unknown): ClvStatus {
  return value === 'positive' ||
    value === 'negative' ||
    value === 'neutral' ||
    value === 'unavailable'
    ? value
    : 'unavailable';
}

function getMarketKey(pick: ClvSummaryInput): string {
  const executionMarket = String(pick.execution_market ?? '').trim();
  const market = String(pick.market ?? '').trim();
  return executionMarket || market || 'UNKNOWN';
}

function getConfidenceKey(pick: ClvSummaryInput): string {
  const confidence = String(pick.confidence ?? '').trim();
  return confidence || 'UNKNOWN';
}

function createBucket(key: string) {
  return {
    summary: {
      key,
      total: 0,
      total_with_clv: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      unavailable: 0,
      avg_clv_percent: null
    } satisfies ClvBucketSummary,
    clvTotal: 0,
    clvCount: 0
  };
}

function finalizeBucket(bucket: ReturnType<typeof createBucket>): ClvBucketSummary {
  return {
    ...bucket.summary,
    avg_clv_percent:
      bucket.clvCount > 0 ? roundMetric(bucket.clvTotal / bucket.clvCount) : null
  };
}

export function buildClvSummary(picks: ClvSummaryInput[]): ClvSummary {
  const byConfidence = new Map<string, ReturnType<typeof createBucket>>();
  const byMarket = new Map<string, ReturnType<typeof createBucket>>();
  let totalWithClv = 0;
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  let unavailable = 0;
  let clvTotal = 0;

  for (const pick of picks) {
    const status = readStatus(pick.clv_status);
    const clvPercent = readNumber(pick.clv_percent);
    const hasClv = clvPercent !== null && status !== 'unavailable';
    const confidenceKey = getConfidenceKey(pick);
    const marketKey = getMarketKey(pick);

    if (!byConfidence.has(confidenceKey)) {
      byConfidence.set(confidenceKey, createBucket(confidenceKey));
    }

    if (!byMarket.has(marketKey)) {
      byMarket.set(marketKey, createBucket(marketKey));
    }

    if (status === 'positive') positive += 1;
    if (status === 'negative') negative += 1;
    if (status === 'neutral') neutral += 1;
    if (status === 'unavailable') unavailable += 1;

    if (hasClv) {
      totalWithClv += 1;
      clvTotal += clvPercent;
    }

    for (const bucket of [byConfidence.get(confidenceKey), byMarket.get(marketKey)]) {
      if (!bucket) continue;

      bucket.summary.total += 1;
      if (status === 'positive') bucket.summary.positive += 1;
      if (status === 'negative') bucket.summary.negative += 1;
      if (status === 'neutral') bucket.summary.neutral += 1;
      if (status === 'unavailable') bucket.summary.unavailable += 1;

      if (hasClv) {
        bucket.summary.total_with_clv += 1;
        bucket.clvTotal += clvPercent;
        bucket.clvCount += 1;
      }
    }
  }

  return {
    total_with_clv: totalWithClv,
    positive,
    negative,
    neutral,
    unavailable,
    avg_clv_percent: totalWithClv > 0 ? roundMetric(clvTotal / totalWithClv) : null,
    avg_clv_by_confidence: [...byConfidence.values()]
      .map(finalizeBucket)
      .sort((left, right) => right.total - left.total),
    avg_clv_by_market: [...byMarket.values()]
      .map(finalizeBucket)
      .sort((left, right) => right.total - left.total)
  };
}
