// @vitest-environment node

import { describe, it, expect } from 'vitest';
import type { GeneratedIngredient, GeneratedRecipe, PackCandidate } from '@/lib/domain/types';
import { toAliasMap } from '@/lib/domain/shopping-list';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';
import {
  checkConversionErrors,
  checkConversionWarnings,
  findSharedWordRun,
  postProcessConversion,
} from '@/lib/recipes/pack/checks';

const PROCEDURE =
  'Cuoci la pasta in acqua salata, poi scola bene e condisci con il sugo caldo. Mescola con cura e servi subito in tavola.';
const SHARED_RUN = 'cuoci la pasta in acqua salata poi scola';

function makeCandidate(overrides: Partial<PackCandidate> = {}): PackCandidate {
  return {
    code: 'P001',
    group: 'primi',
    main_ingredient: 'verdure',
    dataset_index: '1',
    link: 'https://example.test/1',
    title: 'Pasta al pomodoro',
    category: 'Primi piatti',
    servings: 4,
    ingredients: [
      ['Pasta', '300g'],
      ['Sale', 'q.b.'],
    ],
    procedure: PROCEDURE,
    measured_count: 1,
    score: 2,
    checked: true,
    ...overrides,
  };
}

function ingredient(canonicalName: string, qty: number, unit: 'g' | 'ml' | 'pz'): GeneratedIngredient {
  return {
    canonical_name: canonicalName,
    display_name: canonicalName,
    qty,
    unit,
    category: 'dispensa',
    note: null,
  };
}

function qbIngredient(canonicalName: string): GeneratedIngredient {
  return { ...ingredient(canonicalName, 1, 'g'), qty: null, unit: 'qb' };
}

function recipeWith(ingredients: GeneratedIngredient[], overrides: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return makeGeneratedRecipe({ ingredients, ...overrides });
}

describe('findSharedWordRun', () => {
  it('finds eight shared words even with different accents and punctuation', () => {
    const text = 'Cuòci la pasta in acqua salàta, poi scolà bene.';
    const original = 'Cuoci la pasta in acqua salata; poi scola il tutto.';
    expect(findSharedWordRun(text, original)).toBe(SHARED_RUN);
  });

  it('returns null when the shared run is only seven words long', () => {
    const text = 'Cuoci la pasta in acqua salata poi asciuga bene.';
    const original = 'Cuoci la pasta in acqua salata poi scola bene.';
    expect(findSharedWordRun(text, original)).toBeNull();
  });

  it('returns null when one of the texts has fewer words than the run', () => {
    expect(findSharedWordRun('Cuoci la pasta', PROCEDURE)).toBeNull();
    expect(findSharedWordRun(PROCEDURE, 'Cuoci la pasta')).toBeNull();
  });
});

describe('postProcessConversion', () => {
  it('forces servings_base to the candidate servings', () => {
    const recipe = makeGeneratedRecipe({ servings_base: 2 });
    const result = postProcessConversion(recipe, makeCandidate({ servings: 6 }), new Map());
    expect(result.servings_base).toBe(6);
  });

  it('resolves ingredient aliases to the canonical name', () => {
    const aliases = toAliasMap([{ alias: 'parmigiano', canonical_name: 'parmigiano reggiano' }]);
    const recipe = recipeWith([ingredient('Parmigiano', 50, 'g')]);
    const result = postProcessConversion(recipe, makeCandidate(), aliases);
    expect(result.ingredients[0].canonical_name).toBe('parmigiano reggiano');
  });

  it('applies the recipe normalization before the other fixes', () => {
    const recipe = recipeWith([{ ...ingredient('Sale', 1, 'g'), qty: null, unit: 'g' }], {
      title: '  Pasta   al pomodoro ',
    });
    const result = postProcessConversion(recipe, makeCandidate(), new Map());
    expect(result.title).toBe('Pasta al pomodoro');
    expect(result.ingredients[0].unit).toBe('qb');
  });
});

describe('checkConversionErrors', () => {
  it('returns no errors for a valid recipe in the right course', () => {
    const recipe = recipeWith([ingredient('pasta', 300, 'g')], {
      courses: ['primo'],
      description: 'Un piatto semplice.',
      steps: ['Lessa la pasta.', 'Condisci con il sugo.'],
    });
    expect(checkConversionErrors(recipe, makeCandidate())).toEqual([]);
  });

  it('reports E1 for a negative quantity with the path of the field', () => {
    const recipe = recipeWith([ingredient('pasta', 300, 'g')]);
    const broken = { ...recipe, ingredients: [{ ...recipe.ingredients[0], qty: -5 }] };
    const errors = checkConversionErrors(broken, makeCandidate());
    expect(errors).toEqual([expect.stringMatching(/^schema: ingredients\.0\.qty: /)]);
  });

  it('reports E2 for a contorni recipe without the contorno course', () => {
    const recipe = makeGeneratedRecipe({ courses: ['secondo'] });
    const errors = checkConversionErrors(recipe, makeCandidate({ group: 'contorni' }));
    expect(errors).toEqual(['portata non adatta al gruppo Contorni: secondo']);
  });

  it('accepts a contorni recipe that has the contorno course', () => {
    const recipe = makeGeneratedRecipe({ courses: ['contorno'] });
    expect(checkConversionErrors(recipe, makeCandidate({ group: 'contorni' }))).toEqual([]);
  });

  it('reports E2 for a primi recipe whose only course is contorno', () => {
    const recipe = makeGeneratedRecipe({ courses: ['contorno'] });
    const errors = checkConversionErrors(recipe, makeCandidate({ group: 'primi' }));
    expect(errors).toEqual(['portata non adatta al gruppo Primi: contorno']);
  });

  it('accepts a piatto-unico for a primi candidate', () => {
    const recipe = makeGeneratedRecipe({ courses: ['piatto-unico'] });
    expect(checkConversionErrors(recipe, makeCandidate({ group: 'primi' }))).toEqual([]);
  });

  it('reports E2 with "nessuna" when the recipe has no course', () => {
    const recipe = { ...makeGeneratedRecipe(), courses: [] };
    const errors = checkConversionErrors(recipe, makeCandidate({ group: 'primi' }));
    expect(errors).toContain('portata non adatta al gruppo Primi: nessuna');
  });

  it('reports E3 when a step copies eight words of the original procedure', () => {
    const recipe = makeGeneratedRecipe({
      courses: ['primo'],
      steps: ['Cuoci la pasta in acqua salata, poi scola bene.'],
    });
    expect(checkConversionErrors(recipe, makeCandidate())).toEqual([
      `testo copiato dall'originale: "${SHARED_RUN}"`,
    ]);
  });

  it('reports E3 once per copied text, description included', () => {
    const recipe = makeGeneratedRecipe({
      courses: ['primo'],
      description: 'Cuoci la pasta in acqua salata, poi scola bene.',
      steps: ['Cuoci la pasta in acqua salata, poi scola bene.', 'Servi subito.'],
    });
    expect(checkConversionErrors(recipe, makeCandidate())).toEqual([
      `testo copiato dall'originale: "${SHARED_RUN}"`,
      `testo copiato dall'originale: "${SHARED_RUN}"`,
    ]);
  });
});

describe('checkConversionWarnings', () => {
  it('returns no warnings when every quantity matches within 10%', () => {
    const candidate = makeCandidate({ ingredients: [['Farina', '500g'], ['Sale', 'q.b.']] });
    const recipe = recipeWith([ingredient('farina', 540, 'g'), qbIngredient('sale')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([]);
  });

  it('does not warn when the difference is exactly 10%', () => {
    const candidate = makeCandidate({ ingredients: [['Farina', '500g']] });
    const recipe = recipeWith([ingredient('farina', 550, 'g')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([]);
  });

  it('reports W1 when the quantity differs by more than 10%', () => {
    const candidate = makeCandidate({ ingredients: [['Farina', '500g']] });
    const recipe = recipeWith([ingredient('farina', 300, 'g')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([
      'quantità di "Farina": "500g" → 300 g',
    ]);
  });

  it('reports W1 when the unit differs, even with the same number', () => {
    const candidate = makeCandidate({ ingredients: [['Latte', '1l']] });
    const recipe = recipeWith([ingredient('latte', 1000, 'g')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([
      'quantità di "Latte": "1l" → 1000 g',
    ]);
  });

  it('reports W1 when the dataset has a quantity but the recipe says q.b.', () => {
    const candidate = makeCandidate({ ingredients: [['Farina', '500g']] });
    const recipe = recipeWith([qbIngredient('farina')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([
      'quantità di "Farina": "500g" → q.b.',
    ]);
  });

  it('reports W3 for a spoon ingredient written without a unit', () => {
    const candidate = makeCandidate({ ingredients: [['Olio', '6']] });
    const recipe = recipeWith([ingredient('olio', 15, 'ml')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([
      'numero senza unità su "Olio": "6" → 15 ml',
    ]);
  });

  it('does not warn for a q.b. dataset quantity', () => {
    const candidate = makeCandidate({ ingredients: [['Sale', 'q.b.']] });
    const recipe = recipeWith([ingredient('sale', 5, 'g')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([]);
  });

  it('does not warn for an unreadable dataset quantity', () => {
    const candidate = makeCandidate({ ingredients: [['Sale', 'abc']] });
    const recipe = recipeWith([ingredient('sale', 5, 'g')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual([]);
  });

  it('reports W2 instead of the per-ingredient checks when the counts differ', () => {
    const candidate = makeCandidate({
      ingredients: [
        ['Farina', '500g'],
        ['Olio', '6'],
        ['Sale', 'q.b.'],
      ],
    });
    const recipe = recipeWith([ingredient('farina', 100, 'g')]);
    expect(checkConversionWarnings(recipe, candidate)).toEqual(['ingredienti: 3 → 1']);
  });

  it('reports W4 for a preparation longer than 120 minutes', () => {
    const candidate = makeCandidate({ ingredients: [['Sale', 'q.b.']] });
    const recipe = recipeWith([qbIngredient('sale')], { prep_minutes: 150 });
    expect(checkConversionWarnings(recipe, candidate)).toEqual(['tempo lungo: 150 minuti']);
  });

  it('does not report W4 at exactly 120 minutes', () => {
    const candidate = makeCandidate({ ingredients: [['Sale', 'q.b.']] });
    const recipe = recipeWith([qbIngredient('sale')], { prep_minutes: 120 });
    expect(checkConversionWarnings(recipe, candidate)).toEqual([]);
  });
});
