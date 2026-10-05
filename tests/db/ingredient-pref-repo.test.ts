// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { db } from '@/lib/db';
import {
  deleteIngredientPref,
  listIngredientPrefRows,
  upsertIngredientPref,
} from '@/lib/db/repositories/ingredient-pref-repo';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('ingredient-pref-repo', () => {
  let householdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of householdIds) await deleteTestHousehold(id);
    householdIds = [];
  });

  async function newHousehold(): Promise<string> {
    const id = await createTestHousehold();
    householdIds.push(id);
    return id;
  }

  it('returns an empty list when the household has no judgments', async () => {
    const id = await newHousehold();
    expect(await listIngredientPrefRows(db, id)).toEqual([]);
  });

  it('lists judgments in ascending canonical_name order', async () => {
    const id = await newHousehold();
    await upsertIngredientPref(db, id, 'zucchine', 'like');
    await upsertIngredientPref(db, id, 'aglio', 'dislike');
    await upsertIngredientPref(db, id, 'mele', 'like');

    const rows = await listIngredientPrefRows(db, id);
    expect(rows.map((r) => r.canonical_name)).toEqual(['aglio', 'mele', 'zucchine']);
    expect(rows.map((r) => r.pref)).toEqual(['dislike', 'like', 'like']);
    expect(rows[0].created_at).toBeInstanceOf(Date);
  });

  it('overwrites an existing judgment leaving a single row', async () => {
    const id = await newHousehold();
    await upsertIngredientPref(db, id, 'cipolla', 'like');
    await upsertIngredientPref(db, id, 'cipolla', 'dislike');

    const rows = await listIngredientPrefRows(db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ canonical_name: 'cipolla', pref: 'dislike' });
  });

  it('keeps the original created_at when a judgment is overwritten', async () => {
    const id = await newHousehold();
    await upsertIngredientPref(db, id, 'cipolla', 'like');
    const [first] = await listIngredientPrefRows(db, id);
    await upsertIngredientPref(db, id, 'cipolla', 'dislike');
    const [second] = await listIngredientPrefRows(db, id);
    expect(second.created_at.getTime()).toBe(first.created_at.getTime());
  });

  it('deleteIngredientPref returns true when a row is removed, then false', async () => {
    const id = await newHousehold();
    await upsertIngredientPref(db, id, 'cipolla', 'dislike');

    expect(await deleteIngredientPref(db, id, 'cipolla')).toBe(true);
    expect(await deleteIngredientPref(db, id, 'cipolla')).toBe(false);
    expect(await listIngredientPrefRows(db, id)).toEqual([]);
  });

  it('isolates judgments between households sharing the same canonical name', async () => {
    const a = await newHousehold();
    const b = await newHousehold();
    await upsertIngredientPref(db, a, 'cipolla', 'dislike');
    await upsertIngredientPref(db, b, 'cipolla', 'like');

    expect((await listIngredientPrefRows(db, a))[0].pref).toBe('dislike');
    expect((await listIngredientPrefRows(db, b))[0].pref).toBe('like');

    expect(await deleteIngredientPref(db, a, 'cipolla')).toBe(true);
    expect(await listIngredientPrefRows(db, b)).toHaveLength(1);
  });

  it('removes the rows when the household is deleted', async () => {
    const id = await createTestHousehold();
    await upsertIngredientPref(db, id, 'cipolla', 'dislike');
    await deleteTestHousehold(id);

    expect(await listIngredientPrefRows(db, id)).toEqual([]);
  });
});
