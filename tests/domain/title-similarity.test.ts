// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  SIMILAR_TITLE_THRESHOLD,
  areTitlesSimilar,
  titleSimilarity,
  titleTrigrams,
} from '@/lib/domain/title-similarity';

describe('titleTrigrams', () => {
  it('produces the padded trigrams of each word', () => {
    expect(titleTrigrams('abc')).toEqual(new Set(['  a', ' ab', 'abc', 'bc ']));
  });

  it('ignores case and accents', () => {
    expect(titleTrigrams('Caffè')).toEqual(titleTrigrams('caffe'));
  });

  it('is empty for text without letters or digits', () => {
    expect(titleTrigrams('  --  ')).toEqual(new Set());
  });
});

describe('titleSimilarity', () => {
  it('is the Jaccard index of the trigram sets', () => {
    expect(titleSimilarity('abc', 'abd')).toBeCloseTo(0.3333, 4);
  });

  it('is 1 for identical titles', () => {
    expect(titleSimilarity('Pollo al curry', 'Pollo al curry')).toBe(1);
  });

  it('is 0 when both titles are empty', () => {
    expect(titleSimilarity('', '')).toBe(0);
  });

  it('ignores accents and case', () => {
    expect(titleSimilarity('Pasta e Fagioli', 'pasta e fagiolì')).toBe(1);
  });
});

describe('areTitlesSimilar', () => {
  it('uses a threshold of 0.6', () => {
    expect(SIMILAR_TITLE_THRESHOLD).toBe(0.6);
  });

  it('treats a title with an added word as similar', () => {
    expect(areTitlesSimilar('Pasta alla norma', 'Pasta alla Norma siciliana')).toBe(true);
  });

  it('treats unrelated titles as different', () => {
    expect(areTitlesSimilar('Zucchine trifolate', 'Pollo al curry')).toBe(false);
  });
});
