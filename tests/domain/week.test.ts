// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  addDays,
  isoWeekday,
  listDays,
  mondayOf,
  resolveTargetWeek,
  todayInTimeZone,
} from '@/lib/domain/week';

describe('lib/domain/week', () => {
  describe('todayInTimeZone', () => {
    it('uses the Rome date when UTC is still the previous day', () => {
      expect(todayInTimeZone(new Date('2026-09-27T22:30:00Z'), 'Europe/Rome')).toBe('2026-09-28');
    });

    it('returns the UTC date for the UTC zone', () => {
      expect(todayInTimeZone(new Date('2026-09-28T10:00:00Z'), 'UTC')).toBe('2026-09-28');
    });
  });

  describe('date arithmetic', () => {
    it('computes the ISO weekday (1 = Monday ... 7 = Sunday)', () => {
      expect(isoWeekday('2026-09-28')).toBe(1);
      expect(isoWeekday('2026-10-04')).toBe(7);
    });

    it('finds the Monday of a week', () => {
      expect(mondayOf('2026-10-04')).toBe('2026-09-28');
      expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    });

    it('adds days across a year boundary and negative offsets', () => {
      expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
      expect(addDays('2027-01-02', -3)).toBe('2026-12-30');
    });

    it('lists days inclusively and returns [] when first > last', () => {
      expect(listDays('2026-09-30', '2026-10-04')).toEqual([
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
        '2026-10-04',
      ]);
      expect(listDays('2026-10-05', '2026-10-04')).toEqual([]);
    });
  });

  describe('resolveTargetWeek', () => {
    it('targets the current week from today on (Wednesday)', () => {
      expect(resolveTargetWeek('2026-09-30')).toEqual({
        week_start: '2026-09-28',
        first_day: '2026-09-30',
        last_day: '2026-10-04',
      });
    });

    it('starts on Monday when today is Monday', () => {
      expect(resolveTargetWeek('2026-09-28').first_day).toBe('2026-09-28');
    });

    it('still targets the current week on Friday', () => {
      const week = resolveTargetWeek('2026-10-02');
      expect(week.week_start).toBe('2026-09-28');
      expect(week.first_day).toBe('2026-10-02');
    });

    it.each(['2026-10-03', '2026-10-04'])('targets next week on the weekend (%s)', (day) => {
      expect(resolveTargetWeek(day)).toEqual({
        week_start: '2026-10-05',
        first_day: '2026-10-05',
        last_day: '2026-10-11',
      });
    });
  });
});
