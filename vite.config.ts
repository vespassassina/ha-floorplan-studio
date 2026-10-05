import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

// The card names its own version in the console and in a warning when another script owns its element.
const version = JSON.parse(readFileSync("custom_components/floorplan_studio/manifest.json", "utf8")).version as string;

// One build per output, chosen with --mode: card, panel or editor.
export default defineConfig(({ mode }) => {
  const lib = (entry: string, fileName: string) => ({
    define: { __FP_VERSION__: JSON.stringify(version) },
    build: {
      outDir: "dist",
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
