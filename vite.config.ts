import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { trimThree } from "./scripts/trim-three.mjs";

// The card names its own version in the console and in a warning when another script owns its element.
const version = JSON.parse(readFileSync("custom_components/floorplan_studio/manifest.json", "utf8")).version as string;

// The card retries a failed 3D load through the chunk's own hashed name plus a query (a browser keeps a failed `import()` of one URL
// and never asks again). The name is only known after the build, so the card holds a placeholder and this puts the name in.
const chunkName = () => ({
  name: "fp-chunk-name",
  generateBundle(_o: unknown, bundle: Record<string, { type: string; fileName: string; isEntry?: boolean; code?: string }>) {
    const chunk = Object.values(bundle).find((c) => c.type === "chunk" && !c.isEntry && /^floorplan-studio-3d-.+\.js$/.test(c.fileName));
    if (!chunk) return;
    for (const c of Object.values(bundle)) {
      if (c.type === "chunk" && c.isEntry && c.code?.includes("__FP3D_CHUNK__")) c.code = c.code.replace('"__FP3D_CHUNK__"', JSON.stringify(chunk.fileName));
    }
  },
});

// One build per output, chosen with --mode: card, panel or editor.
export default defineConfig(({ mode }) => {
  const lib = (entry: string, fileName: string) => ({
    plugins: [trimThree(), chunkName()],
    // `__FP3D_TEST__` is a compile-time flag: only the test build (FP3D_TEST=1, made by scripts/build.mjs for the Playwright specs)
    // keeps the 3D view's test hook; in the shipped build the code is dropped.
    define: { __FP_VERSION__: JSON.stringify(version), __FP3D_TEST__: process.env.FP3D_TEST === "1" ? "true" : "false" },
    build: {
      outDir: process.env.FP_OUT ?? "dist",
      emptyOutDir: false,
      lib: { entry, formats: ["es" as const], fileName: () => fileName },
      // The card lazy-loads its 3D code (three.js) with import(). That becomes a chunk beside the card, named by a hash of
      // its content so a browser never keeps a stale one under the same name, and found from the card's own URL.
      rollupOptions: { output: { chunkFileNames: "floorplan-studio-3d-[hash].js" } },
    },
  });
  if (mode === "card") return lib("src/card/floorplan-studio-card.ts", "floorplan-studio-card.js");
  if (mode === "panel") return lib("src/editor/panel.ts", "floorplan-studio-panel.js");
  return {
    root: "src/editor",
    plugins: [viteSingleFile()],
    build: { outDir: "../../dist", emptyOutDir: false, rollupOptions: { input: "src/editor/standalone.html" } },
  };
});
