// The last step of the card and panel builds: the whitespace and the comments of the code go (S24.4, S23.F5).
// Vite's lib mode minifies names and syntax but, for the es format, never whitespace: that would drop the /* @__PURE__ */
// marks a library's users need to tree-shake it. With the whitespace, esbuild keeps every JSDoc and // comment, and the
// card shipped about 25 KB gzipped of them. Our files are the end of the line, not a library anyone bundles again, so
// the marks have no use here. Licence comments (@license, /*!) stay, where they are. Template contents are not touched:
// the comments in our stylesheets go earlier (strip-css-comments.mjs).
import { transformWithEsbuild } from "vite";

export function minifyOutput() {
  return {
    name: "fp-minify-output",
    enforce: "post",
    // generateBundle runs after Vite's own minify in renderChunk, which would print the code out again with its whitespace.
    async generateBundle(_o, bundle) {
      for (const c of Object.values(bundle)) {
        if (c.type !== "chunk") continue;
        const out = await transformWithEsbuild(c.code, c.fileName, { minifyWhitespace: true, legalComments: "inline", format: "esm" });
        c.code = out.code;
      }
    },
  };
}
