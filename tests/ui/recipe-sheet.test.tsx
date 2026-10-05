import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RecipeSheet,
  type RecipeDetail,
  type RecipeSheetProps,
} from "@/components/sheets/recipe-sheet";

function makeRecipe(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: "r-1",
    title: "Pasta al pomodoro",
    prepTimeMinutes: 20,
    servings: 2,
    ingredients: [
      { id: "ing-1", name: "Basilico", amount: 10, unit: "g", preference: null },
    ],
    steps: ["Cuoci"],
    ...overrides,
  };
}

function renderSheet(props: Partial<RecipeSheetProps> = {}) {
  const base: RecipeSheetProps = {
    recipe: makeRecipe(),
    isOpen: true,
    onClose: vi.fn(),
    onRate: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToggleBlock: vi.fn(),
    onIngredientPreference: vi.fn(),
  };
  const merged = { ...base, ...props };
  const utils = render(<RecipeSheet {...merged} />);
  return {
    ...utils,
    rerenderWith: (next: Partial<RecipeSheetProps>) =>
      utils.rerender(<RecipeSheet {...merged} {...next} />),
  };
}

function openDislikeConfirmation(name = "Basilico") {
  fireEvent.click(screen.getByRole("button", { name: `Scarta ${name}` }));
}

describe("RecipeSheet loading", () => {
  it("shows the skeleton when recipe is null and isLoading", () => {
    renderSheet({ recipe: null, isLoading: true });
    expect(screen.getByText("Apro la ricetta…")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Caricamento della ricetta" })).toBeInTheDocument();
  });

  it("renders nothing when recipe is null and not loading", () => {
    renderSheet({ recipe: null });
    expect(screen.queryByText("Apro la ricetta…")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("RecipeSheet dislike confirmation text", () => {
  it("keeps the generic text when recipesCount is unknown", () => {
    renderSheet();
    openDislikeConfirmation();
    expect(
      screen.getByText("Escluderà le ricette contenenti questo ingrediente dai prossimi piani.")
    ).toBeInTheDocument();
  });

  it("explains that no recipe contains the ingredient when the count is 0", () => {
    renderSheet({
      recipe: makeRecipe({
        ingredients: [{ id: "ing-1", name: "Basilico", amount: 1, unit: "g", recipesCount: 0 }],
      }),
    });
    openDislikeConfirmation();
    expect(
      screen.getByText("Nessuna ricetta in libreria lo contiene: non lo userò in quelle nuove.")
    ).toBeInTheDocument();
  });

  it("uses the singular for 1 recipe", () => {
    renderSheet({
      recipe: makeRecipe({
        ingredients: [{ id: "ing-1", name: "Basilico", amount: 1, unit: "g", recipesCount: 1 }],
      }),
    });
    openDislikeConfirmation();
    expect(screen.getByText("Escluderà 1 ricetta dai prossimi piani.")).toBeInTheDocument();
  });

  it("uses the plural for several recipes", () => {
    renderSheet({
      recipe: makeRecipe({
        ingredients: [{ id: "ing-1", name: "Basilico", amount: 1, unit: "g", recipesCount: 8 }],
      }),
    });
    openDislikeConfirmation();
    expect(screen.getByText("Escluderà 8 ricette dai prossimi piani.")).toBeInTheDocument();
  });

  it("titles the confirmation with the canonical name when available", () => {
    renderSheet({
      recipe: makeRecipe({
        ingredients: [
          {
            id: "ing-1",
            name: "Cipolla rossa di Tropea",
            canonicalName: "cipolla rossa",
            amount: 1,
            unit: "pz",
          },
        ],
      }),
    });
    openDislikeConfirmation("Cipolla rossa di Tropea");
    expect(screen.getByText("Scartare cipolla rossa?")).toBeInTheDocument();
  });

  it("titles the confirmation with the display name without a canonical name", () => {
    renderSheet();
    openDislikeConfirmation();
    expect(screen.getByText("Scartare Basilico?")).toBeInTheDocument();
  });
});

describe("RecipeSheet servings sync", () => {
  it("keeps the chosen servings when the recipe object changes but id and servings do not", () => {
    const { rerenderWith } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Aumenta porzioni" }));
    expect(screen.getByTestId("recipe-servings")).toHaveTextContent("3");

    rerenderWith({ recipe: makeRecipe({ rating: 4 }) });
    expect(screen.getByTestId("recipe-servings")).toHaveTextContent("3");
  });

  it("resets the servings when the recipe id changes", () => {
    const { rerenderWith } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Aumenta porzioni" }));
    expect(screen.getByTestId("recipe-servings")).toHaveTextContent("3");

    rerenderWith({ recipe: makeRecipe({ id: "r-2", servings: 2 }) });
    expect(screen.getByTestId("recipe-servings")).toHaveTextContent("2");
  });
});

describe("RecipeSheet disabled states", () => {
  it("disables stars, favorite and block with actionsDisabled", () => {
    renderSheet({ actionsDisabled: true });
    for (let star = 1; star <= 5; star++) {
      expect(screen.getByRole("button", { name: `Vota ${star} stelle` })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Preferita" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Non proporre più" })).toBeDisabled();
  });

  it("enables the action bar by default", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Vota 1 stelle" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Preferita" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Non proporre più" })).toBeEnabled();
  });

  it("disables Preferita when the recipe is blocked", () => {
    renderSheet({ recipe: makeRecipe({ isBlocked: true }) });
    expect(screen.getByRole("button", { name: "Preferita" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sblocca ricetta" })).toBeEnabled();
  });

  it("disables the thumbs with ingredientsDisabled", () => {
    renderSheet({ ingredientsDisabled: true });
    expect(screen.getByRole("button", { name: "Preferisci Basilico" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scarta Basilico" })).toBeDisabled();
  });

  it("disables the confirm button with ingredientsDisabled", () => {
    const { rerenderWith } = renderSheet();
    openDislikeConfirmation();
    rerenderWith({ ingredientsDisabled: true });
    expect(screen.getByRole("button", { name: "Conferma esclusione" })).toBeDisabled();
  });
});

describe("RecipeSheet rating state", () => {
  it("marks only the current rating star as pressed", () => {
    renderSheet({ recipe: makeRecipe({ rating: 4 }) });
    expect(screen.getByRole("button", { name: "Vota 4 stelle" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Vota 3 stelle" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("exposes the favorite state through aria-pressed", () => {
    renderSheet({ recipe: makeRecipe({ isFavorite: true }) });
    expect(screen.getByRole("button", { name: "Preferita" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
