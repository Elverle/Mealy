// Esigenze alimentari ricavate per regola dalla tabella degli ingredienti (Feature 10). Nessuna dipendenza da DB o LLM.

import { DIET_FLAG_VALUES, type DietFlag, type PackIngredientFactDraft } from '@/lib/domain/types';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';

export type IngredientFactsMap = ReadonlyMap<string, PackIngredientFactDraft>;

/** Tabella indicizzata per nome canonico normalizzato. */
export function toIngredientFactsMap(facts: readonly PackIngredientFactDraft[]): Map<string, PackIngredientFactDraft> {
  return new Map(facts.map((fact) => [normalizeCanonicalName(fact.name), fact]));
}

/**
 * Diete rispettate da una ricetta, nell'ordine di DIET_FLAG_VALUES. Contano anche gli ingredienti q.b.
 * Un ingrediente senza voce nella tabella è un errore, non un "no".
 */
export function deriveDietFlags(
  ingredients: readonly { canonical_name: string }[],
  facts: IngredientFactsMap
): DietFlag[] {
  const factsOfRecipe = ingredients.map(({ canonical_name }) => {
    const name = normalizeCanonicalName(canonical_name);
    const fact = facts.get(name);
    if (!fact) {
      throw new Error(`Ingrediente senza voce nella tabella: ${name}`);
    }
    return fact;
  });

  const any = (attribute: keyof Omit<PackIngredientFactDraft, 'name' | 'category'>): boolean =>
    factsOfRecipe.some((fact) => fact[attribute]);

  const noMeat = !any('carne');
  const vegetarian = noMeat && !any('pesce');
  const flags = new Set<DietFlag>();
  if (noMeat) flags.add('pescetariano');
  if (vegetarian) flags.add('vegetariano');
  if (vegetarian && !any('latticini') && !any('uova') && !any('miele')) flags.add('vegano');
  if (!any('latticini')) flags.add('senza-lattosio');
  if (!any('glutine')) flags.add('senza-glutine');

  return DIET_FLAG_VALUES.filter((flag) => flags.has(flag));
}
