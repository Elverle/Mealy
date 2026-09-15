import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";
import { DEFAULT_HOUSEHOLD, DEFAULT_HOUSEHOLD_ID, HouseholdSchema } from "@/lib/domain/types";

describe("Smoke Test Suite", () => {
  it("cn() utility merges and deduplicates class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red", false && "hidden")).toBe("text-red");
  });

  it("DEFAULT_HOUSEHOLD is a valid Household", () => {
    expect(DEFAULT_HOUSEHOLD.id).toBe(DEFAULT_HOUSEHOLD_ID);
    const parsed = HouseholdSchema.safeParse(DEFAULT_HOUSEHOLD);
    expect(parsed.success).toBe(true);
  });
});
