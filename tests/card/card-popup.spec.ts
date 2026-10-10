import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S14.2 (docs/specs/card-polish-and-light.md, items 3, 4, 5, 17, 18) in the 2D plan: a tap opens a popup and operates
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

async function boot(page: Page, width = 1100, extra: Record<string, unknown> = {}, foldOverview = true) {
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
  // The overview floats over the plan and its height follows the font, so with a wider font it covers devices these tests tap.
  // Fold it: the tests here are about the icons and the popup, not the overview.
  if (foldOverview) await card(page).evaluate((el) => el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse[aria-expanded=true]")?.click()); // a narrow card starts folded
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const pop = (page: Page) => card(page).locator("css=.fp-pop");
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
const tapIcon = async (page: Page, i: number) => { const p = await iconPoint(page, i); await page.mouse.click(p.x, p.y); return p; };
// ground devices: 0 living light, 1 kitchen light, 2 hall switch, 3 TV plug, 4 temperature sensor, 6 camera

test.describe("2D popup", () => {
  test("a real tap opens a named dialog with the state and a 44 px button, and makes no call; focus is on the button", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    await expect(pop(page)).toHaveAttribute("role", "dialog");
    await expect(pop(page)).toHaveAttribute("aria-label", "Living light");
    await expect(pop(page).locator("css=.fp-pop-state")).toHaveText("50 %");
    const b = pop(page).locator("css=.fp-pop-do");
    await expect(b).toHaveText("Turn off");
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(pop(page).locator("css=.fp-pop-more")).toHaveText("More info");
    expect(await card(page).evaluate((el) => (el.shadowRoot!.activeElement as HTMLElement | null)?.classList.contains("fp-pop-do"))).toBe(true);
    expect(await calls(page)).toEqual([]);
    expect(await infos(page)).toEqual([]);
  });

  test("a light's button turns it off at once (no confirm) with exactly one call", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 0);
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(['light.turn_off {"entity_id":"light.demo_living"}']);
    await expect(pop(page)).toHaveCount(0);
  });

  test("a plug's OFF asks first: the button becomes Confirm turn off, Cancel makes no call, Confirm makes one", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 3);
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn off");
    await pop(page).locator("css=.fp-pop-do").click();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Confirm turn off");
    expect(await calls(page)).toEqual([]);
    await pop(page).locator("css=.fp-pop-cancel").click();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn off");
    expect(await calls(page)).toEqual([]);
    await pop(page).locator("css=.fp-pop-do").click();
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(['switch.turn_off {"entity_id":"switch.demo_tv_plug"}']);
  });

  test("a switch that is off turns ON at once, with no confirm step", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 2);
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn on");
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(['switch.turn_on {"entity_id":"switch.demo_hall"}']);
  });

  test("a camera has no operate button: name, state and More info, which opens more-info", async ({ page }) => {
    await boot(page, 1100, { active_list: false }); // the camera sits under the Active list otherwise
    await tapIcon(page, 6);
    await expect(pop(page)).toHaveAttribute("aria-label", "Hall camera");
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveCount(0);
    await pop(page).locator("css=.fp-pop-more").click();
    expect(await infos(page)).toEqual(["camera.demo_hall"]);
    expect(await calls(page)).toEqual([]);
    await expect(pop(page)).toHaveCount(0);
  });

  test("a hold opens more-info directly and no popup", async ({ page }) => {
    await boot(page);
    const p = await iconPoint(page, 0);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    expect(await infos(page)).toEqual(["light.demo_living"]);
    await expect(pop(page)).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });
});

test.describe("2D popup: closing and placement", () => {
  test("Escape closes it and focus goes back to the card", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);
    expect(await card(page).evaluate((el) => document.activeElement === el)).toBe(true);
    expect(await calls(page)).toEqual([]);
  });

  test("a tap outside closes it, a second tap on the same icon closes it, another icon moves it", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    await page.mouse.click(5, 5); // the page outside the card
    await expect(pop(page)).toHaveCount(0);

    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    await page.waitForTimeout(400); // not a double tap
    await tapIcon(page, 0);
    await expect(pop(page)).toHaveCount(0);

    await tapIcon(page, 0);
    await page.waitForTimeout(400);
    await tapIcon(page, 1);
    await expect(pop(page)).toHaveCount(1); // only one at a time
    await expect(pop(page)).toHaveAttribute("aria-label", "Kitchen light");
    expect(await calls(page)).toEqual([]);
  });

  test("the popup stays inside the card, even for an icon at the card's corner", async ({ page }) => {
    for (const width of [1100, 375]) {
      await boot(page, width, { active_list: false });
      await tapIcon(page, 6); // the camera, 20 cm from the left and 580 from the top
      await expect(pop(page)).toBeVisible();
      const c = (await card(page).boundingBox())!, b = (await pop(page).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(c.x);
      expect(b.y).toBeGreaterThanOrEqual(c.y);
      expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height + 0.5);
    }
  });

  test("an Active-list row opens the same popup and operates nothing", async ({ page }) => {
    await boot(page, 1100, {}, false); // this one uses the overview list
    const row = card(page).locator("css=.fp-active-row", { hasText: "Living light" });
    await row.click();
    await expect(pop(page)).toHaveAttribute("aria-label", "Living light");
    expect(await calls(page)).toEqual([]);
    expect(await infos(page)).toEqual([]);
  });
});

test.describe("2D popup: light controls", () => {
  test("a colour light has brightness, temperature and hue sliders; one release is exactly one light.turn_on", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 0);
    const sliders = pop(page).locator("css=input[type=range]");
    await expect(sliders).toHaveCount(3);
    const bright = pop(page).locator('css=input[aria-label="Brightness"]');
    await expect(bright).toHaveValue("50");
    const box = (await bright.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 6 });
    expect(await calls(page), "nothing is sent while dragging").toEqual([]);
    await page.mouse.up();
    const got = await calls(page);
    expect(got).toHaveLength(1);
    const m = /^light\.turn_on (.*)$/.exec(got[0]!)!;
    const data = JSON.parse(m[1]!);
    expect(data.entity_id).toBe("light.demo_living");
    expect(data.brightness_pct).toBeGreaterThan(80); // asymmetric to the 50 it started at
    expect(Object.keys(data).sort()).toEqual(["brightness_pct", "entity_id"]);
  });

  test("the temperature slider sends kelvin within the light's own range; the hue slider keeps the saturation", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 0);
    const temp = pop(page).locator('css=input[aria-label="Colour temperature"]');
    await expect(temp).toHaveAttribute("min", "2200");
    await expect(temp).toHaveAttribute("max", "6500");
    await temp.focus();
    await page.keyboard.press("End");
    const hue = pop(page).locator('css=input[aria-label="Colour"]');
    await hue.focus();
    await page.keyboard.press("End");
    const got = (await calls(page)).map((c) => JSON.parse(c.slice(c.indexOf(" ") + 1)));
    expect(got.some((d) => d.color_temp_kelvin === 6500)).toBe(true);
    expect(got.some((d) => Array.isArray(d.hs_color) && d.hs_color[0] === 360 && d.hs_color[1] === 60)).toBe(true);
  });

  test("a plain on/off light has no slider at all, and its OFF still needs no confirm", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 1);
    await expect(pop(page).locator("css=input[type=range]")).toHaveCount(0);
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(['light.turn_off {"entity_id":"light.demo_kitchen"}']);
  });
});

test.describe("2D hover tooltip", () => {
  test("a mouse over an icon shows its name and state; leaving hides it; a press hides it", async ({ page }) => {
    await boot(page);
    await expect(tip(page)).toBeHidden();
    const p = await iconPoint(page, 0);
    await page.mouse.move(p.x - 40, p.y - 40);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toContainText("Living light");
    await expect(tip(page)).toContainText("50 %");
    await page.mouse.move(5, 5);
    await expect(tip(page)).toBeHidden();
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toBeVisible();
    await page.mouse.down();
    await expect(tip(page)).toBeHidden();
    await page.mouse.up();
  });

  test("a sensor's tooltip uses the plan's number rule: 21.5 °C, and a popup open hides the tooltip", async ({ page }) => {
    await boot(page);
    const p = await iconPoint(page, 4);
    await page.mouse.move(p.x - 30, p.y - 30);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toContainText("21.5 °C");
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    await expect(tip(page)).toBeHidden();
  });
});
