// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  normalizeTitle,
  slugify,
  normalizeCanonicalName,
  expandDietFlags,
  normalizeGeneratedRecipe,
} from '@/lib/domain/recipe-text';
import { GeneratedRecipe } from '@/lib/domain/types';

describe('lib/domain/recipe-text', () => {
  describe('normalizeTitle', () => {
    it('normalizes accents, punctuation, casing and extra spaces', () => {
      expect(normalizeTitle('Pasta al Pomodoro!')).toBe('pasta al pomodoro');
      expect(normalizeTitle('  Caffè   d\'orzo ')).toBe('caffe d orzo');
      expect(normalizeTitle('!!!')).toBe('');
      expect(normalizeTitle('  Pizza 4 Stagioni!  ')).toBe('pizza 4 stagioni');
      expect(normalizeTitle('Crème brûlée')).toBe('creme brulee');
    });
  });

  describe('slugify', () => {
    it('generates a clean slug from title', () => {
      expect(slugify('Ceci croccanti in friggitrice ad aria')).toBe(
        'ceci-croccanti-in-friggitrice-ad-aria'
      );
    });

    it('falls back to "ricetta" if normalized title is empty', () => {
      expect(slugify('!!!')).toBe('ricetta');
      expect(slugify('   ')).toBe('ricetta');
    });

    it('truncates to at most 80 characters and removes trailing hyphens', () => {
      const longTitle = 'Questa è una ricetta estremamente lunga con moltissime parole che supera il limite di ottanta caratteri';
      const slug = slugify(longTitle);
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug.endsWith('-')).toBe(false);
      expect(slug).toBe(
        'questa-e-una-ricetta-estremamente-lunga-con-moltissime-parole-che-supera-il-limi'
      );
    });

    it('removes trailing hyphen when truncation falls on space/hyphen', () => {
      // Create a title such that char 80 is right after a word
      const title = 'a'.repeat(79) + ' b c';
      const slug = slugify(title);
      expect(slug.length).toBe(79);
      expect(slug.endsWith('-')).toBe(false);
    });
  });

  describe('normalizeCanonicalName', () => {
    it('trims, lowercases, collapses whitespace, but PRESERVES accents', () => {
      expect(normalizeCanonicalName('  Caffè   D\'orzo  ')).toBe('caffè d\'orzo');
      expect(normalizeCanonicalName('POMODORO')).toBe('pomodoro');
      expect(normalizeCanonicalName('Caffè')).toBe('caffè');
      expect(normalizeCanonicalName('  Farina   Tipo   00  ')).toBe('farina tipo 00');
    });
  });

  describe('expandDietFlags', () => {
    it('expands vegano to include vegetariano, senza-lattosio, and pescetariano in DIET_FLAG_VALUES order', () => {
      expect(expandDietFlags(['vegano'])).toEqual([
        'vegetariano',
        'vegano',
        'senza-lattosio',
        'pescetariano',
      ]);
    });

    it('expands vegetariano to include pescetariano', () => {
      expect(expandDietFlags(['vegetariano'])).toEqual([
        'vegetariano',
        'pescetariano',
      ]);
    });

    it('deduplicates flags and preserves DIET_FLAG_VALUES order', () => {
      expect(expandDietFlags(['senza-glutine', 'senza-glutine'])).toEqual([
        'senza-glutine',
      ]);
      expect(expandDietFlags([])).toEqual([]);
      expect(expandDietFlags(['vegano', 'senza-glutine'])).toEqual([
        'vegetariano',
        'vegano',
        'senza-glutine',
        'senza-lattosio',
        'pescetariano',
      ]);
    });

    it('handles pescetariano and senza-lattosio without expanding to other flags', () => {
      expect(expandDietFlags(['pescetariano'])).toEqual(['pescetariano']);
      expect(expandDietFlags(['senza-lattosio'])).toEqual(['senza-lattosio']);
    });
  });

  describe('normalizeGeneratedRecipe', () => {
    const sampleRecipe: GeneratedRecipe = {
      title: '  Spaghetti   alla Carbonara  ',
      description: '  Un primo piatto ricco e saporito.  ',
      meal_types: ['pranzo', 'pranzo', 'cena'],
      courses: ['primo'],
      tags: ['comfort-food', 'comfort-food', 'veloce'],
      diet_flags: ['vegano'],
      appliances_required: ['fornelli', 'fornelli'],
      servings_base: 2,
      prep_minutes: 20,
      kcal_est: 600,
      steps: [
        '  Bollire la pasta.  ',
        '   ',
        'Rosolare il guanciale.',
        '',
        'Unire il tutto.',
      ],
      ingredients: [
        {
          canonical_name: '  Spaghetti  ',
          display_name: '  Spaghetti n. 5  ',
          qty: 200,
          unit: 'g',
          category: 'dispensa',
          note: '  trafilati al bronzo  ',
        },
        {
          canonical_name: 'Sale Fino',
          display_name: 'Sale fino',
          qty: 10,
          unit: 'qb', // unit is qb => qty must become null
          category: 'dispensa',
          note: '   ', // whitespace note => must become null
        },
        {
          canonical_name: 'Pepe Nero',
          display_name: 'Pepe nero macinato',
          qty: null, // qty is null and unit !== qb => unit must become qb
          unit: 'g',
          category: 'dispensa',
          note: null,
        },
      ],
    };

    it('normalizes all fields according to specification', () => {
      const normalized = normalizeGeneratedRecipe(sampleRecipe);

      expect(normalized.title).toBe('Spaghetti alla Carbonara');
      expect(normalized.description).toBe('Un primo piatto ricco e saporito.');
      expect(normalized.meal_types).toEqual(['pranzo', 'cena']);
      expect(normalized.tags).toEqual(['comfort-food', 'veloce']);
      expect(normalized.appliances_required).toEqual(['fornelli']);
      expect(normalized.diet_flags).toEqual([
        'vegetariano',
        'vegano',
        'senza-lattosio',
        'pescetariano',
      ]);
      expect(normalized.steps).toEqual([
        'Bollire la pasta.',
        'Rosolare il guanciale.',
        'Unire il tutto.',
      ]);
      expect(normalized.servings_base).toBe(2);
      expect(normalized.prep_minutes).toBe(20);
      expect(normalized.kcal_est).toBe(600);

      // Ingredient 1: normal qty & unit
      expect(normalized.ingredients[0]).toEqual({
        canonical_name: 'spaghetti',
        display_name: 'Spaghetti n. 5',
        qty: 200,
        unit: 'g',
        category: 'dispensa',
        note: 'trafilati al bronzo',
      });

      // Ingredient 2: unit is 'qb', qty forced to null, note trimmed to null
      expect(normalized.ingredients[1]).toEqual({
        canonical_name: 'sale fino',
        display_name: 'Sale fino',
        qty: null,
        unit: 'qb',
        category: 'dispensa',
        note: null,
      });

      // Ingredient 3: qty is null, unit forced to 'qb'
      expect(normalized.ingredients[2]).toEqual({
        canonical_name: 'pepe nero',
        display_name: 'Pepe nero macinato',
        qty: null,
        unit: 'qb',
        category: 'dispensa',
        note: null,
      });
    });

    it('does not mutate the input object (pure function / immutability)', () => {
      const originalClone = structuredClone(sampleRecipe);
      const normalized = normalizeGeneratedRecipe(sampleRecipe);

      expect(sampleRecipe).toEqual(originalClone);
      expect(normalized).not.toBe(sampleRecipe);
      expect(normalized.steps).not.toBe(sampleRecipe.steps);
      expect(normalized.ingredients).not.toBe(sampleRecipe.ingredients);
      expect(normalized.ingredients[0]).not.toBe(sampleRecipe.ingredients[0]);
    });
  });
});
