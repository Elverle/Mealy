import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRecipesAsDomain } from "@/fixtures";
import { makeRecipe } from "@/tests/helpers/recipes";
import { PlanSlotCard, type PlanSlotCardProps } from "@/components/plan/plan-slot-card";
import {
  SWAP_EXCLUDE_MAX,
  type PlanMutationResult,
  type PlanSlotView,
  type PlanView,
  type Recipe,
} from "@/lib/domain/types";

vi.mock("@/lib/plans/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/plans/client")>();
  return { ...original, requestSwapSlot: vi.fn() };
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

import { PlanRequestError, requestSwapSlot } from "@/lib/plans/client";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SLOT_ID = "22222222-2222-4222-8222-222222222222";
const [RECIPE_A, RECIPE_B, RECIPE_C] = fixtureRecipesAsDomain();

function makeSlot(recipe: Recipe | null, locked = false): PlanSlotView {
  return { id: SLOT_ID, day: "2026-10-01", meal: "cena", servings: 2, locked, recipe };
}

function makeResult(recipe: Recipe): PlanMutationResult {
  const plan: PlanView = {
    id: PLAN_ID,
    week_start: "2026-09-28",
    status: "draft",
    created_at: "2026-09-29T10:00:00.000Z",
    generated_at: "2026-09-29T10:00:00.000Z",
    superseded: false,
    slots: [makeSlot(recipe)],
    shopping_list: { exists: false, needs_regeneration: false },
  };
  return { plan, generation: { rounds: 0, created: 0, failed: false } };
}

interface HarnessProps {
  initial: PlanSlotView;
  editable?: boolean;
  swappable?: boolean;
  onPlanChange?: (plan: PlanView) => void;
  onError?: (message: string) => void;
  onToggleLock?: (slotId: string) => void;
  onToggleFavorite?: (recipeId: string) => void;
  onPlanStale?: () => void;
  onRecipePrefsChange?: PlanSlotCardProps["onRecipePrefsChange"];
}

/** Fa da genitore: sostituisce lo slot con quello del piano restituito dallo swap. */
function Harness({
  initial,
  editable = true,
  swappable,
  onPlanChange = vi.fn(),
  onError = vi.fn(),
  onToggleLock = vi.fn(),
  onToggleFavorite,
  onPlanStale,
  onRecipePrefsChange,
}: HarnessProps) {
  const [slot, setSlot] = React.useState(initial);
  return (
    <PlanSlotCard
      planId={PLAN_ID}
      slot={slot}
      editable={editable}
      swappable={swappable}
      onPlanChange={(plan) => {
        onPlanChange(plan);
        setSlot(plan.slots[0]);
      }}
      onToggleLock={onToggleLock}
      onSelectRecipe={vi.fn()}
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

describe("PlanSlotCard — course badge", () => {
  it("shows the courses of the recipe in course order", () => {
    render(<Harness initial={makeSlot(makeRecipe({ courses: ["contorno", "secondo"] }))} />);

    expect(screen.getByText("Secondo · Contorno")).toBeInTheDocument();
  });

  it("shows no course badge for an unclassified recipe", () => {
    render(<Harness initial={makeSlot(makeRecipe({ courses: [] }))} />);

    expect(screen.queryByText(/Primo|Secondo|Contorno|Piatto unico/)).toBeNull();
    expect(screen.getByText("Ricetta di prova")).toBeInTheDocument();
  });

  it("shows Piatto unico once, as the course, and not again among the style chips", () => {
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
