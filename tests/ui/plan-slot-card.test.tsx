import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRecipesAsDomain } from "@/fixtures";
import { makeRecipe } from "@/tests/helpers/recipes";
import { LONG_PRESS_MS } from "@/components/cards/meal-card";
import { PlanSlotCard, type PlanSlotCardProps } from "@/components/plan/plan-slot-card";
import {
  SWAP_EXCLUDE_MAX,
  type Course,
  type PlanMutationResult,
  type PlanSlotView,
  type PlanView,
  type Recipe,
} from "@/lib/domain/types";

// jsdom has no PointerEvent: without it fireEvent.pointer* drops button/clientX/clientY.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    configurable: true,
  });
}

vi.mock("@/lib/plans/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/plans/client")>();
  return {
    ...original,
    requestSwapSlot: vi.fn(),
    requestAddSideDish: vi.fn(),
    requestRemoveSideDish: vi.fn(),
  };
});

vi.mock("@/components/plan/slot-recipe-picker", () => ({
  SlotRecipePicker: (props: {
    slot: PlanSlotView;
    onClose: () => void;
    onAssigned: (plan: PlanView) => void;
    onPlanStale: () => void;
    onNotify: (message: string) => void;
  }) => (
    <div data-testid="picker" data-slot-id={props.slot.id}>
      <button onClick={() => props.onAssigned(makeResult(RECIPE_C).plan)}>finto-assegna</button>
      <button onClick={props.onClose}>finto-chiudi</button>
      <button onClick={() => { props.onPlanStale(); props.onClose(); }}>finto-scaduto</button>
      <button onClick={() => props.onNotify("avviso dal selettore")}>finto-avviso</button>
    </div>
  ),
}));

import {
  PlanRequestError,
  requestAddSideDish,
  requestRemoveSideDish,
  requestSwapSlot,
} from "@/lib/plans/client";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SLOT_ID = "22222222-2222-4222-8222-222222222222";
const SIDE_ID = "33333333-3333-4333-8333-333333333333";
const [RECIPE_A, RECIPE_B, RECIPE_C] = fixtureRecipesAsDomain();
const SIDE_A = makeRecipe({ title: "Insalata di finocchi", courses: ["contorno"] });
const SIDE_B = makeRecipe({ title: "Patate al forno", courses: ["contorno"] });
const SIDE_C = makeRecipe({ title: "Carote glassate", courses: ["contorno"] });
const ADD_LABEL = "Aggiungi un contorno";

function makeSlot(
  recipe: Recipe | null,
  locked = false,
  course: Course = "piatto-unico"
): PlanSlotView {
  return { id: SLOT_ID, day: "2026-10-01", meal: "cena", course, servings: 2, locked, recipe };
}

function makeSide(recipe: Recipe | null, locked = false): PlanSlotView {
  return { ...makeSlot(recipe, locked, "contorno"), id: SIDE_ID };
}

function planOf(slots: PlanSlotView[]): PlanView {
  return {
    id: PLAN_ID,
    week_start: "2026-09-28",
    status: "draft",
    created_at: "2026-09-29T10:00:00.000Z",
    generated_at: "2026-09-29T10:00:00.000Z",
    superseded: false,
    slots,
    shopping_list: { exists: false, needs_regeneration: false },
  };
}

function makeResult(recipe: Recipe): PlanMutationResult {
  return { plan: planOf([makeSlot(recipe)]), generation: { rounds: 0, created: 0, failed: false } };
}

function resultWith(main: PlanSlotView, side: PlanSlotView | null): PlanMutationResult {
  const slots = side ? [main, side] : [main];
  return { plan: planOf(slots), generation: { rounds: 0, created: 0, failed: false } };
}

interface HarnessProps {
  initial: PlanSlotView;
  side?: PlanSlotView | null;
  editable?: boolean;
  swappable?: boolean;
  onPlanChange?: (plan: PlanView) => void;
  onError?: (message: string) => void;
  onToggleLock?: (slotId: string) => void;
  onToggleFavorite?: (recipeId: string) => void;
  onPlanStale?: () => void;
  onRecipePrefsChange?: PlanSlotCardProps["onRecipePrefsChange"];
  onSelectRecipe?: (slot: PlanSlotView) => void;
}

/** Fa da genitore: il piano restituito da un'azione ridistribuisce pasto principale e contorno. */
function Harness({
  initial,
  side: initialSide = null,
  editable = true,
  swappable,
  onPlanChange = vi.fn(),
  onError = vi.fn(),
  onToggleLock = vi.fn(),
  onToggleFavorite,
  onPlanStale,
  onRecipePrefsChange,
  onSelectRecipe = vi.fn(),
}: HarnessProps) {
  const [slot, setSlot] = React.useState(initial);
  const [side, setSide] = React.useState<PlanSlotView | null>(initialSide);
  return (
    <PlanSlotCard
      planId={PLAN_ID}
      slot={slot}
      side={side}
      editable={editable}
      swappable={swappable}
      onPlanChange={(plan) => {
        onPlanChange(plan);
        setSlot(plan.slots.find((candidate) => candidate.course !== "contorno") ?? plan.slots[0]);
        setSide(plan.slots.find((candidate) => candidate.course === "contorno") ?? null);
      }}
      onToggleLock={onToggleLock}
      onSelectRecipe={onSelectRecipe}
      onToggleFavorite={onToggleFavorite}
      onPlanStale={onPlanStale}
      onRecipePrefsChange={onRecipePrefsChange}
      onError={onError}
    />
  );
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

describe("PlanSlotCard", () => {
  beforeEach(() => {
    vi.mocked(requestSwapSlot).mockReset();
    vi.mocked(requestAddSideDish).mockReset();
    vi.mocked(requestRemoveSideDish).mockReset();
  });

  it("swaps excluding the current recipe, shows progress, then the review actions", async () => {
    const pending = deferred<PlanMutationResult>();
    vi.mocked(requestSwapSlot).mockReturnValueOnce(pending.promise);
    const onPlanChange = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} onPlanChange={onPlanChange} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));

    expect(requestSwapSlot).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, [RECIPE_A.id]);
    expect(screen.getByText("Cerco un'alternativa…")).toBeInTheDocument();

    await act(async () => pending.resolve(makeResult(RECIPE_B)));

    expect(screen.getByText(RECIPE_B.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tieni" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambia ancora" })).toBeInTheDocument();
    expect(screen.queryByText("Cerco un'alternativa…")).toBeNull();
    expect(onPlanChange).toHaveBeenCalledTimes(1);
  });

  it("accumulates rejected recipes when swapping again with 'Cambia ancora'", async () => {
    vi.mocked(requestSwapSlot)
      .mockResolvedValueOnce(makeResult(RECIPE_B))
      .mockResolvedValueOnce(makeResult(RECIPE_C));
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Cambia ancora" }));

    expect(await screen.findByText(RECIPE_C.title)).toBeInTheDocument();
    expect(requestSwapSlot).toHaveBeenNthCalledWith(2, PLAN_ID, SLOT_ID, [
      RECIPE_A.id,
      RECIPE_B.id,
    ]);
  });

  it("returns to the plain Cambia button on 'Tieni' and restarts the sequence with the current recipe only", async () => {
    vi.mocked(requestSwapSlot)
      .mockResolvedValueOnce(makeResult(RECIPE_B))
      .mockResolvedValueOnce(makeResult(RECIPE_C));
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Tieni" }));

    expect(screen.queryByRole("button", { name: "Tieni" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_B.title}` }));

    await screen.findByText(RECIPE_C.title);
    expect(requestSwapSlot).toHaveBeenNthCalledWith(2, PLAN_ID, SLOT_ID, [RECIPE_B.id]);
  });

  it("reports a rejected swap through onError and keeps the previous recipe", async () => {
    vi.mocked(requestSwapSlot).mockRejectedValueOnce(
      new PlanRequestError(422, "no_alternatives", "Non ci sono altre ricette adatte a questo pasto.")
    );
    const onError = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Non ci sono altre ricette adatte a questo pasto.")
    );
    expect(screen.getByText(RECIPE_A.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` })).toBeEnabled();
    expect(screen.queryByText("Cerco un'alternativa…")).toBeNull();
  });

  it("falls back to review mode after a rejected 'Cambia ancora'", async () => {
    vi.mocked(requestSwapSlot)
      .mockResolvedValueOnce(makeResult(RECIPE_B))
      .mockRejectedValueOnce(new PlanRequestError(500, "internal_error", "Errore."));
    const onError = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Cambia ancora" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Errore."));
    expect(screen.getByRole("button", { name: "Tieni" })).toBeInTheDocument();
    expect(screen.getByText(RECIPE_B.title)).toBeInTheDocument();
  });

  it("keeps at most SWAP_EXCLUDE_MAX exclusions, always including the current recipe", async () => {
    const variants = Array.from({ length: SWAP_EXCLUDE_MAX + 2 }, (_, index) => ({
      ...RECIPE_B,
      id: crypto.randomUUID(),
      title: `Variante ${index}`,
    }));
    const served: Recipe[] = [];
    vi.mocked(requestSwapSlot).mockImplementation(async () => {
      const next = variants.shift() as Recipe;
      served.push(next);
      return makeResult(next);
    });
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
    for (let i = 0; i < SWAP_EXCLUDE_MAX; i++) {
      fireEvent.click(await screen.findByRole("button", { name: "Cambia ancora" }));
      await screen.findByText(`Variante ${i + 1}`);
    }

    const calls = vi.mocked(requestSwapSlot).mock.calls;
    const lastExclude = calls[calls.length - 1][2];
    expect(lastExclude).toHaveLength(SWAP_EXCLUDE_MAX);
    expect(lastExclude).not.toContain(RECIPE_A.id); // the oldest one is dropped
    expect(lastExclude[lastExclude.length - 1]).toBe(served[served.length - 2].id);
    expect(new Set(lastExclude).size).toBe(SWAP_EXCLUDE_MAX);
  });

  it("renders a read-only card without Cambia or lock when not editable", () => {
    render(<Harness initial={makeSlot(RECIPE_A)} editable={false} />);

    expect(screen.getByText(RECIPE_A.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cambia/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Blocca pasto|Sblocca pasto/ })).toBeNull();
  });

  it("disables Cambia on a locked slot and forwards lock toggles", () => {
    const onToggleLock = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A, true)} onToggleLock={onToggleLock} />);

    expect(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sblocca pasto" }));
    expect(onToggleLock).toHaveBeenCalledWith(SLOT_ID);
  });

  it("offers the lock but no Cambia on a slot that cannot be swapped (past day)", () => {
    const onToggleLock = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} swappable={false} onToggleLock={onToggleLock} />);

    expect(screen.queryByRole("button", { name: /^Cambia/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Blocca pasto" }));
    expect(onToggleLock).toHaveBeenCalledWith(SLOT_ID);
  });

  describe("focus", () => {
    it("moves the focus to Tieni when the swapped recipe is shown", async () => {
      vi.mocked(requestSwapSlot).mockResolvedValueOnce(makeResult(RECIPE_B));
      render(<Harness initial={makeSlot(RECIPE_A)} />);

      const cambia = screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` });
      cambia.focus();
      fireEvent.click(cambia);

      const tieni = await screen.findByRole("button", { name: "Tieni" });
      await waitFor(() => expect(document.activeElement).toBe(tieni));
    });

    it("brings the focus back to Cambia after Tieni", async () => {
      vi.mocked(requestSwapSlot).mockResolvedValueOnce(makeResult(RECIPE_B));
      render(<Harness initial={makeSlot(RECIPE_A)} />);

      fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
      const tieni = await screen.findByRole("button", { name: "Tieni" });
      tieni.focus();
      fireEvent.click(tieni);

      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: `Cambia ${RECIPE_B.title}` })
        )
      );
    });

    it("brings the focus back to Cambia after a rejected swap", async () => {
      vi.mocked(requestSwapSlot).mockRejectedValueOnce(
        new PlanRequestError(422, "no_alternatives", "Nessuna alternativa.")
      );
      render(<Harness initial={makeSlot(RECIPE_A)} />);

      const cambia = screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` });
      cambia.focus();
      fireEvent.click(cambia);

      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` })
        )
      );
    });

    it("does not steal the focus when the user moved elsewhere during the swap", async () => {
      const pending = deferred<PlanMutationResult>();
      vi.mocked(requestSwapSlot).mockReturnValueOnce(pending.promise);
      render(
        <>
          <Harness initial={makeSlot(RECIPE_A)} />
          <button type="button">Altrove</button>
        </>
      );

      fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
      const elsewhere = screen.getByRole("button", { name: "Altrove" });
      elsewhere.focus();
      await act(async () => pending.resolve(makeResult(RECIPE_B)));

      expect(screen.getByRole("button", { name: "Tieni" })).toBeInTheDocument();
      expect(document.activeElement).toBe(elsewhere);
    });
  });

  it("uses only the weekday name as day label and a placeholder for a missing recipe", () => {
    render(<Harness initial={makeSlot(null)} />);

    expect(screen.getByText("GIOVEDÌ · CENA")).toBeInTheDocument();
    expect(screen.getByText("Ricetta non disponibile")).toBeInTheDocument();
  });

  describe("favorite star", () => {
    const withPrefs = (prefs: Partial<NonNullable<Recipe["prefs"]>>): Recipe => ({
      ...RECIPE_A,
      prefs: {
        recipe_id: RECIPE_A.id,
        rating: null,
        favorite: false,
        blocked: false,
        times_used: 0,
        last_used_at: null,
        ...prefs,
      },
    });

    it("shows no star without onToggleFavorite", () => {
      render(<Harness initial={makeSlot(RECIPE_A)} />);

      expect(screen.queryByRole("button", { name: "Aggiungi ai preferiti" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rimuovi dai preferiti" })).toBeNull();
    });

    it("passes the recipe id, not the slot id, when the star is tapped", () => {
      const onToggleFavorite = vi.fn();
      render(<Harness initial={makeSlot(RECIPE_A)} onToggleFavorite={onToggleFavorite} />);

      fireEvent.click(screen.getByRole("button", { name: "Aggiungi ai preferiti" }));

      expect(onToggleFavorite).toHaveBeenCalledWith(RECIPE_A.id);
      expect(onToggleFavorite).not.toHaveBeenCalledWith(SLOT_ID);
    });

    it("marks the star as pressed when the recipe is a favorite", () => {
      render(
        <Harness initial={makeSlot(withPrefs({ favorite: true }))} onToggleFavorite={vi.fn()} />
      );

      expect(screen.getByRole("button", { name: "Rimuovi dai preferiti" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("shows no star when the recipe is blocked", () => {
      render(
        <Harness initial={makeSlot(withPrefs({ blocked: true }))} onToggleFavorite={vi.fn()} />
      );

      expect(screen.queryByRole("button", { name: /preferiti/ })).toBeNull();
    });

    it("shows no star when the slot has no recipe", () => {
      render(<Harness initial={makeSlot(null)} onToggleFavorite={vi.fn()} />);

      expect(screen.queryByRole("button", { name: /preferiti/ })).toBeNull();
    });

    it("shows the star on a read-only card", () => {
      render(
        <Harness initial={makeSlot(RECIPE_A)} editable={false} onToggleFavorite={vi.fn()} />
      );

      expect(screen.getByRole("button", { name: "Aggiungi ai preferiti" })).toBeInTheDocument();
    });
  });
});

describe("PlanSlotCard — Scegli", () => {
  const scegliName = (title: string) => `Scegli un'altra ricetta per ${title}`;

  beforeEach(() => {
    vi.mocked(requestSwapSlot).mockReset();
  });

  it("offers Scegli on an editable card that can be swapped", () => {
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    expect(screen.getByRole("button", { name: scegliName(RECIPE_A.title) })).toBeInTheDocument();
  });

  it("offers no Scegli on a read-only card or on a slot that cannot be swapped", () => {
    const { unmount } = render(<Harness initial={makeSlot(RECIPE_A)} editable={false} />);
    expect(screen.queryByRole("button", { name: scegliName(RECIPE_A.title) })).toBeNull();
    unmount();

    render(<Harness initial={makeSlot(RECIPE_A)} swappable={false} />);
    expect(screen.queryByRole("button", { name: scegliName(RECIPE_A.title) })).toBeNull();
  });

  it("disables Scegli on a locked slot and does not open the picker", () => {
    render(<Harness initial={makeSlot(RECIPE_A, true)} />);

    const scegli = screen.getByRole("button", { name: scegliName(RECIPE_A.title) });
    expect(scegli).toBeDisabled();
    fireEvent.click(scegli);
    expect(screen.queryByTestId("picker")).toBeNull();
  });

  it("mounts the picker for this slot when Scegli is tapped", () => {
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: scegliName(RECIPE_A.title) }));

    expect(screen.getByTestId("picker")).toHaveAttribute("data-slot-id", SLOT_ID);
  });

  it("applies an assignment from the normal state and puts the focus back on Scegli", async () => {
    const onPlanChange = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} onPlanChange={onPlanChange} />);

    fireEvent.click(screen.getByRole("button", { name: scegliName(RECIPE_A.title) }));
    fireEvent.click(screen.getByRole("button", { name: "finto-assegna" }));

    expect(onPlanChange).toHaveBeenCalledTimes(1);
    expect(onPlanChange).toHaveBeenCalledWith(makeResult(RECIPE_C).plan);
    expect(screen.queryByTestId("picker")).toBeNull();
    expect(screen.getByText(RECIPE_C.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tieni" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: scegliName(RECIPE_C.title) })
      )
    );
  });

  it("closes without assigning and keeps the card as it was, focus on Scegli", async () => {
    const onPlanChange = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} onPlanChange={onPlanChange} />);

    fireEvent.click(screen.getByRole("button", { name: scegliName(RECIPE_A.title) }));
    fireEvent.click(screen.getByRole("button", { name: "finto-chiudi" }));

    expect(screen.queryByTestId("picker")).toBeNull();
    expect(onPlanChange).not.toHaveBeenCalled();
    expect(screen.getByText(RECIPE_A.title)).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: scegliName(RECIPE_A.title) })
      )
    );
  });

  it("shows Tieni, the library icon and Cambia ancora, in this order, after a swap", async () => {
    vi.mocked(requestSwapSlot).mockResolvedValueOnce(makeResult(RECIPE_B));
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
    const tieni = await screen.findByRole("button", { name: "Tieni" });
    const row = tieni.parentElement as HTMLElement;

    const labels = within(row)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim());
    expect(labels).toEqual(["Tieni", "Scegli dalla libreria", "Cambia ancora"]);
  });

  it("assigns from the review row, clears the review and restarts the Cambia sequence", async () => {
    vi.mocked(requestSwapSlot)
      .mockResolvedValueOnce(makeResult(RECIPE_B))
      .mockReturnValueOnce(new Promise<PlanMutationResult>(() => {}));
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Scegli dalla libreria" }));
    fireEvent.click(screen.getByRole("button", { name: "finto-assegna" }));

    expect(screen.queryByRole("button", { name: "Tieni" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cambia ancora" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_C.title}` }));
    expect(requestSwapSlot).toHaveBeenLastCalledWith(PLAN_ID, SLOT_ID, [RECIPE_C.id]);
  });

  it("keeps the review on close and brings the focus back to the library icon", async () => {
    vi.mocked(requestSwapSlot).mockResolvedValueOnce(makeResult(RECIPE_B));
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Scegli dalla libreria" }));
    fireEvent.click(screen.getByRole("button", { name: "finto-chiudi" }));

    expect(screen.queryByTestId("picker")).toBeNull();
    expect(screen.getByRole("button", { name: "Tieni" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambia ancora" })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Scegli dalla libreria" })
      )
    );
  });

  it("notifies the parent once and closes the picker when the plan is stale", () => {
    const onPlanStale = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} onPlanStale={onPlanStale} />);

    fireEvent.click(screen.getByRole("button", { name: scegliName(RECIPE_A.title) }));
    fireEvent.click(screen.getByRole("button", { name: "finto-scaduto" }));

    expect(onPlanStale).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("picker")).toBeNull();
  });

  it("forwards the picker notices to onError", () => {
    const onError = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A)} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: scegliName(RECIPE_A.title) }));
    fireEvent.click(screen.getByRole("button", { name: "finto-avviso" }));

    expect(onError).toHaveBeenCalledWith("avviso dal selettore");
  });

  it("offers no Scegli while a swap is pending", () => {
    vi.mocked(requestSwapSlot).mockReturnValueOnce(new Promise<PlanMutationResult>(() => {}));
    render(<Harness initial={makeSlot(RECIPE_A)} />);

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));

    expect(screen.getByText("Cerco un'alternativa…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Scegli/ })).toBeNull();
  });

  it("offers Scegli on a slot without a recipe", () => {
    render(<Harness initial={makeSlot(null)} />);

    expect(
      screen.getByRole("button", { name: scegliName("Ricetta non disponibile") })
    ).toBeInTheDocument();
  });
});

describe("PlanSlotCard — contorno", () => {
  const sideSwapName = `Cambia contorno: ${SIDE_A.title}`;
  const sidePickName = `Scegli contorno: ${SIDE_A.title}`;
  const sideRemoveName = `Togli contorno: ${SIDE_A.title}`;
  const mainScegliName = `Scegli un'altra ricetta per ${RECIPE_A.title}`;

  beforeEach(() => {
    vi.mocked(requestSwapSlot).mockReset();
    vi.mocked(requestAddSideDish).mockReset();
    vi.mocked(requestRemoveSideDish).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers «Aggiungi un contorno» on a primo or a secondo without a side dish", () => {
    const { unmount } = render(<Harness initial={makeSlot(RECIPE_A, false, "secondo")} />);
    expect(screen.getByRole("button", { name: ADD_LABEL })).toBeInTheDocument();
    unmount();

    render(<Harness initial={makeSlot(RECIPE_A, false, "primo")} />);
    expect(screen.getByRole("button", { name: ADD_LABEL })).toBeInTheDocument();
  });

  it("offers no «Aggiungi un contorno» on a piatto unico", () => {
    render(<Harness initial={makeSlot(RECIPE_A, false, "piatto-unico")} />);

    expect(screen.queryByRole("button", { name: ADD_LABEL })).toBeNull();
  });

  it("shows no side actions on a locked or read-only meal, and no add button", () => {
    const { unmount } = render(
      <Harness initial={makeSlot(RECIPE_A, true, "secondo")} side={makeSide(SIDE_A, true)} />
    );
    expect(screen.getByText(SIDE_A.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: sideSwapName })).toBeNull();
    expect(screen.queryByRole("button", { name: sidePickName })).toBeNull();
    expect(screen.queryByRole("button", { name: sideRemoveName })).toBeNull();
    unmount();

    const readOnly = render(
      <Harness
        initial={makeSlot(RECIPE_A, false, "secondo")}
        side={makeSide(SIDE_A)}
        editable={false}
      />
    );
    expect(screen.queryByRole("button", { name: sideSwapName })).toBeNull();
    expect(screen.queryByRole("button", { name: sideRemoveName })).toBeNull();
    readOnly.unmount();

    render(<Harness initial={makeSlot(RECIPE_A, true, "secondo")} />);
    expect(screen.queryByRole("button", { name: ADD_LABEL })).toBeNull();
  });

  it("adds a side dish: waits with a message, then shows the side row from the returned plan", async () => {
    const pending = deferred<PlanMutationResult>();
    vi.mocked(requestAddSideDish).mockReturnValueOnce(pending.promise);
    const onPlanChange = vi.fn();
    render(<Harness initial={makeSlot(RECIPE_A, false, "secondo")} onPlanChange={onPlanChange} />);

    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL }));

    expect(requestAddSideDish).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, []);
    expect(screen.getByRole("status")).toHaveTextContent("Cerco un contorno…");
    expect(screen.queryByRole("button", { name: ADD_LABEL })).toBeNull();

    await act(async () =>
      pending.resolve(resultWith(makeSlot(RECIPE_A, false, "secondo"), makeSide(SIDE_A)))
    );

    expect(onPlanChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: sideSwapName })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: ADD_LABEL })).toBeNull();
  });

  it("moves the focus to the swap button of the new side dish", async () => {
    vi.mocked(requestAddSideDish).mockResolvedValueOnce(
      resultWith(makeSlot(RECIPE_A, false, "secondo"), makeSide(SIDE_A))
    );
    render(<Harness initial={makeSlot(RECIPE_A, false, "secondo")} />);

    const add = screen.getByRole("button", { name: ADD_LABEL });
    add.focus();
    fireEvent.click(add);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: sideSwapName })));
  });

  it("removes the side dish with the side slot id and brings back the add button", async () => {
    vi.mocked(requestRemoveSideDish).mockResolvedValueOnce({
      plan: planOf([makeSlot(RECIPE_A, false, "secondo")]),
    });
    render(
      <Harness initial={makeSlot(RECIPE_A, false, "secondo")} side={makeSide(SIDE_A)} />
    );

    fireEvent.click(screen.getByRole("button", { name: sideRemoveName }));

    expect(requestRemoveSideDish).toHaveBeenCalledWith(PLAN_ID, SIDE_ID);
    expect(await screen.findByRole("button", { name: ADD_LABEL })).toBeInTheDocument();
    expect(screen.queryByText(SIDE_A.title)).toBeNull();
  });

  it("swaps the side dish excluding the current one, then excludes the previous one too", async () => {
    vi.mocked(requestSwapSlot)
      .mockResolvedValueOnce(resultWith(makeSlot(RECIPE_A, false, "secondo"), makeSide(SIDE_B)))
      .mockResolvedValueOnce(resultWith(makeSlot(RECIPE_A, false, "secondo"), makeSide(SIDE_C)));
    render(
      <Harness initial={makeSlot(RECIPE_A, false, "secondo")} side={makeSide(SIDE_A)} />
    );

    fireEvent.click(screen.getByRole("button", { name: sideSwapName }));
    expect(requestSwapSlot).toHaveBeenNthCalledWith(1, PLAN_ID, SIDE_ID, [SIDE_A.id]);

    fireEvent.click(await screen.findByRole("button", { name: `Cambia contorno: ${SIDE_B.title}` }));
    expect(requestSwapSlot).toHaveBeenNthCalledWith(2, PLAN_ID, SIDE_ID, [SIDE_A.id, SIDE_B.id]);
    expect(await screen.findByText(SIDE_C.title)).toBeInTheDocument();
  });

  it("reports a stale-plan refusal through onError and onPlanStale, and restores the add button", async () => {
    vi.mocked(requestAddSideDish).mockRejectedValueOnce(
      new PlanRequestError(409, "side_exists", "Questo pasto ha già un contorno.")
    );
    const onError = vi.fn();
    const onPlanStale = vi.fn();
    render(
      <Harness
        initial={makeSlot(RECIPE_A, false, "secondo")}
        onError={onError}
        onPlanStale={onPlanStale}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Questo pasto ha già un contorno."));
    expect(onPlanStale).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: ADD_LABEL })).toBeEnabled();
  });

  it("reports a failed side swap through onError without asking to reread the plan", async () => {
    vi.mocked(requestSwapSlot).mockRejectedValueOnce(
      new PlanRequestError(422, "no_alternatives", "Non ci sono altre ricette adatte a questo pasto.")
    );
    const onError = vi.fn();
    const onPlanStale = vi.fn();
    render(
      <Harness
        initial={makeSlot(RECIPE_A, false, "secondo")}
        side={makeSide(SIDE_A)}
        onError={onError}
        onPlanStale={onPlanStale}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: sideSwapName }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Non ci sono altre ricette adatte a questo pasto.")
    );
    expect(onPlanStale).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: sideSwapName })).toBeEnabled();
  });

  it("disables the side actions while the main swap is pending", () => {
    vi.mocked(requestSwapSlot).mockReturnValueOnce(new Promise<PlanMutationResult>(() => {}));
    render(
      <Harness initial={makeSlot(RECIPE_A, false, "secondo")} side={makeSide(SIDE_A)} />
    );

    fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` }));

    expect(screen.getByRole("button", { name: sideSwapName })).toBeDisabled();
    expect(screen.getByRole("button", { name: sidePickName })).toBeDisabled();
    expect(screen.getByRole("button", { name: sideRemoveName })).toBeDisabled();
  });

  it("disables Cambia, Scegli and the lock of the main while a side action is pending", () => {
    vi.mocked(requestSwapSlot).mockReturnValueOnce(new Promise<PlanMutationResult>(() => {}));
    render(
      <Harness initial={makeSlot(RECIPE_A, false, "secondo")} side={makeSide(SIDE_A)} />
    );

    fireEvent.click(screen.getByRole("button", { name: sideSwapName }));

    expect(screen.getByRole("button", { name: `Cambia ${RECIPE_A.title}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: mainScegliName })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Blocca pasto" })).toBeDisabled();
  });

  it("disables the lock while adding a side dish, and a long-press does not toggle it", () => {
    vi.useFakeTimers();
    const onToggleLock = vi.fn();
    vi.mocked(requestAddSideDish).mockReturnValueOnce(new Promise<PlanMutationResult>(() => {}));
    render(
      <Harness initial={makeSlot(RECIPE_A, false, "secondo")} onToggleLock={onToggleLock} />
    );
    const card = screen.getByTestId(`meal-card-${SLOT_ID}`);

    // Controllo: fuori da un'azione la pressione lunga blocca il pasto.
    fireEvent.pointerDown(card, { button: 0, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onToggleLock).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(card);
    onToggleLock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL }));
    expect(screen.getByRole("button", { name: "Blocca pasto" })).toBeDisabled();

    fireEvent.pointerDown(card, { button: 0, clientX: 0, clientY: 0 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onToggleLock).not.toHaveBeenCalled();
  });

  it("the side title opens the detail of the side dish", () => {
    const onSelectRecipe = vi.fn();
    render(
      <Harness
        initial={makeSlot(RECIPE_A, false, "secondo")}
        side={makeSide(SIDE_A)}
        onSelectRecipe={onSelectRecipe}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: SIDE_A.title }));

    expect(onSelectRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: SIDE_ID }));
  });

  it("opens the picker on the side slot and brings the focus back to Scegli contorno on close", async () => {
    render(
      <Harness initial={makeSlot(RECIPE_A, false, "secondo")} side={makeSide(SIDE_A)} />
    );

    fireEvent.click(screen.getByRole("button", { name: sidePickName }));
    expect(screen.getByTestId("picker")).toHaveAttribute("data-slot-id", SIDE_ID);

    fireEvent.click(screen.getByRole("button", { name: "finto-chiudi" }));

    expect(screen.queryByTestId("picker")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: sidePickName }))
    );
  });

  it("shows the placeholder title of a side dish without recipe, not tappable for the detail", () => {
    const onSelectRecipe = vi.fn();
    render(
      <Harness
        initial={makeSlot(RECIPE_A, false, "secondo")}
        side={makeSide(null)}
        onSelectRecipe={onSelectRecipe}
      />
    );

    expect(screen.getByText("Ricetta non disponibile")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ricetta non disponibile" })
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Cambia contorno: Ricetta non disponibile" })
    ).toBeInTheDocument();
    expect(onSelectRecipe).not.toHaveBeenCalled();
  });
});

describe("PlanSlotCard — course badge", () => {
  it("shows the course of the slot, not every course of the recipe", () => {
    render(
      <Harness
        initial={makeSlot(makeRecipe({ courses: ["secondo", "piatto-unico"] }), false, "secondo")}
      />
    );

    expect(screen.getByText("Secondo")).toBeInTheDocument();
    expect(screen.queryByText("Piatto unico")).toBeNull();
  });

  it("shows no course badge for an unclassified recipe", () => {
    render(<Harness initial={makeSlot(makeRecipe({ courses: [] }))} />);

    expect(screen.queryByText(/Primo|Secondo|Contorno|Piatto unico/)).toBeNull();
    expect(screen.getByText("Ricetta di prova")).toBeInTheDocument();
  });

  it("shows the course once, as the badge, next to the style chips", () => {
    render(
      <Harness
        initial={makeSlot(
          makeRecipe({ courses: ["piatto-unico"], tags: ["comfort-food", "veloce"] })
        )}
      />
    );

    expect(screen.getAllByText("Piatto unico")).toHaveLength(1);
    expect(screen.getByText("Veloce")).toBeInTheDocument();
  });
});
