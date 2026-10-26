import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["frontend/tests/**/*.test.ts"],
    reporters: ["default", "./scripts/preserve-v8.mjs"],
    coverage: {
      provider: "v8",
      include: ["frontend/src/**/*.ts"],
      reporter: ["text", "json", "json-summary", "html"],
      reportsDirectory: "artifacts/coverage/frontend",
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
