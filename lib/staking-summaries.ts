export type StakingPickLike = {
  confidence?: unknown;
  status?: unknown;
  profit_units?: unknown;
  execution_odds?: unknown;
  odds?: unknown;
};

export type StakeModel = Record<'A' | 'B' | 'C', number>;

export type StakeSummary = {
  total_picks: number;
  staked_picks: number;
  settled_picks: number;
  wins: number;
  losses: number;
  voids: number;
  pending: number;
  staked_units: number;
  profit_units: number;
  win_rate: number | null;
  roi: number | null;
};

export type StakingSummaries = {
  all_flat_summary: StakeSummary;
  main_system_summary: StakeSummary;
  optional_c_summary: StakeSummary;
  weighted_summary: StakeSummary;
  conservative_summary: StakeSummary;
};

export const STAKING_MODEL_METADATA = {
  flat: 'A/B/C = 1u',
  weighted: { A: 1, B: 0.5, C: 0.25 },
  conservative: { A: 1, B: 0.5, C: 0 }
} as const;

const WEIGHTED_MODEL: StakeModel = { A: 1, B: 0.5, C: 0.25 };
const CONSERVATIVE_MODEL: StakeModel = { A: 1, B: 0.5, C: 0 };

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStatus(pick: StakingPickLike): string {
  return String(pick.status ?? 'pending').trim().toLowerCase();
}

function readConfidence(pick: StakingPickLike): string {
  return String(pick.confidence ?? '').trim().toUpperCase();
}

function readExecutionOdds(pick: StakingPickLike): number | null {
  const executionOdds = readNumber(pick.execution_odds);
  if (executionOdds !== null && executionOdds > 1) return executionOdds;

  const modelOdds = readNumber(pick.odds);
  return modelOdds !== null && modelOdds > 1 ? modelOdds : null;
}

function createEmptySummary(totalPicks: number): StakeSummary {
  return {
    total_picks: totalPicks,
    staked_picks: 0,
    settled_picks: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    pending: 0,
    staked_units: 0,
    profit_units: 0,
    win_rate: null,
    roi: null
  };
}

function finalizeSummary(summary: StakeSummary): StakeSummary {
  const graded = summary.wins + summary.losses;

  return {
    ...summary,
    staked_units: roundMetric(summary.staked_units),
    profit_units: roundMetric(summary.profit_units),
    win_rate: graded > 0 ? roundMetric(summary.wins / graded) : null,
    roi: summary.staked_units > 0 ? roundMetric(summary.profit_units / summary.staked_units) : null
  };
}

function buildFlatSummary(
  picks: StakingPickLike[],
  includePick: (pick: StakingPickLike) => boolean
): StakeSummary {
  const selected = picks.filter(includePick);
  const summary = createEmptySummary(selected.length);

  for (const pick of selected) {
    const status = readStatus(pick);
    const profitUnits = readNumber(pick.profit_units) ?? 0;

    if (status === 'pending') {
      summary.pending += 1;
      continue;
    }

    if (status === 'void') {
      summary.voids += 1;
      continue;
    }

    if (status === 'won' || status === 'lost') {
      summary.staked_picks += 1;
      summary.settled_picks += 1;
      summary.staked_units += 1;
      summary.profit_units += profitUnits;
      if (status === 'won') summary.wins += 1;
      if (status === 'lost') summary.losses += 1;
    }
  }

  return finalizeSummary(summary);
}

function getWeightedProfit(pick: StakingPickLike, stake: number): number {
  const status = readStatus(pick);
  if (status === 'lost') return -stake;
  if (status !== 'won') return 0;

  const executionOdds = readExecutionOdds(pick);
  if (executionOdds !== null) {
    return (executionOdds - 1) * stake;
  }

  const flatProfit = readNumber(pick.profit_units);
  return flatProfit !== null ? flatProfit * stake : 0;
}

function buildStakeAdjustedSummary(
  picks: StakingPickLike[],
  model: StakeModel
): StakeSummary {
  const summary = createEmptySummary(picks.length);

  for (const pick of picks) {
    const confidence = readConfidence(pick);
    const stake = confidence === 'A' || confidence === 'B' || confidence === 'C'
      ? model[confidence]
      : 0;
    const status = readStatus(pick);

    if (status === 'pending') {
      summary.pending += 1;
      continue;
    }

    if (status === 'void') {
      summary.voids += 1;
      continue;
    }

    if (status !== 'won' && status !== 'lost') {
      continue;
    }

    if (stake <= 0) {
      continue;
    }

    summary.staked_picks += 1;
    summary.settled_picks += 1;
    summary.staked_units += stake;
    summary.profit_units += getWeightedProfit(pick, stake);
    if (status === 'won') summary.wins += 1;
    if (status === 'lost') summary.losses += 1;
  }

  return finalizeSummary(summary);
}

export function buildStakingSummaries(picks: StakingPickLike[]): StakingSummaries {
  return {
    all_flat_summary: buildFlatSummary(picks, () => true),
    main_system_summary: buildFlatSummary(picks, (pick) => {
      const confidence = readConfidence(pick);
      return confidence === 'A' || confidence === 'B';
    }),
    optional_c_summary: buildFlatSummary(picks, (pick) => readConfidence(pick) === 'C'),
    weighted_summary: buildStakeAdjustedSummary(picks, WEIGHTED_MODEL),
    conservative_summary: buildStakeAdjustedSummary(picks, CONSERVATIVE_MODEL)
  };
}
