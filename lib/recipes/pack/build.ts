// Costruzione del pacchetto (Feature 10): ricette con diete e etichette per regola, tabella potata,
// statistiche del report. Controlli prima delle scritture; non importa il DB né l'LLM.

import {
  COURSE_VALUES,
  DIET_FLAG_VALUES,
  MEAL_TYPE_VALUES,
  PACK_GROUP_LABELS,
  PACK_GROUP_QUOTAS,
  PACK_GROUP_VALUES,
  PACK_MAIN_INGREDIENT_VALUES,
  RecipePackFileSchema,
  type GeneratedRecipe,
  type PackGroup,
  type PackIngredientFactDraft,
  type PackStats,
} from '@/lib/domain/types';
import { deriveStyleTags, normalizeCourses } from '@/lib/domain/courses';
import { normalizeCanonicalName, normalizeTitle } from '@/lib/domain/recipe-text';
import { deriveDietFlags, toIngredientFactsMap, type IngredientFactsMap } from '@/lib/domain/diet-rules';
import { toAliasMap } from '@/lib/domain/shopping-list';
import { areTitlesSimilar } from '@/lib/domain/title-similarity';
import { FIXTURE_INGREDIENT_ALIASES } from '@/fixtures';
import { PackError } from './errors';
import { writeJsonFile } from './files';
import {
  acceptedInOrder,
  ingredientNames,
  readIngredientsFile,
  writeIngredientsFile,
} from './ingredients';
import { PACK_FILE_PATH, PACK_INGREDIENTS_FILE_PATH } from './paths';
import { acceptedByGroup, readWorkState, type AcceptedRecipe } from './state';
import { writeReport } from './report';

const BUILD_FAILED_HEADER = 'Il pacchetto non si può costruire:';
const FORBIDDEN_TEXT_TOKENS: readonly string[] = ['http', 'www.', 'giallozafferano'];
const SHORT_PREP_MINUTES = 30;
const MEDIUM_PREP_MINUTES = 60;
const LONG_PREP_MINUTES = 120;

export interface BuildOptions {
  workDir: string;
  packFile?: string; // default PACK_FILE_PATH
  ingredientsFile?: string; // default PACK_INGREDIENTS_FILE_PATH
  now?: () => Date;
  quotas?: Readonly<Record<PackGroup, number>>; // default PACK_GROUP_QUOTAS (solo i test lo cambiano)
}

export interface BuildReport {
  recipes: number;
  stats: PackStats;
}

type PrepBucket = keyof PackStats['prep_minutes'];

function countsOf<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

/** Incrementa un contatore del pacchetto (z.record con chiavi enum è Partial: il valore può mancare). */
function countUp<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function prepBucket(minutes: number): PrepBucket {
  if (minutes <= SHORT_PREP_MINUTES) return 'up_to_30';
  if (minutes <= MEDIUM_PREP_MINUTES) return 'up_to_60';
  if (minutes <= LONG_PREP_MINUTES) return 'up_to_120';
  return 'over_120';
}

/** Statistiche di un pacchetto: `recipes[i]` e `built[i]` sono la stessa ricetta. */
export function computePackStats(
  recipes: readonly AcceptedRecipe[],
  built: readonly GeneratedRecipe[]
): PackStats {
  const stats: PackStats = {
    total: built.length,
    by_course: countsOf(COURSE_VALUES),
    by_meal_type: countsOf(MEAL_TYPE_VALUES),
    by_diet: countsOf(DIET_FLAG_VALUES),
    by_main_ingredient: countsOf(PACK_MAIN_INGREDIENT_VALUES),
    prep_minutes: { up_to_30: 0, up_to_60: 0, up_to_120: 0, over_120: 0 },
  };

  built.forEach((recipe, index) => {
    for (const course of new Set(recipe.courses)) countUp(stats.by_course, course);
    for (const mealType of new Set(recipe.meal_types)) countUp(stats.by_meal_type, mealType);
    for (const flag of new Set(recipe.diet_flags)) countUp(stats.by_diet, flag);
    countUp(stats.by_main_ingredient, recipes[index].candidate.main_ingredient);
    stats.prep_minutes[prepBucket(recipe.prep_minutes)] += 1;
  });
  return stats;
}

function quotaProblems(
  accepted: Record<PackGroup, AcceptedRecipe[]>,
  quotas: Readonly<Record<PackGroup, number>>
): string[] {
  return PACK_GROUP_VALUES.flatMap((group) => {
    const count = accepted[group].length;
    const quota = quotas[group];
    return count < quota ? [`${PACK_GROUP_LABELS[group]}: ${count}/${quota} ricette accettate.`] : [];
  });
}

function aliasProblems(names: readonly string[]): string[] {
  const aliases = toAliasMap(FIXTURE_INGREDIENT_ALIASES);
  return names.flatMap((name) => {
    const canonical = aliases.get(name);
    return canonical === undefined ? [] : [`Nomi che sono alias: ${name} (usa "${canonical}").`];
  });
}

function factFor(name: string, facts: IngredientFactsMap): PackIngredientFactDraft {
  const fact = facts.get(normalizeCanonicalName(name));
  if (fact === undefined) {
    throw new PackError(`Ingrediente senza voce nella tabella: ${normalizeCanonicalName(name)}`);
  }
  return fact;
}

/** Ricetta del pacchetto: categoria dalla tabella, diete e etichette ricavate per regola. */
function buildRecipe(recipe: GeneratedRecipe, facts: IngredientFactsMap): GeneratedRecipe {
  const ingredients = recipe.ingredients.map((ingredient) => ({
    ...ingredient,
    category: factFor(ingredient.canonical_name, facts).category,
  }));
  const courses = normalizeCourses(recipe.courses);
  return {
    ...recipe,
    ingredients,
    courses,
    diet_flags: deriveDietFlags(ingredients, facts),
    tags: deriveStyleTags(recipe.tags, courses, ingredients),
  };
}

/** Controlli sull'insieme costruito: titoli simili, testo vietato, schema del file. */
function consistencyProblems(built: readonly GeneratedRecipe[]): string[] {
  const problems: string[] = [];

  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const a = built[i].title;
      const b = built[j].title;
      if (normalizeTitle(a) === normalizeTitle(b) || areTitlesSimilar(a, b)) {
        problems.push(`Titoli simili: "${a}" e "${b}".`);
      }
    }
  }

  for (const recipe of built) {
    const text = JSON.stringify(recipe).toLowerCase();
    for (const token of FORBIDDEN_TEXT_TOKENS) {
      if (text.includes(token)) problems.push(`Testo vietato in "${recipe.title}": ${token}.`);
    }
  }

  const parsed = RecipePackFileSchema.safeParse({ recipes: built });
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    problems.push(`Ricetta non valida: ${issue.message}.`);
  }
  return problems;
}

function failure(problems: readonly string[]): PackError {
  return new PackError([BUILD_FAILED_HEADER, ...problems].join('\n'));
}

/**
 * Costruisce il pacchetto da candidati, revisione, record accettati e tabella: scrive il file del
 * pacchetto, la tabella potata al solo uso e il report. Con problemi lancia un solo PackError.
 */
export async function runBuild(options: BuildOptions): Promise<BuildReport> {
  const {
    workDir,
    packFile = PACK_FILE_PATH,
    ingredientsFile = PACK_INGREDIENTS_FILE_PATH,
    now = () => new Date(),
    quotas = PACK_GROUP_QUOTAS,
  } = options;

  const state = await readWorkState(workDir);
  const accepted = acceptedByGroup(state, quotas);
  const entries = await readIngredientsFile(ingredientsFile);
  const facts = toIngredientFactsMap(entries);

  const recipes = acceptedInOrder(accepted);
  const names = ingredientNames(recipes);
  const missing = names.filter((name) => !facts.has(name));
  const reviewedByName = new Map(entries.map((entry) => [normalizeCanonicalName(entry.name), entry.reviewed]));
  const unreviewed = names.filter((name) => reviewedByName.get(name) === false);

  const problems = [
    ...quotaProblems(accepted, quotas),
    ...(missing.length > 0 ? [`Ingredienti senza voce nella tabella: ${missing.join(', ')}.`] : []),
    ...(unreviewed.length > 0 ? [`Ingredienti da rivedere: ${unreviewed.join(', ')}.`] : []),
    ...aliasProblems(names),
  ];
  // Senza una voce per ogni nome la costruzione non è possibile.
  if (missing.length > 0) throw failure(problems);

  const built = recipes.map(({ recipe }) => buildRecipe(recipe, facts));
  problems.push(...consistencyProblems(built));
  if (problems.length > 0) throw failure(problems);

  await writeJsonFile(packFile, { recipes: built });

  const used = new Set(names);
  await writeIngredientsFile(
    ingredientsFile,
    entries.filter((entry) => used.has(normalizeCanonicalName(entry.name)))
  );

  const stats = computePackStats(recipes, built);
  await writeReport(workDir, { state, stats, generatedAt: now(), quotas });
  return { recipes: built.length, stats };
}
