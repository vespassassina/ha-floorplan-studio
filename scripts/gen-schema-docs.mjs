// node scripts/gen-schema-docs.mjs > docs/schema.md
//
// Walks src/core/schema.ts and turns every exported interface, type alias and const array that carries a
// /** ... */ comment into a section of docs/schema.md: the comment as prose, the declaration as a code block.
// The alternative — writing docs/schema.md by hand — drifts the day a field is added and the doc is not; this
// way the field list is always the real TypeScript, and only the prose needs a human to keep it honest.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve("src/core/schema.ts");
const lines = readFileSync(SRC, "utf8").split("\n");

const DECL = /^export (interface|type|const) (\w+)/;

function readComment(i) {
  // i is the line right above the declaration; a /** ... */ block may be one line or several, ending in */.
  if (!lines[i]?.trim().startsWith("/**") && !lines[i]?.trim().endsWith("*/")) return { text: "", above: i + 1 };
  let start = i;
  while (start >= 0 && !lines[start].trim().startsWith("/**")) start--;
  if (start < 0) return { text: "", above: i + 1 };
  const body = lines.slice(start, i + 1).map((l) => l.trim().replace(/^\/\*\*\s?/, "").replace(/\s?\*\/$/, "").replace(/^\*\s?/, "")).filter((l) => l !== "");
  return { text: body.join(" "), above: start };
}

function readDecl(i) {
  // A declaration may run onto following lines: a brace/bracket block (interface, object-array const), or a
  // bare union with a leading "|" per line and no braces at all (FurnitureSymbol). A brace/bracket block ends
  // the moment it balances back to zero, whether or not that line also carries a trailing ";" (interfaces
  // don't need one); a brace-free declaration ends at the first line that does.
  let depth = 0, opened = false, text = "";
  for (let j = i; j < lines.length; j++) {
    const line = lines[j];
    text += (text ? "\n" : "") + line;
    for (const ch of line) { if ("{[(".includes(ch)) { depth++; opened = true; } if ("}])".includes(ch)) depth--; }
    if (opened && depth <= 0) break;
    if (!opened && line.trim().endsWith(";")) break;
  }
  return text;
}

const sections = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(DECL);
  if (!m) continue;
  const [, kind, name] = m;
  const { text: comment, above } = readComment(i - 1);
  const decl = readDecl(i);
  sections.push({ kind, name, comment, decl, hasComment: above < i });
}

const out = [];
out.push("# Layout schema v2");
out.push("");
out.push("Generated from the comments in [`src/core/schema.ts`](../src/core/schema.ts) — run");
out.push("`node scripts/gen-schema-docs.mjs > docs/schema.md` after changing a comment or a field list there.");
out.push("Never hand-edit this file: the next generation run throws the edit away.");
out.push("");
out.push("For the full field-by-field validation rules (what makes a layout invalid, not just its shape), read");
out.push("`validate()` in the same file, or the behaviour tables in [`SPEC.md`](SPEC.md).");
out.push("");

for (const s of sections) {
  if (!s.hasComment && s.kind !== "interface") continue; // skip the small internal type aliases with nothing to say
  out.push(`## ${s.name}`);
  out.push("");
  if (s.comment) { out.push(s.comment); out.push(""); }
  out.push("```ts");
  out.push(s.decl);
  out.push("```");
  out.push("");
}

console.log(out.join("\n").trimEnd() + "\n");
