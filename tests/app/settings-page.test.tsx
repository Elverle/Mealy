// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings/service";
import { SettingsEditor } from "@/components/settings/settings-editor";
import SettingsPage from "@/app/(app)/impostazioni/page";
import type { SettingsView } from "@/lib/domain/types";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/settings/service", () => ({ getSettings: vi.fn() }));

function makeSettings(): SettingsView {
  return {
    persons: 3,
    meals: ["pranzo", "cena"],
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
    vi.mocked(getSettings).mockResolvedValueOnce(settings);

    const element = await SettingsPage();

    expect(connection).toHaveBeenCalledTimes(1);
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(element.type).toBe(SettingsEditor);
    expect(element.props.initialSettings).toEqual(settings);
  });
});
