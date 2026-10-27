// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  FEW_INGREDIENTS_MAX,
  countMeasuredIngredients,
  courseLabel,
  coursesAllowed,
  deriveStyleTags,
  isMainDish,
  normalizeCourses,
} from '@/lib/domain/courses';
import {
  MAIN_COURSE_VALUES,
  type Course,
  type MealStyleTag,
  type Unit,
} from '@/lib/domain/types';

function measured(count: number): { unit: Unit }[] {
  return Array.from({ length: count }, () => ({ unit: 'g' as const }));
}

function withQb(measuredCount: number, qbCount: number): { unit: Unit }[] {
  return [...measured(measuredCount), ...Array.from({ length: qbCount }, () => ({ unit: 'qb' as const }))];
}

describe('lib/domain/courses', () => {
  describe('normalizeCourses', () => {
    it('removes duplicates and sorts by COURSE_VALUES order', () => {
      expect(normalizeCourses(['secondo', 'piatto-unico', 'secondo'])).toEqual([
        'piatto-unico',
        'secondo',
      ]);
    });

    it('returns an empty array for no courses and a new array otherwise', () => {
      const input: Course[] = ['contorno'];
      const result = normalizeCourses(input);
      expect(normalizeCourses([])).toEqual([]);
      expect(result).toEqual(['contorno']);
      expect(result).not.toBe(input);
    });
  });

  describe('coursesAllowed', () => {
    it('accepts any recipe when the allowed list is null', () => {
      expect(coursesAllowed(['contorno'], null)).toBe(true);
      expect(coursesAllowed(['primo'], null)).toBe(true);
    });

    it('accepts an unclassified recipe (empty courses) for any allowed list', () => {
      expect(coursesAllowed([], MAIN_COURSE_VALUES)).toBe(true);
      expect(coursesAllowed([], ['contorno'])).toBe(true);
      expect(coursesAllowed([], null)).toBe(true);
    });

    it('rejects a side-dish-only recipe against the main courses', () => {
      expect(coursesAllowed(['contorno'], MAIN_COURSE_VALUES)).toBe(false);
    });

    it('accepts when at least one course is allowed', () => {
      expect(coursesAllowed(['secondo', 'contorno'], ['contorno'])).toBe(true);
    });

    it('rejects when no course is allowed', () => {
      expect(coursesAllowed(['primo'], ['secondo'])).toBe(false);
    });
  });

  describe('isMainDish', () => {
    it('treats unclassified recipes as main dishes', () => {
      expect(isMainDish([])).toBe(true);
    });

    it('rejects a side-dish-only recipe', () => {
      expect(isMainDish(['contorno'])).toBe(false);
    });

    it('accepts a recipe with at least one main course', () => {
      expect(isMainDish(['secondo', 'contorno'])).toBe(true);
      expect(isMainDish(['piatto-unico'])).toBe(true);
      expect(isMainDish(['primo'])).toBe(true);
    });
  });

  describe('courseLabel', () => {
    it('returns null for an unclassified recipe', () => {
      expect(courseLabel([])).toBeNull();
    });

    it('joins the labels in COURSE_VALUES order with " · "', () => {
      expect(courseLabel(['secondo', 'piatto-unico'])).toBe('Piatto unico · Secondo');
      expect(courseLabel(['secondo', 'contorno', 'primo'])).toBe('Primo · Secondo · Contorno');
    });

    it('returns the single label for one course', () => {
      expect(courseLabel(['contorno'])).toBe('Contorno');
    });
  });

  describe('countMeasuredIngredients', () => {
    it('counts only the ingredients whose unit is not qb', () => {
      expect(countMeasuredIngredients(withQb(4, 3))).toBe(4);
    });

    it('returns 0 for an empty list', () => {
      expect(countMeasuredIngredients([])).toBe(0);
    });
  });

  describe('deriveStyleTags', () => {
    it('adds pochi-ingredienti when there are at most FEW_INGREDIENTS_MAX measured ingredients', () => {
      expect(FEW_INGREDIENTS_MAX).toBe(6);
      const tags = deriveStyleTags([], withQb(6, 3));
      expect(tags).toContain('pochi-ingredienti');
    });

    it('removes pochi-ingredienti from the model tags when there are more than FEW_INGREDIENTS_MAX measured ingredients', () => {
      const tags = deriveStyleTags(['pochi-ingredienti'], measured(7));
      expect(tags).not.toContain('pochi-ingredienti');
    });

    it('returns tags without duplicates in MEAL_STYLE_TAG_VALUES order', () => {
      const tags: MealStyleTag[] = ['piatto-freddo', 'veloce', 'veloce'];
      expect(deriveStyleTags(tags, measured(8))).toEqual(['veloce', 'piatto-freddo']);
    });
  });
});
