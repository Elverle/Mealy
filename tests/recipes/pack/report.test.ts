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
  type PackStats,
} from '@/lib/domain/types';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';
import { workPaths } from '@/lib/recipes/pack/paths';
import { renderReport, writeReport, type ReportInput } from '@/lib/recipes/pack/report';
import type { PackWorkState } from '@/lib/recipes/pack/state';

const GENERATED_AT = new Date('2026-10-23T10:00:00.000Z');
const EMPTY_GROUPS: Record<PackGroup, string[]> = {
  primi: [],
  secondi: [],
  'piatti-unici': [],
  contorni: [],
};

const STATS: PackStats = {
  total: 3,
  by_course: { 'piatto-unico': 1, primo: 1, secondo: 1, contorno: 0 },
  by_meal_type: { pranzo: 3, cena: 2 },
  by_diet: { vegetariano: 1, vegano: 0, 'senza-glutine': 0, 'senza-lattosio': 0, pescetariano: 0 },
  by_main_ingredient: { carne: 2, pesce: 0, legumi: 0, uova: 0, formaggi: 1, verdure: 0 },
  prep_minutes: { up_to_30: 1, up_to_60: 1, up_to_120: 0, over_120: 1 },
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-pack-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeCandidate(code: string, group: PackGroup, title: string, checked = true): PackCandidate {
  return {
    code,
    group,
    main_ingredient: 'verdure',
    dataset_index: code.slice(1),
    link: `https://example.test/${code}`,
    title,
    category: 'Primi piatti',
    servings: 4,
    ingredients: [['Farina', '500g']],
    procedure: 'Impasta la farina con acqua e lascia riposare la pasta per mezz ora in frigo.',
    measured_count: 1,
    score: 2,
    checked,
  };
}

function accepted(code: string, title: string, warnings: string[] = []): PackConversionRecord {
  return {
    code,
    status: 'accepted',
    recipe: makeGeneratedRecipe({ title }),
    errors: [],
    warnings,
    model: 'modello-di-prova',
    converted_at: GENERATED_AT.toISOString(),
  };
}

function rejected(code: string, errors: string[]): PackConversionRecord {
  return {
    code,
    status: 'rejected',
    recipe: null,
    errors,
    warnings: [],
    model: 'modello-di-prova',
    converted_at: GENERATED_AT.toISOString(),
  };
}

/**
 * Primi: P001 accettata con avviso, P002 scartata, P003 spuntata senza record, P004 accettata
 * oltre la quota di test. P009 ha un record ma non è spuntata. Piatti unici: nessuna ricetta.
 */
function buildState(): PackWorkState {
  const candidates: PackCandidate[] = [
    makeCandidate('P001', 'primi', 'Pasta al pomodoro'),
    makeCandidate('P002', 'primi', 'Titolo scartato'),
    makeCandidate('P003', 'primi', 'Senza conversione'),
    makeCandidate('P004', 'primi', 'Pasta alla norma'),
    makeCandidate('P009', 'primi', 'Non spuntata', false),
  ];
  const records: PackConversionRecord[] = [
    accepted('P001', 'Pasta al pomodoro', ['quantità di "Farina": "500g" → 300 g']),
    rejected('P002', ['portata non adatta al gruppo Primi: contorno']),
    accepted('P004', 'Pasta alla norma'),
    accepted('P009', 'Non spuntata'),
  ];
  return {
    candidates: new Map(candidates.map((candidate): [string, PackCandidate] => [candidate.code, candidate])),
    checkedByGroup: { ...EMPTY_GROUPS, primi: ['P001', 'P002', 'P003', 'P004'] },
    records: new Map(records.map((record): [string, PackConversionRecord] => [record.code, record])),
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return { state: buildState(), stats: null, generatedAt: GENERATED_AT, ...overrides };
}

describe('renderReport', () => {
  it('starts with the title and the generation date', () => {
    const text = renderReport(input());
    expect(text).toContain(
      '# Pacchetto di ricette — report\n\nGenerato il 2026-10-23T10:00:00.000Z.\n\n## Primi'
    );
  });

  it('shows the accepted recipe with its link and warning', () => {
    const text = renderReport(input());
    expect(text).toContain('## Primi — accettate 2/50');
    expect(text).toContain('- P001 · Pasta al pomodoro · https://example.test/P001');
    expect(text).toContain('  - avviso: quantità di "Farina": "500g" → 300 g');
  });

  it('shows the rejected candidate with its errors', () => {
    const text = renderReport(input());
    expect(text).toContain('- P002 · Titolo scartato · https://example.test/P002');
    expect(text).toContain('  - portata non adatta al gruppo Primi: contorno');
  });

  it('lists only checked codes that have a record', () => {
    const text = renderReport(input());
    expect(text).not.toContain('P003');
    expect(text).not.toContain('P009');
  });

  it('lists accepted recipes beyond the quota and shows the quota in the header', () => {
    const text = renderReport(input({ quotas: { ...PACK_GROUP_QUOTAS, primi: 1 } }));
    expect(text).toContain('## Primi — accettate 2/1');
    expect(text).toContain('- P004 · Pasta alla norma · https://example.test/P004');
  });

  it('writes "Nessuna." in each empty section of a group without recipes', () => {
    const text = renderReport(input());
    expect(text).toContain(
      '## Piatti unici — accettate 0/40\n\n### Accettate\n\nNessuna.\n\n### Scartate\n\nNessuna.'
    );
  });

  it('omits the statistics when stats is null', () => {
    expect(renderReport(input())).not.toContain('## Statistiche');
  });

  it('adds the statistics tables with their totals when stats is given', () => {
    const text = renderReport(input({ stats: STATS }));
    expect(text).toContain('\n\n## Statistiche\n\nRicette: 3\n\n| Portata | Ricette |\n|---|---|\n');
    expect(text).toContain('| Piatto unico | 1 |');
    expect(text).toContain('| Contorno | 0 |');
    expect(text).toContain('| Pasto | Ricette |\n|---|---|\n| Pranzo | 3 |\n| Cena | 2 |');
    expect(text).toContain('| Dieta | Ricette |');
    expect(text).toContain('| Vegetariano | 1 |');
    expect(text).toContain('| Ingrediente principale | Ricette |');
    expect(text).toContain('| carne | 2 |');
    expect(text).toContain('| Minuti | Ricette |');
    expect(text).toContain('| fino a 30 | 1 |');
    expect(text).toContain('| 31–60 | 1 |');
    expect(text).toContain('| oltre 120 | 1 |');
  });

  it('ends with a single newline', () => {
    const text = renderReport(input({ stats: STATS }));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('writeReport', () => {
  it('creates the work folder and writes the report at workPaths(workDir).report', async () => {
    const workDir = path.join(dir, 'nested', '.recipe-pack');
    const reportInput = input({ stats: STATS });

    await writeReport(workDir, reportInput);

    const written = fs.readFileSync(workPaths(workDir).report, 'utf8');
    expect(written).toBe(renderReport(reportInput));
  });
});
