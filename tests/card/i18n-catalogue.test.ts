import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { BELOW_LABELS, HEAT_LABELS } from "../../src/card/view-state";
import { CATEGORIES, DETAIL_LABELS, DEVICE_TYPE_LABELS, LAYERS, OFF_GROUP_LABEL, WALLS_LABELS } from "../../src/core";
import { THEME_LABELS } from "../../src/card/floorplan-studio-card";
import { LANGUAGES } from "../../src/card/i18n";
import type { Catalogue, Entry } from "../../src/core/i18n";

// S37.5: the card's own words are `t("English")` and `tn("one", "other", n)` calls, and the catalogue of each language holds one
// entry per English key. This file keeps the two honest: it reads the source for every key, so
//   - a new user-facing string must come with a key in every language (the catalogue test fails until it does);
//   - a key nobody calls any more must go (the stale test);
//   - a raw English string left in a template or a label is a failure of its own (the lint tests);
//   - a translation keeps its placeholders and has the plural forms its language needs.
// Not covered, on purpose (docs/DECISIONS.md, 2026-10-25): the Edit-card form (config-editor.ts), the dashboard strategy
// (strategy.ts) and the 3D chunk (three/). They are English and are in the PLAN backlog.

const SRC = ["src/card", "src/card/replay", "src/core"]; // S40.1: the replay chunk draws the open bar, with t() calls of its own
const SKIP = new Set(["src/card/config-editor.ts", "src/card/strategy.ts", "src/card/i18n.ts", "src/core/i18n.ts"]);
const files = SRC.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ts")).map((f) => `${d}/${f}`)).filter((f) => !SKIP.has(f));
const TEMPLATE_FILES = ["floorplan-studio-card", "popup-ui", "room-scenes-ui", "search-box", "more-menu", "card-replay", "replay/bar"].map((n) => `src/card/${n}.ts`);

/** The label tables the card shows through `t(TABLE[x])`: their values are keys too. */
const TABLES: Record<string, Record<string, string>> = { THEME_LABELS, DETAIL_LABELS, WALLS_LABELS, BELOW_LABELS, HEAT_LABELS, OFF_GROUP_LABEL };
const TABLE_KEYS = [...Object.values(TABLES).flatMap((t) => Object.values(t)), ...Object.values(DEVICE_TYPE_LABELS), ...CATEGORIES.map((c) => c.label), ...LAYERS.map((l) => l.label)];

interface Found { keys: Map<string, { file: string; line: number; plural: string | null }>; dynamic: string[]; calls: number }
function scanCalls(): Found {
  const keys: Found["keys"] = new Map(), dynamic: string[] = [];
  let calls = 0;
  for (const file of files) {
    const src = readFileSync(file, "utf8"), sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const lit = (n: ts.Expression | undefined) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "t" || n.expression.text === "tn" || n.expression.text === "mark")) {
        calls++;
        const plural = n.expression.text === "tn";
        const one = lit(n.arguments[0]), other = plural ? lit(n.arguments[1]) : null;
        if (one === null) {
          const text = n.arguments[0]?.getText(sf) ?? "";
          // A label table lookup, a `.label` from CATEGORIES or LAYERS (their values are added above), a search entry's typeLabel
          // (DEVICE_TYPE_LABELS, added above), or a CONSTANT (its text is the argument of a `mark(...)`, found by this scan).
          const ok = new RegExp(`^(${Object.keys(TABLES).join("|")})\\[`).test(text) || /\.label\b/.test(text) || /\.typeLabel$/.test(text)
            || /^[A-Z][A-Z0-9_]+(\[\w+\])?$/.test(text) || /^\w+ \? [A-Z][A-Z0-9_]+ : [A-Z][A-Z0-9_]+$/.test(text) || /^this\._(error|fallback3d)\b/.test(text);
          if (!ok) dynamic.push(`${file}:${at(n)}: ${n.getText(sf).slice(0, 80)}`);
        } else if (plural && other === null) dynamic.push(`${file}:${at(n)}: tn needs the plural as a literal`);
        else {
          const seen = keys.get(one);
          if (seen && seen.plural !== other) dynamic.push(`${file}:${at(n)}: "${one}" is used with two plurals (${seen.plural}, ${other})`);
          else if (!seen) keys.set(one, { file, line: at(n), plural: other });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { keys, dynamic, calls };
}
const found = scanCalls();
const REQUIRED = new Set([...found.keys.keys(), ...TABLE_KEYS]);

const catalogue = async (code: string): Promise<Catalogue> => (await LANGUAGES[code]!()).default;
const holes = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
/** Plural categories the language uses for whole counts. */
const categories = (code: string) => { const r = new Intl.PluralRules(code); return new Set(Array.from({ length: 201 }, (_, n) => r.select(n))); };
/** A translation may equal its English key only where the word is the same in that language (or is a name, a unit or a symbol). */
const NAMES = ["Blueprint", "Solarized", "Home Assistant", "A-Team", "Cyberpunk", "Carpenter Brut", "UPS", "Radar", "Firmware", "{n} min"];
const SAME: Record<string, string[]> = {
  it: ["Area", "Auto", "Media", "Computer", "Inverter", "Server", "Access point"],
  es: ["Terminal", "Auto", "Media"],
  pt: ["Terminal", "Auto", "Media"],
  "pt-BR": ["Terminal", "Auto", "Media"],
  fr: ["Attention · {n}", "Pause", "Terminal", "Auto", "Minimal", "Contact", "Vibration"],
  de: ["Detail", "Details", "Pause", "Terminal", "Minimal", "Computer", "Server", "Vibration", "Boiler", "Person", "Alarm"],
  nl: ["open", "Labels", "Detail", "Details", "Model", "Terminal", "Auto", "Media", "Contact", "Camera", "Computer", "Server", "Boiler", "Printer", "Alarm"],
  "zh-Hans": [],
  pl: ["Start", "Model", "Terminal", "Auto", "Media", "Alarm"],
};

describe("the keys in the source", () => {
  it("scans something (a scan that finds nothing would pass every test below)", () => {
    expect(found.calls).toBeGreaterThan(100);
    expect(REQUIRED.size).toBeGreaterThan(100);
  });
  it("every t() and tn() takes its English as a literal, or is a label table lookup", () => expect(found.dynamic).toEqual([]));
  it("a key is the English text: no key is empty, none has leading or trailing space", () => {
    for (const k of REQUIRED) { expect(k.trim(), JSON.stringify(k)).toBe(k); expect(k).not.toBe(""); }
  });
});

describe.each(Object.keys(LANGUAGES))("catalogue %s", (code) => {
  it("has every key the source calls, and no key the source does not", async () => {
    const have = new Set(Object.keys(await catalogue(code)));
    expect([...REQUIRED].filter((k) => !have.has(k)).sort(), "missing from the catalogue").toEqual([]);
    expect([...have].filter((k) => !REQUIRED.has(k)).sort(), "stale: nothing calls it").toEqual([]);
  });

  it("keeps each placeholder of the English, and adds none", async () => {
    const cat = await catalogue(code), bad: string[] = [];
    for (const [k, e] of Object.entries(cat)) {
      const variants = typeof e === "string" ? [["", e]] : Object.entries(e);
      for (const [cat2, text] of variants) {
        const want = holes(k), got = holes(text ?? "");
        // The singular of a count may say "one" in words and leave {n} out; any other placeholder must stay.
        const ok = cat2 === "one" && found.keys.get(k)?.plural ? JSON.stringify(got.filter((h) => h !== "n")) === JSON.stringify(want.filter((h) => h !== "n")) : JSON.stringify(got) === JSON.stringify(want);
        if (!ok) bad.push(`${k} [${cat2 || "text"}]: ${JSON.stringify(want)} -> ${JSON.stringify(got)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("has a plural form for every count the language tells apart, and only a count has them", async () => {
    const cat = await catalogue(code), need = categories(code), bad: string[] = [];
    for (const [k, e] of Object.entries(cat)) {
      const count = !!found.keys.get(k)?.plural;
      if (!count) { if (typeof e !== "string") bad.push(`${k}: not a count, so one text`); continue; }
      if (typeof e === "string") { if (need.size > 1) bad.push(`${k}: ${code} needs ${[...need].join("/")}`); continue; }
      for (const c of need) if (!e[c]) bad.push(`${k}: no "${c}"`);
      for (const c of Object.keys(e)) if (!need.has(c as Intl.LDMLPluralRule) && c !== "other") bad.push(`${k}: "${c}" is never used by ${code}`);
    }
    expect(bad).toEqual([]);
  });

  it("has no empty text, and no text equal to its English unless the word is the same", async () => {
    const cat = await catalogue(code), bad: string[] = [];
    const texts = (e: Entry) => (typeof e === "string" ? [e] : Object.values(e));
    for (const [k, e] of Object.entries(cat)) {
      for (const text of texts(e)) {
        if (!text || !text.trim()) bad.push(`${k}: empty`);
        else if (typeof e === "string" && text === k && /[A-Za-z]{3,}/.test(k.replace(/\{\w+\}/g, "")) && !NAMES.includes(k) && !SAME[code]?.includes(k)) bad.push(`${k}: not translated`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** The text a template shows without a `t()` is a raw string: comment-free source, template by template. */
function rawInTemplates(): string[] {
  const out: string[] = [];
  for (const file of TEMPLATE_FILES) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (ts.isTaggedTemplateExpression(n) && n.tag.getText(sf) === "html") {
        const tpl = n.template, line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        const parts = ts.isNoSubstitutionTemplateLiteral(tpl) ? [tpl.text] : [tpl.head.text, ...tpl.templateSpans.map((s) => s.literal.text)];
        const joined = parts.join("\u0000");
        for (const text of joined.replace(/<[^<>]*>/g, "\u0001").split("\u0001")) if (/[A-Za-z]{2,}/.test(text.replace(/\u0000/g, ""))) out.push(`${file}:${line}: text "${text.trim()}"`);
        for (const m of joined.matchAll(/\b(aria-label|title|placeholder|label|alt)="([^"\u0000]*[A-Za-z][^"\u0000]*)"/g)) out.push(`${file}:${line}: ${m[1]}="${m[2]}"`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** String literals given to a label, title or placeholder in code: `{ label: "View" }`, `this.label = "More"`. */
function rawLabels(): string[] {
  const out: string[] = [];
  const NAMES = new Set(["label", "title", "placeholder"]);
  for (const file of files.filter((f) => f.startsWith("src/card/"))) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const isText = (n: ts.Node) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /[A-Za-z]{2,}/.test(n.text);
    const visit = (n: ts.Node) => {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      if (ts.isPropertyAssignment(n) && NAMES.has(n.name.getText(sf)) && isText(n.initializer)) out.push(`${file}:${line}: ${n.getText(sf).slice(0, 70)}`);
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && NAMES.has(n.left.name.text) && isText(n.right)) out.push(`${file}:${line}: ${n.getText(sf).slice(0, 70)}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe("raw English in the card", () => {
  it("no template prints a word, or sets an aria-label, title or placeholder, outside t()", () => expect(rawInTemplates()).toEqual([]));
  it("no label, title or placeholder in code is a raw string", () => expect(rawLabels()).toEqual([]));
  it("the lint sees a raw string (it fails on one)", () => {
    // A guard on the guard: the same regexes over a template that has a raw word and a raw attribute.
    const joined = "<button aria-label=\"Close\">Close</button><p>${x}</p>".replace(/\$\{x\}/, "\u0000");
    const text = joined.replace(/<[^<>]*>/g, "\u0001").split("\u0001").filter((s) => /[A-Za-z]{2,}/.test(s.replace(/\u0000/g, "")));
    expect(text).toEqual(["Close"]);
    expect([...joined.matchAll(/\b(aria-label)="([^"\u0000]*[A-Za-z][^"\u0000]*)"/g)]).toHaveLength(1);
  });
});

/** S38.8: render.ts is shared with the Studio and takes no `t`, but the card's device `<title>` is translated through `tr`. So no
 *  literal word may sit in a title template: the type name comes from `typeName`, a name from the layout. Units and separators ("W", " + ") are not words. */
function rawInRenderTitles(src: string, file = "src/core/render.ts"): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node) => {
    if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const parts = ts.isNoSubstitutionTemplateLiteral(n) ? [n.text] : [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const isTitleConst = ts.isVariableDeclaration(n.parent) && n.parent.name.getText(sf) === "title";
      for (const p of parts) {
        if (/<title>[^<]*[A-Za-z]{2,}/.test(p)) out.push(`${file}:${line}: <title> holds a literal word: ${p.slice(0, 60)}`);
        if (isTitleConst && /[A-Za-z]{2,}/.test(p)) out.push(`${file}:${line}: title holds a literal word: ${p.slice(0, 60)}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("raw English in render.ts titles", () => {
  it("no device or door title holds a literal word", () => expect(rawInRenderTitles(readFileSync("src/core/render.ts", "utf8"))).toEqual([]));
  it("the lint sees a raw word (it fails on one)", () => {
    expect(rawInRenderTitles("const a = `<title>Door: ${x}</title>`;")).toHaveLength(1);
    expect(rawInRenderTitles("const title = `Light: ${x}`;")).toHaveLength(1);
    expect(rawInRenderTitles("const title = `${x}: ${y}, 5 W + ${z}`;")).toEqual([]);
  });
  it("every device type has a label the catalogue holds (an enumeration is a list of decisions, finding 17)", async () => {
    for (const code of Object.keys(LANGUAGES)) {
      const cat = await catalogue(code);
      for (const label of Object.values(DEVICE_TYPE_LABELS)) expect(Object.hasOwn(cat, label), `${code}: ${label}`).toBe(true);
    }
  });
});
