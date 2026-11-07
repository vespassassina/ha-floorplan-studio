import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// B55.3 and B55.4, criterion 8 (docs/specs/batch-s52.md): every corner x room shape (rectangle, L) x every subset of the four sources
// x lit or not. One floor per corner and shape holds 16 rooms, one per subset. Every hover is a real `page.mouse` move to the middle of a
// badge, found as the real top element (finding 3); a tap is a real `page.touchscreen.tap`. The room name and a device name are payloads.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const EVIL = '"><script>window.__pwned=1</script>';
const KINDS = ["lights", "climate", "motion", "energy"] as const;
const TITLE = { lights: "Lights", climate: "Climate", motion: "Motion", energy: "Energy" };
const CORNERS = ["nw", "ne", "sw", "se"] as const;
type Corner = (typeof CORNERS)[number];
type Pt = [number, number];
const RECT: Pt[] = [[0, 0], [400, 0], [400, 300], [0, 300]];
const L: Pt[] = [[0, 0], [200, 0], [200, 100], [400, 100], [400, 300], [0, 300]];
const has = (mask: number, i: number) => (mask >> i & 1) === 1;

/** One floor: a room per mask, in a grid. Bit 0 lights, 1 climate, 2 motion, 3 energy; its sources sit in the room's lower half, which both shapes have. */
function floorOf(masks: number[], corner: Corner, shape: Pt[]) {
  const rooms: unknown[] = [], devices: unknown[] = [];
  masks.forEach((m, i) => {
    const ox = (i % 4) * 500, oy = Math.floor(i / 4) * 400, pts = shape.map(([x, y]) => [x + ox, y + oy]);
    rooms.push({ id: `r${i}`, name: EVIL, area: "", kind: "room", pts, wk: pts.map(() => "wall"), badges: { corner }, ...(has(m, 2) ? { motion: [`binary_sensor.m${i}`] } : {}), ...(has(m, 3) ? { power: [`sensor.p${i}`] } : {}) });
    if (has(m, 0)) devices.push({ id: `l${i}`, type: "light", entity: `light.m${i}`, name: EVIL, x: ox + 100, y: oy + 200 });
    if (has(m, 1)) devices.push({ id: `c${i}`, type: "ac", entity: `climate.m${i}`, name: "AC", x: ox + 250, y: oy + 200 });
  });
  const ground = { ...demo.floors.ground, outline: [[-50, -50], [2000, -50], [2000, 1600], [-50, 1600]], owk: ["wall", "wall", "wall", "wall"], rooms, devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [], unlinked: [] };
  return { ...demo, floors: { ground } };
}
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
// The shapes of the card's own hass.states. Lit: a lamp on, the climate heating, motion on, 420 W. Unlit: off, off, off, 0 W.
const statesOf = (n: number, lit: boolean) => Object.fromEntries(Array.from({ length: n }, (_, i) => [
  [`light.m${i}`, st(lit ? "on" : "off")], [`climate.m${i}`, lit ? st("heat", { hvac_action: "heating", temperature: 21, current_temperature: 19.5 }) : st("off")],
  [`binary_sensor.m${i}`, st(lit ? "on" : "off")], [`sensor.p${i}`, st(lit ? "420" : "0", { unit_of_measurement: "W" })],
]).flat());

async function boot(page: Page, layout: unknown, n: number, size = { width: 1300, height: 1500 }) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    try { localStorage.clear(); } catch { /* file: origin without storage */ }
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: () => undefined };
    return el.updateComplete;
  }, [{ layout, floor: "ground", theme: "light" }, statesOf(n, false)] as const);
}
const setLit = (page: Page, n: number, lit: boolean) => page.evaluate(([states]) => {
  const el = document.getElementById("card") as unknown as HTMLElement & { hass: unknown; updateComplete: Promise<unknown> };
  el.hass = { states, callService: () => undefined };
  return el.updateComplete;
}, [statesOf(n, lit)] as const);

type Spot = { room: number; kind: string; x: number; y: number; top: boolean; inside: boolean; fromCorner: { dx: number; dy: number } };
/** Every badge on the plan: where its middle is on screen, whether the real top element there is that badge, and whether the middle is inside its room. */
const spots = (page: Page) => page.locator("floorplan-studio-card").evaluate((el): Spot[] => {
  const root = el.shadowRoot!, svg = root.querySelector("svg")!;
  return Array.from(svg.querySelectorAll<SVGGElement>("g[data-cb]")).map((g) => {
    const [r, kind] = g.getAttribute("data-cb")!.split(":"), c = g.querySelector("circle")!.getBoundingClientRect();
    const x = c.left + c.width / 2, y = c.top + c.height / 2, poly = svg.querySelector<SVGPolygonElement>(`polygon[data-r="${r}"]`)!;
    const m = svg.getScreenCTM()!.inverse(), p = new DOMPoint(x, y).matrixTransform(m);
    const box = poly.getBoundingClientRect();
    return { room: Number(r), kind, x, y, top: root.elementFromPoint(x, y)?.closest("g[data-cb]") === g, inside: poly.isPointInFill(p), fromCorner: { dx: Math.min(x - box.left, box.right - x), dy: Math.min(y - box.top, box.bottom - y) } };
  });
});
const bubble = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => {
  const b = el.shadowRoot!.querySelector<HTMLElement>(".fp-bubble");
  return b && !b.hidden && getComputedStyle(b).display !== "none" ? { text: b.textContent ?? "", rows: Array.from(b.querySelectorAll("span")).map((s) => s.textContent) } : null;
});
const ON_ROW = { lights: /^1 of 1 on$/, climate: /^Heating to 21\s°C, now 19\.5\s°C$/, motion: /^Motion now$/, energy: /^0\.42 kW$/ };
const OFF_ROW = { lights: /^0 of 1 on$/, climate: /^Off$/, motion: /ago$|^Just now$/, energy: /^0\.00 kW$/ };

for (const shapeName of ["rect", "L"] as const) for (const corner of CORNERS) {
  test(`badges: ${corner} corner of a ${shapeName} room, every subset of sources, lit and not, by mouse`, async ({ page }) => {
    const masks = Array.from({ length: 16 }, (_, i) => i);
    await boot(page, floorOf(masks, corner, shapeName === "rect" ? RECT : L), masks.length);
    const all = await spots(page);
    // Which badges: exactly the sources a room has, in order, and none for mask 0.
    for (const m of masks) expect(all.filter((s) => s.room === m).map((s) => s.kind), `room ${m}`).toEqual(KINDS.filter((_, k) => has(m, k)));
    expect(all.length).toBe(masks.reduce((n, m) => n + KINDS.filter((_, k) => has(m, k)).length, 0));
    for (const s of all) {
      expect(s.top, `room ${s.room} ${s.kind}: the badge is the real top element at its middle`).toBe(true);
      expect(s.inside, `room ${s.room} ${s.kind}: inside its room`).toBe(true);
    }
    if (shapeName === "rect") {
      // 8 px of inset plus the 9 px radius: the badge nearest the corner is 17 px from both sides of the box
      for (const m of masks.filter((m) => m)) {
        const mine = all.filter((s) => s.room === m), near = mine.reduce((a, b) => (a.fromCorner.dx < b.fromCorner.dx ? a : b));
        expect(Math.abs(near.fromCorner.dx - 17), `room ${m} ${corner} x`).toBeLessThan(2.5);
        expect(Math.abs(near.fromCorner.dy - 17), `room ${m} ${corner} y`).toBeLessThan(2.5);
      }
    }
    for (const lit of [false, true]) {
      await setLit(page, masks.length, lit);
      for (const s of await spots(page)) {
        await page.mouse.move(s.x, s.y);
        const b = await bubble(page);
        expect(b, `room ${s.room} ${s.kind} ${lit ? "lit" : "unlit"}: the bubble opens`).not.toBeNull();
        expect(b!.text.startsWith(TITLE[s.kind as keyof typeof TITLE]), `room ${s.room} ${s.kind}: its own title`).toBe(true);
        expect(b!.rows[0], `room ${s.room} ${s.kind} ${lit ? "lit" : "unlit"}`).toMatch((lit ? ON_ROW : OFF_ROW)[s.kind as keyof typeof ON_ROW]);
        await page.mouse.move(2, 2);
        expect(await bubble(page), "the bubble goes when the pointer leaves").toBeNull();
      }
      const lamps = await page.locator("floorplan-studio-card").evaluate((el) => Array.from(el.shadowRoot!.querySelectorAll("g.cb-lights")).map((g) => g.classList.contains("on")));
      expect(lamps.every((x) => x === lit), `the lights badges are ${lit ? "lit" : "unlit"}`).toBe(true);
    }
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned), "a payload name stays text").toBeUndefined();
  });
}

test.describe("badges: a finger", () => {
  test.use({ hasTouch: true, isMobile: true });
  const one = () => floorOf([15], "ne", RECT);
  const picked = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => el.shadowRoot!.querySelectorAll("svg polygon.room-picked").length);
  /** A point on the room's bare floor, away from the badges. */
  const floor = (page: Page) => page.locator("floorplan-studio-card").evaluate((el) => {
    const poly = el.shadowRoot!.querySelector<SVGPolygonElement>("svg polygon[data-r=\"0\"]")!, r = poly.getBoundingClientRect();
    for (let y = r.bottom - 8; y > r.top + 40; y -= 6) for (let x = r.left + 8; x < r.right; x += 6) if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
    return null;
  });

  test("a tap on a badge opens the bubble and does not pick the room; a tap on the floor picks the room and closes it", async ({ page }) => {
    await boot(page, one(), 1, { width: 700, height: 800 });
    const [s] = await spots(page);
    await page.touchscreen.tap(s.x, s.y);
    expect(await bubble(page), "the bubble is open").not.toBeNull();
    expect(await picked(page), "the room is not picked").toBe(0);
    const f = await floor(page);
    expect(f, "bare floor to tap").not.toBeNull();
    await page.touchscreen.tap(f!.x, f!.y);
    expect(await bubble(page), "a tap away closes it").toBeNull();
    expect(await picked(page), "and the tap on the room opens the room").toBe(1);
  });
  test("a second tap on the badge closes it, and is not a double tap that zooms", async ({ page }) => {
    await boot(page, one(), 1, { width: 700, height: 800 });
    const box = () => page.locator("floorplan-studio-card").evaluate((el) => el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox"));
    const before = await box(), [s] = await spots(page);
    await page.touchscreen.tap(s.x, s.y);
    await page.touchscreen.tap(s.x, s.y);
    expect(await bubble(page)).toBeNull();
    expect(await box(), "the view did not move").toBe(before);
  });
  test("it closes by itself after 4 s", async ({ page }) => {
    await page.clock.install();
    await boot(page, one(), 1, { width: 700, height: 800 });
    const [s] = await spots(page);
    await page.touchscreen.tap(s.x, s.y);
    await page.clock.runFor(3900);
    expect(await bubble(page), "still open at 3.9 s").not.toBeNull();
    await page.clock.runFor(200);
    expect(await bubble(page), "closed after 4 s").toBeNull();
  });
});
