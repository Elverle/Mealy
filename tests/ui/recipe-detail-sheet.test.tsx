import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecipeDetailSheet,
  type RecipeDetailSheetProps,
} from "@/components/recipes/recipe-detail-sheet";
import type {
  Recipe,
  RecipeDetailView,
  RecipePref,
  SetIngredientPrefResult,
} from "@/lib/domain/types";
import { ApiRequestError } from "@/lib/http/client";

vi.mock("@/lib/library/client", () => ({ fetchRecipeDetail: vi.fn() }));
vi.mock("@/lib/prefs/client", () => ({ putRecipePref: vi.fn(), putIngredientPref: vi.fn() }));

import { fetchRecipeDetail } from "@/lib/library/client";
import { putIngredientPref, putRecipePref } from "@/lib/prefs/client";

const fetchMock = vi.mocked(fetchRecipeDetail);
const putRecipeMock = vi.mocked(putRecipePref);
const putIngredientMock = vi.mocked(putIngredientPref);

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "33333333-3333-4333-8333-333333333333";
const HOUSEHOLD = "22222222-2222-4222-8222-222222222222";

function makeRecipe(id = ID_A, title = "Pasta al pomodoro", prefs: RecipePref | null = null): Recipe {
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
    created_at: new Date("2026-01-01"),
    ingredients: [
      { canonical_name: "basilico", display_name: "Basilico", unit: "g", category: "ortofrutta", qty: 10 },
    ],
    prefs,
  } as Recipe;
}

function makeDetail(
  recipe: Recipe = makeRecipe(),
  info: RecipeDetailView["ingredients"] = [
    { canonical_name: "basilico", pref: null, recipes_count: 8 },
  ]
): RecipeDetailView {
  return { recipe, ingredients: info };
}

function makePref(overrides: Partial<RecipePref> = {}, recipeId = ID_A): RecipePref {
  return {
    recipe_id: recipeId,
    rating: null,
    favorite: false,
    blocked: false,
    times_used: 0,
    last_used_at: null,
    ...overrides,
  };
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

function renderSheet(props: Partial<RecipeDetailSheetProps> = {}) {
  const onClose = vi.fn();
  const onNotify = vi.fn();
  const onRecipePrefsChange = vi.fn();
  const base: RecipeDetailSheetProps = {
    recipeId: ID_A,
    servings: 2,
    onClose,
    onNotify,
    onRecipePrefsChange,
  };
  const utils = render(<RecipeDetailSheet {...base} {...props} />);
  return {
    ...utils,
    onClose,
    onNotify,
    onRecipePrefsChange,
    rerenderWith: (next: Partial<RecipeDetailSheetProps>) =>
      utils.rerender(<RecipeDetailSheet {...base} {...props} {...next} />),
  };
}

async function waitForReady() {
  await screen.findByRole("button", { name: "Preferisci Basilico" });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("RecipeDetailSheet loading", () => {
  it("shows the skeleton, then the recipe title with the thumbs", async () => {
    fetchMock.mockResolvedValue(makeDetail());
    renderSheet();

    expect(screen.getByRole("status", { name: "Caricamento della ricetta" })).toBeInTheDocument();
    expect(await screen.findByText("Pasta al pomodoro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preferisci Basilico" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scarta Basilico" })).toBeInTheDocument();
  });

  it("shows initialRecipe immediately and adds the thumbs once the detail loads", async () => {
    const pending = deferred<RecipeDetailView>();
    fetchMock.mockReturnValue(pending.promise);
    renderSheet({ initialRecipe: makeRecipe(ID_A, "Dal piano") });

    expect(screen.getByText("Dal piano")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preferisci Basilico" })).not.toBeInTheDocument();

    await act(async () => pending.resolve(makeDetail(makeRecipe(ID_A, "Dal piano"))));
    expect(await screen.findByRole("button", { name: "Preferisci Basilico" })).toBeInTheDocument();
  });

  it("notifies the error and closes when loading fails without initialRecipe", async () => {
    fetchMock.mockRejectedValue(new ApiRequestError(404, "not_found", "Ricetta non trovata."));
    const { onNotify, onClose } = renderSheet();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onNotify).toHaveBeenCalledWith("Ricetta non trovata.");
  });

  it("keeps the sheet open without thumbs when loading fails with initialRecipe", async () => {
    fetchMock.mockRejectedValue(new ApiRequestError(500, "internal_error", "Errore"));
    const { onNotify, onClose } = renderSheet({ initialRecipe: makeRecipe(ID_A, "Dal piano") });

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith("Non riesco a caricare le preferenze sugli ingredienti.")
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Dal piano")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preferisci Basilico" })).not.toBeInTheDocument();
  });

  it("ignores the response of a recipe that was replaced while loading", async () => {
    const first = deferred<RecipeDetailView>();
    const second = deferred<RecipeDetailView>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerenderWith } = renderSheet({ recipeId: ID_A });

    rerenderWith({ recipeId: ID_B });
    await act(async () => first.resolve(makeDetail(makeRecipe(ID_A, "Ricetta A"))));
    expect(screen.queryByText("Ricetta A")).not.toBeInTheDocument();

    await act(async () => second.resolve(makeDetail(makeRecipe(ID_B, "Ricetta B"))));
    expect(await screen.findByText("Ricetta B")).toBeInTheDocument();
    expect(screen.queryByText("Ricetta A")).not.toBeInTheDocument();
  });

  it("renders nothing and does not fetch when recipeId is null", () => {
    renderSheet({ recipeId: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("RecipeDetailSheet recipe preferences", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(makeDetail());
  });

  it("rates on tap and clears the rating when the active star is tapped again", async () => {
    putRecipeMock
      .mockResolvedValueOnce(makePref({ rating: 4 }))
      .mockResolvedValueOnce(makePref({ rating: null }));
    const { onRecipePrefsChange } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Vota 4 stelle" }));
    await waitFor(() => expect(putRecipeMock).toHaveBeenCalledWith(ID_A, { rating: 4 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Vota 4 stelle" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    expect(onRecipePrefsChange).toHaveBeenLastCalledWith(ID_A, { rating: 4 });

    await waitFor(() => expect(screen.getByRole("button", { name: "Vota 4 stelle" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Vota 4 stelle" }));
    await waitFor(() => expect(putRecipeMock).toHaveBeenLastCalledWith(ID_A, { rating: null }));
    await waitFor(() => expect(onRecipePrefsChange).toHaveBeenLastCalledWith(ID_A, { rating: null }));
  });

  it("reports only the requested fields to onRecipePrefsChange", async () => {
    putRecipeMock.mockResolvedValue(makePref({ rating: 4, favorite: true, times_used: 3 }));
    const { onRecipePrefsChange } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Vota 4 stelle" }));
    await waitFor(() => expect(onRecipePrefsChange).toHaveBeenCalledTimes(1));
    expect(onRecipePrefsChange).toHaveBeenCalledWith(ID_A, { rating: 4 });
  });

  it("toggles favorite and disables the actions while saving", async () => {
    const pending = deferred<RecipePref>();
    putRecipeMock.mockReturnValue(pending.promise);
    renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Preferita" }));
    expect(putRecipeMock).toHaveBeenCalledWith(ID_A, { favorite: true });
    expect(screen.getByRole("button", { name: "Preferita" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Vota 1 stelle" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Non proporre più" })).toBeDisabled();

    await act(async () => pending.resolve(makePref({ favorite: true })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Preferita" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Preferita" })).toHaveAttribute("aria-pressed", "true");
  });

  it("blocks with the default toast, reports the cleared favorite, then unblocks", async () => {
    fetchMock.mockResolvedValue(makeDetail(makeRecipe(ID_A, "Pasta", makePref({ favorite: true }))));
    putRecipeMock
      .mockResolvedValueOnce(makePref({ blocked: true, favorite: false }))
      .mockResolvedValueOnce(makePref({ blocked: false, favorite: false }));
    const { onNotify, onRecipePrefsChange } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Non proporre più" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Non la proporrò più."));
    expect(putRecipeMock).toHaveBeenCalledWith(ID_A, { blocked: true });
    expect(onRecipePrefsChange).toHaveBeenCalledWith(ID_A, { blocked: true, favorite: false });

    fireEvent.click(await screen.findByRole("button", { name: "Sblocca ricetta" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("La ricetta torna tra le proposte."));
    expect(putRecipeMock).toHaveBeenLastCalledWith(ID_A, { blocked: false });
  });

  it("uses blockedMessage after blocking", async () => {
    putRecipeMock.mockResolvedValue(makePref({ blocked: true }));
    const { onNotify } = renderSheet({ blockedMessage: "Tolta dal piano." });
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Non proporre più" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Tolta dal piano."));
    expect(onNotify).not.toHaveBeenCalledWith("Non la proporrò più.");
  });

  it("restores the previous state and notifies when saving fails", async () => {
    putRecipeMock.mockRejectedValue(new ApiRequestError(500, "internal_error", "Salvataggio fallito."));
    const { onNotify, onRecipePrefsChange } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Vota 4 stelle" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Salvataggio fallito."));
    expect(screen.getByRole("button", { name: "Vota 4 stelle" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(onRecipePrefsChange).not.toHaveBeenCalled();
  });

  it("applies the optimistic rating while the request is in flight", async () => {
    const pending = deferred<RecipePref>();
    putRecipeMock.mockReturnValue(pending.promise);
    renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Vota 2 stelle" }));
    expect(screen.getByRole("button", { name: "Vota 2 stelle" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await act(async () => pending.resolve(makePref({ rating: 2 })));
  });

  it("still notifies the parent when the sheet moved to another recipe before the response", async () => {
    const pending = deferred<RecipePref>();
    putRecipeMock.mockReturnValue(pending.promise);
    fetchMock.mockResolvedValueOnce(makeDetail()).mockReturnValueOnce(new Promise(() => undefined));
    const { onRecipePrefsChange, rerenderWith } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Vota 5 stelle" }));
    rerenderWith({ recipeId: ID_B });
    await act(async () => pending.resolve(makePref({ rating: 5 })));

    expect(onRecipePrefsChange).toHaveBeenCalledWith(ID_A, { rating: 5 });
    expect(screen.queryByRole("button", { name: "Vota 5 stelle" })).not.toBeInTheDocument();
  });
});

describe("RecipeDetailSheet ingredient preferences", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(makeDetail());
  });

  it("asks for confirmation with the impact and saves the dislike by canonical name", async () => {
    putIngredientMock.mockResolvedValue({
      canonical_name: "basilico",
      pref: "dislike",
      recipes_count: 8,
    });
    const { onNotify } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Scarta Basilico" }));
    expect(screen.getByText("Escluderà 8 ricette dai prossimi piani.")).toBeInTheDocument();
    // Without a canonicalName override the title uses the canonical name of the ingredient.
    expect(screen.getByText("Scartare basilico?")).toBeInTheDocument();
    expect(putIngredientMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Conferma esclusione" }));
    await waitFor(() => expect(putIngredientMock).toHaveBeenCalledWith("basilico", "dislike"));
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        "Non proporrò più ricette con basilico: vale dai prossimi piani."
      )
    );
    expect(await screen.findByRole("button", { name: "Scarta Basilico" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("titles the confirmation with the exact canonical name, not the display name", async () => {
    const recipe = makeRecipe();
    recipe.ingredients = [
      {
        canonical_name: " Cipolla Rossa ",
        display_name: "Cipolla rossa di Tropea",
        unit: "pz",
        category: "ortofrutta",
        qty: 1,
      },
    ] as Recipe["ingredients"];
    fetchMock.mockResolvedValue(
      makeDetail(recipe, [{ canonical_name: "cipolla rossa", pref: null, recipes_count: 2 }])
    );
    renderSheet();

    fireEvent.click(await screen.findByRole("button", { name: "Scarta Cipolla rossa di Tropea" }));
    expect(screen.getByText("Scartare cipolla rossa?")).toBeInTheDocument();
    expect(screen.queryByText("Scartare Cipolla rossa di Tropea?")).not.toBeInTheDocument();
  });

  it("does not call the API when the confirmation is cancelled", async () => {
    const { onNotify } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Scarta Basilico" }));
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));

    expect(putIngredientMock).not.toHaveBeenCalled();
    expect(onNotify).not.toHaveBeenCalled();
    expect(screen.queryByText("Scartare basilico?")).not.toBeInTheDocument();
  });

  it("likes without confirmation or toast, then removes the like on a second tap", async () => {
    putIngredientMock
      .mockResolvedValueOnce({ canonical_name: "basilico", pref: "like", recipes_count: 8 })
      .mockResolvedValueOnce({ canonical_name: "basilico", pref: null, recipes_count: 8 });
    const { onNotify } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Preferisci Basilico" }));
    await waitFor(() => expect(putIngredientMock).toHaveBeenCalledWith("basilico", "like"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Preferisci Basilico" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Preferisci Basilico" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Preferisci Basilico" }));
    await waitFor(() => expect(putIngredientMock).toHaveBeenLastCalledWith("basilico", null));
    expect(onNotify).not.toHaveBeenCalled();
  });

  it("restores the previous state and notifies when the judgement fails", async () => {
    putIngredientMock.mockRejectedValue(new ApiRequestError(500, "internal_error", "Non salvato."));
    const { onNotify } = renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Preferisci Basilico" }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Non salvato."));
    expect(screen.getByRole("button", { name: "Preferisci Basilico" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("shows an existing judgement from the loaded detail", async () => {
    fetchMock.mockResolvedValue(
      makeDetail(makeRecipe(), [{ canonical_name: "basilico", pref: "dislike", recipes_count: 1 }])
    );
    renderSheet();

    expect(await screen.findByRole("button", { name: "Scarta Basilico" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("disables the thumbs while a judgement is being saved", async () => {
    const pending = deferred<SetIngredientPrefResult>();
    putIngredientMock.mockReturnValue(pending.promise);
    renderSheet();
    await waitForReady();

    fireEvent.click(screen.getByRole("button", { name: "Preferisci Basilico" }));
    expect(screen.getByRole("button", { name: "Scarta Basilico" })).toBeDisabled();

    await act(async () =>
      pending.resolve({ canonical_name: "basilico", pref: "like", recipes_count: 8 })
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Scarta Basilico" })).toBeEnabled());
  });
});

describe("RecipeDetailSheet primary action", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(makeDetail());
  });

  it("shows no primary button without primaryAction", async () => {
    renderSheet();
    await waitForReady();
    expect(screen.queryByRole("button", { name: "Metti nel piano" })).not.toBeInTheDocument();
  });

  it("shows the primary button only once the recipe is loaded and passes its id on click", async () => {
    const pending = deferred<RecipeDetailView>();
    fetchMock.mockReturnValue(pending.promise);
    const onAction = vi.fn();
    renderSheet({ primaryAction: { label: "Metti nel piano", onAction } });

    expect(screen.queryByRole("button", { name: "Metti nel piano" })).not.toBeInTheDocument();

    await act(async () => pending.resolve(makeDetail()));
    fireEvent.click(await screen.findByRole("button", { name: "Metti nel piano" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(ID_A);
  });

  it("disables the primary button while busy", async () => {
    const onAction = vi.fn();
    renderSheet({ primaryAction: { label: "Metti nel piano", onAction, busy: true } });
    await waitForReady();

    const button = screen.getByRole("button", { name: "Metti nel piano" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });
});
