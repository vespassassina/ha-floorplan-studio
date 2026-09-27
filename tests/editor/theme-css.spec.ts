import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// S1.53 Opus review, finding 3 & 4: the nested `<g data-theme="...">` path (render.ts's RenderOpts.theme, the
// only new core API of S1.53) had no computed-style test — the old test matched FLOORPLAN_CSS as text, which
// cannot see specificity or inheritance. This drives FLOORPLAN_CSS in a real Chromium page, independent of the
// editor, and reads getComputedStyle, never the CSS string.

const DARK = { bg: "rgb(12, 21, 33)", wall: "rgb(99, 148, 221)" }; // blueprint (role-generated, 2026-09-22): --fp-bg #0c1521, --fp-wall #6394dd
const MIDNIGHT = { bg: "rgb(13, 21, 34)", wall: "rgb(143, 180, 240)" }; // midnight (ex-blueprint): --fp-bg #0d1522, --fp-wall #8fb4f0
const LIGHT = { bg: "rgb(244, 240, 230)", wall: "rgb(43, 42, 39)" };

/** A bare page with FLOORPLAN_CSS and a `.fp` root carrying an un-themed line and one nested `<g>` or `<div>` per theme. */
const PAGE = `<!DOCTYPE html><html><body>
<style>${FLOORPLAN_CSS}.bg{background:var(--fp-bg)}</style>
<div class="fp">
  <div class="bg" id="outerBg"></div>
  <svg><line class="e" id="outerWall" x1="0" y1="0" x2="1" y2="1"/>
    <g data-theme="light"><line class="e" id="lightWall" x1="0" y1="0" x2="1" y2="1"/></g>
    <g data-theme="blueprint"><line class="e" id="bpWall" x1="0" y1="0" x2="1" y2="1"/></g>
    <g data-theme="midnight"><line class="e" id="midnightWall" x1="0" y1="0" x2="1" y2="1"/></g>
    <g data-theme="ha"><line class="e" id="haWall" x1="0" y1="0" x2="1" y2="1"/></g>
    <g data-theme="ha" data-mode="dark"><line class="e" id="haDarkWall" x1="0" y1="0" x2="1" y2="1"/></g>
  </svg>
  <div class="bg" id="lightBg" data-theme="light"></div>
  <div class="bg" id="bpBg" data-theme="blueprint"></div>
  <div class="bg" id="midnightBg" data-theme="midnight"></div>
  <div class="bg" id="haBg" data-theme="ha"></div>
</div>
</body></html>`;

const stroke = (page: import("@playwright/test").Page, id: string) => page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).stroke);
const bg = (page: import("@playwright/test").Page, id: string) => page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).backgroundColor);

test("S2.12: with no data-theme the plan is blueprint, and a nested light or blueprint group wins over whatever it sits in, under either OS scheme", async ({ page }) => {
  for (const os of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: os });
    await page.setContent(PAGE);
    expect(await stroke(page, "outerWall"), os).toBe(DARK.wall);
    expect(await bg(page, "outerBg"), os).toBe(DARK.bg);
    expect(await stroke(page, "lightWall"), os).toBe(LIGHT.wall);
    expect(await bg(page, "lightBg"), os).toBe(LIGHT.bg);
    expect(await stroke(page, "bpWall"), os).toBe(DARK.wall);
    expect(await bg(page, "bpBg"), os).toBe(DARK.bg);
    expect(await stroke(page, "midnightWall"), os).toBe(MIDNIGHT.wall);
    expect(await bg(page, "midnightBg"), os).toBe(MIDNIGHT.bg);
  }
});

test("S2.12: theme ha reads Home Assistant's variables, falls back to plain light or dark without them, and leaves meaning colours alone", async ({ page }) => {
  await page.setContent(PAGE);
  // No HA variables: light fallback, and the dark mode fallback for data-mode="dark".
  expect(await stroke(page, "haWall")).toBe(LIGHT.wall);
  expect(await bg(page, "haBg")).toBe(LIGHT.bg);
  expect(await stroke(page, "haDarkWall")).not.toBe(LIGHT.wall);
  // With HA variables on an ancestor (as HA sets them on the document), they are what the plan draws with.
  await page.evaluate(() => {
    const r = document.documentElement.style;
    r.setProperty("--primary-text-color", "rgb(10, 20, 30)");
    r.setProperty("--card-background-color", "rgb(40, 50, 60)");
  });
  expect(await stroke(page, "haWall")).toBe("rgb(10, 20, 30)");
  expect(await bg(page, "haBg")).toBe("rgb(40, 50, 60)");
  expect(await stroke(page, "haDarkWall")).toBe("rgb(10, 20, 30)");
  // The other themes ignore them.
  expect(await stroke(page, "bpWall")).toBe(DARK.wall);
  expect(await bg(page, "lightBg")).toBe(LIGHT.bg);
});

// S9.3 Opus review CSS pair: a TV is blue when on, in every theme, including the role-generated single-accent ones
// (blueprint, slate, terminal) where every other device type collapses to the theme's one accent colour. Reads the
// real computed --fp-dev-tv in Chromium, in every member of THEMES (render.test.ts's own S4.21/S9.3 findings warn
// that an enumeration left untested silently falls through — CLAUDE.md finding 17), not just a text match on
// FLOORPLAN_CSS (finding 10).
const TV_BLUE = "#2c7fb8";
const SOLARIZED_BLUE = "#268bd2"; // Solarized's own blue

test("S9.3 Opus review CSS pair: --fp-dev-tv is a fixed blue in every theme, not the theme's accent", async ({ page }) => {
  const page_ = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map(
    (t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}"><line/></g>`,
  ).join("")}</svg></body></html>`;
  await page.setContent(page_);
  for (const t of THEMES) {
    const tv = await page.locator(`#t-${t}`).evaluate((el) => getComputedStyle(el).getPropertyValue("--fp-dev-tv").trim());
    expect(tv, t).toBe(t === "solarized" ? SOLARIZED_BLUE : TV_BLUE);
    if (t !== "solarized") {
      const accent = await page.locator(`#t-${t}`).evaluate((el) => getComputedStyle(el).getPropertyValue("--fp-on").trim());
      expect(tv, `${t}: tv must not collapse to the theme accent`).not.toBe(accent);
    }
  }
});

// S9.1 integration: Diego's brief is "dashed and red when open". The role-generated themes (blueprint, the default,
// slate, terminal) collapse the contact colour to their one accent, so an open door there fell back to orange or
// green. --fp-open-door is a fixed red in every theme instead: Solarized's own red, the light theme's red elsewhere.
test("S9.1 Opus review CSS pair: --fp-open-door is red in every theme, never the theme's accent", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map(
    (t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}"><line/></g>`,
  ).join("")}</svg></body></html>`);
  for (const t of THEMES) {
    const door = await page.locator(`#t-${t}`).evaluate((el) => getComputedStyle(el).getPropertyValue("--fp-open-door").trim());
    expect(door, t).toBe(t === "solarized" ? "#dc322f" : "#d64545");
  }
});
