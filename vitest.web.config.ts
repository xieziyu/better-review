import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/web"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/web/**/*.test.{ts,tsx}", "src/web/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/web/setup.ts"],
  },
});
