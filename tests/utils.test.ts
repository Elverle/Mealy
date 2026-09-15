import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn utility", () => {
  it("merges class names correctly", () => {
    expect(cn("bg-paper", "text-ink")).toBe("bg-paper text-ink");
  });

  it("handles conditional class names", () => {
    const isTrue = true;
    const isFalse = false;
    expect(cn("base", isTrue && "active", isFalse && "inactive")).toBe("base active");
  });

  it("resolves tailwind class conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("handles undefined and null inputs", () => {
    expect(cn("base", undefined, null, false)).toBe("base");
  });
});
