// Spec criterion 9 (docs/specs/real-3d.md): the 3D view costs a user of the 2D card at most 5 KB, and the lazy chunk stays under 200 KB gzipped.
// It reads the files the Playwright globalSetup has just built (dist/), so it measures what ships. No browser is used.
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** gzip -9 of dist/floorplan-studio-card.js built from the commit before the 3D work (36b22c4, the 0.13.x card), 2026-10-05. */
const PRE_3D_CARD = 90780;
const CARD_GROWTH_LIMIT = 24220; // card file ≤ 115,000 gz (Diego, 2026-10-06)
const CHUNK_LIMIT = 233000; // Diego, 2026-10-06
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

test("the 3D chunk is at most 200 KB gzipped, and it is the only chunk", () => {
  const chunks = readdirSync("dist").filter((f) => /^floorplan-studio-3d-.*\.js$/.test(f));
  expect(chunks).toHaveLength(1);
  const size = gz(`dist/${chunks[0]}`);
  expect(size, `chunk is ${size} gzip`).toBeLessThanOrEqual(CHUNK_LIMIT);
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
