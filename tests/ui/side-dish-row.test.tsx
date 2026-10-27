import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SideDishRow, type SideDishRowProps } from "@/components/plan/side-dish-row";

const TITLE = "Insalata di finocchi";

function renderRow(props: Partial<SideDishRowProps> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onSwap: vi.fn(),
    onPick: vi.fn(),
    onRemove: vi.fn(),
  };
  const utils = render(<SideDishRow title={TITLE} {...handlers} {...props} />);
  return { ...utils, ...handlers };
}

describe("SideDishRow", () => {
  it("shows the Contorno eyebrow and the title", () => {
    renderRow();

    expect(screen.getByText("Contorno")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TITLE })).toBeInTheDocument();
  });

  it("labels the three actions with the side dish title", () => {
    renderRow();

    expect(screen.getByRole("button", { name: `Cambia contorno: ${TITLE}` })).toHaveAttribute(
      "data-side-action",
      "swap"
    );
    expect(screen.getByRole("button", { name: `Scegli contorno: ${TITLE}` })).toHaveAttribute(
      "data-side-action",
      "pick"
    );
    expect(screen.getByRole("button", { name: `Togli contorno: ${TITLE}` })).toHaveAttribute(
      "data-side-action",
      "remove"
    );
  });

  it("renders no button without the callbacks: a read-only row", () => {
    renderRow({ onOpen: undefined, onSwap: undefined, onPick: undefined, onRemove: undefined });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it("renders the title as plain text when there is no onOpen", () => {
    renderRow({ onOpen: undefined });

    expect(screen.queryByRole("button", { name: TITLE })).toBeNull();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it("renders only the actions that have a callback", () => {
    renderRow({ onPick: undefined, onRemove: undefined });

    expect(screen.getByRole("button", { name: `Cambia contorno: ${TITLE}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Scegli contorno: ${TITLE}` })).toBeNull();
    expect(screen.queryByRole("button", { name: `Togli contorno: ${TITLE}` })).toBeNull();
  });

  it("disables the three actions while the card is busy elsewhere", () => {
    renderRow({ disabled: true });

    expect(screen.getByRole("button", { name: `Cambia contorno: ${TITLE}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Scegli contorno: ${TITLE}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Togli contorno: ${TITLE}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: TITLE })).toBeEnabled();
  });

  it("replaces the title and the actions with the pending message", () => {
    renderRow({ pendingMessage: "Cerco un contorno…" });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Cerco un contorno…");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("shows the title again when the pending message goes away", () => {
    const { rerender } = renderRow({ pendingMessage: "Tolgo il contorno…" });
    expect(screen.getByRole("status")).toHaveTextContent("Tolgo il contorno…");

    rerender(
      <SideDishRow title={TITLE} onOpen={vi.fn()} onSwap={vi.fn()} pendingMessage={null} />
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Cambia contorno: ${TITLE}` })).toBeInTheDocument();
  });

  it("calls onOpen when the title is tapped", () => {
    const { onOpen, onSwap } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: TITLE }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("calls the matching callback for each action", () => {
    const { onSwap, onPick, onRemove } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: `Cambia contorno: ${TITLE}` }));
    fireEvent.click(screen.getByRole("button", { name: `Scegli contorno: ${TITLE}` }));
    fireEvent.click(screen.getByRole("button", { name: `Togli contorno: ${TITLE}` }));

    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does not let an action click reach the parent (the card body selects the recipe)", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <SideDishRow title={TITLE} onSwap={vi.fn()} onPick={vi.fn()} onRemove={vi.fn()} />
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: `Cambia contorno: ${TITLE}` }));
    fireEvent.click(screen.getByRole("button", { name: `Scegli contorno: ${TITLE}` }));
    fireEvent.click(screen.getByRole("button", { name: `Togli contorno: ${TITLE}` }));

    expect(parentClick).not.toHaveBeenCalled();
  });

  it("gives every control the 44 px tap target and truncates a long title", () => {
    renderRow();

    const title = screen.getByRole("button", { name: TITLE });
    expect(title).toHaveClass("min-h-[44px]", "truncate", "min-w-0");
    for (const label of [
      `Cambia contorno: ${TITLE}`,
      `Scegli contorno: ${TITLE}`,
      `Togli contorno: ${TITLE}`,
    ]) {
      expect(screen.getByRole("button", { name: label })).toHaveClass("h-11", "w-11");
    }
  });

  it("keeps the title and the actions in the same row", () => {
    renderRow();

    const title = screen.getByRole("button", { name: TITLE });
    const row = title.parentElement as HTMLElement;
    expect(row).toHaveClass("flex", "items-center");
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.getAttribute("data-side-action") ?? "title")
    ).toEqual(["title", "swap", "pick", "remove"]);
  });
});
