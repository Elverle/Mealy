import { describe, it, expect } from 'vitest';
import {
  AddShoppingItemRequestSchema,
  PlanShoppingListViewSchema,
  SHOPPING_ITEM_NAME_MAX,
  ShoppingItemViewSchema,
  ShoppingScreenViewSchema,
  UpdateShoppingItemRequestSchema,
} from '@/lib/domain/types';

const ITEM_ID = '00000000-0000-4000-8000-000000000101';
const RECIPE_ID = '00000000-0000-4000-8000-000000000201';
const LIST_ID = '00000000-0000-4000-8000-000000000301';
const PLAN_ID = '00000000-0000-4000-8000-000000000401';

const GENERATED_ITEM = {
  id: ITEM_ID,
  canonical_name: 'petto di pollo',
  qty: 300,
  unit: 'g',
  category: 'macelleria',
  checked: false,
  manual: false,
  recipe_ids: [RECIPE_ID],
};

const MANUAL_ITEM = {
  id: ITEM_ID,
  canonical_name: 'carta forno',
  qty: null,
  unit: null,
  category: 'altro',
  checked: false,
  manual: true,
  recipe_ids: [],
};

const PLAN_REF = {
  id: PLAN_ID,
  week_start: '2026-10-05',
  last_day: '2026-10-11',
  status: 'active',
  has_list: false,
};

describe('UpdateShoppingItemRequestSchema', () => {
  it('accepts a checked flag', () => {
    expect(UpdateShoppingItemRequestSchema.safeParse({ checked: true }).success).toBe(true);
  });

  it('rejects an empty body, a non-boolean flag and extra fields', () => {
    expect(UpdateShoppingItemRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateShoppingItemRequestSchema.safeParse({ checked: 'si' }).success).toBe(false);
    expect(UpdateShoppingItemRequestSchema.safeParse({ checked: true, qty: 2 }).success).toBe(false);
  });
});

describe('AddShoppingItemRequestSchema', () => {
  it('trims the name', () => {
    const parsed = AddShoppingItemRequestSchema.parse({ name: ' latte ' });
    expect(parsed.name).toBe('latte');
  });

  it('rejects a blank name', () => {
    expect(AddShoppingItemRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('accepts a name of exactly the maximum length and rejects one character more', () => {
    expect(SHOPPING_ITEM_NAME_MAX).toBe(80);
    expect(AddShoppingItemRequestSchema.safeParse({ name: 'a'.repeat(80) }).success).toBe(true);
    expect(AddShoppingItemRequestSchema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(AddShoppingItemRequestSchema.safeParse({ name: 'latte', checked: true }).success).toBe(false);
  });
});

describe('ShoppingItemViewSchema', () => {
  it('accepts a generated item', () => {
    expect(ShoppingItemViewSchema.safeParse(GENERATED_ITEM).success).toBe(true);
  });

  it('accepts a manual item without unit, quantity or recipes', () => {
    expect(ShoppingItemViewSchema.safeParse(MANUAL_ITEM).success).toBe(true);
  });

  it('rejects a zero quantity', () => {
    expect(ShoppingItemViewSchema.safeParse({ ...GENERATED_ITEM, qty: 0 }).success).toBe(false);
  });

  it('rejects a unit outside the closed enum', () => {
    expect(ShoppingItemViewSchema.safeParse({ ...GENERATED_ITEM, unit: 'kg' }).success).toBe(false);
  });
});

describe('PlanShoppingListViewSchema', () => {
  it('accepts a plan without a shopping list yet', () => {
    const result = PlanShoppingListViewSchema.safeParse({
      plan: PLAN_REF,
      editable: true,
      can_build: true,
      list: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('ShoppingScreenViewSchema', () => {
  it('accepts an empty screen', () => {
    expect(ShoppingScreenViewSchema.safeParse({ plans: [], selected: null }).success).toBe(true);
  });

  it('accepts a screen with a selected plan and its list', () => {
    const result = ShoppingScreenViewSchema.safeParse({
      plans: [PLAN_REF],
      selected: {
        plan: PLAN_REF,
        editable: true,
        can_build: true,
        list: {
          id: LIST_ID,
          generated_at: '2026-10-08T10:00:00.000Z',
          needs_regeneration: false,
          items: [GENERATED_ITEM, MANUAL_ITEM],
          recipes: [{ id: RECIPE_ID, title: 'Petto di pollo al limone' }],
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
