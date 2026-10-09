import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AddShoppingItemSheet,
  type AddShoppingItemSheetProps,
} from "@/components/shopping/add-item-sheet";
import { ApiRequestError } from "@/lib/http/client";
import { SHOPPING_ITEM_NAME_MAX } from "@/lib/domain/types";

const NETWORK_MESSAGE = "Connessione non disponibile.";

function renderSheet(props: Partial<AddShoppingItemSheetProps> = {}) {
  const onClose = vi.fn();
  const onAdd = vi.fn<(name: string) => Promise<string>>(() =>
    Promise.resolve("Latte")
  );
  const merged: AddShoppingItemSheetProps = {
    open: true,
    onClose,
    onAdd,
    ...props,
  };
  const utils = render(<AddShoppingItemSheet {...merged} />);
  return {
    ...utils,
    onClose,
    onAdd,
    rerenderWith: (next: Partial<AddShoppingItemSheetProps>) =>
      utils.rerender(<AddShoppingItemSheet {...merged} {...next} />),
  };
}

function field(): HTMLInputElement {
  return screen.getByLabelText("Cosa manca?") as HTMLInputElement;
}

describe("AddShoppingItemSheet visibility and initial state", () => {
  it("renders nothing when closed", () => {
    renderSheet({ open: false });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows title, labelled field and a disabled submit while the field is empty", async () => {
    const user = userEvent.setup();
    renderSheet();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Aggiungi alla lista" })
    ).toBeInTheDocument();
    expect(field()).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Aggiungi" });
    expect(submit).toBeDisabled();

    await user.type(field(), "   ");
    expect(submit).toBeDisabled();
  });
});

describe("AddShoppingItemSheet adding items", () => {
  it("adds the trimmed name, confirms it and keeps the sheet open", async () => {
    const user = userEvent.setup();
    const { onAdd, onClose } = renderSheet();

    await user.type(field(), " latte {enter}");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Aggiunto: Latte");
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("latte");
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables submit and ignores a second submit while saving", async () => {
    const user = userEvent.setup();
    let resolveAdd: (label: string) => void = () => {};
    const onAdd = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAdd = resolve;
        })
    );
    renderSheet({ onAdd });

    await user.type(field(), "latte");
    const submit = screen.getByRole("button", { name: "Aggiungi" });
    fireEvent.click(submit);

    expect(submit).toBeDisabled();
    fireEvent.submit(field().form as HTMLFormElement);
    expect(onAdd).toHaveBeenCalledTimes(1);

    resolveAdd("Latte");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Aggiunto: Latte");
    });
    expect(submit).toBeDisabled();

    await user.type(field(), "uova{enter}");
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenLastCalledWith("uova");
  });

  it("keeps what the user typed while saving when the answer arrives", async () => {
    const user = userEvent.setup();
    let resolveAdd: (label: string) => void = () => {};
    const onAdd = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAdd = resolve;
        })
    );
    renderSheet({ onAdd });

    await user.type(field(), "latte{enter}");
    await user.type(field(), "pane");
    expect(field()).toHaveValue("lattepane");

    resolveAdd("Latte");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Aggiunto: Latte");
    });
    expect(field()).toHaveValue("lattepane");
  });

  it("shows the API message and keeps the typed text when adding fails", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn(() =>
      Promise.reject(new ApiRequestError(0, "network_error", NETWORK_MESSAGE))
    );
    renderSheet({ onAdd });

    await user.type(field(), "latte{enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(NETWORK_MESSAGE);
    expect(field()).toHaveValue("latte");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("limits the field to the shopping item name maximum", () => {
    renderSheet();

    expect(field()).toHaveProperty("maxLength", SHOPPING_ITEM_NAME_MAX);
    expect(SHOPPING_ITEM_NAME_MAX).toBe(80);
  });
});

describe("AddShoppingItemSheet closing", () => {
  it("calls onClose from the Chiudi button", () => {
    const { onClose } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const { onClose } = renderSheet();

    fireEvent.keyDown(field(), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AddShoppingItemSheet reopening", () => {
  it("clears text, confirmation and error when reopened", async () => {
    const user = userEvent.setup();
    const onAdd = vi
      .fn<(name: string) => Promise<string>>()
      .mockResolvedValueOnce("Latte")
      .mockRejectedValueOnce(new ApiRequestError(0, "network_error", NETWORK_MESSAGE));
    const { rerenderWith } = renderSheet({ onAdd });

    await user.type(field(), "latte{enter}");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Aggiunto: Latte");
    });
    await user.type(field(), "x{enter}");
    await screen.findByRole("alert");
    expect(field()).toHaveValue("x");

    rerenderWith({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerenderWith({ open: true });

    expect(field()).toHaveValue("");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
