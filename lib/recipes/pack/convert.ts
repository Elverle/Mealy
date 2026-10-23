// Conversione del pacchetto (Feature 10): il modello riscrive le ricette selezionate, con controlli,
// memoria per candidato e concorrenza per gruppo. Non importa il DB.

import type { LanguageModel } from 'ai';
import { FIXTURE_INGREDIENT_ALIASES, FIXTURE_RECIPES } from '@/fixtures';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import { toAliasMap, type AliasMap } from '@/lib/domain/shopping-list';
import {
  PACK_GROUP_QUOTAS,
  PACK_GROUP_VALUES,
  PackIngredientsFileSchema,
  type GeneratedRecipe,
  type PackCandidate,
  type PackConversionRecord,
  type PackConvertItem,
  type PackGroup,
} from '@/lib/domain/types';
import { convertDatasetRecipe, getModel, isLlmError, readLlmConfig } from '@/lib/llm';
import { formatQuantityReading, parseDatasetQuantity } from './dataset';
import { readJsonFile } from './files';
import { PACK_INGREDIENTS_FILE_PATH } from './paths';
import { checkConversionErrors, checkConversionWarnings, postProcessConversion } from './checks';
import { writeReport } from './report';
import { readWorkState, writeRecord, type PackWorkState } from './state';

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;
const INJECTED_MODEL_NAME = 'iniettato';

export interface ConvertOptions {
  workDir: string;
  /** Chiamate al modello in parallelo dentro un gruppo, 1–5. */
  concurrency: number;
  retryRejected: boolean;
  /** Default PACK_INGREDIENTS_FILE_PATH. */
  ingredientsFile?: string;
  /** Default getModel(). */
  model?: LanguageModel;
  /** Nome salvato nei record. Default readLlmConfig().model se `model` è assente, altrimenti 'iniettato'. */
  modelName?: string;
  /** Default: console. */
  logger?: Pick<Console, 'log' | 'warn'>;
  /** Default () => new Date(). */
  now?: () => Date;
  /** Default convertDatasetRecipe. */
  convert?: typeof convertDatasetRecipe;
  /** Default PACK_GROUP_QUOTAS (solo i test lo cambiano). */
  quotas?: Readonly<Record<PackGroup, number>>;
}

export interface ConvertGroupReport {
  accepted: number;
  quota: number;
  rejected: number;
  failed: number;
}

export interface ConvertReport {
  groups: Record<PackGroup, ConvertGroupReport>;
  complete: boolean;
}

type CandidateOutcome = 'accepted' | 'rejected' | 'failed';

/** Dati condivisi da tutti i gruppi di una esecuzione di `runConvert`. */
interface ConvertRun {
  workDir: string;
  state: PackWorkState;
  model: LanguageModel;
  modelName: string;
  knownNames: string[];
  aliases: AliasMap;
  logger: Pick<Console, 'log' | 'warn'>;
  now: () => Date;
  convert: typeof convertDatasetRecipe;
  concurrency: number;
  retryRejected: boolean;
}

interface Attempt {
  recipe: GeneratedRecipe;
  errors: string[];
}

/** Nomi noti al modello: tabella degli ingredienti, alias e ingredienti delle ricette di esempio. */
export function buildKnownNames(facts: readonly { name: string }[]): string[] {
  const names = [
    ...facts.map((fact) => fact.name),
    ...FIXTURE_INGREDIENT_ALIASES.map((alias) => alias.canonical_name),
    ...FIXTURE_RECIPES.flatMap((recipe) =>
      recipe.ingredients.map((ingredient) => ingredient.canonical_name)
    ),
  ].map(normalizeCanonicalName);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'it'));
}

/** Voce per il modello: nomi e quantità del dataset, con la lettura delle quantità. */
export function toConvertItem(candidate: PackCandidate, knownNames: readonly string[]): PackConvertItem {
  return {
    title: candidate.title,
    group: candidate.group,
    servings: candidate.servings,
    ingredients: candidate.ingredients.map(([name, raw]) => ({
      name,
      raw_qty: raw,
      reading: formatQuantityReading(parseDatasetQuantity(raw)),
    })),
    procedure: candidate.procedure,
    known_names: [...knownNames],
  };
}

/** Un tentativo di conversione: ricetta normalizzata e errori che la scartano. */
async function convertOnce(
  run: ConvertRun,
  candidate: PackCandidate,
  item: PackConvertItem,
  feedback: readonly string[] | undefined
): Promise<Attempt> {
  const raw =
    feedback === undefined
      ? await run.convert(item, { model: run.model })
      : await run.convert(item, { model: run.model, feedback });
  const recipe = postProcessConversion(raw, candidate, run.aliases);
  return { recipe, errors: checkConversionErrors(recipe, candidate) };
}

/** Converte un candidato (con un secondo tentativo se il primo scarta) e scrive il suo record. */
async function convertCandidate(run: ConvertRun, candidate: PackCandidate): Promise<CandidateOutcome> {
  const { code } = candidate;
  const item = toConvertItem(candidate, run.knownNames);

  let attempt: Attempt;
  try {
    attempt = await convertOnce(run, candidate, item, undefined);
    if (attempt.errors.length > 0) {
      attempt = await convertOnce(run, candidate, item, attempt.errors);
    }
  } catch (error) {
    if (!isLlmError(error)) throw error;
    run.logger.warn(`[pack] ${code} non convertita: ${error.code}: ${error.message}`);
    return 'failed';
  }

  const base = { code, model: run.modelName, converted_at: run.now().toISOString() };
  const record: PackConversionRecord =
    attempt.errors.length === 0
      ? {
          ...base,
          status: 'accepted',
          recipe: attempt.recipe,
          errors: [],
          warnings: checkConversionWarnings(attempt.recipe, candidate),
        }
      : { ...base, status: 'rejected', recipe: null, errors: attempt.errors, warnings: [] };
  await writeRecord(run.workDir, record);
  run.state.records.set(code, record);

  if (record.status === 'accepted') {
    run.logger.log(`[pack] ${code} accettata`);
    return 'accepted';
  }
  run.logger.warn(`[pack] ${code} scartata: ${record.errors.join('; ')}`);
  return 'rejected';
}

/** Converte le righe spuntate di un gruppo, in ordine, fino a `quota` accettate. */
async function convertGroup(run: ConvertRun, group: PackGroup, quota: number): Promise<ConvertGroupReport> {
  const codes = run.state.checkedByGroup[group];
  const queue = codes.flatMap((code): PackCandidate[] => {
    const candidate = run.state.candidates.get(code);
    if (candidate === undefined) return [];
    const record = run.state.records.get(code);
    const needsWork = record === undefined || (run.retryRejected && record.status === 'rejected');
    return needsWork ? [candidate] : [];
  });

  let accepted = codes.filter((code) => run.state.records.get(code)?.status === 'accepted').length;
  let failed = 0;
  let inFlight = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    // Dopo uno scarto il parallelismo può scendere sotto `concurrency`, ma il worker che lo ha visto continua.
    while (!stopped && queue.length > 0 && accepted + inFlight < quota) {
      const candidate = queue.shift();
      if (candidate === undefined) return;
      inFlight++;
      try {
        const outcome = await convertCandidate(run, candidate);
        if (outcome === 'accepted') accepted++;
        if (outcome === 'failed') failed++;
      } catch (error) {
        // Errore non del modello: gli altri worker non avviano nuove chiamate.
        stopped = true;
        throw error;
      } finally {
        inFlight--;
      }
    }
  };
  await Promise.all(Array.from({ length: run.concurrency }, () => worker()));

  const rejected = codes.filter((code) => run.state.records.get(code)?.status === 'rejected').length;
  return { accepted, quota, rejected, failed };
}

/**
 * Converte le ricette spuntate di selection.md con il modello, gruppo per gruppo. Una ricetta con
 * record non si riconverte; con `retryRejected` si riprovano le scartate. Scrive il report.
 * Non stampa il riepilogo: lo fa il comando.
 */
export async function runConvert(options: ConvertOptions): Promise<ConvertReport> {
  const { workDir, concurrency, retryRejected } = options;
  if (!Number.isInteger(concurrency) || concurrency < MIN_CONCURRENCY || concurrency > MAX_CONCURRENCY) {
    throw new RangeError(
      `concurrency must be an integer between ${MIN_CONCURRENCY} and ${MAX_CONCURRENCY}`
    );
  }

  const logger = options.logger ?? console;
  const now = options.now ?? ((): Date => new Date());
  const convert = options.convert ?? convertDatasetRecipe;
  const quotas = options.quotas ?? PACK_GROUP_QUOTAS;
  const ingredientsFile = options.ingredientsFile ?? PACK_INGREDIENTS_FILE_PATH;

  const state = await readWorkState(workDir);
  const { ingredients: facts } = await readJsonFile(ingredientsFile, PackIngredientsFileSchema, () => ({
    ingredients: [],
  }));

  const model = options.model ?? getModel();
  const modelName =
    options.modelName ?? (options.model === undefined ? readLlmConfig().model : INJECTED_MODEL_NAME);

  const run: ConvertRun = {
    workDir,
    state,
    model,
    modelName,
    knownNames: buildKnownNames(facts),
    aliases: toAliasMap(FIXTURE_INGREDIENT_ALIASES),
    logger,
    now,
    convert,
    concurrency,
    retryRejected,
  };

  const groups = {} as Record<PackGroup, ConvertGroupReport>;
  for (const group of PACK_GROUP_VALUES) {
    groups[group] = await convertGroup(run, group, quotas[group]);
  }

  await writeReport(workDir, { state: await readWorkState(workDir), stats: null, generatedAt: now(), quotas });

  return {
    groups,
    complete: PACK_GROUP_VALUES.every((group) => groups[group].accepted >= groups[group].quota),
  };
}
