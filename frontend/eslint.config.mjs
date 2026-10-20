import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // next's config already registers the jsx-a11y and import plugins; add their rules.
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          pathGroups: [{ pattern: "@/**", group: "internal" }],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Release 1 screens built before the design pack. They load data in effects, which
    // these React rules reject; each one is rebuilt on TanStack Query in F5-F14.
    // Remove a path from this list when its screen is rebuilt.
    files: [
      "src/app/(app)/billing/**",
      "src/app/(app)/compliance/**",
      "src/app/(app)/invoices/**",
      "src/app/(app)/manage/**",
      "src/app/(app)/pharmacy/**",
      "src/app/(app)/registrations/**",
      "src/app/(app)/schedule/**",
      "src/components/legacy-ui.tsx",
      "src/lib/useLoad.ts",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/exhaustive-deps": "off",
      "jsx-a11y/no-autofocus": "off",
    },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    ".pnpm-store/**",
    "next-env.d.ts",
    "src/lib/schema.d.ts",
    "public/mockServiceWorker.js",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
