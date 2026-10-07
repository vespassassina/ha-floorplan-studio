import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, holder, cam, drawn } from "./helpers-3d";

// A linked tv piece in 3D (DECISIONS 2026-10-07): it wears the linked colour at rest and the on colour by the tv rule (a paused tv
// is on), a real click on it is more-info and never a room pick, and hovering it names it. Clicks are real page.mouse events at
// the screen position the view itself reports, checked first (CLAUDE.md finding 3). The test hook `__fp3d` exists only in dist-test/.

type Where = { x: number; y: number };
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-07T09:30:15Z" });
const STATES = (tv: string) => ({ "light.demo_living": st("off"), "light.demo_kitchen": st("off"), "switch.demo_hall": st("off"), "media_player.demo_tv": st(tv, { friendly_name: "Living TV" }) });
// Living is 500 x 400 cm. The piece is the last of the floor's furniture; the demo has two.
const layout = structuredClone(demo);
layout.floors.ground.furniture.push({ id: "tv-linked", symbol: "tv", x: 120, y: 150, rot: 0, w: 120, h: 50, name: "Big screen", entity: "media_player.demo_tv" });
const PIECE = layout.floors.ground.furniture.length - 1;

async function boot(page: Page, tv: string) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[]; __info: string[] };
    w.__calls = []; w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string, data: { entity_id: string }) => { w.__calls.push(`${d}.${s} ${data.entity_id}`); } };
    return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d" }, STATES(tv)] as const);
  await drawn(page);
  await still(page);
}
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
async function setState(page: Page, tv: string) {
  const n = (await cam(page)).drawn;
  await page.evaluate((states) => { const el = document.getElementById("card") as unknown as { hass: { callService: unknown } }; el.hass = { ...el.hass, states } as never; }, STATES(tv));
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 5000 }).toBeGreaterThan(n);
  await still(page);
}
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const where = (page: Page) => page.evaluate((i) => (window as unknown as { __fp3d: { where(k: string, i: number): Where | null } }).__fp3d.where("furniture", i), PIECE) as Promise<Where>;
const picks = (page: Page, p: Where) => page.evaluate((p) => (window as unknown as { __fp3d: { pick(x: number, y: number): unknown } }).__fp3d.pick(p.x, p.y), p);
const pieces = (page: Page) => page.evaluate(() => (window as unknown as { __fp3d: { live(): { pieces: { index: number; on: boolean; colour: string }[] } } }).__fp3d.live().pieces);
const colourOf = async (page: Page) => (await pieces(page)).find((b) => b.index === PIECE)!;
/** The mean colour of a small patch around `p`, from a real screenshot. */
async function mean(page: Page, p: Where, half = 3): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: p.x - half, y: p.y - half, width: 2 * half, height: 2 * half } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, n = d.length / 4;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    return [r / n, gr / n, b / n] as [number, number, number];
  }, buf.toString("base64"));
}

test.describe("3D view: a linked tv piece", () => {
  test("it is on while paused and at rest when off: the mesh colour and the pixels change, and come back", async ({ page }) => {
    await boot(page, "off");
    const rest = await colourOf(page);
    expect(rest.on).toBe(false);
    const p = await where(page);
    const px0 = await mean(page, p);
    await setState(page, "paused");
    const lit = await colourOf(page);
    expect(lit.on).toBe(true);
    expect(lit.colour).not.toBe(rest.colour);
    const px1 = await mean(page, p);
    expect(Math.abs(px1[0] - px0[0]) + Math.abs(px1[1] - px0[1]) + Math.abs(px1[2] - px0[2])).toBeGreaterThan(40);
    await setState(page, "off");
    expect((await colourOf(page)).colour).toBe(rest.colour);
  });

  test("a real click on it is more-info for its entity, calls nothing and picks no room", async ({ page }) => {
    await boot(page, "playing");
    await page.waitForTimeout(400);
    const p = await where(page);
    expect(await picks(page, p)).toEqual({ type: "piece", index: PIECE });
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => infos(page)).toEqual(["media_player.demo_tv"]);
    expect(await calls(page)).toEqual([]);
    expect(await holder(page).getAttribute("data-ring")).toBe("");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
  });

  test("hovering it names it", async ({ page }) => {
    await boot(page, "paused");
    const p = await where(page);
    await page.mouse.move(p.x - 4, p.y);
    await page.mouse.move(p.x, p.y);
    const tip = card(page).locator("css=.fp-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Big screen");
  });
});
