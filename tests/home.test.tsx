import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "@/app/(app)/page";

describe("Home page", () => {
  it("renders Mealy branding heading and subtitle", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "Mealy" })).toBeInTheDocument();
    expect(screen.getByText("Cosa mangio oggi?")).toBeInTheDocument();
  });

  it("renders Piano Settimanale section", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 2, name: "Piano Settimanale" })).toBeInTheDocument();
  });

  it("renders initial meal cards", () => {
    render(<Home />);
    expect(screen.getByText("Pasta al pesto genovese")).toBeInTheDocument();
    expect(screen.getByText("Genera piano")).toBeInTheDocument();
  });
});
