import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  // The EPUB -> PDF worker `import()`s the converter, which needs an ES-module worker
  // (the default IIFE format can't code-split).
  worker: { format: "es" },
  build: {
    chunkSizeWarningLimit: 1200,
    // No manualChunks. The reader (epub.js) and the PDF converter are only ever
    // `import()`ed, so Rollup already gives each its own chunk with its exclusive
    // dependencies. Forcing them into named chunks used to drag a shared helper module
    // in with them, which the entry then imported statically — so both chunks (~1.2 MB)
    // were <link rel="modulepreload">ed on every first visit, reader or not.
  },
});
