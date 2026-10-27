import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("shows the Portata group first, with the four courses", () => {
    renderFilters();
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));

    const title = screen.getByText("Portata");
    const group = title.parentElement as HTMLElement;
    expect(title.compareDocumentPosition(screen.getByText("Tipo di pasti"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(within(group).getAllByRole("checkbox").map((chip) => chip.textContent)).toEqual([
      "Piatto unico",
      "Primo",
      "Secondo",
      "Contorno",
    ]);
  });

  it("toggles a course through onFilterChange, keeping the other filters", () => {
    const { onFilterChange, rerender, onQueryChange } = renderFilters({
      ...EMPTY_LIBRARY_FILTER,
      courses: ["primo"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Filtri · 1" }));
    const group = screen.getByText("Portata").parentElement as HTMLElement;

    fireEvent.click(within(group).getByRole("checkbox", { name: "Contorno" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({
      ...EMPTY_LIBRARY_FILTER,
      courses: ["primo", "contorno"],
    });

    fireEvent.click(within(group).getByRole("checkbox", { name: "Primo" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...EMPTY_LIBRARY_FILTER, courses: [] });

    rerender(
      <LibraryFilters
        query=""
        onQueryChange={onQueryChange}
        filter={{ ...EMPTY_LIBRARY_FILTER, courses: ["primo"] }}
        onFilterChange={onFilterChange}
      />
    );
    expect(within(group).getByRole("checkbox", { name: "Primo" })).toHaveAttribute("aria-checked", "true");
  });

  it("counts the selected courses in the Filtri label", () => {
    render(<StatefulFilters />);
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    const group = screen.getByText("Portata").parentElement as HTMLElement;
    fireEvent.click(within(group).getByRole("checkbox", { name: "Contorno" }));
    expect(screen.getByRole("button", { name: "Filtri · 1" })).toBeInTheDocument();
  });

  it("shows the active count in the Filtri label (one tag and one diet give 2)", () => {
    render(<StatefulFilters />);
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Veloce" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Vegetariano" }));
    expect(screen.getByRole("button", { name: "Filtri · 2" })).toBeInTheDocument();
  });

  it("labels each chip group by its title: Piatto unico is a course, not a style chip", () => {
    renderFilters();
    fireEvent.click(screen.getByRole("button", { name: "Filtri" }));

    const courses = screen.getByRole("group", { name: "Portata" });
    expect(within(courses).getByRole("checkbox", { name: "Piatto unico" })).toBeInTheDocument();
    expect(within(courses).queryByRole("checkbox", { name: "Veloce" })).toBeNull();

    const tags = screen.getByRole("group", { name: "Tipo di pasti" });
    expect(within(tags).queryByRole("checkbox", { name: "Piatto unico" })).toBeNull();
    expect(within(tags).getByRole("checkbox", { name: "Veloce" })).toBeInTheDocument();
  });
});
