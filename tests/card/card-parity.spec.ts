import { hasItem, rotateLeft, rotateRight } from "./menu-helper";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// Diego, 0.12.22: "buttons in the studio but not in the card ... arrow keys work in studio but not card".
// The card mounted the way Home Assistant mounts it: a bare config from the dashboard, a hass with no `config`,
// the layout over the websocket in the shape websocket.py sends ({ layout }, CLAUDE.md finding 21), inside a
// container of the width the dashboard column gives it. Every config that draws any view or zoom control must
// draw the rotate pair as well, reachable by a real pointer, and take the arrow keys.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const card = (page: Page) => page.locator("floorplan-studio-card");

/** `nested`: the card inside two shadow roots, as in Home Assistant (home-assistant > ... > hui-card > card). There
 * `document.activeElement` is the outermost host, never the card, so a check that reads it cannot see a focused card. */
async function boot(page: Page, config: Record<string, unknown>, width: number, hass: Record<string, unknown> = {}, nested = false) {
  await page.setViewportSize({ width: Math.max(width, 320) + 40, height: 900 });
  await page.goto(URL_);
  await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, width);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async ({ config, layout, hass, nested }) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    if (nested) {
      const outer = document.createElement("div");
      document.getElementById("wrap")!.appendChild(outer);
      const inner = document.createElement("div");
      outer.attachShadow({ mode: "open" }).appendChild(inner);
      inner.attachShadow({ mode: "open" }).appendChild(el as unknown as Node);
    }
    el.setConfig(structuredClone(config));
    el.hass = { states: {}, connection: { sendMessagePromise: async () => ({ layout }) }, themes: { darkMode: false }, ...hass };
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
  }, { config, layout: structuredClone(demo), hass, nested });
}

const planDeg = (page: Page) => card(page).evaluate((el) => {
  const m = el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
  return m ? Number(m[1]) : 0;
});
const vbX = (page: Page) => card(page).evaluate((el) => Number(el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/)[0]));
const vbW = (page: Page) => card(page).evaluate((el) => Number(el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/)[2]));
const settled = (page: Page) => expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);

const BASE = { type: "custom:floorplan-studio-card" };
type Row = { name: string; config: Record<string, unknown>; width: number; hass?: Record<string, unknown>; rotate: boolean; zoomKeys: boolean };
// What a dashboard hands over, and what the card must offer. `rotate`: the pair exists and takes the keys.
const MATRIX: Row[] = [
  { name: "type only, 375", config: BASE, width: 375, rotate: true, zoomKeys: true },
  { name: "type only, 1280", config: BASE, width: 1280, rotate: true, zoomKeys: true },
  { name: "type only, 200 (a narrow sections column)", config: BASE, width: 200, rotate: true, zoomKeys: true },
  { name: "type only, hass without config", config: BASE, width: 375, hass: { config: undefined, entities: undefined }, rotate: true, zoomKeys: true },
  { name: "view 2.5d", config: { ...BASE, view: "2.5d" }, width: 375, rotate: true, zoomKeys: true },
  { name: "view 2d", config: { ...BASE, view: "2d" }, width: 375, rotate: true, zoomKeys: true },
  { name: "floor pinned", config: { ...BASE, floor: "ground" }, width: 375, rotate: true, zoomKeys: true },
  { name: "labels false", config: { ...BASE, labels: false }, width: 375, rotate: true, zoomKeys: true },
  { name: "zoom true, view_switch false", config: { ...BASE, view_switch: false }, width: 375, rotate: true, zoomKeys: true },
  { name: "zoom wheel, view_switch false", config: { ...BASE, zoom: "wheel", view_switch: false }, width: 375, rotate: true, zoomKeys: true },
  { name: "zoom false, view_switch default", config: { ...BASE, zoom: false }, width: 375, rotate: true, zoomKeys: false },
  { name: "zoom false, view_switch false", config: { ...BASE, zoom: false, view_switch: false }, width: 375, rotate: false, zoomKeys: false },
  // Kiosk draws no buttons but still zooms by gesture, so the zoom keys stay; rotation is off unless asked for.
  { name: "kiosk", config: { ...BASE, kiosk: true }, width: 375, rotate: false, zoomKeys: true },
  { name: "kiosk with rotate_switch true", config: { ...BASE, kiosk: true, rotate_switch: true }, width: 375, rotate: true, zoomKeys: true },
  { name: "rotate_switch false", config: { ...BASE, rotate_switch: false }, width: 375, rotate: false, zoomKeys: true },
];

for (const row of MATRIX) {
  test(`card config matrix: ${row.name}`, async ({ page }) => {
    await boot(page, row.config, row.width, row.hass);
    // S31.6: the pair is two items of the ⋯ menu; a card with no menu has none.
    expect(await hasItem(page, "rotate:-1")).toBe(row.rotate);
    expect(await hasItem(page, "rotate:1")).toBe(row.rotate);
    // The pointer over the card, no click: the keys belong to the card under it.
    const box = (await card(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
    // The arrows no longer turn the plan (Diego, 2026-10-07): the rotate pair does, by click; Up zooms, then Right pans.
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    expect(await planDeg(page)).toBe(0);
    if (row.rotate) { await rotateRight(page); await settled(page); expect(await planDeg(page)).toBe(45); }
    const w0 = await vbW(page); // after the turn: a turned plan has another bounding box
    await page.keyboard.press("+");
    if (row.zoomKeys) {
      await expect.poll(() => vbW(page)).toBeLessThan(w0);
      const x0 = await vbX(page);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => vbX(page)).toBeGreaterThan(x0);
    } else { await page.waitForTimeout(150); expect(await vbW(page)).toBe(w0); }
  });
}

test("the built card names its version in the console, and an older copy that owns the element is called out", async ({ page }) => {
  const manifest = JSON.parse(readFileSync("custom_components/floorplan_studio/manifest.json", "utf8"));
  const lines: string[] = [];
  page.on("console", (m) => lines.push(m.text()));
  await page.goto(URL_);
  await page.evaluate(() => customElements.define("floorplan-studio-card", class extends HTMLElement {})); // "the old copy"
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await expect.poll(() => lines.join("\n")).toContain(`Floorplan Studio card ${manifest.version}`);
  expect(lines.join("\n")).toContain(`Floorplan Studio ${manifest.version}: <floorplan-studio-card> is already defined by another script`);
});

for (const width of [375, 500, 700, 900, 1280]) {
  // S31.6: the toolbar is gone; its stand-in is the header's ⋯ button and the zoom cluster. Premise moved: none of them sits
  // under a floor chip or under another control, and a real pointer at the middle of each lands on it.
  test(`with three floor chips at ${width} px, the menu button and the cluster are reachable and none sits under a chip`, async ({ page }) => {
    await boot(page, { ...BASE, view: "2.5d" }, width);
    const r = await card(page).evaluate((el) => {
      const root = el.shadowRoot!;
      const chips = [...root.querySelectorAll<HTMLElement>(".fp-floors button")].map((b) => b.getBoundingClientRect());
      const controls = [...root.querySelectorAll<HTMLElement>("fp-menu, .fp-stack button")];
      const covered = controls.filter((c) => {
        const b = c.getBoundingClientRect();
        const top = root.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return !top || !c.contains(top);
      }).map((c) => c.getAttribute("aria-label") ?? c.localName);
      const overlap = controls.filter((c) => {
        const b = c.getBoundingClientRect();
        return chips.some((k) => b.left < k.right && b.right > k.left && b.top < k.bottom && b.bottom > k.top);
      }).map((c) => c.getAttribute("aria-label") ?? c.localName);
      return { n: chips.length, nControls: controls.length, covered, overlap };
    });
    expect(r.n).toBe(3);
    expect(r.nControls).toBeGreaterThanOrEqual(4); // ⋯, +, -, Fit
    expect(r.covered).toEqual([]);
    expect(r.overlap).toEqual([]);
  });
}

test("one click on the card, then the pointer away: the keys still reach it", async ({ page }) => {
  await boot(page, BASE, 375);
  const box = (await card(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.9); // empty plan, not a device
  await page.mouse.move(1, 1);
  await page.keyboard.press("+");
  await settled(page);
  const x0 = await vbX(page);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => vbX(page)).toBeLessThan(x0);
  expect(await planDeg(page)).toBe(0);
});

test("in Home Assistant's shadow roots: one click on the card, then the pointer away, the keys still reach it", async ({ page }) => {
  await boot(page, BASE, 375, {}, true);
  const box = (await card(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.9);
  await page.mouse.move(1, 1);
  await page.keyboard.press("+");
  await settled(page);
  const x0 = await vbX(page);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => vbX(page)).toBeLessThan(x0);
});

test("in Home Assistant's shadow roots: the pointer over the card, no click, the keys reach it", async ({ page }) => {
  await boot(page, BASE, 375, {}, true);
  const box = (await card(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.keyboard.press("+");
  await settled(page);
  const x0 = await vbX(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => vbX(page)).toBeGreaterThan(x0);
});

test("in Home Assistant's shadow roots: after a click away from the card the keys stop", async ({ page }) => {
  await boot(page, BASE, 375, {}, true);
  const box = (await card(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.9);
  await page.mouse.click(box.x + box.width + 20, 700); // the page, outside the card
  const w0 = await vbW(page);
  await page.keyboard.press("+");
  await page.waitForTimeout(150);
  expect(await vbW(page)).toBe(w0);
});

test("a click on a rotate button, then the keys: the keys still reach the card, and still do not turn it", async ({ page }) => {
  await boot(page, BASE, 1280);
  await rotateRight(page);
  await settled(page);
  await page.mouse.move(1, 1);
  const w0 = await vbW(page);
  await page.keyboard.press("+");
  await expect.poll(() => vbW(page)).toBeLessThan(w0);
  await page.keyboard.press("ArrowRight");
  await settled(page);
  expect(await planDeg(page)).toBe(45);
});

test("2.5D: the rotate buttons turn the plan and it keeps its depth", async ({ page }) => {
  await boot(page, { ...BASE, view: "2.5d" }, 375);
  await rotateLeft(page);
  await settled(page);
  expect(await planDeg(page)).toBe(315);
  await expect(card(page).locator("css=svg .bs").first()).toBeAttached();
});
