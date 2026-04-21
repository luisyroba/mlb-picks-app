export function getSlateDayKey(
  gameDay?: string | null,
  gameDate?: string | null,
  createdAt?: string | null
): string | null {
  if (typeof gameDay === 'string' && gameDay.trim()) {
    return gameDay.slice(0, 10);
  }
  if (typeof gameDate === 'string' && gameDate.trim()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(gameDate));
  }
  if (typeof createdAt === 'string' && createdAt.trim()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(createdAt));
  }
  return null;
}

