// Solo lato server: classificazione delle ricette salvate prima della Feature 8 (portate ed etichette).

import { db } from '@/lib/db';
import { loadHousehold } from '@/lib/db/repositories/household-repo';
import {
  listUnclassifiedRecipes,
  setRecipeClassification,
  type UnclassifiedRecipe,
} from '@/lib/db/repositories/recipe-repo';
import { deriveStyleTags, normalizeCourses } from '@/lib/domain/courses';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import {
  CLASSIFY_BATCH_SIZE,
  type ClassifyRecipeItem,
  type RecipeClassification,
} from '@/lib/domain/types';
import {
  classifyRecipes,
  getModel,
  isLlmError,
  type GenerateRecipesOptions,
} from '@/lib/llm';

export interface ClassifyReport {
  /** Ricette non classificate trovate all'inizio. */
  pending: number;
  /** Ricette scritte da questa esecuzione. */
  classified: number;
  /** pending - classified. */
  remaining: number;
  /** Lotti falliti (timeout, rete, risposta non valida). */
  failedBatches: number;
  /** true se la classificazione non è partita perché il modello non è configurato. */
  notConfigured: boolean;
}

export interface ClassifyDeps {
  /** Default: singleton. */
  householdId?: string;
  model?: GenerateRecipesOptions['model'];
  /** Default: `classifyRecipes`. */
  classify?: typeof classifyRecipes;
  /** Default: CLASSIFY_BATCH_SIZE. */
  batchSize?: number;
  /** Default: console. */
  logger?: Pick<Console, 'log' | 'warn'>;
}

/** Testo del motivo di un lotto fallito nel log. */
function describeFailure(err: unknown): string {
  if (isLlmError(err)) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Voce per il modello: `ref` è il riferimento (`r1`…`r10`) con cui il modello risponde. */
function toClassifyItem(recipe: UnclassifiedRecipe, ref: string): ClassifyRecipeItem {
  const names = new Set(recipe.ingredients.map((ing) => normalizeCanonicalName(ing.canonical_name)));
  return {
    ref,
    title: recipe.title,
    description: recipe.description,
    meal_types: recipe.meal_types,
    tags: recipe.tags,
    ingredient_names: [...names],
  };
}

/**
 * Classifica le ricette dell'household con `courses` vuoto, a lotti sequenziali. Ogni riga del
 * modello che riguarda una ricetta del lotto, con portate non vuote, diventa portate ed etichette
 * (regole derivate incluse). Un lotto fallito si salta e le sue ricette restano non classificate:
 * si riprovano alla prossima esecuzione.
 */
export async function classifyPendingRecipes(deps: ClassifyDeps = {}): Promise<ClassifyReport> {
  const logger = deps.logger ?? console;
  const classify = deps.classify ?? classifyRecipes;
  const batchSize = deps.batchSize ?? CLASSIFY_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > CLASSIFY_BATCH_SIZE) {
    throw new RangeError(`batchSize must be an integer between 1 and ${CLASSIFY_BATCH_SIZE}`);
  }

  const household = await loadHousehold(deps.householdId);
  const pending = await listUnclassifiedRecipes(db, household.id);
  const total = pending.length;

  if (total === 0) {
    logger.log('[classify] nessuna ricetta da classificare');
    return { pending: 0, classified: 0, remaining: 0, failedBatches: 0, notConfigured: false };
  }
  logger.log(`[classify] ricette da classificare: ${total}`);

  let model: NonNullable<GenerateRecipesOptions['model']>;
  try {
    model = deps.model ?? getModel();
  } catch (err) {
    if (isLlmError(err) && err.code === 'config') {
      logger.warn(
        `[classify] modello non configurato (${err.message}): ${total} ricette restano senza portata`
      );
      return { pending: total, classified: 0, remaining: total, failedBatches: 0, notConfigured: true };
    }
    throw err;
  }

  const batchCount = Math.ceil(total / batchSize);
  let classified = 0;
  let failedBatches = 0;

  for (let start = 0; start < total; start += batchSize) {
    const position = start / batchSize + 1;
    const batch = pending.slice(start, start + batchSize);
    const byRef = new Map<string, UnclassifiedRecipe>(
      batch.map((recipe, index): [string, UnclassifiedRecipe] => [`r${index + 1}`, recipe])
    );
    const items = [...byRef].map(([ref, recipe]) => toClassifyItem(recipe, ref));

    let rows: RecipeClassification[];
    try {
      rows = await classify(items, { model });
    } catch (err) {
      failedBatches += 1;
      logger.warn(`[classify] lotto ${position}/${batchCount} non classificato: ${describeFailure(err)}`);
      continue;
    }

    const seen = new Set<string>();
    for (const row of rows) {
      const recipe = byRef.get(row.ref);
      if (!recipe || seen.has(row.ref)) continue;
      seen.add(row.ref);

      const courses = normalizeCourses(row.courses);
      if (courses.length === 0) continue;

      const tags = deriveStyleTags([...recipe.tags, ...row.style_tags], recipe.ingredients);
      if (await setRecipeClassification(db, recipe.id, courses, tags)) classified += 1;
    }
  }

  logger.log(`[classify] classificate: ${classified}, rimaste: ${total - classified}`);
  return {
    pending: total,
    classified,
    remaining: total - classified,
    failedBatches,
    notConfigured: false,
  };
}
