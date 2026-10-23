// Solo lato server: caricamento del pacchetto iniziale di ricette (Feature 10), all'avvio in produzione o con `pnpm recipes:pack load`.

import { RECIPE_PACK_CREATED_AT, RECIPE_PACK_RECIPES } from '@/fixtures/recipe-pack';
import { db } from '@/lib/db';
import { ensureDefaultHousehold } from '@/lib/db/repositories/household-repo';
import {
  acquireRecipeGenerationLock,
  findSimilarRecipeTitle,
  listRecipeTitles,
} from '@/lib/db/repositories/recipe-repo';
import { normalizeTitle } from '@/lib/domain/recipe-text';
import type { GeneratedRecipe } from '@/lib/domain/types';
import { insertGeneratedRecipe } from '@/lib/recipes/store';

export interface RecipePackLoadReport {
  /** Ricette del pacchetto inserite da questa esecuzione. */
  inserted: number;
  /** Ricette saltate: titolo già in libreria, uguale o simile. */
  skipped: number;
}

export interface LoadRecipePackDeps {
  /** Default: household singleton (creato se manca). */
  householdId?: string;
  /** Default: RECIPE_PACK_RECIPES. */
  recipes?: readonly GeneratedRecipe[];
  /** Default: insertGeneratedRecipe (iniettabile per i test). */
  insert?: typeof insertGeneratedRecipe;
  /** Default: console. */
  logger?: Pick<Console, 'log'>;
}

/**
 * Inserisce in libreria le ricette del pacchetto il cui titolo non è già presente, né uguale né
 * simile. Tutto in una transazione con il lock di generazione: un errore annulla il caricamento
 * e si propaga al chiamante. Le ricette entrano con origine 'manual' e data fissa.
 */
export async function loadRecipePack(deps: LoadRecipePackDeps = {}): Promise<RecipePackLoadReport> {
  const recipes = deps.recipes ?? RECIPE_PACK_RECIPES;
  const logger = deps.logger ?? console;
  const insert = deps.insert ?? insertGeneratedRecipe;

  if (recipes.length === 0) {
    logger.log('[pack] ricette del pacchetto inserite: 0, già presenti o simili: 0');
    return { inserted: 0, skipped: 0 };
  }

  const householdId = deps.householdId ?? (await ensureDefaultHousehold()).id;
  let inserted = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    await acquireRecipeGenerationLock(tx);
    const known = new Set((await listRecipeTitles(tx, householdId)).map(normalizeTitle));

    for (const recipe of recipes) {
      const norm = normalizeTitle(recipe.title);
      if (known.has(norm)) {
        skipped += 1;
        continue;
      }
      if ((await findSimilarRecipeTitle(tx, householdId, recipe.title)) !== null) {
        skipped += 1;
        continue;
      }

      await insert(tx, householdId, recipe, { source: 'manual', createdAt: RECIPE_PACK_CREATED_AT });
      inserted += 1;
      known.add(norm);
    }
  });

  logger.log(`[pack] ricette del pacchetto inserite: ${inserted}, già presenti o simili: ${skipped}`);
  return { inserted, skipped };
}
