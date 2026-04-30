import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "prototype/sim/__tests__/**/*.test.js",
      "server/src/__tests__/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: true,
  },
});
