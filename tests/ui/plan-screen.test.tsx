import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRecipesAsDomain } from "@/fixtures";
import { PlanScreen, discardPendingPlanToast } from "@/components/plan/plan-screen";
import type {
  GeneratePlanResult,
  PlanScreenView,
  PlanMutationResult,
  PlanStatus,
  PlanView,
  PlanWeekView,
} from "@/lib/domain/types";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));

vi.mock("@/lib/plans/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/plans/client")>();
  return {
    ...original,
    fetchPlanScreen: vi.fn(),
    requestGeneratePlan: vi.fn(),
    requestConfirmPlan: vi.fn(),
    requestSlotLock: vi.fn(),
    requestSwapSlot: vi.fn(),
    requestRepeatPlan: vi.fn(),
  };
});

import {
  PlanRequestError,
  fetchPlanScreen,
  requestConfirmPlan,
  requestGeneratePlan,
  requestRepeatPlan,
  requestSlotLock,
  requestSwapSlot,
} from "@/lib/plans/client";

const RECIPES = fixtureRecipesAsDomain();
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAN_ID = "33333333-3333-4333-8333-333333333333";
const SLOT_IDS = [
  "22222222-2222-4222-8222-222222222220",
  "22222222-2222-4222-8222-222222222221",
];
const TARGET = { week_start: "2026-09-28", first_day: "2026-09-30", last_day: "2026-10-04" };
const GENERATED_AT = "2026-09-29T10:00:00.000Z";
const LATER_GENERATED_AT = "2026-09-29T11:00:00.000Z";

interface PlanOptions {
  id?: string;
  status?: PlanStatus;
  superseded?: boolean;
  weekStart?: string;
  generatedAt?: string;
  recipeOffset?: number;
}

function makePlan({
  id = PLAN_ID,
  status = "draft",
  superseded = false,
  weekStart = TARGET.week_start,
  generatedAt = GENERATED_AT,
  recipeOffset = 0,
}: PlanOptions = {}): PlanView {
  return {
    id,
    week_start: weekStart,
    status,
    created_at: GENERATED_AT,
    generated_at: generatedAt,
    superseded,
    slots: [
      {
        id: SLOT_IDS[0],
        day: "2026-09-30",
        meal: "pranzo",
        servings: 2,
        locked: false,
        recipe: RECIPES[recipeOffset],
      },
      {
        id: SLOT_IDS[1],
        day: "2026-09-30",
        meal: "cena",
        servings: 2,
        locked: false,
        recipe: RECIPES[recipeOffset + 1],
      },
    ],
    shopping_list: { exists: false, needs_regeneration: false },
  };
}

type ScreenOverrides = Partial<Omit<PlanScreenView, "view">> & {
  view?: Partial<PlanWeekView>;
  plan?: PlanOptions | null;
};

function makeScreen({ view, plan, ...rest }: ScreenOverrides = {}): PlanScreenView {
  const planView = plan === null ? null : makePlan(plan);
  const shownPlan = view?.plan !== undefined ? view.plan : planView;
  const status = shownPlan?.status ?? null;
  return {
    today: "2026-09-30",
    current_week_start: "2026-09-28",
    target: TARGET,
    prev_week_start: null,
    next_week_start: null,
    target_plan_status: status,
    current_plan_id: null,
    ...rest,
    view: {
      week: TARGET,
      plan: shownPlan,
      action: shownPlan === null ? "generate" : shownPlan.status === "draft" ? "regenerate" : "none",
      editable: shownPlan !== null,
      can_repeat: false,
      ...view,
    },
  };
}

/** Settimana passata (21-27 set), con piano di sola lettura ripetibile. */
function makePastScreen(overrides: ScreenOverrides = {}): PlanScreenView {
  return makeScreen({
    view: {
      week: { week_start: "2026-09-21", first_day: "2026-09-21", last_day: "2026-09-27" },
      plan: makePlan({ id: OTHER_PLAN_ID, status: "active", weekStart: "2026-09-21" }),
      action: "none",
      editable: false,
      can_repeat: true,
    },
    next_week_start: "2026-09-28",
    target_plan_status: null,
    ...overrides,
  });
}

function makeResult(screenView: PlanScreenView, failed = false): GeneratePlanResult {
  return { screen: screenView, generation: { rounds: 1, created: 3, failed } };
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

/** Con i timer finti `findBy`/`waitFor` non avanzano: si fa avanzare il tempo a passi. */
async function advanceUntil(check: () => boolean, stepMs = 1_000, maxMs = 15 * 60_000): Promise<void> {
  for (let elapsed = 0; elapsed <= maxMs; elapsed += stepMs) {
    if (check()) return;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(stepMs);
    });
  }
  throw new Error("condizione mai verificata");
}

const RECOVERY_WAIT_TEXT = "La connessione si è interrotta: controllo se il piano è pronto…";

describe("PlanScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discardPendingPlanToast();
  });

  describe("generation", () => {
    it("shows the empty state, then progress while generating, then the new plan and a toast", async () => {
      const pending = deferred<GeneratePlanResult>();
      vi.mocked(requestGeneratePlan).mockReturnValueOnce(pending.promise);
      render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

      expect(screen.getByRole("heading", { name: "Nessun piano in programma" })).toBeInTheDocument();
      expect(
        screen.getByText(
          "Genera il piano: sceglierò dalla tua libreria e, se serve, creerò ricette nuove."
        )
      ).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);

      expect(screen.getByText("Sto sfogliando il ricettario…")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Genera piano" })[0]).toBeDisabled();

      await act(async () => pending.resolve(makeResult(makeScreen())));

      expect(screen.getByText(RECIPES[0].title)).toBeInTheDocument();
      expect(screen.getByText(RECIPES[1].title)).toBeInTheDocument();
      expect(screen.getByText("Piano generato")).toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("uses the library-only toast when generation partially failed", async () => {
      vi.mocked(requestGeneratePlan).mockResolvedValueOnce(makeResult(makeScreen(), true));
      render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);

      expect(await screen.findByText("Piano generato con le ricette della libreria.")).toBeInTheDocument();
    });

    it("shows the server message in an alert when generation fails", async () => {
      const message = "Non ho trovato abbastanza ricette per i tuoi vincoli.";
      vi.mocked(requestGeneratePlan).mockRejectedValueOnce(
        new PlanRequestError(422, "insufficient_recipes", message)
      );
      render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });

    it("regenerates a draft plan with the Rigenera button", async () => {
      vi.mocked(requestGeneratePlan).mockResolvedValueOnce(
        makeResult(makeScreen({ plan: { recipeOffset: 2, generatedAt: LATER_GENERATED_AT } }))
      );
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Rigenera" }));

      expect(await screen.findByText(RECIPES[2].title)).toBeInTheDocument();
      expect(screen.queryByText(RECIPES[0].title)).toBeNull();
    });
  });

  describe("network recovery", () => {
    const networkError = () => new PlanRequestError(0, "network_error", "Connessione non disponibile.");

    it("adopts the plan saved by the server when the connection dropped during generation", async () => {
      vi.mocked(requestGeneratePlan).mockRejectedValueOnce(networkError());
      vi.mocked(fetchPlanScreen).mockResolvedValueOnce(makeScreen());
      render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);

      expect(await screen.findByText(RECIPES[0].title)).toBeInTheDocument();
      expect(fetchPlanScreen).toHaveBeenCalledWith(TARGET.week_start);
      expect(screen.getByText("Piano generato")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("adopts a regenerated plan only when generated_at is newer than the one shown", async () => {
      vi.mocked(requestGeneratePlan).mockRejectedValueOnce(networkError());
      vi.mocked(fetchPlanScreen).mockResolvedValueOnce(
        makeScreen({ plan: { recipeOffset: 2, generatedAt: LATER_GENERATED_AT } })
      );
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Rigenera" }));

      expect(await screen.findByText(RECIPES[2].title)).toBeInTheDocument();
      expect(screen.getByText("Piano generato")).toBeInTheDocument();
    });

    describe("waiting for the server (fake timers)", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      const alertText = () => screen.queryByRole("alert")?.textContent ?? "";

      it("keeps checking with backoff and adopts the plan once the server has saved it", async () => {
        vi.mocked(requestGeneratePlan).mockRejectedValueOnce(networkError());
        vi.mocked(fetchPlanScreen)
          .mockResolvedValueOnce(makeScreen({ plan: null }))
          .mockRejectedValueOnce(networkError())
          .mockResolvedValueOnce(makeScreen());
        render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

        fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(screen.getByText(RECOVERY_WAIT_TEXT)).toBeInTheDocument();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(fetchPlanScreen).toHaveBeenCalledTimes(1);

        await advanceUntil(() => screen.queryByText(RECIPES[0].title) !== null);

        expect(fetchPlanScreen).toHaveBeenCalledTimes(3);
        expect(screen.getByText("Piano generato")).toBeInTheDocument();
        expect(screen.queryByText(RECOVERY_WAIT_TEXT)).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("shows the network error when the stored plan never gets newer than the one shown", async () => {
        vi.mocked(requestGeneratePlan).mockRejectedValueOnce(networkError());
        vi.mocked(fetchPlanScreen).mockResolvedValue(makeScreen({ plan: { recipeOffset: 2 } }));
        render(<PlanScreen initialScreen={makeScreen()} />);

        fireEvent.click(screen.getByRole("button", { name: "Rigenera" }));
        await advanceUntil(() => alertText().includes("Connessione non disponibile."));

        expect(screen.getByText(RECIPES[0].title)).toBeInTheDocument();
        expect(vi.mocked(fetchPlanScreen).mock.calls.length).toBeGreaterThan(3);
      });

      it("shows the network error when there is still no plan once the wait is over", async () => {
        vi.mocked(requestGeneratePlan).mockRejectedValueOnce(networkError());
        vi.mocked(fetchPlanScreen).mockResolvedValue(makeScreen({ plan: null }));
        render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);
        const startedAt = Date.now();

        fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);
        await advanceUntil(() => alertText().includes("Connessione non disponibile."));

        // Fino al caso peggiore della rotta (maxDuration 500 s), non oltre l'ultima attesa.
        const waitedMs = Date.now() - startedAt;
        expect(waitedMs).toBeGreaterThanOrEqual(500_000);
        expect(waitedMs).toBeLessThan(540_000);
        expect(screen.queryByText(RECOVERY_WAIT_TEXT)).toBeNull();
      });

      it("shows the original error when every recovery request fails too", async () => {
        vi.mocked(requestGeneratePlan).mockRejectedValueOnce(networkError());
        vi.mocked(fetchPlanScreen).mockRejectedValue(networkError());
        render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

        fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);
        await advanceUntil(() => alertText().includes("Connessione non disponibile."));
      });

      it("stops waiting on 'Smetti di aspettare' and shows the error", async () => {
        vi.mocked(requestGeneratePlan).mockRejectedValueOnce(networkError());
        vi.mocked(fetchPlanScreen).mockResolvedValue(makeScreen({ plan: null }));
        render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

        fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        fireEvent.click(screen.getByRole("button", { name: "Smetti di aspettare" }));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(alertText()).toContain("Connessione non disponibile.");
        const calls = vi.mocked(fetchPlanScreen).mock.calls.length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(120_000);
        });
        expect(fetchPlanScreen).toHaveBeenCalledTimes(calls);
      });

      it("compares a hidden target draft with its generated_at read before repeating", async () => {
        vi.mocked(fetchPlanScreen)
          .mockResolvedValueOnce(makeScreen()) // base: bozza obiettivo generata alle 10
          .mockResolvedValueOnce(makeScreen()) // dopo l'errore: ancora la bozza vecchia
          .mockResolvedValueOnce(makeScreen({ plan: { generatedAt: LATER_GENERATED_AT } }));
        vi.mocked(requestRepeatPlan).mockRejectedValueOnce(networkError());
        render(<PlanScreen initialScreen={makePastScreen({ target_plan_status: "draft" })} />);

        fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));
        await advanceUntil(() => router.replace.mock.calls.length > 0);

        expect(vi.mocked(fetchPlanScreen).mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(requestRepeatPlan).mock.invocationCallOrder[0]
        );
        expect(fetchPlanScreen).toHaveBeenCalledTimes(3);
        expect(router.replace).toHaveBeenCalledWith("/?settimana=2026-09-28");
      });

      it("does not recover when the hidden target draft could not be read before repeating", async () => {
        vi.mocked(fetchPlanScreen).mockRejectedValueOnce(networkError());
        vi.mocked(requestRepeatPlan).mockRejectedValueOnce(networkError());
        render(<PlanScreen initialScreen={makePastScreen({ target_plan_status: "draft" })} />);

        fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(screen.getByText("Connessione non disponibile.")).toBeInTheDocument();
        expect(fetchPlanScreen).toHaveBeenCalledTimes(1);
        expect(router.replace).not.toHaveBeenCalled();
      });
    });

    it("does not try to recover from errors other than network_error", async () => {
      vi.mocked(requestGeneratePlan).mockRejectedValueOnce(
        new PlanRequestError(502, "llm_unavailable", "Il servizio non risponde.")
      );
      render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);

      expect(await screen.findByRole("alert")).toHaveTextContent("Il servizio non risponde.");
      expect(fetchPlanScreen).not.toHaveBeenCalled();
    });

    it("recovers a repeated plan from a network error and announces it", async () => {
      vi.mocked(requestRepeatPlan).mockRejectedValueOnce(networkError());
      vi.mocked(fetchPlanScreen).mockResolvedValueOnce(makeScreen());
      render(<PlanScreen initialScreen={makePastScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));

      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith("/?settimana=2026-09-28")
      );
      expect(screen.getByText("Piano ripetuto")).toBeInTheDocument();
    });
  });

  describe("confirmation and footer", () => {
    it("shows Rigenera and Conferma piano on a draft, and confirming activates the plan", async () => {
      vi.mocked(requestConfirmPlan).mockResolvedValueOnce({ plan: makePlan({ status: "active" }) });
      render(<PlanScreen initialScreen={makeScreen()} />);

      expect(screen.getByRole("button", { name: "Rigenera" })).toBeInTheDocument();
      expect(screen.getByText("Bozza")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Conferma piano" }));

      expect(await screen.findByText("Confermato")).toBeInTheDocument();
      expect(requestConfirmPlan).toHaveBeenCalledWith(PLAN_ID);
      expect(screen.getByText("Piano confermato")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Crea lista della spesa" })).toHaveAttribute(
        "href",
        `/lista?piano=${PLAN_ID}`
      );
      expect(screen.queryByRole("button", { name: "Conferma piano" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rigenera" })).toBeNull();
    });

    it("shows the shopping-list link for an already confirmed plan", () => {
      render(<PlanScreen initialScreen={makeScreen({ plan: { status: "active" } })} />);

      expect(screen.getByRole("link", { name: "Crea lista della spesa" })).toHaveAttribute(
        "href",
        `/lista?piano=${PLAN_ID}`
      );
      expect(screen.getByText("Confermato")).toBeInTheDocument();
    });

    it("toasts the error message when confirming fails", async () => {
      vi.mocked(requestConfirmPlan).mockRejectedValueOnce(
        new PlanRequestError(409, "plan_archived", "Questa settimana è conclusa.")
      );
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Conferma piano" }));

      expect(await screen.findByText("Questa settimana è conclusa.")).toBeInTheDocument();
      expect(screen.getByText("Bozza")).toBeInTheDocument();
    });

    it("shows no Genera/Rigenera button when action is none", () => {
      render(<PlanScreen initialScreen={makeScreen({ plan: { status: "active" } })} />);

      expect(screen.queryByRole("button", { name: "Genera piano" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rigenera" })).toBeNull();
    });
  });

  describe("week navigator", () => {
    it("renders prev/next links to the adjacent weeks", () => {
      render(
        <PlanScreen
          initialScreen={makeScreen({ prev_week_start: "2026-09-14", next_week_start: "2026-10-05" })}
        />
      );

      expect(screen.getByRole("link", { name: "Settimana precedente" })).toHaveAttribute(
        "href",
        "/?settimana=2026-09-14"
      );
      expect(screen.getByRole("link", { name: "Settimana successiva" })).toHaveAttribute(
        "href",
        "/?settimana=2026-10-05"
      );
    });

    it("renders disabled, non-focusable placeholders when there is no adjacent week", () => {
      render(<PlanScreen initialScreen={makeScreen()} />);

      for (const name of ["Settimana precedente", "Settimana successiva"]) {
        const disabled = screen.getByRole("link", { name });
        expect(disabled).toHaveAttribute("aria-disabled", "true");
        expect(disabled).not.toHaveAttribute("href");
        expect(disabled).not.toHaveAttribute("tabindex");
      }
    });

    it("navigates client-side on a plain click of the arrows", () => {
      render(<PlanScreen initialScreen={makeScreen({ prev_week_start: "2026-09-21" })} />);

      fireEvent.click(screen.getByRole("link", { name: "Settimana precedente" }));

      expect(router.push).toHaveBeenCalledWith("/?settimana=2026-09-21");
    });

    it("shows the week range from the plan week, or from the first plannable day without a plan", () => {
      const { unmount } = render(<PlanScreen initialScreen={makeScreen()} />);
      expect(screen.getByText("28 set – 4 ott")).toBeInTheDocument();
      unmount();

      render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);
      expect(screen.getByText("30 set – 4 ott")).toBeInTheDocument();
      expect(screen.queryByText("Bozza")).toBeNull();
      expect(screen.queryByText("Confermato")).toBeNull();
    });

    it("keeps a past week read-only: no Cambia, no lock, no confirm, but the sheet still opens", async () => {
      render(<PlanScreen initialScreen={makePastScreen()} />);

      expect(screen.getByText("21 set – 27 set")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Cambia/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Blocca pasto|Sblocca pasto/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Conferma piano" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Crea lista della spesa" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Genera piano" })).toBeNull();

      fireEvent.click(screen.getByText(RECIPES[0].title));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(RECIPES[0].title)).toBeInTheDocument();
    });

    it("offers to plan the next week when the current week has no plan during the weekend", () => {
      const weekendScreen = makeScreen({
        plan: null,
        today: "2026-10-03",
        current_week_start: "2026-09-28",
        target: { week_start: "2026-10-05", first_day: "2026-10-05", last_day: "2026-10-11" },
        view: {
          week: { week_start: "2026-09-28", first_day: "2026-09-28", last_day: "2026-10-04" },
          action: "none",
          editable: false,
        },
        next_week_start: "2026-10-05",
      });
      render(<PlanScreen initialScreen={weekendScreen} />);

      expect(
        screen.getByRole("heading", { name: "Nessun piano per questa settimana" })
      ).toBeInTheDocument();
      expect(screen.getByText("Nel weekend si pianifica la settimana che arriva.")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Pianifica la prossima settimana" }));

      expect(router.push).toHaveBeenCalledWith("/?settimana=2026-10-05");
    });

    it("shows a plain empty state without actions for a past week with no plan", () => {
      render(
        <PlanScreen
          initialScreen={makeScreen({
            plan: null,
            view: {
              week: { week_start: "2026-09-14", first_day: "2026-09-14", last_day: "2026-09-20" },
              action: "none",
              editable: false,
            },
            next_week_start: "2026-09-28",
          })}
        />
      );

      expect(
        screen.getByRole("heading", { name: "Nessun piano per questa settimana" })
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pianifica la prossima settimana" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Genera piano" })).toBeNull();
    });
  });

  describe("repeat", () => {
    it("shows 'Ripeti questo piano' only when the week can be repeated", () => {
      const { unmount } = render(<PlanScreen initialScreen={makeScreen()} />);
      expect(screen.queryByRole("button", { name: "Ripeti questo piano" })).toBeNull();
      unmount();

      render(<PlanScreen initialScreen={makePastScreen()} />);
      expect(screen.getByRole("button", { name: "Ripeti questo piano" })).toBeInTheDocument();
      expect(screen.getByText("Nella settimana 30 set – 4 ott")).toBeInTheDocument();
      expect(screen.queryByText("Sostituirà i pasti non bloccati della bozza.")).toBeNull();
    });

    it("warns that the existing draft will be replaced", () => {
      render(<PlanScreen initialScreen={makePastScreen({ target_plan_status: "draft" })} />);

      expect(screen.getByText("Sostituirà i pasti non bloccati della bozza.")).toBeInTheDocument();
    });

    it("repeats the shown plan, moves to the target week and announces it", async () => {
      const pending = deferred<GeneratePlanResult>();
      vi.mocked(requestRepeatPlan).mockReturnValueOnce(pending.promise);
      render(<PlanScreen initialScreen={makePastScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));

      expect(requestRepeatPlan).toHaveBeenCalledWith(OTHER_PLAN_ID);
      expect(screen.getByText("Sto sfogliando il ricettario…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ripeti questo piano" })).toBeDisabled();

      await act(async () => pending.resolve(makeResult(makeScreen())));

      expect(router.replace).toHaveBeenCalledWith("/?settimana=2026-09-28");
      expect(screen.getByText("Piano ripetuto")).toBeInTheDocument();
    });

    it("keeps the toast across the remount that follows the move to the target week", async () => {
      vi.mocked(requestRepeatPlan).mockResolvedValueOnce(makeResult(makeScreen()));
      const { unmount } = render(<PlanScreen initialScreen={makePastScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      unmount();

      render(<PlanScreen initialScreen={makeScreen()} />);

      expect(await screen.findByText("Piano ripetuto")).toBeInTheDocument();
    });

    it("toasts the error message when repeating fails", async () => {
      vi.mocked(requestRepeatPlan).mockRejectedValueOnce(
        new PlanRequestError(409, "plan_confirmed", "Il piano è già confermato.")
      );
      render(<PlanScreen initialScreen={makePastScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));

      expect(await screen.findByText("Il piano è già confermato.")).toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Ripeti questo piano" })).toBeEnabled();
    });

    it("offers 'Ripeti questa settimana' below the empty state when the current week has a plan", async () => {
      vi.mocked(requestRepeatPlan).mockResolvedValueOnce(makeResult(makeScreen()));
      render(
        <PlanScreen
          initialScreen={makeScreen({
            plan: null,
            current_plan_id: OTHER_PLAN_ID,
            target: { week_start: "2026-10-05", first_day: "2026-10-05", last_day: "2026-10-11" },
            current_week_start: "2026-09-28",
            view: {
              week: { week_start: "2026-10-05", first_day: "2026-10-05", last_day: "2026-10-11" },
            },
          })}
        />
      );

      expect(screen.getByRole("heading", { name: "Nessun piano in programma" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Ripeti questa settimana" }));

      expect(requestRepeatPlan).toHaveBeenCalledWith(OTHER_PLAN_ID);
      // La settimana mostrata è già quella obiettivo: si aggiorna lo stato, senza navigare.
      expect(await screen.findByText("Piano ripetuto")).toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
      expect(screen.getByText(RECIPES[0].title)).toBeInTheDocument();
    });

    it("hides 'Ripeti questa settimana' when there is no current plan to copy", () => {
      render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

      expect(screen.queryByRole("button", { name: "Ripeti questa settimana" })).toBeNull();
    });
  });

  describe("notices", () => {
    it("asks to regenerate a superseded draft", () => {
      render(<PlanScreen initialScreen={makeScreen({ plan: { superseded: true } })} />);

      expect(
        screen.getByText("Hai cambiato le impostazioni: rigenera il piano per applicarle.")
      ).toBeInTheDocument();
    });

    it("says new settings apply from the next plan when a superseded plan is confirmed", () => {
      render(
        <PlanScreen initialScreen={makeScreen({ plan: { status: "active", superseded: true } })} />
      );

      expect(
        screen.getByText("Le nuove impostazioni varranno dal prossimo piano.")
      ).toBeInTheDocument();
    });

    it("shows no superseded notice on a read-only week", () => {
      const past = makePastScreen();
      past.view.plan = { ...(past.view.plan as PlanView), superseded: true };
      render(<PlanScreen initialScreen={past} />);

      expect(screen.queryByText(/impostazioni/)).toBeNull();
    });
  });

  describe("results arriving late (M2, m5)", () => {
    it("shows a fresh initialScreen passed again with the same key", () => {
      const { rerender } = render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);
      expect(screen.getByRole("heading", { name: "Nessun piano in programma" })).toBeInTheDocument();

      rerender(<PlanScreen initialScreen={makeScreen()} />);

      expect(screen.getByText(RECIPES[0].title)).toBeInTheDocument();
    });

    it("disables the week arrows while generating", async () => {
      const pending = deferred<GeneratePlanResult>();
      vi.mocked(requestGeneratePlan).mockReturnValueOnce(pending.promise);
      render(<PlanScreen initialScreen={makeScreen({ plan: null, prev_week_start: "2026-09-21" })} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);

      const prev = screen.getByRole("link", { name: "Settimana precedente" });
      expect(prev).toHaveAttribute("aria-disabled", "true");
      expect(prev).not.toHaveAttribute("href");
      fireEvent.click(prev);
      expect(router.push).not.toHaveBeenCalled();

      await act(async () =>
        pending.resolve(makeResult(makeScreen({ prev_week_start: "2026-09-21" })))
      );

      expect(screen.getByRole("link", { name: "Settimana precedente" })).toHaveAttribute(
        "href",
        "/?settimana=2026-09-21"
      );
    });

    it("refreshes the route when a generation ends after the screen was left", async () => {
      const pending = deferred<GeneratePlanResult>();
      vi.mocked(requestGeneratePlan).mockReturnValueOnce(pending.promise);
      const { unmount } = render(<PlanScreen initialScreen={makeScreen({ plan: null })} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Genera piano" })[0]);
      unmount();
      await act(async () => pending.resolve(makeResult(makeScreen())));

      expect(router.refresh).toHaveBeenCalledTimes(1);
      expect(router.replace).not.toHaveBeenCalled();
      render(<PlanScreen initialScreen={makeScreen()} />);
      expect(screen.queryByText("Piano generato")).toBeNull();
    });

    it("neither navigates nor leaves a toast when a repeat ends after the screen was left", async () => {
      const pending = deferred<GeneratePlanResult>();
      vi.mocked(requestRepeatPlan).mockReturnValueOnce(pending.promise);
      const { unmount } = render(<PlanScreen initialScreen={makePastScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));
      unmount();
      await act(async () => pending.resolve(makeResult(makeScreen())));

      expect(router.refresh).toHaveBeenCalledTimes(1);
      expect(router.replace).not.toHaveBeenCalled();
      render(<PlanScreen initialScreen={makeScreen()} />);
      expect(screen.queryByText("Piano ripetuto")).toBeNull();
    });

    it("drops the pending toast when the next screen is not the target week", async () => {
      vi.mocked(requestRepeatPlan).mockResolvedValueOnce(makeResult(makeScreen()));
      const first = render(<PlanScreen initialScreen={makePastScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      first.unmount();

      const second = render(<PlanScreen initialScreen={makePastScreen()} />);
      expect(screen.queryByText("Piano ripetuto")).toBeNull();
      second.unmount();

      render(<PlanScreen initialScreen={makeScreen()} />);
      expect(screen.queryByText("Piano ripetuto")).toBeNull();
    });

    it("keeps Ripeti disabled while moving to the target week", async () => {
      vi.mocked(requestRepeatPlan).mockResolvedValue(makeResult(makeScreen()));
      render(<PlanScreen initialScreen={makePastScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: "Ripeti questo piano" }));
      await waitFor(() => expect(router.replace).toHaveBeenCalled());

      const repeat = screen.getByRole("button", { name: "Ripeti questo piano" });
      expect(repeat).toBeDisabled();
      fireEvent.click(repeat);
      expect(requestRepeatPlan).toHaveBeenCalledTimes(1);
    });
  });

  describe("past days of the current week (Q1)", () => {
    it("offers the lock but no Cambia on the meals of past days", () => {
      render(<PlanScreen initialScreen={makeScreen({ today: "2026-10-01" })} />);

      expect(screen.queryByRole("button", { name: /^Cambia/ })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Blocca pasto" })).toHaveLength(2);
    });
  });

  describe("out-of-order responses (m9)", () => {
    it("keeps a lock applied while a swap of another slot was pending", async () => {
      const swap = deferred<PlanMutationResult>();
      vi.mocked(requestSwapSlot).mockReturnValueOnce(swap.promise);
      const lockedPlan = makePlan();
      lockedPlan.slots[1] = { ...lockedPlan.slots[1], locked: true };
      vi.mocked(requestSlotLock).mockResolvedValueOnce({ plan: lockedPlan });
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPES[0].title}` }));
      fireEvent.click(screen.getAllByRole("button", { name: "Blocca pasto" })[1]);
      await waitFor(() => expect(requestSlotLock).toHaveBeenCalled());

      // Istantanea dello swap presa prima del blocco: slot 1 ancora sbloccato.
      const swapped = makePlan();
      swapped.slots[0] = { ...swapped.slots[0], recipe: RECIPES[2] };
      swapped.shopping_list = { exists: true, needs_regeneration: true };
      await act(async () =>
        swap.resolve({ plan: swapped, generation: { rounds: 0, created: 0, failed: false } })
      );

      expect(screen.getByText(RECIPES[2].title)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sblocca pasto" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("keeps the recipe of a swap that ended while a lock of another slot was pending", async () => {
      const lock = deferred<{ plan: PlanView }>();
      vi.mocked(requestSlotLock).mockReturnValueOnce(lock.promise);
      const swapped = makePlan();
      swapped.slots[0] = { ...swapped.slots[0], recipe: RECIPES[2] };
      vi.mocked(requestSwapSlot).mockResolvedValueOnce({
        plan: swapped,
        generation: { rounds: 0, created: 0, failed: false },
      });
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Blocca pasto" })[1]);
      fireEvent.click(screen.getByRole("button", { name: `Cambia ${RECIPES[0].title}` }));
      expect(await screen.findByText(RECIPES[2].title)).toBeInTheDocument();

      // Istantanea del blocco presa prima dello swap: slot 0 con la ricetta vecchia.
      const lockedPlan = makePlan();
      lockedPlan.slots[1] = { ...lockedPlan.slots[1], locked: true };
      await act(async () => lock.resolve({ plan: lockedPlan }));

      expect(screen.getByText(RECIPES[2].title)).toBeInTheDocument();
      expect(screen.queryByText(RECIPES[0].title)).toBeNull();
    });
  });

  describe("lock", () => {
    it("locks optimistically and calls the API", async () => {
      const pending = deferred<{ plan: PlanView }>();
      vi.mocked(requestSlotLock).mockReturnValueOnce(pending.promise);
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Blocca pasto" })[0]);

      expect(screen.getAllByRole("button", { name: "Sblocca pasto" })[0]).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      expect(requestSlotLock).toHaveBeenCalledWith(PLAN_ID, SLOT_IDS[0], true);

      const locked = makePlan();
      locked.slots[0] = { ...locked.slots[0], locked: true };
      await act(async () => pending.resolve({ plan: locked }));

      expect(screen.getAllByRole("button", { name: "Sblocca pasto" })).toHaveLength(1);
    });

    it("rolls the lock back and toasts the message when the request is rejected", async () => {
      vi.mocked(requestSlotLock).mockRejectedValueOnce(
        new PlanRequestError(500, "internal_error", "Impossibile bloccare il pasto.")
      );
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Blocca pasto" })[0]);

      expect(await screen.findByText("Impossibile bloccare il pasto.")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Blocca pasto" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Blocca pasto" })[0]).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
  });

  describe("recipe sheet and preferences", () => {
    it("opens the sheet with the recipe and without preference actions", async () => {
      render(<PlanScreen initialScreen={makeScreen()} />);

      fireEvent.click(screen.getByText(RECIPES[0].title));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(RECIPES[0].title)).toBeInTheDocument();
      expect(within(dialog).queryByText("Non proporre più")).toBeNull();
    });

    it("renders no favorite buttons on the cards", () => {
      render(<PlanScreen initialScreen={makeScreen()} />);

      expect(screen.queryByRole("button", { name: "Aggiungi ai preferiti" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Rimuovi dai preferiti" })).toBeNull();
    });
  });
});
