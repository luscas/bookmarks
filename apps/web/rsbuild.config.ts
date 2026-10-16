import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginTailwindcss } from "@rsbuild/plugin-tailwindcss";

/**
 * Rsbuild config for the single-page app. The app is served from the same
 * Worker as the API, so all requests use relative `/api` URLs. In development
 * those are proxied to `wrangler dev` on port 8787.
 */
export default defineConfig({
  plugins: [pluginReact(), pluginTailwindcss()],
  source: {
    entry: { index: "./src/main.tsx" },
    // `@bookmarks/shared` ships TypeScript sources (no build step), so Rsbuild
    // has to transpile the linked workspace package as part of the app.
    include: [/[\\/]packages[\\/]shared[\\/]/],
  },
  html: {
    template: "./src/index.html",
  },
  output: {
    distPath: { root: "dist" },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
