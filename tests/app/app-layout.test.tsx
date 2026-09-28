// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSettings } from "@/lib/settings/service";
import AppLayout from "@/app/(app)/layout";
import type { SettingsView } from "@/lib/domain/types";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  usePathname: () => "/",
}));
vi.mock("@/lib/settings/service", () => ({ getSettings: vi.fn() }));

function makeSettings(onboarded: boolean): SettingsView {
  return {
    persons: 2,
    meals: ["pranzo", "cena"],
    meal_style_tags: [],
    diet_tags: [],
    appliances: [],
    onboarded,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("AppLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /benvenuto when the household is not onboarded", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(makeSettings(false));

    await expect(AppLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/benvenuto");
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("renders children and the bottom nav when the household is onboarded", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(makeSettings(true));

    const result = await AppLayout({ children: null });

    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
