// Regole pure di portate ed etichette derivate (Feature 8). Nessuna dipendenza da DB, LLM o framework.

import {
  COURSE_LABELS,
  COURSE_VALUES,
  MAIN_COURSE_VALUES,
  MEAL_STYLE_TAG_VALUES,
  type Course,
  type MealStyleTag,
  type Unit,
} from '@/lib/domain/types';

// Oltre questo numero di ingredienti misurati una ricetta non è "pochi ingredienti".
export const FEW_INGREDIENTS_MAX = 6;

/** Portate senza doppioni, nell'ordine di COURSE_VALUES. Array nuovo. */
export function normalizeCourses(courses: readonly Course[]): Course[] {
  const set = new Set(courses);
  return COURSE_VALUES.filter((course) => set.has(course));
}

/**
 * true se una ricetta con queste portate è ammessa dove valgono le portate `allowed`:
 * `allowed` null (qualsiasi), ricetta non classificata (`courses` vuoto), oppure almeno una
 * portata in comune. È l'unico predicato di portata: lo usano `fitsCourse` (planner) e i
 * vincoli di generazione.
 */
export function coursesAllowed(courses: readonly Course[], allowed: readonly Course[] | null): boolean {
  if (allowed === null || courses.length === 0) return true;
  return courses.some((course) => allowed.includes(course));
}

/** coursesAllowed(courses, MAIN_COURSE_VALUES): non classificata o con una portata principale. */
export function isMainDish(courses: readonly Course[]): boolean {
  return coursesAllowed(courses, MAIN_COURSE_VALUES);
}

/** Etichette delle portate nell'ordine di COURSE_VALUES unite da " · "; null se `courses` è vuoto. */
export function courseLabel(courses: readonly Course[]): string | null {
  const normalized = normalizeCourses(courses);
  if (normalized.length === 0) return null;
  return normalized.map((course) => COURSE_LABELS[course]).join(' · ');
}

/** Righe di ingredienti con unità diversa da 'qb'. */
export function countMeasuredIngredients(ingredients: readonly { unit: Unit }[]): number {
  return ingredients.filter((ingredient) => ingredient.unit !== 'qb').length;
}

/**
 * Applica le regole che vincono sul modello e restituisce le etichette senza doppioni,
 * nell'ordine di MEAL_STYLE_TAG_VALUES:
 * - 'pochi-ingredienti' c'è se e solo se countMeasuredIngredients(ingredients) <= FEW_INGREDIENTS_MAX.
 */
export function deriveStyleTags(
  tags: readonly MealStyleTag[],
  ingredients: readonly { unit: Unit }[]
): MealStyleTag[] {
  const set = new Set<MealStyleTag>(tags);

  if (countMeasuredIngredients(ingredients) <= FEW_INGREDIENTS_MAX) {
    set.add('pochi-ingredienti');
  } else {
    set.delete('pochi-ingredienti');
  }

  return MEAL_STYLE_TAG_VALUES.filter((tag) => set.has(tag));
}
