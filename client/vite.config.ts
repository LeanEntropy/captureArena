import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../packages/shared/src"),
    },
  },
  server: {
    port: 3000,
  },
});
