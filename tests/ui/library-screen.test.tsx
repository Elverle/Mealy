import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryScreen } from "@/components/library/library-screen";
import { toLibraryCard } from "@/lib/domain/library";
import type {
  GeneratedRecipe,
  LibraryRecipeCard,
  Recipe,
  RecipeDetailView,
  RecipePref,
  RecipeProposal,
} from "@/lib/domain/types";
import { ApiRequestError } from "@/lib/http/client";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/library/client", () => ({
  fetchRecipeDetail: vi.fn(),
  requestRecipeProposal: vi.fn(),
  requestSaveRecipe: vi.fn(),
}));
vi.mock("@/lib/prefs/client", () => ({ putRecipePref: vi.fn(), putIngredientPref: vi.fn() }));

import { fetchRecipeDetail, requestRecipeProposal, requestSaveRecipe } from "@/lib/library/client";
import { putRecipePref } from "@/lib/prefs/client";

const fetchMock = vi.mocked(fetchRecipeDetail);
const putRecipeMock = vi.mocked(putRecipePref);
const proposeMock = vi.mocked(requestRecipeProposal);
const saveMock = vi.mocked(requestSaveRecipe);

const HOUSEHOLD = "22222222-2222-4222-8222-222222222222";
const ID_PESTO = "00000000-0000-4000-8000-000000000001";
const ID_SALMONE = "00000000-0000-4000-8000-000000000002";
const ID_RISO = "00000000-0000-4000-8000-000000000003";
const ID_OLD_FAV = "00000000-0000-4000-8000-000000000004";
const ID_NUOVA = "00000000-0000-4000-8000-000000000005";

const PROPOSTA: GeneratedRecipe = {
  title: "Lasagne al pesto",
  description: "Verdi e cremose",
  meal_types: ["pranzo", "cena"],
  courses: ["primo"],
  tags: [],
  diet_flags: [],
  appliances_required: [],
  servings_base: 2,
  prep_minutes: 40,
  kcal_est: null,
  steps: ["Stendi la pasta", "Inforna"],
  ingredients: [
    {
      canonical_name: "basilico",
      display_name: "Basilico",
      qty: 50,
      unit: "g",
      category: "ortofrutta",
      note: null,
    },
  ],
};

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
    courses: [],
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
// Ricetta appena salvata: creata «adesso», quindi in cima tra le non preferite.
const SALVATA = makeRecipe(ID_NUOVA, "Lasagne al pesto", "basilico", new Date().toISOString());

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

/** Titoli delle card nell'ordine mostrato (le sezioni di una sheet aperta non contano). */
function shownTitles(): string[] {
  return screen
    .queryAllByRole("heading", { level: 3 })
    .filter((h) => h.closest('[role="dialog"]') === null)
    .map((h) => h.textContent ?? "");
}

/** Tocca il corpo della card (non la ★). */
function openCard(title: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^\\d+ min ${title}`) }));
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

  it("treats an active course filter as active filters and restores everything with Azzera filtri", () => {
    const salmoneSecondo: Recipe = { ...SALMONE, courses: ["secondo"] };
    renderScreen([PESTO, salmoneSecondo]);
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    const group = screen.getByText("Portata").parentElement as HTMLElement;
    fireEvent.click(within(group).getByRole("checkbox", { name: "Secondo" }));

    expect(shownTitles()).toEqual(["Salmone al forno"]);
    expect(screen.getByRole("button", { name: "Filtri · 1" })).toBeInTheDocument();

    const resets = screen.getAllByRole("button", { name: "Azzera filtri" });
    fireEvent.click(resets[resets.length - 1]);
    expect(shownTitles()).toHaveLength(2);
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

  it("exposes each title as a level-3 heading outside any button, with a card-wide open button", () => {
    renderScreen([PESTO]);
    const heading = screen.getByRole("heading", { level: 3, name: "Pasta al pesto" });
    expect(heading.closest("button")).toBeNull();
    const open = screen.getByRole("button", { name: /^\d+ min Pasta al pesto/ });
    expect(open).not.toContainElement(heading);
    expect(open.className).toContain("after:inset-0");
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
  it("keeps a recipe blocked from the detail without a favorite when a pending star response arrives later", async () => {
    const star = deferred<RecipePref>();
    putRecipeMock.mockImplementation((_id, patch) =>
      "favorite" in patch ? star.promise : Promise.resolve(pref(ID_PESTO, { blocked: true }))
    );
    fetchMock.mockResolvedValue({
      recipe: PESTO,
      ingredients: [{ canonical_name: "basilico", pref: null, recipes_count: 3 }],
    });
    renderScreen([PESTO]);

    // ★ rapida in sospeso, poi blocco dal dettaglio
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi Pasta al pesto ai preferiti" }));
    openCard("Pasta al pesto");
    fireEvent.click(await screen.findByRole("button", { name: "Non proporre più" }));
    expect(await screen.findByText("Non la proporrò più.")).toBeInTheDocument();

    // la risposta tardiva della ★ non deve rimettere la preferita su una ricetta bloccata
    await act(async () => star.resolve(pref(ID_PESTO, { favorite: true })));

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // tra le bloccate, filtrando per preferite, la ricetta non deve comparire
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bloccate" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Preferite" }));
    expect(screen.queryByRole("heading", { level: 3, name: "Pasta al pesto" })).not.toBeInTheDocument();
  });
});

/** Scrive nel campo di ricerca della Libreria. */
function typeQuery(text: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Cerca nella libreria" }), {
    target: { value: text },
  });
}

/** Il pulsante «Chiedi una ricetta per …» per il testo dato (già senza spazi ai bordi). */
function requestButton(text: string) {
  return screen.getByRole("button", { name: `Chiedi una ricetta per «${text}»` });
}

describe("LibraryScreen — chiedere una ricetta", () => {
  it("shows the request box only from three characters, next to the results", () => {
    renderScreen([PESTO, SALMONE]);

    typeQuery("pa");
    expect(screen.queryByText("Non c'è quello che cerchi?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chiedi una ricetta/ })).not.toBeInTheDocument();

    typeQuery("pas");
    expect(screen.getByText("Non c'è quello che cerchi?")).toBeInTheDocument();
    expect(requestButton("pas")).toBeInTheDocument();
    expect(shownTitles()).toEqual(["Pasta al pesto"]);
  });

  it("offers the request also when no recipe matches the search", () => {
    renderScreen([PESTO, SALMONE]);
    typeQuery("zzz");
    expect(screen.getByText("Nessuna ricetta trovata")).toBeInTheDocument();
    expect(requestButton("zzz")).toBeInTheDocument();
  });

  it("offers the request also when the blocked filter has no recipes", () => {
    renderScreen([PESTO, RISO]);
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bloccate" }));
    typeQuery("zzz");
    expect(screen.getByText("Nessuna ricetta bloccata")).toBeInTheDocument();
    expect(requestButton("zzz")).toBeInTheDocument();
  });

  it("asks for the trimmed text alone: the meal chips do not go into the request", () => {
    proposeMock.mockReturnValue(new Promise<RecipeProposal>(() => undefined));
    renderScreen([PESTO, SALMONE]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Cena" }));
    typeQuery("  lasagne  ");

    fireEvent.click(requestButton("lasagne"));

    expect(proposeMock).toHaveBeenCalledTimes(1);
    expect(proposeMock.mock.calls[0][0]).toEqual({
      request: "lasagne",
      mealType: null,
      sideDish: false,
      excludeTitles: [],
    });
  });

  it("saves the proposal only on tap, then clears the search and confirms with a toast", async () => {
    proposeMock.mockResolvedValue({ recipe: PROPOSTA, duplicate_of: null });
    saveMock.mockResolvedValue(SALVATA);
    renderScreen([PESTO, SALMONE]);
    typeQuery("lasagne");
    fireEvent.click(requestButton("lasagne"));

    fireEvent.click(await screen.findByRole("button", { name: "Aggiungi alla libreria" }));

    expect(saveMock).toHaveBeenCalledWith(PROPOSTA);
    expect(await screen.findByText("«Lasagne al pesto» è in libreria")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Cerca nella libreria" })).toHaveValue("");
    expect(shownTitles()[0]).toBe("Lasagne al pesto");
  });

  it("does not save the proposal before the tap on Aggiungi alla libreria", async () => {
    proposeMock.mockResolvedValue({ recipe: PROPOSTA, duplicate_of: null });
    renderScreen([PESTO, SALMONE]);
    typeQuery("lasagne");
    fireEvent.click(requestButton("lasagne"));

    expect(await screen.findByRole("button", { name: "Aggiungi alla libreria" })).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("closes the proposal with Esc without saving, keeps the list and returns the focus to the request button", async () => {
    proposeMock.mockResolvedValue({ recipe: PROPOSTA, duplicate_of: null });
    renderScreen([PESTO, SALMONE]);
    typeQuery("pasta");
    fireEvent.click(requestButton("pasta"));
    await screen.findByRole("button", { name: "Aggiungi alla libreria" });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(saveMock).not.toHaveBeenCalled();
    expect(shownTitles()).toEqual(["Pasta al pesto"]);
    expect(requestButton("pasta")).toHaveFocus();
  });

  it("keeps the proposal open and shows the error when saving is rejected", async () => {
    proposeMock.mockResolvedValue({ recipe: PROPOSTA, duplicate_of: null });
    saveMock.mockRejectedValue(
      new ApiRequestError(409, "recipe_duplicate", "Questa ricetta è già in libreria.")
    );
    renderScreen([PESTO, SALMONE]);
    typeQuery("pasta");
    fireEvent.click(requestButton("pasta"));
    fireEvent.click(await screen.findByRole("button", { name: "Aggiungi alla libreria" }));

    expect(await screen.findByText("Questa ricetta è già in libreria.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Lasagne al pesto" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Aggiungi alla libreria" })).toBeEnabled()
    );
    expect(shownTitles()).toEqual(["Pasta al pesto"]);
  });

  it("moves the focus to the library heading after a successful save", async () => {
    proposeMock.mockResolvedValue({ recipe: PROPOSTA, duplicate_of: null });
    saveMock.mockResolvedValue(SALVATA);
    renderScreen([PESTO, SALMONE]);
    typeQuery("lasagne");
    fireEvent.click(requestButton("lasagne"));
    fireEvent.click(await screen.findByRole("button", { name: "Aggiungi alla libreria" }));

    await screen.findByText("«Lasagne al pesto» è in libreria");
    expect(screen.getByRole("heading", { level: 1, name: "Libreria Ricette" })).toHaveFocus();
  });

  it("shows neither the search field nor the request on the empty library", () => {
    renderScreen([]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Non c'è quello che cerchi?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chiedi una ricetta/ })).not.toBeInTheDocument();
  });
});
