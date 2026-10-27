// Lettura e scrittura dei file JSON di lavoro del pacchetto: unico punto di I/O JSON degli strumenti.
// Non importa il DB né l'LLM.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { PackError } from './errors';

const ENCODING = 'utf8';
const JSON_INDENT = 2;

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Legge e valida un file JSON. Se il file manca restituisce `onMissing()`, che può lanciare il
 * proprio errore. JSON o schema non validi lanciano `PackError` con il primo problema.
 */
export async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T, unknown>,
  onMissing: () => T
): Promise<T> {
  let text: string;
  try {
    text = await fs.readFile(filePath, ENCODING);
  } catch (error) {
    if (isMissingFileError(error)) return onMissing();
    throw error;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new PackError(`File non valido: ${filePath}: ${errorMessage(error)}`);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    throw new PackError(
      `File non valido: ${filePath}: ${issue.path.join('.') || '(radice)'}: ${issue.message}`
    );
  }
  return parsed.data;
}

/** Scrive `value` come JSON indentato con a capo finale, creando le cartelle; scrive su un file temporaneo e poi lo rinomina: un'interruzione non lascia file troncati. */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, JSON_INDENT)}\n`, ENCODING);
  await fs.rename(tempPath, filePath);
}
