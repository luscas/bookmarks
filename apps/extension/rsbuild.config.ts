import { defineConfig } from "@rsbuild/core";

/**
 * Rsbuild config for the MV3 extension.
 *
 * Three entries share one bundle:
 * - `popup` and `options` are HTML pages (each with its own template);
 * - `background` is a plain TypeScript service worker (`html: false`).
 *
 * Filenames are pinned (no content hash) because `manifest.json` references
 * `background.js` by a fixed path and Chrome refuses to load a worker whose
 * name changes between builds.
 */
export default defineConfig({
  source: {
    entry: {
      popup: { import: "./src/popup/popup.ts", html: true },
      options: { import: "./src/options/options.ts", html: true },
      background: { import: "./src/background.ts", html: false },
    },
    // `@bookmarks/shared` ships TypeScript sources (no build step), so Rsbuild
    // has to transpile the linked workspace package as part of the extension.
    include: [/[\\/]packages[\\/]shared[\\/]/],
  },
  html: {
    template: ({ entryName }) =>
      entryName === "options" ? "./src/options/index.html" : "./src/popup/index.html",
    title: ({ entryName }) => (entryName === "options" ? "Favoritos — Opções" : "Salvar favorito"),
  },
  performance: {
    // Extensions load better as self-contained entry files: no shared chunks
    // (the service worker must not depend on a hashed sibling) and a stable
    // `background.js` path referenced by the manifest.
    chunkSplit: { strategy: "all-in-one" },
  },
  output: {
    distPath: { root: "dist", js: "", css: "" },
    filename: { js: "[name].js", css: "[name].css" },
    filenameHash: false,
    // Emit the MV3 manifest at the root of the loadable unpacked extension.
    copy: [{ from: "./src/manifest.json", to: "manifest.json" }],
  },
});
