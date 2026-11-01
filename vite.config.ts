import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src/web",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src/web") } },
  build: { outDir: "../../dist/web", emptyOutDir: true },
  test: { root: ".", include: ["src/**/*.test.ts"] },
});
