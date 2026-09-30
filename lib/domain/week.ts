import type { PlanWeek } from './types';

const MS_PER_DAY = 86_400_000;
const SATURDAY = 6;
const DAYS_PER_WEEK = 7;

function parseIso(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatUtc(ms: number): string {
  const date = new Date(ms);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Data odierna (YYYY-MM-DD) nel fuso indicato. */
export function todayInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`todayInTimeZone: parte "${type}" mancante`);
    return part.value;
  };
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Somma `days` (anche negativi) a una data YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  return formatUtc(parseIso(isoDate) + days * MS_PER_DAY);
}

/** Giorno della settimana ISO: 1 = lunedì … 7 = domenica. */
export function isoWeekday(isoDate: string): number {
  const day = new Date(parseIso(isoDate)).getUTCDay(); // 0 = domenica
  return day === 0 ? 7 : day;
}

/** Lunedì della settimana che contiene la data. */
export function mondayOf(isoDate: string): string {
  return addDays(isoDate, 1 - isoWeekday(isoDate));
}

/** Elenco inclusivo delle date da `first` a `last`; vuoto se first > last. */
export function listDays(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * Settimana obiettivo di "Genera piano" / "Rigenera".
 * Da lunedì a venerdì: settimana corrente, dal giorno odierno.
 * Sabato e domenica: settimana successiva, dal lunedì.
 */
export function resolveTargetWeek(today: string): PlanWeek {
  const isWeekend = isoWeekday(today) >= SATURDAY;
  const weekStart = isWeekend ? addDays(mondayOf(today), DAYS_PER_WEEK) : mondayOf(today);
  return {
    week_start: weekStart,
    first_day: isWeekend ? weekStart : today,
    last_day: addDays(weekStart, DAYS_PER_WEEK - 1),
  };
}
