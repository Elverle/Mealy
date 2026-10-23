// @vitest-environment node

import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, recipes, recipe_prefs } from '@/lib/db';
import {
  findSimilarRecipeTitle,
  insertRecipe,
  listRecipeTitles,
} from '@/lib/db/repositories/recipe-repo';
import { RECIPE_PACK_CREATED_AT, RECIPE_PACK_RECIPES } from '@/fixtures/recipe-pack';
import { loadRecipePack } from '@/lib/recipes/pack/load';
import { insertGeneratedRecipe } from '@/lib/recipes/store';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';

const dbUp = await isDbAvailable();

const FARRO = 'Pacchetto uno: zuppa di farro';
const FRITTATA = 'Pacchetto due: frittata di zucchine';
const INSALATA = 'Pacchetto tre: insalata di ceci';

function makePack() {
  return [
    makeGeneratedRecipe({ title: FARRO }),
    makeGeneratedRecipe({ title: FRITTATA }),
    makeGeneratedRecipe({ title: INSALATA }),
  ];
}

describe.skipIf(!dbUp)('loadRecipePack', () => {
  let householdIds: string[] = [];

  afterEach(async () => {
    for (const id of householdIds) await deleteTestHousehold(id);
    householdIds = [];
  });

  async function newHousehold(): Promise<string> {
    await assertDbMigrated();
    const id = await createTestHousehold();
    householdIds.push(id);
    return id;
  }

  function makeLogger() {
    return { log: vi.fn() };
  }

  it('inserts every recipe into an empty library, with source manual, the fixed date and its preferences', async () => {
    const h = await newHousehold();
    const logger = makeLogger();

    const report = await loadRecipePack({ householdId: h, recipes: makePack(), logger });

    expect(report).toEqual({ inserted: 3, skipped: 0 });
    expect(logger.log).toHaveBeenCalledWith(
      '[pack] ricette del pacchetto inserite: 3, già presenti o simili: 0'
    );
    const rows = await db
      .select({
        id: recipes.id,
        source: recipes.source,
        courses: recipes.courses,
        tags: recipes.tags,
        created_at: recipes.created_at,
      })
      .from(recipes)
      .where(eq(recipes.household_id, h));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.source).toBe('manual');
      expect(row.courses).toEqual(['secondo']);
      expect(row.tags).toContain('pochi-ingredienti');
      expect(row.created_at).toEqual(RECIPE_PACK_CREATED_AT);
    }
    const prefs = await db
      .select({ recipe_id: recipe_prefs.recipe_id })
      .from(recipe_prefs)
      .where(inArray(recipe_prefs.recipe_id, rows.map((row) => row.id)));
    expect(prefs).toHaveLength(3);
  });

  it('skips every recipe on a second load', async () => {
    const h = await newHousehold();
    const pack = makePack();
    await loadRecipePack({ householdId: h, recipes: pack, logger: makeLogger() });
    const logger = makeLogger();

    const report = await loadRecipePack({ householdId: h, recipes: pack, logger });

    expect(report).toEqual({ inserted: 0, skipped: 3 });
    expect(logger.log).toHaveBeenCalledWith(
      '[pack] ricette del pacchetto inserite: 0, già presenti o simili: 3'
    );
    expect(await listRecipeTitles(db, h)).toHaveLength(3);
  });

  it('skips a title already in the library that differs only in case and punctuation', async () => {
    const h = await newHousehold();
    await insertRecipe({
      household_id: h,
      title: 'PACCHETTO UNO — zuppa di farro',
      slug: `pacchetto-uno-maiuscole-${crypto.randomUUID()}`,
      steps: ['Passo unico.'],
      meal_types: ['pranzo'],
      servings_base: 2,
      prep_minutes: 20,
    });

    const report = await loadRecipePack({
      householdId: h,
      recipes: makePack(),
      logger: makeLogger(),
    });

    expect(report).toEqual({ inserted: 2, skipped: 1 });
    expect(await listRecipeTitles(db, h)).toHaveLength(3);
  });

  it('skips a pack title similar to one already in the library', async () => {
    const h = await newHousehold();
    const existing = 'Pacchetto uno: zuppa di farro e legumi';
    await insertRecipe({
      household_id: h,
      title: existing,
      slug: `pacchetto-uno-legumi-${crypto.randomUUID()}`,
      steps: ['Passo unico.'],
      meal_types: ['pranzo'],
      servings_base: 2,
      prep_minutes: 20,
    });
    // Precondizione: la coppia è davvero sopra la soglia di somiglianza.
    expect(await findSimilarRecipeTitle(db, h, FARRO)).toBe(existing);

    const report = await loadRecipePack({
      householdId: h,
      recipes: makePack(),
      logger: makeLogger(),
    });

    expect(report).toEqual({ inserted: 2, skipped: 1 });
    expect(await listRecipeTitles(db, h)).not.toContain(FARRO);
  });

  it('rolls back the whole load when an insert fails: nothing is written and nothing is logged', async () => {
    const h = await newHousehold();
    const logger = makeLogger();
    const insert = vi
      .fn<typeof insertGeneratedRecipe>()
      .mockImplementationOnce((...args) => insertGeneratedRecipe(...args))
      .mockRejectedValueOnce(new Error('inserimento fallito'));

    await expect(
      loadRecipePack({ householdId: h, recipes: makePack(), insert, logger })
    ).rejects.toThrow('inserimento fallito');

    expect(insert).toHaveBeenCalledTimes(2);
    expect(await listRecipeTitles(db, h)).toEqual([]);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('does nothing and logs zeros when the pack is empty', async () => {
    const logger = makeLogger();

    const report = await loadRecipePack({ recipes: [], logger });

    expect(report).toEqual({ inserted: 0, skipped: 0 });
    expect(logger.log).toHaveBeenCalledWith(
      '[pack] ricette del pacchetto inserite: 0, già presenti o simili: 0'
    );
  });

  it('loads the whole real pack into an empty library', async () => {
    const h = await newHousehold();

    await loadRecipePack({ householdId: h, logger: makeLogger() });

    // Guardia: un titolo del pacchetto saltato perché simile a un altro (pg_trgm, qui sul DB,
    // non il confronto offline) compare nell'elenco degli scartati.
    const inserted = new Set(await listRecipeTitles(db, h));
    expect(RECIPE_PACK_RECIPES.map((r) => r.title).filter((t) => !inserted.has(t))).toEqual([]);
  });
});
