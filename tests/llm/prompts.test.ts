// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildRecipeInstructions,
  buildRecipePrompt,
  buildRepairPrompt,
  MAX_EXCLUDED_TITLES,
} from '@/lib/llm/prompts';
import type { RecipeConstraints } from '@/lib/domain/types';

describe('lib/llm/prompts', () => {
  describe('buildRecipeInstructions', () => {
    it('contains essential schema rules including canonical_name and diet_flags', () => {
      const instructions = buildRecipeInstructions();
      expect(instructions).toContain('canonical_name');
      expect(instructions).toContain('diet_flags');
      expect(instructions).toContain('servings_base');
      expect(instructions).toContain('Rispondi solo con un oggetto JSON');
      expect(instructions).toContain('unit: solo "g", "ml", "pz" oppure "qb"');
    });
  });

  describe('buildRecipePrompt', () => {
    const baseConstraints: RecipeConstraints = {
      persons: 4,
      meal_type: 'cena',
      diet_tags: ['vegetariano', 'senza-glutine'],
      meal_style_tags: ['veloce', 'salutare'],
      appliances: ['fornelli', 'forno'],
      ingredient_likes: ['pomodoro', 'basilico'],
      ingredient_dislikes: ['aglio'],
    };

    it('formats constraints, counts and lists correctly', () => {
      const prompt = buildRecipePrompt(baseConstraints, 3, ['Pasta e fagioli']);

      expect(prompt).toContain('Genera 3 ricette diverse tra loro.');
      expect(prompt).toContain('- Persone: 4 (servings_base = 4).');
      expect(prompt).toContain('- Pasto: cena (ogni ricetta deve includere "cena" in meal_types).');
      expect(prompt).toContain('- Diete da rispettare: vegetariano, senza-glutine (ogni ricetta deve rispettarle tutte e riportarle in diet_flags).');
      expect(prompt).toContain('- Elettrodomestici disponibili: fornelli, forno (usa solo questi).');
      expect(prompt).toContain('- Stile preferito: veloce, salutare (privilegialo quando sensato).');
      expect(prompt).toContain('- Ingredienti graditi: pomodoro, basilico (privilegiali quando sensato).');
      expect(prompt).toContain('- Ingredienti da non usare mai: aglio.');
      expect(prompt).toContain('Non proporre ricette uguali o molto simili a queste, già presenti in libreria:');
      expect(prompt).toContain('- Pasta e fagioli');
    });

    it('formats empty lists and null meal_type with proper fallback placeholders', () => {
      const emptyConstraints: RecipeConstraints = {
        persons: 2,
        meal_type: null,
        diet_tags: [],
        meal_style_tags: [],
        appliances: [],
        ingredient_likes: [],
        ingredient_dislikes: [],
      };

      const prompt = buildRecipePrompt(emptyConstraints, 5, []);

      expect(prompt).toContain('Genera 5 ricette diverse tra loro.');
      expect(prompt).toContain('- Pasto: pranzo o cena.');
      expect(prompt).toContain('- Diete da rispettare: nessuna.');
      expect(prompt).toContain('- Elettrodomestici disponibili: nessuno (solo ricette senza cottura).');
      expect(prompt).toContain('- Stile preferito: nessuna preferenza.');
      expect(prompt).toContain('- Ingredienti graditi: nessuno.');
      expect(prompt).toContain('- Ingredienti da non usare mai: nessuno.');
      expect(prompt).toContain('La libreria è vuota: nessun titolo da evitare.');
    });

    it('truncates excluded titles to MAX_EXCLUDED_TITLES (150)', () => {
      const twoHundredTitles = Array.from({ length: 200 }, (_, i) => `Titolo ${i + 1}`);
      const prompt = buildRecipePrompt(baseConstraints, 2, twoHundredTitles);

      expect(MAX_EXCLUDED_TITLES).toBe(150);
      expect(prompt).toContain('- Titolo 150');
      // Must not contain the line "- Titolo 151"
      const lines = prompt.split('\n');
      expect(lines).toContain('- Titolo 150');
      expect(lines).not.toContain('- Titolo 151');
      expect(lines).not.toContain('- Titolo 200');
    });

    it('deduplicates excluded titles and ignores empty strings', () => {
      const titles = ['Pizza', '  ', 'Pizza', 'Focaccia', ''];
      const prompt = buildRecipePrompt(baseConstraints, 2, titles);

      const pizzaLines = prompt.split('\n').filter((l) => l.trim() === '- Pizza');
      expect(pizzaLines.length).toBe(1);
      expect(prompt).toContain('- Focaccia');
    });
  });

  describe('buildRepairPrompt', () => {
    it('formats repair prompt with validation error details', () => {
      const errors = 'recipes.0.ingredients.0.unit: Invalid enum value.';
      const repair = buildRepairPrompt(errors);

      expect(repair).toContain('La risposta precedente non rispetta lo schema JSON richiesto. Errori di validazione:');
      expect(repair).toContain(errors);
      expect(repair).toContain('Restituisci di nuovo l\'oggetto JSON completo e corretto');
    });
  });
});
