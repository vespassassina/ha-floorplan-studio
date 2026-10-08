import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripCssComments, stripTemplateCss } from "../../scripts/strip-css-comments.mjs";

// Opus review of Sprint 23, M2: Vite's lib mode does not minify, so every /* */ inside a css`` block or a *_CSS template
// shipped in the card, about 25 KB gzipped. scripts/strip-css-comments.mjs removes them at build time, and only them:
// a `/*` inside a quoted CSS string, a url() or any other template or string is not a comment and stays.

describe("stripTemplateCss", () => {
  it("removes a comment from a css`` block", () => {
    expect(stripTemplateCss("const s = css`a{b:c}\n  /* note */\n  d{e:f}`;")).toBe("const s = css`a{b:c}\n  \n  d{e:f}`;");
  });
  it("removes a comment from a template assigned to a *_CSS or CSS const", () => {
    expect(stripTemplateCss("export const FLOORPLAN_CSS = `/* why */.a{b:c}`;")).toBe("export const FLOORPLAN_CSS = `.a{b:c}`;");
    expect(stripTemplateCss("const CSS = `.a{b:c}/* why */`;")).toBe("const CSS = `.a{b:c}`;");
  });
  it("removes a comment that spans a substitution, substitution and all, and keeps the substitutions outside it", () => {
    expect(stripTemplateCss("const X_CSS = `/* pulses ${N} times */.a{n:${N}}`;")).toBe("const X_CSS = `.a{n:${N}}`;");
  });
  it("keeps two tokens apart where a comment sat between them", () => {
    expect(stripTemplateCss("const X_CSS = `a/**/b`;")).toBe("const X_CSS = `a b`;");
  });
  it("leaves a /* inside a quoted CSS string or a url() alone", () => {
    const quoted = "const X_CSS = `.a{content:\"/* not */\"} .b{content:'/* nor */'}`;";
    expect(stripTemplateCss(quoted)).toBe(quoted);
    const url = "const X_CSS = `.a{background:url(data:image/svg+xml,a/*b*/c)}`;";
    expect(stripTemplateCss(url)).toBe(url);
  });
  it("leaves a /* in a substitution's own expression alone", () => {
    const s = "const X_CSS = `.a{b:${\"/* js string */\"}}`;";
    expect(stripTemplateCss(s)).toBe(s);
  });
  it("leaves every other template, string and comment alone", () => {
    for (const s of ["const glob = `src/*/x.ts /* keep */`;", "const s = '/* keep */';", "/* a JS comment */ const a = 1;", "const r = html`<p>/* keep */</p>`;"])
      expect(stripTemplateCss(s)).toBe(s);
  });
  it("throws, naming the file, on a comment that is never closed", () => {
    expect(() => stripTemplateCss("const X_CSS = `.a{} /* open`;", "src/x.ts")).toThrow(/src\/x\.ts/);
  });
  it("leaves every stylesheet of the real sources without a comment and with every rule", () => {
    const src = readFileSync("src/core/render.ts", "utf8"), out = stripTemplateCss(src, "src/core/render.ts");
    const css = /export const FLOORPLAN_CSS = `([\s\S]*?)`;\n/.exec(out)![1];
    expect(css).not.toContain("/*");
    expect(css).toContain(".lbl-on{pointer-events:none}");
    expect(css).toContain("@keyframes fp-motion-pulse");
    // The code around it is untouched: only the template changed.
    expect(out.replace(/export const FLOORPLAN_CSS = `[\s\S]*?`;\n/, "")).toBe(src.replace(/export const FLOORPLAN_CSS = `[\s\S]*?`;\n/, ""));
  });
});

describe("the plugin", () => {
  const run = (code: string, id: string) => (stripCssComments() as unknown as { transform(c: string, id: string): { code: string } | null }).transform(code, id);
  it("transforms the project's own TypeScript only", () => {
    expect(run("const X_CSS = `/* a */.a{}`;", "/x/src/card/a.ts")!.code).toBe("const X_CSS = `.a{}`;");
    expect(run("const X_CSS = `/* a */.a{}`;", "/x/node_modules/lit/a.js")).toBeNull();
    expect(run("const a = 1;", "/x/src/card/a.ts")).toBeNull();
  });
});
