// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import type { PackCandidate, PackDatasetRow, PackGroup } from '@/lib/domain/types';
import { PackError } from '@/lib/recipes/pack/errors';
import { readDatasetRows } from '@/lib/recipes/pack/dataset';
import {
  CATEGORY_TO_GROUP,
  PICK_SEQUENCE,
  checkedCount,
  evaluateRow,
  isSpoonLikely,
  mainIngredientOf,
  parseSelection,
  readCandidates,
  readSelection,
  renderSelection,
  runSelect,
  selectCandidates,
  selectionLimit,
} from '@/lib/recipes/pack/select';

const SAMPLE_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'recipe-pack', 'sample.csv');
const LONG_STEPS = 'Preparate tutti gli ingredienti sul piano di lavoro e seguite i passaggi con calma. '.repeat(
  3
);
const EMPTY_GROUPS: Record<PackGroup, string[]> = {
  primi: [],
  secondi: [],
  'piatti-unici': [],
  contorni: [],
};

const INGREDIENTS_BY_MAIN = {
  carne: "[['Pancetta', '100g'], ['Sale', 'q.b.']]",
  verdure: "[['Zucchine', '300g'], ['Sale', 'q.b.']]",
  pesce: "[['Tonno', '100g'], ['Sale', 'q.b.']]",
} as const;

function makeRow(overrides: Partial<PackDatasetRow> & Pick<PackDatasetRow, 'index' | 'title'>): PackDatasetRow {
  return {
    category: 'Primi piatti',
    link: `https://example.test/${overrides.index}`,
    servings: '4',
    ingredients: INGREDIENTS_BY_MAIN.verdure,
    steps: LONG_STEPS,
    ...overrides,
  };
}

// Titoli di parole diverse, distinti tra loro anche per i trigrammi (niente scarti per similarità).
function distinctTitles(count: number): string[] {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const modulus = 2147483648;
  let seed = 42;
  const nextLetter = (): string => {
    seed = (seed * 1103515245 + 12345) % modulus;
    return letters[Math.floor((seed / modulus) * letters.length)];
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: 7 }, nextLetter).join('')
  );
}

function makeCandidate(
  code: string,
  overrides: Partial<PackCandidate> = {}
): PackCandidate {
  return {
    code,
    group: 'primi',
    main_ingredient: 'verdure',
    dataset_index: '1',
    link: 'https://example.test/1',
    title: `Ricetta ${code}`,
    category: 'Primi piatti',
    servings: 4,
    ingredients: [
      ['Pasta', '300g'],
      ['Sale', 'q.b.'],
    ],
    procedure: LONG_STEPS.trim(),
    measured_count: 1,
    score: 2,
    checked: true,
    ...overrides,
  };
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-pack-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('lib/recipes/pack/select', () => {
  describe('constants and quotas', () => {
    it('maps the dataset categories to the four groups', () => {
      expect(CATEGORY_TO_GROUP).toEqual({
        'Primi piatti': 'primi',
        'Secondi piatti': 'secondi',
        'Piatti Unici': 'piatti-unici',
        'Torte salate': 'piatti-unici',
        Insalate: 'piatti-unici',
        Contorni: 'contorni',
      });
    });

    it('checks 1.5 times the quota and allows up to 2 times the quota', () => {
      expect(checkedCount('primi')).toBe(75);
      expect(checkedCount('contorni')).toBe(90);
      expect(selectionLimit('primi')).toBe(100);
      expect(selectionLimit('piatti-unici')).toBe(80);
    });

    it('follows the fixed pick sequence', () => {
      expect(PICK_SEQUENCE).toEqual([
        'carne',
        'verdure',
        'pesce',
        'carne',
        'legumi',
        'verdure',
        'pesce',
        'uova',
        'carne',
        'formaggi',
      ]);
    });
  });

  describe('mainIngredientOf', () => {
    it('gives precedence to meat over eggs', () => {
      expect(mainIngredientOf(['Pancetta', 'Uova'])).toBe('carne');
    });

    it('gives precedence to fish over cheese', () => {
      expect(mainIngredientOf(['Tonno', 'Mozzarella'])).toBe('pesce');
    });

    it('gives precedence to legumes over eggs and cheese', () => {
      expect(mainIngredientOf(['Uova', 'Ceci', 'Parmigiano'])).toBe('legumi');
    });

    it('gives precedence to eggs over cheese', () => {
      expect(mainIngredientOf(['Uova', 'Parmigiano'])).toBe('uova');
    });

    it('returns verdure when no keyword matches', () => {
      expect(mainIngredientOf(['Zucchine', 'Sale', 'Olio'])).toBe('verdure');
    });

    it('matches whole words only, so "pollame" is not meat', () => {
      expect(mainIngredientOf(['Pollame ruspante'])).toBe('verdure');
      expect(mainIngredientOf(['Petto di pollo'])).toBe('carne');
    });

    it('matches the words of the names regardless of accents and case', () => {
      expect(mainIngredientOf(['BACCALÀ'])).toBe('pesce');
    });
  });

  describe('isSpoonLikely', () => {
    it('is true for names measured with a spoon', () => {
      expect(isSpoonLikely("Olio extravergine d'oliva")).toBe(true);
      expect(isSpoonLikely('Brodo vegetale')).toBe(true);
      expect(isSpoonLikely('Parmigiano')).toBe(true);
    });

    it('is false for other names, and matches whole words only', () => {
      expect(isSpoonLikely('Pomodori pelati')).toBe(false);
      expect(isSpoonLikely('Sale')).toBe(false);
      expect(isSpoonLikely('Olivastro')).toBe(false);
    });
  });

  describe('evaluateRow', () => {
    it('accepts a valid row and computes the candidate fields and score', () => {
      const procedure = 'Procedimento di prova. '.repeat(50).trim();
      const row = makeRow({
        index: ' 7 ',
        title: '  Pasta di prova  ',
        category: ' Primi piatti ',
        link: ' https://example.test/7 ',
        servings: '4',
        ingredients: "[['Pasta', '300g'], ['Pomodori', '400g'], ['Sale', 'q.b.']]",
        steps: `${procedure} `,
      });

      expect(evaluateRow(row)).toEqual({
        ok: true,
        candidate: {
          group: 'primi',
          main_ingredient: 'verdure',
          dataset_index: '7',
          link: 'https://example.test/7',
          title: 'Pasta di prova',
          category: 'Primi piatti',
          servings: 4,
          ingredients: [
            ['Pasta', '300g'],
            ['Pomodori', '400g'],
            ['Sale', 'q.b.'],
          ],
          procedure,
          measured_count: 2,
          score: 2 + Math.ceil(procedure.length / 500),
        },
      });
    });

    it('rejects a category that is not in the mapping', () => {
      expect(evaluateRow(makeRow({ index: '1', title: 'Torta', category: 'Dolci' }))).toEqual({
        ok: false,
        reason: 'categoria',
      });
    });

    it('rejects ingredients that are not a list of at least two pairs', () => {
      const unreadable = makeRow({ index: '2', title: 'Pasta', ingredients: 'Pasta e pomodoro q.b.' });
      const single = makeRow({ index: '3', title: 'Pasta', ingredients: "[['Pasta', '300g']]" });
      expect(evaluateRow(unreadable)).toEqual({ ok: false, reason: 'ingredienti' });
      expect(evaluateRow(single)).toEqual({ ok: false, reason: 'ingredienti' });
    });

    it('rejects a procedure shorter than 200 characters', () => {
      const short = makeRow({ index: '4', title: 'Pasta', steps: 'Cuocere e condire.' });
      expect(evaluateRow(short)).toEqual({ ok: false, reason: 'procedimento' });
    });

    it('rejects a number of servings that is not an integer between 2 and 8', () => {
      for (const servings of ['12', '1', 'quattro', '4.5', '']) {
        expect(evaluateRow(makeRow({ index: '5', title: 'Pasta', servings }))).toEqual({
          ok: false,
          reason: 'persone',
        });
      }
    });

    it('rejects an unreadable quantity', () => {
      const row = makeRow({
        index: '6',
        title: 'Pasta',
        ingredients: "[['Riso', '025g'], ['Sale', 'q.b.']]",
      });
      expect(evaluateRow(row)).toEqual({ ok: false, reason: 'quantità' });
    });

    it('rejects more than 10 measured ingredients, but not q.b. ones', () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `['Ingrediente ${i}', '10g']`).join(', ');
      const tenWithQb = Array.from({ length: 10 }, (_, i) => `['Ingrediente ${i}', '10g']`)
        .concat("['Sale', 'q.b.']")
        .join(', ');
      expect(evaluateRow(makeRow({ index: '7', title: 'Pasta', ingredients: `[${eleven}]` }))).toEqual({
        ok: false,
        reason: 'troppi ingredienti',
      });
      expect(evaluateRow(makeRow({ index: '8', title: 'Pasta', ingredients: `[${tenWithQb}]` })).ok).toBe(
        true
      );
    });

    it('rejects an appliance mentioned in the title or the procedure', () => {
      const inSteps = makeRow({
        index: '9',
        title: 'Pasta',
        steps: `${LONG_STEPS} Impastate con la Bimby.`,
      });
      const inTitle = makeRow({ index: '10', title: 'Impasto con la planetaria' });
      expect(evaluateRow(inSteps)).toEqual({ ok: false, reason: 'elettrodomestico' });
      expect(evaluateRow(inTitle)).toEqual({ ok: false, reason: 'elettrodomestico' });
    });

    it('explains each rejected row of the sample dataset', () => {
      const rows = readDatasetRows(fs.readFileSync(SAMPLE_PATH, 'utf8'));
      const reasons = Object.fromEntries(
        rows.map((row) => {
          const result = evaluateRow(row);
          return [row.index, result.ok ? 'ok' : result.reason];
        })
      );
      expect(reasons).toEqual({
        '10': 'ok',
        '11': 'ok',
        '12': 'ok',
        '13': 'ok',
        '20': 'ok',
        '21': 'ok',
        '22': 'ok',
        '30': 'ok',
        '31': 'ok',
        '32': 'ok',
        '40': 'ok',
        '41': 'ok',
        '42': 'ok',
        '50': 'categoria',
        '51': 'ingredienti',
        '52': 'procedimento',
        '53': 'persone',
        '54': 'quantità',
        '55': 'troppi ingredienti',
        '56': 'elettrodomestico',
      });
    });
  });

  describe('selectCandidates', () => {
    it('follows the pick sequence with a single vegetable row among many meat rows', () => {
      const rows = [
        makeRow({ index: '1', title: 'Polpette della nonna', ingredients: INGREDIENTS_BY_MAIN.carne }),
        makeRow({ index: '2', title: 'Arrosto di vitello', ingredients: INGREDIENTS_BY_MAIN.carne }),
        makeRow({ index: '3', title: 'Spiedini di maiale', ingredients: INGREDIENTS_BY_MAIN.carne }),
        makeRow({ index: '4', title: 'Cotoletta alla milanese', ingredients: INGREDIENTS_BY_MAIN.carne }),
        makeRow({ index: '5', title: 'Vellutata di zucche', ingredients: INGREDIENTS_BY_MAIN.verdure }),
      ];

      const { candidates } = selectCandidates(rows);

      expect(candidates.map((c) => [c.code, c.title, c.main_ingredient])).toEqual([
        ['P001', 'Polpette della nonna', 'carne'],
        ['P002', 'Vellutata di zucche', 'verdure'],
        ['P003', 'Arrosto di vitello', 'carne'],
        ['P004', 'Spiedini di maiale', 'carne'],
        ['P005', 'Cotoletta alla milanese', 'carne'],
      ]);
    });

    it('orders each queue by score, then by dataset index', () => {
      const rows = [
        makeRow({ index: '1', title: 'Zuppa lunga', ingredients: "[['Zucchine', '300g'], ['Carota', '100g'], ['Sale', 'q.b.']]" }),
        makeRow({ index: '9', title: 'Vellutata corta', ingredients: "[['Zucchine', '300g'], ['Sale', 'q.b.']]" }),
        makeRow({ index: '3', title: 'Minestra breve', ingredients: "[['Zucchine', '300g'], ['Sale', 'q.b.']]" }),
      ];

      const { candidates } = selectCandidates(rows);

      expect(candidates.map((c) => c.title)).toEqual(['Minestra breve', 'Vellutata corta', 'Zuppa lunga']);
    });

    it('discards a row whose title is similar to one already picked, and takes the next one', () => {
      const rows = [
        makeRow({ index: '1', title: 'Pasta alla norma' }),
        makeRow({ index: '2', title: 'Pasta alla Norma siciliana' }),
        makeRow({ index: '3', title: 'Vellutata di zucche' }),
      ];

      const { candidates } = selectCandidates(rows);

      expect(candidates.map((c) => [c.code, c.title])).toEqual([
        ['P001', 'Pasta alla norma'],
        ['P002', 'Vellutata di zucche'],
      ]);
    });

    it('keeps the groups in order with their own codes and reports the available rows', () => {
      const rows = [
        makeRow({ index: '1', title: 'Contorno di patate', category: 'Contorni' }),
        makeRow({ index: '2', title: 'Pasta alla carbonara', category: 'Primi piatti', ingredients: INGREDIENTS_BY_MAIN.carne }),
        makeRow({ index: '3', title: 'Merluzzo al forno', category: 'Secondi piatti', ingredients: INGREDIENTS_BY_MAIN.pesce }),
        makeRow({ index: '4', title: 'Zuppa di farro', category: 'Piatti Unici' }),
        makeRow({ index: '5', title: 'Dolce', category: 'Dolci' }),
      ];

      const { candidates, available } = selectCandidates(rows);

      expect(candidates.map((c) => c.code)).toEqual(['P001', 'S001', 'U001', 'C001']);
      expect(candidates.map((c) => c.group)).toEqual(['primi', 'secondi', 'piatti-unici', 'contorni']);
      expect(available).toEqual({ primi: 1, secondi: 1, 'piatti-unici': 1, contorni: 1 });
    });

    it('marks as checked only the first 1.5 times the quota, and caps the group at 2 times the quota', () => {
      const titles = distinctTitles(105);
      const rows = titles.map((title, i) =>
        makeRow({ index: String(i + 1), title, ingredients: INGREDIENTS_BY_MAIN.carne })
      );

      const { candidates, available } = selectCandidates(rows);

      expect(candidates).toHaveLength(selectionLimit('primi'));
      expect(candidates[0].code).toBe('P001');
      expect(candidates[candidates.length - 1].code).toBe('P100');
      expect(candidates.filter((c) => c.checked)).toHaveLength(checkedCount('primi'));
      expect(candidates[checkedCount('primi') - 1].checked).toBe(true);
      expect(candidates[checkedCount('primi')].checked).toBe(false);
      expect(available.primi).toBe(105);
    });
  });

  describe('renderSelection and parseSelection', () => {
    it('writes the header, one section per group and "Nessun candidato." for empty groups', () => {
      const text = renderSelection([makeCandidate('P001', { title: 'Pasta di prova', measured_count: 3 })]);

      expect(text.startsWith('# Pacchetto di ricette — selezione\n\n')).toBe(true);
      expect(text).toContain(
        "L'ordine conta: per ogni gruppo si convertono le righe spuntate dall'alto, fino alla quota.\n"
      );
      expect(text).toContain('\n## Primi — quota 50\n\n- [x] P001 · Pasta di prova · 3 ingredienti · verdure\n');
      expect(text).toContain('\n## Secondi — quota 50\n\nNessun candidato.\n');
      expect(text).toContain('\n## Piatti unici — quota 40\n\nNessun candidato.\n');
      expect(text).toContain('\n## Contorni — quota 60\n\nNessun candidato.\n');
      expect(text.endsWith('Nessun candidato.\n')).toBe(true);
    });

    it('writes the reserves under "### Riserve" with an unchecked box', () => {
      const text = renderSelection([
        makeCandidate('P001', { checked: true }),
        makeCandidate('P002', { checked: false, title: 'Riserva di prova' }),
      ]);

      expect(text).toContain('- [x] P001 · Ricetta P001 · 1 ingredienti · verdure\n\n### Riserve\n\n- [ ] P002 · Riserva di prova · 1 ingredienti · verdure\n');
    });

    it('reads back the checked codes of each group in file order', () => {
      const candidates = [
        makeCandidate('P001'),
        makeCandidate('P002'),
        makeCandidate('P003', { checked: false }),
        makeCandidate('S001', { group: 'secondi' }),
        makeCandidate('C001', { group: 'contorni' }),
      ];

      const parsed = parseSelection(renderSelection(candidates), candidates);

      expect(parsed).toEqual({
        primi: ['P001', 'P002'],
        secondi: ['S001'],
        'piatti-unici': [],
        contorni: ['C001'],
      });
    });

    it('ignores a deleted row, takes a reserve that is checked, and accepts an uppercase X', () => {
      const candidates = [
        makeCandidate('P001'),
        makeCandidate('P002'),
        makeCandidate('P003', { checked: false }),
      ];
      const markdown = [
        '## Primi — quota 50',
        '- [X] P002 · Ricetta P002 · 1 ingredienti · verdure',
        '### Riserve',
        '- [x] P003 · Ricetta P003 · 1 ingredienti · verdure',
        '',
      ].join('\n');

      expect(parseSelection(markdown, candidates).primi).toEqual(['P002', 'P003']);
    });

    it('reads a file with CRLF line endings', () => {
      const candidates = [makeCandidate('P001'), makeCandidate('P002')];
      const markdown = '- [x] P001 · a\r\n- [ ] P002 · b\r\n';

      expect(parseSelection(markdown, candidates).primi).toEqual(['P001']);
    });

    it('counts a code appearing twice only once', () => {
      const candidates = [makeCandidate('P001')];
      const markdown = '- [x] P001 · a\n- [x] P001 · a\n';

      expect(parseSelection(markdown, candidates).primi).toEqual(['P001']);
    });

    it('throws with the exact message for a checked code that is unknown', () => {
      const candidates = [makeCandidate('P001')];

      expect(() => parseSelection('- [x] P999 · inventata\n', candidates)).toThrow(
        new PackError('Codice sconosciuto in selection.md: P999')
      );
    });

    it('ignores an unchecked unknown code', () => {
      const candidates = [makeCandidate('P001')];

      expect(parseSelection('- [ ] P999 · inventata\n', candidates)).toEqual(EMPTY_GROUPS);
    });

    it('returns all four keys even when the file is empty', () => {
      expect(parseSelection('', [])).toEqual(EMPTY_GROUPS);
    });
  });

  describe('runSelect', () => {
    it('writes candidates.json and selection.md from the sample dataset', async () => {
      const report = await runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: false });

      const written = JSON.parse(fs.readFileSync(`${dir}/candidates.json`, 'utf8')) as {
        candidates: PackCandidate[];
      };
      expect(written.candidates.map((c) => c.code)).toEqual([
        'P001',
        'P002',
        'P003',
        'S001',
        'S002',
        'S003',
        'U001',
        'U002',
        'U003',
        'C001',
        'C002',
        'C003',
      ]);
      expect(written.candidates.map((c) => c.title)).toContain('Pasta alla Norma siciliana');
      expect(written.candidates.map((c) => c.title)).not.toContain('Pasta alla norma');
      expect(fs.readFileSync(`${dir}/candidates.json`, 'utf8').endsWith('}\n')).toBe(true);

      const selection = fs.readFileSync(`${dir}/selection.md`, 'utf8');
      expect(selection).toContain('- [x] P002 · Pasta alla Norma siciliana · 3 ingredienti · verdure');
      expect(selection).toContain('- [x] C003 · Cavolfiore gratinato · 3 ingredienti · formaggi');

      expect(report.groups.primi).toEqual({ checked: 3, reserves: 0, available: 4 });
      expect(report.groups.secondi).toEqual({ checked: 3, reserves: 0, available: 3 });
      expect(report.groups['piatti-unici']).toEqual({ checked: 3, reserves: 0, available: 3 });
      expect(report.groups.contorni).toEqual({ checked: 3, reserves: 0, available: 3 });
    });

    it('reports the groups below the checked threshold', async () => {
      const report = await runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: false });

      expect(report.warnings).toEqual([
        'Primi: solo 3 candidati, meno dei 75 previsti.',
        'Secondi: solo 3 candidati, meno dei 75 previsti.',
        'Piatti unici: solo 3 candidati, meno dei 60 previsti.',
        'Contorni: solo 3 candidati, meno dei 90 previsti.',
      ]);
    });

    it('refuses to overwrite an existing selection without force', async () => {
      await runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: false });

      await expect(runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: false })).rejects.toThrow(
        new PackError(
          `Esiste già ${dir}/selection.md: per rifare la selezione, e perdere la revisione, usa --force.`
        )
      );
    });

    it('overwrites the selection with force', async () => {
      await runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: false });
      fs.writeFileSync(`${dir}/selection.md`, 'revisione a mano\n', 'utf8');

      await runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: true });

      const selection = fs.readFileSync(`${dir}/selection.md`, 'utf8');
      expect(selection).not.toContain('revisione a mano');
      expect(selection.startsWith('# Pacchetto di ricette — selezione')).toBe(true);
    });

    it('throws with the exact message when the dataset is missing', async () => {
      const csvPath = path.join(dir, 'assente.csv');

      await expect(runSelect({ csvPath, workDir: dir, force: false })).rejects.toThrow(
        new PackError(`File del dataset non trovato: ${csvPath}`)
      );
    });
  });

  describe('readCandidates and readSelection', () => {
    it('reads back the candidates and the checked selection written by runSelect', async () => {
      await runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: false });

      const candidates = await readCandidates(dir);
      const selection = await readSelection(dir, candidates);

      expect(candidates).toHaveLength(12);
      expect(selection.primi).toEqual(['P001', 'P002', 'P003']);
      expect(selection.contorni).toEqual(['C001', 'C002', 'C003']);
    });

    it('throws with the exact message when candidates.json is missing', async () => {
      await expect(readCandidates(dir)).rejects.toThrow(
        new PackError(`Manca ${dir}/candidates.json: lancia prima "pnpm recipes:pack select".`)
      );
    });

    it('throws with the exact message when selection.md is missing', async () => {
      await expect(readSelection(dir, [])).rejects.toThrow(
        new PackError(`Manca ${dir}/selection.md: lancia prima "pnpm recipes:pack select".`)
      );
    });

    it('reports an invalid candidates.json with the path and the first problem', async () => {
      fs.writeFileSync(`${dir}/candidates.json`, '{ non json', 'utf8');
      await expect(readCandidates(dir)).rejects.toThrow(`File non valido: ${dir}/candidates.json: `);

      fs.writeFileSync(`${dir}/candidates.json`, '{"candidates": [{"code": "X1"}]}\n', 'utf8');
      await expect(readCandidates(dir)).rejects.toThrow(`File non valido: ${dir}/candidates.json: `);
    });

    it('throws with the exact message for an unknown code in selection.md', async () => {
      await runSelect({ csvPath: SAMPLE_PATH, workDir: dir, force: false });
      const candidates = await readCandidates(dir);
      fs.appendFileSync(`${dir}/selection.md`, '- [x] P999 · inventata\n', 'utf8');

      await expect(readSelection(dir, candidates)).rejects.toThrow(
        new PackError('Codice sconosciuto in selection.md: P999')
      );
    });

    it('is a PackError instance for a missing file', async () => {
      await expect(readCandidates(dir)).rejects.toBeInstanceOf(PackError);
    });
  });
});
