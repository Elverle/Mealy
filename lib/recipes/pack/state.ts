// Stato di lavoro del pacchetto (Feature 10): candidati, revisione, record di conversione.
// Lettura e scrittura su file; non importa il DB né l'LLM.

import fs from 'node:fs/promises';
import {
  PACK_GROUP_QUOTAS,
  PACK_GROUP_VALUES,
  PackConversionRecordSchema,
  type GeneratedRecipe,
  type PackCandidate,
  type PackConversionRecord,
  type PackGroup,
} from '@/lib/domain/types';
import { PackError } from './errors';
import { readJsonFile, writeJsonFile } from './files';
import { recordPath, workPaths } from './paths';
import { readCandidates, readSelection } from './select';

const NOT_FOUND = 'ENOENT';
const JSON_EXTENSION = '.json';

export interface PackWorkState {
  candidates: Map<string, PackCandidate>; // per codice
  checkedByGroup: Record<PackGroup, string[]>; // ordine di selection.md
  records: Map<string, PackConversionRecord>; // per codice
}

export interface AcceptedRecipe {
  code: string;
  candidate: PackCandidate;
  recipe: GeneratedRecipe;
  warnings: string[];
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === NOT_FOUND;
}

/** Record di conversione della cartella converted/, per codice; cartella assente → mappa vuota. */
export async function readRecords(workDir: string): Promise<Map<string, PackConversionRecord>> {
  const { convertedDir } = workPaths(workDir);
  let names: string[];
  try {
    names = await fs.readdir(convertedDir);
  } catch (error) {
    if (isNotFound(error)) return new Map();
    throw error;
  }

  const records = new Map<string, PackConversionRecord>();
  for (const name of names.filter((n) => n.endsWith(JSON_EXTENSION)).sort()) {
    const filePath = `${convertedDir}/${name}`;
    const record = await readJsonFile(filePath, PackConversionRecordSchema, () => {
      throw new PackError(`Manca ${filePath}`);
    });
    records.set(record.code, record);
  }
  return records;
}

/** Stato completo: candidati, revisione di selection.md e record di conversione. */
export async function readWorkState(workDir: string): Promise<PackWorkState> {
  const candidates = await readCandidates(workDir);
  const checkedByGroup = await readSelection(workDir, candidates);
  const records = await readRecords(workDir);
  return {
    candidates: new Map(candidates.map((candidate): [string, PackCandidate] => [candidate.code, candidate])),
    checkedByGroup,
    records,
  };
}

function acceptedIn(state: PackWorkState, group: PackGroup, quota: number): AcceptedRecipe[] {
  const accepted: AcceptedRecipe[] = [];
  for (const code of state.checkedByGroup[group]) {
    if (accepted.length >= quota) break;
    const candidate = state.candidates.get(code);
    const record = state.records.get(code);
    if (candidate === undefined || record === undefined) continue;
    if (record.status !== 'accepted' || record.recipe === null) continue;
    accepted.push({ code, candidate, recipe: record.recipe, warnings: record.warnings });
  }
  return accepted;
}

/** Le prime `quota` ricette accettate di ogni gruppo, nell'ordine di selection.md (meno se non bastano). */
export function acceptedByGroup(
  state: PackWorkState,
  quotas: Readonly<Record<PackGroup, number>> = PACK_GROUP_QUOTAS
): Record<PackGroup, AcceptedRecipe[]> {
  const result = {} as Record<PackGroup, AcceptedRecipe[]>;
  for (const group of PACK_GROUP_VALUES) {
    result[group] = acceptedIn(state, group, quotas[group]);
  }
  return result;
}

/** Scrive il record di conversione del candidato in converted/<codice>.json. */
export async function writeRecord(workDir: string, record: PackConversionRecord): Promise<void> {
  await writeJsonFile(recordPath(workDir, record.code), record);
}
