// Parsing degli argomenti di `pnpm recipes:pack` (Feature 10). Puro: non importa servizi.

import { parseArgs } from 'node:util';
import { PackError } from './errors';
import { DEFAULT_CSV_PATH } from './paths';

export const PACK_STEPS = ['select', 'convert', 'ingredients', 'build', 'load'] as const;
export type PackStep = (typeof PACK_STEPS)[number];

export type PackCommand =
  | { step: 'select'; csvPath: string; force: boolean }
  | { step: 'convert'; concurrency: number; retryRejected: boolean }
  | { step: 'ingredients'; approve: boolean }
  | { step: 'build' }
  | { step: 'load' };

const DEFAULT_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

export const PACK_USAGE = [
  'Uso: pnpm recipes:pack <passo> [opzioni]',
  '  select [--csv <percorso>] [--force]',
  '  convert [--concurrency <1-5>] [--retry-rejected]',
  '  ingredients [--approve]',
  '  build',
  '  load',
].join('\n');

const PACK_OPTIONS = {
  csv: { type: 'string' },
  force: { type: 'boolean' },
  concurrency: { type: 'string' },
  'retry-rejected': { type: 'boolean' },
  approve: { type: 'boolean' },
} as const;

/** Passo a cui appartiene ogni opzione. */
const OPTION_STEP: Readonly<Record<keyof typeof PACK_OPTIONS, PackStep>> = {
  csv: 'select',
  force: 'select',
  concurrency: 'convert',
  'retry-rejected': 'convert',
  approve: 'ingredients',
};

function isPackStep(value: string): value is PackStep {
  return (PACK_STEPS as readonly string[]).includes(value);
}

function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_CONCURRENCY;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_CONCURRENCY || value > MAX_CONCURRENCY) {
    throw new PackError(
      `--concurrency deve essere un intero tra ${MIN_CONCURRENCY} e ${MAX_CONCURRENCY}.`
    );
  }
  return value;
}

function readArgs(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: PACK_OPTIONS,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new PackError(`Opzione non valida: ${reason}\n${PACK_USAGE}`);
  }
}

/** Legge gli argomenti dopo `tsx scripts/recipe-pack.ts`. Lancia PackError con il messaggio da stampare. */
export function parsePackCommand(argv: readonly string[]): PackCommand {
  const { values, positionals } = readArgs(argv);
  const stepName = positionals.join(' ');
  if (!isPackStep(stepName)) {
    throw new PackError(
      `Passo sconosciuto: "${stepName}". Passi: ${PACK_STEPS.join(', ')}.\n${PACK_USAGE}`
    );
  }

  for (const name of Object.keys(OPTION_STEP) as (keyof typeof PACK_OPTIONS)[]) {
    if (values[name] !== undefined && OPTION_STEP[name] !== stepName) {
      throw new PackError(`L'opzione --${name} vale solo per ${OPTION_STEP[name]}.`);
    }
  }

  switch (stepName) {
    case 'select':
      return {
        step: 'select',
        csvPath: values.csv ?? DEFAULT_CSV_PATH,
        force: values.force ?? false,
      };
    case 'convert':
      return {
        step: 'convert',
        concurrency: parseConcurrency(values.concurrency),
        retryRejected: values['retry-rejected'] ?? false,
      };
    case 'ingredients':
      return { step: 'ingredients', approve: values.approve ?? false };
    case 'build':
      return { step: 'build' };
    case 'load':
      return { step: 'load' };
  }
}
