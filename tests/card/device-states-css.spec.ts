import { test, expect, type Page } from "@playwright/test";
import { demo } from "./helpers-3d";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";
import { DEVICE_TYPES } from "../../src/core/schema";

// S23.4 (V9 first rule, V10, V11): off is quiet, on is solid. Read back from Chromium (finding 10: a CSS string is blind to
// specificity; `.dev.dev-motion path` and the per-type rules both compete with the on glyph). The markup is renderFloor's own.

const st = (state: string, attributes: object = {}) => ({ state, attributes, last_changed: "2026-09-19T10:00:00Z" });
/** A state that turns each type on, or null for a type that has no on (finding 17: every member is a decision written here). */
const ON: Record<string, ReturnType<typeof st> | null> = {
  ac: st("cool", { hvac_action: "cooling" }), climate: st("heat", { hvac_action: "heating" }), heater: st("heat", { hvac_action: "heating" }),
  media: st("playing"), speaker: st("playing"), tv: st("on"), person: st("home"), alarm: st("armed_away"), vacuum: st("cleaning"),
  cover: st("open", { device_class: "garage" }),
};
const onState = (t: string) => (t in ON ? ON[t] : st("on"));
const ALL = DEVICE_TYPES.map((type, i) => ({ id: `d${i}`, type, entity: `${type === "siren" ? "siren" : "x"}.d${i}`, x: 60 + (i % 8) * 100, y: 80 + Math.floor(i / 8) * 120 }));
const markup = (state: Record<string, unknown>, devices = ALL, extra: object = {}) =>
  renderFloor({ ...structuredClone(demo.floors.ground), rooms: [], devices } as never, { scale: 1, state: state as never, now: Date.parse("2026-09-19T10:00:05Z"), ...extra });
const plan = (theme: string, body: string) => {
  const [t, mode] = theme === "ha-dark" ? ["ha", "dark"] : [theme, "light"];
  return `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg width="900" height="600" viewBox="0 0 900 600"><g data-theme="${t}" data-mode="${mode}" id="p">${body}</g></svg></body></html>`;
};
const THEMES_ALL = [...THEMES, "ha-dark"];

/** Read every device group's disc and glyph: colours resolved to 0..255 on a canvas (an oklch mix reads back as oklch()). */
const read = (page: Page) => page.evaluate(() => {
  const x = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const rgb = (c: string) => { x.clearRect(0, 0, 1, 1); x.fillStyle = "#000"; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); };
  const idle = getComputedStyle(document.querySelector("#p")!).getPropertyValue("--fp-idle").trim();
  return { idle: rgb(idle), devs: [...document.querySelectorAll("#p g[data-x]")].map((g) => {
    const h = getComputedStyle(g.querySelector(".halo")!), p = getComputedStyle(g.querySelector("path:not(.cone)")!);
    return { cls: g.getAttribute("class")!, disc: rgb(h.fill), discOp: parseFloat(h.fillOpacity), stroke: h.stroke, glyph: rgb(p.fill), glyphOp: parseFloat(p.fillOpacity) * parseFloat(p.opacity) };
  }) };
});
const lum = (c: number[]) => { const l = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a: number[], b: number[]) => { const [h, l] = [lum(a), lum(b)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };

test("every device type that can be on is on with the state the test gives it", () => {
  // The contrast test below only proves something for a type that is drawn on; a type with no on is listed in ON as null.
  const state = Object.fromEntries(ALL.flatMap((d) => (onState(d.type) ? [[d.entity, onState(d.type)]] : [])));
  const out = markup(state);
  for (const d of ALL) if (onState(d.type)) expect(out, d.type).toMatch(new RegExp(`data-x="${ALL.indexOf(d)}" class="dev dev-${d.type}[^"]* on[ "]`));
});

for (const theme of THEMES_ALL) {
  test(`${theme}: on is a solid disc in the device colour with a glyph at 4.5:1 or better, for every type`, async ({ page }) => {
    const state = Object.fromEntries(ALL.flatMap((d) => (onState(d.type) ? [[d.entity, onState(d.type)]] : [])));
    await page.setContent(plan(theme, markup(state)));
    const { devs } = await read(page);
    for (const [i, d] of devs.entries()) {
      if (!onState(ALL[i].type)) continue;
      expect(d.discOp, `${ALL[i].type} disc`).toBe(1);
      expect(ratio(d.disc, d.glyph), `${ALL[i].type}: glyph ${d.glyph} on disc ${d.disc}`).toBeGreaterThanOrEqual(4.5);
      expect(d.glyphOp, `${ALL[i].type} glyph opacity`).toBe(1);
    }
  });

  test(`${theme}: off is the glyph alone, idle at .7, no disc and no ring`, async ({ page }) => {
    // off a day ago: a motion sensor that went off seconds ago is still fading from its alert colour, on purpose
    const state = Object.fromEntries(ALL.map((d) => [d.entity, { ...st(d.type === "alarm" ? "disarmed" : "off"), last_changed: "2026-09-18T10:00:00Z" }]));
    await page.setContent(plan(theme, markup(state)));
    const { idle, devs } = await read(page);
    for (const [i, d] of devs.entries()) {
      const type = ALL[i].type;
      expect(d.cls, type).not.toMatch(/\bon\b/);
      expect(d.discOp, `${type} disc`).toBe(0);
      expect(d.stroke, `${type} ring`).toBe("none");
      expect(d.glyphOp, `${type} glyph opacity`).toBeCloseTo(0.7, 5);
      if (type !== "camera") expect(d.glyph, `${type} glyph`).toEqual(idle); // a camera keeps its own static tint
    }
  });
}

test("an off device still takes a click on its disc area (the clear disc is painted, not fill:none)", async ({ page }) => {
  await page.setContent(plan("light", markup({ "x.d1": st("off") })));
  const box = (await page.locator('#p g[data-x="1"] .halo').boundingBox())!;
  // a point inside the disc but off the glyph: just inside the top edge
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("g[data-x]")?.getAttribute("data-x"), [box.x + box.width / 2, box.y + 3]);
  expect(hit).toBe("1");
});

test("a lamp's own rgb colour fills its disc, and its glyph picks an ink that reads on it, pale or dark", async ({ page }) => {
  const lamps = [{ id: "a", type: "light", entity: "light.a", x: 100, y: 100 }, { id: "b", type: "light", entity: "light.b", x: 300, y: 100 }];
  const state = { "light.a": st("on", { rgb_color: [255, 230, 0] }), "light.b": st("on", { rgb_color: [20, 20, 120] }) };
  for (const theme of ["light", "blueprint"]) {
    await page.setContent(plan(theme, markup(state, lamps as never)));
    const { devs } = await read(page);
    expect(devs[0].disc).toEqual([255, 230, 0]);
    expect(devs[1].disc).toEqual([20, 20, 120]);
    for (const d of devs) expect(ratio(d.disc, d.glyph), `${theme} ${d.disc}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("a layout's own device colour gets its own ink: a pale yellow light and a dark navy TV both read", async ({ page }) => {
  const devs2 = [{ id: "a", type: "light", entity: "light.a", x: 100, y: 100 }, { id: "b", type: "tv", entity: "media_player.b", x: 300, y: 100 }];
  const state = { "light.a": st("on"), "media_player.b": st("on") };
  await page.setContent(plan("blueprint", markup(state, devs2 as never, { colors: { light: "#ffff66", tv: "#101040" } })));
  const { devs } = await read(page);
  expect(devs[0].disc).toEqual([255, 255, 102]);
  expect(devs[1].disc).toEqual([16, 16, 64]);
  for (const d of devs) expect(ratio(d.disc, d.glyph), `${d.disc}`).toBeGreaterThanOrEqual(4.5);
});

test("a plug's heat colour fills its disc and the glyph reads on it at every step of the ramp", async ({ page }) => {
  const watts = [0, 300, 600, 900, 1200, 1500, 1800, 2100];
  const plugs = watts.map((w, i) => ({ id: `p${i}`, type: "plug", entity: `switch.p${i}`, power: `sensor.p${i}`, x: 60 + i * 100, y: 100 }));
  const state = Object.fromEntries(watts.flatMap((w, i) => [[`switch.p${i}`, st("on")], [`sensor.p${i}`, st(String(w), { unit_of_measurement: "W" })]]));
  await page.setContent(plan("light", markup(state, plugs as never, { plugHeat: [0, 2000], plugWatts: 0 })));
  const { devs } = await read(page);
  expect(new Set(devs.map((d) => d.disc.join())).size, "the ramp moves").toBeGreaterThan(4);
  for (const d of devs) expect(ratio(d.disc, d.glyph), `${d.disc}`).toBeGreaterThanOrEqual(4.5);
});

test("blueprint idle is a quiet blue-grey, not the saturated mid-blue it was", async ({ page }) => {
  await page.setContent(plan("blueprint", markup({})));
  const { idle } = await read(page);
  const [r, g, b] = idle.map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  expect(sat, `idle ${idle}`).toBeLessThan(0.15); // the old shade 0.42 of #1c3f73 was about .5
});
