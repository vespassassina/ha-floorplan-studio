import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// G23: axe-core over the card and the Studio in the states a person reaches, light and dark. Scoped to our elements:
// the harness page has no title, lang or main, which the Home Assistant page around the real card supplies.
// Before the fixes this found: hover grey under light text (2.9:1), two buttons whose name left out their visible
// text, and the Save shortcut hint at 3.9:1. Not covered by axe: keyboard order, focus return, screen reader speech.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = () => ({ "light.demo_living": st("on", { friendly_name: "Living light" }), "switch.demo_hall": st("off"), "sensor.demo_living_temperature": st("21", { unit_of_measurement: "°C" }), "camera.demo_hall": st("idle") });

const expectClean = async (page: Page, root: string, state: string) => { expect(await scan(page, root), state).toEqual([]); };
const scan = async (page: Page, root: string) => {
  const r = await new AxeBuilder({ page }).include(root).analyze();
  return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")), why: v.nodes[0]?.failureSummary?.slice(0, 200) }));
};

async function bootCard(page: Page, scheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pathToFileURL(resolve("tests/card/harness.html")).href);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const el = document.getElementById("card") as any;
    el.setConfig(config);
    el.hass = { states, callService() {} };
    return el.updateComplete;
  }, [{ layout: demo, floor: "ground" }, STATES()] as const);
}

for (const scheme of ["light", "dark"] as const) {
  test(`card is free of axe violations in ${scheme}`, async ({ page }) => {
    await bootCard(page, scheme);
    await expectClean(page, "floorplan-studio-card", `default ${scheme}`);
    const p = await page.locator("floorplan-studio-card").evaluate((el) => {
      const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!, r = poly.getBoundingClientRect();
      for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
      return null;
    });
    await page.mouse.click(p!.x, p!.y);
    await expectClean(page, "floorplan-studio-card", `room picked ${scheme}`);
    await page.locator("floorplan-studio-card .fp-room-devices .fp-active-row").first().click();
    await expect(page.locator("floorplan-studio-card .fp-pop")).toBeVisible();
    await expectClean(page, "floorplan-studio-card", `popup open ${scheme}`);
  });
}
test("studio is free of axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator("floorplan-studio-editor svg polygon[data-r]").first()).toBeVisible();
  await expectClean(page, "floorplan-studio-editor", "studio default");
  const poly = (await page.locator("floorplan-studio-editor svg polygon[data-r]").first().boundingBox())!;
  await page.mouse.click(poly.x + poly.width / 2, poly.y + poly.height / 2);
  await expectClean(page, "floorplan-studio-editor", "studio room selected");
  for (const id of await page.locator("floorplan-studio-editor details[id^=m] > summary").evaluateAll((els) => els.map((e) => (e.parentElement as HTMLElement).id))) {
    await page.locator(`floorplan-studio-editor #${id} > summary`).click();
    await expectClean(page, "floorplan-studio-editor", `studio menu ${id}`);
    await page.keyboard.press("Escape");
  }
  const c = (await page.locator("floorplan-studio-editor .canvas > svg").boundingBox())!;
  await page.mouse.click(c.x + 4, c.y + c.height - 4);
  await page.keyboard.press("?");
  await expectClean(page, "floorplan-studio-editor", "studio help");
});
