// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSettings } from "@/lib/settings/service";
import { OnboardingWizard } from "@/components/settings/onboarding-wizard";
import WelcomePage from "@/app/benvenuto/page";
import type { SettingsView } from "@/lib/domain/types";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
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

describe("WelcomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when the household is already onboarded", async () => {
    vi.mocked(getSettings).mockResolvedValueOnce(makeSettings(true));

    await expect(WelcomePage()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/");
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("renders OnboardingWizard with the fetched settings when not onboarded", async () => {
    const settings = makeSettings(false);
    vi.mocked(getSettings).mockResolvedValueOnce(settings);

    const result = await WelcomePage();

    expect(redirect).not.toHaveBeenCalled();
    expect(connection).toHaveBeenCalledTimes(1);
    expect(result.type).toBe(OnboardingWizard);
    expect(result.props.initialSettings).toEqual(settings);
  });
});
