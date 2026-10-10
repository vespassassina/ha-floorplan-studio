import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { demo, serve, ORIGIN, holder, cam, drawn } from "./helpers-3d";

// S28.11 (V5): the 3D view's labels do not overlap. Real card, real browser, real mouse. The shown labels are read from the DOM:
// a piece (icon, value, name, room name, room readout) counts when its container is not hidden and it is not faded (`fp3-lose`).
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));

interface Rect { id: string; x: number; y: number; w: number; h: number }
/** The labels on show now: id (kind and index), and the box the browser draws. */
const shown = (page: Page) => holder(page).evaluate((el): { shown: Rect[]; faded: number; fadedIds: string[] } => {
  const out: Rect[] = [], fadedIds: string[] = [];
  let faded = 0;
  const pieces: [string, string][] = [["svg.fp3-ic", "i"], [".fp3-dv", "v"], [".fp3-dn", "n"], [".fp3-name", "r"], [".fp3-val", "q"]];
  for (const [sel, tag] of pieces) {
    el.querySelectorAll<HTMLElement | SVGElement>(`.fp3-ov ${sel}`).forEach((e) => {
      const host = e.closest<HTMLElement>(".fp3-dev, .fp3-rm")!;
      if (host.style.visibility === "hidden" || (e as HTMLElement).hidden) return;
      if (getComputedStyle(e).display === "none") return;
      const id = tag + (host.querySelector("svg.fp3-ic")?.getAttribute("data-i") ?? host.getAttribute("data-r") ?? "?");
      if (e.classList.contains("fp3-lose")) { faded++; fadedIds.push(id); return; }
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      // A line of text leaves 1 px of leading above and below its glyphs (overlay.ts LEAD); an icon fills its box.
      const lead = tag === "i" ? 0 : 1;
      out.push({ id, x: r.x, y: r.y + lead, w: r.width, h: r.height - 2 * lead });
    });
  }
  return { shown: out, faded, fadedIds: fadedIds.sort() };
});
const meet = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
const overlaps = (rs: Rect[]) => { const out: string[] = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (meet(rs[i], rs[j])) out.push(`${rs[i].id}~${rs[j].id}`); return out; };

async function boot(page: Page, layout: unknown, floor: string, extra: Record<string, unknown> = {}) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { layout, floor, view: "3d", active_list: false, names: true, ...extra });
  await drawn(page);
}
/** The camera has not moved, and the declutter has run (it waits for a quiet frame): the frame count and the shown set hold for 400 ms. */
async function settled(page: Page) {
  let last = "";
  await expect.poll(async () => {
    const s = JSON.stringify([(await cam(page)).drawn, (await shown(page)).shown.map((r) => r.id)]);
    const same = s === last;
    last = s;
    return same;
  }, { timeout: 15000, intervals: [400] }).toBe(true);
}

test("stress house, 3D, settled: no two shown labels meet, and the loud plan did hide some", async ({ page }) => {
  await boot(page, stress, "ground");
  await settled(page);
  const s = await shown(page);
  expect(s.shown.length).toBeGreaterThan(30);
  expect(s.faded, "a plan this crowded must lose some labels").toBeGreaterThan(10);
  expect(overlaps(s.shown)).toEqual([]);
});

/** The state of the two names of rooms 4 (the garden) and 6 (the pond), and the browser's box for each, faded or not. */
const gardenAndPond = (page: Page) => holder(page).evaluate((el) => [4, 6].map((r) => {
  const e = el.querySelector<HTMLElement>(`.fp3-rm[data-r="${r}"] .fp3-name`)!, b = e.getBoundingClientRect();
  return { text: e.textContent, lose: e.classList.contains("fp3-lose"), hidden: (e.closest(".fp3-rm") as HTMLElement).style.visibility === "hidden", box: { id: String(r), x: b.x, y: b.y, w: b.width, h: b.height } };
}));

test("the demo's garden and pond keep their names when they do not touch", async ({ page }) => {
  // The demo's garden is 100 cm across and the pond lies in it, so their names meet at any zoom. Here the garden runs on 400 cm to the
  // east, which puts its name well clear of the pond's.
  const layout = structuredClone(demo);
  layout.floors.ground.rooms[4].pts = [[800, 380], [1300, 380], [1300, 540], [800, 540]];
  await boot(page, layout, "ground", { names: false });
  await page.evaluate(`window.__fp3d.look(1.2, 0.5)`); // from the east and above: the garden and its pond are in plain view
  await settled(page);
  const [garden, pond] = await gardenAndPond(page);
  expect(meet(garden.box, pond.box), "the premise: the two names do not touch").toBe(false);
  expect([garden, pond].map(({ text, lose, hidden }) => ({ text, lose, hidden }))).toEqual([{ text: "Garden", lose: false, hidden: false }, { text: "Garden pond", lose: false, hidden: false }]);
});

test("the demo's garden and pond, names touching: the garden keeps its name and the pond gives way", async ({ page }) => {
  await boot(page, structuredClone(demo), "ground", { names: false });
  await page.evaluate(`window.__fp3d.look(1.2, 0.5)`);
  await settled(page);
  const [garden, pond] = await gardenAndPond(page);
  expect(meet(garden.box, pond.box), "the premise: the two names touch").toBe(true);
  expect([garden, pond].map(({ lose, hidden }) => ({ lose, hidden }))).toEqual([{ lose: false, hidden: false }, { lose: true, hidden: false }]);
});

test("a garden name that sits under a room name loses to it", async ({ page }) => {
  // Move the garden's name onto the Living room's by giving the garden a ring around the same centre: same point, so the boxes meet.
  const layout = structuredClone(demo);
  const living = layout.floors.ground.rooms[0], garden = layout.floors.ground.rooms[4];
  garden.pts = living.pts.map((p: number[]) => [p[0] + 0, p[1] + 0]);
  await boot(page, layout, "ground", { names: false });
  await settled(page);
  const lose = await holder(page).evaluate((el) => [0, 4].map((r) => el.querySelector(`.fp3-rm[data-r="${r}"] .fp3-name`)!.classList.contains("fp3-lose")));
  expect(lose).toEqual([false, true]);
});

test("a drag never flips a label: the faded set is the same in every frame of the drag, then it settles clean", async ({ page }) => {
  await boot(page, stress, "ground");
  await settled(page);
  const before = (await shown(page)).fadedIds;
  expect(before.length, "something is faded to begin with").toBeGreaterThan(10);
  const box = (await holder(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A sampler in the page reads, on every frame the view draws, which labels are faded (among those the camera has not hidden or shown:
  // occlusion changes with the view, the decision must not). The drag is one call, so no step waits longer than a frame or two.
  await page.evaluate(() => {
    const w = window as unknown as { __s: string[]; __run: boolean };
    w.__s = []; w.__run = true;
    const tick = () => {
      if (!w.__run) return;
      const ids: string[] = [];
      document.getElementById("card")!.shadowRoot!.querySelectorAll<HTMLElement>(".fp3-ov .fp3-lose").forEach((e) => ids.push((e.closest(".fp3-dev")?.querySelector("svg.fp3-ic")?.getAttribute("data-i") ?? "") + "|" + (e.closest(".fp3-rm")?.getAttribute("data-r") ?? "") + "|" + e.className));
      w.__s.push(ids.sort().join());
      requestAnimationFrame(tick);
    };
    tick();
  });
  const f0 = (await cam(page)).drawn;
  await page.mouse.move(box.x + box.width / 2 + 170, box.y + box.height / 2 - 40, { steps: 60 });
  const seen = await page.evaluate(() => { const w = window as unknown as { __s: string[]; __run: boolean }; w.__run = false; return w.__s; });
  expect((await cam(page)).drawn, "the drag drew frames").toBeGreaterThan(f0 + 5);
  expect(seen.length).toBeGreaterThan(5);
  expect(new Set(seen).size, "the faded set changed during the drag").toBe(1);
  expect(seen[0].split(",").length).toBe(before.length);
  await page.mouse.up();
  await settled(page);
  expect(overlaps((await shown(page)).shown)).toEqual([]);
});

test("a live update re-decides: turning device names on adds labels and none is left overlapping", async ({ page }) => {
  await boot(page, stress, "ground", { names: false });
  await settled(page);
  const n0 = (await shown(page)).shown.length;
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; updateComplete: Promise<unknown> };
    el.setConfig(config);
    return el.updateComplete;
  }, { layout: stress, floor: "ground", view: "3d", active_list: false, names: true });
  await settled(page);
  const s = await shown(page);
  expect(s.faded, "the new names crowd the plan, some give way").toBeGreaterThan(10);
  expect(s.shown.length).toBeGreaterThan(n0 - 5);
  expect(overlaps(s.shown)).toEqual([]);
});

test.describe("the fade", () => {
  test("a faded label has opacity 0 and a 120 ms transition", async ({ page }) => {
    await boot(page, stress, "ground");
    await settled(page);
    const css = await holder(page).evaluate((el) => {
      const lose = el.querySelector<HTMLElement>(".fp3-ov .fp3-lose")!, keep = el.querySelector<HTMLElement>(".fp3-ov .fp3-name:not(.fp3-lose), .fp3-ov .fp3-dv:not(.fp3-lose)")!;
      const c = getComputedStyle(lose);
      return { op: c.opacity, dur: c.transitionDuration, prop: c.transitionProperty, keepOp: getComputedStyle(keep).opacity };
    });
    expect(css.op).toBe("0");
    expect(css.dur).toBe("0.12s");
    expect(css.prop).toBe("opacity");
    expect(+css.keepOp).toBeGreaterThan(0.8);
  });
  test("with reduced motion there is no transition, and the answer is the same", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await boot(page, stress, "ground");
    await settled(page);
    const dur = await holder(page).evaluate((el) => getComputedStyle(el.querySelector(".fp3-ov .fp3-lose")!).transitionDuration);
    expect(dur).toBe("0s");
    expect(overlaps((await shown(page)).shown)).toEqual([]);
    await ctx.close();
  });
});
