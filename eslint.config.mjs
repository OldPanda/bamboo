import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";

export default ts.config(
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "artifacts/**",
      ".hallmark/**",
      ".cindy-worktrees/**",
      "frontend/dist/**",
      "frontend/src/mygo.ts",
      ".venv/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["frontend/src/**/*.ts", "scripts/**/*.mjs"],
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          enableFixer: false,
          require: { FunctionDeclaration: true, ClassDeclaration: true },
        },
      ],
    },
  },
  // Native smoke files are async function bodies injected into WKWebView.
  {
    files: ["scripts/*-smoke.js"],
    languageOptions: {
      sourceType: "script",
      parserOptions: { ecmaFeatures: { globalReturn: true } },
      globals: { mygo: "readonly", workspacePhase: "readonly" },
    },
  },
  // IPC test doubles intentionally accept arbitrary host payloads.
  {
    files: ["frontend/tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
