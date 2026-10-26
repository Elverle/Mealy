// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  readDatasetRows,
  parsePairList,
  parseDatasetQuantity,
  formatQuantityReading,
  normalizeDatasetText,
  datasetWords,
} from '@/lib/recipes/pack/dataset';
import { PackError } from '@/lib/recipes/pack/errors';

const SAMPLE_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'recipe-pack', 'sample.csv');
const HEADER = ',Nome,Categoria,Link,Persone/Pezzi,Ingredienti,Steps';

describe('lib/recipes/pack/dataset', () => {
  describe('parseCsv', () => {
    it('keeps commas and line breaks inside quoted fields', () => {
      expect(parseCsv('a,"b, c","d\ne"\n')).toEqual([['a', 'b, c', 'd\ne']]);
    });

    it('reads a doubled quote inside a quoted field as one quote', () => {
      expect(parseCsv('"dice ""ciao""",x')).toEqual([['dice "ciao"', 'x']]);
    });

    it('treats CRLF as a record end and ignores a stray CR outside quotes', () => {
      expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
      expect(parseCsv('a\rb,c\n')).toEqual([['ab', 'c']]);
    });

    it('keeps a quote inside an unquoted field as a character', () => {
      expect(parseCsv('pollo"x,y\n')).toEqual([['pollo"x', 'y']]);
    });

    it('does not return an empty record for a trailing line break', () => {
      expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
      expect(parseCsv('')).toEqual([]);
    });

    it('keeps empty fields and an empty quoted field', () => {
      expect(parseCsv(',"",x\n')).toEqual([['', '', 'x']]);
    });
  });

  describe('readDatasetRows', () => {
    it('maps the columns by name and skips the BOM', () => {
      const text = `﻿${HEADER}\n7,Pasta di prova,Primi piatti,https://example.test/7,4,"[['Pasta', '300g'], ['Sale', 'q.b.']]",Testo\n`;
      expect(readDatasetRows(text)).toEqual([
        {
          index: '7',
          title: 'Pasta di prova',
          category: 'Primi piatti',
          link: 'https://example.test/7',
          servings: '4',
          ingredients: "[['Pasta', '300g'], ['Sale', 'q.b.']]",
          steps: 'Testo',
        },
      ]);
    });

    it('skips blank lines and fills missing cells with empty strings', () => {
      const text = `${HEADER}\n\n8,Solo titolo,Contorni\n`;
      expect(readDatasetRows(text)).toEqual([
        {
          index: '8',
          title: 'Solo titolo',
          category: 'Contorni',
          link: '',
          servings: '',
          ingredients: '',
          steps: '',
        },
      ]);
    });

    it('names the missing column in the error message', () => {
      const text = ',Nome,Categoria,Link,Persone/Pezzi,Ingredienti\n';
      expect(() => readDatasetRows(text)).toThrow(PackError);
      expect(() => readDatasetRows(text)).toThrow('Il CSV non ha la colonna "Steps".');
    });

    it('names the index column as "indice" when it is missing', () => {
      const text = 'Nome,Categoria,Link,Persone/Pezzi,Ingredienti,Steps\n';
      expect(() => readDatasetRows(text)).toThrow('Il CSV non ha la colonna "indice".');
    });

    it('reads the sample dataset with one row per record', () => {
      const rows = readDatasetRows(fs.readFileSync(SAMPLE_PATH, 'utf8'));
      expect(rows).toHaveLength(20);
      expect(rows[0]).toMatchObject({ index: '10', title: 'Spaghetti alla pancetta inventata' });
      expect(rows[1].steps).toContain('"a secco", per due minuti');
      expect(rows[1].steps).toContain('\n');
    });
  });

  describe('parsePairList', () => {
    it('reads pairs with mixed quotes', () => {
      expect(
        parsePairList(`[['Filetto di manzo', '800g'], ["Olio extravergine d'oliva", '6']]`)
      ).toEqual([
        ['Filetto di manzo', '800g'],
        ["Olio extravergine d'oliva", '6'],
      ]);
    });

    it('reads an escaped quote and keeps the spaces of the strings', () => {
      expect(parsePairList(`[['Pane d\\'Italia ', ' 2 ']]`)).toEqual([['Pane d\'Italia ', ' 2 ']]);
    });

    it('turns the escapes \\n and \\t into a line break and a tab, other escapes into the bare character', () => {
      expect(parsePairList(`[['a\\nb', 'c\\td\\\\e']]`)).toEqual([['a\nb', 'c\td\\e']]);
    });

    it('accepts spaces around every token', () => {
      expect(parsePairList(`  [ [ 'a' , 'b' ] , [ "c" ,"d" ] ]  `)).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('returns an empty array for an empty list', () => {
      expect(parsePairList('[]')).toEqual([]);
      expect(parsePairList(' [ ] ')).toEqual([]);
    });

    it('returns null for anything that is not a list of pairs', () => {
      expect(parsePairList('')).toBeNull();
      expect(parsePairList('Pasta e pomodoro')).toBeNull();
      expect(parsePairList("[['a', 'b']] in più")).toBeNull();
      expect(parsePairList("[['a', 'b', 'c']]")).toBeNull();
      expect(parsePairList("[['a', 3]]")).toBeNull();
      expect(parsePairList("[[['a'], 'b']]")).toBeNull();
      expect(parsePairList("[['a', 'b'],]")).toBeNull();
      expect(parsePairList("[['a', 'b']")).toBeNull();
      expect(parsePairList("[['a', 'b]]")).toBeNull();
      expect(parsePairList("[['a', 'b'] 'c']")).toBeNull();
    });
  });

  describe('parseDatasetQuantity', () => {
    it('reads grams and converts kilograms to grams', () => {
      expect(parseDatasetQuantity('750g')).toEqual({
        kind: 'measure',
        qty: 750,
        unit: 'g',
        unitless: false,
      });
      expect(parseDatasetQuantity('1kg')).toEqual({
        kind: 'measure',
        qty: 1000,
        unit: 'g',
        unitless: false,
      });
      expect(parseDatasetQuantity('1,5kg')).toEqual({
        kind: 'measure',
        qty: 1500,
        unit: 'g',
        unitless: false,
      });
    });

    it('converts litres, decilitres and centilitres to millilitres', () => {
      expect(parseDatasetQuantity('0,5 l')).toEqual({
        kind: 'measure',
        qty: 500,
        unit: 'ml',
        unitless: false,
      });
      expect(parseDatasetQuantity('2 dl')).toEqual({
        kind: 'measure',
        qty: 200,
        unit: 'ml',
        unitless: false,
      });
      expect(parseDatasetQuantity('3cl')).toEqual({
        kind: 'measure',
        qty: 30,
        unit: 'ml',
        unitless: false,
      });
      expect(parseDatasetQuantity('250 ml')).toEqual({
        kind: 'measure',
        qty: 250,
        unit: 'ml',
        unitless: false,
      });
    });

    it('reads a number without unit as pieces, flagged as unitless', () => {
      expect(parseDatasetQuantity('2')).toEqual({
        kind: 'measure',
        qty: 2,
        unit: 'pz',
        unitless: true,
      });
    });

    it('reads q.b. in any case as qb', () => {
      expect(parseDatasetQuantity('q.b.')).toEqual({ kind: 'qb' });
      expect(parseDatasetQuantity('Q.B.')).toEqual({ kind: 'qb' });
      expect(parseDatasetQuantity(' qb ')).toEqual({ kind: 'qb' });
    });

    it('rejects readings that are not a positive quantity', () => {
      expect(parseDatasetQuantity('025g')).toEqual({ kind: 'invalid' });
      expect(parseDatasetQuantity('250g1kg')).toEqual({ kind: 'invalid' });
      expect(parseDatasetQuantity('0')).toEqual({ kind: 'invalid' });
      expect(parseDatasetQuantity('0,0g')).toEqual({ kind: 'invalid' });
      expect(parseDatasetQuantity('0,0001g')).toEqual({ kind: 'invalid' });
      expect(parseDatasetQuantity('un pizzico')).toEqual({ kind: 'invalid' });
      expect(parseDatasetQuantity('')).toEqual({ kind: 'invalid' });
    });
  });

  describe('formatQuantityReading', () => {
    it('formats each kind of reading', () => {
      expect(formatQuantityReading({ kind: 'qb' })).toBe('q.b.');
      expect(formatQuantityReading({ kind: 'invalid' })).toBeNull();
      expect(
        formatQuantityReading({ kind: 'measure', qty: 750, unit: 'g', unitless: false })
      ).toBe('750 g');
      expect(
        formatQuantityReading({ kind: 'measure', qty: 2, unit: 'pz', unitless: true })
      ).toBe('2 senza unità');
    });
  });

  describe('normalizeDatasetText and datasetWords', () => {
    it('removes accents, lowercases and collapses spaces', () => {
      expect(normalizeDatasetText('  Baccalà   ALLA  Vicentina ')).toBe('baccala alla vicentina');
    });

    it('splits into lowercase alphanumeric words', () => {
      expect(datasetWords('Baccalà alla vicentina')).toEqual(['baccala', 'alla', 'vicentina']);
      expect(datasetWords("Olio extravergine d'oliva, 2 cucchiai")).toEqual([
        'olio',
        'extravergine',
        'd',
        'oliva',
        '2',
        'cucchiai',
      ]);
      expect(datasetWords('!!!')).toEqual([]);
    });
  });
});
