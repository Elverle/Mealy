// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { parsePackCommand, PACK_USAGE } from '@/lib/recipes/pack/command';
import { isPackError } from '@/lib/recipes/pack/errors';
import { DEFAULT_CSV_PATH } from '@/lib/recipes/pack/paths';

const STEPS_LIST = 'select, convert, ingredients, build, load';

function errorMessageOf(argv: readonly string[]): string {
  try {
    parsePackCommand(argv);
  } catch (err) {
    if (isPackError(err)) return err.message;
    throw err;
  }
  throw new Error(`nessun errore per ${argv.join(' ')}`);
}

describe('parsePackCommand: passi validi', () => {
  it('select senza opzioni usa il dataset di default e non forza', () => {
    expect(parsePackCommand(['select'])).toEqual({
      step: 'select',
      csvPath: DEFAULT_CSV_PATH,
      force: false,
    });
  });

  it('select con --csv e --force', () => {
    expect(parsePackCommand(['select', '--csv', 'altro.csv', '--force'])).toEqual({
      step: 'select',
      csvPath: 'altro.csv',
      force: true,
    });
  });

  it('convert senza opzioni usa concorrenza 3 e non ritenta gli scartati', () => {
    expect(parsePackCommand(['convert'])).toEqual({
      step: 'convert',
      concurrency: 3,
      retryRejected: false,
    });
  });

  it('convert con --concurrency e --retry-rejected', () => {
    expect(parsePackCommand(['convert', '--concurrency', '5', '--retry-rejected'])).toEqual({
      step: 'convert',
      concurrency: 5,
      retryRejected: true,
    });
  });

  it('convert accetta gli estremi 1 e 5 della concorrenza', () => {
    expect(parsePackCommand(['convert', '--concurrency', '1'])).toMatchObject({ concurrency: 1 });
    expect(parsePackCommand(['convert', '--concurrency', '5'])).toMatchObject({ concurrency: 5 });
  });

  it('ingredients senza e con --approve', () => {
    expect(parsePackCommand(['ingredients'])).toEqual({ step: 'ingredients', approve: false });
    expect(parsePackCommand(['ingredients', '--approve'])).toEqual({
      step: 'ingredients',
      approve: true,
    });
  });

  it('build e load non hanno opzioni', () => {
    expect(parsePackCommand(['build'])).toEqual({ step: 'build' });
    expect(parsePackCommand(['load'])).toEqual({ step: 'load' });
  });
});

describe('parsePackCommand: passo', () => {
  it('nessun passo stampa l\'errore con l\'elenco dei passi e l\'uso', () => {
    expect(errorMessageOf([])).toBe(
      `Passo sconosciuto: "". Passi: ${STEPS_LIST}.\n${PACK_USAGE}`
    );
  });

  it('un passo sconosciuto stampa il messaggio esatto', () => {
    expect(errorMessageOf(['deploy'])).toBe(
      `Passo sconosciuto: "deploy". Passi: ${STEPS_LIST}.\n${PACK_USAGE}`
    );
  });

  it('più posizionali stampano i passi uniti da spazio come passo sconosciuto', () => {
    expect(errorMessageOf(['select', 'build'])).toBe(
      `Passo sconosciuto: "select build". Passi: ${STEPS_LIST}.\n${PACK_USAGE}`
    );
  });
});

describe('parsePackCommand: opzioni', () => {
  it('un\'opzione sconosciuta stampa "Opzione non valida" con l\'uso', () => {
    const message = errorMessageOf(['select', '--verbose']);
    expect(message.startsWith('Opzione non valida: ')).toBe(true);
    expect(message.endsWith(`\n${PACK_USAGE}`)).toBe(true);
  });

  it('--force con build è rifiutato con il messaggio esatto', () => {
    expect(errorMessageOf(['build', '--force'])).toBe(
      "L'opzione --force vale solo per select."
    );
  });

  it('--approve con select è rifiutato indicando ingredients', () => {
    expect(errorMessageOf(['select', '--approve'])).toBe(
      "L'opzione --approve vale solo per ingredients."
    );
  });

  it('--concurrency con ingredients è rifiutato indicando convert', () => {
    expect(errorMessageOf(['ingredients', '--concurrency', '2'])).toBe(
      "L'opzione --concurrency vale solo per convert."
    );
  });

  it.each(['0', '6', 'abc', '2.5'])('--concurrency %s è rifiutato con il messaggio esatto', (value) => {
    expect(errorMessageOf(['convert', '--concurrency', value])).toBe(
      '--concurrency deve essere un intero tra 1 e 5.'
    );
  });
});

describe('PACK_USAGE', () => {
  it('elenca i passi e le loro opzioni', () => {
    expect(PACK_USAGE).toBe(
      [
        'Uso: pnpm recipes:pack <passo> [opzioni]',
        '  select [--csv <percorso>] [--force]',
        '  convert [--concurrency <1-5>] [--retry-rejected]',
        '  ingredients [--approve]',
        '  build',
        '  load',
      ].join('\n')
    );
  });
});
