import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { IngredientPrefsSection } from "@/components/settings/ingredient-prefs-section";
import {
  EMPTY_INGREDIENT_PREFS_VIEW,
  type IngredientPrefsView,
  type SetIngredientPrefResult,
} from "@/lib/domain/types";

vi.mock("@/lib/prefs/client", () => ({ putIngredientPref: vi.fn() }));

import { putIngredientPref } from "@/lib/prefs/client";

const INTRO = "Qui ritroverai gli ingredienti che segni con 👍 o 👎 nelle ricette.";

const FULL: IngredientPrefsView = {
  likes: [
    { canonical_name: "basilico", pref: "like", recipes_count: 1 },
    { canonical_name: "zucchine", pref: "like", recipes_count: 4 },
    { canonical_name: "aglio", pref: "like", recipes_count: 0 },
  ],
  dislikes: [
    { canonical_name: "cipolla", pref: "dislike", recipes_count: 1 },
    { canonical_name: "peperoni", pref: "dislike", recipes_count: 3 },
  ],
};

function removed(name: string): SetIngredientPrefResult {
  return { canonical_name: name, pref: null, recipes_count: 0 };
}

beforeEach(() => {
  vi.mocked(putIngredientPref).mockReset();
});

describe("IngredientPrefsSection", () => {
  it("shows only the intro sentence when both lists are empty", () => {
    render(<IngredientPrefsSection initialPrefs={EMPTY_INGREDIENT_PREFS_VIEW} />);

    expect(screen.getByRole("heading", { name: "I miei ingredienti" })).toBeInTheDocument();
    expect(screen.getByText(INTRO)).toBeInTheDocument();
    expect(screen.queryByText("Mi piacciono")).not.toBeInTheDocument();
    expect(screen.queryByText("Scartati")).not.toBeInTheDocument();
  });

  it("renders both groups with capitalized names", () => {
    render(<IngredientPrefsSection initialPrefs={FULL} />);

    expect(screen.getByRole("heading", { name: "Mi piacciono" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scartati" })).toBeInTheDocument();
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument();
    expect(screen.getByText("Basilico")).toBeInTheDocument();
    expect(screen.getByText("Cipolla")).toBeInTheDocument();
  });

  it("shows the four count forms and omits the count at zero", () => {
    render(<IngredientPrefsSection initialPrefs={FULL} />);

    expect(screen.getByText("in 1 ricetta")).toBeInTheDocument();
    expect(screen.getByText("in 4 ricette")).toBeInTheDocument();
    expect(screen.getByText("esclude 1 ricetta")).toBeInTheDocument();
    expect(screen.getByText("esclude 3 ricette")).toBeInTheDocument();
    expect(screen.queryByText("in 0 ricette")).not.toBeInTheDocument();
    expect(screen.getByText("Aglio").closest("li")).not.toHaveTextContent("ricett");
  });

  it("shows 'Nessuno per ora.' for an empty group", () => {
    render(
      <IngredientPrefsSection
        initialPrefs={{ likes: [], dislikes: FULL.dislikes }}
      />
    );

    expect(screen.getByText("Nessuno per ora.")).toBeInTheDocument();
    expect(screen.getByText("Cipolla")).toBeInTheDocument();
  });

  it("removes an entry immediately and calls putIngredientPref with null", async () => {
    let resolve: (v: SetIngredientPrefResult) => void = () => {};
    vi.mocked(putIngredientPref).mockImplementationOnce(
      () => new Promise<SetIngredientPrefResult>((r) => (resolve = r))
    );
    render(<IngredientPrefsSection initialPrefs={FULL} />);

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi cipolla" }));

    expect(putIngredientPref).toHaveBeenCalledWith("cipolla", null);
    expect(screen.queryByText("Cipolla")).not.toBeInTheDocument();
    expect(screen.getByText("Peperoni")).toBeInTheDocument();

    resolve(removed("cipolla"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByText("Cipolla")).not.toBeInTheDocument();
  });

  it("restores the entry in sorted order and shows an alert when removal fails", async () => {
    vi.mocked(putIngredientPref).mockRejectedValueOnce(new Error("boom"));
    render(<IngredientPrefsSection initialPrefs={FULL} />);

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi basilico" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Non sono riuscito a rimuovere basilico. Riprova."
    );
    const names = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "")
      .filter((t) => /^(Aglio|Basilico|Zucchine)/.test(t))
      .map((t) => t.split(/in \d/)[0]);
    expect(names[0]).toMatch(/^Aglio/);
    expect(names[1]).toMatch(/^Basilico/);
    expect(names[2]).toMatch(/^Zucchine/);
  });

  it("clears a previous error on a new removal", async () => {
    vi.mocked(putIngredientPref).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(putIngredientPref).mockResolvedValueOnce(removed("peperoni"));
    render(<IngredientPrefsSection initialPrefs={FULL} />);

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi cipolla" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Rimuovi peperoni" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("replaces its state when a new initialPrefs prop arrives", () => {
    const { rerender } = render(<IngredientPrefsSection initialPrefs={FULL} />);

    rerender(
      <IngredientPrefsSection
        initialPrefs={{
          likes: [],
          dislikes: [{ canonical_name: "melanzane", pref: "dislike", recipes_count: 2 }],
        }}
      />
    );

    expect(screen.queryByText("Basilico")).not.toBeInTheDocument();
    expect(screen.getByText("Melanzane")).toBeInTheDocument();
    expect(screen.getByText("Nessuno per ora.")).toBeInTheDocument();
  });

  describe("focus and announcement after a removal", () => {
    function removeWithFocus(name: string): void {
      const button = screen.getByRole("button", { name: `Rimuovi ${name}` });
      button.focus();
      fireEvent.click(button);
    }

    it("moves focus to the remove button of the next entry", () => {
      vi.mocked(putIngredientPref).mockResolvedValue(removed("basilico"));
      render(<IngredientPrefsSection initialPrefs={FULL} />);

      removeWithFocus("basilico");

      expect(screen.getByRole("button", { name: "Rimuovi zucchine" })).toHaveFocus();
    });

    it("moves focus to the previous entry when the removed one was last", () => {
      vi.mocked(putIngredientPref).mockResolvedValue(removed("aglio"));
      render(<IngredientPrefsSection initialPrefs={FULL} />);

      removeWithFocus("aglio");

      expect(screen.getByRole("button", { name: "Rimuovi zucchine" })).toHaveFocus();
    });

    it("moves focus to the group heading when its list becomes empty", () => {
      vi.mocked(putIngredientPref).mockResolvedValue(removed("cipolla"));
      render(
        <IngredientPrefsSection
          initialPrefs={{ likes: FULL.likes, dislikes: [FULL.dislikes[0]] }}
        />
      );

      removeWithFocus("cipolla");

      expect(screen.getByRole("heading", { name: "Scartati" })).toHaveFocus();
    });

    it("moves focus to the section heading when no entry is left at all", () => {
      vi.mocked(putIngredientPref).mockResolvedValue(removed("cipolla"));
      render(
        <IngredientPrefsSection
          initialPrefs={{ likes: [], dislikes: [FULL.dislikes[0]] }}
        />
      );

      removeWithFocus("cipolla");

      expect(screen.getByRole("heading", { name: "I miei ingredienti" })).toHaveFocus();
    });

    it("puts focus back on the restored entry when the removal fails", async () => {
      vi.mocked(putIngredientPref).mockRejectedValueOnce(new Error("boom"));
      render(<IngredientPrefsSection initialPrefs={FULL} />);

      removeWithFocus("basilico");
      await screen.findByRole("alert");

      expect(screen.getByRole("button", { name: "Rimuovi basilico" })).toHaveFocus();
    });

    it("announces the removal in a polite live region once it is saved", async () => {
      vi.mocked(putIngredientPref).mockResolvedValueOnce(removed("basilico"));
      render(<IngredientPrefsSection initialPrefs={FULL} />);

      removeWithFocus("basilico");

      await waitFor(() => expect(screen.getByText("basilico rimosso.")).toBeInTheDocument());
      expect(screen.getByText("basilico rimosso.")).toHaveAttribute("aria-live", "polite");
    });
  });
});
