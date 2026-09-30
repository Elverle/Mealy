import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  AppliancesField,
  DietField,
  MealsField,
  MealStyleField,
  PersonsField,
  SettingsField,
  SETTINGS_FIELD_COPY,
  SETTINGS_FIELD_ORDER,
  isSettingsFieldValid,
} from "@/components/settings/settings-fields";
import type { HouseholdSettings } from "@/lib/domain/types";

const BASE_SETTINGS: HouseholdSettings = {
  persons: 2,
  meals: ["pranzo", "cena"],
  meal_style_tags: ["veloce"],
  diet_tags: [],
  appliances: ["fornelli"],
};

describe("SETTINGS_FIELD_ORDER / SETTINGS_FIELD_COPY", () => {
  it("lists the 5 fields in canonical order", () => {
    expect(SETTINGS_FIELD_ORDER).toEqual([
      "persons",
      "meals",
      "meal_style_tags",
      "diet_tags",
      "appliances",
    ]);
  });

  it("provides the exact Italian copy for each field", () => {
    expect(SETTINGS_FIELD_COPY.persons).toEqual({
      title: "Persone nel nucleo",
      description: "Serve a calcolare le porzioni e le quantità della spesa.",
    });
    expect(SETTINGS_FIELD_COPY.meals.description).toBe(
      "Quali pasti vuoi trovare nel piano settimanale?"
    );
  });
});

describe("isSettingsFieldValid", () => {
  it("returns false for meals when the array is empty", () => {
    expect(isSettingsFieldValid("meals", { ...BASE_SETTINGS, meals: [] })).toBe(false);
  });

  it("returns true for meals when at least one meal is selected", () => {
    expect(isSettingsFieldValid("meals", BASE_SETTINGS)).toBe(true);
  });

  it("returns false for persons outside [PERSONS_MIN, PERSONS_MAX]", () => {
    expect(isSettingsFieldValid("persons", { ...BASE_SETTINGS, persons: 0 })).toBe(false);
    expect(isSettingsFieldValid("persons", { ...BASE_SETTINGS, persons: 13 })).toBe(false);
  });

  it("returns true for persons within range", () => {
    expect(isSettingsFieldValid("persons", { ...BASE_SETTINGS, persons: 1 })).toBe(true);
    expect(isSettingsFieldValid("persons", { ...BASE_SETTINGS, persons: 12 })).toBe(true);
  });

  it("is always true for the other fields, even when empty", () => {
    expect(isSettingsFieldValid("meal_style_tags", { ...BASE_SETTINGS, meal_style_tags: [] })).toBe(true);
    expect(isSettingsFieldValid("diet_tags", { ...BASE_SETTINGS, diet_tags: [] })).toBe(true);
    expect(isSettingsFieldValid("appliances", { ...BASE_SETTINGS, appliances: [] })).toBe(true);
  });
});

describe("PersonsField", () => {
  it("disables the decrement button and shows 'persona' (singular) at the minimum", () => {
    render(<PersonsField value={1} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Una persona in meno" })).toBeDisabled();
    expect(screen.getByText("persona")).toBeInTheDocument();
  });

  it("disables the increment button at the maximum", () => {
    render(<PersonsField value={12} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Una persona in più" })).toBeDisabled();
    expect(screen.getByText("persone")).toBeInTheDocument();
  });

  it("calls onChange(3) when incrementing from 2", () => {
    const onChange = vi.fn();
    render(<PersonsField value={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Una persona in più" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("calls onChange(1) when decrementing from 2", () => {
    const onChange = vi.fn();
    render(<PersonsField value={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Una persona in meno" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});

describe("MealsField", () => {
  it("renders unselected chips for meals not present in value", () => {
    render(<MealsField value={["cena"]} onChange={vi.fn()} />);

    const pranzoChip = screen.getByRole("checkbox", { name: "Pranzo" });
    expect(pranzoChip).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the meal added, in canonical order", () => {
    const onChange = vi.fn();
    render(<MealsField value={["cena"]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Pranzo" }));
    expect(onChange).toHaveBeenCalledWith(["pranzo", "cena"]);
  });

  it("shows a warning when no meal is selected", () => {
    render(<MealsField value={[]} onChange={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Scegli almeno un pasto.");
  });

  it("does not show the warning when at least one meal is selected", () => {
    render(<MealsField value={["cena"]} onChange={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("AppliancesField", () => {
  it("shows the no-cooking notice when no appliance is selected", () => {
    render(<AppliancesField value={[]} onChange={vi.fn()} />);

    expect(
      screen.getByText("Senza elettrodomestici proporrò solo piatti senza cottura.")
    ).toBeInTheDocument();
  });

  it("does not show the notice when at least one appliance is selected", () => {
    render(<AppliancesField value={["forno"]} onChange={vi.fn()} />);

    expect(
      screen.queryByText("Senza elettrodomestici proporrò solo piatti senza cottura.")
    ).not.toBeInTheDocument();
  });
});

describe("MealStyleField", () => {
  it("renders a chip per enum value with the right label", () => {
    render(<MealStyleField value={["veloce"]} onChange={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: "Veloce" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("checkbox", { name: "Comfort food" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });
});

describe("DietField", () => {
  it("toggles a value off when clicked while selected", () => {
    const onChange = vi.fn();
    render(<DietField value={["vegetariano"]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegetariano" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("SettingsField", () => {
  it("updates only diet_tags when fieldKey='diet_tags'", () => {
    const onChange = vi.fn();
    render(
      <SettingsField fieldKey="diet_tags" settings={BASE_SETTINGS} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Vegano" }));

    expect(onChange).toHaveBeenCalledWith({
      ...BASE_SETTINGS,
      diet_tags: ["vegano"],
    });
  });

  it("renders the persons field with an h1 heading when headingLevel='h1'", () => {
    render(
      <SettingsField
        fieldKey="persons"
        settings={BASE_SETTINGS}
        onChange={vi.fn()}
        headingLevel="h1"
      />
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Persone nel nucleo" })
    ).toBeInTheDocument();
  });
});
