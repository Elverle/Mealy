// Tabella degli ingredienti del pacchetto (Feature 10): bozza del modello, revisione e approvazione.
// Lettura e scrittura su file; il modello è chiamato solo se mancano voci. Non importa il DB.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import {
  PACK_DRAFT_BATCH_SIZE,
  PACK_GROUP_QUOTAS,
  PACK_GROUP_VALUES,
  PackIngredientsFileSchema,
  type PackGroup,
  type PackIngredientFact,
  type PackIngredientFactDraft,
} from '@/lib/domain/types';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import { draftIngredientFacts, getModel, isLlmError } from '@/lib/llm';
import { readJsonFile } from './files';
import { PACK_INGREDIENTS_FILE_PATH, workPaths } from './paths';
import { acceptedByGroup, readWorkState, type AcceptedRecipe } from './state';

const UTF8 = 'utf8';
const REVIEW_TITLES_SHOWN = 3;
const NO_REVIEW_ROWS = 'Nessuna voce da rivedere.';
const REVIEW_HEADER = [
  '| Nome | Reparto | Carne | Pesce | Latticini | Uova | Miele | Glutine | Ricette |',
  '|---|---|---|---|---|---|---|---|---|',
];

export interface IngredientsOptions {
  workDir: string;
  /** Default PACK_INGREDIENTS_FILE_PATH. */
  ingredientsFile?: string;
  approve: boolean;
  model?: LanguageModel; // default getModel(), solo se servono bozze
  logger?: Pick<Console, 'warn'>;
  draft?: typeof draftIngredientFacts;
  /** Default PACK_GROUP_QUOTAS (solo i test lo cambiano). */
  quotas?: Readonly<Record<PackGroup, number>>;
}

export interface IngredientsReport {
  used: number;
  added: number;
  unreviewed: number;
  missing: string[];
  approved: number;
}

/** Testo della tabella: voci ordinate per nome, una per riga, con le chiavi in ordine fisso. */
export function formatIngredientsFile(entries: readonly PackIngredientFact[]): string {
  if (entries.length === 0) return '{\n  "ingredients": []\n}\n';

  const lines = [...entries]
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
    .map(
      (entry) =>
        '    ' +
        JSON.stringify({
          name: entry.name,
          category: entry.category,
          carne: entry.carne,
          pesce: entry.pesce,
          latticini: entry.latticini,
          uova: entry.uova,
          miele: entry.miele,
          glutine: entry.glutine,
          reviewed: entry.reviewed,
        })
    );
  return `{\n  "ingredients": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

/** Legge la tabella; file assente → lista vuota. */
export async function readIngredientsFile(filePath: string): Promise<PackIngredientFact[]> {
  const file = await readJsonFile(filePath, PackIngredientsFileSchema, () => ({ ingredients: [] }));
  return file.ingredients;
}

/** Scrive la tabella, creando la cartella se manca. */
export async function writeIngredientsFile(
  filePath: string,
  entries: readonly PackIngredientFact[]
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, formatIngredientsFile(entries), UTF8);
}

/** Ricette accettate di tutti i gruppi, nell'ordine di PACK_GROUP_VALUES e di accepted[g]. */
export function acceptedInOrder(accepted: Record<PackGroup, AcceptedRecipe[]>): AcceptedRecipe[] {
  return PACK_GROUP_VALUES.flatMap((group) => accepted[group]);
}

/** Nomi canonici normalizzati e distinti delle ricette, ordinati con 'it'. */
export function ingredientNames(recipes: readonly AcceptedRecipe[]): string[] {
  const names = new Set(
    recipes.flatMap(({ recipe }) => recipe.ingredients.map((ing) => normalizeCanonicalName(ing.canonical_name)))
  );
  return [...names].sort((a, b) => a.localeCompare(b, 'it'));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** Titoli delle ricette accettate per nome normalizzato, nell'ordine di acceptedInOrder. */
function titlesByName(recipes: readonly AcceptedRecipe[]): Map<string, string[]> {
  const titles = new Map<string, string[]>();
  for (const { recipe } of recipes) {
    const names = new Set(recipe.ingredients.map((ing) => normalizeCanonicalName(ing.canonical_name)));
    for (const name of names) {
      titles.set(name, [...(titles.get(name) ?? []), recipe.title]);
    }
  }
  return titles;
}

interface DraftDeps {
  model: LanguageModel;
  draft: typeof draftIngredientFacts;
  logger: Pick<Console, 'warn'>;
}

/** Bozze per i nomi mancanti, a lotti; un lotto che fallisce con LlmError si salta con un avviso. */
async function draftMissing(missing: readonly string[], deps: DraftDeps): Promise<PackIngredientFact[]> {
  const { model, draft, logger } = deps;
  const added: PackIngredientFact[] = [];
  const addedNames = new Set<string>();

  for (const batch of chunk(missing, PACK_DRAFT_BATCH_SIZE)) {
    const batchNames = new Set(batch);
    let drafts: PackIngredientFactDraft[];
    try {
      drafts = await draft(batch, { model });
    } catch (error) {
      if (!isLlmError(error)) throw error;
      logger.warn(
        `[pack] bozza non riuscita per ${batch.length} ingredienti: ${error.code}: ${error.message}`
      );
      continue;
    }

    for (const fact of drafts) {
      const name = normalizeCanonicalName(fact.name);
      if (!batchNames.has(name) || addedNames.has(name)) continue;
      addedNames.add(name);
      added.push({ ...fact, name, reviewed: false });
    }
  }
  return added;
}

function reviewRow(entry: PackIngredientFact, titles: readonly string[]): string {
  const flag = (value: boolean): string => (value ? 'sì' : 'no');
  const shown = titles.slice(0, REVIEW_TITLES_SHOWN).join(', ');
  const more = titles.length > REVIEW_TITLES_SHOWN ? ', …' : '';
  return `| ${entry.name} | ${entry.category} | ${flag(entry.carne)} | ${flag(entry.pesce)} | ${flag(entry.latticini)} | ${flag(entry.uova)} | ${flag(entry.miele)} | ${flag(entry.glutine)} | ${titles.length}: ${shown}${more} |`;
}

/** ingredients-review.md: le voci usate e non riviste, con le ricette che le usano. */
async function writeReview(
  workDir: string,
  ingredientsFile: string,
  unreviewed: readonly PackIngredientFact[],
  titles: Map<string, string[]>
): Promise<void> {
  const rows = [...unreviewed]
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
    .map((entry) => reviewRow(entry, titles.get(normalizeCanonicalName(entry.name)) ?? []));

  const lines = [
    '# Ingredienti da rivedere',
    '',
    `Correggi le voci in ${ingredientsFile} (reparto e attributi), poi lancia "pnpm recipes:pack ingredients --approve".`,
    '',
    ...(rows.length === 0 ? [NO_REVIEW_ROWS] : [...REVIEW_HEADER, ...rows]),
  ];

  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(workPaths(workDir).ingredientsReview, `${lines.join('\n')}\n`, UTF8);
}

/**
 * Senza `approve`: aggiunge una bozza per ogni nome delle ricette accettate senza voce, e scrive
 * la revisione. Con `approve`: marca tutte le voci come riviste, senza modello.
 */
export async function runIngredients(options: IngredientsOptions): Promise<IngredientsReport> {
  const {
    workDir,
    ingredientsFile = PACK_INGREDIENTS_FILE_PATH,
    approve,
    logger = console,
    draft = draftIngredientFacts,
    quotas = PACK_GROUP_QUOTAS,
  } = options;

  if (approve) {
    const entries = await readIngredientsFile(ingredientsFile);
    const approved = entries.map((entry) => ({ ...entry, reviewed: true }));
    await writeIngredientsFile(ingredientsFile, approved);
    return { used: 0, added: 0, unreviewed: 0, missing: [], approved: approved.length };
  }

  const state = await readWorkState(workDir);
  const recipes = acceptedInOrder(acceptedByGroup(state, quotas));
  const names = ingredientNames(recipes);
  const usedNames = new Set(names);

  const entries = await readIngredientsFile(ingredientsFile);
  const knownNames = new Set(entries.map((entry) => normalizeCanonicalName(entry.name)));
  const missing = names.filter((name) => !knownNames.has(name));

  const added =
    missing.length > 0
      ? await draftMissing(missing, {
          model: options.model ?? getModel(),
          draft,
          logger,
        })
      : [];
  const table = [...entries, ...added];
  await writeIngredientsFile(ingredientsFile, table);

  const tableNames = new Set(table.map((entry) => normalizeCanonicalName(entry.name)));
  const unreviewed = table.filter(
    (entry) => !entry.reviewed && usedNames.has(normalizeCanonicalName(entry.name))
  );
  await writeReview(workDir, ingredientsFile, unreviewed, titlesByName(recipes));

  return {
    used: names.length,
    added: added.length,
    unreviewed: unreviewed.length,
    missing: names.filter((name) => !tableNames.has(name)),
    approved: 0,
  };
}
