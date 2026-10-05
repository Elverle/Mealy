// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from "next/server";
import { listLibraryCards } from "@/lib/library/service";
import { getSettings } from "@/lib/settings/service";
import { LibraryScreen } from "@/components/library/library-screen";
import LibraryPage from "@/app/(app)/libreria/page";
import { toLibraryCard } from "@/lib/domain/library";
import { fixtureRecipesAsDomain } from "@/fixtures";
import type { SettingsView } from "@/lib/domain/types";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/library/service", () => ({ listLibraryCards: vi.fn() }));
vi.mock("@/lib/settings/service", () => ({ getSettings: vi.fn() }));

const SETTINGS: SettingsView = {
  persons: 3,
  meals: ["pranzo", "cena"],
  meal_style_tags: ["veloce"],
  diet_tags: [],
  appliances: ["fornelli"],
  onboarded: true,
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("LibraryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits connection, loads cards and settings, and renders LibraryScreen with them", async () => {
    const cards = fixtureRecipesAsDomain().slice(0, 2).map(toLibraryCard);
    vi.mocked(listLibraryCards).mockResolvedValueOnce(cards);
    vi.mocked(getSettings).mockResolvedValueOnce(SETTINGS);

    const element = await LibraryPage();

    expect(connection).toHaveBeenCalledTimes(1);
    expect(listLibraryCards).toHaveBeenCalledTimes(1);
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(element.type).toBe(LibraryScreen);
    expect(element.props.initialRecipes).toEqual(cards);
    expect(element.props.persons).toBe(3);
  });
});
