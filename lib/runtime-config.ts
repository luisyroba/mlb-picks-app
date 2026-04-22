export const USER_TIMEZONE = 'America/Santiago';
export const ODDS_REFRESH_COOLDOWN_MS = 20 * 60 * 1000;
export const GAME_START_GRACE_PERIOD_MS = 5 * 60 * 1000;
export const SOLID_PICK_RESET_DATE_KEYS: string[] = ['2026-04-16'];
export const LIVE_STATS_CUTOFF_DATE_KEY = '2026-04-21';

function getTimeZoneDateParts(
  value: Date | string | number,
  locale = 'en-CA'
) {
  const date =
    value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (
        part.type === 'year' ||
        part.type === 'month' ||
        part.type === 'day'
      ) {
        accumulator[part.type] = part.value;
      }

      return accumulator;
    }, {});
}

export function formatDateKeyForTimezone(
  offsetDays = 0,
  {
    dashed = false,
    referenceDate = new Date()
  }: {
    dashed?: boolean;
    referenceDate?: Date;
  } = {}
) {
  const shifted = new Date(referenceDate.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);

  const parts = getTimeZoneDateParts(shifted);

  if (!parts?.year || !parts.month || !parts.day) {
    return '';
  }

  return dashed
    ? `${parts.year}-${parts.month}-${parts.day}`
    : `${parts.year}${parts.month}${parts.day}`;
}

export function formatDateTimeForTimezone(
  value?: Date | string | number | null,
  locale = 'es-CL',
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }
) {
  if (!value) return null;

  const date =
    value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: USER_TIMEZONE,
    ...options
  }).format(date);
}
