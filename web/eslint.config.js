import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Flat config. The goal is to catch real mistakes — unused code, accidental `any`, hooks
// called conditionally, stale effect dependencies — not to impose a style, since formatting
// here is already consistent.
//
// Two deliberate exclusions:
//
// * eslint-plugin-react-hooks v7 ships the React-Compiler-era rules (set-state-in-effect,
//   static-components, refs, immutability, use-memo) in its `recommended` preset. They flag
//   ordinary patterns used throughout this codebase — every `useFetch`, the store provider,
//   Checkout, Shop — and adopting them means rewriting working code that is out of scope
//   here. Only the two long-standing correctness rules are enabled. Turning the rest on is a
//   worthwhile separate piece of work.
//
// * react-refresh/only-export-components is about hot-reload granularity, not correctness,
//   and this codebase deliberately colocates a component with its constants
//   (PRODUCT_STATUSES next to StatusBadge, the store hooks next to the provider).
export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Unused arguments are often deliberate in callback signatures; require the _ prefix.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Config files run in Node.
    files: ["*.config.{js,ts}", "vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
);
