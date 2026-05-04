'use client';

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { USER_TIMEZONE } from '@/lib/runtime-config';

type SavedCombiLeg = {
  gameId: string | null;
  market: string | null;
  selection: string | null;
  line: number | null;
  apiOdds: number | null;
  realOdds: number | null;
  status: string;
  result: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
};

type SavedCombiPick = {
  id: string;
  gameDay: string;
  status: string;
  leg1: SavedCombiLeg;
  leg2: SavedCombiLeg;
  combinedApiOdds: number | null;
  combinedRealOdds: number | null;
  profitUnits: number | null;
  createdAt: string;
};

type DraftCandidate = {
  id: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  market: 'ML' | 'RL' | 'TOTAL' | 'F5';
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

type DraftPair = {
  leg1: DraftCandidate;
  leg2: DraftCandidate;
  combinedApiOdds: number;
  combiScore: number;
  inTargetRange: boolean;
};

type DraftCombi = {
  gameDay: string;
  targetRange: [number, number];
  alternativesPoolCount: number;
  candidatePairsCount: number;
  basePicksFound?: number;
  basePicksEligibleAB?: number;
  basePicksRejectedC?: number;
  alternativesGeneratedFromAB?: number;
  bestPairBeforeManualEdit: DraftPair | null;
  suggestedPair: DraftPair | null;
  alternativesPool: DraftCandidate[];
};

type CombiStats = {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  profit_units: number;
  roi: number | null;
  avg_combined_odds: number | null;
};

type CombiPickRaw = {
  id: string;
  game_day: string;
  status: string;
  leg_1_game_id: string | null;
  leg_1_market: string | null;
  leg_1_selection: string | null;
  leg_1_line: number | null;
  leg_1_api_odds: number | null;
  leg_1_real_odds: number | null;
  leg_1_status: string;
  leg_1_result: string | null;
  leg_1_home_team: string | null;
  leg_1_away_team: string | null;
  leg_2_game_id: string | null;
  leg_2_market: string | null;
  leg_2_selection: string | null;
  leg_2_line: number | null;
  leg_2_api_odds: number | null;
  leg_2_real_odds: number | null;
  leg_2_status: string;
  leg_2_result: string | null;
  leg_2_home_team: string | null;
  leg_2_away_team: string | null;
  combined_api_odds: number | null;
  combined_real_odds: number | null;
  profit_units: number | null;
  created_at: string;
};

type CombiLabResponse = {
  ok: boolean;
  combi: CombiPickRaw | null;
  stalePendingCombi?: CombiPickRaw | null;
  draft: DraftCombi | null;
  stats: CombiStats | null;
  generated?: boolean;
  reason?: string;
  error?: string;
};

type EditableDraftLeg = DraftCandidate & {
  realOddsInput: string;
  lineInput: string;
};

type ReplacementOption = {
  candidate: DraftCandidate;
  combinedOdds: number;
  inTargetRange: boolean;
  targetDistance: number;
  marketReliability: number;
  baseStrength: number;
  linePenalty: number;
};

function getTodayDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function normalizeCombi(raw: CombiPickRaw): SavedCombiPick {
  return {
    id: raw.id,
    gameDay: raw.game_day,
    status: raw.status,
    leg1: {
      gameId: raw.leg_1_game_id,
      market: raw.leg_1_market,
      selection: raw.leg_1_selection,
      line: raw.leg_1_line,
      apiOdds: raw.leg_1_api_odds,
      realOdds: raw.leg_1_real_odds,
      status: raw.leg_1_status ?? 'pending',
      result: raw.leg_1_result,
      homeTeam: raw.leg_1_home_team,
      awayTeam: raw.leg_1_away_team
    },
    leg2: {
      gameId: raw.leg_2_game_id,
      market: raw.leg_2_market,
      selection: raw.leg_2_selection,
      line: raw.leg_2_line,
      apiOdds: raw.leg_2_api_odds,
      realOdds: raw.leg_2_real_odds,
      status: raw.leg_2_status ?? 'pending',
      result: raw.leg_2_result,
      homeTeam: raw.leg_2_home_team,
      awayTeam: raw.leg_2_away_team
    },
    combinedApiOdds: raw.combined_api_odds,
    combinedRealOdds: raw.combined_real_odds,
    profitUnits: raw.profit_units,
    createdAt: raw.created_at
  };
}

function formatOdds(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

function formatUnits(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}u`;
}

function formatPct(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function formatDisplayDate(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('es-CL', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
}

function candidateMatchupLabel(leg: {
  awayTeam: string | null;
  homeTeam: string | null;
  gameId?: string | null;
}): string {
  if (leg.homeTeam && leg.awayTeam) return `${leg.awayTeam} @ ${leg.homeTeam}`;
  return leg.gameId ?? '—';
}

function marketBadgeClass(market: string | null): string {
  if (market === 'ML') return 'border-sky-300/80 bg-sky-100/90 text-sky-900';
  if (market === 'RL') return 'border-fuchsia-300/80 bg-fuchsia-100/90 text-fuchsia-900';
  if (market === 'TOTAL') return 'border-teal-300/80 bg-teal-100/90 text-teal-900';
  if (market === 'F5') return 'border-amber-300/80 bg-amber-100/90 text-amber-900';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function statusBadgeClass(status: string): string {
  if (status === 'won') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'lost') return 'border-rose-200 bg-rose-50 text-rose-800';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

function lineToText(line: number | null | undefined): string {
  if (line === null || line === undefined) return 'ML';
  const sign = line > 0 ? '+' : '';
  return `${sign}${line}`;
}

function parseRealOddsInput(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function parseLineInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHalfPointLine(value: number | null): boolean {
  if (value === null) return true;
  const doubled = value * 2;
  return Number.isInteger(doubled) && Math.abs(doubled % 2) === 1;
}

function isAllowedProtectionLine(value: number | null): boolean {
  return value === 1.5 || value === 2.5;
}

function getMarketReliability(market: DraftCandidate['market']): number {
  if (market === 'TOTAL') return 1.0;
  if (market === 'ML') return 0.97;
  if (market === 'F5') return 0.88;
  return 0.84;
}

function getEffectiveOdds(leg: EditableDraftLeg): number {
  return parseRealOddsInput(leg.realOddsInput) ?? leg.apiOdds;
}

function buildLineInput(line: number | null): string {
  return line === null ? '' : String(line);
}

function toEditableLeg(candidate: DraftCandidate): EditableDraftLeg {
  return {
    ...candidate,
    realOddsInput: candidate.apiOdds.toFixed(2),
    lineInput: buildLineInput(candidate.line)
  };
}

function validateDraftLeg(leg: EditableDraftLeg): string | null {
  const line = parseLineInput(leg.lineInput);
  const baseLine = leg.basePickLine;
  const baseSelectionLower = leg.basePickSelection.toLowerCase();
  const isOver = baseSelectionLower.includes('over');
  const isUnder = baseSelectionLower.includes('under');

  if (!isHalfPointLine(line)) {
    return 'La linea debe terminar en .5.';
  }

  if ((leg.market === 'TOTAL' || (leg.market === 'F5' && (isOver || isUnder))) && line === null) {
    return 'Debes ingresar una linea valida.';
  }

  if (isOver && baseLine !== null && line !== null) {
    if (line >= baseLine) return 'Para Over la linea final debe ser menor que la base.';
    const maxDiff = leg.basePickMarket.toUpperCase() === 'F5' ? 2 : 3;
    if (baseLine - line > maxDiff) return 'La linea Over se fue demasiado lejos de la base.';
  }

  if (isUnder && baseLine !== null && line !== null) {
    if (line <= baseLine) return 'Para Under la linea final debe ser mayor que la base.';
    const maxDiff = leg.basePickMarket.toUpperCase() === 'F5' ? 2 : 3;
    if (line - baseLine > maxDiff) return 'La linea Under se fue demasiado lejos de la base.';
  }

  if ((leg.market === 'RL' || (leg.market === 'F5' && !isOver && !isUnder)) && line !== null) {
    if (!isAllowedProtectionLine(line)) {
      return 'Solo se permiten handicaps de +1.5 o +2.5.';
    }
  }

  if (leg.market === 'ML' && line !== null) {
    return 'ML no usa linea manual.';
  }

  return null;
}

function rankReplacementCandidate(fixedLeg: EditableDraftLeg, candidate: DraftCandidate): ReplacementOption {
  const combinedOdds = Number((getEffectiveOdds(fixedLeg) * candidate.apiOdds).toFixed(3));
  const targetDistance = Math.abs(combinedOdds - 1.75);
  const inTargetRange = combinedOdds >= 1.65 && combinedOdds <= 1.85;
  const marketReliability =
    (getMarketReliability(fixedLeg.market) + getMarketReliability(candidate.market)) / 2;
  const baseStrength = ((fixedLeg.selectionScore ?? 45) + (candidate.selectionScore ?? 45)) / 2;
  const linePenalty = (fixedLeg.conservativeDelta + candidate.conservativeDelta) * 0.08;

  return {
    candidate,
    combinedOdds,
    inTargetRange,
    targetDistance,
    marketReliability,
    baseStrength,
    linePenalty
  };
}

function compareReplacementOptions(a: ReplacementOption, b: ReplacementOption): number {
  if (a.inTargetRange !== b.inTargetRange) return a.inTargetRange ? -1 : 1;
  if (a.targetDistance !== b.targetDistance) return a.targetDistance - b.targetDistance;
  if (a.marketReliability !== b.marketReliability) return b.marketReliability - a.marketReliability;
  if (a.baseStrength !== b.baseStrength) return b.baseStrength - a.baseStrength;
  return a.linePenalty - b.linePenalty;
}

function StatsCard({ stats }: { stats: CombiStats }) {
  return (
    <div className="glass-panel rounded-[1.1rem] p-4">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        Estadisticas Combi Lab
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><p className="text-[10px] text-[var(--ink-muted)]">Combis</p><p className="text-lg font-bold text-[var(--ink-strong)]">{stats.total}</p></div>
        <div><p className="text-[10px] text-[var(--ink-muted)]">Resueltas</p><p className="text-lg font-bold text-[var(--ink-strong)]">{stats.settled}</p></div>
        <div><p className="text-[10px] text-[var(--ink-muted)]">Ganadas</p><p className="text-lg font-bold text-emerald-700">{stats.wins}</p></div>
        <div><p className="text-[10px] text-[var(--ink-muted)]">Perdidas</p><p className="text-lg font-bold text-rose-700">{stats.losses}</p></div>
        <div><p className="text-[10px] text-[var(--ink-muted)]">Win Rate</p><p className="text-lg font-bold text-[var(--ink-strong)]">{formatPct(stats.win_rate)}</p></div>
        <div><p className="text-[10px] text-[var(--ink-muted)]">P&L Units</p><p className="text-lg font-bold text-[var(--ink-strong)]">{formatUnits(stats.profit_units)}</p></div>
        <div><p className="text-[10px] text-[var(--ink-muted)]">ROI</p><p className="text-lg font-bold text-[var(--ink-strong)]">{formatPct(stats.roi)}</p></div>
        <div><p className="text-[10px] text-[var(--ink-muted)]">Cuota media</p><p className="text-lg font-bold text-[var(--ink-strong)]">{formatOdds(stats.avg_combined_odds)}</p></div>
      </div>
    </div>
  );
}

function SavedLegCard({
  legNum,
  leg,
  realOddsInput,
  onRealOddsChange,
  onSettle,
  settleLoading,
  confirming
}: {
  legNum: 1 | 2;
  leg: SavedCombiLeg;
  realOddsInput: string;
  onRealOddsChange: (v: string) => void;
  onSettle: (legNum: 1 | 2, status: 'won' | 'lost') => void;
  settleLoading: boolean;
  confirming: boolean;
}) {
  return (
    <div className="rounded-[0.85rem] border border-[rgba(9,28,57,0.07)] bg-white/70 p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="rounded-full bg-[var(--surface-navy)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">Leg {legNum}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${marketBadgeClass(leg.market)}`}>{leg.market ?? '—'}</span>
      </div>
      <p className="mb-0.5 text-[11px] text-[var(--ink-muted)]">{candidateMatchupLabel(leg)}</p>
      <p className="mb-2 text-sm font-semibold text-[var(--ink-strong)]">{(leg.selection ?? '—')} {leg.line !== null ? lineToText(leg.line) : ''}</p>
      <div className="mb-3 grid grid-cols-2 gap-x-4 text-xs">
        <div><span className="text-[var(--ink-muted)]">Cuota API</span><p className="font-semibold text-[var(--ink-strong)]">{formatOdds(leg.apiOdds)}</p></div>
        <div><span className="text-[var(--ink-muted)]">Cuota real</span><p className="font-semibold text-[var(--ink-strong)]">{leg.realOdds ? formatOdds(leg.realOdds) : 'Pendiente'}</p></div>
      </div>
      <div className="mb-2">
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Cuota real</label>
        <input type="number" step="0.01" min="1.01" value={realOddsInput} onChange={(e) => onRealOddsChange(e.target.value)} className="w-full rounded-lg border border-[rgba(9,28,57,0.15)] bg-white px-3 py-2 text-sm text-[var(--ink-strong)]" disabled={confirming} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSettle(legNum, 'won')} disabled={settleLoading} className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-40">Won</button>
        <button onClick={() => onSettle(legNum, 'lost')} disabled={settleLoading} className="flex-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:opacity-40">Lost</button>
      </div>
    </div>
  );
}

function DraftAlternativeRow({
  option,
  onSelect,
  disabled
}: {
  option: ReplacementOption;
  onSelect: (candidate: DraftCandidate) => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(option.candidate)}
      disabled={disabled}
      className="w-full rounded-lg border border-[rgba(9,28,57,0.08)] bg-[rgba(248,250,252,0.96)] px-3 py-2 text-left disabled:opacity-40"
    >
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${marketBadgeClass(option.candidate.market)}`}>
          {option.candidate.market}
        </span>
        <span className={`text-[10px] ${option.inTargetRange ? 'text-emerald-700' : 'text-amber-700'}`}>
          {option.inTargetRange ? 'Rango recomendado' : 'Warning'}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--ink-muted)]">{candidateMatchupLabel(option.candidate)}</p>
      <p className="text-sm font-semibold text-[var(--ink-strong)]">
        {option.candidate.selection} {option.candidate.line !== null ? lineToText(option.candidate.line) : ''}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-[var(--ink-muted)]">
        <span>Base: {option.candidate.basePickMarket} {option.candidate.basePickSelection} {option.candidate.basePickLine !== null ? lineToText(option.candidate.basePickLine) : ''}</span>
        <span>API: {formatOdds(option.candidate.apiOdds)}</span>
        <span>Fuente: {option.candidate.source === 'snapshot_event' ? 'Snapshot' : 'Board cache'}</span>
        <span>Diferencia: {option.candidate.conservativeDelta.toFixed(1)}</span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--ink-muted)]">Combi estimada: {formatOdds(option.combinedOdds)}</p>
    </button>
  );
}

function DraftLegCard({
  legNum,
  leg,
  alternatives,
  open,
  onToggleAlternatives,
  onRealOddsChange,
  onLineInputChange,
  onSelectAlternative,
  disabled,
  validationError
}: {
  legNum: 1 | 2;
  leg: EditableDraftLeg;
  alternatives: ReplacementOption[];
  open: boolean;
  onToggleAlternatives: () => void;
  onRealOddsChange: (value: string) => void;
  onLineInputChange: (value: string) => void;
  onSelectAlternative: (candidate: DraftCandidate) => void;
  disabled: boolean;
  validationError: string | null;
}) {
  return (
    <div className="rounded-[0.95rem] border border-[rgba(9,28,57,0.08)] bg-white/80 p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="rounded-full bg-[var(--surface-navy)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">Leg {legNum}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${marketBadgeClass(leg.market)}`}>{leg.market}</span>
        <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Draft</span>
      </div>

      <p className="mb-0.5 text-[11px] text-[var(--ink-muted)]">{candidateMatchupLabel(leg)}</p>
      <p className="text-sm font-semibold text-[var(--ink-strong)]">{leg.selection} {leg.line !== null ? lineToText(leg.line) : ''}</p>
      <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
        Base pick: {leg.basePickMarket} {leg.basePickSelection} {leg.basePickLine !== null ? lineToText(leg.basePickLine) : ''}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div><span className="text-[var(--ink-muted)]">Cuota API</span><p className="font-semibold text-[var(--ink-strong)]">{formatOdds(leg.apiOdds)}</p></div>
        <div><span className="text-[var(--ink-muted)]">Fuente</span><p className="font-semibold text-[var(--ink-strong)]">{leg.source === 'snapshot_event' ? 'Snapshot' : 'Board cache'}</p></div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Linea final</label>
          <input type="number" step="0.5" value={leg.lineInput} onChange={(e) => onLineInputChange(e.target.value)} className="w-full rounded-lg border border-[rgba(9,28,57,0.15)] bg-white px-3 py-2 text-sm text-[var(--ink-strong)]" disabled={disabled || leg.market === 'ML'} placeholder={leg.market === 'ML' ? 'ML' : '5.5'} />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Cuota real</label>
          <input type="number" step="0.01" min="1.01" value={leg.realOddsInput} onChange={(e) => onRealOddsChange(e.target.value)} className="w-full rounded-lg border border-[rgba(9,28,57,0.15)] bg-white px-3 py-2 text-sm text-[var(--ink-strong)]" disabled={disabled} />
        </div>
      </div>

      {validationError && <p className="mt-2 text-xs text-rose-700">{validationError}</p>}

      <div className="mt-3">
        <button onClick={onToggleAlternatives} disabled={disabled} className="w-full rounded-lg border border-[rgba(9,28,57,0.12)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink-strong)] disabled:opacity-40">
          {open ? 'Ocultar alternativas' : 'Cambiar alternativa'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {alternatives.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              No hay reemplazos validos para esta leg con la otra fija.
            </p>
          )}
          {alternatives.slice(0, 8).map((option) => (
            <DraftAlternativeRow key={option.candidate.id} option={option} onSelect={onSelectAlternative} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CombiLabPage() {
  const today = getTodayDateKey();
  const [gameDay, setGameDay] = useState(today);
  const [savedCombi, setSavedCombi] = useState<SavedCombiPick | null>(null);
  const [stalePendingCombi, setStalePendingCombi] = useState<SavedCombiPick | null>(null);
  const [draft, setDraft] = useState<DraftCombi | null>(null);
  const [draftLeg1, setDraftLeg1] = useState<EditableDraftLeg | null>(null);
  const [draftLeg2, setDraftLeg2] = useState<EditableDraftLeg | null>(null);
  const [stats, setStats] = useState<CombiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [settleLoading, setSettleLoading] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [openAlternativeLeg, setOpenAlternativeLeg] = useState<1 | 2 | null>(null);
  const [lastEditedLeg, setLastEditedLeg] = useState<1 | 2 | null>(null);
  const [savedLeg1OddsInput, setSavedLeg1OddsInput] = useState('');
  const [savedLeg2OddsInput, setSavedLeg2OddsInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const loadCombi = useCallback(async (day: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setReason(null);
    setConfirmError(null);
    setConfirmSuccess(null);
    setSettleError(null);
    setOpenAlternativeLeg(null);

    try {
      const res = await fetch(`/api/combi-lab?date=${day}`, {
        cache: 'no-store',
        signal: ctrl.signal
      });
      const json = (await res.json()) as CombiLabResponse;
      if (!json.ok) {
        setError(json.error ?? 'Error cargando combi');
        return;
      }

      startTransition(() => {
        const normalizedSaved = json.combi ? normalizeCombi(json.combi) : null;
        const normalizedStale = json.stalePendingCombi ? normalizeCombi(json.stalePendingCombi) : null;
        setSavedCombi(normalizedSaved);
        setStalePendingCombi(normalizedStale);
        setDraft(json.draft ?? null);
        setStats(json.stats ?? null);
        setReason(json.reason ?? null);
        setLastEditedLeg(null);

        if (normalizedSaved) {
          setSavedLeg1OddsInput(normalizedSaved.leg1.realOdds ? String(normalizedSaved.leg1.realOdds) : '');
          setSavedLeg2OddsInput(normalizedSaved.leg2.realOdds ? String(normalizedSaved.leg2.realOdds) : '');
        }

        if (json.draft?.suggestedPair) {
          setDraftLeg1(toEditableLeg(json.draft.suggestedPair.leg1));
          setDraftLeg2(toEditableLeg(json.draft.suggestedPair.leg2));
        } else {
          setDraftLeg1(null);
          setDraftLeg2(null);
        }
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Error de red. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCombi(gameDay);
    return () => abortRef.current?.abort();
  }, [gameDay, loadCombi]);

  const leg1ValidationError = draftLeg1 ? validateDraftLeg(draftLeg1) : null;
  const leg2ValidationError = draftLeg2 ? validateDraftLeg(draftLeg2) : null;

  const currentDraftCombinedOdds = useMemo(() => {
    if (!draftLeg1 || !draftLeg2) return null;
    return Number((getEffectiveOdds(draftLeg1) * getEffectiveOdds(draftLeg2)).toFixed(3));
  }, [draftLeg1, draftLeg2]);

  const draftOutOfRange =
    currentDraftCombinedOdds !== null &&
    (currentDraftCombinedOdds < 1.65 || currentDraftCombinedOdds > 1.85);

  const replacementOptionsForLeg1 = useMemo(() => {
    if (!draft || !draftLeg1 || !draftLeg2) return [];
    return draft.alternativesPool
      .filter((candidate) => candidate.id !== draftLeg1.id)
      .filter((candidate) => candidate.gameId !== draftLeg2.gameId)
      .map((candidate) => rankReplacementCandidate(draftLeg2, candidate))
      .sort(compareReplacementOptions);
  }, [draft, draftLeg1, draftLeg2]);

  const replacementOptionsForLeg2 = useMemo(() => {
    if (!draft || !draftLeg1 || !draftLeg2) return [];
    return draft.alternativesPool
      .filter((candidate) => candidate.id !== draftLeg2.id)
      .filter((candidate) => candidate.gameId !== draftLeg1.gameId)
      .map((candidate) => rankReplacementCandidate(draftLeg1, candidate))
      .sort(compareReplacementOptions);
  }, [draft, draftLeg1, draftLeg2]);

  function updateDraftLeg(legNum: 1 | 2, updater: (leg: EditableDraftLeg) => EditableDraftLeg) {
    if (legNum === 1) setDraftLeg1((current) => (current ? updater(current) : current));
    else setDraftLeg2((current) => (current ? updater(current) : current));
    setLastEditedLeg(legNum);
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  function handleSelectAlternative(legNum: 1 | 2, candidate: DraftCandidate) {
    if (legNum === 1) setDraftLeg1(toEditableLeg(candidate));
    else setDraftLeg2(toEditableLeg(candidate));
    setLastEditedLeg(legNum);
    setOpenAlternativeLeg(null);
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  async function handleConfirmDraft() {
    if (!draft || !draftLeg1 || !draftLeg2 || !draft.suggestedPair) return;

    if (leg1ValidationError || leg2ValidationError) {
      setConfirmError(leg1ValidationError ?? leg2ValidationError ?? 'Hay errores en las legs.');
      return;
    }

    const leg1RealOdds = parseRealOddsInput(draftLeg1.realOddsInput);
    const leg2RealOdds = parseRealOddsInput(draftLeg2.realOddsInput);
    if (leg1RealOdds === null || leg2RealOdds === null) {
      setConfirmError('Debes ingresar cuotas reales validas para ambas legs.');
      return;
    }

    setConfirming(true);
    setConfirmError(null);
    setConfirmSuccess(null);

    try {
      const res = await fetch('/api/combi-lab/confirm-odds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameDay: draft.gameDay,
          leg1: { ...draftLeg1, line: parseLineInput(draftLeg1.lineInput), realOdds: leg1RealOdds },
          leg2: { ...draftLeg2, line: parseLineInput(draftLeg2.lineInput), realOdds: leg2RealOdds },
          originallySuggestedPair: draft.suggestedPair,
          finalConfirmedPair: {
            leg1: { ...draftLeg1, line: parseLineInput(draftLeg1.lineInput), realOdds: leg1RealOdds },
            leg2: { ...draftLeg2, line: parseLineInput(draftLeg2.lineInput), realOdds: leg2RealOdds },
            combinedRealOdds: Number((leg1RealOdds * leg2RealOdds).toFixed(3))
          },
          replacementsMade: []
        })
      });
      const json = (await res.json()) as { ok: boolean; combi?: CombiPickRaw; error?: string };
      if (!json.ok || !json.combi) {
        setConfirmError(json.error ?? 'Error confirmando la combi');
        return;
      }

      setSavedCombi(normalizeCombi(json.combi));
      setStalePendingCombi(null);
      setSavedLeg1OddsInput(String(json.combi.leg_1_real_odds ?? ''));
      setSavedLeg2OddsInput(String(json.combi.leg_2_real_odds ?? ''));
      setConfirmSuccess('Combi confirmada y guardada.');
      await loadCombi(gameDay);
    } catch {
      setConfirmError('Error de red al confirmar la combi');
    } finally {
      setConfirming(false);
    }
  }

  async function handleDiscardStale() {
    if (!stalePendingCombi) return;
    setConfirming(true);
    setConfirmError(null);
    setConfirmSuccess(null);
    try {
      const res = await fetch('/api/combi-lab/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameDay })
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setConfirmError(json.error ?? 'No se pudo descartar la combi pendiente.');
        return;
      }
      setConfirmSuccess('Combi pendiente descartada.');
      await loadCombi(gameDay);
    } catch {
      setConfirmError('Error de red al descartar la combi pendiente.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleConfirmSavedOdds() {
    if (!savedCombi) return;
    const l1 = Number(savedLeg1OddsInput);
    const l2 = Number(savedLeg2OddsInput);
    if (!Number.isFinite(l1) || l1 <= 1 || !Number.isFinite(l2) || l2 <= 1) {
      setConfirmError('Ambas cuotas reales deben ser mayores a 1.');
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    setConfirmSuccess(null);
    try {
      const res = await fetch('/api/combi-lab/confirm-odds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combiId: savedCombi.id, leg1RealOdds: l1, leg2RealOdds: l2 })
      });
      const json = (await res.json()) as { ok: boolean; combi?: CombiPickRaw; error?: string };
      if (!json.ok || !json.combi) {
        setConfirmError(json.error ?? 'Error guardando cuotas reales');
        return;
      }
      setSavedCombi(normalizeCombi(json.combi));
      setConfirmSuccess('Cuotas reales actualizadas.');
    } catch {
      setConfirmError('Error de red al guardar cuotas reales');
    } finally {
      setConfirming(false);
    }
  }

  async function handleSettle(legNum: 1 | 2, status: 'won' | 'lost') {
    if (!savedCombi) return;
    setSettleLoading(true);
    setSettleError(null);
    try {
      const res = await fetch('/api/combi-lab/settle-leg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combiId: savedCombi.id, leg: legNum, status })
      });
      const json = (await res.json()) as { ok: boolean; combi?: CombiPickRaw; error?: string };
      if (!json.ok || !json.combi) {
        setSettleError(json.error ?? 'Error al registrar resultado');
        return;
      }
      setSavedCombi(normalizeCombi(json.combi));
    } catch {
      setSettleError('Error de red al registrar resultado');
    } finally {
      setSettleLoading(false);
    }
  }

  function handleFindBetterPair() {
    if (!draftLeg1 || !draftLeg2 || !lastEditedLeg) return;
    if (lastEditedLeg === 1) {
      const best = replacementOptionsForLeg2[0];
      if (best) {
        setDraftLeg2(toEditableLeg(best.candidate));
        setConfirmSuccess(`Se encontro una mejor pareja para Leg 2. Combi estimada: ${formatOdds(best.combinedOdds)}.`);
      }
      return;
    }
    const best = replacementOptionsForLeg1[0];
    if (best) {
      setDraftLeg1(toEditableLeg(best.candidate));
      setConfirmSuccess(`Se encontro una mejor pareja para Leg 1. Combi estimada: ${formatOdds(best.combinedOdds)}.`);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-3 pb-10 pt-2">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--ink-strong)]">Combi Lab</h1>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-700">Experimental</span>
          </div>
          <p className="mt-0.5 text-xs capitalize text-[var(--ink-muted)]">{formatDisplayDate(gameDay)}</p>
        </div>
        <input type="date" value={gameDay} onChange={(e) => setGameDay(e.target.value || today)} className="rounded-lg border border-[rgba(9,28,57,0.12)] bg-white/80 px-2 py-1.5 text-xs text-[var(--ink-strong)]" />
      </div>

      {!loading && !error && (
        <div className="mb-4 rounded-[0.95rem] border border-[rgba(9,28,57,0.08)] bg-[rgba(248,250,252,0.9)] px-3.5 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Debug UI</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-[var(--ink-soft)] sm:grid-cols-5">
            <div><span className="text-[var(--ink-muted)]">gameDay</span><p className="font-semibold text-[var(--ink-strong)]">{gameDay}</p></div>
            <div><span className="text-[var(--ink-muted)]">alternativesPoolCount</span><p className="font-semibold text-[var(--ink-strong)]">{draft?.alternativesPoolCount ?? 0}</p></div>
            <div><span className="text-[var(--ink-muted)]">candidatePairsCount</span><p className="font-semibold text-[var(--ink-strong)]">{draft?.candidatePairsCount ?? 0}</p></div>
            <div><span className="text-[var(--ink-muted)]">hasSuggestedPair</span><p className="font-semibold text-[var(--ink-strong)]">{draft?.suggestedPair ? 'yes' : 'no'}</p></div>
            <div><span className="text-[var(--ink-muted)]">hasSavedCombi</span><p className="font-semibold text-[var(--ink-strong)]">{savedCombi ? 'yes' : 'no'}</p></div>
            <div><span className="text-[var(--ink-muted)]">basePicksEligibleAB</span><p className="font-semibold text-[var(--ink-strong)]">{draft?.basePicksEligibleAB ?? 0}</p></div>
            <div><span className="text-[var(--ink-muted)]">basePicksRejectedC</span><p className="font-semibold text-[var(--ink-strong)]">{draft?.basePicksRejectedC ?? 0}</p></div>
            <div><span className="text-[var(--ink-muted)]">alternativesGeneratedFromAB</span><p className="font-semibold text-[var(--ink-strong)]">{draft?.alternativesGeneratedFromAB ?? 0}</p></div>
          </div>
        </div>
      )}

      {loading && <div className="glass-panel rounded-[1.2rem] p-5"><p className="text-sm text-[var(--ink-muted)]">Cargando combi...</p></div>}

      {!loading && error && <div className="rounded-[1rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

      {!loading && !error && stalePendingCombi && (
        <div className="mb-4 rounded-[1rem] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>Hay una combi pendiente guardada de una version anterior que no cuenta como confirmada.</p>
          <button onClick={() => void handleDiscardStale()} disabled={confirming} className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-40">
            Descartar combi de hoy
          </button>
        </div>
      )}

      {!loading && !error && savedCombi && (
        <div className="glass-panel mb-5 rounded-[1.2rem] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Combi confirmada</p>
              <p className="text-2xl font-bold text-[var(--ink-strong)]">{formatOdds(savedCombi.combinedRealOdds ?? savedCombi.combinedApiOdds)}</p>
            </div>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(savedCombi.status)}`}>{savedCombi.status}</span>
          </div>
          <div className="mb-4 flex flex-col gap-3">
            <SavedLegCard legNum={1} leg={savedCombi.leg1} realOddsInput={savedLeg1OddsInput} onRealOddsChange={setSavedLeg1OddsInput} onSettle={handleSettle} settleLoading={settleLoading} confirming={confirming} />
            <SavedLegCard legNum={2} leg={savedCombi.leg2} realOddsInput={savedLeg2OddsInput} onRealOddsChange={setSavedLeg2OddsInput} onSettle={handleSettle} settleLoading={settleLoading} confirming={confirming} />
          </div>
          {savedCombi.status === 'pending' && (
            <button onClick={() => void handleConfirmSavedOdds()} disabled={confirming || !savedLeg1OddsInput || !savedLeg2OddsInput} className="w-full rounded-xl border border-[var(--surface-navy)] bg-[var(--surface-navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {confirming ? 'Guardando...' : 'Actualizar cuotas reales'}
            </button>
          )}
          {settleError && <p className="mt-2 text-xs text-rose-700">{settleError}</p>}
        </div>
      )}

      {!loading && !error && draft && draftLeg1 && draftLeg2 && (
        <div className="glass-panel mb-4 rounded-[1.2rem] p-4">
          <div className="mb-4 rounded-[0.85rem] border border-[rgba(9,28,57,0.06)] bg-white/70 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Draft Lab</p>
                <p className="text-2xl font-bold text-[var(--ink-strong)]">{formatOdds(currentDraftCombinedOdds)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">Objetivo</p>
                <p className={`text-sm font-semibold ${draftOutOfRange ? 'text-amber-700' : 'text-emerald-700'}`}>{draft.targetRange[0].toFixed(2)} - {draft.targetRange[1].toFixed(2)}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--ink-muted)]">
              <span>Pool: {draft.alternativesPoolCount}</span>
              <span>Pares validos: {draft.candidatePairsCount}</span>
              <span>Sugerida inicial: {formatOdds(draft.bestPairBeforeManualEdit?.combinedApiOdds ?? null)}</span>
            </div>
          </div>

          <div className="mb-4 grid gap-3">
            <DraftLegCard
              legNum={1}
              leg={draftLeg1}
              alternatives={replacementOptionsForLeg1}
              open={openAlternativeLeg === 1}
              onToggleAlternatives={() => setOpenAlternativeLeg((current) => (current === 1 ? null : 1))}
              onRealOddsChange={(value) => updateDraftLeg(1, (leg) => ({ ...leg, realOddsInput: value }))}
              onLineInputChange={(value) => updateDraftLeg(1, (leg) => ({ ...leg, lineInput: value }))}
              onSelectAlternative={(candidate) => handleSelectAlternative(1, candidate)}
              disabled={confirming}
              validationError={leg1ValidationError}
            />
            <DraftLegCard
              legNum={2}
              leg={draftLeg2}
              alternatives={replacementOptionsForLeg2}
              open={openAlternativeLeg === 2}
              onToggleAlternatives={() => setOpenAlternativeLeg((current) => (current === 2 ? null : 2))}
              onRealOddsChange={(value) => updateDraftLeg(2, (leg) => ({ ...leg, realOddsInput: value }))}
              onLineInputChange={(value) => updateDraftLeg(2, (leg) => ({ ...leg, lineInput: value }))}
              onSelectAlternative={(candidate) => handleSelectAlternative(2, candidate)}
              disabled={confirming}
              validationError={leg2ValidationError}
            />
          </div>

          {draftOutOfRange && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              La cuota combinada actual queda fuera de 1.65-1.85.
            </div>
          )}

          <div className="space-y-2">
            {draftOutOfRange && lastEditedLeg && (
              <button onClick={handleFindBetterPair} disabled={confirming} className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 disabled:opacity-40">
                Buscar mejor pareja
              </button>
            )}
            <button onClick={() => void handleConfirmDraft()} disabled={confirming} className="w-full rounded-xl border border-[var(--surface-navy)] bg-[var(--surface-navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
              {confirming ? 'Confirmando...' : 'Confirmar combi'}
            </button>
            {confirmError && <p className="text-xs text-rose-700">{confirmError}</p>}
            {confirmSuccess && <p className="text-xs text-emerald-700">{confirmSuccess}</p>}
          </div>
        </div>
      )}

      {!loading && !error && !savedCombi && !draft && (
        <div className="glass-panel rounded-[1.2rem] p-5 text-center">
          <p className="text-sm text-[var(--ink-muted)]">{reason ?? 'No hay combinada para este dia.'}</p>
        </div>
      )}

      {stats && <StatsCard stats={stats} />}
    </div>
  );
}
