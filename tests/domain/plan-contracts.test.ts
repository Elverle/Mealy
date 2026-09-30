// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  GeneratePlanRequestSchema,
  PlanScreenViewSchema,
  SWAP_EXCLUDE_MAX,
  SwapSlotRequestSchema,
  UpdateSlotRequestSchema,
} from '@/lib/domain/types';

const TARGET = { week_start: '2026-09-28', first_day: '2026-09-30', last_day: '2026-10-04' };

function exampleScreen(overrides: Record<string, unknown> = {}) {
  return {
    today: '2026-09-30',
    current_week_start: '2026-09-28',
    target: TARGET,
    view: { week: TARGET, plan: null, action: 'generate', editable: false, can_repeat: false },
    prev_week_start: null,
    next_week_start: null,
    target_plan_status: null,
    current_plan_id: null,
    ...overrides,
  };
}

describe('plan contracts', () => {
  describe('SwapSlotRequestSchema', () => {
    it('defaults exclude_recipe_ids to []', () => {
      expect(SwapSlotRequestSchema.parse({})).toEqual({ exclude_recipe_ids: [] });
    });

    it('rejects more than SWAP_EXCLUDE_MAX ids', () => {
      const ids = Array.from(
        { length: SWAP_EXCLUDE_MAX + 1 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      );
      expect(SwapSlotRequestSchema.safeParse({ exclude_recipe_ids: ids }).success).toBe(false);
    });

    it('rejects extra keys', () => {
      expect(SwapSlotRequestSchema.safeParse({ foo: 1 }).success).toBe(false);
    });
  });

  it('GeneratePlanRequestSchema rejects any key', () => {
    expect(GeneratePlanRequestSchema.safeParse({ week_start: 'x' }).success).toBe(false);
    expect(GeneratePlanRequestSchema.safeParse({}).success).toBe(true);
  });

  it('UpdateSlotRequestSchema requires a boolean locked', () => {
    expect(UpdateSlotRequestSchema.safeParse({ locked: 'si' }).success).toBe(false);
    expect(UpdateSlotRequestSchema.parse({ locked: true })).toEqual({ locked: true });
  });

  describe('PlanScreenViewSchema', () => {
    it('accepts an example with null plan and null prev/next', () => {
      expect(PlanScreenViewSchema.safeParse(exampleScreen()).success).toBe(true);
    });

    it('accepts valued prev/next dates', () => {
      const result = PlanScreenViewSchema.safeParse(
        exampleScreen({ prev_week_start: '2026-09-21', next_week_start: '2026-10-05' })
      );
      expect(result.success).toBe(true);
    });

    it('rejects a malformed date and an unknown action', () => {
      expect(PlanScreenViewSchema.safeParse(exampleScreen({ today: '30/09/2026' })).success).toBe(false);
      const bad = exampleScreen({
        view: { week: TARGET, plan: null, action: 'boh', editable: false, can_repeat: false },
      });
      expect(PlanScreenViewSchema.safeParse(bad).success).toBe(false);
    });
  });
});
