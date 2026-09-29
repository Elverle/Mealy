import { isoWeekday } from '@/lib/domain/week';

export const IT_WEEKDAYS = [
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
  'Domenica',
] as const;

export const IT_MONTHS_SHORT = [
  'gen',
  'feb',
  'mar',
  'apr',
  'mag',
  'giu',
  'lug',
  'ago',
  'set',
  'ott',
  'nov',
  'dic',
] as const;

function parseParts(isoDate: string): { month: number; day: number } {
  const [, month, day] = isoDate.split('-').map(Number);
  return { month, day };
}

/** '2026-09-30' → 'Mercoledì 30' */
export function formatDayLabel(isoDate: string): string {
  const { day } = parseParts(isoDate);
  return `${IT_WEEKDAYS[isoWeekday(isoDate) - 1]} ${day}`;
}

/** ('2026-09-28', '2026-10-04') → '28 set – 4 ott' (sempre con entrambi i mesi) */
export function formatWeekRange(first: string, last: string): string {
  const a = parseParts(first);
  const b = parseParts(last);
  return `${a.day} ${IT_MONTHS_SHORT[a.month - 1]} – ${b.day} ${IT_MONTHS_SHORT[b.month - 1]}`;
}
