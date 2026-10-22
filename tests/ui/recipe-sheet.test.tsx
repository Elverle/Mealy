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

describe("RecipeSheet dislike confirmation accessibility", () => {
  it("exposes the confirmation as an alertdialog named by its title and described by the impact", () => {
    renderSheet();
    openDislikeConfirmation();
    const box = screen.getByRole("alertdialog", { name: "Scartare Basilico?" });
    expect(box).toHaveAccessibleDescription(
      "Escluderà le ricette contenenti questo ingrediente dai prossimi piani."
    );
  });

  it("moves focus to Annulla when the confirmation opens", () => {
    renderSheet();
    openDislikeConfirmation();
    expect(screen.getByRole("button", { name: "Annulla" })).toHaveFocus();
  });

  it("returns focus to the discard button when the confirmation is cancelled", () => {
    renderSheet();
    openDislikeConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scarta Basilico" })).toHaveFocus();
  });
});

describe("RecipeSheet course badge", () => {
  it("shows the course right after the time badge and before the style tags", () => {
    renderSheet({ recipe: makeRecipe({ course: "Primo", tags: ["Veloce"] }) });
    const time = screen.getByText("20 min");
    const course = screen.getByText("Primo");
    const tag = screen.getByText("Veloce");
    expect(time.compareDocumentPosition(course) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(course.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no course badge without a course", () => {
    renderSheet({ recipe: makeRecipe({ tags: ["Veloce"] }) });
    expect(screen.queryByText(/Primo|Secondo|Contorno|Piatto unico/)).toBeNull();
    expect(screen.getByText("Veloce")).toBeInTheDocument();
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

describe("RecipeSheet placeholder, notice and footer", () => {
  it("shows the placeholder title and content instead of the skeleton while loading", () => {
    renderSheet({
      recipe: null,
      isLoading: true,
      placeholder: { title: "«lasagne»", content: <p>Cerco una ricetta…</p> },
    });
    expect(screen.getByText("«lasagne»")).toBeInTheDocument();
    expect(screen.getByText("Cerco una ricetta…")).toBeInTheDocument();
    expect(screen.queryByText("Apro la ricetta…")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Caricamento della ricetta" })).not.toBeInTheDocument();
  });

  it("shows the placeholder even without isLoading", () => {
    renderSheet({
      recipe: null,
      placeholder: { title: "«lasagne»", content: <p>Nessuna ricetta trovata</p> },
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Nessuna ricetta trovata")).toBeInTheDocument();
  });

  it("renders the notice and the footer below the header and at the end of the sheet", () => {
    renderSheet({
      notice: <p>Questa ce l'hai già: «Pasta al pomodoro»</p>,
      footer: <button type="button">Metti nel piano</button>,
    });
    expect(screen.getByText("Questa ce l'hai già: «Pasta al pomodoro»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metti nel piano" })).toBeInTheDocument();
  });

  it("renders no footer area when footer is not passed", () => {
    renderSheet();
    expect(document.querySelector("[data-sheet-footer]")).toBeNull();
  });

  it("anchors the footer outside the scrolling body, after it", () => {
    renderSheet({ footer: <button type="button">Metti nel piano</button> });
    const button = screen.getByRole("button", { name: "Metti nel piano" });
    const footer = button.closest("[data-sheet-footer]");
    const body = document.querySelector("[data-sheet-body]");
    expect(footer).not.toBeNull();
    expect(body?.contains(button)).toBe(false);
    expect(body?.nextElementSibling).toBe(footer);
  });

  it("keeps the title and the subtitle in the fixed header, outside the scrolling body", () => {
    renderSheet({ subtitle: "Hai chiesto «pasta»" });
    const title = screen.getByRole("heading", { level: 2, name: "Pasta al pomodoro" });
    const subtitle = screen.getByText("Hai chiesto «pasta»");
    const body = document.querySelector("[data-sheet-body]");
    expect(body?.contains(title)).toBe(false);
    expect(body?.contains(subtitle)).toBe(false);
  });

  it("keeps the same panel height while waiting and with the recipe", () => {
    const { rerenderWith } = renderSheet({
      recipe: null,
      placeholder: { title: "«pasta»", content: <p>Cerco una ricetta…</p> },
    });
    const waiting = screen.getByRole("dialog");
    expect(waiting).toHaveClass("h-[92dvh]");

    rerenderWith({ recipe: makeRecipe(), placeholder: undefined });
    expect(screen.getByRole("dialog")).toBe(waiting);
    expect(waiting).toHaveClass("h-[92dvh]");
  });
});

describe("RecipeSheet structure and copy", () => {
  it("names the dialog after the recipe title", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "Pasta al pomodoro" })).toBeInTheDocument();
  });

  it("uses section headings one level below the title", () => {
    renderSheet();
    expect(screen.getByRole("heading", { level: 3, name: "Ingredienti" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Preparazione" })).toBeInTheDocument();
  });

  it("shows a unit without an amount without a stray space", () => {
    renderSheet({
      recipe: makeRecipe({
        ingredients: [{ id: "ing-1", name: "Sale", amount: 0, unit: "qb" }],
      }),
    });
    expect(screen.getByText("(qb)")).toBeInTheDocument();
  });

  it("keeps the footer visible with a recipe and no action handlers", () => {
    renderSheet({
      onRate: undefined,
      onToggleFavorite: undefined,
      onToggleBlock: undefined,
      onIngredientPreference: undefined,
      footer: <button type="button">Metti nel piano</button>,
    });
    expect(screen.queryByRole("button", { name: "Vota 1 stelle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Non proporre più" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scarta Basilico" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metti nel piano" })).toBeInTheDocument();
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
