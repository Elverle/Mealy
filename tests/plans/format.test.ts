import { describe, expect, it } from 'vitest';
import { formatDayLabel, formatWeekRange, IT_MONTHS_SHORT, IT_WEEKDAYS } from '@/lib/plans/format';

describe('plans/format', () => {
  it('exposes 7 weekdays and 12 months', () => {
    expect(IT_WEEKDAYS).toHaveLength(7);
    expect(IT_MONTHS_SHORT).toHaveLength(12);
  });

  it('formats a day label with weekday and day without leading zero', () => {
    expect(formatDayLabel('2026-09-30')).toBe('Mercoledì 30');
    expect(formatDayLabel('2026-10-04')).toBe('Domenica 4');
    expect(formatDayLabel('2026-09-28')).toBe('Lunedì 28');
  });

  it('formats a week range with both months, even within the same month', () => {
    expect(formatWeekRange('2026-09-28', '2026-10-04')).toBe('28 set – 4 ott');
    expect(formatWeekRange('2026-10-05', '2026-10-11')).toBe('5 ott – 11 ott');
  });

  it('handles year boundaries', () => {
    expect(formatWeekRange('2026-12-28', '2027-01-03')).toBe('28 dic – 3 gen');
  });
});
