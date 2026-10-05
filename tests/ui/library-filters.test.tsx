import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryFilters } from "@/components/library/library-filters";
import { EMPTY_LIBRARY_FILTER, type LibraryFilter } from "@/lib/domain/types";

function renderFilters(filter: LibraryFilter = EMPTY_LIBRARY_FILTER, query = "") {
  const onQueryChange = vi.fn();
  const onFilterChange = vi.fn();
  const utils = render(
    <LibraryFilters
      query={query}
      onQueryChange={onQueryChange}
      filter={filter}
      onFilterChange={onFilterChange}
    />
  );
  return { ...utils, onQueryChange, onFilterChange };
}

function StatefulFilters() {
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_LIBRARY_FILTER);
  return <LibraryFilters query="" onQueryChange={() => {}} filter={filter} onFilterChange={setFilter} />;
}

describe("LibraryFilters", () => {
  it("reports typed text through onQueryChange", () => {
    const { onQueryChange } = renderFilters();
    const input = screen.getByRole("searchbox", { name: "Cerca nella libreria" });
    expect(input).toHaveAttribute("placeholder", "Cerca ricetta o ingrediente…");
    fireEvent.change(input, { target: { value: "pesto" } });
    expect(onQueryChange).toHaveBeenCalledWith("pesto");
  });

  it("toggles the favorites criterion", () => {
    const { onFilterChange } = renderFilters();
    fireEvent.click(screen.getByRole("checkbox", { name: "Preferite" }));
    expect(onFilterChange).toHaveBeenCalledWith({ ...EMPTY_LIBRARY_FILTER, favorites: true });
  });

  it("adds and removes meals without reordering the others", () => {
    const { onFilterChange, rerender, onQueryChange } = renderFilters();
    fireEvent.click(screen.getByRole("checkbox", { name: "Cena" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...EMPTY_LIBRARY_FILTER, meals: ["cena"] });

    rerender(
      <LibraryFilters
        query=""
        onQueryChange={onQueryChange}
        filter={{ ...EMPTY_LIBRARY_FILTER, meals: ["cena"] }}
        onFilterChange={onFilterChange}
      />
    );
    expect(screen.getByRole("checkbox", { name: "Cena" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Pranzo" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({
      ...EMPTY_LIBRARY_FILTER,
      meals: ["cena", "pranzo"],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Cena" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...EMPTY_LIBRARY_FILTER, meals: [] });
  });

  it("starts with the panel closed and opens it from the Filtri button", () => {
    renderFilters();
    const toggle = screen.getByRole("button", { name: "Filtri" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "library-filter-panel");
    expect(document.getElementById("library-filter-panel")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("library-filter-panel")).not.toBeNull();
    expect(screen.getByText("Tipo di pasti")).toBeInTheDocument();
    expect(screen.getByText("Dieta")).toBeInTheDocument();
    expect(screen.getByText("Altro")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Bloccate" })).toBeInTheDocument();
  });

  it("updates tags, diets and blocked from the panel chips", () => {
    const { onFilterChange } = renderFilters();
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Veloce" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...EMPTY_LIBRARY_FILTER, tags: ["veloce"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Vegetariano" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({
      ...EMPTY_LIBRARY_FILTER,
      diets: ["vegetariano"],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Bloccate" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...EMPTY_LIBRARY_FILTER, blocked: true });
  });

  it("shows the active count in the Filtri label (one tag and one diet give 2)", () => {
    render(<StatefulFilters />);
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Veloce" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Vegetariano" }));
    expect(screen.getByRole("button", { name: "Filtri · 2" })).toBeInTheDocument();
  });
});
