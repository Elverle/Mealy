// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { FIXTURE_INGREDIENT_ALIASES, fixtureRecipesAsDomain } from '@/fixtures';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import {
  buildShoppingList,
  compareShoppingItemsByAisle,
  formatShoppingQuantity,
  groupShoppingItems,
  inferShoppingCategory,
  pickDefaultShoppingPlan,
  reconcileShoppingItems,
  resolveIngredientName,
  roundShoppingQuantity,
  shoppingItemLabel,
  shoppingProgress,
  toAliasMap,
  type BuiltShoppingItem,
  type ExistingShoppingItem,
  type ShoppingSlotInput,
} from '@/lib/domain/shopping-list';
import {
  type Category,
  type Ingredient,
  type Recipe,
  type ShoppingItemView,
  type ShoppingPlanRef,
  type Unit,
} from '@/lib/domain/types';

const R1 = '00000000-0000-4000-8000-000000000001';
const R2 = '00000000-0000-4000-8000-000000000002';
const R3 = '00000000-0000-4000-8000-000000000003';

type SlotRecipe = Pick<Recipe, 'id' | 'servings_base' | 'ingredients'>;

function ing(
  canonical_name: string,
  unit: Unit,
  qty: number | null,
  category: Category = 'dispensa'
): Ingredient {
  return { canonical_name, display_name: canonical_name, unit, qty, category };
}

function recipe(id: string, servings_base: number, ingredients: Ingredient[]): SlotRecipe {
  return { id, servings_base, ingredients };
}

function slot(r: SlotRecipe, servings: number = r.servings_base): ShoppingSlotInput {
  return { servings, recipe: r };
}

function built(
  canonical_name: string,
  unit: Unit,
  qty: number | null,
  category: Category = 'dispensa'
): BuiltShoppingItem {
  return { canonical_name, unit, qty, category, recipe_ids: [] };
}

function existing(
  id: string,
  canonical_name: string,
  unit: Unit | null,
  qty: number | null,
  checked: boolean
): ExistingShoppingItem {
  return { id, canonical_name, unit, qty, checked };
}

function view(
  id: string,
  canonical_name: string,
  overrides: Partial<ShoppingItemView> = {}
): ShoppingItemView {
  return {
    id,
    canonical_name,
    qty: 100,
    unit: 'g',
    category: 'dispensa',
    checked: false,
    manual: false,
    recipe_ids: [R1],
    ...overrides,
  };
}

function planRef(id: string, week_start: string, has_list: boolean): ShoppingPlanRef {
  return { id, week_start, last_day: week_start, status: 'active', has_list };
}

describe('toAliasMap', () => {
  it('normalizes both alias and canonical name', () => {
    const map = toAliasMap([{ alias: ' Pelati ', canonical_name: '  Pomodoro   Pelato ' }]);
    expect(map.get('pelati')).toBe('pomodoro pelato');
  });

  it('skips entries with an empty side or an alias equal to the canonical name', () => {
    const map = toAliasMap([
      { alias: '   ', canonical_name: 'sale' },
      { alias: 'pepe', canonical_name: '   ' },
      { alias: 'Sale', canonical_name: 'sale' },
    ]);
    expect(map.size).toBe(0);
  });
});

describe('resolveIngredientName', () => {
  const aliases = new Map([['pelati', 'pomodoro pelato']]);

  it('returns the canonical name for a known alias', () => {
    expect(resolveIngredientName('pelati', aliases)).toBe('pomodoro pelato');
  });

  it('returns the normalized name when there is no alias', () => {
    expect(resolveIngredientName('  Cipolla  ', aliases)).toBe('cipolla');
  });

  it('normalizes before looking up the alias', () => {
    expect(resolveIngredientName('  PELATI ', aliases)).toBe('pomodoro pelato');
  });

  it('resolves a single step only', () => {
    const chain = new Map([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(resolveIngredientName('a', chain)).toBe('b');
  });
});

describe('roundShoppingQuantity', () => {
  it.each([
    [66.6667, 'g', 70],
    [150, 'g', 150],
    [200.0000001, 'g', 200],
    [2.5, 'g', 3],
    [10, 'ml', 10],
    [10.4, 'ml', 20],
    [0.75, 'pz', 1],
    [1.5, 'pz', 2],
    [3.0000001, 'pz', 3],
    [5, 'qb', null],
  ] as const)('rounds %s %s to %s', (value, unit, expected) => {
    expect(roundShoppingQuantity(value, unit)).toBe(expected);
  });
});

describe('buildShoppingList', () => {
  it('scales the quantity by the ratio between planned and base servings', () => {
    const items = buildShoppingList([
      slot(recipe(R1, 2, [ing('petto di pollo', 'g', 200, 'macelleria')]), 3),
    ]);
    expect(items).toEqual([
      {
        canonical_name: 'petto di pollo',
        qty: 300,
        unit: 'g',
        category: 'macelleria',
        recipe_ids: [R1],
      },
    ]);
  });

  it('sums the same ingredient across recipes and lists their ids in ascending order', () => {
    const items = buildShoppingList([
      slot(recipe(R2, 2, [ing('petto di pollo', 'g', 150, 'macelleria')])),
      slot(recipe(R1, 2, [ing('petto di pollo', 'g', 200, 'macelleria')])),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qty: 350, unit: 'g', recipe_ids: [R1, R2] });
  });

  it('doubles the quantity for the same recipe in two slots but keeps one id', () => {
    const r = recipe(R1, 2, [ing('petto di pollo', 'g', 200, 'macelleria')]);
    const items = buildShoppingList([slot(r), slot(r)]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qty: 400, recipe_ids: [R1] });
  });

  it('merges qb ingredients into one row without quantity', () => {
    const items = buildShoppingList([
      slot(recipe(R1, 2, [ing('sale', 'qb', null)])),
      slot(recipe(R2, 2, [ing('sale', 'qb', null)])),
    ]);
    expect(items).toEqual([
      { canonical_name: 'sale', qty: null, unit: 'qb', category: 'dispensa', recipe_ids: [R1, R2] },
    ]);
  });

  it('absorbs a qb row into the measured row of the same name', () => {
    const items = buildShoppingList([
      slot(recipe(R1, 2, [ing('olio extravergine di oliva', 'qb', null)])),
      slot(recipe(R2, 2, [ing('olio extravergine di oliva', 'ml', 30)])),
    ]);
    expect(items).toEqual([
      {
        canonical_name: 'olio extravergine di oliva',
        qty: 30,
        unit: 'ml',
        category: 'dispensa',
        recipe_ids: [R1, R2],
      },
    ]);
  });

  it('keeps one row per unit when the same name is measured in different units, same category', () => {
    const items = buildShoppingList([
      slot(recipe(R1, 2, [ing('limone', 'pz', 1, 'ortofrutta')])),
      slot(recipe(R2, 2, [ing('limone', 'g', 50, 'ortofrutta')])),
    ]);
    expect(items.map((item) => [item.unit, item.category])).toEqual([
      ['g', 'ortofrutta'],
      ['pz', 'ortofrutta'],
    ]);
  });

  it('treats a gram ingredient without quantity as qb', () => {
    const items = buildShoppingList([slot(recipe(R1, 2, [ing('farina', 'g', null)]))]);
    expect(items).toEqual([
      { canonical_name: 'farina', qty: null, unit: 'qb', category: 'dispensa', recipe_ids: [R1] },
    ]);
  });

  it('merges names through the alias map', () => {
    const aliases = new Map([['pelati', 'pomodoro pelato']]);
    const items = buildShoppingList(
      [
        slot(recipe(R1, 2, [ing('pelati', 'g', 400)])),
        slot(recipe(R2, 2, [ing('pomodoro pelato', 'g', 400)])),
      ],
      aliases
    );
    expect(items).toEqual([
      {
        canonical_name: 'pomodoro pelato',
        qty: 800,
        unit: 'g',
        category: 'dispensa',
        recipe_ids: [R1, R2],
      },
    ]);
  });

  it('takes the majority category for a name', () => {
    const items = buildShoppingList([
      slot(recipe(R1, 2, [ing('uovo', 'pz', 2, 'banco-frigo')])),
      slot(recipe(R2, 2, [ing('uovo', 'pz', 2, 'banco-frigo')])),
      slot(recipe(R3, 2, [ing('uovo', 'pz', 2, 'dispensa')])),
    ]);
    expect(items[0]?.category).toBe('banco-frigo');
  });

  it('breaks a category tie with the earlier category in the aisle order', () => {
    const items = buildShoppingList([
      slot(recipe(R1, 2, [ing('uovo', 'pz', 2, 'dispensa')])),
      slot(recipe(R2, 2, [ing('uovo', 'pz', 2, 'banco-frigo')])),
    ]);
    expect(items[0]?.category).toBe('banco-frigo');
  });

  it('rounds the scaled quantity up', () => {
    const items = buildShoppingList([
      slot(recipe(R1, 3, [ing('riso', 'g', 100)]), 2),
    ]);
    expect(items[0]?.qty).toBe(70);
  });

  it('ignores slots without recipe, with zero servings or with zero base servings', () => {
    const r = recipe(R1, 2, [ing('riso', 'g', 100)]);
    expect(buildShoppingList([{ servings: 2, recipe: null }])).toEqual([]);
    expect(buildShoppingList([slot(r, 0)])).toEqual([]);
    expect(buildShoppingList([slot(recipe(R2, 0, [ing('riso', 'g', 100)]), 2)])).toEqual([]);
  });

  it('returns an empty list when there are no slots', () => {
    expect(buildShoppingList([])).toEqual([]);
  });

  it('orders rows by aisle, then by name', () => {
    const items = buildShoppingList([
      slot(
        recipe(R1, 2, [
          ing('farina', 'g', 100, 'dispensa'),
          ing('zucchina', 'pz', 1, 'ortofrutta'),
          ing('bistecca', 'g', 200, 'macelleria'),
          ing('basilico', 'g', 5, 'ortofrutta'),
        ])
      ),
    ]);
    expect(items.map((item) => item.canonical_name)).toEqual([
      'basilico',
      'zucchina',
      'bistecca',
      'farina',
    ]);
  });

  it('builds a consistent list from the fixtures', () => {
    const recipes = fixtureRecipesAsDomain();
    const slots = recipes.map((r) => ({ servings: r.servings_base, recipe: r }));
    const aliases = toAliasMap(FIXTURE_INGREDIENT_ALIASES);
    const items = buildShoppingList(slots, aliases);

    const producedNames = new Set(items.map((item) => item.canonical_name));
    const expectedNames = new Set(
      recipes.flatMap((r) => (r.ingredients ?? []).map((i) => normalizeCanonicalName(i.canonical_name)))
    );
    expect(producedNames).toEqual(expectedNames);

    const keys = items.map((item) => `${item.canonical_name}|${item.unit}`);
    expect(new Set(keys).size).toBe(keys.length);

    for (const item of items) {
      if (item.unit === 'qb') {
        expect(item.qty).toBeNull();
      } else {
        expect(Number.isInteger(item.qty)).toBe(true);
        expect(item.qty).toBeGreaterThan(0);
      }
    }

    const unitsByName = new Map<string, Set<Unit>>();
    for (const item of items) {
      const units = unitsByName.get(item.canonical_name) ?? new Set<Unit>();
      units.add(item.unit);
      unitsByName.set(item.canonical_name, units);
    }
    for (const units of unitsByName.values()) {
      if (units.has('qb')) expect(units.size).toBe(1);
    }

    const carrot = items.filter((item) => item.canonical_name === 'carota');
    expect(carrot.map((item) => item.unit).sort()).toEqual(['g', 'pz']);
    expect(new Set(carrot.map((item) => item.category)).size).toBe(1);
  });

  it('does not mutate the input slots', () => {
    const slots: ShoppingSlotInput[] = [
      slot(recipe(R1, 2, [ing('petto di pollo', 'g', 200, 'macelleria')]), 3),
      slot(recipe(R2, 2, [ing('sale', 'qb', null)])),
    ];
    const snapshot = structuredClone(slots);
    buildShoppingList(slots, new Map([['pelati', 'pomodoro pelato']]));
    expect(slots).toEqual(snapshot);
  });
});

describe('reconcileShoppingItems', () => {
  it('inserts a built item whose key is new', () => {
    const item = built('sale', 'g', 10);
    const changes = reconcileShoppingItems([], [item]);
    expect(changes).toEqual({ toInsert: [item], toUpdate: [], toDelete: [] });
  });

  it('deletes an existing item whose key is gone', () => {
    const changes = reconcileShoppingItems([existing('a', 'sale', 'g', 10, false)], []);
    expect(changes).toEqual({ toInsert: [], toUpdate: [], toDelete: ['a'] });
  });

  it('updates the same id when the key remains', () => {
    const item = built('sale', 'g', 120);
    const changes = reconcileShoppingItems([existing('a', 'sale', 'g', 100, false)], [item]);
    expect(changes).toEqual({
      toInsert: [],
      toUpdate: [{ id: 'a', item, checked: false }],
      toDelete: [],
    });
  });

  it.each([200, 150])('keeps a check when the new quantity %s is not above the old 200', (qty) => {
    const changes = reconcileShoppingItems(
      [existing('a', 'sale', 'g', 200, true)],
      [built('sale', 'g', qty)]
    );
    expect(changes.toUpdate[0]?.checked).toBe(true);
  });

  it('removes a check when the new quantity grows', () => {
    const changes = reconcileShoppingItems(
      [existing('a', 'sale', 'g', 200, true)],
      [built('sale', 'g', 250)]
    );
    expect(changes.toUpdate[0]?.checked).toBe(false);
  });

  it('keeps a checked qb item checked', () => {
    const changes = reconcileShoppingItems(
      [existing('a', 'sale', 'qb', null, true)],
      [built('sale', 'qb', null)]
    );
    expect(changes.toUpdate[0]?.checked).toBe(true);
  });

  it('keeps an unchecked item unchecked', () => {
    const changes = reconcileShoppingItems(
      [existing('a', 'sale', 'g', 100, false)],
      [built('sale', 'g', 50)]
    );
    expect(changes.toUpdate[0]?.checked).toBe(false);
  });

  it('treats the same name with another unit as a different key', () => {
    const qbItem = built('sale', 'qb', null);
    const changes = reconcileShoppingItems(
      [existing('a', 'sale', 'g', 100, false)],
      [qbItem]
    );
    expect(changes).toEqual({ toInsert: [qbItem], toUpdate: [], toDelete: ['a'] });
  });

  it('updates the item with the smallest id and deletes the duplicates', () => {
    const changes = reconcileShoppingItems(
      [
        existing('item-b', 'sale', 'g', 100, true),
        existing('item-a', 'sale', 'g', 100, false),
      ],
      [built('sale', 'g', 100)]
    );
    expect(changes.toUpdate).toHaveLength(1);
    expect(changes.toUpdate[0]).toMatchObject({ id: 'item-a', checked: false });
    expect(changes.toDelete).toEqual(['item-b']);
  });

  it('inserts everything when there are no existing items', () => {
    const items = [built('sale', 'g', 10), built('pepe', 'g', 2)];
    expect(reconcileShoppingItems([], items)).toEqual({
      toInsert: items,
      toUpdate: [],
      toDelete: [],
    });
  });

  it('deletes everything when nothing is built, sorted by id', () => {
    const changes = reconcileShoppingItems(
      [
        existing('c', 'sale', 'g', 10, false),
        existing('a', 'pepe', 'g', 2, false),
        existing('b', 'olio', 'ml', 5, true),
      ],
      []
    );
    expect(changes.toDelete).toEqual(['a', 'b', 'c']);
  });
});

describe('inferShoppingCategory', () => {
  const aliases = new Map([['pelati', 'pomodoro pelato']]);

  it('returns the category of an ingredient present in the library', () => {
    const recipes = [{ ingredients: [ing('branzino', 'g', 300, 'pescheria')] }];
    expect(inferShoppingCategory('branzino', recipes)).toBe('pescheria');
  });

  it('resolves an alias to the category of its canonical name', () => {
    const recipes = [{ ingredients: [ing('pomodoro pelato', 'g', 400, 'ortofrutta')] }];
    expect(inferShoppingCategory('pelati', recipes, aliases)).toBe('ortofrutta');
  });

  it('returns altro for an unknown name', () => {
    expect(inferShoppingCategory('sconosciuto', [{ ingredients: [ing('sale', 'qb', null)] }])).toBe('altro');
  });

  it('returns altro for a whitespace-only name', () => {
    expect(inferShoppingCategory('   ', [{ ingredients: [ing(' ', 'qb', null, 'pane')] }])).toBe('altro');
  });

  it('takes the majority category across recipes', () => {
    const recipes = [
      { ingredients: [ing('uovo', 'pz', 2, 'banco-frigo')] },
      { ingredients: [ing('uovo', 'pz', 2, 'banco-frigo')] },
      { ingredients: [ing('uovo', 'pz', 2, 'dispensa')] },
    ];
    expect(inferShoppingCategory('uovo', recipes)).toBe('banco-frigo');
  });

  it('breaks a tie with the earlier category in the aisle order', () => {
    const recipes = [
      { ingredients: [ing('uovo', 'pz', 2, 'dispensa')] },
      { ingredients: [ing('uovo', 'pz', 2, 'banco-frigo')] },
    ];
    expect(inferShoppingCategory('uovo', recipes)).toBe('banco-frigo');
  });
});

describe('compareShoppingItemsByAisle', () => {
  it('orders by category first', () => {
    const fruit = view('1', 'zucchina', { category: 'ortofrutta' });
    const bread = view('2', 'pane', { category: 'pane' });
    expect(compareShoppingItemsByAisle(fruit, bread)).toBeLessThan(0);
  });

  it('orders by name within a category', () => {
    const burro = view('1', 'burro', { category: 'banco-frigo' });
    const latte = view('2', 'latte', { category: 'banco-frigo' });
    expect(compareShoppingItemsByAisle(burro, latte)).toBeLessThan(0);
  });

  it('orders by unit, with a manual item (null unit) last', () => {
    const grams = view('1', 'sale', { unit: 'g' });
    const pieces = view('2', 'sale', { unit: 'pz' });
    const manual = view('3', 'sale', { unit: null, manual: true, recipe_ids: [] });
    expect(compareShoppingItemsByAisle(grams, pieces)).toBeLessThan(0);
    expect(compareShoppingItemsByAisle(pieces, manual)).toBeLessThan(0);
  });

  it('orders by id as the last criterion', () => {
    const first = view('a', 'sale');
    const second = view('b', 'sale');
    expect(compareShoppingItemsByAisle(first, second)).toBeLessThan(0);
    expect(compareShoppingItemsByAisle(second, first)).toBeGreaterThan(0);
  });
});

describe('groupShoppingItems', () => {
  it('returns only non-empty sections, in aisle order', () => {
    const groups = groupShoppingItems([
      view('1', 'pane', { category: 'pane' }),
      view('2', 'basilico', { category: 'ortofrutta' }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(['ortofrutta', 'pane']);
    expect(groups[0]?.label).toBe('Ortofrutta');
  });

  it('orders a section by name and leaves a checked item in its place', () => {
    const [section] = groupShoppingItems([
      view('2', 'zucchero', { category: 'dispensa' }),
      view('1', 'aceto', { category: 'dispensa', checked: true }),
      view('3', 'farina', { category: 'dispensa' }),
    ]);
    expect(section?.items.map((item) => item.canonical_name)).toEqual([
      'aceto',
      'farina',
      'zucchero',
    ]);
  });

  it('gives the same order whatever is checked', () => {
    const names = (checkedId: string | null): string[] =>
      groupShoppingItems(
        ['aceto', 'farina', 'zucchero'].map((name, index) =>
          view(String(index + 1), name, {
            category: 'dispensa',
            checked: String(index + 1) === checkedId,
          })
        )
      ).flatMap((section) => section.items.map((item) => item.canonical_name));

    expect(names('1')).toEqual(names(null));
    expect(names('2')).toEqual(names(null));
  });

  it('reports checked and total counts per section', () => {
    const [section] = groupShoppingItems([
      view('1', 'aceto', { category: 'dispensa', checked: true }),
      view('2', 'zucchero', { category: 'dispensa' }),
      view('3', 'sale', { category: 'dispensa', unit: 'qb', qty: null }),
    ]);
    expect(section).toMatchObject({ checked: 1, total: 3 });
  });

  it('places a manual item after the generated item with the same name', () => {
    const [section] = groupShoppingItems([
      view('1', 'sale', { unit: null, manual: true, recipe_ids: [] }),
      view('2', 'sale', { unit: 'g' }),
    ]);
    expect(section?.items.map((item) => item.unit)).toEqual(['g', null]);
  });

  it('does not mutate the input', () => {
    const items = [
      view('1', 'aceto', { checked: true }),
      view('2', 'zucchero'),
    ];
    const snapshot = structuredClone(items);
    groupShoppingItems(items);
    expect(items).toEqual(snapshot);
  });
});

describe('shoppingProgress', () => {
  it('counts checked items against the total', () => {
    expect(shoppingProgress([{ checked: true }, { checked: false }, { checked: true }])).toEqual({
      checked: 2,
      total: 3,
    });
  });

  it('returns zeros for an empty list', () => {
    expect(shoppingProgress([])).toEqual({ checked: 0, total: 0 });
  });
});

describe('formatShoppingQuantity', () => {
  it.each([
    [300, 'g', '300 g'],
    [1000, 'g', '1 kg'],
    [1250, 'g', '1,25 kg'],
    [1500, 'ml', '1,5 l'],
    [2, 'pz', '2 pz'],
    [null, 'qb', 'q.b.'],
    [null, null, ''],
  ] as const)('formats (%s, %s) as %j', (qty, unit, expected) => {
    expect(formatShoppingQuantity(qty, unit)).toBe(expected);
  });

  it('returns an empty string for a measured unit without quantity', () => {
    expect(formatShoppingQuantity(null, 'g')).toBe('');
  });
});

describe('shoppingItemLabel', () => {
  it('capitalizes the first letter only', () => {
    expect(shoppingItemLabel('petto di pollo')).toBe('Petto di pollo');
  });

  it('returns an empty string for an empty name', () => {
    expect(shoppingItemLabel('')).toBe('');
  });
});

describe('pickDefaultShoppingPlan', () => {
  it('returns null for no plans', () => {
    expect(pickDefaultShoppingPlan([])).toBeNull();
  });

  it('returns the only plan when it has no list', () => {
    expect(pickDefaultShoppingPlan([planRef('p1', '2026-10-05', false)])).toBe('p1');
  });

  it('returns the latest plan when none has a list', () => {
    const plans = [planRef('early', '2026-09-28', false), planRef('late', '2026-10-05', false)];
    expect(pickDefaultShoppingPlan(plans)).toBe('late');
  });

  it('prefers a plan with a list over a later plan without one', () => {
    const plans = [planRef('with-list', '2026-09-28', true), planRef('later', '2026-10-05', false)];
    expect(pickDefaultShoppingPlan(plans)).toBe('with-list');
  });

  it('returns the latest of the plans with a list', () => {
    const plans = [planRef('early', '2026-09-28', true), planRef('late', '2026-10-05', true)];
    expect(pickDefaultShoppingPlan(plans)).toBe('late');
  });
});

describe('purity of lib/domain/shopping-list.ts and plan-status.ts', () => {
  const readDomainFile = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../../lib/domain/${name}`, import.meta.url)), 'utf8');

  const importSpecifiers = (source: string): string[] =>
    [...source.matchAll(/^import\s[^;]*?\sfrom\s+'([^']+)'/gm)].map((match) => match[1] ?? '');

  it('imports only from ./types and ./recipe-text in shopping-list.ts', () => {
    const specifiers = importSpecifiers(readDomainFile('shopping-list.ts'));
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(['./types', './recipe-text']).toContain(specifier);
    }
  });

  it('imports only from ./types in plan-status.ts', () => {
    const specifiers = importSpecifiers(readDomainFile('plan-status.ts'));
    expect(specifiers).toEqual(['./types']);
  });
});
