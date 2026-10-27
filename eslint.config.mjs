import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  { ignores: [".next/", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["lib/recipes/pack/**/*.ts"],
    ignores: ["lib/recipes/pack/load.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db", "@/lib/db/*"],
              message: "Gli strumenti del pacchetto non aprono il DB (Feature 10, req. P7).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db", "@/lib/db/*", "@/lib/llm", "@/lib/llm/*"],
              message: "Il dominio non importa DB né LLM.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
