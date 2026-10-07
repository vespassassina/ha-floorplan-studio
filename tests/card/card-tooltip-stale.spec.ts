import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S19.E1 (kiosk popup and Escape). Same harness as card-popup.spec.ts.
// Was: S14.2 (docs/specs/card-polish-and-light.md, items 3, 4, 5, 17, 18) in the 2D plan: a tap opens a popup and operates
// nothing, its button makes the one call, OFF asks first except for a light, a slider's release is one light.turn_on,
// and a mouse hover names the icon. Every click and move is a real page.mouse event at the centre of an icon that is
// checked to be the real top element there (CLAUDE.md finding 3).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
// Home Assistant's light attributes (core light/const.py): supported_color_modes, min/max_color_temp_kelvin, brightness 0-255,
// color_temp_kelvin, hs_color [hue, saturation]. The kitchen light is a plain on/off one.
const STATES = () => ({
  "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["color_temp", "hs"], brightness: 128, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, color_temp_kelvin: 3000, hs_color: [30, 60] }),
  "light.demo_kitchen": st("on", { supported_color_modes: ["onoff"] }),
  "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "sensor.demo_living_temperature": st("21.5", { unit_of_measurement: "°C" }),
  "climate.demo_living": st("heat"), "camera.demo_hall": st("idle"),
});

async function boot(page: Page, width = 1100, extra: Record<string, unknown> = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[]; __info: string[] };
    w.__calls = []; w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    el.setConfig(config);
    // callService(domain, service, data), as Home Assistant's hass has it (src/card/popup actions are the caller)
    el.hass = { states, callService: (d: string, s: string, data: Record<string, unknown>) => { w.__calls.push(`${d}.${s} ${JSON.stringify(data)}`); } };
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", ...extra }, STATES()] as const);
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const tip = (page: Page) => card(page).locator("css=.fp-tip");

async function iconPoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-x="${i}"]`)!;
    const r = g.getBoundingClientRect();
    // a camera's box includes its view cone, so its centre can miss the icon: take the first point of a 7x7 scan that hits it
    let x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    for (let a = 1; a < 8 && !top?.closest(`g[data-x="${i}"]`); a++) for (let b = 1; b < 8 && !top?.closest(`g[data-x="${i}"]`); b++) {
      x = r.x + (r.width * a) / 8; y = r.y + (r.height * b) / 8; top = el.shadowRoot!.elementFromPoint(x, y);
    }
    return { x, y, top: top ? `${top.tagName}.${top.getAttribute("class") ?? ""}` : "none", hit: !!top?.closest(`g[data-x="${i}"]`) };
  }, i);
  expect(p.hit, `device ${i} is the top element at its centre (top: ${p.top})`).toBe(true);
  return p;
}
// ground devices: 0 living light, 1 kitchen light, 2 hall switch, 3 TV plug, 4 temperature sensor, 6 camera


// S19.E2. The tooltip names what is under the pointer. A key that turns or zooms the plan moves the icon from under a pointer that
// does not move, and no pointermove follows, so the tooltip kept naming an icon the pointer was no longer on.
test.describe("2D hover tooltip: stale", () => {
  const under = (page: Page, i: number, x: number, y: number) => card(page).evaluate((el, [i, x, y]) => !!el.shadowRoot!.elementFromPoint(x, y)?.closest(`g[data-x="${i}"]`), [i, x, y]);
  for (const key of ["+", "-"]) test(`zoom key ${key}: the icon leaves the still pointer, and the tooltip goes with it`, async ({ page }) => {
    await boot(page);
    const p = await iconPoint(page, 0);
    await page.mouse.move(p.x - 40, p.y - 40);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toBeVisible();
    await page.keyboard.press(key);
    await expect.poll(() => under(page, 0, p.x, p.y), { message: "the zoom moved the icon from under the pointer" }).toBe(false);
    await expect(tip(page)).toBeHidden();
  });

  test("a pointer that stays on its icon keeps the tooltip across a state change", async ({ page }) => {
    await boot(page);
    const p = await iconPoint(page, 0);
    await page.mouse.move(p.x - 40, p.y - 40);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toContainText("50 %");
    await card(page).evaluate((el) => { const e = el as unknown as { hass: { states: Record<string, unknown> } }; e.hass = { ...e.hass, states: { ...e.hass.states, "light.demo_living": { state: "on", attributes: { friendly_name: "Living light", supported_color_modes: ["hs"], brightness: 255 }, last_changed: "2026-10-04T09:30:15Z" } } }; });
    await expect(tip(page)).toContainText("100 %");
    await expect(tip(page)).toBeVisible();
  });
});
