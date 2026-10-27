// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  compositionDishes,
  distributeCompositions,
  fitsCourse,
  filterCourses,
  mainCourseForChoice,
  mainCourseOf,
  mealCompositionOf,
} from '@/lib/domain/compositions';
import { createRng } from '@/lib/domain/rng';
import {
  MEAL_COMPOSITION_VALUES,
  type Course,
  type MealComposition,
} from '@/lib/domain/types';

const ALL = [...MEAL_COMPOSITION_VALUES];

function countOf(list: readonly MealComposition[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of list) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

describe('compositionDishes', () => {
  it('maps each composition to its main course and side flag', () => {
    expect(compositionDishes('piatto-unico')).toEqual({ main: 'piatto-unico', side: false });
    expect(compositionDishes('primo')).toEqual({ main: 'primo', side: false });
    expect(compositionDishes('primo-contorno')).toEqual({ main: 'primo', side: true });
    expect(compositionDishes('secondo')).toEqual({ main: 'secondo', side: false });
    expect(compositionDishes('secondo-contorno')).toEqual({ main: 'secondo', side: true });
  });
});

describe('mealCompositionOf', () => {
  it('returns the composition of a single main course', () => {
    expect(mealCompositionOf(['secondo'])).toBe('secondo');
  });

  it('returns the side composition when a contorno accompanies a secondo, in any order', () => {
    expect(mealCompositionOf(['contorno', 'secondo'])).toBe('secondo-contorno');
    expect(mealCompositionOf(['secondo', 'contorno'])).toBe('secondo-contorno');
  });

  it('returns primo-contorno when a contorno accompanies a primo', () => {
    expect(mealCompositionOf(['primo', 'contorno'])).toBe('primo-contorno');
  });

  it('rejects a contorno next to a piatto-unico', () => {
    expect(mealCompositionOf(['piatto-unico', 'contorno'])).toBeNull();
  });

  it('rejects a meal with only a contorno', () => {
    expect(mealCompositionOf(['contorno'])).toBeNull();
  });

  it('rejects two main courses', () => {
    expect(mealCompositionOf(['primo', 'secondo'])).toBeNull();
  });

  it('rejects two contorni', () => {
    expect(mealCompositionOf(['secondo', 'contorno', 'contorno'])).toBeNull();
  });

  it('rejects an empty meal', () => {
    expect(mealCompositionOf([])).toBeNull();
  });
});

describe('distributeCompositions', () => {
  it('returns an empty list for a non-positive count', () => {
    expect(distributeCompositions(ALL, 0, createRng(1))).toEqual([]);
    expect(distributeCompositions(ALL, -3, createRng(1))).toEqual([]);
  });

  it('gives 7 compositions over 5 options: each 1 or 2 times, exactly two of them twice', () => {
    const result = distributeCompositions(ALL, 7, createRng(1));
    expect(result).toHaveLength(7);
    const counts = Object.values(countOf(result));
    expect(counts.every((n) => n === 1 || n === 2)).toBe(true);
    expect(counts.filter((n) => n === 2)).toHaveLength(2);
  });

  it('gives 10 compositions over 5 options: two of each', () => {
    const result = distributeCompositions(ALL, 10, createRng(1));
    expect(countOf(result)).toEqual({
      'piatto-unico': 2,
      primo: 2,
      'primo-contorno': 2,
      secondo: 2,
      'secondo-contorno': 2,
    });
  });

  it('gives 3 compositions over 5 options: three distinct ones', () => {
    const result = distributeCompositions(ALL, 3, createRng(7));
    expect(new Set(result).size).toBe(3);
  });

  it('repeats the only allowed composition', () => {
    const result = distributeCompositions(['secondo-contorno'], 4, createRng(1));
    expect(result).toEqual(['secondo-contorno', 'secondo-contorno', 'secondo-contorno', 'secondo-contorno']);
  });

  it('ignores duplicates and order in allowed: same result as the canonical list with the same seed', () => {
    const messy: MealComposition[] = ['secondo', 'piatto-unico', 'secondo', 'secondo-contorno', 'primo'];
    const canonical: MealComposition[] = ['piatto-unico', 'primo', 'secondo', 'secondo-contorno'];
    expect(distributeCompositions(messy, 9, createRng(42))).toEqual(
      distributeCompositions(canonical, 9, createRng(42))
    );
  });

  it('is deterministic for the same seed', () => {
    expect(distributeCompositions(ALL, 8, createRng(99))).toEqual(
      distributeCompositions(ALL, 8, createRng(99))
    );
  });

  it('throws when no composition is allowed', () => {
    expect(() => distributeCompositions([], 1, createRng(1))).toThrow(
      'distributeCompositions: nessuna composizione ammessa'
    );
  });
});

describe('fitsCourse', () => {
  it('accepts an unclassified recipe in any main course, never as a contorno', () => {
    expect(fitsCourse([], 'primo')).toBe(true);
    expect(fitsCourse([], 'any-main')).toBe(true);
    expect(fitsCourse([], 'contorno')).toBe(false);
  });

  it('accepts a contorno only for the contorno filter', () => {
    expect(fitsCourse(['contorno'], 'contorno')).toBe(true);
    expect(fitsCourse(['contorno'], 'any-main')).toBe(false);
    expect(fitsCourse(['contorno'], 'secondo')).toBe(false);
  });

  it('accepts a recipe for each of its courses and rejects the others', () => {
    expect(fitsCourse(['secondo', 'piatto-unico'], 'piatto-unico')).toBe(true);
    expect(fitsCourse(['secondo', 'piatto-unico'], 'secondo')).toBe(true);
    expect(fitsCourse(['secondo', 'piatto-unico'], 'primo')).toBe(false);
  });
});

describe('filterCourses', () => {
  it('expands any-main to the three main courses', () => {
    expect(filterCourses('any-main')).toEqual(['piatto-unico', 'primo', 'secondo']);
  });

  it('returns the single course for a precise filter', () => {
    expect(filterCourses('contorno')).toEqual(['contorno']);
  });
});

describe('mainCourseOf', () => {
  it('returns the first main course in canonical order, ignoring the contorno', () => {
    expect(mainCourseOf(['secondo', 'piatto-unico'])).toBe('piatto-unico');
    expect(mainCourseOf(['primo'])).toBe('primo');
  });

  it('falls back to piatto-unico without a main course', () => {
    expect(mainCourseOf(['contorno'])).toBe('piatto-unico');
    expect(mainCourseOf([])).toBe('piatto-unico');
  });
});

describe('mainCourseForChoice', () => {
  const cases: Array<[readonly Course[], Course, boolean, Course]> = [
    [[], 'secondo', true, 'secondo'],
    [['secondo', 'piatto-unico'], 'secondo', true, 'secondo'],
    [['primo', 'piatto-unico'], 'secondo', true, 'primo'],
    [['primo', 'piatto-unico'], 'secondo', false, 'piatto-unico'],
    [['piatto-unico'], 'secondo', true, 'piatto-unico'],
    [['secondo'], 'piatto-unico', false, 'secondo'],
  ];

  it.each(cases)(
    'courses %j, current %s, hasSide %s → %s',
    (courses, currentCourse, hasSide, expected) => {
      expect(mainCourseForChoice(courses, currentCourse, hasSide)).toBe(expected);
    }
  );
});
