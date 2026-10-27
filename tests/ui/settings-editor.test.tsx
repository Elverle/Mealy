import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsEditor } from "@/components/settings/settings-editor";
import { SETTINGS_FIELD_COPY } from "@/components/settings/settings-fields";
import { DEFAULT_HOUSEHOLD, DEFAULT_MEAL_COMPOSITIONS, type SettingsView, type SaveSettingsResult } from "@/lib/domain/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/settings/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/settings/client")>()),
  putSettings: vi.fn(),
}));

import { putSettings } from "@/lib/settings/client";

const FIXTURE: SettingsView = {
  persons: DEFAULT_HOUSEHOLD.persons,
  meals: DEFAULT_HOUSEHOLD.meals,
  meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
  meal_style_tags: DEFAULT_HOUSEHOLD.meal_style_tags,
  diet_tags: DEFAULT_HOUSEHOLD.diet_tags,
  appliances: DEFAULT_HOUSEHOLD.appliances,
  onboarded: true,
  updated_at: "2026-01-01T00:00:00.000Z",
};

const BANNER_TEXT = "Il prossimo piano userà i nuovi vincoli.";

function renderEditor() {
  return render(<SettingsEditor initialSettings={FIXTURE} />);
}

// `PersonsField` renders an `<output aria-live="polite">`, which also has an
// implicit ARIA role of "status": query the banner by its unique text instead
// of `getByRole("status")`, which would otherwise match both elements.
function queryBanner() {
  return screen.queryByText(BANNER_TEXT);
}

beforeEach(() => {
  vi.mocked(putSettings).mockReset();
  refresh.mockClear();
});

describe("SettingsEditor", () => {
  it("lists a discarded ingredient under Scartati and keeps Salva disabled", () => {
    render(
      <SettingsEditor
        initialSettings={FIXTURE}
        initialIngredientPrefs={{
          likes: [],
          dislikes: [{ canonical_name: "cipolla", pref: "dislike", recipes_count: 2 }],
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Scartati" })).toBeInTheDocument();
    expect(screen.getByText("Cipolla")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();
  });

  it("starts with Salva disabled, no banner, and shows the 5 field titles plus the ingredient section", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();
    expect(queryBanner()).not.toBeInTheDocument();
    for (const copy of Object.values(SETTINGS_FIELD_COPY)) {
      expect(screen.getByText(copy.title)).toBeInTheDocument();
    }
    expect(screen.getByText("I miei ingredienti")).toBeInTheDocument();
  });

  it("keeps the status container mounted (for screen readers) even with no banner text", () => {
    renderEditor();

    // `PersonsField`'s `<output>` also carries the implicit "status" role, so
    // two elements are expected: it and the always-mounted banner container.
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(queryBanner()).not.toBeInTheDocument();
  });

  it("enables Salva after toggling Vegano, and disables it again once toggled back off", () => {
    renderEditor();
    const veganoChip = screen.getByRole("checkbox", { name: "Vegano" });

    fireEvent.click(veganoChip);
    expect(screen.getByRole("button", { name: "Salva" })).toBeEnabled();

    fireEvent.click(veganoChip);
    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();
  });

  it("saves the draft, shows the banner when changed is true, and hides it when dismissed", async () => {
    const result: SaveSettingsResult = {
      settings: { ...FIXTURE, diet_tags: ["vegano"] },
      changed: true,
    };
    vi.mocked(putSettings).mockResolvedValueOnce(result);
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    const banner = await screen.findByText(BANNER_TEXT);
    expect(banner.closest('[role="status"]')).toBeInTheDocument();

    expect(putSettings).toHaveBeenCalledTimes(1);
    expect(putSettings).toHaveBeenCalledWith({
      persons: FIXTURE.persons,
      meals: FIXTURE.meals,
      meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
      meal_style_tags: FIXTURE.meal_style_tags,
      diet_tags: ["vegano"],
      appliances: FIXTURE.appliances,
    });

    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Chiudi avviso" }));
    expect(queryBanner()).not.toBeInTheDocument();
  });

  it("does not show the banner when the save reports changed: false", async () => {
    const result: SaveSettingsResult = {
      settings: { ...FIXTURE, diet_tags: ["vegano"] },
      changed: false,
    };
    vi.mocked(putSettings).mockResolvedValueOnce(result);
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled());
    expect(queryBanner()).not.toBeInTheDocument();
  });

  it("calls router.refresh once after a successful save that reports changed: true", async () => {
    const result: SaveSettingsResult = {
      settings: { ...FIXTURE, diet_tags: ["vegano"] },
      changed: true,
    };
    vi.mocked(putSettings).mockResolvedValueOnce(result);
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    await screen.findByText(BANNER_TEXT);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("calls router.refresh once after a successful save that reports changed: false", async () => {
    const result: SaveSettingsResult = {
      settings: { ...FIXTURE, diet_tags: ["vegano"] },
      changed: false,
    };
    vi.mocked(putSettings).mockResolvedValueOnce(result);
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not call router.refresh when putSettings rejects", async () => {
    vi.mocked(putSettings).mockRejectedValueOnce(new Error("boom"));
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    await screen.findByRole("alert");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows an error message on save failure, keeps Salva enabled, and clears the error on a new change", async () => {
    vi.mocked(putSettings).mockRejectedValueOnce(new Error("boom"));
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Non sono riuscito a salvare. Riprova."
    );
    expect(screen.getByRole("button", { name: "Salva" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegetariano" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the warning and disables Salva when every meal is deselected", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Pranzo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Cena" }));

    expect(screen.getByText("Scegli almeno un pasto.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();
  });

  it("shows a saving indicator and disables Salva while the save is pending", async () => {
    let resolveSave: (value: SaveSettingsResult) => void = () => {};
    vi.mocked(putSettings).mockImplementationOnce(
      () =>
        new Promise<SaveSettingsResult>((resolve) => {
          resolveSave = resolve;
        })
    );
    renderEditor();

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    expect(screen.getByRole("button", { name: "Salvataggio…" })).toBeDisabled();

    resolveSave({ settings: { ...FIXTURE, diet_tags: ["vegano"] }, changed: true });
    await screen.findByText(BANNER_TEXT);
  });

  it("disables the field chips while a save is pending, and blocks clicks on them", async () => {
    // `fireEvent.click` dispatches a raw DOM click that bypasses the
    // browser's native "disabled via ancestor fieldset" activation check,
    // which jsdom does not implement (jsdom does not propagate `disabled`
    // from a `<fieldset disabled>` to descendant `.disabled` IDL
    // properties, unlike real browsers). `userEvent`, like jest-dom's
    // `toBeDisabled()`, evaluates the same disabled-via-fieldset algorithm
    // itself, so it correctly reproduces real-browser click-blocking here.
    const user = userEvent.setup();
    let resolveSave: (value: SaveSettingsResult) => void = () => {};
    vi.mocked(putSettings).mockImplementationOnce(
      () =>
        new Promise<SaveSettingsResult>((resolve) => {
          resolveSave = resolve;
        })
    );
    renderEditor();

    const veganoChip = screen.getByRole("checkbox", { name: "Vegano" });
    fireEvent.click(veganoChip);
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));

    expect(veganoChip).toBeDisabled();
    await user.click(veganoChip);
    expect(veganoChip).toHaveAttribute("aria-checked", "true");

    resolveSave({ settings: { ...FIXTURE, diet_tags: ["vegano"] }, changed: false });
    await waitFor(() => expect(veganoChip).toBeEnabled());
  });
});
