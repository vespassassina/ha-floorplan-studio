import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One build per output, chosen with --mode: card, panel or editor.
export default defineConfig(({ mode }) => {
  const lib = (entry: string, fileName: string) => ({
    build: {
      outDir: "dist",
      emptyOutDir: false,
      lib: { entry, formats: ["es" as const], fileName: () => fileName },
    },
  });
  if (mode === "card") return lib("src/card/floorplan-studio-card.ts", "floorplan-studio-card.js");
  if (mode === "panel") return lib("src/editor/panels.ts", "floorplan-studio-panel.js");
  return {
    root: "src/editor",
    plugins: [viteSingleFile()],
    build: { outDir: "../../dist", emptyOutDir: false, rollupOptions: { input: "src/editor/standalone.html" } },
  };
});
