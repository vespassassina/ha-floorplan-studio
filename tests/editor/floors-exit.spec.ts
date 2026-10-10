import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { serve, ORIGIN, card, cam, drawn } from "../card/helpers-3d";

// S27.16, the exit test of Sprint 27: a misaligned floor aligns within 2 cm, and the card lays it over the floor below. The Studio loads
// tests/fixtures/align-house.json (a first floor over the west wing of the ground floor, shifted by [137.4, -61.7]), Floors > Align to floor
// below > Apply, Save. The saved layout goes to a card with `floors_below: solid` (3D) and to another with `ghost_floor: true` (2D); the
// ground floor, drawn in the first floor's frame, must put the wing's outer corners on the first floor's own corners. Both motion paths
// are the S27.12 and S27.15 tests. Real clicks throughout (finding 3).

const EDITOR = "floorplan-studio-editor";
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/align-house.json", "utf8"));
const FIRST = FIXTURE.floors.first.outline as [number, number][];
const FIRST_BOX = [Math.min(...FIRST.map((p) => p[0])), Math.min(...FIRST.map((p) => p[1])), Math.max(...FIRST.map((p) => p[0])), Math.max(...FIRST.map((p) => p[1]))];
const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;

/** The Studio step: align and save; returns the layout Save sent. */
async function alignInStudio(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  await page.evaluate(([tag, l]) => {
    (document.querySelector(tag as string) as any).layout = l;
    (window as any).__saved = null;
    document.addEventListener("save-request", (e) => { (window as any).__saved = JSON.parse(JSON.stringify((e as CustomEvent).detail)); });
  }, [EDITOR, FIXTURE] as const);
  await page.locator('.chip[data-f="first"]').click();
  await page.locator("#mFloors > summary").click();
  await page.locator("#alignFloor").click();
  await page.locator("#alignApply").click();
  await expect(page.locator("#status")).toHaveText(/^Aligned to Ground: (9\d|100) % match$/);
  await page.locator("#mFile > summary").click();
  await page.locator("#save").click();
  await expect.poll(() => page.evaluate(() => (window as any).__saved !== null)).toBe(true);
  return page.evaluate(() => (window as any).__saved);
}

async function bootCard(page: Page, config: Record<string, unknown>) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((cfg) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, config);
}

test("Align and Save in the Studio, then the card lays the first floor over the ground floor: 3D solid and 2D ghost", async ({ page, context }) => {
  const saved = await alignInStudio(page);
  const o = saved.floors.first.offset as [number, number];
  expect(near(o[0], -137.4) && near(o[1], 61.7), `offset ${JSON.stringify(o)}`).toBe(true);
  expect(saved.floors.ground.offset, "the floor below does not move").toBeUndefined();

  // 3D: the ground floor's solid meshes, in the first floor's frame, put the west wing on the first floor's outline
  const p3 = await context.newPage();
  await bootCard(p3, { layout: saved, floor: "first", view: "3d", floors_below: "solid", active_list: false });
  await drawn(p3);
  await expect.poll(async () => (await p3.evaluate("window.__fp3d.below()") as { count: number }).count, { timeout: 8000 }).toBeGreaterThan(0);
  type Meshes = { count: number; meshes: { box: number[] }[] };
  const edges = (r: Meshes) => { const bx = r.meshes.map((m) => m.box); return [Math.min(...bx.map((b) => b[0])), Math.min(...bx.map((b) => b[1])), Math.max(...bx.map((b) => b[4]))]; };
  const ground = edges(await p3.evaluate("window.__fp3d.below()") as Meshes);
  // the reference, measured the same way (walls have thickness): the first floor itself, as a floor below with no shift, in its own frame
  const n0 = (await cam(p3)).drawn;
  await p3.evaluate((first) => (window as any).__fp3d.setBelow([{ floor: first, elevation: -295, shift: [0, 0] }], "solid"), saved.floors.first);
  await expect.poll(async () => (await cam(p3)).drawn, { timeout: 8000 }).toBeGreaterThan(n0);
  const mine = edges(await p3.evaluate("window.__fp3d.below()") as Meshes);
  expect(near(ground[0], mine[0]), `3D west edge ${ground[0]} vs ${mine[0]}`).toBe(true);
  expect(near(ground[1], mine[1]), `3D north edge ${ground[1]} vs ${mine[1]}`).toBe(true);
  expect(near(ground[2], mine[2]), `3D south edge ${ground[2]} vs ${mine[2]}`).toBe(true);
  await p3.close();

  // 2D: the ghost of the same ground floor
  const p2 = await context.newPage();
  await bootCard(p2, { layout: saved, floor: "first", ghost_floor: true });
  await expect(card(p2).locator("css=svg g.ghost")).toHaveCount(1);
  const g = await card(p2).locator("css=svg g.ghost").evaluate((el) => { const b = (el as unknown as SVGGraphicsElement).getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; });
  expect(near(g[0], FIRST_BOX[0]), `ghost west edge ${g[0]} vs ${FIRST_BOX[0]}`).toBe(true);
  expect(near(g[1], FIRST_BOX[1]), `ghost north edge ${g[1]} vs ${FIRST_BOX[1]}`).toBe(true);
  expect(near(g[3], FIRST_BOX[3]), `ghost south edge ${g[3]} vs ${FIRST_BOX[3]}`).toBe(true);
  await p2.close();
});

test("without the Align step the same card is out by the whole shift (the test can fail)", async ({ page }) => {
  await bootCard(page, { layout: structuredClone(FIXTURE), floor: "first", ghost_floor: true });
  const x0 = await card(page).locator("css=svg g.ghost").evaluate((el) => (el as unknown as SVGGraphicsElement).getBBox().x);
  expect(Math.abs(x0 - FIRST_BOX[0])).toBeGreaterThan(100);
});
