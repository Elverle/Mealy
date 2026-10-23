// Lettura del dataset CSV del pacchetto (Feature 10): funzioni pure, nessuna dipendenza nuova.

import type { PackDatasetRow, PackQuantityReading } from '@/lib/domain/types';
import { PackError } from './errors';

const BOM = '﻿';
const QUANTITY_PATTERN = /^(\d+)(?:[.,](\d+))?(kg|g|ml|cl|dl|l)?$/;
const QUANTITY_DECIMAL_PLACES = 3;
const QUANTITY_SCALE = 10 ** QUANTITY_DECIMAL_PLACES;
const MEASURE_UNITS = {
  g: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
  ml: { unit: 'ml', factor: 1 },
  cl: { unit: 'ml', factor: 10 },
  dl: { unit: 'ml', factor: 100 },
  l: { unit: 'ml', factor: 1000 },
} as const;
type MeasureUnitKey = keyof typeof MEASURE_UNITS;

// Posizione di una colonna richiesta nell'intestazione; la colonna dell'indice ha nome vuoto.
function columnPosition(header: readonly string[], name: string): number {
  const position = header.indexOf(name);
  if (position === -1) {
    throw new PackError(`Il CSV non ha la colonna "${name || 'indice'}".`);
  }
  return position;
}

/** Record del CSV secondo RFC 4180: separatore ",", fine record "\n" o "\r\n". */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;
  let dirty = false;

  const endField = (): void => {
    record.push(field);
    field = '';
    quoted = false;
    atFieldStart = true;
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
    dirty = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        const next = text[i + 1];
        if (next === undefined || next === ',' || next === '\n' || next === '\r') {
          quoted = false;
          continue;
        }
      }
      field += ch;
      continue;
    }

    if (ch === '\r') continue;
    if (ch === '\n') {
      endRecord();
      continue;
    }

    dirty = true;
    if (ch === ',') {
      endField();
    } else if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else {
      field += ch;
      atFieldStart = false;
    }
  }

  if (dirty) endRecord();
  return records;
}

/** Righe del dataset: la prima è l'intestazione; mancano le colonne richieste → PackError. */
export function readDatasetRows(text: string): PackDatasetRow[] {
  const records = parseCsv(text.startsWith(BOM) ? text.slice(BOM.length) : text);
  const [header = []] = records;

  const columns = {
    index: columnPosition(header, ''),
    title: columnPosition(header, 'Nome'),
    category: columnPosition(header, 'Categoria'),
    link: columnPosition(header, 'Link'),
    servings: columnPosition(header, 'Persone/Pezzi'),
    ingredients: columnPosition(header, 'Ingredienti'),
    steps: columnPosition(header, 'Steps'),
  };

  return records.slice(1).flatMap((record): PackDatasetRow[] => {
    if (record.length === 1 && record[0].trim() === '') return [];
    const cell = (position: number): string => record[position] ?? '';
    return [
      {
        index: cell(columns.index),
        title: cell(columns.title),
        category: cell(columns.category),
        link: cell(columns.link),
        servings: cell(columns.servings),
        ingredients: cell(columns.ingredients),
        steps: cell(columns.steps),
      },
    ];
  });
}

/**
 * Lista Python di coppie di stringhe, es. [['Pasta', '300g'], ["Sale", 'q.b.']].
 * Restituisce le coppie senza trim; null per qualunque altra forma.
 */
export function parsePairList(text: string): [string, string][] | null {
  let pos = 0;

  const skipSpaces = (): void => {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
  };
  const consume = (token: string): boolean => {
    skipSpaces();
    if (text[pos] !== token) return false;
    pos++;
    return true;
  };
  const parseString = (): string | null => {
    skipSpaces();
    const quote = text[pos];
    if (quote !== "'" && quote !== '"') return null;
    pos++;
    let value = '';
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === quote) {
        pos++;
        return value;
      }
      if (ch === '\\') {
        const escaped = text[pos + 1];
        if (escaped === undefined) return null;
        value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
        pos += 2;
        continue;
      }
      value += ch;
      pos++;
    }
    return null;
  };
  const parsePair = (): [string, string] | null => {
    if (!consume('[')) return null;
    const name = parseString();
    if (name === null || !consume(',')) return null;
    const quantity = parseString();
    if (quantity === null || !consume(']')) return null;
    return [name, quantity];
  };

  if (!consume('[')) return null;
  const pairs: [string, string][] = [];
  skipSpaces();
  if (text[pos] === ']') {
    pos++;
  } else {
    for (;;) {
      const pair = parsePair();
      if (pair === null) return null;
      pairs.push(pair);
      skipSpaces();
      if (text[pos] === ']') {
        pos++;
        break;
      }
      if (!consume(',')) return null;
    }
  }

  skipSpaces();
  return pos === text.length ? pairs : null;
}

/** Quantità grezza del dataset: g/ml dopo le conversioni, pezzi se manca l'unità, q.b., o illeggibile. */
export function parseDatasetQuantity(raw: string): PackQuantityReading {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (s === 'q.b.' || s === 'qb') return { kind: 'qb' };

  const match = QUANTITY_PATTERN.exec(s);
  if (!match) return { kind: 'invalid' };
  const [, integerPart, decimalPart, unitKey] = match;
  // Parte intera con zero iniziale (025g): illeggibile.
  if (integerPart.length > 1 && integerPart.startsWith('0')) return { kind: 'invalid' };

  const value = Number(`${integerPart}.${decimalPart ?? '0'}`);
  if (value <= 0) return { kind: 'invalid' };

  const measure =
    unitKey === undefined
      ? { unit: 'pz' as const, factor: 1 }
      : MEASURE_UNITS[unitKey as MeasureUnitKey];
  const qty = Math.round(value * measure.factor * QUANTITY_SCALE) / QUANTITY_SCALE;
  if (qty <= 0) return { kind: 'invalid' };

  return { kind: 'measure', qty, unit: measure.unit, unitless: unitKey === undefined };
}

/** Testo leggibile di una quantità: "750 g", "2 senza unità", "q.b."; null se illeggibile. */
export function formatQuantityReading(reading: PackQuantityReading): string | null {
  switch (reading.kind) {
    case 'qb':
      return 'q.b.';
    case 'invalid':
      return null;
    case 'measure':
      return reading.unitless ? `${reading.qty} senza unità` : `${reading.qty} ${reading.unit}`;
  }
}

/** Testo confrontabile: senza accenti, minuscolo, spazi singoli. */
export function normalizeDatasetText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parole del testo (lettere e cifre latine) dopo normalizeDatasetText. */
export function datasetWords(text: string): string[] {
  return normalizeDatasetText(text).match(/[a-z0-9]+/g) ?? [];
}
