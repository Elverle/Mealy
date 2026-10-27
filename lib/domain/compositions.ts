// Regole pure delle composizioni del pasto (Feature 11). Nessuna dipendenza da DB, LLM o framework.

import {
  COURSE_VALUES,
  MAIN_COURSE_VALUES,
  MEAL_COMPOSITION_VALUES,
  type Course,
  type CourseFilter,
  type MealComposition,
} from '@/lib/domain/types';
import { coursesAllowed } from './courses';
import type { Rng } from './rng';

const SIDE_COURSE = 'contorno' as const;
const DEFAULT_MAIN_COURSE: Course = 'piatto-unico';

type MainCourse = Exclude<Course, typeof SIDE_COURSE>;

const COMPOSITION_DISHES: Record<MealComposition, { main: Course; side: boolean }> = {
  'piatto-unico': { main: 'piatto-unico', side: false },
  primo: { main: 'primo', side: false },
  'primo-contorno': { main: 'primo', side: true },
  secondo: { main: 'secondo', side: false },
  'secondo-contorno': { main: 'secondo', side: true },
};

/** Piatti di una composizione: la portata del principale e se c'è il contorno. */
export function compositionDishes(composition: MealComposition): { main: Course; side: boolean } {
  return COMPOSITION_DISHES[composition];
}

/**
 * Composizione formata dalle portate degli slot di un pasto (in qualsiasi ordine), oppure
 * null se non ne formano una: serve esattamente un principale e al più un contorno, e il
 * contorno solo con un primo o un secondo.
 */
export function mealCompositionOf(courses: readonly Course[]): MealComposition | null {
  const mains = courses.filter((course): course is MainCourse => course !== SIDE_COURSE);
  const sides = courses.length - mains.length;
  if (mains.length !== 1 || sides > 1) return null;

  const [main] = mains;
  if (sides === 0) return main;
  if (main === 'primo') return 'primo-contorno';
  if (main === 'secondo') return 'secondo-contorno';
  return null;
}

// Fisher–Yates sul posto: consuma una chiamata a rng per elemento (da 1 in su).
function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * `count` composizioni bilanciate tra quelle ammesse: ognuna esce ⌊count/k⌋ volte, le
 * count mod k in più vanno a composizioni sorteggiate senza ripetizioni; poi l'elenco si
 * mescola. Deterministica a parità di input e `rng`.
 */
export function distributeCompositions(
  allowed: readonly MealComposition[],
  count: number,
  rng: Rng
): MealComposition[] {
  if (count <= 0) return [];

  const options = MEAL_COMPOSITION_VALUES.filter((composition) => allowed.includes(composition));
  if (options.length === 0) {
    throw new Error('distributeCompositions: nessuna composizione ammessa');
  }

  const base = Math.floor(count / options.length);
  const extra = count % options.length;
  const lucky = new Set(shuffle([...options], rng).slice(0, extra));
  const list = options.flatMap((composition) =>
    Array<MealComposition>(base + (lucky.has(composition) ? 1 : 0)).fill(composition)
  );
  return shuffle(list, rng);
}

/** Portate di un filtro: 'any-main' → le tre principali; altrimenti la portata sola. Array nuovo. */
export function filterCourses(filter: CourseFilter): Course[] {
  return filter === 'any-main' ? [...MAIN_COURSE_VALUES] : [filter];
}

/**
 * true se una ricetta con queste portate può stare in uno slot con questo filtro.
 * Non classificata: ammessa in ogni principale e in 'any-main', mai come contorno.
 * Contorno: solo una ricetta che è soltanto contorno (non anche primo o secondo).
 */
export function fitsCourse(courses: readonly Course[], filter: CourseFilter): boolean {
  if (filter === SIDE_COURSE && courses.length === 0) return false;
  return coursesAllowed(courses, filterCourses(filter));
}

/** Prima portata principale della ricetta (ordine di COURSE_VALUES), altrimenti 'piatto-unico'. */
export function mainCourseOf(courses: readonly Course[]): Course {
  return (
    COURSE_VALUES.find((course) => course !== SIDE_COURSE && courses.includes(course)) ??
    DEFAULT_MAIN_COURSE
  );
}

/**
 * Portata che prende il principale quando l'utente ci mette a mano questa ricetta (spec FR-5.4).
 */
export function mainCourseForChoice(
  courses: readonly Course[],
  currentCourse: Course,
  hasSide: boolean
): Course {
  if (courses.length === 0) return currentCourse;
  if (courses.includes(currentCourse)) return currentCourse;
  if (hasSide) {
    if (courses.includes('primo')) return 'primo';
    if (courses.includes('secondo')) return 'secondo';
  }
  return mainCourseOf(courses);
}
