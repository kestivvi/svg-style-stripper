import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/cli/index.ts",
    outDir: "dist/cli",
    emptyOutDir: true,
    target: "node20",
    rollupOptions: {
      output: { entryFileNames: "index.js", banner: "#!/usr/bin/env node" },
    },
  },
});
