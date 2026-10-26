// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  type GeneratedRecipe,
  type PackCandidate,
  type PackGroup,
  type PackIngredientFact,
  type PackMainIngredient,
  type PackStats,
} from '@/lib/domain/types';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';
import { PackError } from '@/lib/recipes/pack/errors';
import { writeJsonFile } from '@/lib/recipes/pack/files';
import { workPaths } from '@/lib/recipes/pack/paths';
import { renderSelection } from '@/lib/recipes/pack/select';
import { writeRecord, type AcceptedRecipe } from '@/lib/recipes/pack/state';
import { readIngredientsFile, writeIngredientsFile } from '@/lib/recipes/pack/ingredients';
import { computePackStats, runBuild, type BuildOptions } from '@/lib/recipes/pack/build';

const CONVERTED_AT = '2026-10-23T10:00:00.000Z';
const GENERATED_AT = new Date('2026-10-23T10:00:00.000Z');
const MODEL_NAME = 'modello-di-prova';
const HEADER = 'Il pacchetto non si può costruire:';
const QUOTAS: Record<PackGroup, number> = { primi: 2, secondi: 1, 'piatti-unici': 1, contorni: 1 };
const PACK_ORDER = ['Risotto ai funghi', 'Spaghetti aglio e olio', 'Pollo al limone', 'Frittata di cipolle', 'Carote glassate'];

const INGREDIENTS: GeneratedRecipe['ingredients'] = [
  { canonical_name: 'farina', display_name: 'Farina', qty: 200, unit: 'g', category: 'dispensa', note: null },
  { canonical_name: 'zucchero', display_name: 'Zucchero', qty: 50, unit: 'g', category: 'dispensa', note: null },
  { canonical_name: 'sale', display_name: 'Sale', qty: 5, unit: 'g', category: 'dispensa', note: null },
];

let dir: string;
let workDir: string;
let packFile: string;
let ingredientsFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-pack-'));
  workDir = path.join(dir, '.recipe-pack');
  packFile = path.join(dir, 'fixtures', 'recipe-pack.json');
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

/** Tabella riveduta: farina con glutine e reparto diverso da quello della ricetta, più una voce inutilizzata. */
function reviewedTable(): PackIngredientFact[] {
  return [
    fact('farina', { category: 'pane', glutine: true }),
    fact('zucchero'),
    fact('sale'),
    fact('basilico'),
  ];
}

function recipeWith(title: string, courses: GeneratedRecipe['courses'], salt = 'sale', extra: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  const ingredients = INGREDIENTS.map((ing) => (ing.canonical_name === 'sale' ? { ...ing, canonical_name: salt, display_name: salt } : ing));
  return makeGeneratedRecipe({ title, courses, ingredients, ...extra });
}

interface Fixture {
  code: string;
  group: PackGroup;
  main: PackMainIngredient;
  recipe: GeneratedRecipe;
}

function makeCandidate(code: string, group: PackGroup, main: PackMainIngredient, title: string): PackCandidate {
  return {
    code,
    group,
    main_ingredient: main,
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

/** Stato di lavoro scritto dal test: candidati, selection.md spuntato, record accettati e tabella. */
async function prepareState(fixtures: readonly Fixture[], table: readonly PackIngredientFact[] = reviewedTable()): Promise<void> {
  const candidates = fixtures.map(({ code, group, main, recipe }) => makeCandidate(code, group, main, recipe.title));
  const paths = workPaths(workDir);
  await writeJsonFile(paths.candidates, { candidates });
  fs.writeFileSync(paths.selection, renderSelection(candidates), 'utf8');
  for (const { code, recipe } of fixtures) {
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
  await writeIngredientsFile(ingredientsFile, table);
}

/** Cinque ricette valide, una per ogni slot della quota (2 primi, 1 secondo, 1 piatto unico, 1 contorno). */
function standardFixtures(salt = 'sale'): Fixture[] {
  return [
    { code: 'P001', group: 'primi', main: 'verdure', recipe: recipeWith(PACK_ORDER[0], ['primo'], salt) },
    { code: 'P002', group: 'primi', main: 'legumi', recipe: recipeWith(PACK_ORDER[1], ['primo'], salt) },
    { code: 'S001', group: 'secondi', main: 'carne', recipe: recipeWith(PACK_ORDER[2], ['secondo'], salt) },
    { code: 'U001', group: 'piatti-unici', main: 'uova', recipe: recipeWith(PACK_ORDER[3], ['piatto-unico'], salt) },
    { code: 'C001', group: 'contorni', main: 'verdure', recipe: recipeWith(PACK_ORDER[4], ['contorno'], salt) },
  ];
}

function buildOptions(overrides: Partial<BuildOptions> = {}): BuildOptions {
  return { workDir, packFile, ingredientsFile, now: () => GENERATED_AT, quotas: QUOTAS, ...overrides };
}

/** Righe del messaggio di errore di build: intestazione, poi un problema per riga. */
async function buildProblemLines(overrides: Partial<BuildOptions> = {}): Promise<string[]> {
  const error = await runBuild(buildOptions(overrides)).catch((err: unknown) => err);
  expect(error).toBeInstanceOf(PackError);
  return (error as PackError).message.split('\n');
}

function readPackFile(): { recipes: GeneratedRecipe[] } {
  return JSON.parse(fs.readFileSync(packFile, 'utf8')) as { recipes: GeneratedRecipe[] };
}

describe('runBuild: pacchetto scritto', () => {
  it('writes five recipes in the order primi, secondi, piatti unici, contorni', async () => {
    await prepareState(standardFixtures());

    const report = await runBuild(buildOptions());

    expect(report.recipes).toBe(5);
    expect(readPackFile().recipes.map((recipe) => recipe.title)).toEqual(PACK_ORDER);
    expect(fs.readFileSync(packFile, 'utf8').endsWith('}\n')).toBe(true);
  });

  it('takes the category of each ingredient from the table', async () => {
    await prepareState(standardFixtures());

    await runBuild(buildOptions());

    const [risotto] = readPackFile().recipes;
    expect(risotto.ingredients.map((ing) => [ing.canonical_name, ing.category])).toEqual([
      ['farina', 'pane'],
      ['zucchero', 'dispensa'],
      ['sale', 'dispensa'],
    ]);
  });

  it('derives the diet flags by rule, without senza-glutine when an ingredient has gluten', async () => {
    await prepareState(standardFixtures());

    await runBuild(buildOptions());

    const [risotto] = readPackFile().recipes;
    expect(risotto.diet_flags).toEqual(['vegetariano', 'vegano', 'senza-lattosio', 'pescetariano']);
    expect(risotto.diet_flags).not.toContain('senza-glutine');
  });

  it('derives the style tags: pochi-ingredienti for few ingredients, piatto-unico from the course', async () => {
    await prepareState(standardFixtures());

    await runBuild(buildOptions());

    const recipes = readPackFile().recipes;
    expect(recipes[0].tags).toEqual(['pochi-ingredienti']);
    const frittata = recipes.find((recipe) => recipe.title === 'Frittata di cipolle');
    expect(frittata?.tags).toEqual(expect.arrayContaining(['pochi-ingredienti', 'piatto-unico']));
  });
});

describe('runBuild: tabella potata', () => {
  it('keeps only the entries of the ingredients used by the packed recipes', async () => {
    await prepareState(standardFixtures());

    await runBuild(buildOptions());

    const table = await readIngredientsFile(ingredientsFile);
    expect(table.map((entry) => entry.name)).toEqual(['farina', 'sale', 'zucchero']);
    expect(table.find((entry) => entry.name === 'farina')).toEqual(fact('farina', { category: 'pane', glutine: true }));
  });
});

describe('runBuild: report', () => {
  it('writes report.md with the statistics and returns them', async () => {
    await prepareState(standardFixtures());

    const report = await runBuild(buildOptions());

    expect(report.stats).toEqual<PackStats>({
      total: 5,
      by_course: { 'piatto-unico': 1, primo: 2, secondo: 1, contorno: 1 },
      by_meal_type: { pranzo: 5, cena: 5 },
      by_diet: { pescetariano: 5, vegetariano: 5, vegano: 5, 'senza-glutine': 0, 'senza-lattosio': 5 },
      by_main_ingredient: { carne: 1, pesce: 0, legumi: 1, uova: 1, formaggi: 0, verdure: 2 },
      prep_minutes: { up_to_30: 5, up_to_60: 0, up_to_120: 0, over_120: 0 },
    });
    const markdown = fs.readFileSync(workPaths(workDir).report, 'utf8');
    expect(markdown).toContain('## Statistiche');
    expect(markdown).toContain('Ricette: 5');
  });
});

describe('computePackStats', () => {
  function acceptedOf(recipe: GeneratedRecipe, main: PackMainIngredient = 'verdure'): AcceptedRecipe {
    return {
      code: 'P001',
      candidate: makeCandidate('P001', 'primi', main, recipe.title),
      recipe,
      warnings: [],
    };
  }

  it('returns every key at zero for an empty package', () => {
    expect(computePackStats([], [])).toEqual<PackStats>({
      total: 0,
      by_course: { 'piatto-unico': 0, primo: 0, secondo: 0, contorno: 0 },
      by_meal_type: { pranzo: 0, cena: 0 },
      by_diet: { pescetariano: 0, vegetariano: 0, vegano: 0, 'senza-glutine': 0, 'senza-lattosio': 0 },
      by_main_ingredient: { carne: 0, pesce: 0, legumi: 0, uova: 0, formaggi: 0, verdure: 0 },
      prep_minutes: { up_to_30: 0, up_to_60: 0, up_to_120: 0, over_120: 0 },
    });
  });

  it('puts the prep time in the bucket of its limits: <=30, 31-60, 61-120, >120', () => {
    const minutes = [30, 31, 60, 61, 120, 121];
    const recipes = minutes.map((prep) => recipeWith(`Ricetta ${prep}`, ['secondo'], 'sale', { prep_minutes: prep }));

    const stats = computePackStats(recipes.map((recipe) => acceptedOf(recipe)), recipes);

    expect(stats.prep_minutes).toEqual({ up_to_30: 1, up_to_60: 2, up_to_120: 2, over_120: 1 });
  });

  it('counts the main ingredient from the candidate, not from the recipe', () => {
    const recipe = recipeWith('Pollo al limone', ['secondo']);

    const stats = computePackStats([acceptedOf(recipe, 'pesce')], [recipe]);

    expect(stats.by_main_ingredient.pesce).toBe(1);
    expect(stats.by_main_ingredient.verdure).toBe(0);
    expect(stats.total).toBe(1);
    expect(stats.by_meal_type).toEqual({ pranzo: 1, cena: 1 });
  });
});

describe('runBuild: errori', () => {
  it('reports a group under its quota and writes nothing', async () => {
    const fixtures = standardFixtures().filter((fixture) => fixture.group !== 'contorni');
    await prepareState(fixtures);

    const lines = await buildProblemLines();

    expect(lines).toEqual([HEADER, 'Contorni: 0/1 ricette accettate.']);
    expect(fs.existsSync(packFile)).toBe(false);
  });

  it('reports a name without an entry in the table', async () => {
    await prepareState(standardFixtures(), reviewedTable().filter((entry) => entry.name !== 'zucchero'));

    const lines = await buildProblemLines();

    expect(lines).toEqual([HEADER, 'Ingredienti senza voce nella tabella: zucchero.']);
  });

  it('reports an entry used by the recipes that is not reviewed', async () => {
    await prepareState(
      standardFixtures(),
      reviewedTable().map((entry) => (entry.name === 'farina' ? { ...entry, reviewed: false } : entry))
    );

    const lines = await buildProblemLines();

    expect(lines).toEqual([HEADER, 'Ingredienti da rivedere: farina.']);
  });

  it('reports a name that is an alias, with its canonical name', async () => {
    await prepareState(
      standardFixtures('sale fino'),
      reviewedTable().filter((entry) => entry.name !== 'sale').concat(fact('sale fino'))
    );

    const lines = await buildProblemLines();

    expect(lines).toEqual([HEADER, 'Nomi che sono alias: sale fino (usa "sale").']);
  });

  it('reports a table name that is not normalized, and the duplicate it makes with its normalized twin', async () => {
    await prepareState(standardFixtures(), [
      ...reviewedTable().filter((entry) => entry.name !== 'sale'),
      fact('Sale'),
      fact('sale'),
    ]);

    const lines = await buildProblemLines();

    expect(lines).toEqual([HEADER, 'Nomi non normalizzati nella tabella: Sale.', 'Voci doppie nella tabella: sale.']);
    expect(fs.existsSync(packFile)).toBe(false);
  });

  it('reports the table names that are not normalized, sorted, without duplicates', async () => {
    await prepareState(
      standardFixtures(),
      reviewedTable().map((entry) =>
        entry.name === 'zucchero' || entry.name === 'farina' ? { ...entry, name: `${entry.name[0].toUpperCase()}${entry.name.slice(1)}` } : entry
      )
    );

    const lines = await buildProblemLines();

    expect(lines).toEqual([HEADER, 'Nomi non normalizzati nella tabella: Farina, Zucchero.']);
  });

  it('reports two recipes with similar titles', async () => {
    const fixtures = standardFixtures();
    fixtures[1] = { ...fixtures[1], recipe: recipeWith(PACK_ORDER[0], ['primo']) };
    await prepareState(fixtures);

    const lines = await buildProblemLines();

    expect(lines[0]).toBe(HEADER);
    expect(lines).toContain('Titoli simili: "Risotto ai funghi" e "Risotto ai funghi".');
  });

  it('reports a forbidden text, a web address copied from the source', async () => {
    const fixtures = standardFixtures();
    fixtures[4] = {
      ...fixtures[4],
      recipe: recipeWith(PACK_ORDER[4], ['contorno'], 'sale', { description: 'Vedi http://esempio.test per i dettagli.' }),
    };
    await prepareState(fixtures);

    const lines = await buildProblemLines();

    expect(lines).toEqual([HEADER, 'Testo vietato in "Carote glassate": http.']);
  });

  it('reports every problem together in a single error', async () => {
    const fixtures = standardFixtures().filter((fixture) => fixture.group !== 'contorni');
    await prepareState(fixtures, reviewedTable().filter((entry) => entry.name !== 'zucchero'));

    const lines = await buildProblemLines();

    expect(lines).toEqual([
      HEADER,
      'Contorni: 0/1 ricette accettate.',
      'Ingredienti senza voce nella tabella: zucchero.',
    ]);
  });

  it('reports the title and the text problems of the built set together', async () => {
    const fixtures = standardFixtures();
    fixtures[1] = { ...fixtures[1], recipe: recipeWith(PACK_ORDER[0], ['primo']) };
    fixtures[4] = {
      ...fixtures[4],
      recipe: recipeWith(PACK_ORDER[4], ['contorno'], 'sale', { description: 'Vedi www.esempio.test.' }),
    };
    await prepareState(fixtures);

    const lines = await buildProblemLines();

    expect(lines[0]).toBe(HEADER);
    expect(lines).toContain('Titoli simili: "Risotto ai funghi" e "Risotto ai funghi".');
    expect(lines).toContain('Testo vietato in "Carote glassate": www..');
  });
});
