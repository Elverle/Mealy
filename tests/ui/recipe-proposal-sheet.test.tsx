import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERATION_MESSAGES,
  GENERATION_MESSAGE_INTERVAL_MS,
} from "@/components/plan/generation-progress";
import {
  RecipeProposalSheet,
  type RecipeProposalSheetProps,
} from "@/components/recipes/recipe-proposal-sheet";
import type { GeneratedRecipe, RecipeProposal } from "@/lib/domain/types";
import { ApiRequestError } from "@/lib/http/client";

vi.mock("@/lib/library/client", () => ({ requestRecipeProposal: vi.fn() }));

import { requestRecipeProposal } from "@/lib/library/client";

const requestMock = vi.mocked(requestRecipeProposal);

const DUPLICATE_ID = "44444444-4444-4444-8444-444444444444";
const UNSUITABLE_MESSAGE =
  "Non sono riuscito a proporre una ricetta adatta ai tuoi vincoli. Prova a cambiare la richiesta.";

const LASAGNE: GeneratedRecipe = {
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

const ALTRA: GeneratedRecipe = { ...LASAGNE, title: "Lasagne bianche ai funghi" };

function proposal(
  recipe: GeneratedRecipe,
  duplicate: RecipeProposal["duplicate_of"] = null
): RecipeProposal {
  return { recipe, duplicate_of: duplicate };
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

function renderSheet(props: Partial<RecipeProposalSheetProps> = {}) {
  const onAccept = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const base: RecipeProposalSheetProps = {
    request: "lasagne",
    mealType: null,
    servings: 2,
    acceptLabel: "Aggiungi alla libreria",
    onAccept,
    onClose,
  };
  const utils = render(<RecipeProposalSheet {...base} {...props} />);
  return {
    ...utils,
    onAccept,
    onClose,
    rerenderWith: (next: Partial<RecipeProposalSheetProps>) =>
      utils.rerender(<RecipeProposalSheet {...base} {...props} {...next} />),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("RecipeProposalSheet opening", () => {
  it("renders no dialog and makes no request when request is null", () => {
    renderSheet({ request: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("requests a proposal for the request and shows the waiting state", () => {
    requestMock.mockReturnValue(new Promise<RecipeProposal>(() => {}));
    renderSheet();

    expect(requestMock).toHaveBeenCalledWith(
      { request: "lasagne", mealType: null, excludeTitles: [] },
      expect.any(AbortSignal)
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "«lasagne»" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cerco una ricetta…");
  });

  it("sends the meal type imposed by the caller", () => {
    requestMock.mockReturnValue(new Promise<RecipeProposal>(() => {}));
    renderSheet({ mealType: "cena" });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ mealType: "cena" }),
      expect.any(AbortSignal)
    );
  });
});

describe("RecipeProposalSheet proposal view", () => {
  it("shows the proposal read-only with scaled quantities and the actions", async () => {
    requestMock.mockResolvedValue(proposal(LASAGNE));
    renderSheet({ servings: 4 });

    expect(await screen.findByRole("heading", { name: "Lasagne al pesto" })).toBeInTheDocument();
    expect(screen.getByText("Basilico")).toBeInTheDocument();
    expect(screen.getByText("(100 g)")).toBeInTheDocument();
    expect(screen.getByText("Stendi la pasta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aggiungi alla libreria" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Un'altra" })).toBeEnabled();
  });

  it("offers no rating, favorite, block or preference controls", async () => {
    requestMock.mockResolvedValue(proposal(LASAGNE));
    renderSheet();

    await screen.findByRole("heading", { name: "Lasagne al pesto" });
    expect(screen.queryByRole("button", { name: "Vota 1 stelle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preferita" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Non proporre più" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preferisci Basilico" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scarta Basilico" })).not.toBeInTheDocument();
  });

  it("asks for another title with the proposals so far and replaces the view while waiting", async () => {
    const second = deferred<RecipeProposal>();
    requestMock
      .mockResolvedValueOnce(proposal(LASAGNE))
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(proposal(LASAGNE));
    renderSheet();
    await screen.findByRole("heading", { name: "Lasagne al pesto" });

    fireEvent.click(screen.getByRole("button", { name: "Un'altra" }));

    expect(requestMock).toHaveBeenLastCalledWith(
      { request: "lasagne", mealType: null, excludeTitles: ["Lasagne al pesto"] },
      expect.any(AbortSignal)
    );
    expect(screen.queryByRole("heading", { name: "Lasagne al pesto" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cerco una ricetta…");

    await act(async () => second.resolve(proposal(ALTRA)));
    expect(await screen.findByRole("heading", { name: "Lasagne bianche ai funghi" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Un'altra" }));

    expect(requestMock).toHaveBeenLastCalledWith(
      {
        request: "lasagne",
        mealType: null,
        excludeTitles: ["Lasagne al pesto", "Lasagne bianche ai funghi"],
      },
      expect.any(AbortSignal)
    );
  });

  it("shows the duplicate notice and hides the primary action", async () => {
    requestMock.mockResolvedValue(
      proposal(LASAGNE, { id: DUPLICATE_ID, title: "Lasagne al Pesto" })
    );
    renderSheet();

    expect(await screen.findByRole("heading", { name: "Lasagne al pesto" })).toBeInTheDocument();
    expect(screen.getByText("Questa ce l'hai già: «Lasagne al Pesto»")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aggiungi alla libreria" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Un'altra" })).toBeInTheDocument();
  });
});

describe("RecipeProposalSheet errors", () => {
  it("shows the API message as an alert and retries with the same titles", async () => {
    requestMock
      .mockResolvedValueOnce(proposal(LASAGNE))
      .mockRejectedValueOnce(new ApiRequestError(422, "proposal_unsuitable", UNSUITABLE_MESSAGE))
      .mockResolvedValueOnce(proposal(ALTRA));
    renderSheet();
    await screen.findByRole("heading", { name: "Lasagne al pesto" });

    fireEvent.click(screen.getByRole("button", { name: "Un'altra" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(UNSUITABLE_MESSAGE);
    expect(screen.getByRole("heading", { name: "«lasagne»" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));

    expect(requestMock).toHaveBeenLastCalledWith(
      { request: "lasagne", mealType: null, excludeTitles: ["Lasagne al pesto"] },
      expect.any(AbortSignal)
    );
    expect(await screen.findByRole("heading", { name: "Lasagne bianche ai funghi" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("RecipeProposalSheet closing and reopening", () => {
  it("aborts the pending request when closed and ignores its late response", async () => {
    const pending = deferred<RecipeProposal>();
    requestMock.mockReturnValue(pending.promise);
    const { rerenderWith } = renderSheet();
    const signal = requestMock.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);

    rerenderWith({ request: null });
    expect(signal?.aborted).toBe(true);

    await act(async () => pending.resolve(proposal(LASAGNE)));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Lasagne al pesto")).not.toBeInTheDocument();
  });

  it("starts from the waiting state when reopened, without the previous proposal", async () => {
    requestMock
      .mockResolvedValueOnce(proposal(LASAGNE))
      .mockReturnValueOnce(new Promise<RecipeProposal>(() => {}));
    const { rerenderWith } = renderSheet();
    await screen.findByRole("heading", { name: "Lasagne al pesto" });

    rerenderWith({ request: null });
    rerenderWith({ request: "risotto" });

    expect(screen.queryByRole("heading", { name: "Lasagne al pesto" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "«risotto»" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cerco una ricetta…");
  });

  it("restarts the title sequence when the request text changes", async () => {
    requestMock.mockResolvedValue(proposal(LASAGNE));
    const { rerenderWith } = renderSheet();
    await screen.findByRole("heading", { name: "Lasagne al pesto" });

    rerenderWith({ request: "risotto" });

    expect(requestMock).toHaveBeenLastCalledWith(
      { request: "risotto", mealType: null, excludeTitles: [] },
      expect.any(AbortSignal)
    );
  });
});

describe("RecipeProposalSheet primary action", () => {
  it("calls onAccept with the proposed recipe and disables both actions while it is pending", async () => {
    requestMock.mockResolvedValue(proposal(LASAGNE));
    const pending = deferred<void>();
    const onAccept = vi.fn(() => pending.promise);
    renderSheet({ onAccept });
    await screen.findByRole("heading", { name: "Lasagne al pesto" });

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi alla libreria" }));

    expect(onAccept).toHaveBeenCalledWith(LASAGNE);
    expect(screen.getByRole("button", { name: "Aggiungi alla libreria" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Un'altra" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi alla libreria" }));
    expect(onAccept).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Aggiungi alla libreria" })).toBeEnabled()
    );
    expect(screen.getByRole("button", { name: "Un'altra" })).toBeEnabled();
  });

  it("ignores close while onAccept is pending and closes again once it settles", async () => {
    requestMock.mockResolvedValue(proposal(LASAGNE));
    const pending = deferred<void>();
    const onAccept = vi.fn(() => pending.promise);
    const { onClose } = renderSheet({ onAccept });
    await screen.findByRole("heading", { name: "Lasagne al pesto" });

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi alla libreria" }));
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("sheet-backdrop"));

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => pending.reject(new Error("salvataggio fallito")));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Aggiungi alla libreria" })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-enables the actions and keeps the proposal when onAccept rejects", async () => {
    requestMock.mockResolvedValue(proposal(LASAGNE));
    const onAccept = vi.fn().mockRejectedValue(new Error("salvataggio fallito"));
    renderSheet({ onAccept, acceptLabel: "Metti nel piano" });
    await screen.findByRole("heading", { name: "Lasagne al pesto" });

    fireEvent.click(screen.getByRole("button", { name: "Metti nel piano" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Metti nel piano" })).toBeEnabled()
    );
    expect(screen.getByRole("heading", { name: "Lasagne al pesto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Un'altra" })).toBeEnabled();
  });
});

describe("RecipeProposalSheet waiting message", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rotates from the first waiting message to the generation messages", () => {
    requestMock.mockReturnValue(new Promise<RecipeProposal>(() => {}));
    renderSheet();

    expect(screen.getByRole("status")).toHaveTextContent("Cerco una ricetta…");
    act(() => {
      vi.advanceTimersByTime(GENERATION_MESSAGE_INTERVAL_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent(GENERATION_MESSAGES[0]);
  });
});
