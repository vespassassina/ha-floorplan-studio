import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The Opus review of Sprint 14: popup in kiosk, popup lifetime, two cards, panel rows, narrow geometry, the tooltip.
// Every click and move is a real page.mouse event at a point checked to be the real top element (CLAUDE.md finding 3).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = () => ({
  "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["color_temp", "hs"], brightness: 128, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, color_temp_kelvin: 3000, hs_color: [30, 60] }),
  "light.demo_kitchen": st("on", { supported_color_modes: ["onoff"] }),
  "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "sensor.demo_living_temperature": st("21.5", { unit_of_measurement: "°C" }),
  "climate.demo_living": st("heat"), "camera.demo_hall": st("idle"),
});

/** Sets up one card (`#id`) in the harness. */
async function setup(page: Page, id: string, extra: Record<string, unknown>) {
  await page.evaluate(([id, config, states]) => {
    const w = window as unknown as { __calls: Record<string, string[]>; __info: Record<string, string[]> };
    w.__calls ??= {}; w.__info ??= {};
    w.__calls[id as string] = []; w.__info[id as string] = [];
    let el = document.getElementById(id as string) as (HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> }) | null;
    if (!el) { const c = document.createElement("floorplan-studio-card"); c.id = id as string; el = c as never; document.getElementById("wrap")!.appendChild(el!); }
    el!.addEventListener("hass-more-info", (e) => w.__info[id as string]!.push((e as CustomEvent).detail.entityId));
    el!.setConfig(config);
    el!.hass = { states, callService: (d: string, s: string, data: Record<string, unknown>) => { w.__calls[id as string]!.push(`${d}.${s} ${JSON.stringify(data)}`); } };
    return el!.updateComplete;
  }, [id, { layout: structuredClone(demo), floor: "ground", ...extra }, STATES()] as const);
}
async function boot(page: Page, width = 1100, extra: Record<string, unknown> = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await setup(page, "card", extra);
}
const card = (page: Page, id = "card") => page.locator(`#${id}`);
const infos = (page: Page, id = "card") => page.evaluate((id) => (window as unknown as { __info: Record<string, string[]> }).__info[id], id);
const calls = (page: Page, id = "card") => page.evaluate((id) => (window as unknown as { __calls: Record<string, string[]> }).__calls[id], id);
const pop = (page: Page, id = "card") => card(page, id).locator("css=.fp-pop");
const tip = (page: Page, id = "card") => card(page, id).locator("css=.fp-tip");

async function iconPoint(page: Page, i: number, id = "card") {
  const p = await card(page, id).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-x="${i}"]`)!;
    const r = g.getBoundingClientRect();
    let x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    for (let a = 1; a < 8 && !top?.closest(`g[data-x="${i}"]`); a++) for (let b = 1; b < 8 && !top?.closest(`g[data-x="${i}"]`); b++) {
      x = r.x + (r.width * a) / 8; y = r.y + (r.height * b) / 8; top = el.shadowRoot!.elementFromPoint(x, y);
    }
    return { x, y, hit: !!top?.closest(`g[data-x="${i}"]`) };
  }, i);
  expect(p.hit, `device ${i} is the top element at its centre`).toBe(true);
  return p;
}
const tapIcon = async (page: Page, i: number, id = "card") => { const p = await iconPoint(page, i, id); await page.mouse.click(p.x, p.y); return p; };
// ground devices: 0 living light, 1 kitchen light, 2 hall switch, 3 TV plug, 4 temperature sensor, 6 camera, 7 radiator

test.describe("S14 review 1: kiosk", () => {
  test("under kiosk a popup has its button and no More info, so a tap cannot reach more-info", async ({ page }) => {
    await boot(page, 1100, { kiosk: true });
    await tapIcon(page, 2); // the hall switch
    await expect(pop(page)).toBeVisible();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn on");
    await expect(pop(page).locator("css=.fp-pop-more")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await tapIcon(page, 6); // the camera: nothing to operate, so only name and state
    await expect(pop(page)).toBeVisible();
    await expect(pop(page).locator("css=button")).toHaveCount(0);
    expect(await infos(page)).toEqual([]);
  });
  test("without kiosk the same popup keeps More info", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 2);
    await expect(pop(page).locator("css=.fp-pop-more")).toHaveCount(1);
  });
});

test.describe("S14 review 2 and 3: when a popup goes", () => {
  test("a floor switch by keyboard (no pointer press for the outside rule to see) closes it", async ({ page }) => {
    await boot(page, 1100, { floor: "all" });
    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    await card(page).locator("css=.fp-floors button[aria-pressed=false]").first().focus();
    await page.keyboard.press("Enter");
    await expect(card(page).locator("css=.fp-floors button[aria-pressed=true]")).not.toHaveText("Ground");
    await expect(pop(page)).toHaveCount(0);
  });
  test("a replaced layout closes it; a hass update does not", async ({ page }) => {
    await boot(page);
    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    await card(page).evaluate((el) => { const e = el as unknown as { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> }; e.hass = { ...e.hass, states: { ...e.hass.states } }; return e.updateComplete; });
    await expect(pop(page)).toBeVisible();
    await card(page).evaluate((el, layout) => { const e = el as unknown as { setConfig(c: unknown): void; updateComplete: Promise<unknown> }; e.setConfig({ layout, floor: "ground" }); return e.updateComplete; }, structuredClone(demo));
    await expect(pop(page)).toHaveCount(0);
  });
  test("opening a popup in card B closes card A's", async ({ page }) => {
    await boot(page, 1100, { active_list: false });
    await page.evaluate(() => { const w = document.getElementById("wrap")!; w.style.display = "flex"; });
    await setup(page, "card2", { active_list: false });
    await page.evaluate(() => { for (const id of ["card", "card2"]) { const e = document.getElementById(id)!; e.style.flex = "1 1 0"; e.style.minWidth = "0"; } });
    await tapIcon(page, 0, "card");
    await expect(pop(page, "card")).toBeVisible();
    await page.waitForTimeout(400);
    await tapIcon(page, 1, "card2");
    await expect(pop(page, "card2")).toBeVisible();
    await expect(pop(page, "card")).toHaveCount(0);
    // and a tap on A's own icon still swaps A's popup instead of closing it
    await tapIcon(page, 0, "card");
    await expect(pop(page, "card")).toBeVisible();
    await expect(pop(page, "card2")).toHaveCount(0);
  });
});

test.describe("S14 review 4: a row in the room panel is the plan icon", () => {
  test("a radiator row opens the radiator's popup, with only More info, which opens more-info", async ({ page }) => {
    await boot(page, 1280);
    const p = await card(page).evaluate((el) => {
      const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!, r = poly.getBoundingClientRect();
      for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
      return null;
    });
    await page.mouse.click(p!.x, p!.y);
    const row = card(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Living radiator" });
    await row.click();
    await expect(pop(page)).toHaveAttribute("aria-label", "Living radiator");
    expect(await infos(page)).toEqual([]);
    await expect(pop(page).locator("css=.fp-pop-more")).toHaveCount(1);
    await pop(page).locator("css=.fp-pop-more").click();
    expect(await infos(page)).toEqual(["climate.demo_living"]);
  });
});

/** Visible bare floor of room `i`: grid points of its box where the room polygon is the top element. */
const bareFloor = (page: Page, i: number) => card(page).evaluate((el, i) => {
  const sr = el.shadowRoot!, poly = sr.querySelector<SVGPolygonElement>(`svg polygon[data-r="${i}"]`)!, r = poly.getBoundingClientRect();
  let n = 0;
  for (let y = r.top + 2; y < r.bottom; y += 4) for (let x = r.left + 2; x < r.right; x += 4) if (sr.elementFromPoint(x, y) === poly) n++;
  return n;
}, i);
const boxOf = (l: Locator) => l.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

test.describe("S14 review 5: the room panel on a narrow card", () => {
  for (const theme of ["light", "dark"]) {
    test(`at 375 px (${theme}) the open panel is at most 46% of the card high and the picked room stays mostly visible`, async ({ page }) => {
      await boot(page, 375, { theme });
      const before = await bareFloor(page, 0);
      const p = await card(page).evaluate((el) => {
        const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!, r = poly.getBoundingClientRect();
        for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
        return null;
      });
      await page.mouse.click(p!.x, p!.y);
      await expect(card(page).locator("css=.fp-room")).toHaveCount(1);
      const c = await boxOf(card(page)), panel = await boxOf(card(page).locator("css=.fp-active"));
      expect(panel.h, `panel ${panel.w}x${panel.h} in card ${c.w}x${c.h}`).toBeLessThanOrEqual(c.h * 0.46);
      expect(panel.x).toBeGreaterThanOrEqual(c.x);
      expect(panel.x + panel.w).toBeLessThanOrEqual(c.x + c.w + 0.5);
      expect(panel.y + panel.h).toBeLessThanOrEqual(c.y + c.h + 0.5);
      // the body scrolls inside the cap
      expect(await card(page).locator("css=.fp-active-body").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
      const after = await bareFloor(page, 0);
      expect(after, `bare floor of the picked room: ${before} before, ${after} with the panel`).toBeGreaterThanOrEqual(before * 0.6);
      await page.screenshot({ path: `/private/tmp/s14-narrow-${theme}.png` });
    });
  }
  test("at 900 px the panel keeps its place and its height (the cap is for narrow cards)", async ({ page }) => {
    await boot(page, 900);
    const p = await card(page).evaluate((el) => {
      const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!, r = poly.getBoundingClientRect();
      for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
      return null;
    });
    await page.mouse.click(p!.x, p!.y);
    await expect(card(page).locator("css=.fp-room")).toHaveCount(1);
    const c = await boxOf(card(page)), panel = await boxOf(card(page).locator("css=.fp-active"));
    expect(panel.y - c.y).toBeLessThan(50);
    expect(panel.x - c.x).toBeLessThan(20);
    expect(panel.h).toBeGreaterThan(c.h * 0.6);
    await page.screenshot({ path: "/private/tmp/s14-panel-900.png" });
  });
});

test.describe("S14 review 6: a tall popup in a short card", () => {
  test("a colour light's popup fits a 375 px card, even in a clipping parent; its sliders scroll and the button is reachable", async ({ page }) => {
    await boot(page, 375, { active_list: false });
    await page.evaluate(() => { const w = document.getElementById("wrap")!; w.style.overflow = "hidden"; });
    await tapIcon(page, 0);
    await expect(pop(page)).toBeVisible();
    const c = await boxOf(card(page)), pb = await boxOf(pop(page));
    expect(pb.y).toBeGreaterThanOrEqual(c.y - 0.5);
    expect(pb.y + pb.h, `popup ${pb.h} high in a card ${c.h} high`).toBeLessThanOrEqual(c.y + c.h + 0.5);
    for (const sel of [".fp-pop-do", ".fp-pop-more"]) {
      const b = await boxOf(pop(page).locator(`css=${sel}`));
      expect(b.y).toBeGreaterThanOrEqual(c.y); expect(b.y + b.h).toBeLessThanOrEqual(c.y + c.h + 0.5);
      // and it is the real top element at its centre: nothing clips or covers it
      const top = await card(page).evaluate((el, [x, y]) => { const t = el.shadowRoot!.elementFromPoint(x!, y!); return !!t?.closest(".fp-pop-do, .fp-pop-more"); }, [b.x + b.w / 2, b.y + b.h / 2] as const);
      expect(top, sel).toBe(true);
    }
    expect(await pop(page).locator("css=.fp-pop-sliders").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await page.screenshot({ path: "/private/tmp/s14-popup-375.png" });
    await page.mouse.click(...(await (async () => { const b = await boxOf(pop(page).locator("css=.fp-pop-do")); return [b.x + b.w / 2, b.y + b.h / 2] as [number, number]; })()));
    expect(await calls(page)).toEqual(["light.turn_off {\"entity_id\":\"light.demo_living\"}"]);
  });
});

test.describe("S14 review 8: the tooltip", () => {
  test("its text follows a state change while it is shown, and the browser's own title stays out of the way", async ({ page }) => {
    await boot(page);
    const p = await iconPoint(page, 0);
    await page.mouse.move(p.x - 30, p.y - 30);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toContainText("50 %");
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelectorAll('svg g[data-x="0"] > title').length)).toBe(0);
    await card(page).evaluate((el) => {
      const e = el as unknown as { hass: { states: Record<string, { state: string; attributes: Record<string, unknown>; last_changed: string }> }; updateComplete: Promise<unknown> };
      const s = e.hass.states;
      e.hass = { ...e.hass, states: { ...s, "light.demo_living": { ...s["light.demo_living"]!, attributes: { ...s["light.demo_living"]!.attributes, brightness: 51 } } } };
      return e.updateComplete;
    });
    await expect(tip(page)).toContainText("20 %"); // 51 / 255
    await expect(tip(page)).not.toContainText("50 %");
    // the plan was drawn again by that update: the new icon has no native tooltip either while ours is up
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelectorAll('svg g[data-x="0"] > title').length)).toBe(0);
    await page.mouse.move(5, 5);
    await expect(tip(page)).toBeHidden();
    expect(await card(page).evaluate((el) => el.shadowRoot!.querySelectorAll('svg g[data-x="0"] > title').length), "the title is back for screen readers").toBe(1);
  });
});
