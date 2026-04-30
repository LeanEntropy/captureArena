import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "prototype/sim/__tests__/**/*.test.js",
      "server/src/__tests__/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: true,
    // Contour extraction over the 1024×1024 grid is slow; per-test sims that
    // exercise it can exceed the default 5s. Bump to 30s for headroom.
    testTimeout: 30000,
  },
});
