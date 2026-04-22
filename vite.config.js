import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*", "TAURI_PLATFORM", "TAURI_ARCH",
              "TAURI_FAMILY", "TAURI_PLATFORM_VERSION", "TAURI_DEBUG"],
  build: {
    // Tauri expects a fixed output directory
    outDir: "dist",
    // Use a modern but compatible target
    target: ["es2021", "chrome100", "safari13"],
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // hljs (200 language grammars) and codemirror each exceed Vite's 500kB
    // default; the warning isn't meaningful for a locally-loaded desktop app.
    chunkSizeWarningLimit: 1000,
    // Split the heavy vendor libraries into their own chunks. Each of these
    // is independently large (CodeMirror, markdown-it ecosystem, KaTeX,
    // highlight.js); bundling them together trips Vite's 500kB warning and
    // also hurts first-paint because the whole bundle has to parse before
    // the editor can mount.
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/search",
            "@codemirror/language",
            "@codemirror/language-data",
            "@codemirror/lang-markdown",
            "@codemirror/autocomplete",
          ],
          markdown: [
            "markdown-it",
            "markdown-it-anchor",
            "markdown-it-container",
            "markdown-it-deflist",
            "markdown-it-emoji",
            "markdown-it-footnote",
            "markdown-it-ins",
            "markdown-it-mark",
            "markdown-it-sub",
            "markdown-it-sup",
            "markdown-it-task-lists",
            "markdown-it-texmath",
            "markdown-it-toc-done-right",
          ],
          katex: ["katex"],
          hljs: ["highlight.js"],
        },
      },
    },
  },
});
