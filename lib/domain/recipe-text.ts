import {
  Appliance,
  Category,
  DIET_FLAG_VALUES,
  DietFlag,
  GeneratedIngredient,
  GeneratedRecipe,
  MealStyleTag,
  MealType,
  Unit,
} from '@/lib/domain/types';

/**
 * Normalizes recipe title:
 * - strips diacritics / accents (NFD + \p{M})
 * - lowercases
 * - replaces non-alphanumeric character sequences with a single space
 * - trims leading/trailing spaces
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Generates URL-friendly slug from title:
 * - normalizes title
 * - replaces spaces with hyphens
 * - truncates to 80 characters
 * - strips trailing hyphens
 * - falls back to 'ricetta' if empty
 */
export function slugify(title: string): string {
  const normalized = normalizeTitle(title);
  const hyphenated = normalized.replace(/\s+/g, '-');
  const truncated = hyphenated.slice(0, 80).replace(/-+$/, '');
  return truncated || 'ricetta';
}

/**
 * Normalizes ingredient canonical name:
 * - trims
 * - lowercases
 * - collapses internal whitespace sequences into a single space
 * - preserves accents/diacritics (e.g. 'Caffè' -> 'caffè')
 */
export function normalizeCanonicalName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Computes transitive closure of diet flag implications:
 * - vegano => vegetariano, senza-lattosio
 * - vegetariano => pescetariano
 * Returns deduplicated flags strictly sorted in the order of DIET_FLAG_VALUES.
 */
export function expandDietFlags(flags: readonly DietFlag[]): DietFlag[] {
  const set = new Set<DietFlag>(flags);
  let changed = true;

  while (changed) {
    changed = false;
    if (set.has('vegano')) {
      if (!set.has('vegetariano')) {
        set.add('vegetariano');
        changed = true;
      }
      if (!set.has('senza-lattosio')) {
        set.add('senza-lattosio');
        changed = true;
      }
    }
    if (set.has('vegetariano')) {
      if (!set.has('pescetariano')) {
        set.add('pescetariano');
        changed = true;
      }
    }
  }

  return DIET_FLAG_VALUES.filter((flag) => set.has(flag));
}

/**
 * Normalizes an LLM-generated recipe:
 * - returns a new object (does not mutate input)
 * - trims and collapses title whitespace; trims description
 * - trims each step and removes empty steps
 * - deduplicates meal_types, tags, appliances_required (preserving first occurrence)
 * - expands diet_flags via expandDietFlags
 * - normalizes each ingredient:
 *   - canonical_name normalized via normalizeCanonicalName
 *   - display_name trimmed
 *   - note trimmed; empty string becomes null
 *   - if unit === 'qb' => qty = null
 *   - if qty === null and unit !== 'qb' => unit = 'qb'
 */
export function normalizeGeneratedRecipe(recipe: GeneratedRecipe): GeneratedRecipe {
  const normalizedSteps = recipe.steps
    .map((step) => step.trim())
    .filter((step) => step.length > 0);

  const dedupe = <T>(arr: readonly T[]): T[] => Array.from(new Set(arr));

  const normalizedIngredients: GeneratedIngredient[] = recipe.ingredients.map((ing) => {
    let qty = ing.qty;
    let unit: Unit = ing.unit;

    if (unit === 'qb') {
      qty = null;
    } else if (qty === null) {
      unit = 'qb';
    }

    const trimmedNote = ing.note !== null ? ing.note.trim() : null;
    const note = trimmedNote && trimmedNote.length > 0 ? trimmedNote : null;

    return {
      canonical_name: normalizeCanonicalName(ing.canonical_name),
      display_name: ing.display_name.trim(),
      qty,
      unit,
      category: ing.category,
      note,
    };
  });

  return {
    ...recipe,
    title: recipe.title.trim().replace(/\s+/g, ' '),
    description: recipe.description.trim(),
    steps: normalizedSteps,
    meal_types: dedupe(recipe.meal_types),
    tags: dedupe(recipe.tags),
    diet_flags: expandDietFlags(recipe.diet_flags),
    appliances_required: dedupe(recipe.appliances_required),
    ingredients: normalizedIngredients,
  };
}
