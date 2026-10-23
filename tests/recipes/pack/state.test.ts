// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  PACK_GROUP_QUOTAS,
  type PackCandidate,
  type PackConversionRecord,
  type PackGroup,
} from '@/lib/domain/types';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';
import { PackError } from '@/lib/recipes/pack/errors';
import { writeJsonFile } from '@/lib/recipes/pack/files';
import { workPaths } from '@/lib/recipes/pack/paths';
import { renderSelection } from '@/lib/recipes/pack/select';
import {
  acceptedByGroup,
  readRecords,
  readWorkState,
  writeRecord,
  type PackWorkState,
} from '@/lib/recipes/pack/state';

const CONVERTED_AT = '2026-10-23T10:00:00.000Z';
const EMPTY_GROUPS: Record<PackGroup, string[]> = {
  primi: [],
  secondi: [],
  'piatti-unici': [],
  contorni: [],
};

let dir: string;
let workDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-pack-'));
  workDir = path.join(dir, '.recipe-pack');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeCandidate(code: string, group: PackGroup, checked: boolean): PackCandidate {
  return {
    code,
    group,
    main_ingredient: 'verdure',
    dataset_index: code.slice(1),
    link: `https://example.test/${code}`,
    title: `Ricetta ${code}`,
    category: 'Primi piatti',
    servings: 4,
    ingredients: [
      ['Zucchine', '300g'],
      ['Sale', 'q.b.'],
    ],
    procedure: 'Taglia le zucchine a rondelle e falle saltare in padella con olio e sale.',
    measured_count: 1,
    score: 2,
    checked,
  };
}

function makeAccepted(code: string, warnings: string[] = []): PackConversionRecord {
  return {
    code,
    status: 'accepted',
    recipe: makeGeneratedRecipe({ title: `Ricetta ${code}` }),
    errors: [],
    warnings,
    model: 'modello-di-prova',
    converted_at: CONVERTED_AT,
  };
}

function makeRejected(code: string, errors: string[]): PackConversionRecord {
  return {
    code,
    status: 'rejected',
    recipe: null,
    errors,
    warnings: [],
    model: 'modello-di-prova',
    converted_at: CONVERTED_AT,
  };
}

describe('readRecords', () => {
  it('returns an empty map when the converted folder does not exist', async () => {
    await expect(readRecords(workDir)).resolves.toEqual(new Map());
  });

  it('reads back the records written with writeRecord, keyed by code', async () => {
    const accepted = makeAccepted('P001', ['quantità di "Zucchine": "300g" → 200 g']);
    const rejected = makeRejected('P002', ['schema: ingredients.0.qty: Number must be greater than 0']);
    await writeRecord(workDir, accepted);
    await writeRecord(workDir, rejected);

    const records = await readRecords(workDir);
    expect([...records.keys()]).toEqual(['P001', 'P002']);
    expect(records.get('P001')).toEqual(accepted);
    expect(records.get('P002')).toEqual(rejected);
  });

  it('reads the JSON files in sorted name order and ignores other files', async () => {
    await writeRecord(workDir, makeAccepted('P010'));
    await writeRecord(workDir, makeAccepted('P002'));
    fs.writeFileSync(path.join(workDir, 'converted', 'notes.txt'), 'non è un record', 'utf8');

    const records = await readRecords(workDir);
    expect([...records.keys()]).toEqual(['P002', 'P010']);
  });

  it('throws a PackError starting with "File non valido: " for a record that does not match the schema', async () => {
    await writeJsonFile(path.join(workDir, 'converted', 'P001.json'), { code: 'P001' });

    const error = await readRecords(workDir).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PackError);
    expect((error as Error).message.startsWith('File non valido: ')).toBe(true);
  });
});

describe('writeRecord', () => {
  it('writes the record under converted/<code>.json with a final newline', async () => {
    const record = makeAccepted('C001');
    await writeRecord(workDir, record);

    const text = fs.readFileSync(path.join(workDir, 'converted', 'C001.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(record);
  });
});

describe('readWorkState', () => {
  it('reads candidates, the checked codes of selection.md and the records', async () => {
    const candidates = [
      makeCandidate('P001', 'primi', true),
      makeCandidate('P002', 'primi', true),
      makeCandidate('S001', 'secondi', true),
    ];
    await writeJsonFile(workPaths(workDir).candidates, { candidates });
    fs.writeFileSync(workPaths(workDir).selection, renderSelection(candidates), 'utf8');
    await writeRecord(workDir, makeAccepted('P001'));

    const state = await readWorkState(workDir);
    expect([...state.candidates.keys()]).toEqual(['P001', 'P002', 'S001']);
    expect(state.candidates.get('S001')).toEqual(candidates[2]);
    expect(state.checkedByGroup).toEqual({ ...EMPTY_GROUPS, primi: ['P001', 'P002'], secondi: ['S001'] });
    expect([...state.records.keys()]).toEqual(['P001']);
  });

  it('throws the "pnpm recipes:pack select" hint when candidates.json is missing', async () => {
    await expect(readWorkState(workDir)).rejects.toThrow('lancia prima "pnpm recipes:pack select"');
  });
});

describe('acceptedByGroup', () => {
  const candidates = new Map<string, PackCandidate>(
    ['P001', 'P002', 'P003', 'P004', 'P005'].map((code): [string, PackCandidate] => [
      code,
      makeCandidate(code, 'primi', true),
    ])
  );

  function stateWith(checkedPrimi: string[], records: PackConversionRecord[]): PackWorkState {
    return {
      candidates,
      checkedByGroup: { ...EMPTY_GROUPS, primi: checkedPrimi },
      records: new Map<string, PackConversionRecord>(
        records.map((record): [string, PackConversionRecord] => [record.code, record])
      ),
    };
  }

  it('keeps the accepted records in selection order, skipping rejected and unconverted codes', () => {
    const state = stateWith(
      ['P001', 'P002', 'P003', 'P004', 'P005'],
      [
        makeAccepted('P001', ['avviso di prova']),
        makeRejected('P002', ['portata non adatta al gruppo Primi: contorno']),
        makeAccepted('P004'),
        makeAccepted('P005'),
      ]
    );

    const result = acceptedByGroup(state, { ...PACK_GROUP_QUOTAS, primi: 10 });
    expect(result.primi.map((entry) => entry.code)).toEqual(['P001', 'P004', 'P005']);
    expect(result.primi[0]).toEqual({
      code: 'P001',
      candidate: candidates.get('P001'),
      recipe: makeAccepted('P001').recipe,
      warnings: ['avviso di prova'],
    });
  });

  it('stops at the quota even when more recipes are accepted', () => {
    const state = stateWith(
      ['P001', 'P002', 'P003', 'P004', 'P005'],
      [
        makeAccepted('P001'),
        makeRejected('P002', ['errore']),
        makeAccepted('P004'),
        makeAccepted('P005'),
      ]
    );

    const result = acceptedByGroup(state, { ...PACK_GROUP_QUOTAS, primi: 2 });
    expect(result.primi.map((entry) => entry.code)).toEqual(['P001', 'P004']);
  });

  it('follows the order of selection.md, not the order of the records', () => {
    const state = stateWith(['P005', 'P001'], [makeAccepted('P001'), makeAccepted('P005')]);

    const result = acceptedByGroup(state, { ...PACK_GROUP_QUOTAS, primi: 2 });
    expect(result.primi.map((entry) => entry.code)).toEqual(['P005', 'P001']);
  });

  it('returns fewer recipes than the quota when not enough are accepted', () => {
    const state = stateWith(['P001', 'P002'], [makeAccepted('P001')]);

    const result = acceptedByGroup(state, { ...PACK_GROUP_QUOTAS, primi: 5 });
    expect(result.primi.map((entry) => entry.code)).toEqual(['P001']);
    expect(result.secondi).toEqual([]);
  });

  it('skips an accepted record that has no recipe', () => {
    const state = stateWith(
      ['P001', 'P002'],
      [{ ...makeAccepted('P001'), recipe: null }, makeAccepted('P002')]
    );

    const result = acceptedByGroup(state, { ...PACK_GROUP_QUOTAS, primi: 5 });
    expect(result.primi.map((entry) => entry.code)).toEqual(['P002']);
  });
});
