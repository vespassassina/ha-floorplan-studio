import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// A tv, speaker or computer piece with an entity is linked, and in the card it behaves as the device of its type (DECISIONS
// 2026-10-07): it is listed as active, a tap is more-info and never a room pick, it has a hover tooltip and a room row. An
// unlinked piece stays room floor. Every click is a real page.mouse click at a point checked to be the real top element.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

// Living (room 0) is 500 x 400 cm. A linked tv at (120, 150) and an unlinked one at (330, 230): clear of every demo device.
const layout = structuredClone(demo);
layout.floors.ground.furniture.push(
  { id: "tv-linked", symbol: "tv", x: 120, y: 150, rot: 0, w: 120, h: 50, name: "Big screen", entity: "media_player.demo_tv" },
  { id: "tv-plain", symbol: "tv", x: 330, y: 230, rot: 0, w: 120, h: 50 },
);
const LINKED = layout.floors.ground.furniture.length - 2, PLAIN = LINKED + 1;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-07T09:30:15Z" });
const STATES = (tv: string) => ({ "light.demo_living": st("on"), "light.demo_kitchen": st("off"), "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"), "media_player.demo_tv": st(tv, { friendly_name: "Living TV" }) });

async function boot(page: Page, tv = "playing", width = 1280, view = "2d") {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([config, states]) => {
      const w = window as unknown as { __calls: string[]; __info: string[] };
      w.__calls = []; w.__info = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
      el.setConfig(config);
      el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
      return el.updateComplete;
    },
    [{ layout, floor: "ground", view }, STATES(tv)] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const picked = (page: Page) => card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll("svg polygon.room-picked")].map((p) => Number(p.getAttribute("data-picked"))));

/** The centre of piece `i`, checked to be the real top element there (the piece's own group, not the room under it). */
async function piecePoint(page: Page, i: number) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-f="${i}"]`)!;
    const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, hit: !!el.shadowRoot!.elementFromPoint(x, y)?.closest(`g[data-f="${i}"]`) };
  }, i);
  expect(p.hit, `piece ${i} is the top element at its centre`).toBe(true);
  return p;
}

test.describe("a linked tv piece in the card", () => {
  test("a playing one is in the Active list under its own name; an unlinked one never is", async ({ page }) => {
    await boot(page, "playing");
    const rows = (await card(page).locator("css=.fp-active-body .fp-active-row").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim());
    expect(rows.some((r) => r.startsWith("Big screen")), rows.join("|")).toBe(true);
  });

  test("its Active row is more-info too, as its tap on the plan is", async ({ page }) => {
    await boot(page, "playing");
    await card(page).locator("css=.fp-active-body .fp-active-row", { hasText: "Big screen" }).click();
    expect(await infos(page)).toEqual(["media_player.demo_tv"]);
    expect(await calls(page)).toEqual([]);
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
  });

  test("a paused one has class on, like a tv device; an off one does not", async ({ page }) => {
    await boot(page, "paused");
    await expect(card(page).locator(`css=svg g[data-f="${LINKED}"]`)).toHaveClass(/\bon\b/);
    await expect(card(page).locator(`css=svg g[data-f="${PLAIN}"]`)).not.toHaveClass(/\bon\b/);
    await card(page).evaluate((el) => { const e = el as unknown as { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> }; e.hass = { ...e.hass, states: { ...e.hass.states, "media_player.demo_tv": { state: "off", attributes: {}, last_changed: "2026-10-07T10:00:00Z" } } }; return e.updateComplete; });
    await expect(card(page).locator(`css=svg g[data-f="${LINKED}"]`)).not.toHaveClass(/\bon\b/);
  });

  test("a real tap is more-info for its entity: no room pick, no service call, no popup", async ({ page }) => {
    await boot(page, "playing");
    const p = await piecePoint(page, LINKED);
    await page.mouse.click(p.x, p.y);
    expect(await infos(page)).toEqual(["media_player.demo_tv"]);
    expect(await calls(page)).toEqual([]);
    expect(await picked(page)).toEqual([]);
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
  });

  test("in 2.5D its block takes the same real tap: more-info, no room pick", async ({ page }) => {
    await boot(page, "playing", 1280, "2.5d");
    const p = await piecePoint(page, LINKED);
    await page.mouse.click(p.x, p.y);
    expect(await infos(page)).toEqual(["media_player.demo_tv"]);
    expect(await picked(page)).toEqual([]);
  });

  test("a tap on an unlinked piece still picks its room and opens no more-info", async ({ page }) => {
    await boot(page, "playing");
    const p = await piecePoint(page, PLAIN);
    await page.mouse.click(p.x, p.y);
    expect(await picked(page)).toEqual([0]);
    expect(await infos(page)).toEqual([]);
  });

  test("hovering it shows its name and state, like a device", async ({ page }) => {
    await boot(page, "paused");
    const p = await piecePoint(page, LINKED);
    await page.mouse.move(p.x - 3, p.y);
    await page.mouse.move(p.x, p.y);
    const tip = card(page).locator("css=.fp-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Big screen");
    await expect(tip).toContainText("paused");
  });

  test("the room's section lists it as a row, and tapping the row is more-info", async ({ page }) => {
    await boot(page, "paused");
    // bare floor of room 0, away from the pieces
    const f = await card(page).evaluate((el) => {
      const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!, r = poly.getBoundingClientRect();
      for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
      return null;
    });
    await page.mouse.click(f!.x, f!.y);
    const row = card(page).locator("css=.fp-room-devices .fp-active-row", { hasText: "Big screen" });
    await expect(row).toHaveCount(1);
    await expect(row).not.toHaveClass(/fp-off/);
    await row.click();
    expect(await infos(page)).toEqual(["media_player.demo_tv"]);
    expect(await calls(page)).toEqual([]);
  });
});
