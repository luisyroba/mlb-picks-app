export type PersistedSolidPick = {
  dateKey: string;
  gameId: string;
  gameLabel: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  confidence: string;
  score: number;
  edge: number | null;
  ev: number | null;
  note?: string | null;
  lockedAt: string;
  settledStatus?: 'won' | 'lost' | 'void';
  profitUnits?: number | null;
};

const STORAGE_PREFIX = 'mlb-solid-pick';

export function getSolidPickStorageKey(dateKey: string) {
  return `${STORAGE_PREFIX}:${dateKey}`;
}

function compactDateKey(dateKey: string) {
  return dateKey.replace(/-/g, '');
}

function dashedDateKey(dateKey: string) {
  if (dateKey.includes('-')) return dateKey;
  if (!/^\d{8}$/.test(dateKey)) return dateKey;
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

function getCandidateStorageKeys(dateKey: string) {
  const keys = [getSolidPickStorageKey(dateKey)];
  const compact = compactDateKey(dateKey);
  const dashed = dashedDateKey(dateKey);

  if (compact !== dateKey) {
    keys.push(getSolidPickStorageKey(compact));
  }

  if (dashed !== dateKey && dashed !== compact) {
    keys.push(getSolidPickStorageKey(dashed));
  }

  return [...new Set(keys)];
}

export function readSolidPick(dateKey: string): PersistedSolidPick | null {
  if (typeof window === 'undefined') return null;

  try {
    for (const storageKey of getCandidateStorageKeys(dateKey)) {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) continue;

      const parsed = JSON.parse(raw) as PersistedSolidPick;
      if (!parsed || !parsed.gameId) continue;

      return {
        ...parsed,
        dateKey
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function writeSolidPick(pick: PersistedSolidPick) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getSolidPickStorageKey(pick.dateKey), JSON.stringify(pick));
}

export function clearSolidPick(dateKey: string) {
  if (typeof window === 'undefined') return;
  for (const storageKey of getCandidateStorageKeys(dateKey)) {
    window.localStorage.removeItem(storageKey);
  }
}
