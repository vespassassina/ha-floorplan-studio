import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, cam, drawn } from "./helpers-3d";
import { readCanvasRect, meanRgb } from "../helpers/pixels";
import { carSpec } from "../../src/core/car";
import type { CarModel } from "../../src/core/schema";

// S35.5, the car in 3D (spec C4, C6, C7; criteria 9 to 11). Clicks are real page.mouse events at screen positions the view
// itself projects (finding 3); pixels come from the canvas read in the page (tests/helpers/pixels.ts), not from a screenshot.
// The test hook `__fp3d` exists only in dist-test/.

type Pt = { x: number; y: number };
type Piece = { index: number; tag: string; on: boolean; colour: string; emissive: string; visible: boolean; transparent: boolean; opacity: number; depthWrite: boolean; depthFunc: number; renderOrder: number; twin: null | { visible: boolean; colorWrite: boolean; depthWrite: boolean; renderOrder: number } };
type Hook = { live(): { builds: number; pieces: Piece[] }; project(x: number, y: number, z: number): Pt; look(az: number, polar: number): void; carParts(tag: string, shown: boolean): void; pick(x: number, y: number): unknown };
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-17T09:30:15Z" });
// The Living room is 500 x 400 cm; the car stands in the middle of it, nose to the east (+x), and is the floor's only furniture, index 0.
const CX = 250, CY = 200;
const layoutOf = (model: CarModel, extra: Record<string, unknown> = {}) => {
  const layout = structuredClone(demo), s = carSpec(model);
  layout.floors.ground.furniture = [{ id: "car-1", symbol: "car", x: CX, y: CY, rot: 0, w: s.w, h: s.h, name: "Family car", model, entity: "device_tracker.car", attached: ["sensor.car_charging", "sensor.car_battery", "lock.car"], ...extra }];
  return layout;
};
// Value lists copied from the integrations (finding 21; spec "What Home Assistant offers"): the tracker is home / not_home / a zone name; Tesla's and Volvo's charging enum has "charging" and "stopped"; a lock is locked or unlocked.
const STATES = (o: Record<string, unknown> = {}) => ({
  "device_tracker.car": st("home"), "sensor.car_charging": st("stopped"), "sensor.car_battery": st("78", { device_class: "battery", unit_of_measurement: "%" }), "lock.car": st("locked"), ...o,
});

async function boot(page: Page, layout: unknown, states: Record<string, unknown>) {
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
  }, [{ layout, floor: "ground", view: "3d" }, states] as const);
  await drawn(page);
  await still(page);
}
async function still(page: Page) {
  let prev = -1, same = 0;
  await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
}
async function setStates(page: Page, states: Record<string, unknown>) {
  const n = (await cam(page)).drawn;
  await page.evaluate((states) => { const el = document.getElementById("card") as unknown as { hass: { callService: unknown } }; el.hass = { ...el.hass, states } as never; }, states);
  await expect.poll(async () => (await cam(page)).drawn, { timeout: 5000 }).toBeGreaterThan(n);
  await still(page);
}
const hook = <T>(page: Page, fn: (h: Hook, arg: never) => T, arg?: unknown) => page.evaluate(([src, a]) => (new Function("h", "a", `return (${src})(h, a)`))((window as unknown as { __fp3d: Hook }).__fp3d, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const pieces = (page: Page) => hook(page, (h) => h.live().pieces);
const part = async (page: Page, tag: string) => (await pieces(page)).filter((p) => p.index === 0 && p.tag === tag);
const at = (page: Page, x: number, y: number, z: number) => hook(page, (h, p) => h.project((p as number[])[0], (p as number[])[1], (p as number[])[2]), [x, y, z]);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
/** The colour a CSS expression resolves to on the card (what the view's own palette reads). */
const cssHex = (page: Page, css: string) => card(page).evaluate((host, css) => {
  const p = document.createElement("span"); p.style.color = css; host.shadowRoot!.appendChild(p);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(p).color)!; p.remove();
  return `#${[1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, "0")).join("")}`;
}, css);
async function mean(page: Page, p: Pt, half = 2): Promise<[number, number, number]> {
  return meanRgb((await readCanvasRect(page, { x: p.x - half, y: p.y - half, width: 2 * half, height: 2 * half })).data);
}
const dist = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

test.describe("3D view: the car's parts", () => {
  for (const model of ["sedan", "electric", "truck"] as const) {
    test(`${model}: body, glass loft, roof, four tyres${model === "electric" ? ", no grille" : ", a grille"}; every part is the car`, async ({ page }) => {
      await boot(page, layoutOf(model), STATES());
      const all = (await pieces(page)).filter((p) => p.index === 0), tags = all.map((p) => p.tag).sort();
      expect(tags).toEqual(["car-body", "car-glass", ...(model === "electric" ? [] : ["car-grille"]), "car-roof", "car-tyre", "car-tyre", "car-tyre", "car-tyre"]);
      for (const p of all) { expect(p.visible).toBe(true); expect(p.twin).not.toBeNull(); }
    });
  }

  test("home: every part is opaque, writes depth, and its pre-pass twin is hidden", async ({ page }) => {
    await boot(page, layoutOf("suv"), STATES());
    for (const p of await pieces(page)) expect(p).toMatchObject({ transparent: false, opacity: 1, depthWrite: true, renderOrder: 0, twin: { visible: false } });
  });
});

test.describe("3D view: a real tap is a tap on the car", () => {
  test("the body, a wheel and the glass each open the car's popup, and call nothing", async ({ page }) => {
    await boot(page, layoutOf("sedan"), STATES());
    const s = carSpec("sedan"), belt = s.belt * s.height;
    const spots: [string, number, number, number][] = [
      ["body", CX + s.w * 0.38, CY, belt],                                  // the bonnet
      ["wheel", CX - s.w / 2 + 0.18 * s.w, CY + s.h / 2 - 0.4, 8],         // the lower rim of the near rear wheel, under the body (18 cm clear)
      ["glass", CX - s.w / 2 + 0.45 * s.w, CY + (s.cabin * s.h) / 2 - 1, belt + 12], // the side window
    ];
    for (const [what, x, y, z] of spots) {
      const p = await at(page, x, y, z);
      expect(await hook(page, (h, q) => h.pick((q as Pt).x, (q as Pt).y), p), `${what} picks the car`).toEqual({ type: "piece", index: 0 });
      await page.mouse.click(p.x, p.y);
      await expect(card(page).locator("css=.fp-pop .fp-pop-name"), what).toHaveText("Family car");
      await page.keyboard.press("Escape");
      await expect(card(page).locator("css=.fp-pop"), `${what} closes`).toHaveCount(0);
    }
    expect(await infos(page)).toEqual([]);
    expect(await calls(page)).toEqual([]);
  });
});

test.describe("3D view: a real hold on the car", () => {
  // Criterion 12: the hold opens the chooser in 3D as in 2D. The button stays down until the chooser shows (the hold timer is the clock).
  test("a hold on the body opens the chooser titled with the car text, main entity first; the release is no tap; a row fires more-info", async ({ page }) => {
    await boot(page, layoutOf("sedan"), STATES());
    const s = carSpec("sedan"), p = await at(page, CX + s.w * 0.38, CY, s.belt * s.height);
    const chooser = card(page).locator("css=.fp-chooser-dialog");
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await expect(chooser).toBeVisible();
    await page.mouse.up();
    await expect(card(page).locator("css=#fp-chooser-dialog-title")).toHaveText("Family car · Home · 78 %");
    const rows = await card(page).locator("css=.fp-chooser-list button").evaluateAll((bs) => bs.map((b) => b.textContent!.replace(/\s+/g, " ").trim()));
    expect(rows).toEqual(["device_tracker.carhome", "sensor.car_chargingstopped", "sensor.car_battery78 %", "lock.carlocked"]);
    expect(await infos(page)).toEqual([]);
    await card(page).locator("css=.fp-chooser-list button", { hasText: "car_battery" }).click();
    expect(await infos(page)).toEqual(["sensor.car_battery"]);
  });
});

test.describe("3D view: state on the car", () => {
  // B53.3: a charging car now breathes, so the view never goes still; these two tests are about colour and badge, and wait for stillness, so they run with reduced motion (the glow held).
  test("charging lights the greenhouse in the charge colour and nothing else; stopping puts it back", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page, layoutOf("sedan"), STATES());
    const rest = (await part(page, "car-glass"))[0], body = (await part(page, "car-body"))[0];
    expect(rest.emissive).toBe("#000000");
    await setStates(page, STATES({ "sensor.car_charging": st("charging") }));
    const lit = (await part(page, "car-glass"))[0];
    expect(lit.colour).toBe(await cssHex(page, "var(--fp-dev-car, var(--fp-active))"));
    expect(lit.colour).not.toBe(rest.colour);
    expect(lit.emissive).not.toBe("#000000");
    expect((await part(page, "car-body"))[0].colour).toBe(body.colour);
    expect((await part(page, "car-roof"))[0].colour).toBe((await part(page, "car-body"))[0].colour);
    await setStates(page, STATES());
    expect((await part(page, "car-glass"))[0]).toMatchObject({ colour: rest.colour, emissive: "#000000" });
  });

  test("an unlocked lock turns the roof the open door's red; the body stays; locked again puts it back", async ({ page }) => {
    await boot(page, layoutOf("sedan"), STATES());
    const rest = (await part(page, "car-roof"))[0].colour;
    await setStates(page, STATES({ "lock.car": st("unlocked") }));
    expect((await part(page, "car-roof"))[0].colour).toBe(await cssHex(page, "var(--fp-open-door)"));
    expect((await part(page, "car-body"))[0].colour).toBe(rest);
    expect((await part(page, "car-glass"))[0].emissive).toBe("#000000");
    await setStates(page, STATES());
    expect((await part(page, "car-roof"))[0].colour).toBe(rest);
  });

  test("the body wears the piece's own colour, in the pixels too", async ({ page }) => {
    await boot(page, layoutOf("sedan", { color: "#c03030" }), STATES());
    const s = carSpec("sedan"), p = await at(page, CX + s.w * 0.38, CY, s.belt * s.height);
    const [r, g, b] = await mean(page, p, 3);
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);
  });

  test("the badge shows the bolt while charging, the away mark when away, and the level", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // B53.3: see above
    await boot(page, layoutOf("sedan"), STATES());
    const badge = card(page).locator("css=.fp3-car");
    await expect(badge.locator("css=.fp3-cv")).toHaveText("78 %");
    await expect(badge.locator("css=svg:has(.fp3-bolt)")).toBeHidden();
    await expect(badge.locator("css=svg:has(.fp3-away)")).toBeHidden();
    await setStates(page, STATES({ "sensor.car_charging": st("charging"), "device_tracker.car": st("Work") }));
    await expect(badge.locator("css=svg:has(.fp3-bolt)")).toBeVisible();
    await expect(badge.locator("css=svg:has(.fp3-away)")).toBeVisible();
    await setStates(page, STATES({ "sensor.car_battery": st("unavailable") }));
    await expect(badge.locator("css=.fp3-cv")).toBeHidden();
  });

  test("review finding 6: a dead main entity wears the gone mark in the badge, as the plan does; alive again takes it off", async ({ page }) => {
    await boot(page, layoutOf("sedan"), STATES());
    const gone = card(page).locator("css=.fp3-car svg.fp3-gone");
    await expect(gone).toBeHidden();
    await setStates(page, STATES({ "device_tracker.car": st("unavailable") }));
    await expect(gone).toBeVisible();
    await setStates(page, STATES());
    await expect(gone).toBeHidden();
  });
});

test.describe("3D view: away is real transparency without broken depth", () => {
  const AWAY = STATES({ "device_tracker.car": st("not_home") });

  test("away: every part is transparent at 0.35, writes no depth, draws after its depth twin; home again restores it in place", async ({ page }) => {
    await boot(page, layoutOf("sedan"), STATES());
    const builds = await hook(page, (h) => h.live().builds);
    await setStates(page, AWAY);
    const faded = (await pieces(page)).filter((p) => p.index === 0);
    expect(faded).toHaveLength(8);
    for (const p of faded) {
      expect(p, p.tag).toMatchObject({ transparent: true, opacity: 0.35, depthWrite: false, renderOrder: 2, depthFunc: 3 /* LessEqualDepth */, twin: { visible: true, colorWrite: false, depthWrite: true, renderOrder: 1 } });
    }
    await setStates(page, STATES());
    for (const p of (await pieces(page)).filter((q) => q.index === 0)) expect(p, p.tag).toMatchObject({ transparent: false, opacity: 1, depthWrite: true, renderOrder: 0, twin: { visible: false } });
    expect(await hook(page, (h) => h.live().builds), "no rebuild").toBe(builds);
  });

  test("a wheel behind the body does not show through it; the car is still fainter than at home", async ({ page }) => {
    await boot(page, layoutOf("sedan"), STATES());
    const s = carSpec("sedan");
    await hook(page, (h) => h.look(0, 1.25));
    await still(page);
    // The far (north) rear wheel's inner face, low, seen from the south through the near side of the body.
    const p = await at(page, CX - s.w / 2 + 0.18 * s.w, CY - s.h / 2 + 24, 20);
    const home = await mean(page, p);
    await setStates(page, AWAY);
    const shown = await mean(page, p);
    await hook(page, (h) => h.carParts("car-tyre", false));
    await still(page);
    const hidden = await mean(page, p);
    expect(dist(shown, hidden), "the same with the wheels shown and hidden").toBeLessThanOrEqual(9); // 3 per channel
    expect(dist(shown, home), "faded, not the home body").toBeGreaterThan(24);
  });
});

// B53.3, spec E item 30: while charging, the body's emissive goes toward --fp-dev-car on a 2.4 s breath; under reduced motion it holds still.
// The view draws frames while it breathes, so `still` cannot be waited for here: the states are handed over and the emissive is sampled over time.
const CHARGING = STATES({ "sensor.car_charging": st("charging") });
const handOver = (page: Page, states: Record<string, unknown>) => page.evaluate((states) => { const el = document.getElementById("card") as unknown as { hass: { callService: unknown } }; el.hass = { ...el.hass, states } as never; }, states);
const lightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
const bodyEmissive = async (page: Page) => (await part(page, "car-body"))[0].emissive;
async function sample(page: Page, n: number, gap: number) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(await bodyEmissive(page)); await page.waitForTimeout(gap); }
  return out;
}

test.describe("3D view: the charging breath", () => {
  test("the body's emissive moves toward the charge colour and swells and fades; not charging, it is black", async ({ page }) => {
    await boot(page, layoutOf("sedan"), STATES());
    expect(await bodyEmissive(page)).toBe("#000000");
    await handOver(page, CHARGING);
    const charge = await cssHex(page, "var(--fp-dev-car, var(--fp-active))");
    await expect.poll(() => bodyEmissive(page), { timeout: 5000 }).not.toBe("#000000");
    const seen = await sample(page, 14, 200); // 2.8 s: one full breath and a bit
    const l = seen.map(lightness);
    expect(new Set(seen).size, "it changes from frame to frame").toBeGreaterThan(4);
    expect(Math.max(...l) - Math.min(...l), "swing is wide, not a flicker").toBeGreaterThan(0.2 * Math.max(...l));
    expect(Math.max(...l), "never brighter than the charge colour itself").toBeLessThan(lightness(charge));
    expect(Math.min(...l), "never off while charging").toBeGreaterThan(0);
    // toward the charge colour: its strongest channel is the strongest of the emissive
    const strongest = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, v, i, arr) => (v > arr[a] ? i : a), 0);
    for (const s of seen) expect(strongest(s)).toBe(strongest(charge));
    await handOver(page, STATES());
    await expect.poll(() => bodyEmissive(page), { timeout: 5000 }).toBe("#000000");
  });

  test("under reduced motion the emissive is lit and does not move", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page, layoutOf("sedan"), STATES());
    await setStates(page, CHARGING);
    const seen = await sample(page, 8, 350); // 2.8 s
    expect(seen[0]).not.toBe("#000000");
    expect(new Set(seen).size, "one value, held").toBe(1);
  });
});
