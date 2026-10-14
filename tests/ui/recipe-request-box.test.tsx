import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { RecipeRequestBox } from "@/components/recipes/recipe-request-box";

describe("RecipeRequestBox visibility", () => {
  it.each(["", "ab", "  ab  "])("renders nothing for the query %j", (query) => {
    const { container } = render(<RecipeRequestBox query={query} onRequest={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RecipeRequestBox", () => {
  it("offers the trimmed request and sends it on click", () => {
    const onRequest = vi.fn();
    render(<RecipeRequestBox query="  lasagne " onRequest={onRequest} />);

    expect(screen.getByText("Non c'è quello che cerchi?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chiedi una ricetta per «lasagne»" }));

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith("lasagne");
  });

  it("forwards buttonRef to the button element", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<RecipeRequestBox query="lasagne" onRequest={vi.fn()} buttonRef={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toHaveTextContent("Chiedi una ricetta per «lasagne»");
  });

  it("renders markup in the query as plain text", () => {
    const { container } = render(
      <RecipeRequestBox query="<b>ciao</b>" onRequest={vi.fn()} />
    );

    expect(container.querySelector("b")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Chiedi una ricetta per «<b>ciao</b>»" })
    ).toBeInTheDocument();
  });
});
