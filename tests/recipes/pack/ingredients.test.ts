// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  PACK_GROUP_QUOTAS,
  type GeneratedRecipe,
  type PackCandidate,
  type PackGroup,
  type PackIngredientFact,
} from '@/lib/domain/types';
import { LlmError } from '@/lib/llm';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';
import { createRecordedModel } from '@/tests/helpers/mock-llm';
import { PackError } from '@/lib/recipes/pack/errors';
import { workPaths } from '@/lib/recipes/pack/paths';
import { renderSelection } from '@/lib/recipes/pack/select';
import { writeRecord } from '@/lib/recipes/pack/state';
import { writeJsonFile } from '@/lib/recipes/pack/files';
import {
  formatIngredientsFile,
  readIngredientsFile,
  runIngredients,
  writeIngredientsFile,
  type IngredientsOptions,
} from '@/lib/recipes/pack/ingredients';
import { draftIngredientFacts } from '@/lib/llm';

const CONVERTED_AT = '2026-10-23T10:00:00.000Z';
const MODEL_NAME = 'modello-di-prova';
const QUOTAS: Record<PackGroup, number> = { primi: 1, secondi: 1, 'piatti-unici': 0, contorni: 0 };
const DRAFT_BATCH_SIZE = 40;
const REVIEW_TITLE = '# Ingredienti da rivedere';
const TABLE_HEADER = '| Nome | Reparto | Carne | Pesce | Latticini | Uova | Miele | Glutine | Ricette |';
const NO_REVIEW = 'Nessuna voce da rivedere.';

let dir: string;
let workDir: string;
let ingredientsFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-pack-'));
  workDir = path.join(dir, '.recipe-pack');
  ingredientsFile = path.join(dir, 'fixtures', 'recipe-pack-ingredients.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fact(name: string, overrides: Partial<PackIngredientFact> = {}): PackIngredientFact {
  return {
    name,
    category: 'dispensa',
    carne: false,
    pesce: false,
    latticini: false,
    uova: false,
    miele: false,
    glutine: false,
    reviewed: true,
    ...overrides,
  };
}

function draftOf(name: string, overrides: Partial<PackIngredientFact> = {}): Omit<PackIngredientFact, 'reviewed'> {
  const { reviewed: _reviewed, ...draft } = { ...fact(name, overrides) };
  return draft;
}

function makeCandidate(code: string, group: PackGroup, title: string): PackCandidate {
  return {
    code,
    group,
    main_ingredient: 'verdure',
    dataset_index: code.slice(1),
    link: `https://example.test/${code}`,
    title,
    category: 'Primi piatti',
    servings: 4,
    ingredients: [['Farina', '200g']],
    procedure: 'Impasta la farina con acqua e lascia riposare la pasta per mezz ora in frigo.',
    measured_count: 1,
    score: 2,
    checked: true,
  };
}

interface AcceptedFixture {
  code: string;
  group: PackGroup;
  recipe: GeneratedRecipe;
}

/** Stato di lavoro scritto dal test: candidati, selection.md spuntato e record accettati. */
async function prepareState(accepted: readonly AcceptedFixture[]): Promise<void> {
  const candidates = accepted.map(({ code, group, recipe }) => makeCandidate(code, group, recipe.title));
  const paths = workPaths(workDir);
  await writeJsonFile(paths.candidates, { candidates });
  fs.writeFileSync(paths.selection, renderSelection(candidates), 'utf8');
  for (const { code, recipe } of accepted) {
    await writeRecord(workDir, {
      code,
      status: 'accepted',
      recipe,
      errors: [],
      warnings: [],
      model: MODEL_NAME,
      converted_at: CONVERTED_AT,
    });
  }
}

function standardState(): AcceptedFixture[] {
  return [
    { code: 'P001', group: 'primi', recipe: makeGeneratedRecipe({ title: 'Ricetta uno' }) },
    { code: 'S001', group: 'secondi', recipe: makeGeneratedRecipe({ title: 'Ricetta due', courses: ['secondo'] }) },
  ];
}

function baseOptions(overrides: Partial<IngredientsOptions> = {}): IngredientsOptions {
  return {
    workDir,
    ingredientsFile,
    approve: false,
    quotas: QUOTAS,
    // Modello finto: runIngredients lo passa solo alla bozza, che qui è iniettata.
    model: createRecordedModel([]).model,
    logger: { warn: vi.fn() },
    draft: vi.fn<typeof draftIngredientFacts>(async (names) => names.map((name) => draftOf(name))),
    ...overrides,
  };
}

function readReview(): string {
  return fs.readFileSync(workPaths(workDir).ingredientsReview, 'utf8');
}

describe('formatIngredientsFile', () => {
  it('sorts the entries by name with Italian collation and keeps the keys in the fixed order', () => {
    const text = formatIngredientsFile([fact('zucchero', { reviewed: false }), fact('Uova'), fact('acqua')]);

    const lines = text.split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toBe('  "ingredients": [');
    expect(lines[2]).toBe(
      '    {"name":"acqua","category":"dispensa","carne":false,"pesce":false,"latticini":false,"uova":false,"miele":false,"glutine":false,"reviewed":true},'
    );
    expect(lines[3].startsWith('    {"name":"Uova",')).toBe(true);
    expect(lines[4].startsWith('    {"name":"zucchero",')).toBe(true);
    expect(lines[4].endsWith('"reviewed":false}')).toBe(true);
    expect(text.endsWith('\n  ]\n}\n')).toBe(true);
  });

  it('writes an empty table with a single empty array', () => {
    expect(formatIngredientsFile([])).toBe('{\n  "ingredients": []\n}\n');
  });

  it('round-trips through readIngredientsFile', async () => {
    const entries = [fact('farina', { glutine: true, category: 'dispensa' }), fact('latte', { latticini: true, reviewed: false })];
    await writeIngredientsFile(ingredientsFile, entries);

    const read = await readIngredientsFile(ingredientsFile);
    expect(read).toEqual([...entries].sort((a, b) => a.name.localeCompare(b.name, 'it')));
  });
});

describe('readIngredientsFile', () => {
  it('returns an empty list when the file does not exist', async () => {
    await expect(readIngredientsFile(ingredientsFile)).resolves.toEqual([]);
  });

  it('throws a PackError starting with "File non valido: " for a file that does not match the schema', async () => {
    fs.mkdirSync(path.dirname(ingredientsFile), { recursive: true });
    fs.writeFileSync(ingredientsFile, '{"ingredients":[{"name":"farina"}]}', 'utf8');

    const error = await readIngredientsFile(ingredientsFile).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PackError);
    expect((error as PackError).message.startsWith(`File non valido: ${ingredientsFile}: `)).toBe(true);
  });

  it('throws a PackError for a file that is not JSON', async () => {
    fs.mkdirSync(path.dirname(ingredientsFile), { recursive: true });
    fs.writeFileSync(ingredientsFile, '{ non è json', 'utf8');

    await expect(readIngredientsFile(ingredientsFile)).rejects.toThrow(PackError);
  });
});

describe('runIngredients', () => {
  it('adds the missing names as unreviewed entries and keeps the drafted fields', async () => {
    await prepareState(standardState());
    const draft = vi.fn<typeof draftIngredientFacts>(async (names) =>
      names.map((name) => draftOf(name, { glutine: name === 'farina', category: 'dispensa' }))
    );

    const report = await runIngredients(baseOptions({ draft }));

    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft.mock.calls[0][0]).toEqual(['farina', 'sale fino', 'zucchero']);
    const table = await readIngredientsFile(ingredientsFile);
    expect(table.map((entry) => entry.name)).toEqual(['farina', 'sale fino', 'zucchero']);
    expect(table.every((entry) => entry.reviewed === false)).toBe(true);
    expect(table.find((entry) => entry.name === 'farina')?.glutine).toBe(true);
    expect(report).toEqual({ used: 3, added: 3, unreviewed: 3, missing: [], approved: 0 });
  });

  it('leaves the existing entries untouched and asks the model only for the missing names', async () => {
    await prepareState(standardState());
    const reviewedFarina = fact('farina', { glutine: true, category: 'dispensa', reviewed: true });
    await writeIngredientsFile(ingredientsFile, [reviewedFarina]);
    const draft = vi.fn<typeof draftIngredientFacts>(async (names) => names.map((name) => draftOf(name)));

    const report = await runIngredients(baseOptions({ draft }));

    expect(draft.mock.calls[0][0]).toEqual(['sale fino', 'zucchero']);
    const table = await readIngredientsFile(ingredientsFile);
    expect(table.find((entry) => entry.name === 'farina')).toEqual(reviewedFarina);
    expect(report.added).toBe(2);
    expect(report.unreviewed).toBe(2);
  });

  it('splits the drafts in batches of 40 names', async () => {
    const names = Array.from({ length: DRAFT_BATCH_SIZE + 1 }, (_, i) => `ingrediente ${i}`);
    const recipe = makeGeneratedRecipe({
      title: 'Ricetta lunga',
      ingredients: names.map((name) => ({
        canonical_name: name,
        display_name: name,
        qty: 10,
        unit: 'g',
        category: 'dispensa',
        note: null,
      })),
    });
    await prepareState([{ code: 'P001', group: 'primi', recipe }]);
    const draft = vi.fn<typeof draftIngredientFacts>(async (batch) => batch.map((name) => draftOf(name)));

    const report = await runIngredients(baseOptions({ draft }));

    expect(draft).toHaveBeenCalledTimes(2);
    expect(draft.mock.calls[0][0]).toHaveLength(DRAFT_BATCH_SIZE);
    expect(draft.mock.calls[1][0]).toHaveLength(1);
    expect(report.added).toBe(DRAFT_BATCH_SIZE + 1);
    expect(report.missing).toEqual([]);
  });

  it('reports as missing a name that the model did not return', async () => {
    await prepareState(standardState());
    const draft = vi.fn<typeof draftIngredientFacts>(async (names) =>
      names.filter((name) => name !== 'zucchero').map((name) => draftOf(name))
    );

    const report = await runIngredients(baseOptions({ draft }));

    expect(report.missing).toEqual(['zucchero']);
    expect(report.added).toBe(2);
    const table = await readIngredientsFile(ingredientsFile);
    expect(table.map((entry) => entry.name)).not.toContain('zucchero');
  });

  it('warns and goes on when a batch fails with an LlmError, leaving its names missing', async () => {
    await prepareState(standardState());
    const logger = { warn: vi.fn() };
    const draft = vi.fn<typeof draftIngredientFacts>(async () => {
      throw new LlmError('provider', 'servizio non raggiungibile');
    });

    const report = await runIngredients(baseOptions({ draft, logger }));

    expect(logger.warn).toHaveBeenCalledWith(
      '[pack] bozza non riuscita per 3 ingredienti: provider: servizio non raggiungibile'
    );
    expect(report.missing).toEqual(['farina', 'sale fino', 'zucchero']);
    expect(report.added).toBe(0);
    await expect(readIngredientsFile(ingredientsFile)).resolves.toEqual([]);
  });

  it('writes the review with the table of the unreviewed entries and the recipes that use them', async () => {
    await prepareState(standardState());
    const draft = vi.fn<typeof draftIngredientFacts>(async (names) =>
      names.map((name) => draftOf(name, { glutine: name === 'farina' }))
    );

    await runIngredients(baseOptions({ draft }));

    const review = readReview();
    expect(review).toContain(REVIEW_TITLE);
    expect(review).toContain(`Correggi le voci in ${ingredientsFile} (reparto e attributi)`);
    expect(review).toContain('pnpm recipes:pack ingredients --approve');
    expect(review).toContain(TABLE_HEADER);
    expect(review).toContain('| farina | dispensa | no | no | no | no | no | sì | 2: Ricetta uno, Ricetta due |');
    expect(review).toContain('| zucchero | dispensa | no | no | no | no | no | no | 2: Ricetta uno, Ricetta due |');
    expect(review).not.toContain(NO_REVIEW);
  });

  it('shows at most three titles in the review and adds ", …" when there are more', async () => {
    const accepted: AcceptedFixture[] = ['Ricetta uno', 'Ricetta due', 'Ricetta tre', 'Ricetta quattro'].map(
      (title, i) => ({ code: `P00${i + 1}`, group: 'primi', recipe: makeGeneratedRecipe({ title }) })
    );
    await prepareState(accepted);

    await runIngredients(baseOptions({ quotas: { primi: 4, secondi: 0, 'piatti-unici': 0, contorni: 0 } }));

    expect(readReview()).toContain('| farina | dispensa | no | no | no | no | no | no | 4: Ricetta uno, Ricetta due, Ricetta tre, … |');
  });

  it('writes "Nessuna voce da rivedere." instead of the table when every used entry is reviewed', async () => {
    await prepareState(standardState());
    await writeIngredientsFile(ingredientsFile, [
      fact('farina', { glutine: true }),
      fact('sale fino'),
      fact('zucchero'),
    ]);
    const draft = vi.fn<typeof draftIngredientFacts>(async (names) => names.map((name) => draftOf(name)));

    const report = await runIngredients(baseOptions({ draft }));

    expect(draft).not.toHaveBeenCalled();
    expect(report).toEqual({ used: 3, added: 0, unreviewed: 0, missing: [], approved: 0 });
    const review = readReview();
    expect(review).toContain(NO_REVIEW);
    expect(review).not.toContain(TABLE_HEADER);
  });
});

describe('runIngredients with approve', () => {
  it('marks every entry as reviewed without calling the model or the draft', async () => {
    await writeIngredientsFile(ingredientsFile, [
      fact('farina', { reviewed: false }),
      fact('zucchero', { reviewed: false }),
      fact('sale', { reviewed: true }),
    ]);
    const draft = vi.fn<typeof draftIngredientFacts>(async (names) => names.map((name) => draftOf(name)));

    const report = await runIngredients(baseOptions({ approve: true, draft, model: undefined }));

    expect(draft).not.toHaveBeenCalled();
    expect(report).toEqual({ used: 0, added: 0, unreviewed: 0, missing: [], approved: 3 });
    const table = await readIngredientsFile(ingredientsFile);
    expect(table.every((entry) => entry.reviewed)).toBe(true);
  });
});
