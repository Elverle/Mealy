import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";

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
