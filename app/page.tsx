'use client';

import Image from 'next/image';
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDateKeyForTimezone,
  formatDateTimeForTimezone
} from '@/lib/runtime-config';
import { normalizeEntityName } from '@/lib/text-utils';
import {
  clearSolidPick,
  type PersistedSolidPick
} from '@/lib/solid-pick-client';
import type { LayerAOutput, NormalizedGameData } from '@/lib/types';

type TeamSummary = {
  name: string;
  abbr: string;
  logo: string | null;
  color: string | null;
  alternateColor: string | null;
  score: string | null;
  record: string | null;
  linescores: string[];
  hits: string | null;
  errors: string | null;
};

type GameRow = {
  gameId: string;
  date: string | null;
  name: string;
  shortName: string;
  status: string;
  statusDetail: string;
  state: string;
  completed: boolean;
  innings: number;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  analysis: {
    analyzed: boolean;
    hasActivePick: boolean;
    status: string;
    confidence: string | null;
    selection: string | null;
    market?: string | null;
    line?: number | null;
    odds?: number | null;
    probability?: number | null;
    edge?: number | null;
    ev?: number | null;
    updatedAt: string | null;
  };
};

type ExecutionLine = {
  marketType: 'ML' | 'RL' | 'TOTAL' | 'F5';
  selection: string;
  line?: number;
  odds: number;
  side?: 'home' | 'away' | 'over' | 'under';
};

type ExecutionSlot = 'recommended' | 'alternative1' | 'alternative2';

type AnalyzeResponse = {
  ok: boolean;
  error?: string;
  statsFetchWarning?: string | null;
  oddsFetchWarning?: string | null;
  frozenPregame?: boolean;
  engineGame?: NormalizedGameData;
  layerA?: LayerAOutput;
  pickLock?: { snapshotId?: string; stage: string; lastUpdatedAt: string; alerts: string[] };
  finalDecision?: { status: string; reason: string };
  executionRecommendation?: {
    recommendedLine: ExecutionLine | null;
    alternative1?: ExecutionLine | null;
    alternative2?: ExecutionLine | null;
    minAcceptedOdds: number;
    tier: 'A' | 'B' | 'C';
    reason: string;
  } | null;
  uiSummary?: {
    pregameScore: number | null;
    lean: string;
    confidence: string;
    marketView: {
      marketFamily: string;
      selection: string;
      direction: string;
      confidence: string;
      reason: string;
    } | null;
    finalPick: {
      market: string;
      selection: string;
      confidence: string;
      probability: number | null;
      edge: number | null;
      ev: number | null;
    };
    execution: {
      status: string;
      selection: string | null;
      line: number | null;
      odds: number | null;
      reason: string;
    };
  };
  resultSummary?: { status: string; result: string | null; profitUnits: number | null };
  confirmedPick?: {
    market: string;
    selection: string;
    line: number | null;
    odds: number | null;
    status: string;
    reason: string;
  } | null;
};

type ConfirmResult = {
  status: string;
  reason: string;
  usedOdds?: number | null;
  minAcceptedOdds?: number | null;
  acceptedLine?: { marketType?: string; selection: string; line?: number; odds?: number | null } | null;
  nextAlternative?: { selection: string; line?: number; odds?: number | null } | null;
};

type GamesResponse = {
  ok: boolean;
  error?: string;
  games?: GameRow[];
};

type CardMeta = {
  tone: 'new' | 'lean' | 'audited' | 'pending' | 'won' | 'lost' | 'void';
  label: string;
  sublabel: string;
  selection: string | null;
  hasActivePick: boolean;
  market: string | null;
  confidence: string | null;
  odds: number | null;
};

type SolidDailyPickState = PersistedSolidPick & {
  market: ExecutionLine['marketType'];
  odds: number;
  game: GameRow | null;
};

type StatsPremiumPick = {
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  confidence: string;
  score: number;
  edge?: number | null;
  ev?: number | null;
  executionOdds?: number | null;
  line?: number | null;
  note?: string | null;
};

type HomeStatsResponse = {
  ok?: boolean;
  solidPick?: {
    premiumPick?: StatsPremiumPick | null;
  };
};
const ANALYSIS_CACHE_MAX_AGE_MS = 60_000;

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.7V12.2L15 14.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 12.6L9.8 8.7L12.2 11.1L18 5.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.6 5.4H18V8.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2V5" strokeLinecap="round" />
      <path d="M12 19V22" strokeLinecap="round" />
      <path d="M2 12H5" strokeLinecap="round" />
      <path d="M19 12H22" strokeLinecap="round" />
    </svg>
  );
}

function hexToRgbTuple(color?: string | null) {
  if (!color) return null;
  const normalized = color.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function resolveTeamGlow(color?: string | null, alternateColor?: string | null) {
  const primary = hexToRgbTuple(color);
  const alternate = hexToRgbTuple(alternateColor);
  const brightness = primary ? primary.r + primary.g + primary.b : 999;

  if (primary && brightness > 70) return primary;
  if (alternate && alternate.r + alternate.g + alternate.b > 70) return alternate;
  if (alternate) return alternate;
  if (!primary) return null;
  return {
    r: Math.min(255, Math.round(primary.r + (255 - primary.r) * 0.45)),
    g: Math.min(255, Math.round(primary.g + (255 - primary.g) * 0.45)),
    b: Math.min(255, Math.round(primary.b + (255 - primary.b) * 0.45))
  };
}

function TeamLogo({
  src,
  alt,
  color,
  alternateColor
}: {
  src: string | null;
  alt: string;
  color?: string | null;
  alternateColor?: string | null;
}) {
  const rgb = resolveTeamGlow(color, alternateColor);
  const shellStyle = { boxShadow: '0 12px 22px rgba(9,28,57,0.08)' };

  return src ? (
    <div
      className="relative flex h-10 w-10 items-center justify-center rounded-full"
      style={shellStyle}
    >
      {rgb && (
        <div
          className="absolute inset-[-4px] rounded-full blur-[10px]"
          style={{ background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)` }}
        />
      )}
      <Image
        src={src}
        alt={alt}
        width={40}
        height={40}
        className="relative h-10 w-10 rounded-full border border-[rgba(9,28,57,0.08)] bg-white object-contain p-1 shadow-[0_10px_20px_rgba(9,28,57,0.06)]"
        unoptimized
      />
    </div>
  ) : (
      <div
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line-soft)] bg-white text-[11px] font-semibold text-[var(--ink-strong)]"
        style={shellStyle}
      >
      {alt.slice(0, 3).toUpperCase()}
    </div>
  );
}

function fmtDate(value?: string | null) {
  if (!value) return '-';
  return (
    formatDateTimeForTimezone(value, 'es-CL', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }) ?? value
  );
}

function fmtNum(value?: number | null, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function fmtProb(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function fmtUnits(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}u` : '-';
}

function isNumericOnly(value?: string | null) {
  if (!value) return false;
  return /^\d+$/.test(value.trim());
}

function resolveHomeMatchupLabel(
  gameId: string,
  fallbackGameLabel?: string | null,
  sourceGames?: GameRow[]
) {
  const game = (sourceGames ?? []).find(
    (item) => String(item.gameId) === String(gameId)
  );

  if (game) {
    return `${game.awayTeam.name} @ ${game.homeTeam.name}`;
  }

  if (fallbackGameLabel && !isNumericOnly(fallbackGameLabel)) {
    return fallbackGameLabel.trim();
  }

  return 'Partido desconocido';
}

function getDateKey(offset = 0) {
  return formatDateKeyForTimezone(offset);
}

function getSolidStorageDateKey(offset = 0) {
  return formatDateKeyForTimezone(offset, { dashed: true });
}

function isTotalMarketLabel(selection: string, market?: string | null) {
  const normalized = selection.trim().toLowerCase();
  return (
    market === 'TOTAL' ||
    normalized.startsWith('over') ||
    normalized.startsWith('under') ||
    normalized.startsWith('f5 over') ||
    normalized.startsWith('f5 under')
  );
}

function formatDisplayLine(line: number, selection: string, market?: string | null) {
  if (isTotalMarketLabel(selection, market)) {
    return Math.abs(line).toFixed(1);
  }

  return `${line > 0 ? '+' : ''}${line.toFixed(1)}`;
}

function renderPickLabel(selection: string, line?: number | null, market?: string | null) {
  return typeof line === 'number' && Number.isFinite(line)
    ? `${selection} ${formatDisplayLine(line, selection, market)}`
    : selection;
}

function renderLineBadgeText(selection: string, line?: number | null, market?: string | null) {
  if (typeof line !== 'number' || !Number.isFinite(line)) return 'Sin linea';
  return `Linea ${formatDisplayLine(line, selection, market)}`;
}

function getExecOptions(recommendation?: AnalyzeResponse['executionRecommendation']) {
  if (!recommendation) return [];
  return [
    recommendation.recommendedLine ? { slot: 'recommended' as const, label: 'Base', line: recommendation.recommendedLine } : null,
    recommendation.alternative1 ? { slot: 'alternative1' as const, label: 'Alt 1', line: recommendation.alternative1 } : null,
    recommendation.alternative2 ? { slot: 'alternative2' as const, label: 'Alt 2', line: recommendation.alternative2 } : null
  ].filter((item): item is { slot: ExecutionSlot; label: string; line: ExecutionLine } => Boolean(item));
}

function toneClasses(tone: CardMeta['tone']) {
  if (tone === 'won') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'lost') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (tone === 'void') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (tone === 'pending') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (tone === 'lean') return 'border-indigo-200 bg-indigo-50 text-indigo-800';
  if (tone === 'audited') return 'border-[var(--line-strong)] bg-[var(--surface-soft)] text-[var(--ink-soft)]';
  return 'border-[var(--line-soft)] bg-white text-[var(--ink-soft)]';
}

function marketBadgeClasses(market?: string | null) {
  if (market === 'ML') return 'border-sky-300/80 bg-[linear-gradient(135deg,rgba(232,247,255,0.98),rgba(196,231,255,0.9))] text-sky-900 shadow-[0_8px_18px_rgba(56,189,248,0.12)]';
  if (market === 'RL') return 'border-fuchsia-300/80 bg-[linear-gradient(135deg,rgba(252,239,255,0.98),rgba(239,213,255,0.9))] text-fuchsia-900 shadow-[0_8px_18px_rgba(217,70,239,0.12)]';
  if (market === 'TOTAL') return 'border-teal-300/80 bg-[linear-gradient(135deg,rgba(235,255,251,0.98),rgba(196,250,235,0.9))] text-teal-900 shadow-[0_8px_18px_rgba(20,184,166,0.12)]';
  if (market === 'F5') return 'border-amber-300/80 bg-[linear-gradient(135deg,rgba(255,249,232,0.98),rgba(254,231,173,0.92))] text-amber-900 shadow-[0_8px_18px_rgba(245,158,11,0.12)]';
  return 'border-[var(--line-soft)] bg-[var(--surface-soft)] text-[var(--ink-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]';
}

function tierBadgeClasses(confidence?: string | null) {
  if (confidence === 'A') return 'border-[#dfc36f] bg-[linear-gradient(135deg,rgba(255,248,224,0.98),rgba(240,209,120,0.9))] text-[#6f5110] shadow-[0_10px_20px_rgba(174,131,32,0.16)]';
  if (confidence === 'B') return 'border-indigo-300/80 bg-[linear-gradient(135deg,rgba(238,242,255,0.98),rgba(199,210,254,0.9))] text-indigo-900 shadow-[0_8px_18px_rgba(99,102,241,0.12)]';
  if (confidence === 'C') return 'border-slate-300/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.98),rgba(226,232,240,0.9))] text-slate-700 shadow-[0_8px_18px_rgba(148,163,184,0.1)]';
  return 'border-[var(--line-soft)] bg-[var(--surface-soft)] text-[var(--ink-soft)]';
}

function metricFill(value: number | null | undefined, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(6, Math.min(100, (Math.abs(value) / max) * 100));
}

function qualityBarClasses(rating: 'good' | 'mid' | 'bad') {
  if (rating === 'good') return 'bg-[linear-gradient(90deg,#22c55e,#4ade80)]';
  if (rating === 'mid') return 'bg-[linear-gradient(90deg,#f59e0b,#fbbf24)]';
  return 'bg-[linear-gradient(90deg,#ef4444,#fb7185)]';
}

function hasMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value);
}

function getDataQualitySummary(game?: NormalizedGameData | null) {
  if (!game) {
    return {
      rating: 'bad' as const,
      label: 'Low',
      detail: 'El snapshot no trajo suficientes datos estructurados del matchup.',
      score: 0
    };
  }

  const checks = [
    { label: 'xFIP de abridores', ok: hasMetric(game.homeTeam.starter.xfip) && hasMetric(game.awayTeam.starter.xfip) },
    { label: 'IP de abridores', ok: hasMetric(game.homeTeam.starter.inningsPitched) && hasMetric(game.awayTeam.starter.inningsPitched) },
    {
      label: 'bullpen real',
      ok:
        hasMetric(game.homeTeam.bullpen.fip) &&
        hasMetric(game.awayTeam.bullpen.fip) &&
        game.homeTeam.bullpen.isFallback !== true &&
        game.awayTeam.bullpen.isFallback !== true
    },
    { label: 'fatiga bullpen', ok: hasMetric(game.homeTeam.bullpen.fatigueScore) && hasMetric(game.awayTeam.bullpen.fatigueScore) },
    { label: 'splits ofensivos', ok: hasMetric(game.homeTeam.offense.vsRightOps) && hasMetric(game.awayTeam.offense.vsRightOps) },
    { label: 'forma reciente', ok: hasMetric(game.homeTeam.offense.last7RunsPerGame) && hasMetric(game.awayTeam.offense.last7RunsPerGame) },
    { label: 'lineups', ok: game.homeTeam.lineupContext.confirmedLineup === true || game.awayTeam.lineupContext.confirmedLineup === true },
    { label: 'parque', ok: hasMetric(game.parkWeather.parkFactorRuns) && hasMetric(game.parkWeather.parkFactorHr) },
    { label: 'clima', ok: hasMetric(game.parkWeather.temperatureF) && hasMetric(game.parkWeather.windMph) }
  ];

  const completed = checks.filter((check) => check.ok).length;
  const score = completed / checks.length;
  const missing = checks.filter((check) => !check.ok).map((check) => check.label);

  if (score >= 0.82) {
    return {
      rating: 'good' as const,
      label: 'High',
      detail: 'Llegaron abridores, bullpen, lineup, parque y clima con cobertura casi completa.',
      score
    };
  }

  if (score >= 0.58) {
    return {
      rating: 'mid' as const,
      label: 'Medium',
      detail: missing.length
        ? `Faltan algunas capas para cerrar el análisis fino: ${missing.slice(0, 3).join(', ')}.`
        : 'El snapshot tiene señal suficiente, pero no vino completo en todas las capas.',
      score
    };
  }

  return {
    rating: 'bad' as const,
    label: 'Low',
    detail: missing.length
      ? `La lectura llega incompleta en piezas críticas: ${missing.slice(0, 3).join(', ')}.`
      : 'La lectura del juego está incompleta para un análisis premium.',
    score
  };
}

function getMetricRating(label: string, value: number | null | undefined): 'good' | 'mid' | 'bad' {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'bad';
  if (label === 'Probabilidad') {
    if (value >= 62) return 'good';
    if (value >= 55) return 'mid';
    return 'bad';
  }

  if (label === 'Edge') {
    if (value >= 0.06) return 'good';
    if (value >= 0.025) return 'mid';
    return 'bad';
  }

  if (label === 'EV') {
    if (value >= 0.08) return 'good';
    if (value >= 0.03) return 'mid';
    return 'bad';
  }

  return 'mid';
}

type TeamInput = NormalizedGameData['homeTeam'];
type ComparisonWinner = 'home' | 'away' | null;
type StatDescriptor = {
  id: string;
  label: string;
  better: 'higher' | 'lower';
  getValue: (team: TeamInput, opponent: TeamInput, game: NormalizedGameData) => number | null;
  format: (value: number | null) => string;
};

type StatGroup = {
  title: string;
  eyebrow: string;
  stats: StatDescriptor[];
};

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6L18 18" strokeLinecap="round" />
      <path d="M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function normalizeMetricValue(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fmtSigned(value?: number | null, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function fmtStatPercent(value?: number | null, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(digits)}%`;
}

function getRelevantSplitOps(team: TeamInput, opponent: TeamInput) {
  const hand = opponent.starter.handedness;
  if (hand === 'L') return normalizeMetricValue(team.offense.vsLeftOps);
  if (hand === 'R' || hand === 'S') return normalizeMetricValue(team.offense.vsRightOps);
  return normalizeMetricValue(team.offense.vsRightOps ?? team.offense.vsLeftOps);
}

const STAT_GROUPS: StatGroup[] = [
  {
    eyebrow: 'Forma',
    title: 'Base del matchup',
    stats: [
      {
        id: 'wins',
        label: 'Wins',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.core.wins),
        format: (value) => (value === null ? '-' : value.toFixed(0))
      },
      {
        id: 'last10',
        label: 'Last 10',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.core.last10Wins),
        format: (value) => (value === null ? '-' : value.toFixed(0))
      },
      {
        id: 'runDiff',
        label: 'Run diff/G',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.core.runDifferentialPerGame),
        format: (value) => fmtSigned(value, 2)
      },
      {
        id: 'rpg',
        label: 'Runs/G',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.offense.runsPerGame ?? team.core.runsScoredPerGame),
        format: (value) => fmtNum(value, 2)
      }
    ]
  },
  {
    eyebrow: 'Bateo',
    title: 'Ataque y lineup',
    stats: [
      {
        id: 'ops',
        label: 'OPS',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.offense.ops),
        format: (value) => fmtNum(value, 3)
      },
      {
        id: 'splitOps',
        label: 'Split OPS',
        better: 'higher',
        getValue: (team, opponent) => getRelevantSplitOps(team, opponent),
        format: (value) => fmtNum(value, 3)
      },
      {
        id: 'last7',
        label: 'Last 7 RPG',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.offense.last7RunsPerGame),
        format: (value) => fmtNum(value, 2)
      },
      {
        id: 'lineupAdj',
        label: 'Lineup adj',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.lineupContext.lineupQualityAdjustment),
        format: (value) => fmtSigned(value, 0)
      }
    ]
  },
  {
    eyebrow: 'Abridor',
    title: 'Ventaja inicial',
    stats: [
      {
        id: 'starterEra',
        label: 'ERA',
        better: 'lower',
        getValue: (team) => normalizeMetricValue(team.starter.era),
        format: (value) => fmtNum(value, 2)
      },
      {
        id: 'starterWhip',
        label: 'WHIP',
        better: 'lower',
        getValue: (team) => normalizeMetricValue(team.starter.whip),
        format: (value) => fmtNum(value, 2)
      },
      {
        id: 'starterKRate',
        label: 'K rate',
        better: 'higher',
        getValue: (team) => normalizeMetricValue(team.starter.strikeoutRate),
        format: (value) => fmtStatPercent(value, 1)
      },
      {
        id: 'starterRecentEra',
        label: 'Recent ERA',
        better: 'lower',
        getValue: (team) => normalizeMetricValue(team.starter.recentEra),
        format: (value) => fmtNum(value, 2)
      }
    ]
  },
  {
    eyebrow: 'Bullpen',
    title: 'Cierre y fatiga',
    stats: [
      {
        id: 'bullpenEra',
        label: 'ERA',
        better: 'lower',
        getValue: (team) => normalizeMetricValue(team.bullpen.era),
        format: (value) => fmtNum(value, 2)
      },
      {
        id: 'bullpenWhip',
        label: 'WHIP',
        better: 'lower',
        getValue: (team) => normalizeMetricValue(team.bullpen.whip),
        format: (value) => fmtNum(value, 2)
      },
      {
        id: 'fatigue',
        label: 'Fatigue',
        better: 'lower',
        getValue: (team) => normalizeMetricValue(team.bullpen.fatigueScore),
        format: (value) => fmtNum(value, 0)
      },
      {
        id: 'missingBats',
        label: 'Bajas clave',
        better: 'lower',
        getValue: (team) => normalizeMetricValue(team.lineupContext.missingKeyBatCount ?? 0),
        format: (value) => (value === null ? '-' : value.toFixed(0))
      }
    ]
  }
];

function getStatWinner(
  descriptor: StatDescriptor,
  homeTeam: TeamInput,
  awayTeam: TeamInput,
  game: NormalizedGameData
): ComparisonWinner {
  const homeValue = descriptor.getValue(homeTeam, awayTeam, game);
  const awayValue = descriptor.getValue(awayTeam, homeTeam, game);

  if (homeValue === null || awayValue === null) return null;
  if (Math.abs(homeValue - awayValue) < 0.0001) return null;

  if (descriptor.better === 'higher') {
    return homeValue > awayValue ? 'home' : 'away';
  }

  return homeValue < awayValue ? 'home' : 'away';
}

// Legacy helper kept while migrating the analysis modal copy.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getContextChips(analysis: AnalyzeResponse, game: GameRow) {
  const engineGame = analysis.engineGame;
  const layerA = analysis.layerA;
  const chips: string[] = [];

  if (layerA?.gameScript.f5Viable) chips.push('F5 viable');
  if (layerA?.gameScript.scoringProjection) {
    chips.push(`Scoring ${layerA.gameScript.scoringProjection}`);
  }
  if (engineGame?.parkWeather.venueName) chips.push(engineGame.parkWeather.venueName);
  if (typeof engineGame?.parkWeather.parkFactorRuns === 'number') {
    chips.push(`Park ${engineGame.parkWeather.parkFactorRuns.toFixed(0)}`);
  }
  if (typeof engineGame?.parkWeather.temperatureF === 'number') {
    chips.push(`${engineGame.parkWeather.temperatureF.toFixed(0)}°F`);
  }
  if (typeof engineGame?.parkWeather.windMph === 'number') {
    const direction = engineGame.parkWeather.windDirection && engineGame.parkWeather.windDirection !== 'unknown'
      ? engineGame.parkWeather.windDirection
      : 'wind';
    chips.push(`${direction} ${engineGame.parkWeather.windMph.toFixed(0)} mph`);
  }
  if (typeof engineGame?.marketContextLight.lineMovementPct === 'number') {
    chips.push(`Move ${fmtSigned(engineGame.marketContextLight.lineMovementPct, 1)}%`);
  }
  if (typeof engineGame?.marketContextLight.sharpSignal === 'number') {
    chips.push(`Sharp ${fmtSigned(engineGame.marketContextLight.sharpSignal, 0)}`);
  }
  if (!chips.length) {
    chips.push(game.statusDetail);
  }

  return chips.slice(0, 8);
}

function getArgumentLines(analysis: AnalyzeResponse) {
  const lines = [
    analysis.finalDecision?.reason,
    analysis.uiSummary?.marketView?.reason,
    analysis.uiSummary?.execution?.reason,
    analysis.confirmedPick?.reason
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value, index, array) => array.indexOf(value) === index);

  return lines.slice(0, 3);
}

function getActivePickDescriptor(analysis: AnalyzeResponse) {
  if (analysis.confirmedPick) {
    return {
      market: analysis.confirmedPick.market,
      selection: analysis.confirmedPick.selection,
      line: analysis.confirmedPick.line
    };
  }

  if (analysis.executionRecommendation?.recommendedLine) {
    return {
      market: analysis.executionRecommendation.recommendedLine.marketType,
      selection: analysis.executionRecommendation.recommendedLine.selection,
      line:
        typeof analysis.executionRecommendation.recommendedLine.line === 'number'
          ? analysis.executionRecommendation.recommendedLine.line
          : null
    };
  }

  return {
      market:
      analysis.uiSummary?.finalPick?.market ??
      'PASS',
    selection:
      analysis.uiSummary?.finalPick?.selection ??
      '',
    line: null
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

function matchesSelectionCandidate(
  normalizedSelection: string,
  candidate: string
) {
  return (
    normalizedSelection === candidate ||
    normalizedSelection.startsWith(`${candidate} `)
  );
}

function resolvePickedTeam(game: NormalizedGameData, selection: string) {
  const normalized = normalizeSelectionForTeamMatch(selection);
  const homeCandidates = [
    game.homeTeam.core.teamName,
    game.homeTeam.core.abbreviation
  ]
    .filter(Boolean)
    .map((value) => normalizeEntityName(String(value)));
  const awayCandidates = [
    game.awayTeam.core.teamName,
    game.awayTeam.core.abbreviation
  ]
    .filter(Boolean)
    .map((value) => normalizeEntityName(String(value)));

  if (homeCandidates.some((candidate) => matchesSelectionCandidate(normalized, candidate))) {
    return { team: game.homeTeam, opponent: game.awayTeam, side: 'home' as const };
  }

  if (awayCandidates.some((candidate) => matchesSelectionCandidate(normalized, candidate))) {
    return { team: game.awayTeam, opponent: game.homeTeam, side: 'away' as const };
  }

  return null;
}

function isTotalLikeSelection(selection: string) {
  const normalized = selection.trim().toLowerCase();
  return normalized.startsWith('over') || normalized.startsWith('under');
}

function getMarketFlowSummary(analysis: AnalyzeResponse, game: GameRow) {
  const engineGame = analysis.engineGame;
  const descriptor = getActivePickDescriptor(analysis);
  const movement = engineGame?.marketContextLight.lineMovementPct;
  const sharp = engineGame?.marketContextLight.sharpSignal;

  if (typeof movement !== 'number' && typeof sharp !== 'number') {
    return null;
  }

  const homeName = engineGame?.homeTeam.core.teamName ?? game.homeTeam.name;
  const awayName = engineGame?.awayTeam.core.teamName ?? game.awayTeam.name;
  const directionalScore = (typeof movement === 'number' ? movement : 0) + (typeof sharp === 'number' ? sharp : 0);
  const favoredSide = directionalScore > 0 ? 'home' : directionalScore < 0 ? 'away' : null;
  const favoredTeam = favoredSide === 'home' ? homeName : favoredSide === 'away' ? awayName : null;
  const pickedTeam = engineGame ? resolvePickedTeam(engineGame, descriptor.selection) : null;

  if (descriptor.market === 'TOTAL' || (descriptor.market === 'F5' && isTotalLikeSelection(descriptor.selection))) {
    const totalSide = descriptor.selection.toLowerCase().startsWith('under') ? 'under' : 'over';
    if (!favoredTeam) {
      return `El moneyline pregame sigue bastante parejo; no hay una corriente clara a favor o en contra del ${totalSide}.`;
    }

    return `El flujo principal del moneyline se inclina hacia ${favoredTeam} con movimiento ${fmtSigned(movement, 1)}% y señal sharp ${fmtSigned(sharp, 0)}. Para este ${totalSide}, eso funciona mas como contexto del guion del juego que como confirmacion directa del total.`;
  }

  if (!pickedTeam || !favoredTeam || !favoredSide) {
    return `El mercado previo sigue bastante neutro: movimiento ${fmtSigned(movement, 1)}% y señal sharp ${fmtSigned(sharp, 0)} sin una direccion dominante clara.`;
  }

  const supportsPick = pickedTeam.side === favoredSide;
  return supportsPick
    ? `El mercado llega a favor del pick: ${favoredTeam} gana traccion con movimiento ${fmtSigned(movement, 1)}% y señal sharp ${fmtSigned(sharp, 0)}.`
    : `El mercado llega en contra del pick: el flujo se esta yendo hacia ${favoredTeam} con movimiento ${fmtSigned(movement, 1)}% y señal sharp ${fmtSigned(sharp, 0)}.`;
}

function describeBullpenSource(
  teamName: string,
  bullpen: NormalizedGameData['homeTeam']['bullpen']
) {
  const label = bullpen.sourceLabel ?? (bullpen.isFallback ? 'Fallback' : 'Real');
  const status = bullpen.isFallback ? 'fallback' : 'real';
  const reason = bullpen.fallbackReason ? `; motivo: ${bullpen.fallbackReason}` : '';
  return `${teamName}: ${label} (${status})${reason}`;
}

function getBullpenSourceSummary(game?: NormalizedGameData | null) {
  if (!game) return null;

  return `Bullpen source -> ${describeBullpenSource(game.awayTeam.core.teamName, game.awayTeam.bullpen)} / ${describeBullpenSource(game.homeTeam.core.teamName, game.homeTeam.bullpen)}.`;
}

function getContextLinesVerbose(analysis: AnalyzeResponse, game: GameRow) {
  const engineGame = analysis.engineGame;
  const layerA = analysis.layerA;
  const descriptor = getActivePickDescriptor(analysis);
  const lines: string[] = [];

  if (engineGame?.parkWeather.venueName) {
    const totalLabel =
      descriptor.market === 'TOTAL' || descriptor.market === 'F5'
        ? ` para sostener ${descriptor.market === 'F5' ? 'la lectura corta F5' : 'el total elegido'}`
        : '';
    const parkSummary =
      typeof engineGame.parkWeather.parkFactorRuns === 'number'
        ? `El parque llega con factor ${engineGame.parkWeather.parkFactorRuns.toFixed(0)}, ${engineGame.parkWeather.parkFactorRuns >= 103 ? 'un entorno algo mas ofensivo' : engineGame.parkWeather.parkFactorRuns <= 97 ? 'un entorno un poco mas contenido' : 'sin sesgo fuerte de carreras'}${totalLabel}.`
        : 'No hay una lectura extrema del parque en el run environment.';
    const weatherBits = [
      typeof engineGame.parkWeather.temperatureF === 'number' ? `${engineGame.parkWeather.temperatureF.toFixed(0)}F` : null,
      typeof engineGame.parkWeather.windMph === 'number' ? `${engineGame.parkWeather.windMph.toFixed(0)} mph ${engineGame.parkWeather.windDirection ?? 'wind'}` : null
    ].filter(Boolean);
    lines.push(`Se juega en ${engineGame.parkWeather.venueName}. ${parkSummary}${weatherBits.length ? ` Clima esperado: ${weatherBits.join(', ')}.` : ''}`);
  }

  if (layerA?.gameScript) {
    const scriptText =
      descriptor.market === 'F5'
        ? `El script pregame marca scoring ${layerA.gameScript.scoringProjection} y deja ${layerA.gameScript.f5Viable ? 'abierta' : 'mas fragil'} la ventana de los primeros cinco innings.`
        : descriptor.market === 'TOTAL'
          ? `El script del juego viene ${layerA.gameScript.scoringProjection}, por eso el total toma mas peso en ofensiva, abridores y run environment.`
          : `El script pregame proyecta una ventaja ${layerA.gameScript.advantageSide.replace('_', ' ')} con scoring ${layerA.gameScript.scoringProjection}.`;
    lines.push(scriptText);
  }

  const marketFlow = getMarketFlowSummary(analysis, game);
  if (marketFlow) {
    lines.push(marketFlow);
  }

  const bullpenSource = getBullpenSourceSummary(engineGame);
  if (bullpenSource) {
    lines.push(bullpenSource);
  }

  if (!lines.length) {
    lines.push(`El contexto disponible para este juego sigue siendo ${game.statusDetail}.`);
  }

  return lines.slice(0, 4);
}

function getArgumentLinesVerbose(analysis: AnalyzeResponse) {
  const game = analysis.engineGame;
  const layerA = analysis.layerA;
  const descriptor = getActivePickDescriptor(analysis);
  const lines: string[] = [];

  if (
    game &&
    (descriptor.market === 'ML' ||
      descriptor.market === 'RL' ||
      (descriptor.market === 'F5' && !isTotalLikeSelection(descriptor.selection)))
  ) {
    const picked = resolvePickedTeam(game, descriptor.selection) ?? {
      team: game.awayTeam,
      opponent: game.homeTeam,
      side: 'away' as const
    };
    const selectedTeam = picked.team;
    const opponent = picked.opponent;

    if (descriptor.market === 'F5') {
      lines.push(
        `La tesis esta concentrada en los primeros cinco innings: ${selectedTeam.core.teamName} llega con ventaja de abridor y forma inmediata, antes de que el bullpen empiece a dominar el guion. ERA/WHIP del abridor ${fmtNum(selectedTeam.starter.era, 2)} / ${fmtNum(selectedTeam.starter.whip, 2)} contra ${fmtNum(opponent.starter.era, 2)} / ${fmtNum(opponent.starter.whip, 2)} del rival.`
      );
      lines.push(
        `${selectedTeam.core.teamName} tambien trae mejor apoyo ofensivo temprano con OPS ${fmtNum(selectedTeam.offense.ops, 3)} y split util ${fmtNum(getRelevantSplitOps(selectedTeam, opponent), 3)}, mientras ${opponent.core.teamName} llega con ${fmtNum(opponent.offense.ops, 3)} y un bloque de ataque ${fmtSigned(layerA?.blockScores.offense ?? 0, 0)} menos convincente.`
      );
      lines.push(
        `Por eso el pick no se apoya tanto en el cierre del juego: busca capturar la parte mas limpia del matchup, donde abridor, lineup y forma reciente pesan mas que el bullpen.`
      );
    } else if (descriptor.market === 'RL') {
      lines.push(
        `${selectedTeam.core.teamName} no solo queda arriba para ganar; el modelo ve margen suficiente para usar run line. La diferencia viene del combo abridor ${fmtNum(selectedTeam.starter.era, 2)} vs ${fmtNum(opponent.starter.era, 2)}, ofensiva ${fmtNum(selectedTeam.offense.ops, 3)} vs ${fmtNum(opponent.offense.ops, 3)} y diferencial por juego ${fmtSigned(selectedTeam.core.runDifferentialPerGame, 2)} vs ${fmtSigned(opponent.core.runDifferentialPerGame, 2)}.`
      );
      lines.push(
        `El bloque de sides favorece a ${selectedTeam.core.teamName} con starter ${fmtSigned(layerA?.blockScores.starter ?? 0, 0)}, offense ${fmtSigned(layerA?.blockScores.offense ?? 0, 0)} y team strength ${fmtSigned(layerA?.blockScores.teamStrength ?? 0, 0)}. Esa mezcla es la que permite salir del moneyline puro.`
      );
      lines.push(
        `Si el juego se mantiene cerrado, el pick todavia tiene respaldo por bullpen ${fmtNum(selectedTeam.bullpen.era, 2)} y fatiga ${fmtNum(selectedTeam.bullpen.fatigueScore, 0)} frente a ${fmtNum(opponent.bullpen.era, 2)} y ${fmtNum(opponent.bullpen.fatigueScore, 0)} del rival.`
      );
    } else {
      lines.push(
        `${selectedTeam.core.teamName} queda por encima en moneyline porque el modelo junta abridor, ataque y contexto del lineup, no una sola metrica aislada. El bloque starter/offense viene en ${fmtSigned(layerA?.blockScores.starter ?? 0, 0)} / ${fmtSigned(layerA?.blockScores.offense ?? 0, 0)}.`
      );
      lines.push(
        `En el cruce puro de stats, ${selectedTeam.core.teamName} trae OPS ${fmtNum(selectedTeam.offense.ops, 3)} contra ${fmtNum(opponent.offense.ops, 3)} del rival, mientras el abridor proyectado marca ERA ${fmtNum(selectedTeam.starter.era, 2)} frente a ${fmtNum(opponent.starter.era, 2)}. Esa mezcla sostiene el lado elegido sin exigir un margen tan agresivo como un run line.`
      );
      lines.push(
        `El cierre tambien cuenta: bullpen ${fmtNum(selectedTeam.bullpen.era, 2)} y fatiga ${fmtNum(selectedTeam.bullpen.fatigueScore, 0)} versus ${fmtNum(opponent.bullpen.era, 2)} y ${fmtNum(opponent.bullpen.fatigueScore, 0)}. Si el juego se aprieta tarde, esa capa sigue respaldando la decision.`
      );
    }
  }

  if (game && (descriptor.market === 'TOTAL' || (descriptor.market === 'F5' && isTotalLikeSelection(descriptor.selection)))) {
    const totalSide = descriptor.selection.toLowerCase().startsWith('under') ? 'under' : 'over';
    const isOver = totalSide === 'over';

    lines.push(
      isOver
        ? `El over sale porque el matchup trae suficiente empuje de carreras: ofensivas recientes de ${fmtNum(game.awayTeam.offense.last7RunsPerGame, 2)} y ${fmtNum(game.homeTeam.offense.last7RunsPerGame, 2)} por juego, con un entorno que no castiga demasiado el scoring.`
        : `El under sale porque el modelo ve menos carreras de las que sugiere el precio: los abridores y el contexto del parque enfrían el guion, y la forma reciente no exige un intercambio tan alto.`
    );
    lines.push(
      isOver
        ? `Los abridores no llegan con un perfil tan dominante para apagar bates todo el juego: ERA ${fmtNum(game.awayTeam.starter.era, 2)} y ${fmtNum(game.homeTeam.starter.era, 2)}, mientras los bullpens traen ERA ${fmtNum(game.awayTeam.bullpen.era, 2)} y ${fmtNum(game.homeTeam.bullpen.era, 2)}.`
        : `Los abridores llegan mejor armados para contener: ERA ${fmtNum(game.awayTeam.starter.era, 2)} y ${fmtNum(game.homeTeam.starter.era, 2)}, con apoyo de bullpens ${fmtNum(game.awayTeam.bullpen.era, 2)} y ${fmtNum(game.homeTeam.bullpen.era, 2)} que no fuerzan un over por desgaste.`
    );
    lines.push(
      isOver
        ? `El parque y el clima tambien empujan la lectura: factor ${fmtNum(game.parkWeather.parkFactorRuns, 0)}, viento ${fmtNum(game.parkWeather.windMph, 0)} mph y block park/weather ${fmtSigned(layerA?.blockScores.parkWeather ?? 0, 0)}.`
        : `El parque y el clima ayudan a bajar volatilidad: factor ${fmtNum(game.parkWeather.parkFactorRuns, 0)}, viento ${fmtNum(game.parkWeather.windMph, 0)} mph y block park/weather ${fmtSigned(layerA?.blockScores.parkWeather ?? 0, 0)}.`
    );
  }

  for (const fallback of getArgumentLines(analysis)) {
    if (!lines.includes(fallback)) {
      lines.push(fallback);
    }
  }

  return lines.slice(0, 3);
}

function MetricRail({
  label,
  value,
  max,
  format
}: {
  label: string;
  value: number | null | undefined;
  max: number;
  format: (value: number | null | undefined) => string;
}) {
  const rating = getMetricRating(label, value);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--ink-soft)]">
        <span>{label}</span>
        <span className="font-semibold text-[var(--ink-strong)]">{format(value)}</span>
      </div>
      <div className="metric-bar-track h-2.5">
        <div className={`h-full rounded-full ${qualityBarClasses(rating)}`} style={{ width: `${metricFill(value ?? 0, max)}%` }} />
      </div>
    </div>
  );
}

function StatGroupCard({
  group,
  game
}: {
  group: StatGroup;
  game: NormalizedGameData;
}) {
  return (
    <section className="rounded-[1.35rem] border border-[var(--line-soft)] bg-white/78 p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">
        {group.eyebrow}
      </div>
      <h4 className="mt-1 text-base font-semibold text-[var(--ink-strong)]">{group.title}</h4>

      <div className="mt-3 space-y-2.5">
        {group.stats.map((descriptor) => {
          const homeValue = descriptor.getValue(game.homeTeam, game.awayTeam, game);
          const awayValue = descriptor.getValue(game.awayTeam, game.homeTeam, game);
          const winner = getStatWinner(descriptor, game.homeTeam, game.awayTeam, game);
          const awayClass =
            winner === 'away'
              ? 'text-emerald-600'
              : winner === 'home'
                ? 'text-[var(--ink-muted)]'
                : 'text-[var(--ink-strong)]';
          const homeClass =
            winner === 'home'
              ? 'text-emerald-600'
              : winner === 'away'
                ? 'text-[var(--ink-muted)]'
                : 'text-[var(--ink-strong)]';

          return (
            <div
              key={descriptor.id}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[1rem] bg-[var(--surface-soft)] px-3 py-2"
            >
              <div className={`text-sm font-semibold ${awayClass}`}>{descriptor.format(awayValue)}</div>
              <div className="text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                {descriptor.label}
              </div>
              <div className={`text-right text-sm font-semibold ${homeClass}`}>{descriptor.format(homeValue)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const AnalysisModal = memo(function AnalysisModal({
  open,
  game,
  analysis,
  meta,
  executionOptions,
  selectedExecutionSlot,
  onSelectExecutionSlot,
  actualOddsInput,
  actualLineInput,
  onActualOddsChange,
  onActualLineChange,
  onConfirm,
  confirmLoading,
  confirmError,
  confirmResult,
  analysisLoading,
  analysisError,
  onClose
}: {
  open: boolean;
  game: GameRow | null;
  analysis: AnalyzeResponse | null;
  meta: CardMeta | null;
  executionOptions: Array<{ slot: ExecutionSlot; label: string; line: ExecutionLine }>;
  selectedExecutionSlot: ExecutionSlot;
  onSelectExecutionSlot: (slot: ExecutionSlot) => void;
  actualOddsInput: string;
  actualLineInput: string;
  onActualOddsChange: (value: string) => void;
  onActualLineChange: (value: string) => void;
  onConfirm: () => void;
  confirmLoading: boolean;
  confirmError: string | null;
  confirmResult: ConfirmResult | null;
  analysisLoading: boolean;
  analysisError: string | null;
  onClose: () => void;
}) {
  const engineGame = analysis?.engineGame ?? null;
  const contextChips = useMemo(
    () => (analysis && game ? getContextLinesVerbose(analysis, game) : []),
    [analysis, game]
  );
  const argumentLines = useMemo(
    () => (analysis ? getArgumentLinesVerbose(analysis) : []),
    [analysis]
  );
  const alertLines = useMemo(
    () => analysis?.pickLock?.alerts ?? [],
    [analysis?.pickLock?.alerts]
  );
  const activeExecution = useMemo(
    () => executionOptions.find((item) => item.slot === selectedExecutionSlot)?.line ?? null,
    [executionOptions, selectedExecutionSlot]
  );
  const activeDescriptor = useMemo(() => (analysis ? getActivePickDescriptor(analysis) : null), [analysis]);
  const noBetExecutionDetail = useMemo(() => getNoBetExecutionDetail(analysis), [analysis]);
  const dataQuality = useMemo(() => getDataQualitySummary(engineGame), [engineGame]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

    window.requestAnimationFrame(() => {
      (closeButtonRef.current ?? dialog).focus();
    });

    const handleTrap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleTrap);
    return () => {
      dialog.removeEventListener('keydown', handleTrap);
    };
  }, [open]);

  if (!open || !game) return null;

  return (
    <div className="fixed inset-0 z-50 p-3 md:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar análisis"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(4,12,28,0.58)] backdrop-blur-[6px]"
      />

      <div className="relative mx-auto flex h-full max-w-[1500px] items-center justify-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Análisis del juego"
          tabIndex={-1}
          className="relative max-h-[92vh] w-full overflow-y-auto rounded-[2rem] border border-[rgba(255,255,255,0.18)] bg-[linear-gradient(180deg,rgba(255,253,250,0.98),rgba(245,241,233,0.97))] p-4 shadow-[0_36px_120px_rgba(6,22,47,0.38)] md:p-5"
        >
          <div className="absolute inset-x-0 top-0 h-28 rounded-t-[2rem] bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.2),transparent_52%),radial-gradient(circle_at_top_right,rgba(244,63,94,0.18),transparent_44%)]" />

          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[rgba(8,26,53,0.1)] bg-white/72 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                    Analysis lab
                  </span>
                  {meta && (
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${toneClasses(meta.tone)}`}>
                      {meta.label}
                    </span>
                  )}
                  {analysis?.executionRecommendation?.tier && (
                    <span className="rounded-full border border-[rgba(8,26,53,0.1)] bg-[var(--surface-soft)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                      Tier {analysis.executionRecommendation.tier}
                    </span>
                  )}
                </div>
                <h3 className="mt-3 font-heading text-[1.8rem] font-semibold text-[var(--ink-strong)] md:text-[2.35rem]">
                  {game.awayTeam.name} @ {game.homeTeam.name}
                </h3>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  {game.statusDetail} / {fmtDate(game.date)}
                </p>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded-full border border-[var(--line-soft)] bg-white/82 p-2.5 text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
              <div className="space-y-4">
                <section className="rounded-[1.7rem] bg-[linear-gradient(135deg,rgba(9,28,57,0.98),rgba(16,44,84,0.92))] p-4 text-white shadow-[0_20px_48px_rgba(9,28,57,0.24)]">
                  <div className="grid gap-3 md:grid-cols-2">
                    {[game.awayTeam, game.homeTeam].map((team) => (
                      <div key={`${game.gameId}-modal-${team.abbr}`} className="rounded-[1.2rem] border border-white/10 bg-white/6 p-3">
                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                          <TeamLogo src={team.logo} alt={team.abbr} color={team.color} alternateColor={team.alternateColor} />
                          <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-white">{team.name}</div>
                            <div className="text-xs text-white/62">{team.record ?? team.abbr}</div>
                          </div>
                          <div className="font-heading text-3xl font-semibold text-white">{team.score ?? '-'}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <MiniBoxscore game={game} />
                </section>

                {analysisLoading && !analysis ? (
                  <div className="glass-panel rounded-[1.5rem] p-5 text-sm text-[var(--ink-soft)]">
                    Armando el análisis del juego...
                  </div>
                ) : engineGame ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {STAT_GROUPS.map((group) => (
                      <StatGroupCard key={group.title} group={group} game={engineGame} />
                    ))}
                  </div>
                ) : (
                  <div className="glass-panel rounded-[1.5rem] p-5 text-sm text-[var(--ink-soft)]">
                    El análisis todavía no trajo las estadísticas comparables del matchup.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <section className="glass-panel rounded-[1.6rem] p-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[1.2rem] bg-[var(--surface-soft)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Lock</div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink-strong)]">
                        {analysis?.pickLock?.stage ? `Stage ${analysis.pickLock.stage}` : 'Pendiente'}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {analysis?.pickLock?.lastUpdatedAt ? fmtDate(analysis.pickLock.lastUpdatedAt) : 'Sin snapshot'}
                      </div>
                    </div>
                    <div className="rounded-[1.2rem] bg-[var(--surface-soft)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Pregame score</div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink-strong)]">
                        {fmtNum(analysis?.uiSummary?.pregameScore, 1)}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">{analysis?.uiSummary?.confidence ?? 'Sin lectura'}</div>
                    </div>
                    <div className="rounded-[1.2rem] bg-[var(--surface-soft)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Estado</div>
                      <div className="mt-1 text-base font-semibold text-[var(--ink-strong)]">
                        {meta?.sublabel ?? 'Sin lectura'}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {noBetExecutionDetail ?? meta?.selection ?? 'Sin pick activo'}
                      </div>
                    </div>
                    <div className="rounded-[1.2rem] bg-[var(--surface-soft)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Data quality</div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className={`h-2.5 w-2.5 rounded-full ${dataQuality.rating === 'good' ? 'bg-emerald-500' : dataQuality.rating === 'mid' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                        <div className="text-base font-semibold text-[var(--ink-strong)]">{dataQuality.label}</div>
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {(dataQuality.score * 100).toFixed(0)}% de cobertura crítica
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[1.3rem] border border-[rgba(8,26,53,0.08)] bg-white/76 p-4">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Pick del modelo</div>
                    {activeDescriptor && activeDescriptor.market !== 'PASS' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                          {activeDescriptor.market}
                        </span>
                        {typeof activeDescriptor.line === 'number' && (
                          <span className="rounded-full border border-[var(--line-soft)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                            {renderLineBadgeText(activeDescriptor.selection, activeDescriptor.line, activeDescriptor.market)}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">
                      {activeDescriptor?.selection
                        ? renderPickLabel(activeDescriptor.selection, activeDescriptor.line, activeDescriptor.market)
                        : 'Sin lectura final'}
                    </div>
                    <div className="mt-1 text-sm text-[var(--ink-soft)]">
                      {analysis?.confirmedPick
                        ? `Cuota confirmada ${fmtNum(analysis.confirmedPick.odds)}`
                        : analysis?.executionRecommendation?.recommendedLine
                          ? `${renderPickLabel(
                              analysis.executionRecommendation.recommendedLine.selection,
                              analysis.executionRecommendation.recommendedLine.line,
                              analysis.executionRecommendation.recommendedLine.marketType
                            )} @ ${fmtNum(analysis.executionRecommendation.recommendedLine.odds)}`
                          : analysis?.uiSummary?.marketView?.selection ?? 'Sin mercado visible'}
                    </div>

                    <div className="mt-4 space-y-3">
                      <MetricRail
                        label="Probabilidad"
                        value={(analysis?.uiSummary?.finalPick?.probability ?? 0) * 100}
                        max={100}
                        format={(value) => fmtProb(typeof value === 'number' ? value / 100 : null)}
                      />
                      <MetricRail
                        label="Edge"
                        value={analysis?.uiSummary?.finalPick?.edge}
                        max={0.18}
                        format={(value) => fmtNum(value, 3)}
                      />
                      <MetricRail
                        label="EV"
                        value={analysis?.uiSummary?.finalPick?.ev}
                        max={0.14}
                        format={(value) => fmtNum(value, 3)}
                      />
                    </div>
                  </div>
                </section>

                <section className="glass-panel rounded-[1.6rem] p-4">
                  <div className="mb-4 rounded-[1rem] border border-[rgba(8,26,53,0.08)] bg-white/72 px-3 py-2.5 text-sm text-[var(--ink-soft)]">
                    {dataQuality.detail}
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Contexto</div>
                      <div className="mt-3 space-y-2">
                        {contextChips.map((chip) => (
                          <div
                            key={chip}
                            className="rounded-[1rem] border border-[rgba(8,26,53,0.08)] bg-white/72 px-3 py-2.5 text-sm text-[var(--ink-soft)]"
                          >
                            {chip}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Argumento</div>
                      <div className="mt-3 space-y-2">
                        {argumentLines.length ? (
                          argumentLines.map((line) => (
                            <div
                              key={line}
                              className="rounded-[1rem] border border-[rgba(8,26,53,0.08)] bg-white/72 px-3 py-2.5 text-sm text-[var(--ink-soft)]"
                            >
                              {line}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[1rem] border border-[rgba(8,26,53,0.08)] bg-white/72 px-3 py-2.5 text-sm text-[var(--ink-soft)]">
                            Sin argumento adicional visible en este snapshot.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Alertas de mercado</div>
                    <div className="mt-3 space-y-2">
                      {alertLines.length ? (
                        alertLines.map((alert, index) => (
                          <div
                            key={`${alert}-${index}`}
                            className="rounded-[1rem] border border-[rgba(210,166,73,0.22)] bg-[rgba(210,166,73,0.08)] px-3 py-2.5 text-sm text-[#6d5220]"
                          >
                            {alert}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[1rem] border border-[rgba(8,26,53,0.08)] bg-white/72 px-3 py-2.5 text-sm text-[var(--ink-soft)]">
                          Sin alertas relevantes en lineas o cuotas para este snapshot.
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="glass-panel rounded-[1.6rem] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Execution desk</div>
                      <h4 className="mt-1 text-lg font-semibold text-[var(--ink-strong)]">Cuota real y pick final</h4>
                    </div>
                    <div className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-soft)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                      {analysis?.finalDecision?.status ?? '-'}
                    </div>
                  </div>

                  {analysis?.confirmedPick ? (
                    <div className="mt-4 rounded-[1.25rem] border border-[rgba(56,189,248,0.18)] bg-[linear-gradient(135deg,rgba(56,189,248,0.08),rgba(244,63,94,0.08))] p-4">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Pick elegido</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[var(--line-soft)] bg-[var(--surface-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                          {analysis.confirmedPick.market}
                        </span>
                        {typeof analysis.confirmedPick.line === 'number' && (
                          <span className="rounded-full border border-[var(--line-soft)] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                            {renderLineBadgeText(analysis.confirmedPick.selection, analysis.confirmedPick.line, analysis.confirmedPick.market)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xl font-semibold text-[var(--ink-strong)]">
                        {renderPickLabel(analysis.confirmedPick.selection, analysis.confirmedPick.line, analysis.confirmedPick.market)}
                      </div>
                      <div className="mt-1 text-sm text-[var(--ink-soft)]">
                        Cuota confirmada {fmtNum(analysis.confirmedPick.odds)} / {analysis.confirmedPick.reason}
                      </div>
                      <div className="mt-3 text-xs text-[var(--ink-soft)]">
                        {analysis.resultSummary?.result ?? 'Pendiente'} / {fmtUnits(analysis.resultSummary?.profitUnits)}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        {executionOptions.map((option) => (
                          <button
                            key={option.slot}
                            type="button"
                            onClick={() => onSelectExecutionSlot(option.slot)}
                            className={`rounded-[1.1rem] border px-3 py-3 text-left transition ${
                              selectedExecutionSlot === option.slot
                                ? 'border-[rgba(29,78,216,0.24)] bg-[rgba(29,78,216,0.06)]'
                                : 'border-[var(--line-soft)] bg-white hover:border-[rgba(9,28,57,0.14)]'
                            }`}
                          >
                            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">{option.label}</div>
                            <div className="mt-1 text-sm font-semibold text-[var(--ink-strong)]">
                              {renderPickLabel(option.line.selection, option.line.line, option.line.marketType)}
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--ink-soft)]">
                              <span>{option.line.marketType}</span>
                              <span className="font-semibold text-[var(--ink-strong)]">{fmtNum(option.line.odds)}</span>
                            </div>
                          </button>
                        ))}
                      </div>

                      {!executionOptions.length && (
                        <div className="mt-4 rounded-[1.15rem] border border-[var(--line-soft)] bg-[var(--surface-soft)] p-3.5 text-sm text-[var(--ink-soft)]">
                          No hay línea ejecutable en esta actualización.
                        </div>
                      )}

                      {!!executionOptions.length && (
                        <div className="mt-4 grid gap-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            {activeExecution?.line !== undefined ? (
                              <label className="space-y-1.5">
                                <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Línea real</span>
                                <input
                                  type="number"
                                  step="0.5"
                                  value={actualLineInput}
                                  onChange={(event) => onActualLineChange(event.target.value)}
                                  placeholder="Ej. 7.5"
                                  className="w-full rounded-[1rem] border border-[var(--line-soft)] bg-white px-3.5 py-2.5 text-sm text-[var(--ink-strong)] placeholder:text-[var(--ink-muted)]"
                                />
                              </label>
                            ) : (
                              <div className="rounded-[1rem] border border-[var(--line-soft)] bg-[var(--surface-soft)] px-3.5 py-2.5 text-sm text-[var(--ink-soft)]">
                                Sin línea adicional requerida.
                              </div>
                            )}

                            <label className="space-y-1.5">
                              <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">Cuota real</span>
                              <input
                                type="number"
                                step="0.01"
                                min="1"
                                value={actualOddsInput}
                                onChange={(event) => onActualOddsChange(event.target.value)}
                                placeholder="Ej. 1.78"
                                className="w-full rounded-[1rem] border border-[var(--line-soft)] bg-white px-3.5 py-2.5 text-sm text-[var(--ink-strong)] placeholder:text-[var(--ink-muted)]"
                              />
                            </label>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
                            <span>
                              Activa: {activeExecution ? `${renderPickLabel(activeExecution.selection, activeExecution.line, activeExecution.marketType)} @ ${fmtNum(activeExecution.odds)}` : '-'}
                            </span>
                            <button
                              onClick={onConfirm}
                              disabled={confirmLoading}
                              className="rounded-full bg-[var(--surface-navy)] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(9,28,57,0.16)] transition hover:bg-[rgba(9,28,57,0.92)] disabled:opacity-50"
                            >
                              {confirmLoading ? 'Confirmando...' : 'Confirmar pick'}
                            </button>
                          </div>

                          {confirmError && (
                            <div className="rounded-[1rem] border border-[rgba(215,38,61,0.18)] bg-[rgba(215,38,61,0.08)] p-3 text-sm text-[#8f2330]">
                              {confirmError}
                            </div>
                          )}

                          {confirmResult && confirmResult.status !== 'CONFIRMED' && (
                            <div className="rounded-[1rem] border border-[var(--line-soft)] bg-[var(--surface-soft)] p-3 text-sm text-[var(--ink-soft)]">
                              Status {confirmResult.status} / {confirmResult.reason}
                              {confirmResult.nextAlternative
                                ? ` / Siguiente: ${renderPickLabel(confirmResult.nextAlternative.selection, confirmResult.nextAlternative.line)} @ ${fmtNum(confirmResult.nextAlternative.odds)}`
                                : ''}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </section>

                {(analysisError || analysisLoading) && (
                  <div className="glass-panel rounded-[1.4rem] p-4 text-sm text-[var(--ink-soft)]">
                    {analysisError ?? 'Actualizando análisis del juego seleccionado...'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, (previous, next) => {
  if (previous.open === true || next.open === true) {
    return false;
  }

  if (!previous.open && !next.open) {
    return true;
  }

  return false;
});

function getCardMeta(game: GameRow, analysis: AnalyzeResponse | null): CardMeta {
  if (analysis?.confirmedPick) {
    const status = analysis.confirmedPick.status;
    return {
      tone:
        status === 'won' || status === 'lost' || status === 'void' || status === 'pending'
          ? status
          : 'pending',
      label: status.toUpperCase(),
      sublabel: 'Pick ejecutado',
      selection: renderPickLabel(analysis.confirmedPick.selection, analysis.confirmedPick.line, analysis.confirmedPick.market),
      hasActivePick: true,
      market: analysis.confirmedPick.market,
      confidence: analysis.uiSummary?.finalPick?.confidence ?? analysis.executionRecommendation?.tier ?? game.analysis.confidence,
      odds: analysis.confirmedPick.odds ?? null
    };
  }

  if (game.analysis.hasActivePick) {
    const activeStatus = game.analysis.status;
    return {
      tone:
        activeStatus === 'won' || activeStatus === 'lost' || activeStatus === 'void' || activeStatus === 'pending'
          ? activeStatus
          : 'pending',
      label: activeStatus.toUpperCase(),
      sublabel: 'Pick en ledger',
      selection: game.analysis.selection ? renderPickLabel(game.analysis.selection, game.analysis.line, game.analysis.market) : null,
      hasActivePick: true,
      market: game.analysis.market ?? null,
      confidence: game.analysis.confidence ?? null,
      odds: game.analysis.odds ?? null
    };
  }

  const isNoBet =
    analysis?.uiSummary?.finalPick?.market === 'PASS' ||
    analysis?.uiSummary?.execution?.status === 'NO_BET' ||
    game.analysis.status === 'no_bet';

  if (isNoBet) {
    const hasModelLean =
      Boolean(analysis?.uiSummary?.finalPick) &&
      analysis?.uiSummary?.finalPick?.market !== 'PASS';

    return {
      tone: 'audited',
      label: 'AUDITED',
      sublabel: hasModelLean ? 'Sin linea ejecutable' : 'Sin apuesta',
      selection: null,
      hasActivePick: false,
      market: null,
      confidence: null,
      odds: null
    };
  }

  const selection = analysis?.uiSummary?.finalPick?.selection ?? game.analysis.selection;
  if (selection) {
    return {
      tone: 'lean',
      label: 'LEAN',
      sublabel: analysis?.uiSummary?.finalPick?.confidence ?? game.analysis.confidence ?? 'Modelo',
      selection: renderPickLabel(
        selection,
        analysis?.uiSummary?.execution?.line ?? game.analysis.line,
        analysis?.uiSummary?.finalPick?.market ?? game.analysis.market
      ),
      hasActivePick: false,
      market: analysis?.uiSummary?.finalPick?.market ?? game.analysis.market ?? null,
      confidence: analysis?.uiSummary?.finalPick?.confidence ?? game.analysis.confidence ?? null,
      odds: analysis?.uiSummary?.execution?.odds ?? game.analysis.odds ?? null
    };
  }

  return {
    tone: game.analysis.analyzed ? 'audited' : 'new',
    label: game.analysis.analyzed ? 'AUDITED' : 'NEW',
    sublabel: game.analysis.analyzed ? 'Listo para revisar' : 'Pendiente de lectura',
    selection: null,
    hasActivePick: false,
    market: null,
    confidence: null,
    odds: null
  };
}

function getNoBetExecutionDetail(analysis: AnalyzeResponse | null) {
  const finalPick = analysis?.uiSummary?.finalPick;
  if (!analysis || !finalPick || finalPick.market === 'PASS') {
    return null;
  }

  return (
    analysis.uiSummary?.execution?.reason ??
    analysis.finalDecision?.reason ??
    null
  );
}

function getGameStateBadge(game: GameRow) {
  if (game.state === 'in') {
    return {
      label: 'LIVE',
      detail: game.statusDetail,
      className: 'border-rose-200 bg-rose-50 text-rose-700'
    };
  }

  if (game.completed) {
    return {
      label: 'FINAL',
      detail: null,
      className: 'border-slate-200 bg-slate-50 text-slate-700'
    };
  }

  return {
    label: 'UP NEXT',
    detail:
      formatDateTimeForTimezone(game.date, 'es-CL', {
        hour: 'numeric',
        minute: '2-digit'
      }) ?? fmtDate(game.date),
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
  };
}

function getInningHeaders(game: GameRow) {
  if (game.innings <= 0) return [];
  return Array.from({ length: Math.min(Math.max(game.innings, 5), 10) }, (_, index) => index + 1);
}

function MiniBoxscore({ game }: { game: GameRow }) {
  const headers = getInningHeaders(game);

  if (!headers.length) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--ink-muted)]">
        <div className="rounded-2xl bg-[var(--surface-soft)] px-3 py-2">{game.awayTeam.record ?? game.awayTeam.name}</div>
        <div className="rounded-2xl bg-[var(--surface-soft)] px-3 py-2">{game.homeTeam.record ?? game.homeTeam.name}</div>
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-[1.25rem] border border-[var(--line-soft)] bg-[var(--surface-soft)] px-3 py-2.5">
      <table className="min-w-full text-center text-[10px] text-[var(--ink-soft)]">
        <thead className="uppercase tracking-[0.18em] text-[var(--ink-muted)]">
          <tr>
            <th className="pb-2 pr-2 text-left">Club</th>
            {headers.map((inning) => (
              <th key={`${game.gameId}-${inning}`} className="px-1 pb-2">{inning}</th>
            ))}
            <th className="px-1 pb-2">R</th>
            <th className="px-1 pb-2">H</th>
            <th className="px-1 pb-2">E</th>
          </tr>
        </thead>
        <tbody>
          {[game.awayTeam, game.homeTeam].map((team) => (
            <tr key={`${game.gameId}-${team.abbr}`} className="border-t border-[rgba(9,28,57,0.06)]">
              <td className="py-2 pr-2 text-left font-semibold text-[var(--ink-strong)]">{team.abbr}</td>
              {headers.map((inning) => (
                <td key={`${team.abbr}-${inning}`} className="px-1 py-2">{team.linescores[inning - 1] ?? '-'}</td>
              ))}
              <td className="px-1 py-2 font-semibold text-[var(--ink-strong)]">{team.score ?? '-'}</td>
              <td className="px-1 py-2">{team.hits ?? '-'}</td>
              <td className="px-1 py-2">{team.errors ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type GameCardProps = {
  game: GameRow;
  selected: boolean;
  meta: CardMeta;
  onSelectGame: (gameId: string) => void;
};

const GameCard = memo(function GameCard({
  game,
  selected,
  meta,
  onSelectGame
}: GameCardProps) {
  const stateBadge = getGameStateBadge(game);
  const handleSelect = useCallback(() => {
    onSelectGame(game.gameId);
  }, [onSelectGame, game.gameId]);

  return (
    <button
      type="button"
      onClick={handleSelect}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '320px' }}
      className={`group w-full rounded-[1.5rem] border p-3.5 text-left transition duration-150 ${selected ? 'border-[rgba(29,78,216,0.28)] bg-white shadow-[0_20px_36px_rgba(9,28,57,0.1)]' : 'border-[var(--line-soft)] bg-[rgba(255,255,255,0.86)] hover:border-[rgba(9,28,57,0.14)] hover:bg-white'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${stateBadge.className}`}>
              {stateBadge.label}
            </span>
            {stateBadge.detail && (
              <span className="rounded-full border border-[rgba(9,28,57,0.08)] bg-white px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-[var(--ink-soft)]">
                {stateBadge.detail}
              </span>
            )}
          </div>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${toneClasses(meta.tone)}`}>
          {meta.label}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {[game.awayTeam, game.homeTeam].map((team) => (
          <div key={`${game.gameId}-${team.abbr}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5">
            <TeamLogo src={team.logo} alt={team.abbr} color={team.color} alternateColor={team.alternateColor} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--ink-strong)]">{team.name}</div>
              <div className="truncate text-[11px] text-[var(--ink-muted)]">{team.record ?? team.abbr}</div>
            </div>
            <div className="font-heading text-[1.7rem] font-semibold text-[var(--ink-strong)]">{team.score ?? '-'}</div>
          </div>
        ))}
      </div>

      <MiniBoxscore game={game} />

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-[var(--line-soft)] pt-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">{meta.sublabel}</div>
            {meta.market && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${marketBadgeClasses(meta.market)}`}>
                {meta.market}
              </span>
            )}
            {meta.confidence && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${tierBadgeClasses(meta.confidence)}`}>
                Tier {meta.confidence}
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-[var(--ink-strong)]">
            {meta.selection
              ? `${meta.selection}${typeof meta.odds === 'number' && Number.isFinite(meta.odds) ? ` @ ${fmtNum(meta.odds)}` : ''}`
              : meta.tone === 'audited'
                ? 'Sin apuesta'
                : 'Sin pick activo'}
          </div>
        </div>
        <div className="text-right text-[11px] text-[var(--ink-muted)]">
          {game.analysis.updatedAt ? fmtDate(game.analysis.updatedAt) : fmtDate(game.date)}
        </div>
      </div>
    </button>
  );
}, (previous, next) => (
  previous.game === next.game &&
  previous.selected === next.selected &&
  previous.meta.tone === next.meta.tone &&
  previous.meta.label === next.meta.label &&
  previous.meta.sublabel === next.meta.sublabel &&
  previous.meta.selection === next.meta.selection &&
  previous.meta.hasActivePick === next.meta.hasActivePick &&
  previous.meta.market === next.meta.market &&
  previous.meta.confidence === next.meta.confidence &&
  previous.meta.odds === next.meta.odds
));

export default function HomePage() {
  const [games, setGames] = useState<GameRow[]>([]);
  const [todayGamesCache, setTodayGamesCache] = useState<GameRow[]>([]);
  const [analysisByGame, setAnalysisByGame] = useState<Record<string, AnalyzeResponse>>({});
  const [dayOffset, setDayOffset] = useState(0);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedExecutionSlot, setSelectedExecutionSlot] = useState<ExecutionSlot>('recommended');
  const [actualOddsInput, setActualOddsInput] = useState('');
  const [actualLineInput, setActualLineInput] = useState('');
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [primingSlate, setPrimingSlate] = useState(false);

  const primedDatesRef = useRef<Set<string>>(new Set());
  const gamesAbortRef = useRef<AbortController | null>(null);
  const analysisCacheRef = useRef<Record<string, AnalyzeResponse>>({});
  const analysisFetchTimesRef = useRef<Map<string, number>>(new Map());
  const analysisRequestsRef = useRef<Map<string, Promise<AnalyzeResponse | null>>>(new Map());

  const selectedGame = useMemo(
    () => games.find((game) => game.gameId === selectedGameId) ?? null,
    [games, selectedGameId]
  );
  const analysis = selectedGameId ? analysisByGame[selectedGameId] ?? null : null;

  const executionOptions = useMemo(
    () => getExecOptions(analysis?.executionRecommendation),
    [analysis?.executionRecommendation]
  );
  const activeExecution = useMemo(
    () => executionOptions.find((item) => item.slot === selectedExecutionSlot)?.line ?? null,
    [executionOptions, selectedExecutionSlot]
  );

  useEffect(() => {
    setActualLineInput(activeExecution?.line !== undefined ? String(activeExecution.line) : '');
  }, [activeExecution?.line]);

  useEffect(() => {
    if (!analysisModalOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAnalysisModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [analysisModalOpen]);

  useEffect(() => {
    analysisCacheRef.current = analysisByGame;
  }, [analysisByGame]);

  const liveCount = useMemo(() => games.filter((game) => game.state === 'in').length, [games]);
  const analyzedCount = useMemo(() => games.filter((game) => game.analysis.analyzed).length, [games]);
  const confirmedCount = useMemo(() => games.filter((game) => game.analysis.hasActivePick).length, [games]);
  const [solidDailyPick, setSolidDailyPick] = useState<SolidDailyPickState | null>(null);
  const [premiumDayClosed, setPremiumDayClosed] = useState<boolean | null>(null);
  const [statsPremiumPick, setStatsPremiumPick] = useState<StatsPremiumPick | null>(null);
  const solidStorageDateKey = useMemo(() => getSolidStorageDateKey(0), []);
 

  useEffect(() => {
    setPremiumDayClosed(null);
    fetch('/api/premium-lock')
      .then((r) => r.json())
      .then((data: { isClosed?: boolean }) => setPremiumDayClosed(data.isClosed ?? false))
      .catch(() => setPremiumDayClosed(false));
  }, [solidStorageDateKey]);

useEffect(() => {
  let cancelled = false;

  async function loadPremiumPick() {
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      const json = (await res.json()) as HomeStatsResponse;

      if (cancelled) return;

      const premiumPick = json?.solidPick?.premiumPick ?? null;
      if (premiumPick) {
        setStatsPremiumPick(premiumPick);
      }
    } catch {
      if (!cancelled) {
        // mantener último premium pick válido
      }
    }
  }

  if (dayOffset === 0) {
    void loadPremiumPick();
  }

  return () => {
    cancelled = true;
  };
}, [dayOffset, games]);

useEffect(() => {
  if (premiumDayClosed === null) return;

  if (premiumDayClosed) {
    clearSolidPick(solidStorageDateKey);
    setSolidDailyPick(null);
    return;
  }

  const sourceGames = todayGamesCache.length ? todayGamesCache : games;

  if (!statsPremiumPick) {
    return;
  }

  setSolidDailyPick({
    dateKey: solidStorageDateKey,
    gameId: statsPremiumPick.gameId,
    gameLabel: resolveHomeMatchupLabel(
      statsPremiumPick.gameId,
      statsPremiumPick.gameLabel,
      sourceGames
    ),
    market: statsPremiumPick.market as ExecutionLine['marketType'],
    selection: statsPremiumPick.selection,
    line: typeof statsPremiumPick.line === 'number' ? statsPremiumPick.line : null,
    odds: statsPremiumPick.executionOdds ?? 0,
    confidence: statsPremiumPick.confidence,
    score: statsPremiumPick.score,
    edge: statsPremiumPick.edge ?? null,
    ev: statsPremiumPick.ev ?? null,
    note: statsPremiumPick.note ?? null,
    lockedAt: new Date().toISOString(),
    game: sourceGames.find((game) => String(game.gameId) === String(statsPremiumPick.gameId)) ?? null
  });
}, [games, premiumDayClosed, solidStorageDateKey, statsPremiumPick, todayGamesCache]);

  const applyExecutionSlotFromAnalysis = useCallback((json: AnalyzeResponse | null) => {
    setSelectedExecutionSlot(getExecOptions(json?.executionRecommendation)[0]?.slot ?? 'recommended');
  }, []);

  const isAnalysisFresh = useCallback((gameId: string) => {
    const fetchedAt = analysisFetchTimesRef.current.get(gameId);
    return typeof fetchedAt === 'number' && Date.now() - fetchedAt < ANALYSIS_CACHE_MAX_AGE_MS;
  }, []);

  const loadGames = useCallback(async (offset = dayOffset) => {
    gamesAbortRef.current?.abort();
    const controller = new AbortController();
    gamesAbortRef.current = controller;

    try {
      setGamesLoading(true);
      setGamesError(null);
      const res = await fetch(`/api/games?date=${getDateKey(offset)}`, {
        cache: 'no-store',
        signal: controller.signal
      });
      const json = (await res.json()) as GamesResponse;
      if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudieron cargar los juegos');
      const nextGames = json.games ?? [];
      startTransition(() => {
        setGames(nextGames);
        if (offset === 0) {
          setTodayGamesCache(nextGames);
        }
        setSelectedGameId((current) => {
          if (current && nextGames.some((game) => game.gameId === current)) return current;
          return null;
        });
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      setGamesError(error instanceof Error ? error.message : 'Error cargando juegos');
    } finally {
      if (gamesAbortRef.current === controller) {
        gamesAbortRef.current = null;
        setGamesLoading(false);
      }
    }
  }, [dayOffset]);

  const mergeAnalysisIntoGame = useCallback((gameId: string, json: AnalyzeResponse) => {
    analysisCacheRef.current = {
      ...analysisCacheRef.current,
      [gameId]: json
    };
    analysisFetchTimesRef.current.set(gameId, Date.now());

    const isNoBet =
      json.uiSummary?.finalPick?.market === 'PASS' ||
      json.uiSummary?.execution?.status === 'NO_BET' ||
      json.finalDecision?.status === 'NO_BET';
    const recommendedLine = json.executionRecommendation?.recommendedLine ?? null;
    const nextStatus = json.confirmedPick?.status ?? (isNoBet ? 'no_bet' : 'analyzed');
    const nextSelection =
      json.confirmedPick?.selection ??
      (isNoBet
        ? null
        : recommendedLine?.selection ??
          json.uiSummary?.finalPick?.selection ??
          null);
    const nextMarket =
      json.confirmedPick?.market ??
      (isNoBet
        ? null
        : recommendedLine?.marketType ??
          json.uiSummary?.finalPick?.market ??
          null);
    const nextLine =
      json.confirmedPick?.line ??
      (isNoBet
        ? null
        : typeof recommendedLine?.line === 'number'
          ? recommendedLine.line
          : null);
    const nextOdds =
      json.confirmedPick?.odds ??
      (isNoBet
        ? null
        : recommendedLine?.odds ??
          json.uiSummary?.execution?.odds ??
          null);
    const nextProbability = isNoBet ? null : json.uiSummary?.finalPick?.probability ?? null;
    const nextEdge = isNoBet ? null : json.uiSummary?.finalPick?.edge ?? null;
    const nextEv = isNoBet ? null : json.uiSummary?.finalPick?.ev ?? null;

    startTransition(() => {
      setAnalysisByGame((current) => ({ ...current, [gameId]: json }));
      setGames((current) =>
        current.map((game) =>
          game.gameId === gameId
            ? {
                ...game,
                analysis: {
                  analyzed: true,
                  hasActivePick: Boolean(json.confirmedPick),
                  status: nextStatus,
                  confidence: isNoBet ? null : json.uiSummary?.finalPick?.confidence ?? null,
                  selection: nextSelection,
                  market: nextMarket,
                  line: nextLine,
                  odds: nextOdds,
                  probability: nextProbability,
                  edge: nextEdge,
                  ev: nextEv,
                  updatedAt: new Date().toISOString()
                }
              }
            : game
        )
      );
      setTodayGamesCache((current) => {
        if (!current.some((game) => game.gameId === gameId)) {
          return current;
        }

        return current.map((game) =>
          game.gameId === gameId
            ? {
                ...game,
                analysis: {
                  analyzed: true,
                  hasActivePick: Boolean(json.confirmedPick),
                  status: nextStatus,
                  confidence: isNoBet ? null : json.uiSummary?.finalPick?.confidence ?? null,
                  selection: nextSelection,
                  market: nextMarket,
                  line: nextLine,
                  odds: nextOdds,
                  probability: nextProbability,
                  edge: nextEdge,
                  ev: nextEv,
                  updatedAt: new Date().toISOString()
                }
              }
            : game
        );
      });
    });
  }, []);

  const fetchAnalysis = useCallback(async (gameId: string, options?: { openPanel?: boolean; forceRefresh?: boolean }) => {
    const openPanel = options?.openPanel ?? false;
    const forceRefresh = options?.forceRefresh ?? false;
    const cached = analysisCacheRef.current[gameId] ?? null;
    const cachedIsFresh = cached ? isAnalysisFresh(gameId) : false;

    try {
      if (openPanel) {
        setSelectedGameId(gameId);
        setAnalysisModalOpen(true);
        setAnalysisError(null);
        setConfirmResult(null);
        setConfirmError(null);
        setActualOddsInput('');
        setActualLineInput('');

        if (cached) {
          applyExecutionSlotFromAnalysis(cached);
          setAnalysisLoading(false);
        } else {
          setAnalysisLoading(true);
        }
      }

      if (cached && cachedIsFresh && !forceRefresh) {
        return cached;
      }

      const existingRequest = analysisRequestsRef.current.get(gameId);
      if (existingRequest) {
        const json = await existingRequest;
        if (openPanel && json) {
          applyExecutionSlotFromAnalysis(json);
        }
        return json ?? cached;
      }

      const request = (async () => {
        const res = await fetch(`/api/analyze?gameId=${encodeURIComponent(gameId)}`, { cache: 'no-store' });
        const json = (await res.json()) as AnalyzeResponse;
        if (!res.ok || !json.ok) throw new Error(json.error || 'No se pudo analizar el juego');
        mergeAnalysisIntoGame(gameId, json);
        return json;
      })();

      analysisRequestsRef.current.set(gameId, request);

      try {
        const json = await request;
        if (openPanel) {
          applyExecutionSlotFromAnalysis(json);
        }
        return json;
      } finally {
        analysisRequestsRef.current.delete(gameId);
      }
    } catch (error) {
      if (openPanel && !cached) {
        setAnalysisError(error instanceof Error ? error.message : 'Error analizando juego');
      }

      return cached;
    } finally {
      if (openPanel && !cached) {
        setAnalysisLoading(false);
      }
    }
  }, [applyExecutionSlotFromAnalysis, isAnalysisFresh, mergeAnalysisIntoGame]);

  const primeSlate = useCallback(async (sourceGames: GameRow[], offset: number) => {
    const dateKey = getDateKey(offset);
    if (!sourceGames.length || primedDatesRef.current.has(dateKey)) return;

    const remainingIds = sourceGames
      .filter((game) => !game.analysis.analyzed)
      .map((game) => game.gameId);
    if (!remainingIds.length) {
      primedDatesRef.current.add(dateKey);
      return;
    }

    primedDatesRef.current.add(dateKey);
    setPrimingSlate(true);
    try {
      const batchSize = 2;
      for (let index = 0; index < remainingIds.length; index += batchSize) {
        const batch = remainingIds.slice(index, index + batchSize);
        await Promise.allSettled(batch.map((gameId) => fetchAnalysis(gameId)));
      }

      await loadGames(offset);
    } finally {
      setPrimingSlate(false);
    }
  }, [fetchAnalysis, loadGames]);

  useEffect(() => {
    void loadGames(dayOffset);
  }, [loadGames, dayOffset]);

  useEffect(() => {
    return () => {
      gamesAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!games.length) return;
    if (primedDatesRef.current.has(getDateKey(dayOffset))) return;

    const win = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number }
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let cancelled = false;
    const run = () => {
      if (!cancelled) {
        void primeSlate(games, dayOffset);
      }
    };

    if (typeof win.requestIdleCallback === 'function') {
      const handle = win.requestIdleCallback(run, { timeout: 1500 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(handle);
      };
    }

    const timeout = window.setTimeout(run, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [games, dayOffset, primeSlate]);

  useEffect(() => {
    if (dayOffset !== 0) return;

    const refreshMs = liveCount > 0 ? 45000 : 90000;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadGames(dayOffset);
    }, refreshMs);
    return () => window.clearInterval(interval);
  }, [loadGames, dayOffset, liveCount]);

  useEffect(() => {
    if (analysisModalOpen && (!selectedGameId || !games.some((game) => game.gameId === selectedGameId))) {
      setAnalysisModalOpen(false);
    }
  }, [analysisModalOpen, games, selectedGameId]);

  async function confirmExecutionForGame() {
    try {
      if (!selectedGameId) throw new Error('No hay juego seleccionado');
      const actualOdds = Number(actualOddsInput);
      const actualLine = actualLineInput.trim() === '' ? undefined : Number(actualLineInput);

      if (!Number.isFinite(actualOdds) || actualOdds <= 1) {
        throw new Error('Ingresa una cuota valida mayor que 1.00');
      }

      if (
        activeExecution?.line !== undefined &&
        (!Number.isFinite(actualLine) || actualLine === undefined)
      ) {
        throw new Error('Ingresa la linea real que te muestra tu book');
      }

      setConfirmLoading(true);
      setConfirmError(null);
      setConfirmResult(null);

      const res = await fetch('/api/confirm-execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: selectedGameId,
          snapshotId: analysis?.pickLock?.snapshotId ?? null,
          actualOdds,
          actualLine,
          available: true,
          selectedSlot: selectedExecutionSlot
        })
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'No se pudo confirmar la ejecucion');
      }

      const confirmation = json.confirmation as ConfirmResult | null;
      setConfirmResult(confirmation);

      if (confirmation?.status === 'CONFIRMED') {
        setAnalysisByGame((current) => {
          const currentAnalysis = current[selectedGameId];
          if (!currentAnalysis) return current;

          return {
            ...current,
            [selectedGameId]: {
              ...currentAnalysis,
              confirmedPick: {
                market: confirmation.acceptedLine?.marketType ?? currentAnalysis.uiSummary?.finalPick?.market ?? '-',
                selection: confirmation.acceptedLine?.selection ?? currentAnalysis.uiSummary?.finalPick?.selection ?? '-',
                line: typeof confirmation.acceptedLine?.line === 'number' ? confirmation.acceptedLine.line : null,
                odds: confirmation.usedOdds ?? null,
                status: 'pending',
                reason: confirmation.reason ?? 'Pick confirmado'
              },
              resultSummary: { status: 'pending', result: null, profitUnits: null }
            }
          };
        });
      }

      await loadGames(dayOffset);
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'Error confirmando ejecucion');
      setConfirmResult(null);
    } finally {
      setConfirmLoading(false);
    }
  }

  const handleSelectGame = useCallback((gameId: string) => {
    void fetchAnalysis(gameId, { openPanel: true });
  }, [fetchAnalysis]);
  const handleCloseAnalysisModal = useCallback(() => {
    setAnalysisModalOpen(false);
  }, []);

  const cardMetaByGame = useMemo(() => {
    const entries = games.map((game) => [
      game.gameId,
      getCardMeta(game, analysisByGame[game.gameId] ?? null)
    ]);

    return Object.fromEntries(entries) as Record<string, CardMeta>;
  }, [games, analysisByGame]);

  const selectedMeta = selectedGame ? cardMetaByGame[selectedGame.gameId] ?? getCardMeta(selectedGame, analysis) : null;

  return (
    <main className="px-3 pb-8 pt-4 lg:px-5">
      <div className="mx-auto max-w-[1620px]">
        <section className="glass-panel rounded-[2rem] p-4 lg:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {[
                { offset: 0, label: 'Hoy' },
                { offset: 1, label: 'Mañana' }
              ].map((item) => (
                <button
                  key={`compact-${item.label}`}
                  onClick={() => {
                    setAnalysisModalOpen(false);
                    setAnalysisError(null);
                    primedDatesRef.current.delete(getDateKey(item.offset));
                    setDayOffset(item.offset);
                    void loadGames(item.offset);
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    dayOffset === item.offset
                      ? 'bg-[var(--surface-navy)] text-white shadow-[0_16px_28px_rgba(9,28,57,0.16)]'
                      : 'border border-[var(--line-soft)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink-strong)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setAnalysisModalOpen(false);
                  void loadGames(dayOffset);
                }}
                className="rounded-full border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink-strong)]"
              >
                Actualizar
              </button>
            </div>

            {primingSlate && (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
                Analizando
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[1.35rem] border border-[var(--line-soft)] bg-white p-3.5">
              <div className="flex items-center gap-2 text-sky-700">
                <ClockIcon />
                <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">Live</span>
              </div>
              <div className="mt-2 text-[1.9rem] font-semibold text-[var(--ink-strong)]">{liveCount}</div>
            </div>

            <div className="rounded-[1.35rem] border border-[var(--line-soft)] bg-white p-3.5">
              <div className="flex items-center gap-2 text-[var(--surface-navy)]">
                <TargetIcon />
                <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">Slate</span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-[1.9rem] font-semibold text-[var(--ink-strong)]">{games.length}</div>
                <div className="text-xs text-[var(--ink-soft)]">{analyzedCount} auditados</div>
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-[var(--line-soft)] bg-white p-3.5">
              <div className="flex items-center gap-2 text-amber-700">
                <SparkIcon />
                <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">Confirmed</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-[1.9rem] font-semibold text-[var(--ink-strong)]">{confirmedCount}</div>
                <div className="h-2.5 flex-1 rounded-full bg-[var(--surface-soft)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#f59e0b,#ef4444,#0ea5e9)]"
                    style={{ width: `${games.length ? (confirmedCount / games.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[1.35rem] border border-[#e7c975]/45 bg-[linear-gradient(145deg,rgba(255,250,233,0.96),rgba(255,255,255,0.98))] p-3.5 shadow-[0_18px_40px_rgba(164,126,28,0.12)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,222,138,0.28),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(191,149,52,0.14),transparent_34%)]" />
              <div className="relative flex items-center gap-2 text-[#9a7417]">
                <SparkIcon />
                <span className="text-[10px] uppercase tracking-[0.24em] text-[#9a7417]">Pick solido</span>
              </div>
              <div className="relative mt-2 text-base font-semibold text-[var(--ink-strong)]">
{solidDailyPick ? (
  <>
    <div className="font-semibold text-[var(--ink-strong)]">
      {solidDailyPick.game
        ? `${solidDailyPick.game.awayTeam.name} @ ${solidDailyPick.game.homeTeam.name}`
        : solidDailyPick.gameLabel}
    </div>
    <div className="mt-1">
      {`${renderPickLabel(solidDailyPick.selection, solidDailyPick.line, solidDailyPick.market)} @ ${fmtNum(solidDailyPick.odds)}`}
    </div>
  </>
) : (
  'Sin pick solido activo hoy'
)}
              </div>
              {solidDailyPick && (
                <div className="relative mt-1 text-xs text-[var(--ink-soft)]">
                  {solidDailyPick.market} / Tier {solidDailyPick.confidence}
                </div>
              )}
              {solidDailyPick?.note && (
                <div className="relative mt-2 rounded-[0.95rem] border border-[#f0d489]/35 bg-[rgba(255,248,226,0.9)] px-3 py-2 text-[11px] text-[#7b5a11]">
                  {solidDailyPick.note}
                </div>
              )}
            </div>
          </div>
        </section>

        {gamesError && (
          <div className="glass-panel mt-4 rounded-[1.4rem] p-4 text-sm text-rose-700">
            {gamesError}
          </div>
        )}

        <div className="mt-5">
          <section>
            {false && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--ink-muted)]">Slate board</div>
                <h2 className="mt-1 font-heading text-[1.65rem] font-semibold text-[var(--ink-strong)]">Todos los juegos</h2>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  Toca una tarjeta para abrir el analisis compacto del matchup y confirmar la ejecucion.
                </p>
              </div>
              <div className="rounded-full border border-[var(--line-soft)] bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                {games.length} juegos
              </div>
            </div>
            )}

            {gamesLoading && !games.length ? (
              <div className="glass-panel rounded-[1.5rem] p-5 text-sm text-[var(--ink-soft)]">
                Cargando slate...
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" style={{ contentVisibility: 'auto' }}>
                {games.map((game) => (
                  <GameCard
                    key={game.gameId}
                    game={game}
                    selected={game.gameId === selectedGameId}
                    meta={cardMetaByGame[game.gameId]}
                    onSelectGame={handleSelectGame}
                  />
                ))}

                {!games.length && !gamesLoading && (
                  <div className="glass-panel rounded-[1.5rem] p-5 text-sm text-[var(--ink-soft)]">
                    No hay juegos disponibles en este slate.
                  </div>
                )}
              </div>
            )}
          </section>

        </div>
      </div>

      <AnalysisModal
        open={analysisModalOpen}
        game={selectedGame}
        analysis={analysis}
        meta={selectedMeta}
        executionOptions={executionOptions}
        selectedExecutionSlot={selectedExecutionSlot}
        onSelectExecutionSlot={setSelectedExecutionSlot}
        actualOddsInput={actualOddsInput}
        actualLineInput={actualLineInput}
        onActualOddsChange={setActualOddsInput}
        onActualLineChange={setActualLineInput}
        onConfirm={confirmExecutionForGame}
        confirmLoading={confirmLoading}
        confirmError={confirmError}
        confirmResult={confirmResult}
        analysisLoading={analysisLoading}
        analysisError={analysisError}
        onClose={handleCloseAnalysisModal}
      />
    </main>
  );
}
