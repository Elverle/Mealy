// Controlli sulle conversioni del pacchetto (Feature 10): errori che scartano, avvisi che restano.
// Funzioni pure: nessuna dipendenza da DB o LLM.

import {
  MAIN_COURSE_VALUES,
  PACK_GROUP_LABELS,
  SavedRecipeInputSchema,
  type GeneratedRecipe,
  type PackCandidate,
} from '@/lib/domain/types';
import { normalizeGeneratedRecipe } from '@/lib/domain/recipe-text';
import { resolveIngredientName, type AliasMap } from '@/lib/domain/shopping-list';
import { datasetWords, parseDatasetQuantity } from './dataset';
import { isSpoonLikely } from './select';

export const COPIED_RUN_WORDS = 8;
const MAX_SCHEMA_ERRORS = 5;
const QUANTITY_TOLERANCE = 0.1;
const LONG_PREP_MINUTES = 120;
const UNKNOWN_LABEL = 'nessuna';
const ROOT_PATH = '(radice)';
const CONTORNI_COURSE = 'contorno';

/**
 * Prima sequenza di `runLength` parole di `text` che compare anche in `original` (confronto senza
 * accenti né punteggiatura); null se non ce n'è nessuna.
 */
export function findSharedWordRun(
  text: string,
  original: string,
  runLength = COPIED_RUN_WORDS
): string | null {
  const words = datasetWords(text);
  const originalWords = datasetWords(original);
  if (words.length < runLength || originalWords.length < runLength) return null;

  const originalRuns = new Set<string>();
  for (let i = 0; i + runLength <= originalWords.length; i++) {
    originalRuns.add(originalWords.slice(i, i + runLength).join(' '));
  }

  for (let i = 0; i + runLength <= words.length; i++) {
    const run = words.slice(i, i + runLength).join(' ');
    if (originalRuns.has(run)) return run;
  }
  return null;
}

/** Ricetta normalizzata, con persone del dataset e ingredienti risolti tramite gli alias. */
export function postProcessConversion(
  recipe: GeneratedRecipe,
  candidate: PackCandidate,
  aliases: AliasMap
): GeneratedRecipe {
  const normalized = normalizeGeneratedRecipe(recipe);
  return {
    ...normalized,
    servings_base: candidate.servings,
    ingredients: normalized.ingredients.map((ingredient) => ({
      ...ingredient,
      canonical_name: resolveIngredientName(ingredient.canonical_name, aliases),
    })),
  };
}

function schemaErrors(recipe: GeneratedRecipe): string[] {
  const parsed = SavedRecipeInputSchema.safeParse(recipe);
  if (parsed.success) return [];
  return parsed.error.issues
    .slice(0, MAX_SCHEMA_ERRORS)
    .map((issue) => `schema: ${issue.path.join('.') || ROOT_PATH}: ${issue.message}`);
}

function courseErrors(recipe: GeneratedRecipe, candidate: PackCandidate): string[] {
  const fits =
    candidate.group === 'contorni'
      ? recipe.courses.includes(CONTORNI_COURSE)
      : recipe.courses.some((course) => MAIN_COURSE_VALUES.includes(course));
  if (fits) return [];
  const courses = recipe.courses.join(', ') || UNKNOWN_LABEL;
  return [`portata non adatta al gruppo ${PACK_GROUP_LABELS[candidate.group]}: ${courses}`];
}

function copiedTextErrors(recipe: GeneratedRecipe, candidate: PackCandidate): string[] {
  return [recipe.description, ...recipe.steps].flatMap((text) => {
    const run = findSharedWordRun(text, candidate.procedure);
    return run === null ? [] : [`testo copiato dall'originale: "${run}"`];
  });
}

/** Errori che scartano la conversione: schema (E1), portata (E2), testo copiato (E3). */
export function checkConversionErrors(recipe: GeneratedRecipe, candidate: PackCandidate): string[] {
  return [
    ...schemaErrors(recipe),
    ...courseErrors(recipe, candidate),
    ...copiedTextErrors(recipe, candidate),
  ];
}

/** Avviso su una riga di ingrediente: W3 (cucchiai senza unità) o W1 (quantità diversa). */
function ingredientWarning(
  [name, raw]: [string, string],
  ingredient: GeneratedRecipe['ingredients'][number]
): string | null {
  const reading = parseDatasetQuantity(raw);
  if (reading.kind !== 'measure') return null;

  const got = ingredient.unit === 'qb' ? 'q.b.' : `${ingredient.qty} ${ingredient.unit}`;
  if (reading.unitless && isSpoonLikely(name)) {
    return `numero senza unità su "${name}": "${raw}" → ${got}`;
  }

  const differs =
    ingredient.unit !== reading.unit ||
    ingredient.qty === null ||
    Math.abs(ingredient.qty - reading.qty) / reading.qty > QUANTITY_TOLERANCE;
  return differs ? `quantità di "${name}": "${raw}" → ${got}` : null;
}

/** Avvisi che non bloccano la conversione: W1–W4. */
export function checkConversionWarnings(recipe: GeneratedRecipe, candidate: PackCandidate): string[] {
  const warnings: string[] = [];

  if (candidate.ingredients.length !== recipe.ingredients.length) {
    warnings.push(`ingredienti: ${candidate.ingredients.length} → ${recipe.ingredients.length}`);
  } else {
    candidate.ingredients.forEach((pair, i) => {
      const warning = ingredientWarning(pair, recipe.ingredients[i]);
      if (warning !== null) warnings.push(warning);
    });
  }

  if (recipe.prep_minutes > LONG_PREP_MINUTES) {
    warnings.push(`tempo lungo: ${recipe.prep_minutes} minuti`);
  }
  return warnings;
}
