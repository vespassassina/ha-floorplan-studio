import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS } from "../../src/core/render";

// S1.53 Opus review, finding 3 & 4: the nested `<g data-theme="...">` path (render.ts's RenderOpts.theme, the
// only new core API of S1.53) had no computed-style test — the old test matched FLOORPLAN_CSS as text, which
// cannot see specificity or inheritance. This drives FLOORPLAN_CSS in a real Chromium page, independent of the
// editor, and reads getComputedStyle, never the CSS string.

const DARK = { bg: "rgb(17, 28, 43)", wall: "rgb(232, 230, 224)" };
const LIGHT = { bg: "rgb(244, 240, 230)", wall: "rgb(43, 42, 39)" };

/** A bare page with FLOORPLAN_CSS and a `.fp` root carrying an un-themed line, a nested light `<g>` and a nested dark `<g>`. */
const PAGE = `<!DOCTYPE html><html><body>
<style>${FLOORPLAN_CSS}.bg{background:var(--fp-bg)}</style>
<div class="fp">
  <div class="bg" id="outerBg"></div>
  <svg><line class="e" id="outerWall" x1="0" y1="0" x2="1" y2="1"/>
    <g data-theme="light"><line class="e" id="lightWall" x1="0" y1="0" x2="1" y2="1"/></g>
    <g data-theme="dark"><line class="e" id="darkWall" x1="0" y1="0" x2="1" y2="1"/></g>
  </svg>
  <div class="bg" id="lightBg" data-theme="light"></div>
  <div class="bg" id="darkBg" data-theme="dark"></div>
</div>
</body></html>`;

test("S1.53 Opus review: a nested [data-theme=\"light\"] takes the light background and wall colour under an emulated dark scheme, and dark-in-light still works", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setContent(PAGE);
  const stroke = (id: string) => page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).stroke);
  const bg = (id: string) => page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).backgroundColor);

  // Auto (no explicit data-theme anywhere) follows the OS: the whole .fp root is dark.
  expect(await stroke("outerWall")).toBe(DARK.wall);
  expect(await bg("outerBg")).toBe(DARK.bg);
  // The nested light override wins over the inherited-dark ancestor (this is the bug: without a
  // [data-theme="light"] rule these would read DARK, because custom properties simply inherit).
  expect(await stroke("lightWall")).toBe(LIGHT.wall);
  expect(await bg("lightBg")).toBe(LIGHT.bg);
  // The nested dark override still works too (already covered before this fix, kept as the control).
  expect(await stroke("darkWall")).toBe(DARK.wall);
  expect(await bg("darkBg")).toBe(DARK.bg);

  await page.emulateMedia({ colorScheme: "light" });
  await page.setContent(PAGE); // dark-in-light: the reverse case
  expect(await stroke("outerWall")).toBe(LIGHT.wall);
  expect(await bg("outerBg")).toBe(LIGHT.bg);
  expect(await stroke("darkWall")).toBe(DARK.wall);
  expect(await bg("darkBg")).toBe(DARK.bg);
  expect(await stroke("lightWall")).toBe(LIGHT.wall);
  expect(await bg("lightBg")).toBe(LIGHT.bg);
});
