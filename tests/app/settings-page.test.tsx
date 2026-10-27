// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings/service";
import { listIngredientPrefs } from "@/lib/prefs/service";
import { SettingsEditor } from "@/components/settings/settings-editor";
import SettingsPage from "@/app/(app)/impostazioni/page";
import { DEFAULT_MEAL_COMPOSITIONS, type IngredientPrefsView, type SettingsView } from "@/lib/domain/types";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/settings/service", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/prefs/service", () => ({ listIngredientPrefs: vi.fn() }));

function makeSettings(): SettingsView {
  return {
    persons: 3,
    meals: ["pranzo", "cena"],
    meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
    meal_style_tags: ["veloce"],
    diet_tags: ["vegetariano"],
    appliances: ["fornelli", "forno"],
    onboarded: true,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits connection, loads settings from the service, and renders SettingsEditor with them", async () => {
    const settings = makeSettings();
    const ingredientPrefs: IngredientPrefsView = {
      likes: [],
      dislikes: [{ canonical_name: "cipolla", pref: "dislike", recipes_count: 2 }],
    };
    vi.mocked(getSettings).mockResolvedValueOnce(settings);
    vi.mocked(listIngredientPrefs).mockResolvedValueOnce(ingredientPrefs);

    const element = await SettingsPage();

    expect(connection).toHaveBeenCalledTimes(1);
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(element.type).toBe(SettingsEditor);
    expect(listIngredientPrefs).toHaveBeenCalledTimes(1);
    expect(element.props.initialSettings).toEqual(settings);
    expect(element.props.initialIngredientPrefs).toEqual(ingredientPrefs);
  });
});
