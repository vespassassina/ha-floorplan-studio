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
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const pop = (page: Page) => card(page).locator("css=.fp-pop");

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
const tapIcon = async (page: Page, i: number) => { const p = await iconPoint(page, i); await page.mouse.click(p.x, p.y); return p; };
// ground devices: 0 living light, 1 kitchen light, 2 hall switch, 3 TV plug, 4 temperature sensor, 6 camera


// Kiosk leaves More info out, and a temperature sensor has no button of its own, so a kiosk popup can have no button at all. Focus then
// stays outside it, and its own keydown never hears Escape. The card's window listener hears it only while the card owns the keys
// (pointer over it or focus in it): a wall tablet has a finger, not a pointer, so nothing closed the popup but a tap outside.
test.describe("kiosk popup: Escape closes it", () => {
  test("a popup with no button closes on Escape although the pointer has left the card", async ({ page }) => {
    await boot(page, 1100, { kiosk: true });
    await tapIcon(page, 4); // the temperature sensor: no operation, and kiosk hides More info
    await expect(pop(page)).toBeVisible();
    await expect(pop(page).locator("css=button")).toHaveCount(0);
    const box = (await card(page).boundingBox())!;
    await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40); // off the card: no hover, so no ownership by the pointer
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });

  test("with a button the popup still closes on Escape (kiosk, a light)", async ({ page }) => {
    await boot(page, 1100, { kiosk: true });
    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    await expect(pop(page).locator("css=.fp-pop-more")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);
  });
});
