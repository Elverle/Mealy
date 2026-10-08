import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ShoppingItemRow,
  type ShoppingItem,
  type ShoppingItemRowProps,
} from "@/components/shopping/shopping-item-row";

const ITEM_ID = "item-1";
const ITEM_NAME = "Latte";

function makeItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: ITEM_ID,
    name: ITEM_NAME,
    amount: 150,
    unit: "g",
    isChecked: false,
    ...overrides,
  };
}

function renderRow(props: Partial<ShoppingItemRowProps> = {}) {
  const onToggle = vi.fn();
  const utils = render(
    <ShoppingItemRow item={makeItem()} onToggle={onToggle} {...props} />
  );
  const row = screen.getByRole("checkbox", { name: new RegExp(ITEM_NAME) });
  return { ...utils, row, onToggle };
}

describe("ShoppingItemRow without the new fields", () => {
  it("keeps the behaviour of the original row", () => {
    const { row, onToggle } = renderRow();

    expect(row).toHaveAttribute("aria-checked", "false");
    expect(row).toHaveClass("min-h-[52px]");
    expect(row).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText("150 g")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rimuovi/ })).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith(ITEM_ID);
  });
});

describe("ShoppingItemRow quantity", () => {
  it("shows quantityLabel instead of amount and unit", () => {
    renderRow({ item: makeItem({ quantityLabel: "1,25 kg" }) });

    expect(screen.getByText("1,25 kg")).toBeInTheDocument();
    expect(screen.queryByText(/150/)).not.toBeInTheDocument();
  });

  it("shows no quantity when quantityLabel is empty, even with amount set", () => {
    const { row } = renderRow({ item: makeItem({ quantityLabel: "" }) });

    expect(screen.queryByText(/150/)).not.toBeInTheDocument();
    expect(row.textContent).toBe(ITEM_NAME);
  });
});

describe("ShoppingItemRow detail", () => {
  it("shows the detail line under the name", () => {
    renderRow({ item: makeItem({ detail: "Per: Pasta al pomodoro" }) });

    expect(screen.getByText("Per: Pasta al pomodoro")).toBeInTheDocument();
    expect(screen.getByText(ITEM_NAME)).toBeInTheDocument();
  });

  it("adds no extra text when detail is absent", () => {
    const { row } = renderRow();

    expect(row.textContent).toBe(`${ITEM_NAME}150 g`);
  });
});

describe("ShoppingItemRow disabled", () => {
  it("exposes aria-disabled and ignores click and Space", () => {
    const { row, onToggle } = renderRow({ disabled: true });

    expect(row).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(row);
    const spaceEvent = fireEvent.keyDown(row, { key: " " });

    expect(onToggle).not.toHaveBeenCalled();
    expect(spaceEvent).toBe(false);
  });

  it("ignores Enter and still prevents its default action", () => {
    const { row, onToggle } = renderRow({ disabled: true });

    const enterEvent = fireEvent.keyDown(row, { key: "Enter" });

    expect(onToggle).not.toHaveBeenCalled();
    expect(enterEvent).toBe(false);
  });
});

describe("ShoppingItemRow remove button", () => {
  it("renders a remove button that calls onRemove and not onToggle", () => {
    const onRemove = vi.fn();
    const { row, onToggle } = renderRow({ onRemove });

    const removeButton = screen.getByRole("button", { name: "Rimuovi Latte" });
    expect(removeButton).toHaveClass("h-11", "w-11");

    fireEvent.click(removeButton);

    expect(onRemove).toHaveBeenCalledWith(ITEM_ID);
    expect(onToggle).not.toHaveBeenCalled();
    expect(row.contains(removeButton)).toBe(false);
  });
});

describe("ShoppingItemRow keyboard", () => {
  it("toggles on Enter and on Space", () => {
    const { row, onToggle } = renderRow();

    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });

    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenNthCalledWith(1, ITEM_ID);
    expect(onToggle).toHaveBeenNthCalledWith(2, ITEM_ID);
  });
});
