// Spec criterion 9 (docs/specs/real-3d.md): the 3D view costs a user of the 2D card at most 5 KB, and the lazy chunk stays under 200 KB gzipped.
// It reads the files the Playwright globalSetup has just built (dist/), so it measures what ships. No browser is used.
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";

/** gzip -9 of dist/floorplan-studio-card.js built from the commit before the 3D work (36b22c4, the 0.13.x card), 2026-10-05. */
const PRE_3D_CARD = 90780;
const CARD_GROWTH_LIMIT = 33870; // card file ≤ 124,650 gz (+550 for the leader search, S23.F1, 2026-10-21, Diego to confirm; 124,100 was +300 for task/card-gaps, 2026-10-21, Diego to confirm; 123,800 was +800 for the card's load, merged with the camera thumbnail, 2026-10-21, Diego to confirm; S16.3 camera thumbnail, 2026-10-21, docs/DECISIONS.md; was 121,000, Diego, 2026-10-17; Sprint 34 favourites and heat map, Sprint 35 car)
const CHUNK_LIMIT = 233000; // Diego, 2026-10-06
const LANG_CHUNK_LIMIT = 5000; // S37.5: one language of the card's own words, gzip; about 3.1-3.5 KB each when written, with room for the strings that follow
/** The size `gzip -9` gives, the figure this budget is written in (node's zlib at level 9 differs by about 0.3 percent). */
const gz = (file: string) => execFileSync("gzip", ["-9", "-c"], { input: readFileSync(file), maxBuffer: 1 << 26 }).length;

test("the card file grew by at most 5 KB gzipped over the card before 3D", () => {
  const size = gz("dist/floorplan-studio-card.js");
  expect(size, `card is ${size} gzip, ${size - PRE_3D_CARD} over the pre-3D ${PRE_3D_CARD}`).toBeLessThanOrEqual(PRE_3D_CARD + CARD_GROWTH_LIMIT);
});

// Opus review of Sprint 23, M2: the comments inside the card's stylesheets do not ship (scripts/strip-css-comments.mjs), the rules do.
test("the built card carries the stylesheets' rules but not their comments", () => {
  const src = readFileSync("dist/floorplan-studio-card.js", "utf8");
  // One comment each from FLOORPLAN_CSS (render.ts), the card's own css`` and the popup's css``.
  for (const comment of ["S23.1: one label style", "S8.2: height 100% on both", "S14.2: the tap popup and the hover tooltip"]) expect(src, comment).not.toContain(comment);
  for (const rule of [".lbl-on{pointer-events:none}", "@keyframes fp-motion-pulse", ".fp-pop-confirm"]) expect(src, rule).toContain(rule);
});

// S24.4 (S23.F5): the code's JSDoc and line comments do not ship either. Lib mode leaves them in; the build strips them
// (scripts/minify-output.mjs). A block comment left in a shipped file is a licence, which must stay.
test("the shipped card, panel and 3D chunk carry no code comments, only licences", () => {
  for (const f of readdirSync("dist").filter((n) => n.endsWith(".js"))) {
    const src = readFileSync(`dist/${f}`, "utf8");
    // Sentences from a JSDoc in the card (floorplan-studio-card.ts) and in the config editor (config-editor.ts).
    for (const sentence of ["Pan and zoom come in bursts", "the kiosk opt-in"]) expect(src, `${f}: ${sentence}`).not.toContain(sentence);
    // Parsed, not grepped: a template such as `accept="image/*"` holds a /* that is no comment.
    for (const c of comments(src)) expect(c.slice(0, 120), f).toMatch(/@license|@preserve|^\/\*!|^\/\/!/);
  }
});

/** Every comment in `src`, read from the leading and trailing comment ranges of each node of its syntax tree. */
function comments(src: string): string[] {
  const sf = ts.createSourceFile("x.js", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const at = new Map<number, string>();
  const add = (rs: ts.CommentRange[] | undefined) => rs?.forEach((r) => at.set(r.pos, src.slice(r.pos, r.end)));
  const visit = (n: ts.Node) => {
    add(ts.getLeadingCommentRanges(src, n.pos));
    add(ts.getTrailingCommentRanges(src, n.end));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...at.values()];
}

test("the 3D chunk is at most 200 KB gzipped, and it is the only 3D chunk", () => {
  const chunks = readdirSync("dist").filter((f) => /^floorplan-studio-3d-.*\.js$/.test(f));
  expect(chunks).toHaveLength(1);
  const size = gz(`dist/${chunks[0]}`);
  expect(size, `chunk is ${size} gzip`).toBeLessThanOrEqual(CHUNK_LIMIT);
});

// S36 review nit 1: the chunk gets the card's helpers through `DEPS_3D`, never by import. A value import from the card file
// would make the chunk load the card a second time, and the "only chunk" test above would not notice.
test("the 3D chunk imports nothing from the card", () => {
  const chunk = readdirSync("dist").find((f) => /^floorplan-studio-3d-.*\.js$/.test(f));
  const src = readFileSync(`dist/${chunk}`, "utf8");
  expect(src).not.toMatch(/\bfrom\s*["'][^"']*floorplan-studio-card/);
  expect(src).not.toMatch(/\bimport\s*\(\s*["'][^"']*floorplan-studio-card/);
});

test("the card file imports no three.js and no scene or live builder (they belong to the chunk)", () => {
  const src = readFileSync("dist/floorplan-studio-card.js", "utf8");
  expect(src).not.toContain("WebGLRenderer");
  expect(src).not.toContain("PerspectiveCamera");
  // Words only scene-build.ts (the shape of a solid, a sunken stair) and live-build.ts (a motion edge's pulse age) write.
  for (const word of ["\"prism\"", "stair-down", "pulseAge"]) expect(src, word).not.toContain(word);
});

// S12 review N6: the test hook `__fp3d` is a compile-time flag. The shipped build (dist/, www/) must not carry it; the Playwright
// specs that drive it run against dist-test/, a second card build made only when FP_TEST_BUILD=1 (scripts/build.mjs).
test("the shipped 3D chunk and card carry no test hook", () => {
  for (const f of readdirSync("dist").filter((n) => n.endsWith(".js"))) {
    const src = readFileSync(`dist/${f}`, "utf8");
    expect(src, f).not.toContain("__fp3d");
    expect(src, f).not.toContain("__FP3D_TEST__");
  }
});

test("the test build does carry it (so the grep above can fail)", () => {
  const chunk = readdirSync("dist-test").find((n) => /^floorplan-studio-3d-.*\.js$/.test(n));
  expect(chunk).toBeTruthy();
  expect(readFileSync(`dist-test/${chunk}`, "utf8")).toContain("__fp3d");
});

// S37.5: each language of the card's own words is a chunk of its own (floorplan-studio-lang-<code>-<hash>.js), loaded by import()
// for `hass.language`. A user who reads English downloads none of them.
const LANG_CODES = ["it", "es", "pt", "pt-BR", "fr", "de", "nl", "zh-Hans", "pl"];
const langChunks = () => readdirSync("dist").filter((f) => /^floorplan-studio-lang-.+-.+\.js$/.test(f));
// The hash may itself hold a "-" (lang-de-dK--_IPn.js), so the code is read from the front, not trimmed from the back.
const codeOf = (f: string) => f.match(/^floorplan-studio-lang-(pt-BR|zh-Hans|[a-z]{2})-/)?.[1] ?? f;

test("there is one language chunk for each language the card speaks, and no other", () => {
  expect(langChunks().map(codeOf).sort()).toEqual([...LANG_CODES].sort());
});

test(`each language chunk is at most ${LANG_CHUNK_LIMIT} bytes gzipped`, () => {
  for (const f of langChunks()) {
    const size = gz(`dist/${f}`);
    expect(size, `${f} is ${size} gzip`).toBeLessThanOrEqual(LANG_CHUNK_LIMIT);
  }
});

test("the card does not carry the language chunks: a word of each is only in its own file, and the card asks for it by import()", () => {
  const card = readFileSync("dist/floorplan-studio-card.js", "utf8");
  // One word of each language that the card's English does not hold. A card that has it has inlined a catalogue.
  // The build writes every non-ASCII character of a string as \\uXXXX, so the Chinese word is looked for in that form.
  const esc = (s: string) => s.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
  const word: Record<string, string> = { it: "Annulla", es: "Cancelar", pt: "Cancelar", "pt-BR": "Cancelar", fr: "Annuler", de: "Abbrechen", nl: "Annuleren", "zh-Hans": esc("取消"), pl: "Anuluj" };
  for (const f of langChunks()) expect(readFileSync(`dist/${f}`, "utf8"), `${f} holds its Cancel`).toContain(word[codeOf(f)]!);
  for (const w of ["Annulla", "Annuler", "Abbrechen", "Annuleren", esc("取消"), "Anuluj"]) expect(card, `the card holds ${w}`).not.toContain(w);
  for (const code of LANG_CODES) expect(card, code).toMatch(new RegExp(`import\\(["']\\./floorplan-studio-lang-${code}-[^"']+\\.js["']\\)`));
});

test("a language chunk imports nothing: it is data", () => {
  for (const f of langChunks()) expect(readFileSync(`dist/${f}`, "utf8"), f).not.toMatch(/\bfrom\s*["'][^"']+["']|\bimport\s*\(/);
});

// S38.0 (docs/DECISIONS.md, 2026-10-27): the Edit-card form is a chunk of its own (floorplan-studio-form-<hash>.js), fetched by import()
// from getConfigElement(). Home Assistant loads the form only when someone edits the card, so no viewer pays for it in the card file.
const FORM_CHUNK_LIMIT = 26000; // gzip; 24.8 KB when written (the form is a bundle of its own: it carries its copy of lit and of the validator), with room for the fields that follow
const formChunks = () => readdirSync("dist").filter((f) => /^floorplan-studio-form-.+\.js$/.test(f));

test("the card file does not hold the Edit-card form: its element name and a label of its markup are only in the form chunk", () => {
  const card = readFileSync("dist/floorplan-studio-card.js", "utf8");
  // The card names the tag once, to create the element after the import. It does not define it: the definition (the class, its
  // markup and the define call) is the form's.
  expect(card.split("floorplan-studio-card-editor")).toHaveLength(2);
  expect(card).toContain('createElement("floorplan-studio-card-editor")');
  expect(card).not.toContain("Switcher shows"); // a label only the form draws
  expect(card).not.toContain("config-changed"); // the event only the form fires
  expect(formChunks()).toHaveLength(1);
  const form = readFileSync(`dist/${formChunks()[0]}`, "utf8");
  expect(form).toContain("floorplan-studio-card-editor");
  expect(form).toContain("Switcher shows");
  // Named by a relative path, so it loads from /hacsfiles/... or /floorplan_studio_static/... as the language chunks do. It is a file of its
  // own, not a rollup chunk of the card (that would import the card's code back from a hoisted third file).
  expect(card).toMatch(/"\.\/floorplan-studio-form-[\w-]+\.js"/);
  expect(form).not.toMatch(/\bfrom\s*["'][^"']*floorplan-studio-(card|3d)/);
});

test(`the form chunk is at most ${FORM_CHUNK_LIMIT} bytes gzipped, and it is not counted as the 3D chunk`, () => {
  const [f] = formChunks();
  expect(f, "there is a form chunk").toBeTruthy();
  const size = gz(`dist/${f}`);
  expect(size, `${f} is ${size} gzip`).toBeLessThanOrEqual(FORM_CHUNK_LIMIT);
  expect(readdirSync("dist").filter((n) => /^floorplan-studio-3d-.*\.js$/.test(n))).toHaveLength(1);
});

// S39.2: the history parser is a lazy chunk (src/card/replay/history.ts), loaded the first time Replay opens. Nobody who never opens it pays for it.
const REPLAY_CHUNK_LIMIT = 6000; // gzip; 728 when written, 1,455 before replay 2 (docs/specs/replay-2.md item 21 raises it for the events, the filters and the request)
const replayChunks = () => readdirSync("dist").filter((f) => /^floorplan-studio-replay-.+\.js$/.test(f));

test(`there is exactly one replay chunk, it is at most ${REPLAY_CHUNK_LIMIT} bytes gzipped, and the card names it by import() only`, () => {
  expect(replayChunks()).toHaveLength(1);
  const [f] = replayChunks();
  const size = gz(`dist/${f}`);
  expect(size, `${f} is ${size} gzip`).toBeLessThanOrEqual(REPLAY_CHUNK_LIMIT);
  const chunk = readFileSync(`dist/${f}`, "utf8");
  expect(chunk, "the parser lives in the chunk").toContain("history/history_during_period");
  expect(chunk).not.toMatch(/\bfrom\s*["'][^"']*floorplan-studio-(card|3d)/);
  expect(readFileSync("dist/floorplan-studio-card.js", "utf8")).toMatch(/"\.\/floorplan-studio-replay-[\w-]+\.js"/);
});

test("the card file does not carry the parser: REPLAY_CHUNK's marker and the history command are only in the chunk", () => {
  const card = readFileSync("dist/floorplan-studio-card.js", "utf8");
  expect(card).not.toContain("fp-replay-v1");
  expect(card).not.toContain("history/history_during_period");
  expect(readFileSync(`dist/${replayChunks()[0]}`, "utf8")).toContain("fp-replay-v1"); // so the two checks above can fail
});

// S41.0 (docs/DECISIONS.md, 2026-10-30): Vite's default build target ("modules", with chrome87 and edge88) makes esbuild print every `a?.b` as
// `a==null?void 0:a.b`, which cost the card 2.8 KB gzipped. The build now names its own target (vite.config.ts, BUILD_TARGET). Lit and three ship
// `?.` as written, so a match in any shipped file is our target slipping back, not a dependency. `===null?void 0` is a different thing (our own
// "null becomes undefined") and is left alone: the lookbehind keeps it out.
test("no shipped file carries optional chaining printed out as `==null?void 0`", () => {
  const files = [...readdirSync("dist").filter((n) => n.endsWith(".js") || n === "editor.html")];
  expect(files.length, "the build produced files").toBeGreaterThan(10);
  for (const f of files) {
    const hits = readFileSync(`dist/${f}`, "utf8").match(/(?<![=!])==null\?void 0/g) ?? [];
    expect(hits.length, `${f} holds ${hits.length} downlevelled optional chains; build.target is too old for \`?.\` (vite.config.ts)`).toBe(0);
  }
});
