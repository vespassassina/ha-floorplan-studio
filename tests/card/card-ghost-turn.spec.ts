import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { differing, readPatches } from "../helpers/pixels";
import { FIRST_TO_GROUND, GROUND_TO_BASEMENT } from "../fixtures/hand-align-truth";
import { cardSource } from "../../scripts/card-source.mjs";

// S29.3 + S29.5: the card's ghost follows the floors' rotation. The fixture stores no pose; the truth (hand-align-truth.ts) says the ground is turned
// -2.50 degrees and shifted [-57, 112] from the basement, the first 4.00 degrees and [83, -41] from the ground. The pose written here is built from
// that truth by hand (no helper of src/core), so the expected screen point does not come from the code under test.
//
// Where the ground's walls lie under the first floor's own (they do, once the floors are aligned) a pixel says nothing: the first floor paints over
// the ghost. So the first floor is moved a further [200, 150] cm in the house, which carries the ghost to [-200, -150] in its frame, into the middle of the
// plan. Then the screen is read twice, with the ghost on and off: the pixels that differ are the ghost's own.
const fixture = JSON.parse(readFileSync("tests/fixtures/hand-align-house.json", "utf8"));
const rad = (d: number) => (d * Math.PI) / 180;
const turn = (v: [number, number], d: number): [number, number] => [v[0] * Math.cos(rad(d)) - v[1] * Math.sin(rad(d)), v[0] * Math.sin(rad(d)) + v[1] * Math.cos(rad(d))];
const EXTRA: [number, number] = [-200, -150]; // where the ghost sits on the first floor's plan, beyond its true place
const posed = structuredClone(fixture);
posed.floors.ground.rotation = GROUND_TO_BASEMENT.turn;
posed.floors.ground.offset = GROUND_TO_BASEMENT.shift;
const rotFirst = GROUND_TO_BASEMENT.turn + FIRST_TO_GROUND.turn;
const trueOff = turn(FIRST_TO_GROUND.shift, GROUND_TO_BASEMENT.turn); // a point of the first floor sits in the house at R(rot) p + off
const back = turn(EXTRA, rotFirst); // the house move that shifts the ghost by EXTRA in the first floor's frame is minus this
posed.floors.first.rotation = rotFirst;
posed.floors.first.offset = [GROUND_TO_BASEMENT.shift[0] + trueOff[0] - back[0], GROUND_TO_BASEMENT.shift[1] + trueOff[1] - back[1]];
/** A ground point in the first floor's frame: the inverse of the first-to-ground place, p = R(-t)(p' - s), then EXTRA. */
const groundInFirst = (p: [number, number]): [number, number] => {
  const q = turn([p[0] - FIRST_TO_GROUND.shift[0], p[1] - FIRST_TO_GROUND.shift[1]], -FIRST_TO_GROUND.turn);
  return [q[0] + EXTRA[0], q[1] + EXTRA[1]];
};

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
async function configure(page: Page, layout: unknown, config: Record<string, unknown>) {
  await page.evaluate(({ layout, config }) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ layout, floor: "first", ...config });
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, { layout, config });
}
async function boot(page: Page, layout: unknown, config: Record<string, unknown>) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await configure(page, layout, { ghost_floor: true, ...config });
  await expect(page.locator("floorplan-studio-card svg g.ghost")).toHaveCount(1);
}
// The svg rasterised in the page (tests/helpers/pixels.ts), not page.screenshot: a (2r + 1) px square at the point, at device scale 1.
const shot = (page: Page, at: { x: number; y: number }, r: number) => readPatches(page, { host: "floorplan-studio-card", svg: "svg", client: true }, [[at.x, at.y]], 2 * r + 1).then((p) => p[0]!);
for (const view of [0, 90]) {
  test(`the ghost's corner is drawn where the truth puts it, and 6 px off along its bisector there is none (view turn ${view})`, async ({ page }) => {
    await boot(page, posed, { rotation: view });
    // every corner of the ground's outline, rooms and stairs, as rings of points in the first floor's frame
    const g = fixture.floors.ground, rings = ([g.outline, ...g.rooms.map((r: any) => r.pts), ...g.stairs.map((t: any) => t.pts)] as [number, number][][]).map((r) => r.map(groundInFirst));
    const spots = await page.locator("floorplan-studio-card").evaluate((el, a) => {
      const svg = el.shadowRoot!.querySelector("svg") as SVGSVGElement, gh = svg.querySelector("g.ghost") as SVGGElement;
      const m = (gh.parentNode as SVGGraphicsElement).getScreenCTM()!; // the plan's own transform (the view turn included): not read from the ghost
      const scr = (p: number[]) => ({ x: p[0] * m.a + p[1] * m.c + m.e, y: p[0] * m.b + p[1] * m.d + m.f });
      const host = el.getBoundingClientRect(); // the card is shorter than the window: a corner below it is not on the plan
      const chrome = [".fp-head", ".fp-active", ".fp-cluster"].map((q) => el.shadowRoot!.querySelector(q)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r);
      return a.rings.flatMap((ring, ri) => ring.map((_, idx) => {
        const c = scr(ring[idx]!), prev = scr(ring[(idx + ring.length - 1) % ring.length]!), next = scr(ring[(idx + 1) % ring.length]!);
        const unit = (v: { x: number; y: number }) => { const l = Math.hypot(v.x - c.x, v.y - c.y); return { x: (v.x - c.x) / l, y: (v.y - c.y) / l }; };
        const u = unit(prev), w = unit(next), bx = u.x + w.x, by = u.y + w.y, bl = Math.hypot(bx, by) || 1;
        // in the plan's clear middle: not under the header, the sheet or the zoom cluster (S31.5: they were the floating panel and toolbar), or the edge
        const clear = (q: { x: number; y: number }) => q.x > 20 && q.y > 20 && q.x < Math.min(innerWidth, host.right) - 20 && q.y < Math.min(innerHeight, host.bottom) - 20 && !chrome.some((r) => q.x > r.left - 4 && q.x < r.right + 4 && q.y > r.top - 4 && q.y < r.bottom + 4);
        // the point 6 px off, on the outer side of the corner (the bisector of the two edges points inwards)
        const off = { x: c.x - (6 * bx) / bl, y: c.y - (6 * by) / bl };
        return { idx: `${ri}.${idx}`, c, off, clear: clear(c) && clear(off) };
      }));
    }, { rings });
    const free = spots.filter((s) => s.clear).slice(0, 6);
    expect(free.length, `corners in the clear: ${JSON.stringify(spots.map((s) => [s.idx, s.clear]))}`).toBeGreaterThanOrEqual(2);
    const withGhost = await Promise.all(free.map((s) => Promise.all([shot(page, s.c, 7), shot(page, s.off, 1)])));
    await configure(page, posed, { ghost_floor: false, rotation: view });
    await expect(page.locator("floorplan-studio-card svg g.ghost")).toHaveCount(0);
    for (const [i, s] of free.entries()) {
      const bare = await Promise.all([shot(page, s.c, 7), shot(page, s.off, 1)]);
      expect(await differing(withGhost[i]![0], bare[0]), `the ghost is drawn at corner ${s.idx}`).toBeGreaterThan(3);
      expect(await differing(withGhost[i]![1], bare[1]), `nothing of it 6 px off corner ${s.idx}`).toBe(0);
    }
  });
}

test("with the rotations removed the ghost is not at that corner: the pixel test can fail", async ({ page }) => {
  // The same floors without their rotations: the offsets stay, the ghost is only shifted. This is what a card that ignores the turn draws.
  const flat = structuredClone(posed);
  delete flat.floors.ground.rotation;
  delete flat.floors.first.rotation;
  await boot(page, flat, {});
  const want = groundInFirst((fixture.floors.ground.outline as [number, number][])[2]!);
  const dist = await page.locator("floorplan-studio-card").evaluate((el, w) => {
    const g = el.shadowRoot!.querySelector("svg g.ghost") as SVGGElement, path = g.querySelector("path")!;
    let best = 1e9;
    for (let l = 0; l <= path.getTotalLength(); l++) { const q = path.getPointAtLength(l); best = Math.min(best, Math.hypot(q.x - w[0]!, q.y - w[1]!)); }
    return best;
  }, want);
  expect(dist).toBeGreaterThan(20); // cm: the corner of the truth is more than 20 cm from any line the flat ghost draws
});
