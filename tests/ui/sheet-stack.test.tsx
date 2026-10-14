import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface HarnessProps {
  onFirstChange: (open: boolean) => void;
  onSecondChange: (open: boolean) => void;
}

/** Due sheet fratelli: la prima è aperta da subito, la seconda si apre con un pulsante. */
function Harness({ onFirstChange, onSecondChange }: HarnessProps) {
  const [firstOpen, setFirstOpen] = useState(true);
  const [secondOpen, setSecondOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setSecondOpen(true)}>
        Apri seconda
      </button>
      <Sheet
        open={firstOpen}
        onOpenChange={(open) => {
          onFirstChange(open);
          setFirstOpen(open);
        }}
      >
        <SheetContent>
          <p>Prima sheet</p>
        </SheetContent>
      </Sheet>
      <Sheet
        open={secondOpen}
        onOpenChange={(open) => {
          onSecondChange(open);
          setSecondOpen(open);
        }}
      >
        <SheetContent>
          <p>Seconda sheet</p>
        </SheetContent>
      </Sheet>
    </>
  );
}

function openSecond() {
  fireEvent.click(screen.getByRole("button", { name: "Apri seconda" }));
}

function pressEscape() {
  fireEvent.keyDown(window, { key: "Escape" });
}

describe("Sheet stack: Escape", () => {
  it("closes only the last opened sheet when two are open", () => {
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    render(<Harness onFirstChange={onFirst} onSecondChange={onSecond} />);
    openSecond();
    expect(screen.getByText("Seconda sheet")).toBeInTheDocument();

    pressEscape();

    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(onSecond).toHaveBeenCalledWith(false);
    expect(onFirst).not.toHaveBeenCalled();
    expect(screen.queryByText("Seconda sheet")).not.toBeInTheDocument();
    expect(screen.getByText("Prima sheet")).toBeInTheDocument();
  });

  it("closes the previous sheet on the next Escape once the last one is closed", () => {
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    render(<Harness onFirstChange={onFirst} onSecondChange={onSecond} />);
    openSecond();
    pressEscape();

    pressEscape();

    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onFirst).toHaveBeenCalledWith(false);
    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Prima sheet")).not.toBeInTheDocument();
  });

  it("closes a single open sheet on Escape, as before the stack existed", () => {
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    render(<Harness onFirstChange={onFirst} onSecondChange={onSecond} />);

    pressEscape();

    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onFirst).toHaveBeenCalledWith(false);
    expect(onSecond).not.toHaveBeenCalled();
  });

  it("keeps the order of opening when the first sheet receives a new onOpenChange on every render", () => {
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const { rerender } = render(<Harness onFirstChange={onFirst} onSecondChange={onSecond} />);
    openSecond();

    const replacedOnFirst = vi.fn();
    rerender(<Harness onFirstChange={replacedOnFirst} onSecondChange={onSecond} />);
    pressEscape();

    expect(onSecond).toHaveBeenCalledWith(false);
    expect(replacedOnFirst).not.toHaveBeenCalled();
    expect(onFirst).not.toHaveBeenCalled();
    expect(screen.getByText("Prima sheet")).toBeInTheDocument();
  });
});

/** Una sheet con titolo e un pulsante nel corpo, aperta da un pulsante della pagina. */
function FocusHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Apri
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Lasagne al pesto</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <button type="button">Un&apos;altra</button>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

describe("Sheet focus and naming", () => {
  it("renders the panel in a portal on document.body, named by its title", () => {
    const { container } = render(<FocusHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Apri" }));

    const dialog = screen.getByRole("dialog", { name: "Lasagne al pesto" });
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("moves focus into the panel when it opens, away from the field that had it", () => {
    render(<FocusHarness />);
    const opener = screen.getByRole("button", { name: "Apri" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("returns focus to the element that had it when the sheet closes", () => {
    render(<FocusHarness />);
    const opener = screen.getByRole("button", { name: "Apri" });
    opener.focus();
    fireEvent.click(opener);

    pressEscape();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab inside the panel", () => {
    render(<FocusHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Apri" }));
    const close = screen.getByRole("button", { name: "Chiudi" });
    const another = screen.getByRole("button", { name: "Un'altra" });

    another.focus();
    fireEvent.keyDown(another, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(another).toHaveFocus();
  });
});

describe("Sheet and the phone keyboard", () => {
  /** visualViewport finto: jsdom non lo implementa. innerHeight di jsdom è 768. */
  function installViewport(height: number) {
    const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    return viewport;
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("sits above the keyboard and fits the visible area while the keyboard is open", () => {
    const viewport = installViewport(768);
    render(<FocusHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Apri" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.bottom).toBe("");

    act(() => {
      viewport.height = 468;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(dialog.style.bottom).toBe("300px");
    expect(dialog.style.maxHeight).toBe(`${Math.round(468 * 0.92)}px`);

    act(() => {
      viewport.height = 768;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(dialog.style.bottom).toBe("");
    expect(dialog.style.maxHeight).toBe("");
  });

  it("ignores a small difference such as a browser toolbar, and pinch zoom", () => {
    const viewport = installViewport(708);
    render(<FocusHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Apri" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.bottom).toBe("");

    act(() => {
      Object.assign(viewport, { height: 384, scale: 2 });
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(dialog.style.bottom).toBe("");
  });
});

describe("Sheet stack: page scroll", () => {
  it("locks the page scroll while one sheet is open and releases it when it closes", () => {
    render(<Harness onFirstChange={vi.fn()} onSecondChange={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");

    pressEscape();

    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the page scroll locked while another sheet is still open", () => {
    render(<Harness onFirstChange={vi.fn()} onSecondChange={vi.fn()} />);
    openSecond();
    expect(document.body.style.overflow).toBe("hidden");

    pressEscape();
    expect(screen.queryByText("Seconda sheet")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    pressEscape();
    expect(document.body.style.overflow).toBe("");
  });

  it("releases the page scroll when the last open sheet is closed with its close button", () => {
    render(<Harness onFirstChange={vi.fn()} onSecondChange={vi.fn()} />);
    openSecond();

    fireEvent.click(screen.getAllByRole("button", { name: "Chiudi" })[1]);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getAllByRole("button", { name: "Chiudi" })[0]);
    expect(document.body.style.overflow).toBe("");
  });
});
