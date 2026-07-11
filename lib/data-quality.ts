import type { NormalizedGameData } from './types';

export type DataQualityRating = 'good' | 'mid' | 'bad';

export type DataQualityCheck = {
  id: string;
  label: string;
  ok: boolean;
  critical?: boolean;
};

export type DataQualitySummary = {
  rating: DataQualityRating;
  label: 'High' | 'Medium' | 'Low';
  detail: string;
  score: number;
  criticalScore: number;
  autoSaveReady: boolean;
  checks: DataQualityCheck[];
  missing: string[];
  missingCritical: string[];
};

function hasMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasReliableStarter(game: NormalizedGameData, side: 'home' | 'away') {
  const starter = side === 'home' ? game.homeTeam.starter : game.awayTeam.starter;

  return Boolean(
    starter.sourceOk === true &&
      starter.name &&
      starter.name !== 'TBD' &&
      hasMetric(starter.inningsPitched) &&
      hasMetric(starter.era) &&
      hasMetric(starter.whip)
  );
}

export function getDataQualitySummary(
  game?: NormalizedGameData | null
): DataQualitySummary {
  if (!game) {
    return {
      rating: 'bad',
      label: 'Low',
      detail: 'El snapshot no trajo suficientes datos estructurados del matchup.',
      score: 0,
      criticalScore: 0,
      autoSaveReady: false,
      checks: [],
      missing: ['snapshot estructurado'],
      missingCritical: ['snapshot estructurado']
    };
  }

  const checks: DataQualityCheck[] = [
    {
      id: 'starter_source',
      label: 'abridores oficiales',
      critical: true,
      ok: hasReliableStarter(game, 'home') && hasReliableStarter(game, 'away')
    },
    {
      id: 'starter_xfip',
      label: 'xFIP de abridores',
      ok: hasMetric(game.homeTeam.starter.xfip) && hasMetric(game.awayTeam.starter.xfip)
    },
    {
      id: 'starter_ip',
      label: 'IP de abridores',
      critical: true,
      ok:
        hasMetric(game.homeTeam.starter.inningsPitched) &&
        hasMetric(game.awayTeam.starter.inningsPitched)
    },
    {
      id: 'bullpen_real',
      label: 'bullpen real',
      ok:
        hasMetric(game.homeTeam.bullpen.fip) &&
        hasMetric(game.awayTeam.bullpen.fip) &&
        game.homeTeam.bullpen.isFallback !== true &&
        game.awayTeam.bullpen.isFallback !== true
    },
    {
      id: 'bullpen_fatigue',
      label: 'fatiga bullpen',
      ok:
        hasMetric(game.homeTeam.bullpen.fatigueScore) &&
        hasMetric(game.awayTeam.bullpen.fatigueScore)
    },
    {
      id: 'offense_splits',
      label: 'splits ofensivos',
      ok:
        hasMetric(game.homeTeam.offense.vsRightOps) &&
        hasMetric(game.homeTeam.offense.vsLeftOps) &&
        hasMetric(game.awayTeam.offense.vsRightOps) &&
        hasMetric(game.awayTeam.offense.vsLeftOps)
    },
    {
      id: 'recent_form',
      label: 'forma reciente',
      ok:
        hasMetric(game.homeTeam.offense.last7RunsPerGame) &&
        hasMetric(game.awayTeam.offense.last7RunsPerGame)
    },
    {
      id: 'lineups',
      label: 'lineups posteados',
      critical: true,
      ok:
        game.homeTeam.lineupContext.confirmedLineup === true &&
        game.awayTeam.lineupContext.confirmedLineup === true
    },
    {
      id: 'park',
      label: 'parque',
      ok:
        hasMetric(game.parkWeather.parkFactorRuns) &&
        hasMetric(game.parkWeather.parkFactorHr)
    },
    {
      id: 'weather',
      label: 'clima',
      ok:
        hasMetric(game.parkWeather.temperatureF) &&
        hasMetric(game.parkWeather.windMph)
    }
  ];

  const completed = checks.filter((check) => check.ok).length;
  const critical = checks.filter((check) => check.critical);
  const completedCritical = critical.filter((check) => check.ok).length;
  const score = completed / checks.length;
  const criticalScore = critical.length ? completedCritical / critical.length : 1;
  const missing = checks.filter((check) => !check.ok).map((check) => check.label);
  const missingCritical = checks
    .filter((check) => check.critical && !check.ok)
    .map((check) => check.label);
  const autoSaveReady = score >= 0.9 && criticalScore === 1;

  if (score >= 0.9 && criticalScore === 1) {
    return {
      rating: 'good',
      label: 'High',
      detail: 'Llegaron abridores confiables, ambos lineups, bullpen, parque y clima con cobertura alta.',
      score,
      criticalScore,
      autoSaveReady,
      checks,
      missing,
      missingCritical
    };
  }

  if (score >= 0.62) {
    return {
      rating: 'mid',
      label: 'Medium',
      detail: missing.length
        ? `Faltan capas para cerrar el pick automatico: ${missing.slice(0, 4).join(', ')}.`
        : 'El snapshot tiene señal suficiente para analizar, pero no para auto-guardar.',
      score,
      criticalScore,
      autoSaveReady,
      checks,
      missing,
      missingCritical
    };
  }

  return {
    rating: 'bad',
    label: 'Low',
    detail: missing.length
      ? `Faltan datos críticos: ${missing.slice(0, 4).join(', ')}.`
      : 'La cobertura todavía es baja para confiar en el pick.',
    score,
    criticalScore,
    autoSaveReady,
    checks,
    missing,
    missingCritical
  };
}
