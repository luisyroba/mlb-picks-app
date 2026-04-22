type SnapshotPayload = Record<string, unknown> | null;

type MarketSnapshotLike = {
  home_team?: string | null;
  away_team?: string | null;
} | null;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isNumericOnly(value?: string | null) {
  return typeof value === 'string' && /^\d+$/.test(value.trim());
}

function buildMatchupLabel(awayName?: unknown, homeName?: unknown) {
  const away = cleanText(awayName);
  const home = cleanText(homeName);
  if (!away || !home) return null;
  return `${away} @ ${home}`;
}

function getEspnShortName(snapshotPayload: SnapshotPayload) {
  const espnGame =
    snapshotPayload?.espnGame && typeof snapshotPayload.espnGame === 'object'
      ? (snapshotPayload.espnGame as Record<string, unknown>)
      : null;

  return cleanText(espnGame?.shortName);
}

function getEngineMatchup(snapshotPayload: SnapshotPayload) {
  const engineGame =
    snapshotPayload?.engineGame && typeof snapshotPayload.engineGame === 'object'
      ? (snapshotPayload.engineGame as Record<string, unknown>)
      : null;
  const homeTeam =
    engineGame?.homeTeam && typeof engineGame.homeTeam === 'object'
      ? (engineGame.homeTeam as Record<string, unknown>)
      : null;
  const awayTeam =
    engineGame?.awayTeam && typeof engineGame.awayTeam === 'object'
      ? (engineGame.awayTeam as Record<string, unknown>)
      : null;
  const homeCore =
    homeTeam?.core && typeof homeTeam.core === 'object'
      ? (homeTeam.core as Record<string, unknown>)
      : null;
  const awayCore =
    awayTeam?.core && typeof awayTeam.core === 'object'
      ? (awayTeam.core as Record<string, unknown>)
      : null;

  return buildMatchupLabel(awayCore?.teamName, homeCore?.teamName);
}

export function resolveMatchupLabel(options: {
  fallbackGameLabel?: string | null;
  snapshotPayload?: SnapshotPayload;
  marketSnapshot?: MarketSnapshotLike;
  gameId?: string | null;
}) {
  const fromSnapshotShortName = getEspnShortName(options.snapshotPayload ?? null);
  if (fromSnapshotShortName && !isNumericOnly(fromSnapshotShortName)) {
    return fromSnapshotShortName;
  }

  const fromEngineMatchup = getEngineMatchup(options.snapshotPayload ?? null);
  if (fromEngineMatchup) {
    return fromEngineMatchup;
  }

  const fromMarketSnapshot = buildMatchupLabel(
    options.marketSnapshot?.away_team,
    options.marketSnapshot?.home_team
  );
  if (fromMarketSnapshot) {
    return fromMarketSnapshot;
  }

  const fallbackLabel = cleanText(options.fallbackGameLabel);
  if (fallbackLabel && !isNumericOnly(fallbackLabel)) {
    return fallbackLabel;
  }

  return cleanText(options.gameId) ?? '';
}
