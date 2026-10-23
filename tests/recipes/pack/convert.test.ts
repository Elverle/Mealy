// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LanguageModel } from 'ai';
import { FIXTURE_INGREDIENT_ALIASES } from '@/fixtures';
import {
  type GeneratedRecipe,
  type PackCandidate,
  type PackConvertItem,
  type PackGroup,
} from '@/lib/domain/types';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import { LlmError, type PackConvertOptions } from '@/lib/llm';
import {
  buildKnownNames,
  runConvert,
  toConvertItem,
  type ConvertOptions,
} from '@/lib/recipes/pack/convert';
import { writeJsonFile } from '@/lib/recipes/pack/files';
import { workPaths } from '@/lib/recipes/pack/paths';
import { renderSelection } from '@/lib/recipes/pack/select';
import { readRecords } from '@/lib/recipes/pack/state';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const MODEL_NAME = 'modello-di-prova';
const CALL_DELAY_MS = 5;
const PROCEDURE =
  'Scalda l olio in padella, rosola la cipolla e aggiungi i pomodori tagliati a pezzetti.';
const QUOTAS: Record<PackGroup, number> = {
  primi: 2,
  secondi: 1,
  'piatti-unici': 1,
  contorni: 1,
};
const COURSE_BY_GROUP: Record<PackGroup, GeneratedRecipe['courses'][number]> = {
  primi: 'primo',
  secondi: 'secondo',
  'piatti-unici': 'piatto-unico',
  contorni: 'contorno',
};
const FAKE_MODEL = {} as LanguageModel;
const E2_PRIMI_CONTORNO = 'portata non adatta al gruppo Primi: contorno';

type ConvertResponder = (item: PackConvertItem, options?: PackConvertOptions) => GeneratedRecipe;

let dir: string;
let workDir: string;
type LogFn = (...args: unknown[]) => void;
let logger: { log: Mock<LogFn>; warn: Mock<LogFn> };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-pack-'));
  workDir = `${dir}/.recipe-pack`;
  logger = { log: vi.fn<LogFn>(), warn: vi.fn<LogFn>() };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Ricetta valida per il gruppo: portata giusta, ingredienti come il candidato di default. */
function recipeFor(group: PackGroup, overrides: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return makeGeneratedRecipe({ courses: [COURSE_BY_GROUP[group]], ...overrides });
}

/** Risposta corretta: stesso titolo del candidato, portata del gruppo. */
const goodRecipe: ConvertResponder = (item) => recipeFor(item.group, { title: item.title });

function makeCandidate(
  code: string,
  group: PackGroup,
  overrides: Partial<PackCandidate> = {}
): PackCandidate {
  return {
    code,
    group,
    main_ingredient: 'verdure',
    dataset_index: code.slice(1),
    link: `https://example.test/${code}`,
    title: `Ricetta ${code}`,
    category: 'Piatti',
    servings: 2,
    ingredients: [
      ['Farina', '200 g'],
      ['Zucchero', '50 g'],
      ['Sale fino', '5 g'],
    ],
    procedure: PROCEDURE,
    measured_count: 3,
    score: 5,
    checked: true,
    ...overrides,
  };
}

/** Un candidato spuntato per ciascuno dei gruppi diversi da primi. */
function otherGroups(): PackCandidate[] {
  return [
    makeCandidate('S001', 'secondi'),
    makeCandidate('U001', 'piatti-unici'),
    makeCandidate('C001', 'contorni'),
  ];
}

/** Scrive candidates.json e selection.md nella cartella di lavoro. */
async function writeWork(candidates: PackCandidate[]): Promise<void> {
  const paths = workPaths(workDir);
  await writeJsonFile(paths.candidates, { candidates });
  await fs.promises.writeFile(paths.selection, renderSelection(candidates), 'utf8');
}

/** Modello del dataset finto: risponde con `respond` e registra le chiamate. */
function fakeConvert(respond: ConvertResponder = goodRecipe) {
  return vi.fn(async (item: PackConvertItem, options?: PackConvertOptions) => respond(item, options));
}

/** Modello finto che conta le chiamate in corso, con una pausa per ciascuna. */
function trackingConvert(respond: ConvertResponder = goodRecipe) {
  const counter = { inFlight: 0, maxInFlight: 0 };
  const convert = vi.fn(async (item: PackConvertItem, options?: PackConvertOptions) => {
    counter.inFlight += 1;
    counter.maxInFlight = Math.max(counter.maxInFlight, counter.inFlight);
    await new Promise((resolve) => setTimeout(resolve, CALL_DELAY_MS));
    counter.inFlight -= 1;
    return respond(item, options);
  });
  return { convert, counter };
}

/** Opzioni di una esecuzione nei test: file della tabella assente, modello finto, data fissa. */
function convertOptions(
  convert: ConvertOptions['convert'],
  overrides: Partial<ConvertOptions> = {}
): ConvertOptions {
  return {
    workDir,
    concurrency: 1,
    retryRejected: false,
    ingredientsFile: `${workDir}/ingredients.json`,
    model: FAKE_MODEL,
    modelName: MODEL_NAME,
    logger,
    now: () => NOW,
    convert,
    quotas: QUOTAS,
    ...overrides,
  };
}

function callsFor(convert: ReturnType<typeof fakeConvert>, group: PackGroup): unknown[] {
  return convert.mock.calls.filter(([item]) => item.group === group);
}

describe('runConvert', () => {
  it('si ferma alla quota: con 4 primi spuntati e quota 2 il modello è chiamato 2 volte per i primi', async () => {
    await writeWork([
      makeCandidate('P001', 'primi'),
      makeCandidate('P002', 'primi'),
      makeCandidate('P003', 'primi'),
      makeCandidate('P004', 'primi'),
      ...otherGroups(),
    ]);
    const convert = fakeConvert();

    const report = await runConvert(convertOptions(convert));

    expect(callsFor(convert, 'primi')).toHaveLength(2);
    expect(report.groups.primi).toEqual({ accepted: 2, quota: 2, rejected: 0, failed: 0 });
    expect(report.complete).toBe(true);
    expect(fs.existsSync(`${workDir}/converted/P003.json`)).toBe(false);
  });

  it('gruppo sotto quota: accettate sotto la quota e complete false', async () => {
    await writeWork([makeCandidate('P001', 'primi'), ...otherGroups()]);

    const report = await runConvert(convertOptions(fakeConvert()));

    expect(report.groups.primi).toEqual({ accepted: 1, quota: 2, rejected: 0, failed: 0 });
    expect(report.complete).toBe(false);
  });

  it('con E2 al primo tentativo, il secondo riceve il feedback e la ricetta viene accettata', async () => {
    await writeWork([makeCandidate('P001', 'primi')]);
    const convert = fakeConvert();
    convert.mockResolvedValueOnce(recipeFor('contorni'));

    const report = await runConvert(convertOptions(convert, { quotas: { ...QUOTAS, primi: 1 } }));

    expect(convert).toHaveBeenCalledTimes(2);
    expect(convert.mock.calls[1][1]).toMatchObject({ feedback: [E2_PRIMI_CONTORNO] });
    expect(report.groups.primi.accepted).toBe(1);
    expect((await readRecords(workDir)).get('P001')).toMatchObject({
      status: 'accepted',
      model: MODEL_NAME,
      converted_at: NOW.toISOString(),
      errors: [],
    });
    expect(logger.log).toHaveBeenCalledWith('[pack] P001 accettata');
  });

  it('scartata dopo due tentativi: record rejected con gli errori e nessuna ricetta', async () => {
    await writeWork([makeCandidate('P001', 'primi')]);
    const convert = fakeConvert(() => recipeFor('contorni'));

    const report = await runConvert(convertOptions(convert));

    expect(convert).toHaveBeenCalledTimes(2);
    expect(report.groups.primi).toEqual({ accepted: 0, quota: 2, rejected: 1, failed: 0 });
    expect((await readRecords(workDir)).get('P001')).toMatchObject({
      status: 'rejected',
      recipe: null,
      errors: [E2_PRIMI_CONTORNO],
      warnings: [],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      `[pack] P001 scartata: ${E2_PRIMI_CONTORNO}`
    );
  });

  it('LlmError timeout: nessun record, failed 1, log esatto; al rilancio il candidato si riprova', async () => {
    await writeWork([makeCandidate('P001', 'primi'), makeCandidate('P002', 'primi'), ...otherGroups()]);
    const firstRun = fakeConvert((item) => {
      if (item.title === 'Ricetta P001') throw new LlmError('timeout', 'Tempo scaduto');
      return goodRecipe(item);
    });

    const first = await runConvert(convertOptions(firstRun));

    expect(first.groups.primi).toEqual({ accepted: 1, quota: 2, rejected: 0, failed: 1 });
    expect(first.complete).toBe(false);
    expect((await readRecords(workDir)).has('P001')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[pack] P001 non convertita: timeout: Tempo scaduto'
    );

    const secondRun = fakeConvert();
    const second = await runConvert(convertOptions(secondRun));

    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(secondRun.mock.calls[0][0].title).toBe('Ricetta P001');
    expect(second.groups.primi).toEqual({ accepted: 2, quota: 2, rejected: 0, failed: 0 });
    expect(second.complete).toBe(true);
  });

  it('rilancio: i record esistenti non richiamano il modello', async () => {
    await writeWork([makeCandidate('P001', 'primi'), makeCandidate('P002', 'primi'), ...otherGroups()]);
    await runConvert(convertOptions(fakeConvert()));

    const convert = fakeConvert();
    const report = await runConvert(convertOptions(convert));

    expect(convert).not.toHaveBeenCalled();
    expect(report.complete).toBe(true);
    expect(report.groups.primi.accepted).toBe(2);
  });

  it('retryRejected riprova le scartate, senza richiamare le accettate', async () => {
    await writeWork([makeCandidate('P001', 'primi'), makeCandidate('P002', 'primi'), ...otherGroups()]);
    const firstRun = fakeConvert((item) =>
      item.title === 'Ricetta P001' ? recipeFor('contorni') : goodRecipe(item)
    );
    const first = await runConvert(convertOptions(firstRun));
    expect(first.groups.primi).toEqual({ accepted: 1, quota: 2, rejected: 1, failed: 0 });

    const retry = fakeConvert();
    const report = await runConvert(convertOptions(retry, { retryRejected: true }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0].title).toBe('Ricetta P001');
    expect(report.groups.primi).toEqual({ accepted: 2, quota: 2, rejected: 0, failed: 0 });
    expect((await readRecords(workDir)).get('P001')?.status).toBe('accepted');
  });

  it('senza modelName, con modello iniettato, il record riporta "iniettato"', async () => {
    await writeWork([makeCandidate('P001', 'primi'), ...otherGroups()]);

    await runConvert(convertOptions(fakeConvert(), { modelName: undefined }));

    expect((await readRecords(workDir)).get('P001')?.model).toBe('iniettato');
  });

  it('concurrency 2: non più di 2 chiamate in corso e la quota non viene superata', async () => {
    await writeWork([
      makeCandidate('P001', 'primi'),
      makeCandidate('P002', 'primi'),
      makeCandidate('P003', 'primi'),
      makeCandidate('P004', 'primi'),
      makeCandidate('P005', 'primi'),
      makeCandidate('P006', 'primi'),
      ...otherGroups(),
    ]);
    const { convert, counter } = trackingConvert();

    const report = await runConvert(
      convertOptions(convert, { concurrency: 2, quotas: { ...QUOTAS, primi: 4 } })
    );

    expect(counter.maxInFlight).toBe(2);
    expect(callsFor(convert, 'primi')).toHaveLength(4);
    expect(report.groups.primi.accepted).toBe(4);
  });

  it('concurrency 3 con quota 2: non si avviano più chiamate della quota', async () => {
    await writeWork([
      makeCandidate('P001', 'primi'),
      makeCandidate('P002', 'primi'),
      makeCandidate('P003', 'primi'),
      ...otherGroups(),
    ]);
    const { convert, counter } = trackingConvert();

    const report = await runConvert(convertOptions(convert, { concurrency: 3 }));

    expect(counter.maxInFlight).toBe(2);
    expect(callsFor(convert, 'primi')).toHaveLength(2);
    expect(report.groups.primi.accepted).toBe(2);
  });

  it('concurrency 2 con scarti: la quota non viene superata e le accettate sono esattamente la quota', async () => {
    await writeWork([
      makeCandidate('P001', 'primi'),
      makeCandidate('P002', 'primi'),
      makeCandidate('P003', 'primi'),
      makeCandidate('P004', 'primi'),
      ...otherGroups(),
    ]);
    const { convert, counter } = trackingConvert((item) =>
      item.title === 'Ricetta P001' ? recipeFor('contorni') : goodRecipe(item)
    );

    const report = await runConvert(convertOptions(convert, { concurrency: 2 }));

    const accepted = [...(await readRecords(workDir)).values()].filter(
      (record) => record.status === 'accepted' && record.code.startsWith('P')
    );
    expect(counter.maxInFlight).toBeLessThanOrEqual(2);
    expect(accepted).toHaveLength(2);
    expect(report.groups.primi.accepted).toBe(2);
    expect(report.groups.primi.rejected).toBe(1);
    expect(report.complete).toBe(true);
  });

  it.each([0, 6])('concurrency %i è fuori dall intervallo 1–5: RangeError', async (concurrency) => {
    await writeWork([makeCandidate('P001', 'primi'), ...otherGroups()]);

    await expect(
      runConvert(convertOptions(fakeConvert(), { concurrency }))
    ).rejects.toThrow(RangeError);
  });

  it('un errore che non è LlmError fa rifiutare runConvert', async () => {
    await writeWork([makeCandidate('P001', 'primi'), ...otherGroups()]);
    const convert = fakeConvert(() => {
      throw new Error('errore imprevisto');
    });

    await expect(runConvert(convertOptions(convert))).rejects.toThrow('errore imprevisto');
  });

  it('scrive il report con le sezioni dei gruppi, avvisi e scarti', async () => {
    await writeWork([makeCandidate('P001', 'primi'), makeCandidate('P002', 'primi'), ...otherGroups()]);
    const convert = fakeConvert((item) =>
      item.title === 'Ricetta P001'
        ? recipeFor('primi', { title: item.title, prep_minutes: 150 })
        : item.group === 'primi'
          ? recipeFor('contorni')
          : goodRecipe(item)
    );

    await runConvert(convertOptions(convert));

    const report = await fs.promises.readFile(workPaths(workDir).report, 'utf8');
    expect(report).toContain(`Generato il ${NOW.toISOString()}.`);
    expect(report).toContain('## Primi — accettate 1/2');
    expect(report).toContain('- P001 · Ricetta P001 · https://example.test/P001');
    expect(report).toContain('  - avviso: tempo lungo: 150 minuti');
    expect(report).toContain('- P002 · Ricetta P002 · https://example.test/P002');
    expect(report).toContain(`  - ${E2_PRIMI_CONTORNO}`);
    expect(report).toContain('## Secondi — accettate 1/1');
  });

  it('la tabella degli ingredienti alimenta i nomi noti del modello', async () => {
    await writeWork([makeCandidate('P001', 'primi'), ...otherGroups()]);
    await fs.promises.writeFile(
      `${workDir}/ingredients.json`,
      JSON.stringify({
        ingredients: [
          {
            name: 'Zafferano',
            category: 'dispensa',
            carne: false,
            pesce: false,
            latticini: false,
            uova: false,
            miele: false,
            glutine: false,
            reviewed: true,
          },
        ],
      }),
      'utf8'
    );
    const convert = fakeConvert();

    await runConvert(convertOptions(convert, { ingredientsFile: `${workDir}/ingredients.json` }));

    expect(convert.mock.calls[0][0].known_names).toContain('zafferano');
  });

  it('tabella degli ingredienti non valida: rifiuta con File non valido', async () => {
    await writeWork([makeCandidate('P001', 'primi'), ...otherGroups()]);
    await fs.promises.writeFile(`${workDir}/ingredients.json`, '{ non json', 'utf8');

    await expect(
      runConvert(convertOptions(fakeConvert(), { ingredientsFile: `${workDir}/ingredients.json` }))
    ).rejects.toThrow('File non valido');
  });
});

describe('buildKnownNames', () => {
  it('normalizza i nomi della tabella e ne toglie i doppioni', () => {
    const names = buildKnownNames([{ name: '  Sale   Fino ' }, { name: 'sale fino' }]);

    expect(names.filter((name) => name === 'sale fino')).toHaveLength(1);
    expect(names).not.toContain('  Sale   Fino ');
  });

  it('include gli alias e gli ingredienti delle ricette di esempio', () => {
    const names = buildKnownNames([]);

    expect(names).toContain(normalizeCanonicalName(FIXTURE_INGREDIENT_ALIASES[0].canonical_name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('ordina con il confronto italiano', () => {
    const names = buildKnownNames([{ name: 'Zucca' }, { name: 'Èpice' }, { name: 'Acqua' }]);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'it')));
  });
});

describe('toConvertItem', () => {
  it('porta nome, quantità grezza, lettura e nomi noti; la lettura è null se illeggibile', () => {
    const candidate = makeCandidate('P001', 'primi', {
      ingredients: [
        ['Farina', '200 g'],
        ['Sale', 'q.b.'],
        ['Uova', '2'],
        ['Pepe', 'mezzo'],
      ],
    });

    const item = toConvertItem(candidate, ['farina', 'sale']);

    expect(item).toEqual({
      title: 'Ricetta P001',
      group: 'primi',
      servings: 2,
      ingredients: [
        { name: 'Farina', raw_qty: '200 g', reading: '200 g' },
        { name: 'Sale', raw_qty: 'q.b.', reading: 'q.b.' },
        { name: 'Uova', raw_qty: '2', reading: '2 senza unità' },
        { name: 'Pepe', raw_qty: 'mezzo', reading: null },
      ],
      procedure: PROCEDURE,
      known_names: ['farina', 'sale'],
    });
  });
});
