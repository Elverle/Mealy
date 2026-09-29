import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRecipesAsDomain } from "@/fixtures";
import { PlanSlotCard } from "@/components/plan/plan-slot-card";
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
  onPlanChange?: (plan: PlanView) => void;
  onError?: (message: string) => void;
  onToggleLock?: (slotId: string) => void;
}

/** Fa da genitore: sostituisce lo slot con quello del piano restituito dallo swap. */
function Harness({
  initial,
  editable = true,
  onPlanChange = vi.fn(),
  onError = vi.fn(),
  onToggleLock = vi.fn(),
}: HarnessProps) {
  const [slot, setSlot] = React.useState(initial);
  return (
    <PlanSlotCard
      planId={PLAN_ID}
      slot={slot}
      editable={editable}
      onPlanChange={(plan) => {
        onPlanChange(plan);
        setSlot(plan.slots[0]);
      }}
      onToggleLock={onToggleLock}
      onSelectRecipe={vi.fn()}
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

  it("uses only the weekday name as day label and a placeholder for a missing recipe", () => {
    render(<Harness initial={makeSlot(null)} />);

    expect(screen.getByText("GIOVEDÌ · CENA")).toBeInTheDocument();
    expect(screen.getByText("Ricetta non disponibile")).toBeInTheDocument();
  });
});
