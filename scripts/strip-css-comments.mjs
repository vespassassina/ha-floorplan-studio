// Build-time removal of the comments inside our stylesheets (docs/DECISIONS.md, Opus review of Sprint 23, M2). Vite's lib mode
// does not minify whitespace or template contents, so every /* */ in a css`` block and in FLOORPLAN_CSS shipped in the card:
// about 25 KB gzipped. The comments stay in the source, where they are read.
// A stylesheet is a template tagged `css`, or a template assigned to a const whose name ends in CSS. Inside one, a comment is a
// /* outside a quoted string, a url() and a ${} substitution; a comment that spans a substitution goes with it. Nothing else in
// the file changes. The source is parsed with TypeScript, so a /* in any other template, string or regex is never touched.
import ts from "typescript";

/** Ranges [from, to) of `code` that are comments inside the stylesheet template `tpl`. */
function commentsIn(code, sf, tpl, file) {
  const from = tpl.getStart(sf) + 1, to = tpl.end - 1;
  // Each ${...}: from its `${` to just past its `}`.
  const subs = ts.isTemplateExpression(tpl)
    ? tpl.templateSpans.map((s, i) => [(i === 0 ? tpl.head.end : tpl.templateSpans[i - 1].literal.end) - 2, s.literal.getStart(sf) + 1])
    : [];
  const out = [];
  let i = from, open = -1;
  const sub = () => subs.find(([a]) => a === i);
  /** Moves past the quoted string or url() that starts at i, hopping substitutions; returns the index after it. */
  const skipTo = (close) => {
    for (i++; i < to; ) {
      const s = sub();
      if (s) { i = s[1]; continue; }
      if (code[i] === "\\") { i += 2; continue; }
      if (code[i] === close) return i + 1;
      i++;
    }
    return i;
  };
  while (i < to) {
    const s = sub();
    if (s) { i = s[1]; continue; }
    if (open >= 0) {
      if (code.startsWith("*/", i)) { out.push([open, i + 2]); open = -1; i += 2; } else i++;
      continue;
    }
    const c = code[i];
    if (code.startsWith("/*", i)) { open = i; i += 2; }
    else if (c === '"' || c === "'") i = skipTo(c);
    else if (/^url\(/i.test(code.slice(i, i + 4))) {
      // A quoted argument is one string first, so a ")" inside it does not end the url() (S23.F4).
      for (i += 4; i < to && /\s/.test(code[i]); ) i++;
      if (code[i] === '"' || code[i] === "'") i = skipTo(code[i]);
      i--;
      i = skipTo(")");
    }
    else if (c === "\\") i += 2;
    else i++;
  }
  if (open >= 0) throw new Error(`strip-css-comments: ${file}: a comment in a stylesheet is never closed (at offset ${open}).`);
  return out;
}

/** A character that already keeps the tokens on either side of a removed comment apart. */
const SEP = /[\s`{};:,>]/;
const isTemplate = (n) => ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);

/** `code` with every comment inside its stylesheets removed. A comment between two tokens (an empty comment between two words) leaves one space, so they stay two. */
export function stripTemplateCss(code, file = "input.ts") {
  if (!code.includes("/*")) return code;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cuts = [];
  const visit = (n) => {
    if (ts.isTaggedTemplateExpression(n) && ts.isIdentifier(n.tag) && n.tag.text === "css") cuts.push(...commentsIn(code, sf, n.template, file));
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /CSS$/.test(n.name.text) && n.initializer && isTemplate(n.initializer)) cuts.push(...commentsIn(code, sf, n.initializer, file));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!cuts.length) return code;
  // A stylesheet nested in another's substitution can give a cut inside a cut: keep the outer one.
  cuts.sort((a, b) => a[0] - b[0]);
  let out = "", at = 0;
  for (const [a, b] of cuts) {
    if (a < at) continue;
    const gap = SEP.test(code[a - 1] ?? " ") || SEP.test(code[b] ?? " ") ? "" : " ";
    out += code.slice(at, a) + gap;
    at = b;
  }
  return out + code.slice(at);
}

/** The Vite plugin: the project's own TypeScript, before esbuild sees it. */
export function stripCssComments() {
  return {
    name: "fp-strip-css-comments",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0];
      if (file.includes("/node_modules/") || !/\/src\/.*\.ts$/.test(file) || !code.includes("/*")) return null;
      const out = stripTemplateCss(code, file);
      return out === code ? null : { code: out, map: null };
    },
  };
}
