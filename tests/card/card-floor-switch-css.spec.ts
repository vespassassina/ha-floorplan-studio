import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S27.6 and S27.5 computed-style pairs on the card (finding 10: a rule asserted as a string proves nothing). The card sets
// data-switch itself in S27.15; here the attribute is set by hand on the plan root, so only the stylesheet is under test.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

async function boot(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((layout) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ layout });
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, demo);
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
/** The plan's own svg, with data-switch set the way the card will (S27.15), then what the browser computed for it. */
const switched = (page: Page, dir: string | null) => page.locator("floorplan-studio-card svg").first().evaluate((svg, d) => {
  if (d) svg.setAttribute("data-switch", d); else svg.removeAttribute("data-switch");
  const cs = getComputedStyle(svg), a = svg.getAnimations().find((x) => (x as CSSAnimation).animationName?.startsWith("fp-floor-in")) as CSSAnimation | undefined;
  return { name: cs.animationName, duration: cs.animationDuration, from: a ? String((a.effect as KeyframeEffect).getKeyframes()[0].transform) : null };
}, dir);

test.describe("S27.6 CSS pair: the floor switch animation", () => {
  test("default motion: up and down each name their own keyframes, 220 ms, from 16 px the way it travels", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await boot(page);
    // Break it: remove either `[data-switch=...]` rule or its keyframes and name reads "none".
    expect(await switched(page, null)).toMatchObject({ name: "none" });
    expect(await switched(page, "up")).toEqual({ name: "fp-floor-in-up", duration: "0.22s", from: "translateY(-16px)" });
    expect(await switched(page, "down")).toEqual({ name: "fp-floor-in-down", duration: "0.22s", from: "translateY(16px)" });
  });
  test("reduced motion: no animation at all, and none is running", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);
    for (const d of ["up", "down"]) expect(await switched(page, d), d).toEqual({ name: "none", duration: "0s", from: null });
  });
});
