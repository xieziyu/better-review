import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: resolve(__dirname, "dist/web"), emptyOutDir: true },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/web"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  server: { port: 5174, proxy: { "/api": "http://127.0.0.1:7345" } },
});
