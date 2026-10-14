import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRecipesAsDomain } from "@/fixtures";
import {
  SlotRecipePicker,
  type SlotRecipePickerProps,
} from "@/components/plan/slot-recipe-picker";
import { toLibraryCard } from "@/lib/domain/library";
import type {
  GeneratedRecipe,
  PlanResult,
  PlanSlotView,
  PlanView,
  Recipe,
  RecipeDetailView,
  RecipeProposal,
  RecipePref,
  SlotCandidates,
} from "@/lib/domain/types";
import { ApiRequestError } from "@/lib/http/client";

vi.mock("@/lib/plans/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/plans/client")>();
  return { ...original, fetchSlotCandidates: vi.fn(), requestAssignSlotRecipe: vi.fn() };
});
vi.mock("@/lib/library/client", () => ({
  fetchRecipeDetail: vi.fn(),
  requestRecipeProposal: vi.fn(),
  requestSaveRecipe: vi.fn(),
}));
vi.mock("@/lib/prefs/client", () => ({ putRecipePref: vi.fn(), putIngredientPref: vi.fn() }));

import { PlanRequestError, fetchSlotCandidates, requestAssignSlotRecipe } from "@/lib/plans/client";
import {
  fetchRecipeDetail,
  requestRecipeProposal,
  requestSaveRecipe,
} from "@/lib/library/client";
import { putRecipePref } from "@/lib/prefs/client";

const fetchCandidatesMock = vi.mocked(fetchSlotCandidates);
const assignMock = vi.mocked(requestAssignSlotRecipe);
const fetchDetailMock = vi.mocked(fetchRecipeDetail);
const proposalMock = vi.mocked(requestRecipeProposal);
const saveMock = vi.mocked(requestSaveRecipe);
const putPrefMock = vi.mocked(putRecipePref);

const [RECIPE_A, RECIPE_B, , RECIPE_D] = fixtureRecipesAsDomain();
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SLOT_ID = "22222222-2222-4222-8222-222222222222";
const SAVED_ID = "55555555-5555-4555-8555-555555555555";
const GENERATED_AT = "2026-09-29T10:00:00.000Z";

const LOADING_STATUS = "Caricamento delle ricette";
const IN_PLAN_BADGE = "Già nel piano";
const NO_CANDIDATES = "Nessun'altra ricetta adatta a questo pasto";
const NO_RESULTS = "Nessuna ricetta trovata";
const REQUEST_HINT = "Non c'è quello che cerchi?";
const ASSIGN_LABEL = "Metti nel piano";
const NETWORK_MESSAGE = "Connessione non disponibile.";
const DUPLICATE_MESSAGE = "Questa ricetta è già in libreria.";
const SAVED_NOT_ASSIGNED =
  "Ricetta aggiunta alla libreria, ma non sono riuscito a metterla nel piano.";

const SLOT: PlanSlotView = {
  id: SLOT_ID,
  day: "2026-10-01",
  meal: "cena",
  servings: 2,
  locked: false,
  recipe: RECIPE_A,
};

const ALL_CANDIDATES: SlotCandidates = {
  recipes: [RECIPE_A, RECIPE_B, RECIPE_D].map(toLibraryCard),
  in_plan_recipe_ids: [],
};

const LASAGNE: GeneratedRecipe = {
  title: "Lasagne al pesto",
  description: "Verdi e cremose",
  meal_types: ["pranzo", "cena"],
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

const SAVED: Recipe = { ...RECIPE_A, id: SAVED_ID, title: LASAGNE.title };

function candidatesOf(recipes: Recipe[], inPlan: string[] = []): SlotCandidates {
  return { recipes: recipes.map(toLibraryCard), in_plan_recipe_ids: inPlan };
}

function assignedResult(): PlanResult {
  const plan: PlanView = {
    id: PLAN_ID,
    week_start: "2026-09-28",
    status: "draft",
    created_at: GENERATED_AT,
    generated_at: GENERATED_AT,
    superseded: false,
    slots: [{ ...SLOT, recipe: SAVED }],
    shopping_list: { exists: false, needs_regeneration: false },
  };
  return { plan };
}

function makeDetail(recipe: Recipe): RecipeDetailView {
  return {
    recipe,
    ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
      canonical_name: ingredient.canonical_name,
      pref: null,
      recipes_count: 1,
    })),
  };
}

function makePref(overrides: Partial<RecipePref>): RecipePref {
  return {
    recipe_id: RECIPE_A.id,
    rating: null,
    favorite: false,
    blocked: false,
    times_used: 0,
    last_used_at: null,
    ...overrides,
  };
}

function proposalOf(recipe: GeneratedRecipe): RecipeProposal {
  return { recipe, duplicate_of: null };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Nome accessibile di una card: `^\d+ min <titolo>`. */
function cardRegex(title: string): RegExp {
  return new RegExp(`^\\d+ min ${escapeRegExp(title)}`);
}

function queryCard(title: string): HTMLElement | null {
  return screen.queryByRole("button", { name: cardRegex(title) });
}

function cardButton(title: string): HTMLElement {
  return screen.getByRole("button", { name: cardRegex(title) });
}

/** Nome accessibile calcolato dagli `aria-labelledby` della card (incluso il badge). */
function cardName(title: string): string {
  const ids = (cardButton(title).getAttribute("aria-labelledby") ?? "").split(" ");
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

function searchField(): HTMLElement {
  return screen.getByRole("searchbox", { name: "Cerca tra le ricette adatte" });
}

function renderPicker(overrides: Partial<SlotRecipePickerProps> = {}) {
  const spies = {
    onClose: vi.fn(),
    onAssigned: vi.fn(),
    onPlanStale: vi.fn(),
    onNotify: vi.fn(),
    onRecipePrefsChange: vi.fn(),
  };
  const utils = render(
    <SlotRecipePicker planId={PLAN_ID} slot={SLOT} {...spies} {...overrides} />
  );
  return { ...utils, ...spies };
}

/** Il selettore è caricato quando non c'è più lo stato di caricamento. */
async function waitForReady(): Promise<void> {
  await waitFor(() =>
    expect(screen.queryByRole("status", { name: LOADING_STATUS })).not.toBeInTheDocument()
  );
}

/** Apre il selettore con l'elenco caricato, pronto all'interazione. */
async function renderReady(
  candidates: SlotCandidates = ALL_CANDIDATES,
  overrides: Partial<SlotRecipePickerProps> = {}
) {
  fetchCandidatesMock.mockResolvedValue(candidates);
  const utils = renderPicker(overrides);
  await waitForReady();
  return utils;
}

/** Apre il dettaglio della card e attende il pulsante «Metti nel piano». */
async function openDetail(recipe: Recipe): Promise<void> {
  fetchDetailMock.mockResolvedValue(makeDetail(recipe));
  fireEvent.click(cardButton(recipe.title));
  await screen.findByRole("button", { name: ASSIGN_LABEL });
}

function pressEscape(): void {
  fireEvent.keyDown(window, { key: "Escape" });
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SlotRecipePicker: apertura ed elenco", () => {
  it("shows the slot title, loads the candidates and then the cards", async () => {
    fetchCandidatesMock.mockResolvedValue(ALL_CANDIDATES);
    renderPicker();

    expect(
      screen.getByRole("heading", { name: "Scegli per Giovedì 1 · Cena" })
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: LOADING_STATUS })).toBeInTheDocument();
    expect(fetchCandidatesMock).toHaveBeenCalledWith(PLAN_ID, SLOT_ID);

    expect(await screen.findByRole("button", { name: cardRegex(RECIPE_A.title) })).toBeInTheDocument();
    expect(queryCard(RECIPE_B.title)).toBeInTheDocument();
    expect(queryCard(RECIPE_D.title)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: LOADING_STATUS })).not.toBeInTheDocument();
  });

  it("marks only the recipes already in the plan with the badge", async () => {
    await renderReady(candidatesOf([RECIPE_A, RECIPE_B, RECIPE_D], [RECIPE_B.id]));

    expect(cardName(RECIPE_B.title)).toContain(IN_PLAN_BADGE);
    expect(cardName(RECIPE_A.title)).not.toContain(IN_PLAN_BADGE);
    expect(cardName(RECIPE_D.title)).not.toContain(IN_PLAN_BADGE);
    expect(screen.getAllByText(IN_PLAN_BADGE)).toHaveLength(1);
  });

  it("filters by title and by ingredient, and has no favorite or meal chips", async () => {
    await renderReady();

    fireEvent.change(searchField(), { target: { value: "zucca" } });
    expect(queryCard(RECIPE_B.title)).toBeInTheDocument();
    expect(queryCard(RECIPE_A.title)).not.toBeInTheDocument();
    expect(queryCard(RECIPE_D.title)).not.toBeInTheDocument();

    fireEvent.change(searchField(), { target: { value: "cetriolo" } });
    expect(queryCard(RECIPE_D.title)).toBeInTheDocument();
    expect(queryCard(RECIPE_B.title)).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /preferiti/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("does not focus the search field when opened", async () => {
    await renderReady();

    expect(searchField()).not.toHaveFocus();
  });

  it("shows the no-candidates message and offers a request for a typed recipe", async () => {
    await renderReady(candidatesOf([]));

    expect(screen.getByText(NO_CANDIDATES)).toBeInTheDocument();
    fireEvent.change(searchField(), { target: { value: "lasagne" } });
    expect(
      screen.getByRole("button", { name: "Chiedi una ricetta per «lasagne»" })
    ).toBeInTheDocument();
  });

  it("shows no results with the request box, and no box for a query shorter than three characters", async () => {
    await renderReady();

    fireEvent.change(searchField(), { target: { value: "zz" } });
    expect(screen.getByText(NO_RESULTS)).toBeInTheDocument();
    expect(screen.queryByText(REQUEST_HINT)).not.toBeInTheDocument();

    fireEvent.change(searchField(), { target: { value: "zzz" } });
    expect(screen.getByText(NO_RESULTS)).toBeInTheDocument();
    expect(screen.getByText(REQUEST_HINT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chiedi una ricetta per «zzz»" })).toBeInTheDocument();
  });

  it("shows the load error as an alert and retries the candidates request", async () => {
    fetchCandidatesMock
      .mockRejectedValueOnce(new PlanRequestError(0, "network_error", NETWORK_MESSAGE))
      .mockResolvedValueOnce(ALL_CANDIDATES);
    renderPicker();

    expect(await screen.findByRole("alert")).toHaveTextContent(NETWORK_MESSAGE);
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));

    expect(await screen.findByRole("button", { name: cardRegex(RECIPE_A.title) })).toBeInTheDocument();
    expect(fetchCandidatesMock).toHaveBeenCalledTimes(2);
    expect(fetchCandidatesMock).toHaveBeenLastCalledWith(PLAN_ID, SLOT_ID);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sizes the sheet with dvh units so the mobile browser bars do not clip it", async () => {
    await renderReady();

    const panel = screen.getAllByRole("dialog")[0];
    expect(panel).toHaveClass("h-[92dvh]", "max-h-[92dvh]");
    expect(panel).not.toHaveClass("h-[92vh]");
  });
});

describe("SlotRecipePicker: Metti nel piano dal dettaglio", () => {
  it("assigns the recipe from the detail and passes the updated plan to onAssigned", async () => {
    const { onAssigned } = await renderReady();
    assignMock.mockResolvedValue(assignedResult());
    await openDetail(RECIPE_A);

    expect(fetchDetailMock).toHaveBeenCalledWith(RECIPE_A.id);
    fireEvent.click(screen.getByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(assignedResult().plan));
    expect(assignMock).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, RECIPE_A.id);
  });

  it("closes only the detail on Esc, keeping the search text and the list", async () => {
    const { onClose } = await renderReady();
    fireEvent.change(searchField(), { target: { value: "zucca" } });
    await openDetail(RECIPE_B);

    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: ASSIGN_LABEL })).not.toBeInTheDocument();
    expect(searchField()).toHaveValue("zucca");
    expect(queryCard(RECIPE_B.title)).toBeInTheDocument();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onPlanStale then onClose when the slot is no longer editable", async () => {
    const { onNotify, onPlanStale, onClose } = await renderReady();
    assignMock.mockRejectedValue(
      new PlanRequestError(409, "slot_locked", "Sblocca il pasto per cambiarlo.")
    );
    await openDetail(RECIPE_A);

    fireEvent.click(screen.getByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onNotify).toHaveBeenCalledWith("Sblocca il pasto per cambiarlo.");
    expect(onNotify.mock.invocationCallOrder[0]).toBeLessThan(
      onPlanStale.mock.invocationCallOrder[0]
    );
    expect(onPlanStale.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0]
    );
  });

  it("closes the detail and reloads the candidates when the recipe is not eligible", async () => {
    const { onNotify, onClose } = await renderReady();
    fetchCandidatesMock.mockResolvedValue(ALL_CANDIDATES);
    assignMock.mockRejectedValue(
      new PlanRequestError(422, "recipe_not_eligible", "Questa ricetta non è adatta a questo pasto.")
    );
    await openDetail(RECIPE_A);

    fireEvent.click(screen.getByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(fetchCandidatesMock).toHaveBeenCalledTimes(2));
    expect(onNotify).toHaveBeenCalledWith("Questa ricetta non è adatta a questo pasto.");
    expect(screen.queryByRole("button", { name: ASSIGN_LABEL })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the detail open and the action enabled after a network error", async () => {
    const { onNotify } = await renderReady();
    assignMock.mockRejectedValue(new PlanRequestError(0, "network_error", NETWORK_MESSAGE));
    await openDetail(RECIPE_A);

    fireEvent.click(screen.getByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(NETWORK_MESSAGE));
    expect(screen.getByRole("button", { name: ASSIGN_LABEL })).toBeEnabled();
  });

  it("disables the action while the assignment is pending and sends it once", async () => {
    await renderReady();
    const pending = deferred<PlanResult>();
    assignMock.mockReturnValue(pending.promise);
    await openDetail(RECIPE_A);

    fireEvent.click(screen.getByRole("button", { name: ASSIGN_LABEL }));

    expect(screen.getByRole("button", { name: ASSIGN_LABEL })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: ASSIGN_LABEL }));
    expect(assignMock).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(assignedResult()));
  });

  it("removes a recipe blocked from the detail from the list when the detail closes", async () => {
    const { onRecipePrefsChange } = await renderReady();
    fetchDetailMock.mockResolvedValue(makeDetail(RECIPE_A));
    putPrefMock.mockResolvedValue(makePref({ blocked: true }));
    fireEvent.click(cardButton(RECIPE_A.title));
    fireEvent.click(await screen.findByRole("button", { name: "Non proporre più" }));

    await waitFor(() =>
      expect(onRecipePrefsChange).toHaveBeenCalledWith(RECIPE_A.id, {
        blocked: true,
        favorite: false,
      })
    );
    pressEscape();

    expect(queryCard(RECIPE_A.title)).not.toBeInTheDocument();
    expect(queryCard(RECIPE_B.title)).toBeInTheDocument();
  });
});

describe("SlotRecipePicker: richiesta di una ricetta", () => {
  it("proposes a recipe for the slot meal and assigns it after saving", async () => {
    const { onAssigned } = await renderReady();
    fireEvent.change(searchField(), { target: { value: "lasagne" } });
    proposalMock.mockResolvedValue(proposalOf(LASAGNE));
    saveMock.mockResolvedValue(SAVED);
    assignMock.mockResolvedValue(assignedResult());

    fireEvent.click(screen.getByRole("button", { name: "Chiedi una ricetta per «lasagne»" }));

    expect(proposalMock).toHaveBeenCalledWith(
      { request: "lasagne", mealType: "cena", excludeTitles: [] },
      expect.any(AbortSignal)
    );
    fireEvent.click(await screen.findByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(assignedResult().plan));
    expect(saveMock).toHaveBeenCalledWith(LASAGNE);
    expect(assignMock).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, SAVED_ID);
  });

  it("keeps the proposal open and shows the message when saving is rejected as unsuitable", async () => {
    const { onNotify } = await renderReady();
    fireEvent.change(searchField(), { target: { value: "lasagne" } });
    proposalMock.mockResolvedValue(proposalOf(LASAGNE));
    saveMock.mockRejectedValue(
      new ApiRequestError(422, "recipe_unsuitable", "La ricetta non rispetta più i vincoli delle impostazioni.")
    );
    fireEvent.click(screen.getByRole("button", { name: "Chiedi una ricetta per «lasagne»" }));
    fireEvent.click(await screen.findByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        "La ricetta non rispetta più i vincoli delle impostazioni."
      )
    );
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: LASAGNE.title })).toBeInTheDocument();
  });

  it("closes the proposal and reloads the candidates when the recipe is already in the library", async () => {
    const { onNotify, onClose } = await renderReady();
    fireEvent.change(searchField(), { target: { value: "lasagne" } });
    fetchCandidatesMock.mockResolvedValue(ALL_CANDIDATES);
    proposalMock.mockResolvedValue(proposalOf(LASAGNE));
    saveMock.mockRejectedValue(new ApiRequestError(409, "recipe_duplicate", DUPLICATE_MESSAGE));
    fireEvent.click(screen.getByRole("button", { name: "Chiedi una ricetta per «lasagne»" }));
    fireEvent.click(await screen.findByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(fetchCandidatesMock).toHaveBeenCalledTimes(2));
    expect(onNotify).toHaveBeenCalledWith(DUPLICATE_MESSAGE);
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: LASAGNE.title })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ASSIGN_LABEL })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the saved-not-assigned toast, closes the proposal and reloads on a network error", async () => {
    const { onNotify, onClose } = await renderReady();
    fireEvent.change(searchField(), { target: { value: "lasagne" } });
    fetchCandidatesMock.mockResolvedValue(ALL_CANDIDATES);
    proposalMock.mockResolvedValue(proposalOf(LASAGNE));
    saveMock.mockResolvedValue(SAVED);
    assignMock.mockRejectedValue(new PlanRequestError(0, "network_error", NETWORK_MESSAGE));
    fireEvent.click(screen.getByRole("button", { name: "Chiedi una ricetta per «lasagne»" }));
    fireEvent.click(await screen.findByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(fetchCandidatesMock).toHaveBeenCalledTimes(2));
    expect(onNotify).toHaveBeenCalledWith(SAVED_NOT_ASSIGNED);
    expect(screen.queryByRole("heading", { name: LASAGNE.title })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the saved-not-assigned toast, then onPlanStale and onClose when the slot is past", async () => {
    const { onNotify, onPlanStale, onClose } = await renderReady();
    fireEvent.change(searchField(), { target: { value: "lasagne" } });
    proposalMock.mockResolvedValue(proposalOf(LASAGNE));
    saveMock.mockResolvedValue(SAVED);
    assignMock.mockRejectedValue(
      new PlanRequestError(409, "slot_past", "Questo pasto è già passato.")
    );
    fireEvent.click(screen.getByRole("button", { name: "Chiedi una ricetta per «lasagne»" }));
    fireEvent.click(await screen.findByRole("button", { name: ASSIGN_LABEL }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onNotify).toHaveBeenCalledWith(SAVED_NOT_ASSIGNED);
    expect(onNotify.mock.invocationCallOrder[0]).toBeLessThan(
      onPlanStale.mock.invocationCallOrder[0]
    );
    expect(onPlanStale.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0]
    );
  });
});
