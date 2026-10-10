import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S27.5 computed-style pair on the card (finding 10: a rule asserted as a string proves nothing). The card passes no ghost until S27.13,
// so the markup renderFloor writes (pinned in tests/core/render-ghost.test.ts) is placed by hand, last, on top.
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
test("S27.5 CSS pair: the ghost floor is thin, unfilled, in --fp-ghost, and takes no click (card)", async ({ page }) => {
  await boot(page);
  const probe = () => page.locator("floorplan-studio-card svg").first().evaluate((svg) => {
    svg.querySelector("g.ghost-probe")?.remove();
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "ghost ghost-probe");
    g.innerHTML = '<path class="gl" d="M0 0L1000 0L1000 1000L0 1000Z"/>';
    svg.append(g);
    const p = g.querySelector("path")!, cs = getComputedStyle(p), r = p.getBoundingClientRect();
    const hit = (svg.getRootNode() as ShadowRoot).elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { stroke: cs.stroke, fill: cs.fill, width: cs.strokeWidth, events: cs.pointerEvents, ghostHit: !!hit?.closest("g.ghost") };
  });
  const a = await probe();
  expect(a).toMatchObject({ fill: "none", width: "1.5px", events: "none", ghostHit: false });
  expect(a.stroke).not.toBe("none");
  await page.locator("floorplan-studio-card").evaluate((el) => el.setAttribute("data-theme", "light"));
  const b = await probe();
  expect(b.stroke).not.toBe(a.stroke); // blueprint (default) and light mix their own wall into their own bg
});
