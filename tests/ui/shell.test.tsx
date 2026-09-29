import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as React from "react";

// Components
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { MealCard } from "@/components/cards/meal-card";
import { RecipeSheet } from "@/components/sheets/recipe-sheet";
import { ShoppingItemRow } from "@/components/shopping/shopping-item-row";
import { ChipFilter } from "@/components/filters/chip-filter";
import { EmptyState } from "@/components/feedback/empty-state";

// Pages
import { PlanScreen } from "@/components/plan/plan-screen";
import ShoppingListPage from "@/app/(app)/lista/page";
import LibraryPage from "@/app/(app)/libreria/page";
import { SettingsEditor } from "@/components/settings/settings-editor";
import { DEFAULT_HOUSEHOLD, type PlanScreenView, type SettingsView } from "@/lib/domain/types";
import { fixtureRecipesAsDomain } from "@/fixtures";

// Mock next/navigation for BottomNav
const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const PLAN_FIXTURE_RECIPES = fixtureRecipesAsDomain().slice(0, 2);
const PLAN_SCREEN_FIXTURE: PlanScreenView = {
  today: "2026-09-30",
  current_week_start: "2026-09-28",
  target: { week_start: "2026-09-28", first_day: "2026-09-30", last_day: "2026-10-04" },
  view: {
    week: { week_start: "2026-09-28", first_day: "2026-09-30", last_day: "2026-10-04" },
    plan: {
      id: "11111111-1111-4111-8111-111111111111",
      week_start: "2026-09-28",
      status: "draft",
      created_at: "2026-09-29T10:00:00.000Z",
      generated_at: "2026-09-29T10:00:00.000Z",
      superseded: false,
      slots: PLAN_FIXTURE_RECIPES.map((recipe, index) => ({
        id: `22222222-2222-4222-8222-22222222222${index}`,
        day: "2026-09-30",
        meal: index === 0 ? ("pranzo" as const) : ("cena" as const),
        servings: 2,
        locked: false,
        recipe,
      })),
      shopping_list: { exists: false, needs_regeneration: false },
    },
    action: "regenerate",
    editable: true,
    can_repeat: false,
  },
  prev_week_start: null,
  next_week_start: null,
  target_plan_status: "draft",
  current_plan_id: null,
};

const SETTINGS_FIXTURE: SettingsView = {
  persons: DEFAULT_HOUSEHOLD.persons,
  meals: DEFAULT_HOUSEHOLD.meals,
  meal_style_tags: DEFAULT_HOUSEHOLD.meal_style_tags,
  diet_tags: DEFAULT_HOUSEHOLD.diet_tags,
  appliances: DEFAULT_HOUSEHOLD.appliances,
  onboarded: true,
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("WP3 UI Primitives", () => {
  describe("Button", () => {
    it("renders default variant with basil background and min 44px height", () => {
      render(<Button>Azione Basil</Button>);
      const btn = screen.getByRole("button", { name: "Azione Basil" });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveClass("bg-basil");
      expect(btn).toHaveClass("min-h-[44px]");
    });

    it("renders destructive variant with tomato background", () => {
      render(<Button variant="destructive">Elimina</Button>);
      const btn = screen.getByRole("button", { name: "Elimina" });
      expect(btn).toHaveClass("bg-tomato");
    });
  });

  describe("Badge", () => {
    it("renders default and custom variants", () => {
      const { rerender } = render(<Badge>Default</Badge>);
      expect(screen.getByText("Default")).toHaveClass("bg-basil");

      rerender(<Badge variant="saffron">Preferita</Badge>);
      expect(screen.getByText("Preferita")).toHaveClass("bg-saffron");

      rerender(<Badge variant="tomato-subtle">Attenzione</Badge>);
      expect(screen.getByText("Attenzione")).toHaveClass("text-tomato");
    });
  });

  describe("Card", () => {
    it("renders container with 12px radius (rounded-xl) and stone/20 border", () => {
      render(
        <Card data-testid="test-card">
          <CardHeader>
            <CardTitle>Titolo Card</CardTitle>
          </CardHeader>
          <CardContent>Contenuto</CardContent>
        </Card>
      );
      const card = screen.getByTestId("test-card");
      expect(card).toHaveClass("rounded-xl");
      expect(card).toHaveClass("border-stone/20");
      expect(card).toHaveClass("bg-white");
    });
  });

  describe("Checkbox", () => {
    it("renders accessible checkbox with 44px tap target and toggles state", () => {
      const onCheckedChange = vi.fn();
      render(
        <Checkbox
          aria-label="Accetta termini"
          onCheckedChange={onCheckedChange}
        />
      );
      const checkbox = screen.getByRole("checkbox", {
        name: "Accetta termini",
      });
      expect(checkbox).toHaveClass("min-h-[44px]");
      expect(checkbox).toHaveAttribute("aria-checked", "false");

      fireEvent.click(checkbox);
      expect(onCheckedChange).toHaveBeenCalledWith(true);
      expect(checkbox).toHaveAttribute("aria-checked", "true");
    });
  });
});

describe("BottomNav Navigation Shell", () => {
  it("renders 4 navigation tabs with correct links and tap targets ≥ 44px", () => {
    mockPathname.mockReturnValue("/");
    render(<BottomNav />);

    const nav = screen.getByRole("navigation", {
      name: "Navigazione principale",
    });
    expect(nav).toBeInTheDocument();

    const pianoLink = screen.getByRole("link", { name: /Piano/i });
    const listaLink = screen.getByRole("link", { name: /Lista/i });
    const libreriaLink = screen.getByRole("link", { name: /Libreria/i });
    const impostazioniLink = screen.getByRole("link", { name: /Impostazioni/i });

    expect(pianoLink).toHaveAttribute("href", "/");
    expect(listaLink).toHaveAttribute("href", "/lista");
    expect(libreriaLink).toHaveAttribute("href", "/libreria");
    expect(impostazioniLink).toHaveAttribute("href", "/impostazioni");

    // Tap target ≥ 44px
    expect(pianoLink).toHaveClass("min-h-[48px]");
    expect(pianoLink).toHaveClass("min-w-[48px]");

    // Active tab is basil on root path
    expect(pianoLink).toHaveClass("text-basil");
    expect(pianoLink).toHaveAttribute("aria-current", "page");

    // Inactive tabs are stone
    expect(listaLink).toHaveClass("text-stone");
    expect(libreriaLink).toHaveClass("text-stone");
    expect(impostazioniLink).toHaveClass("text-stone");
  });

  it("highlights active tab when on /lista route", () => {
    mockPathname.mockReturnValue("/lista");
    render(<BottomNav />);

    const listaLink = screen.getByRole("link", { name: /Lista/i });
    const pianoLink = screen.getByRole("link", { name: /Piano/i });

    expect(listaLink).toHaveClass("text-basil");
    expect(listaLink).toHaveAttribute("aria-current", "page");
    expect(pianoLink).toHaveClass("text-stone");
  });
});

describe("MealCard", () => {
  const defaultMeal = {
    id: "meal-1",
    day: "Lunedì",
    mealType: "Cena",
    title: "Salmone al forno con patate",
    prepTimeMinutes: 35,
    tags: ["Secondo", "Pesce"],
    isFavorite: false,
    isLocked: false,
  };

  it("renders eyebrow, Fraunces title, tags and prep time", () => {
    render(<MealCard {...defaultMeal} />);

    expect(screen.getByText("LUNEDÌ · CENA")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Salmone al forno con patate",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("35 min")).toBeInTheDocument();
    expect(screen.getByText("Secondo")).toBeInTheDocument();
    expect(screen.getByText("Pesce")).toBeInTheDocument();
  });

  it("provides tomato swap button and saffron favorite button with ≥ 44px tap targets", () => {
    const onSwap = vi.fn();
    const onToggleFavorite = vi.fn();
    const onToggleLock = vi.fn();

    render(
      <MealCard
        {...defaultMeal}
        isFavorite={true}
        onSwap={onSwap}
        onToggleFavorite={onToggleFavorite}
        onToggleLock={onToggleLock}
      />
    );

    const swapBtn = screen.getByRole("button", {
      name: "Cambia Salmone al forno con patate",
    });
    expect(swapBtn).toHaveClass("text-tomato");
    expect(swapBtn).toHaveClass("min-h-[44px]");

    fireEvent.click(swapBtn);
    expect(onSwap).toHaveBeenCalledWith("meal-1");

    const favBtn = screen.getByRole("button", {
      name: "Rimuovi dai preferiti",
    });
    expect(favBtn).toHaveClass("text-saffron");
    expect(favBtn).toHaveClass("h-11");
    expect(favBtn).toHaveClass("w-11");

    fireEvent.click(favBtn);
    expect(onToggleFavorite).toHaveBeenCalledWith("meal-1");

    const lockBtn = screen.getByRole("button", { name: "Blocca pasto" });
    fireEvent.click(lockBtn);
    expect(onToggleLock).toHaveBeenCalledWith("meal-1");
  });
});

describe("RecipeSheet", () => {
  const recipeMock = {
    id: "rec-1",
    title: "Pasta al pesto genovese",
    description: "Classico piatto ligure",
    prepTimeMinutes: 20,
    servings: 2,
    tags: ["Primo", "Vegetariano"],
    ingredients: [
      { id: "ing-1", name: "Trofie", amount: 200, unit: "g" },
      { id: "ing-2", name: "Basilico", amount: 50, unit: "g" },
    ],
    steps: ["Lava il basilico", "Pesta con i pinoli", "Cuoci la pasta"],
    rating: 4,
    isFavorite: false,
  };

  it("renders recipe details, ingredients, and scales portions", () => {
    render(<RecipeSheet recipe={recipeMock} isOpen={true} onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Pasta al pesto genovese" })
    ).toBeInTheDocument();
    expect(screen.getByText("Trofie")).toBeInTheDocument();
    expect(screen.getByTestId("recipe-servings")).toHaveTextContent("2"); // Base servings

    // Increase portions
    const plusBtn = screen.getByRole("button", { name: "Aumenta porzioni" });
    fireEvent.click(plusBtn);

    // Servings become 3 -> amount scales to 300g
    expect(screen.getByTestId("recipe-servings")).toHaveTextContent("3");
    expect(screen.getByText("(300 g)")).toBeInTheDocument();
  });

  it("shows confirmation banner when disliking an ingredient", () => {
    const onPref = vi.fn();
    render(
      <RecipeSheet
        recipe={recipeMock}
        isOpen={true}
        onClose={vi.fn()}
        onIngredientPreference={onPref}
      />
    );

    const dislikeBtn = screen.getByRole("button", { name: "Scarta Basilico" });
    fireEvent.click(dislikeBtn);

    expect(screen.getByText("Scartare Basilico?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Escluderà le ricette contenenti questo ingrediente dai prossimi piani."
      )
    ).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", {
      name: "Conferma esclusione",
    });
    fireEvent.click(confirmBtn);
    expect(onPref).toHaveBeenCalledWith("ing-2", "disliked");
  });
});

describe("ShoppingItemRow", () => {
  it("renders shopping item and allows toggling anywhere on the row", () => {
    const onToggle = vi.fn();
    const item = {
      id: "item-1",
      name: "Parmigiano Reggiano",
      amount: 150,
      unit: "g",
      category: "Freschi",
      isChecked: false,
    };

    const { rerender } = render(
      <ShoppingItemRow item={item} onToggle={onToggle} />
    );

    const row = screen.getByRole("checkbox", {
      name: /Parmigiano Reggiano/i,
    });
    expect(row).toBeInTheDocument();
    expect(row).toHaveClass("min-h-[52px]");
    expect(row).toHaveAttribute("aria-checked", "false");

    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith("item-1");

    // When checked, text has line-through
    rerender(
      <ShoppingItemRow item={{ ...item, isChecked: true }} onToggle={onToggle} />
    );
    expect(screen.getByText("Parmigiano Reggiano")).toHaveClass("line-through");
    expect(row).toHaveAttribute("aria-checked", "true");
  });
});

describe("ChipFilter", () => {
  it("renders rounded-full pill with active and inactive styles", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <ChipFilter
        label="Vegetariano"
        count={5}
        isSelected={false}
        onClick={onClick}
      />
    );

    const chip = screen.getByRole("checkbox", { name: /Vegetariano/i });
    expect(chip).toHaveClass("rounded-full");
    expect(chip).toHaveClass("min-h-[44px]");
    expect(chip).toHaveClass("text-stone");

    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <ChipFilter
        label="Vegetariano"
        count={5}
        isSelected={true}
        onClick={onClick}
      />
    );
    expect(chip).toHaveClass("bg-basil");
    expect(chip).toHaveClass("text-paper");
  });
});

describe("EmptyState", () => {
  it("renders Fraunces title, stone description and action button", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="Libreria vuota"
        description="Ancora nessuna ricetta. Genera il primo piano e la libreria si riempie da sola."
        actionLabel="Genera piano"
        onAction={onAction}
      />
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Libreria vuota" })
    ).toHaveClass("font-display");
    expect(
      screen.getByText(/Ancora nessuna ricetta/i)
    ).toHaveClass("text-stone");

    const actionBtn = screen.getByRole("button", { name: "Genera piano" });
    fireEvent.click(actionBtn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe("Pages Integration", () => {
  it("renders Home (Piano) page with week title and meals", () => {
    render(<PlanScreen initialScreen={PLAN_SCREEN_FIXTURE} />);
    expect(screen.getByRole("heading", { level: 1, name: "Mealy" })).toBeInTheDocument();
    expect(screen.getByText("Cosa mangio oggi?")).toBeInTheDocument();
    expect(screen.getByText("Piano Settimanale")).toBeInTheDocument();
    expect(screen.getByText(PLAN_FIXTURE_RECIPES[0].title)).toBeInTheDocument();
  });

  it("renders Shopping list page with sections and progress", () => {
    render(<ShoppingListPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Lista della Spesa" })
    ).toBeInTheDocument();
    expect(screen.getByText("Ortofrutta")).toBeInTheDocument();
  });

  it("renders Library page with search and chip filters", () => {
    render(<LibraryPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Libreria Ricette" })
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Cerca ricetta o ingrediente...")
    ).toBeInTheDocument();
  });

  it("renders Settings page with sections", () => {
    render(<SettingsEditor initialSettings={SETTINGS_FIXTURE} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Impostazioni" })
    ).toBeInTheDocument();
    expect(screen.getByText("Persone nel nucleo")).toBeInTheDocument();
    expect(screen.getByText("I miei ingredienti")).toBeInTheDocument();
  });
});
