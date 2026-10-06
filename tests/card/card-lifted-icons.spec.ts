import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 2.5D: a high mount (the kitchen light, demo device 1 at 650,200, z 250) is drawn where it hangs; the pin and the stem
// stay on the floor. A real mouse must reach the lifted icon (finding 3) and not the pin. Every click is page.mouse at
// coordinates read back from the rendered elements.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);

async function open(page: Page, config: Record<string, unknown>) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    (window as unknown as { __calls: unknown[] }).__calls = [];
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: (...a: unknown[]) => (window as unknown as { __calls: unknown[] }).__calls.push(a) };
    return el.updateComplete;
  }, [config, { "light.demo_kitchen": { state: "off", attributes: {}, last_changed: new Date().toISOString() } }] as const);
}
const centre = async (loc: ReturnType<typeof card>) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test.describe("2.5D lifted device icons", () => {
  test.use({ viewport: { width: 700, height: 900 } });

  for (const rotation of [0, 90, 180, 270]) for (const tilt of [0.25, 0.5, 1]) {
    test(`rotation ${rotation}, tilt ${tilt}: a click on the lifted icon opens its popup (button: one call) and picks no room, a click on the pin does nothing`, async ({ page }) => {
      await open(page, { layout: structuredClone(demo), view: "2.5d", tilt, rotation });
      const icon = card(page).locator('css=g[data-x="1"]'), pin = card(page).locator('css=circle.stem-top[cx="650"][cy="200"]');
      await expect(pin).toHaveCount(1);
      const i = await centre(icon), p = await centre(pin);
      // The icon really is drawn away from its floor point, by more than a disc's radius.
      expect(Math.hypot(i.x - p.x, i.y - p.y)).toBeGreaterThan(30);
      // The element under the mouse at the icon is the icon group itself (the real top element).
      expect(await page.evaluate(([x, y]) => (document.querySelector("floorplan-studio-card")!.shadowRoot!.elementFromPoint(x!, y!) as Element).closest("g[data-x]")?.getAttribute("data-x"), [i.x, i.y])).toBe("1");
      // The icon is the tap target: it toggles and never picks a room. It goes first, because a tap on the pin point may pick
      // the room under it (a room's name can lie there) and the room panel then covers the icon.
      await page.mouse.click(i.x, i.y);
      expect(await calls(page)).toEqual([]);
      await card(page).locator("css=.fp-pop-do").click();
      expect(await calls(page)).toEqual([["light", "turn_on", { entity_id: "light.demo_kitchen" }]]);
      expect(await card(page).locator("svg polygon.room-picked").count()).toBe(0);
      // The pin point itself holds nothing to toggle.
      await page.mouse.click(p.x, p.y);
      expect(await calls(page)).toEqual([["light", "turn_on", { entity_id: "light.demo_kitchen" }]]);
    });
  }
});
