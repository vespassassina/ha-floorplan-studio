import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S27.13: the card's ghost floor. `ghost_floor` in YAML and the Floor below button. Real page.mouse clicks on the real top element
// (finding 3). The first floor sits 200 cm east of the ground floor (offset), so the ground floor's ghost is drawn 200 cm to the
// left of the first floor's own outline: part of it falls where the first floor draws nothing.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const layout = structuredClone(demo);
layout.floors.first.offset = [200, 0];
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const EDITOR_URL = pathToFileURL(resolve("tests/card/config-editor-harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

async function boot(page: Page, config: Record<string, unknown> = {}, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await configure(page, config);
}
/** setConfig again on the same page: the card reads its stored view back, as a reload of the dashboard does. */
async function configure(page: Page, config: Record<string, unknown>) {
  await page.evaluate((cfg) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, { layout, floor: "first", ...config });
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const ghosts = (page: Page) => card(page).locator("css=svg g.ghost");
const button = (page: Page) => card(page).locator('css=button[aria-label="Floor below"]');

test.describe("S27.13 the card's ghost floor", () => {
  test("ghost_floor: true draws it at the floors' relative offset; false, absent and junk draw none", async ({ page }) => {
    await boot(page, { ghost_floor: true });
    await expect(ghosts(page)).toHaveCount(1);
    // the ground floor's outline starts at x 0; on the first floor's plan that is 0 + (ground.offset 0 - first.offset 200) = -200
    const box = await ghosts(page).evaluate((g) => { const b = (g as unknown as SVGGraphicsElement).getBBox(); return { x: b.x, w: b.width }; });
    expect(box.x).toBeCloseTo(-200, 0);
    expect(box.w).toBeGreaterThan(700);
    for (const v of [false, "true", 1, "yes", {}, null, []]) {
      await configure(page, { ghost_floor: v });
      await expect(ghosts(page), JSON.stringify(v)).toHaveCount(0);
    }
    await configure(page, {});
    await expect(ghosts(page)).toHaveCount(0);
  });

  test("a real click on the Floor below button toggles g.ghost; the button says which", async ({ page }) => {
    await boot(page);
    await expect(button(page)).toHaveAttribute("aria-pressed", "false");
    await button(page).click();
    await expect(ghosts(page)).toHaveCount(1);
    await expect(button(page)).toHaveAttribute("aria-pressed", "true");
    await button(page).click();
    await expect(ghosts(page)).toHaveCount(0);
    await expect(button(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("a stored viewer choice wins over YAML, both ways, and survives a reload of the card", async ({ page }) => {
    await boot(page, { ghost_floor: true });
    await button(page).click(); // off, against the YAML
    await expect(ghosts(page)).toHaveCount(0);
    await configure(page, { ghost_floor: true });
    await expect(ghosts(page)).toHaveCount(0);
    await configure(page, { ghost_floor: false });
    await button(page).click(); // on, against the YAML (another card key set: a memory of its own)
    await expect(ghosts(page)).toHaveCount(1);
    await configure(page, { ghost_floor: false });
    await expect(ghosts(page)).toHaveCount(1);
  });

  test("the lowest floor draws none, whatever the YAML says, and the button is disabled", async ({ page }) => {
    await boot(page, { ghost_floor: true, floor: "ground" });
    await expect(ghosts(page)).toHaveCount(0);
    await expect(button(page)).toBeDisabled();
  });

  test("a tap on a spot where only the ghost is drawn opens nothing", async ({ page }) => {
    await boot(page, { ghost_floor: true });
    // walk the ghost's own lines for a point that is inside the card and whose top element is the plan's bare background
    const spot = await card(page).evaluate((el) => {
      const root = el.shadowRoot!, svg = root.querySelector("svg")!, r = svg.getBoundingClientRect();
      for (const path of root.querySelectorAll<SVGPathElement>("svg g.ghost path")) {
        const m = path.getScreenCTM()!, len = path.getTotalLength();
        for (let l = 0; l <= len; l += 4) {
          const p = path.getPointAtLength(l), x = p.x * m.a + p.y * m.c + m.e, y = p.x * m.b + p.y * m.d + m.f;
          if (x > r.left + 8 && x < r.right - 8 && y > r.top + 8 && y < r.bottom - 8 && root.elementFromPoint(x, y) === svg) return { x, y };
        }
      }
      return null;
    });
    expect(spot, "the ghost has a line over bare background").not.toBeNull();
    await page.mouse.click(spot!.x, spot!.y);
    await expect(card(page).locator("css=.fp-pop, .fp-room, .fp-chooser, .fp-dialog")).toHaveCount(0);
    await expect(card(page).locator("css=svg .room-picked")).toHaveCount(0);
    await expect(card(page).locator("css=svg g.ghost")).toHaveCount(1); // and the ghost took nothing out of the plan
  });

  test("the config form offers ghost_floor: off by default and dropped from the payload, junk reads off", async ({ page }) => {
    await page.goto(EDITOR_URL);
    await page.addScriptTag({ content: CARD_JS, type: "module" });
    await page.evaluate(() => Promise.all([customElements.whenDefined("floorplan-studio-card"), customElements.whenDefined("floorplan-studio-card-editor")]));
    const mount = (config: Record<string, unknown>) => page.evaluate((config) => {
      document.getElementById("editor")?.remove();
      const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): HTMLElement };
      const el = Ctor.getConfigElement();
      (window as any).__events = [];
      el.addEventListener("config-changed", (e) => (window as any).__events.push((e as CustomEvent).detail));
      el.id = "editor";
      document.body.appendChild(el);
      (el as any).setConfig(config);
    }, config);
    const events = () => page.evaluate(() => (window as any).__events);
    await mount({ layout: demo });
    const box = page.locator("#editor input#ghost_floor");
    await expect(box).not.toBeChecked();
    await box.check();
    expect((await events()).at(-1).config.ghost_floor).toBe(true);
    await box.uncheck();
    expect("ghost_floor" in (await events()).at(-1).config).toBe(false);
    await mount({ ghost_floor: "yes", layout: demo });
    await expect(page.locator("#editor input#ghost_floor")).not.toBeChecked();
    await mount({ ghost_floor: true, layout: demo });
    await expect(page.locator("#editor input#ghost_floor")).toBeChecked();
  });
});
