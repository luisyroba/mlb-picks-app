export function getSlateDayKey(gameDate?: string | null, createdAt?: string | null): string | null {
  if (typeof gameDate === 'string' && gameDate.trim()) {
    return gameDate.slice(0, 10);
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
