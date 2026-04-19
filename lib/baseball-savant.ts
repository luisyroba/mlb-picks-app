type SavantVenueMetricRow = {
  grouping_venue_conditions?: string;
  key_is_year_rolling?: string;
  key_bat_side?: string;
  venue_id?: string;
  metric_key?: string;
  [key: string]: unknown;
};

type SavantVenueData = {
  wowy_venue_h?: SavantVenueMetricRow[];
};

export type SavantParkFactors = {
  parkFactorRuns: number;
  parkFactorHr: number;
};

const PARK_FACTOR_CACHE_MS = 12 * 60 * 60 * 1000;
const parkFactorCache = new Map<
  string,
  {
    cachedAt: number;
    value: SavantParkFactors | null;
  }
>();

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function getMetricYearKeys(season: string): string[] {
  const seasonNumber = Number(season);

  if (!Number.isFinite(seasonNumber)) {
    return [`metric_value_${season}`];
  }

  return [
    `metric_value_${seasonNumber}`,
    `metric_value_${seasonNumber - 1}`,
    `metric_value_${seasonNumber - 2}`
  ];
}

function readBestMetricValue(
  rows: SavantVenueMetricRow[],
  metricKey: string,
  season: string
): number | undefined {
  const rowsForMetric = rows.filter((row) => row.metric_key === metricKey);
  const preferredConditions = ['All', 'Open Air', 'Night', 'Day'];
  const preferredRolling = ['1', '0', '-1'];

  for (const rollingKey of preferredRolling) {
    for (const condition of preferredConditions) {
      const match = rowsForMetric.find(
        (row) =>
          row.key_bat_side === 'All' &&
          row.grouping_venue_conditions === condition &&
          row.key_is_year_rolling === rollingKey
      );

      if (!match) continue;

      for (const key of getMetricYearKeys(season)) {
        const value = optionalNumber(match[key]);
        if (value !== undefined) {
          return value;
        }
      }
    }
  }

  return undefined;
}

function extractEmbeddedVenueData(html: string): SavantVenueData | null {
  const match = html.match(/var\s+data\s*=\s*(\{[\s\S]*?\});\s*var\s+baltData/);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]) as SavantVenueData;
  } catch {
    return null;
  }
}

export async function getSavantParkFactors(
  venueId: number,
  season: string
): Promise<SavantParkFactors | null> {
  const cacheKey = `${venueId}:${season}`;
  const cached = parkFactorCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt < PARK_FACTOR_CACHE_MS) {
    return cached.value;
  }

  const response = await fetch(
    `https://baseballsavant.mlb.com/leaderboard/statcast-venue?venueId=${venueId}`,
    {
      headers: {
        Accept: 'text/html'
      },
      cache: 'no-store'
    }
  );

  if (!response.ok) {
    throw new Error(
      `Baseball Savant park-factor request failed: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const embedded = extractEmbeddedVenueData(html);
  const rows = embedded?.wowy_venue_h ?? [];

  if (!rows.length) {
    parkFactorCache.set(cacheKey, {
      cachedAt: Date.now(),
      value: null
    });
    return null;
  }

  const parkFactorRuns = readBestMetricValue(rows, 'index_runs', season);
  const parkFactorHr = readBestMetricValue(rows, 'index_HR', season);

  if (parkFactorRuns === undefined && parkFactorHr === undefined) {
    parkFactorCache.set(cacheKey, {
      cachedAt: Date.now(),
      value: null
    });
    return null;
  }

  const factors = {
    parkFactorRuns: parkFactorRuns ?? 100,
    parkFactorHr: parkFactorHr ?? 100
  };

  parkFactorCache.set(cacheKey, {
    cachedAt: Date.now(),
    value: factors
  });

  return factors;
}
