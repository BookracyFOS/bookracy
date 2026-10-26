import { defineConfig } from "vite";
import path from "path";

// Standalone build for the service worker. Bundles + minifies src/sw/sw.js down to
// dist/sw.js (comments stripped, identifiers mangled), so the shipped worker is small
// and tidy while the readable source lives in src/.
//
// Runs AFTER the main `vite build`:
//   - emptyOutDir:false  → keep the app build that's already in dist/
//   - publicDir:false    → don't re-copy public/ (the main build already did)
//   - format:"iife"      → a classic service worker (registered without type:module)
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2020",
    // The worker is self-contained (no imports), so no code-splitting is needed.
    rollupOptions: {
      input: path.resolve(__dirname, "src/sw/sw.js"),
      output: {
        entryFileNames: "sw.js",
        format: "iife",
      },
    },
  },
});
