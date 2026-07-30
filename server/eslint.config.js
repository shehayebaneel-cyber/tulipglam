import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Server-side flat config. Same intent as web/eslint.config.js: catch unused code and
// accidental `any`, not enforce a style.
export default tseslint.config(
  { ignores: ["node_modules", "prisma/*.json", "uploads"] },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
