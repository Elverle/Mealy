import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Project Structure & Config Verification", () => {
  it("Project files required by WP1 exist", () => {
    const root = path.resolve(__dirname, "..");
    const requiredFiles = [
      "package.json",
      "tsconfig.json",
      "next.config.ts",
      "postcss.config.mjs",
      "components.json",
      "lib/utils.ts",
      "app/globals.css",
      "app/layout.tsx",
      "app/(app)/page.tsx",
      "vitest.config.ts",
      "vitest.setup.ts",
      ".env.example",
      ".gitignore",
      "lib/domain/.gitkeep",
      "lib/db/.gitkeep",
      "lib/llm/.gitkeep",
      "fixtures/.gitkeep",
      "components/ui/.gitkeep",
    ];

    for (const file of requiredFiles) {
      const fullPath = path.join(root, file);
      expect(fs.existsSync(fullPath), `Expected ${file} to exist`).toBe(true);
    }
  });

  it("Design tokens are present in app/globals.css", () => {
    const cssContent = fs.readFileSync(
      path.resolve(__dirname, "../app/globals.css"),
      "utf-8"
    );
    expect(cssContent).toContain("--color-paper: #FAF7F2;");
    expect(cssContent).toContain("--color-ink: #26221B;");
    expect(cssContent).toContain("--color-basil: #3E6B4F;");
    expect(cssContent).toContain("--color-tomato: #C4482F;");
    expect(cssContent).toContain("--color-saffron: #E0A83C;");
    expect(cssContent).toContain("--color-stone: #726B5F;");
    expect(cssContent).toContain("--font-display: var(--font-fraunces), serif;");
    expect(cssContent).toContain("--font-sans: var(--font-figtree), sans-serif;");
  });

  it(".env.example contains required keys", () => {
    const envContent = fs.readFileSync(
      path.resolve(__dirname, "../.env.example"),
      "utf-8"
    );
    expect(envContent).toContain("DATABASE_URL=");
    expect(envContent).toContain("LLM_PROVIDER=");
    expect(envContent).toContain("LLM_MODEL=");
    expect(envContent).toContain("OPENROUTER_API_KEY=");
  });
});
