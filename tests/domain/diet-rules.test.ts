// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { deriveDietFlags, toIngredientFactsMap } from '@/lib/domain/diet-rules';
import { expandDietFlags } from '@/lib/domain/recipe-text';
import {
  DIET_FLAG_VALUES,
  type DietFlag,
  type PackIngredientFactDraft,
} from '@/lib/domain/types';

type Attribute = Omit<PackIngredientFactDraft, 'name' | 'category'>;
type AttributeKey = keyof Attribute;

const ALL_FALSE: Attribute = {
  carne: false,
  pesce: false,
  latticini: false,
  uova: false,
  miele: false,
  glutine: false,
};

function fact(name: string, attributes: Partial<Attribute> = {}): PackIngredientFactDraft {
  return { name, category: 'dispensa', ...ALL_FALSE, ...attributes };
}

/** Diete di una ricetta con un solo ingrediente con gli attributi dati. */
function dietsOf(attributes: Partial<Attribute>): DietFlag[] {
  const facts = toIngredientFactsMap([fact('ingrediente', attributes)]);
  return deriveDietFlags([{ canonical_name: 'ingrediente' }], facts);
}

describe('deriveDietFlags', () => {
  it('derives all five flags when no ingredient has an attribute', () => {
    expect(dietsOf({})).toEqual([...DIET_FLAG_VALUES]);
  });

  it('keeps only the gluten-free and lactose-free flags when the only ingredient is meat', () => {
    expect(dietsOf({ carne: true })).toEqual(['senza-glutine', 'senza-lattosio']);
  });

  it('adds pescetariano when the only ingredient is fish', () => {
    expect(dietsOf({ pesce: true })).toEqual(['senza-glutine', 'senza-lattosio', 'pescetariano']);
  });

  it('keeps vegetarian and pescetariano but not vegan when the only ingredient is dairy', () => {
    expect(dietsOf({ latticini: true })).toEqual(['vegetariano', 'senza-glutine', 'pescetariano']);
  });

  it.each(['uova', 'miele'] as const)(
    'is not vegan, but stays lactose-free, when the only ingredient has %s',
    (attribute) => {
      expect(dietsOf({ [attribute]: true })).toEqual([
        'vegetariano',
        'senza-glutine',
        'senza-lattosio',
        'pescetariano',
      ]);
    }
  );

  it('drops everything except senza-glutine when the only ingredient has gluten', () => {
    expect(dietsOf({ glutine: true })).toEqual(
      DIET_FLAG_VALUES.filter((flag) => flag !== 'senza-glutine')
    );
  });

  it('counts a q.b. ingredient that has gluten', () => {
    const facts = toIngredientFactsMap([
      fact('farina 00', { glutine: true }),
      fact('sale', {}),
    ]);
    const diets = deriveDietFlags(
      [{ canonical_name: 'sale' }, { canonical_name: 'farina 00' }],
      facts
    );
    expect(diets).not.toContain('senza-glutine');
  });

  it('finds an ingredient whose name has uppercase letters and extra spaces', () => {
    const facts = toIngredientFactsMap([fact('farina 00', { glutine: true })]);
    const diets = deriveDietFlags([{ canonical_name: ' Farina  00 ' }], facts);
    expect(diets).not.toContain('senza-glutine');
  });

  it('throws when an ingredient has no entry in the table, with the normalized name', () => {
    const facts = toIngredientFactsMap([fact('sale')]);
    expect(() => deriveDietFlags([{ canonical_name: 'Farina  00' }], facts)).toThrow(
      'Ingrediente senza voce nella tabella: farina 00'
    );
  });

  describe('consistency with expandDietFlags', () => {
    const ATTRIBUTE_KEYS = Object.keys(ALL_FALSE) as AttributeKey[];

    it.each(
      Array.from({ length: 2 ** ATTRIBUTE_KEYS.length }, (_, mask) => mask)
    )('returns a set closed under expandDietFlags for combination %i', (mask) => {
      const attributes: Partial<Attribute> = {};
      ATTRIBUTE_KEYS.forEach((key, bit) => {
        attributes[key] = (mask & (1 << bit)) !== 0;
      });
      const result = dietsOf(attributes);
      expect(expandDietFlags(result)).toEqual(result);
    });
  });
});
