// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from "next/server";
import { getPlanScreen } from "@/lib/plans/service";
import { PlanScreen } from "@/components/plan/plan-screen";
import PlanPage from "@/app/(app)/page";
import type { PlanScreenView } from "@/lib/domain/types";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/plans/service", () => ({ getPlanScreen: vi.fn() }));

function makeScreen(weekStart: string): PlanScreenView {
  return {
    today: "2026-09-30",
    current_week_start: "2026-09-28",
    target: { week_start: "2026-09-28", first_day: "2026-09-30", last_day: "2026-10-04" },
    view: {
      week: { week_start: weekStart, first_day: weekStart, last_day: "2026-10-04" },
      plan: null,
      action: "generate",
      editable: false,
      can_repeat: false,
    },
    prev_week_start: null,
    next_week_start: null,
    target_plan_status: null,
    current_plan_id: null,
  };
}

describe("Plan page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits connection, loads the screen and renders PlanScreen keyed by the shown week", async () => {
    const screen = makeScreen("2026-09-28");
    vi.mocked(getPlanScreen).mockResolvedValueOnce(screen);

    const element = await PlanPage({ searchParams: Promise.resolve({}) });

    expect(connection).toHaveBeenCalledTimes(1);
    expect(getPlanScreen).toHaveBeenCalledTimes(1);
    expect(getPlanScreen).toHaveBeenCalledWith({ week: undefined });
    expect(element.type).toBe(PlanScreen);
    expect(element.props.initialScreen).toEqual(screen);
    expect(element.key).toBe("2026-09-28");
  });

  it("forwards the settimana search param as the requested week", async () => {
    vi.mocked(getPlanScreen).mockResolvedValueOnce(makeScreen("2026-09-21"));

    const element = await PlanPage({ searchParams: Promise.resolve({ settimana: "2026-09-21" }) });

    expect(getPlanScreen).toHaveBeenCalledWith({ week: "2026-09-21" });
    expect(element.key).toBe("2026-09-21");
  });

  it("uses only the first value when settimana is repeated", async () => {
    vi.mocked(getPlanScreen).mockResolvedValueOnce(makeScreen("2026-09-21"));

    await PlanPage({ searchParams: Promise.resolve({ settimana: ["2026-09-21", "2026-09-14"] }) });

    expect(getPlanScreen).toHaveBeenCalledWith({ week: "2026-09-21" });
  });
});
