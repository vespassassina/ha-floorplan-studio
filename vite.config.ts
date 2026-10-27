import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync, readdirSync } from "node:fs";
import { trimThree } from "./scripts/trim-three.mjs";
import { stripCssComments } from "./scripts/strip-css-comments.mjs";
import { minifyOutput } from "./scripts/minify-output.mjs";

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

// S38.0: the Edit-card form is built on its own, before the card (scripts/build.mjs), into a file with a content hash in its name. The card
// build reads that name here and compiles it in as `__FP_FORM_FILE__`, so getConfigElement() imports the file beside the card by a relative
// path, as it imports the language chunks. A bundle of its own, not a rollup chunk of the card's: rollup would hoist everything the card and
// the form share (lit, core) into a third file, and the card file would shrink by moving its code, not by being smaller.
const formFile = (dir: string) => {
  const f = readdirSync(dir).find((n) => /^floorplan-studio-form-[\w-]+\.js$/.test(n));
  if (!f) throw new Error(`No floorplan-studio-form-<hash>.js in ${dir}/. Build the form first (scripts/build.mjs builds mode "form" before "card").`);
  return `./${f}`;
};

// One build per output, chosen with --mode: form, card, panel or editor.
export default defineConfig(({ mode }) => {
  const outDir = process.env.FP_OUT ?? "dist";
  const lib = (entry: string, fileName: string) => ({
    // The comments inside our stylesheets stay in the source and do not ship (scripts/strip-css-comments.mjs); nor do the
    // code's comments and whitespace, which lib mode keeps (scripts/minify-output.mjs).
    plugins: [trimThree(), stripCssComments(), chunkName(), minifyOutput()],
    // `__FP3D_TEST__` is a compile-time flag: only the test build (FP3D_TEST=1, made by scripts/build.mjs for the Playwright specs)
    // keeps the 3D view's test hook; in the shipped build the code is dropped.
    define: { __FP_VERSION__: JSON.stringify(version), ...(mode === "card" ? { __FP_FORM_FILE__: JSON.stringify(formFile(outDir)) } : {}), __FP3D_TEST__: process.env.FP3D_TEST === "1" ? "true" : "false" },
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry, formats: ["es" as const], fileName: () => fileName },
      // The card lazy-loads its 3D code (three.js) with import(). That becomes a chunk beside the card, named by a hash of
      // its content so a browser never keeps a stale one under the same name, and found from the card's own URL.
      // S37.5: each language of the card's own words is a chunk too (src/card/i18n/<code>.ts, loaded by import() for `hass.language`).
      // Its own prefix keeps it from counting as the one 3D chunk the release checks for.
      rollupOptions: { output: { chunkFileNames: (c: { name: string; facadeModuleId?: string | null }) => (/[\\/]card[\\/]i18n[\\/]/.test(c.facadeModuleId ?? "") ? `floorplan-studio-lang-${c.name}-[hash].js` : "floorplan-studio-3d-[hash].js") } },
    },
  });
  if (mode === "form") return lib("src/card/config-editor.ts", "floorplan-studio-form-[hash].js");
  if (mode === "card") return lib("src/card/floorplan-studio-card.ts", "floorplan-studio-card.js");
  if (mode === "panel") return lib("src/editor/panel.ts", "floorplan-studio-panel.js");
  return {
    root: "src/editor",
    plugins: [stripCssComments(), viteSingleFile()],
    build: { outDir: "../../dist", emptyOutDir: false, rollupOptions: { input: "src/editor/standalone.html" } },
  };
});
