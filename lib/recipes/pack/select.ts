// Selezione per regola dei candidati del pacchetto (Feature 10) e lettura della revisione.

import fs from 'node:fs/promises';
import {
  PACK_GROUP_CODES,
  PACK_GROUP_LABELS,
  PACK_GROUP_QUOTAS,
  PACK_GROUP_VALUES,
  PACK_MAIN_INGREDIENT_VALUES,
  PackCandidatesFileSchema,
  type PackCandidate,
  type PackDatasetRow,
  type PackGroup,
  type PackMainIngredient,
} from '@/lib/domain/types';
import { areTitlesSimilar } from '@/lib/domain/title-similarity';
import { PackError } from './errors';
import { readJsonFile, writeJsonFile } from './files';
import {
  datasetWords,
  normalizeDatasetText,
  parseDatasetQuantity,
  parsePairList,
  readDatasetRows,
} from './dataset';
import { workPaths } from './paths';

const UTF8 = 'utf8';
const NOT_FOUND = 'ENOENT';
const CODE_DIGITS = 3;
const CHECKED_FACTOR = 1.5;
const SELECTION_FACTOR = 2;
const MIN_PAIRS = 2;
const MIN_PROCEDURE_LENGTH = 200;
const MIN_SERVINGS = 2;
const MAX_SERVINGS = 8;
const MAX_MEASURED_INGREDIENTS = 10;
const PROCEDURE_CHARS_PER_SCORE_POINT = 500;
const NO_CANDIDATES = 'Nessun candidato.';

type MainIngredientKey = Exclude<PackMainIngredient, 'verdure'>;
type Queued = Omit<PackCandidate, 'code' | 'checked'>;
type MainQueues = Record<PackMainIngredient, Queued[]>;

export const CATEGORY_TO_GROUP: Readonly<Record<string, PackGroup>> = {
  'Primi piatti': 'primi',
  'Secondi piatti': 'secondi',
  'Piatti Unici': 'piatti-unici',
  'Torte salate': 'piatti-unici',
  Insalate: 'piatti-unici',
  Contorni: 'contorni',
};

export const EXCLUDED_KEYWORDS: readonly string[] = [
  'bimby',
  'planetaria',
  'impastatrice',
  'barbecue',
  'gelatiera',
  'slow cooker',
  'macchina del pane',
  'essiccatore',
];

export const MAIN_INGREDIENT_KEYWORDS: Readonly<Record<MainIngredientKey, readonly string[]>> = {
  carne: [
    'manzo',
    'vitello',
    'maiale',
    'pollo',
    'tacchino',
    'coniglio',
    'agnello',
    'anatra',
    'faraona',
    'salsiccia',
    'salsicce',
    'pancetta',
    'guanciale',
    'prosciutto',
    'speck',
    'bresaola',
    'mortadella',
    'salame',
    'wurstel',
    'cotechino',
    'lonza',
    'arista',
    'costine',
    'macinato',
    'carne',
  ],
  pesce: [
    'pesce',
    'tonno',
    'salmone',
    'merluzzo',
    'baccala',
    'nasello',
    'platessa',
    'sogliola',
    'orata',
    'branzino',
    'spigola',
    'trota',
    'sgombro',
    'alici',
    'acciughe',
    'gamberi',
    'gamberetti',
    'scampi',
    'cozze',
    'vongole',
    'calamari',
    'seppie',
    'totani',
    'polpo',
    'surimi',
    'bottarga',
  ],
  legumi: ['ceci', 'lenticchie', 'fagioli', 'piselli', 'fave', 'cicerchie', 'edamame', 'tofu'],
  uova: ['uovo', 'uova', 'tuorlo', 'tuorli', 'albume', 'albumi'],
  formaggi: [
    'formaggio',
    'mozzarella',
    'fiordilatte',
    'burrata',
    'ricotta',
    'parmigiano',
    'grana',
    'pecorino',
    'gorgonzola',
    'scamorza',
    'provola',
    'fontina',
    'stracchino',
    'robiola',
    'taleggio',
    'asiago',
    'emmental',
    'feta',
    'mascarpone',
    'caciocavallo',
    'quartirolo',
    'brie',
  ],
};

export const MAIN_INGREDIENT_PRECEDENCE: readonly MainIngredientKey[] = [
  'carne',
  'pesce',
  'legumi',
  'uova',
  'formaggi',
];

export const PICK_SEQUENCE: readonly PackMainIngredient[] = [
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
];

export const SPOON_KEYWORDS: readonly string[] = [
  'olio',
  'aceto',
  'burro',
  'parmigiano',
  'grana',
  'pecorino',
  'zucchero',
  'farina',
  'pangrattato',
  'vino',
  'latte',
  'panna',
  'brodo',
  'soia',
  'miele',
  'capperi',
];

/** Spunte iniziali: 1.5 volte la quota. */
export function checkedCount(group: PackGroup): number {
  return Math.ceil(CHECKED_FACTOR * PACK_GROUP_QUOTAS[group]);
}

/** Candidati massimi per gruppo: 2 volte la quota. */
export function selectionLimit(group: PackGroup): number {
  return SELECTION_FACTOR * PACK_GROUP_QUOTAS[group];
}

/** Ingrediente principale dalle parole intere dei nomi; "verdure" se nessuna parola chiave. */
export function mainIngredientOf(names: readonly string[]): PackMainIngredient {
  const words = new Set(names.flatMap((name) => datasetWords(name)));
  const group = MAIN_INGREDIENT_PRECEDENCE.find((main) =>
    MAIN_INGREDIENT_KEYWORDS[main].some((keyword) => words.has(keyword))
  );
  return group ?? 'verdure';
}

/** Ingrediente che si misura in cucchiai o cucchiaini. */
export function isSpoonLikely(name: string): boolean {
  return datasetWords(name).some((word) => SPOON_KEYWORDS.includes(word));
}

export type RowEvaluation =
  | { ok: true; candidate: Omit<PackCandidate, 'code' | 'checked'> }
  | { ok: false; reason: string };

function reject(reason: string): RowEvaluation {
  return { ok: false, reason };
}

/** Valuta una riga del dataset: il primo controllo che fallisce dà il motivo dello scarto. */
export function evaluateRow(row: PackDatasetRow): RowEvaluation {
  const category = row.category.trim();
  if (!Object.hasOwn(CATEGORY_TO_GROUP, category)) return reject('categoria');
  const group = CATEGORY_TO_GROUP[category];

  const pairs = parsePairList(row.ingredients);
  if (pairs === null || pairs.length < MIN_PAIRS) return reject('ingredienti');

  const procedure = row.steps.trim();
  if (procedure.length < MIN_PROCEDURE_LENGTH) return reject('procedimento');

  const servingsText = row.servings.trim();
  const servings = Number(servingsText);
  if (!/^\d+$/.test(servingsText) || servings < MIN_SERVINGS || servings > MAX_SERVINGS) {
    return reject('persone');
  }

  const readings = pairs.map(([, quantity]) => parseDatasetQuantity(quantity));
  if (readings.some((reading) => reading.kind === 'invalid')) return reject('quantità');

  const measuredCount = readings.filter((reading) => reading.kind === 'measure').length;
  if (measuredCount > MAX_MEASURED_INGREDIENTS) return reject('troppi ingredienti');

  const text = normalizeDatasetText(`${row.title} ${row.steps}`);
  if (EXCLUDED_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return reject('elettrodomestico');
  }

  return {
    ok: true,
    candidate: {
      group,
      main_ingredient: mainIngredientOf(pairs.map(([name]) => name)),
      dataset_index: row.index.trim(),
      link: row.link.trim(),
      title: row.title.trim(),
      category,
      servings,
      ingredients: pairs,
      procedure,
      measured_count: measuredCount,
      score: measuredCount + Math.ceil(procedure.length / PROCEDURE_CHARS_PER_SCORE_POINT),
    },
  };
}

function perGroup<T>(make: (group: PackGroup) => T): Record<PackGroup, T> {
  return {
    primi: make('primi'),
    secondi: make('secondi'),
    'piatti-unici': make('piatti-unici'),
    contorni: make('contorni'),
  };
}

function emptyMainQueues(): MainQueues {
  return { carne: [], pesce: [], legumi: [], uova: [], formaggi: [], verdure: [] };
}

function isNumeric(text: string): boolean {
  return text.trim() !== '' && !Number.isNaN(Number(text));
}

// Punteggio crescente; a parità, indice del dataset crescente.
function compareQueued(a: Queued, b: Queued): number {
  if (a.score !== b.score) return a.score - b.score;
  if (isNumeric(a.dataset_index) && isNumeric(b.dataset_index)) {
    return Number(a.dataset_index) - Number(b.dataset_index);
  }
  return a.dataset_index.localeCompare(b.dataset_index);
}

// Prima riga della coda che non ha un titolo simile a uno già scelto; le altre si scartano.
function takeFirstDistinct(queue: Queued[], picked: readonly PackCandidate[]): Queued | undefined {
  let next = queue.shift();
  while (next !== undefined) {
    const { title } = next;
    if (!picked.some((candidate) => areTitlesSimilar(candidate.title, title))) return next;
    next = queue.shift();
  }
  return undefined;
}

/** Sceglie i candidati per gruppo, variando l'ingrediente principale secondo PICK_SEQUENCE. */
export function selectCandidates(rows: readonly PackDatasetRow[]): {
  candidates: PackCandidate[];
  available: Record<PackGroup, number>;
} {
  const queues = perGroup(() => emptyMainQueues());
  const available = perGroup(() => 0);

  for (const row of rows) {
    const evaluation = evaluateRow(row);
    if (!evaluation.ok) continue;
    const { candidate } = evaluation;
    queues[candidate.group][candidate.main_ingredient].push(candidate);
    available[candidate.group]++;
  }

  for (const group of PACK_GROUP_VALUES) {
    for (const main of PACK_MAIN_INGREDIENT_VALUES) {
      queues[group][main].sort(compareQueued);
    }
  }

  const picked: PackCandidate[] = [];
  for (const group of PACK_GROUP_VALUES) {
    const groupQueues = queues[group];
    const limit = selectionLimit(group);
    let n = 0;
    let slot = 0;
    while (
      n < limit &&
      PACK_MAIN_INGREDIENT_VALUES.some((main) => groupQueues[main].length > 0)
    ) {
      const main = PICK_SEQUENCE[slot % PICK_SEQUENCE.length];
      slot++;
      const next = takeFirstDistinct(groupQueues[main], picked);
      if (next !== undefined) {
        picked.push({
          ...next,
          code: PACK_GROUP_CODES[group] + String(n + 1).padStart(CODE_DIGITS, '0'),
          checked: n < checkedCount(group),
        });
        n++;
      }
    }
  }

  return { candidates: picked, available };
}

function candidateLine(candidate: PackCandidate): string {
  const box = candidate.checked ? 'x' : ' ';
  return `- [${box}] ${candidate.code} · ${candidate.title} · ${candidate.measured_count} ingredienti · ${candidate.main_ingredient}`;
}

/** Testo di selection.md: spuntati per gruppo, riserve sotto "### Riserve". */
export function renderSelection(candidates: readonly PackCandidate[]): string {
  const lines = [
    '# Pacchetto di ricette — selezione',
    '',
    'Togli la spunta (`[ ]`) o cancella la riga delle ricette che non vuoi.',
    'Spunta una riserva (`[x]`) per aggiungerla.',
    "L'ordine conta: per ogni gruppo si convertono le righe spuntate dall'alto, fino alla quota.",
  ];

  for (const group of PACK_GROUP_VALUES) {
    const inGroup = candidates
      .filter((candidate) => candidate.group === group)
      .sort((a, b) => a.code.localeCompare(b.code));
    lines.push('', `## ${PACK_GROUP_LABELS[group]} — quota ${PACK_GROUP_QUOTAS[group]}`, '');

    if (inGroup.length === 0) {
      lines.push(NO_CANDIDATES);
      continue;
    }

    lines.push(...inGroup.filter((candidate) => candidate.checked).map(candidateLine));
    const reserves = inGroup.filter((candidate) => !candidate.checked);
    if (reserves.length > 0) {
      lines.push('', '### Riserve', '', ...reserves.map(candidateLine));
    }
  }

  return `${lines.join('\n')}\n`;
}

function emptyGroups(): Record<PackGroup, string[]> {
  return perGroup((): string[] => []);
}

/** Codici spuntati in selection.md, per gruppo, nell'ordine del file. */
export function parseSelection(
  markdown: string,
  candidates: readonly PackCandidate[]
): Record<PackGroup, string[]> {
  const byCode = new Map(candidates.map((candidate) => [candidate.code, candidate]));
  const result = emptyGroups();
  const seen = new Set<string>();

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s*- \[([ xX])\]\s+([PSUC]\d{3})\b/.exec(line);
    if (match === null || match[1] === ' ') continue;

    const code = match[2];
    const candidate = byCode.get(code);
    if (candidate === undefined) {
      throw new PackError(`Codice sconosciuto in selection.md: ${code}`);
    }
    if (seen.has(code)) continue;

    seen.add(code);
    result[candidate.group].push(code);
  }

  return result;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === NOT_FOUND;
}

function missingWorkFile(filePath: string, step: string): PackError {
  return new PackError(`Manca ${filePath}: lancia prima "pnpm recipes:pack ${step}".`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** Legge candidates.json (scritto da select) con validazione dello schema. */
export async function readCandidates(workDir: string): Promise<PackCandidate[]> {
  const paths = workPaths(workDir);
  const file = await readJsonFile(paths.candidates, PackCandidatesFileSchema, () => {
    throw missingWorkFile(paths.candidates, 'select');
  });
  return file.candidates;
}

/** Legge la revisione di selection.md e restituisce i codici spuntati per gruppo. */
export async function readSelection(
  workDir: string,
  candidates: readonly PackCandidate[]
): Promise<Record<PackGroup, string[]>> {
  const { selection } = workPaths(workDir);
  let markdown: string;
  try {
    markdown = await fs.readFile(selection, UTF8);
  } catch (error) {
    if (isNotFound(error)) throw missingWorkFile(selection, 'select');
    throw error;
  }
  return parseSelection(markdown, candidates);
}

export interface SelectOptions {
  csvPath: string;
  workDir: string;
  force: boolean;
}

export interface SelectReport {
  groups: Record<PackGroup, { checked: number; reserves: number; available: number }>;
  warnings: string[];
}

function buildReport(
  candidates: readonly PackCandidate[],
  available: Record<PackGroup, number>
): SelectReport {
  const warnings: string[] = [];
  const groups = perGroup((group) => {
    const inGroup = candidates.filter((candidate) => candidate.group === group);
    const checked = inGroup.filter((candidate) => candidate.checked).length;
    if (inGroup.length < checkedCount(group)) {
      warnings.push(
        `${PACK_GROUP_LABELS[group]}: solo ${inGroup.length} candidati, meno dei ${checkedCount(group)} previsti.`
      );
    }
    return { checked, reserves: inGroup.length - checked, available: available[group] };
  });
  return { groups, warnings };
}

/** Legge il dataset, sceglie i candidati e scrive candidates.json e selection.md. */
export async function runSelect(options: SelectOptions): Promise<SelectReport> {
  const { csvPath, workDir, force } = options;
  const paths = workPaths(workDir);

  if (!force && (await fileExists(paths.selection))) {
    throw new PackError(
      `Esiste già ${paths.selection}: per rifare la selezione, e perdere la revisione, usa --force.`
    );
  }

  let csv: string;
  try {
    csv = await fs.readFile(csvPath, UTF8);
  } catch (error) {
    if (isNotFound(error)) throw new PackError(`File del dataset non trovato: ${csvPath}`);
    throw error;
  }

  const { candidates, available } = selectCandidates(readDatasetRows(csv));

  await fs.mkdir(workDir, { recursive: true });
  await writeJsonFile(paths.candidates, { candidates });
  await fs.writeFile(paths.selection, renderSelection(candidates), UTF8);

  return buildReport(candidates, available);
}
