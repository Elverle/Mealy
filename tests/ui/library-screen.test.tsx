import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryScreen } from "@/components/library/library-screen";
import { toLibraryCard } from "@/lib/domain/library";
import type {
  LibraryRecipeCard,
  Recipe,
  RecipeDetailView,
  RecipePref,
} from "@/lib/domain/types";
import { ApiRequestError } from "@/lib/http/client";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/library/client", () => ({ fetchRecipeDetail: vi.fn() }));
vi.mock("@/lib/prefs/client", () => ({ putRecipePref: vi.fn(), putIngredientPref: vi.fn() }));

import { fetchRecipeDetail } from "@/lib/library/client";
import { putRecipePref } from "@/lib/prefs/client";

const fetchMock = vi.mocked(fetchRecipeDetail);
const putRecipeMock = vi.mocked(putRecipePref);

const HOUSEHOLD = "22222222-2222-4222-8222-222222222222";
const ID_PESTO = "00000000-0000-4000-8000-000000000001";
const ID_SALMONE = "00000000-0000-4000-8000-000000000002";
const ID_RISO = "00000000-0000-4000-8000-000000000003";
const ID_OLD_FAV = "00000000-0000-4000-8000-000000000004";

function makeRecipe(
  id: string,
  title: string,
  ingredient: string,
  createdAt: string,
  prefs: Partial<RecipePref> = {}
): Recipe {
  return {
    id,
    household_id: HOUSEHOLD,
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    description: "Semplice",
    steps: ["Cuoci"],
    meal_types: ["pranzo"],
    tags: [],
    diet_flags: [],
    appliances_required: [],
    servings_base: 2,
    prep_minutes: 20,
    source: "manual",
    created_at: new Date(createdAt),
    ingredients: [
      { canonical_name: ingredient, display_name: ingredient, unit: "g", category: "dispensa", qty: 10 },
    ],
    prefs: { recipe_id: id, rating: null, favorite: false, blocked: false, times_used: 0, last_used_at: null, ...prefs },
  } as Recipe;
}

function cardOf(recipe: Recipe): LibraryRecipeCard {
  return toLibraryCard(recipe);
}

const PESTO = makeRecipe(ID_PESTO, "Pasta al pesto", "basilico", "2026-03-01");
const SALMONE = makeRecipe(ID_SALMONE, "Salmone al forno", "salmone", "2026-02-01");
const RISO = makeRecipe(ID_RISO, "Risotto ai funghi", "porcini", "2026-01-01", { blocked: true });
const OLD_FAV = makeRecipe(ID_OLD_FAV, "Zuppa antica", "orzo", "2020-01-01", { favorite: true, rating: 4 });

function pref(recipeId: string, overrides: Partial<RecipePref> = {}): RecipePref {
  return { recipe_id: recipeId, rating: null, favorite: false, blocked: false, times_used: 0, last_used_at: null, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderScreen(recipes: Recipe[] = [PESTO, SALMONE, RISO], persons = 2) {
  return render(<LibraryScreen initialRecipes={recipes.map(cardOf)} persons={persons} />);
}

/** Titoli delle card nell'ordine mostrato. */
function shownTitles(): string[] {
  return screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
}

/** Tocca il corpo della card (non la ★). */
function openCard(title: string) {
  const body = screen.getByRole("heading", { level: 3, name: title }).closest("button");
  fireEvent.click(body!);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("LibraryScreen", () => {
  it("shows only the empty state, without search, when the library is empty", () => {
    renderScreen([]);
    expect(screen.getByText("Ancora nessuna ricetta")).toBeInTheDocument();
    expect(screen.getByText("Genera il primo piano e la libreria si riempie da sola.")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vai al piano" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("narrows the list by title and by ingredient and updates the count", () => {
    renderScreen([PESTO, SALMONE]);
    expect(screen.getByText("2 ricette")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Cerca nella libreria" });

    fireEvent.change(search, { target: { value: "pesto" } });
    expect(shownTitles()).toEqual(["Pasta al pesto"]);
    expect(screen.getByText("1 ricetta")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "salmone" } });
    expect(shownTitles()).toEqual(["Salmone al forno"]);
  });

  it("shows the no-results state and restores everything with Azzera filtri", () => {
    renderScreen([PESTO, SALMONE]);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "xyz" } });
    expect(screen.getByText("Nessuna ricetta trovata")).toBeInTheDocument();
    expect(screen.getByText("Prova a cambiare i filtri o il testo cercato.")).toBeInTheDocument();
    expect(screen.getByText("0 ricette")).toBeInTheDocument();

    const resets = screen.getAllByRole("button", { name: "Azzera filtri" });
    fireEvent.click(resets[resets.length - 1]);
    expect(shownTitles()).toHaveLength(2);
    expect(search).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Azzera filtri" })).not.toBeInTheDocument();
  });

  it("hides blocked cards and shows only them, labelled and without star, with Bloccate", () => {
    renderScreen([PESTO, SALMONE, RISO]);
    expect(shownTitles()).not.toContain("Risotto ai funghi");

    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bloccate" }));
    expect(shownTitles()).toEqual(["Risotto ai funghi"]);
    expect(screen.getByText("Bloccata")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ai preferiti/ })).not.toBeInTheDocument();
  });

  it("shows the dedicated empty state when Bloccate matches nothing", () => {
    renderScreen([PESTO, SALMONE]);
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bloccate" }));
    expect(screen.getByText("Nessuna ricetta bloccata")).toBeInTheDocument();
    expect(
      screen.getByText("Le ricette che segni con «Non proporre più» le ritrovi qui.")
    ).toBeInTheDocument();
  });

  it("puts an older favorite above a newer non-favorite", () => {
    renderScreen([PESTO, OLD_FAV]);
    expect(shownTitles()).toEqual(["Zuppa antica", "Pasta al pesto"]);
    expect(screen.getByLabelText("Voto 4 su 5")).toBeInTheDocument();
  });

  it("saves the quick star optimistically and moves the card to the top", async () => {
    const pending = deferred<RecipePref>();
    putRecipeMock.mockReturnValue(pending.promise);
    renderScreen([PESTO, SALMONE]);
    expect(shownTitles()).toEqual(["Pasta al pesto", "Salmone al forno"]);

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi Salmone al forno ai preferiti" }));
    expect(putRecipeMock).toHaveBeenCalledWith(ID_SALMONE, { favorite: true });
    expect(shownTitles()).toEqual(["Salmone al forno", "Pasta al pesto"]);

    await act(async () => pending.resolve(pref(ID_SALMONE, { favorite: true })));
    expect(screen.getByRole("button", { name: "Rimuovi Salmone al forno dai preferiti" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("ignores a second star tap while the first is saving", async () => {
    const pending = deferred<RecipePref>();
    putRecipeMock.mockReturnValue(pending.promise);
    renderScreen([PESTO]);
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi Pasta al pesto ai preferiti" }));
    fireEvent.click(screen.getByRole("button", { name: "Rimuovi Pasta al pesto dai preferiti" }));
    expect(putRecipeMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(pref(ID_PESTO, { favorite: true })));
  });

  it("reverts the quick star and shows a toast when saving fails", async () => {
    putRecipeMock.mockRejectedValue(new ApiRequestError(500, "internal_error", "Salvataggio fallito."));
    renderScreen([PESTO, SALMONE]);

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi Salmone al forno ai preferiti" }));
    expect(await screen.findByText("Salvataggio fallito.")).toBeInTheDocument();
    expect(shownTitles()).toEqual(["Pasta al pesto", "Salmone al forno"]);
    expect(screen.getByRole("button", { name: "Aggiungi Salmone al forno ai preferiti" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("shows the generic toast for unexpected errors", async () => {
    putRecipeMock.mockRejectedValue(new Error("boom"));
    renderScreen([PESTO]);
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi Pasta al pesto ai preferiti" }));
    expect(await screen.findByText("Qualcosa è andato storto. Riprova.")).toBeInTheDocument();
  });

  it("opens the detail on tap and scales quantities to the household persons", async () => {
    const detail: RecipeDetailView = {
      recipe: PESTO,
      ingredients: [{ canonical_name: "basilico", pref: null, recipes_count: 3 }],
    };
    fetchMock.mockResolvedValue(detail);
    renderScreen([PESTO], 4);

    openCard("Pasta al pesto");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ID_PESTO));
    // servings_base 2, qty 10, persons 4 -> 20
    expect(await screen.findByText("(20 g)")).toBeInTheDocument();
  });

  it("removes a blocked recipe from the list and shows the toast, keeping the detail open", async () => {
    fetchMock.mockResolvedValue({
      recipe: PESTO,
      ingredients: [{ canonical_name: "basilico", pref: null, recipes_count: 3 }],
    });
    putRecipeMock.mockResolvedValue(pref(ID_PESTO, { blocked: true }));
    renderScreen([PESTO, SALMONE]);

    openCard("Pasta al pesto");
    fireEvent.click(await screen.findByRole("button", { name: "Non proporre più" }));

    expect(await screen.findByText("Non la proporrò più.")).toBeInTheDocument();
    expect(putRecipeMock).toHaveBeenCalledWith(ID_PESTO, { blocked: true });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { level: 3, name: "Pasta al pesto", hidden: true })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Sblocca ricetta" })).toBeInTheDocument();
  });

  it("does not let a late star response overwrite a newer rating done from the detail", async () => {
    const star = deferred<RecipePref>();
    putRecipeMock.mockImplementation((_id, patch) =>
      "favorite" in patch ? star.promise : Promise.resolve(pref(ID_PESTO, { rating: 4 }))
    );
    fetchMock.mockResolvedValue({
      recipe: PESTO,
      ingredients: [{ canonical_name: "basilico", pref: null, recipes_count: 3 }],
    });
    renderScreen([PESTO]);

    // ★ rapida in sospeso
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi Pasta al pesto ai preferiti" }));
    // voto dal dettaglio
    openCard("Pasta al pesto");
    fireEvent.click(await screen.findByRole("button", { name: "Vota 4 stelle" }));
    await waitFor(() => expect(putRecipeMock).toHaveBeenCalledWith(ID_PESTO, { rating: 4 }));
    await waitFor(() => expect(screen.getByLabelText("Voto 4 su 5", { selector: "[role=img]" })).toBeInTheDocument());

    // la risposta tardiva della ★ riporta il vecchio voto (null): non deve toccarlo
    await act(async () => star.resolve(pref(ID_PESTO, { favorite: true, rating: null })));

    const card = screen.getByRole("heading", { level: 3, name: "Pasta al pesto", hidden: true }).closest("div")!;
    expect(within(card).getByLabelText("Voto 4 su 5")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rimuovi Pasta al pesto dai preferiti", hidden: true })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
