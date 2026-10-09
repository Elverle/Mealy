// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from "next/server";
import { getShoppingScreen } from "@/lib/shopping/service";
import { ShoppingScreen } from "@/components/shopping/shopping-screen";
import ShoppingListPage from "@/app/(app)/lista/page";
import type { ShoppingScreenView } from "@/lib/domain/types";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/shopping/service", () => ({ getShoppingScreen: vi.fn() }));

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAN_ID = "33333333-3333-4333-8333-333333333333";

function makeScreen(selectedPlanId: string | null): ShoppingScreenView {
  const plan = {
    id: PLAN_ID,
    week_start: "2026-09-28",
    last_day: "2026-10-04",
    status: "active" as const,
    has_list: true,
  };
  return {
    plans: [plan],
    selected:
      selectedPlanId === null
        ? null
        : {
            plan: { ...plan, id: selectedPlanId },
            editable: true,
            can_build: true,
            list: null,
          },
  };
}

describe("ShoppingListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits connection, then loads the screen for the planId in the query string", async () => {
    const screen = makeScreen(PLAN_ID);
    vi.mocked(getShoppingScreen).mockResolvedValueOnce(screen);

    const element = await ShoppingListPage({
      searchParams: Promise.resolve({ piano: PLAN_ID }),
    });

    expect(connection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(connection).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getShoppingScreen).mock.invocationCallOrder[0]
    );
    expect(getShoppingScreen).toHaveBeenCalledWith({ planId: PLAN_ID });
    expect(element.type).toBe(ShoppingScreen);
    expect(element.props.initialScreen).toEqual(screen);
    expect(element.key).toBe(PLAN_ID);
  });

  it("passes an undefined planId when the query string has no piano parameter", async () => {
    vi.mocked(getShoppingScreen).mockResolvedValueOnce(makeScreen(PLAN_ID));

    await ShoppingListPage({ searchParams: Promise.resolve({}) });

    expect(getShoppingScreen).toHaveBeenCalledWith({ planId: undefined });
  });

  it("uses the first value when piano is repeated in the query string", async () => {
    vi.mocked(getShoppingScreen).mockResolvedValueOnce(makeScreen(OTHER_PLAN_ID));

    await ShoppingListPage({
      searchParams: Promise.resolve({ piano: [OTHER_PLAN_ID, PLAN_ID] }),
    });

    expect(getShoppingScreen).toHaveBeenCalledWith({ planId: OTHER_PLAN_ID });
  });

  it("keys the screen with 'none' when there is no plan to show", async () => {
    const screen = makeScreen(null);
    vi.mocked(getShoppingScreen).mockResolvedValueOnce(screen);

    const element = await ShoppingListPage({ searchParams: Promise.resolve({}) });

    expect(element.key).toBe("none");
    expect(element.props.initialScreen).toEqual(screen);
  });
});
