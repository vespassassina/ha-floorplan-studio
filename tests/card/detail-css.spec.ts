import { test, expect, type Page } from "@playwright/test";
import { demo } from "./helpers-3d";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core/render";
import { DEVICE_TYPES } from "../../src/core/schema";
import type { DetailLevel } from "../../src/core/detail";

// S25.2: what each detail level hides, read back from Chromium (finding 10: a CSS string says nothing about
// specificity; `g.dev.on path` and the per-type rules compete with the level rules). The markup is renderFloor's own.

const st = (state: string, attributes: object = {}) => ({ state, attributes, last_changed: "2026-09-19T10:00:00Z" });
/** A state that turns each type on (device-states-css.spec.ts has the same table). */
const ON: Record<string, ReturnType<typeof st>> = {
  ac: st("cool", { hvac_action: "cooling" }), climate: st("heat", { hvac_action: "heating" }), heater: st("heat", { hvac_action: "heating" }),
  media: st("playing"), speaker: st("playing"), tv: st("on"), person: st("home"), alarm: st("armed_away"), vacuum: st("cleaning"),
  cover: st("open", { device_class: "garage" }),
};
const onState = (t: string) => ON[t] ?? st("on");
const offState = (t: string) => ({ ...st(t === "alarm" ? "disarmed" : "off"), last_changed: "2026-09-18T10:00:00Z" });
const goneState = () => st("unavailable");
const ALL = DEVICE_TYPES.map((type, i) => ({ id: `d${i}`, type, entity: `${type === "siren" ? "siren" : "x"}.d${i}`, x: 60 + (i % 8) * 100, y: 80 + Math.floor(i / 8) * 120 }));
const plan = (level: DetailLevel | undefined, state: Record<string, unknown>, extra: object = {}, floor: object = {}) => {
  const body = renderFloor({ ...structuredClone(demo.floors.ground), rooms: [], devices: ALL, ...floor } as never,
    { scale: 1, theme: "light", state: state as never, now: Date.parse("2026-09-19T10:00:05Z"), ...(level ? { detail: level } : {}), ...extra });
  return `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg width="900" height="600" viewBox="0 0 900 600" id="p">${body}</svg></body></html>`;
};
const states = (f: (t: string) => unknown) => Object.fromEntries(ALL.map((d) => [d.entity, f(d.type)]));

/** Per device group: is it drawn, is its glyph drawn, is its disc drawn and how big. */
const read = (page: Page) => page.evaluate(() => [...document.querySelectorAll("#p g[data-x]")].map((g) => {
  const p = g.querySelector("path:not(.cone)")!, h = g.querySelector(".halo")!;
  return { group: getComputedStyle(g).display, glyph: getComputedStyle(p).display, halo: getComputedStyle(h).display, haloTf: getComputedStyle(h).transform, cls: g.getAttribute("class")! };
}));

const sets: [string, (t: string) => unknown][] = [["on", onState], ["unavailable", goneState]];

test("far: an idle device is not drawn, for every type", async ({ page }) => {
  await page.setContent(plan("far", states(offState)));
  const devs = await read(page);
  expect(devs).toHaveLength(DEVICE_TYPES.length);
  for (const [i, d] of devs.entries()) {
    expect(d.cls, ALL[i].type).toMatch(/\boff\b/);
    expect(d.group, ALL[i].type).toBe("none");
  }
});

for (const [name, f] of sets) {
  test(`far: a device that is ${name} stays as a dot (disc kept and smaller, glyph gone), for every type`, async ({ page }) => {
    await page.setContent(plan("far", states(f)));
    const devs = await read(page);
    for (const [i, d] of devs.entries()) {
      const t = ALL[i].type;
      expect(d.group, t).not.toBe("none");
      expect(d.glyph, `${t} glyph`).toBe("none");
      expect(d.halo, `${t} disc`).not.toBe("none");
      // asymmetric: a 0.5 scale, not the identity (matrix(1, 0, 0, 1, 0, 0)) and not "none"
      expect(d.haloTf, `${t} dot`).toMatch(/^matrix\(0\.5, 0, 0, 0\.5,/);
    }
  });
}

test("far: a danger device (a siren that sounds) is a dot too", async ({ page }) => {
  await page.setContent(plan("far", { [`siren.d${DEVICE_TYPES.indexOf("siren")}`]: st("on") }));
  const d = (await read(page))[DEVICE_TYPES.indexOf("siren")];
  expect(d.cls).toMatch(/\bon\b/);
  expect(d.group).not.toBe("none");
  expect(d.glyph).toBe("none");
});

test("far: the selected device is drawn whole even if idle", async ({ page }) => {
  await page.setContent(plan("far", states(offState), { selection: { t: "dev", i: 3 } }));
  const devs = await read(page);
  expect(devs[3].cls).toMatch(/\bsel\b/);
  expect(devs[3].group).not.toBe("none");
  expect(devs[3].glyph).not.toBe("none");
  expect(devs[3].haloTf).toBe("none");
  expect(devs[4].group).toBe("none");
});

for (const level of ["mid", "near", undefined] as const) {
  test(`${level ?? "no data-detail"}: every device is drawn whole, idle or on`, async ({ page }) => {
    for (const f of [offState, onState]) {
      await page.setContent(plan(level, states(f)));
      for (const [i, d] of (await read(page)).entries()) {
        expect(d.group, ALL[i].type).not.toBe("none");
        expect(d.glyph, ALL[i].type).not.toBe("none");
        expect(d.haloTf, ALL[i].type).toBe("none");
      }
    }
  });
}

// Text: a device's name and its reading go at mid and far; a room's name and reading, and an extra's name, never.
const T_FLOOR = {
  outline: [[0, 0], [1000, 0], [1000, 600], [0, 600]],
  rooms: [{ id: "r", name: "Kitchen", area: "", kind: "room", pts: [[0, 0], [1000, 0], [1000, 600], [0, 600]], wk: ["wall", "wall", "wall", "wall"], temps: ["sensor.rt"] }],
  extras: [{ a: [100, 500], b: [300, 500], name: "Shelf" }],
  devices: [{ id: "t", type: "temp", name: "Probe", entity: "sensor.t", x: 700, y: 200 }, { id: "l", type: "light", name: "Lamp", entity: "light.l", x: 800, y: 400 }],
};
const T_STATE = { "sensor.t": st("21.5", { unit_of_measurement: "°C" }), "sensor.rt": st("19.0", { unit_of_measurement: "°C" }), "light.l": st("on") };
const texts = (page: Page) => page.evaluate(() => {
  const shown = (sel: string) => [...document.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.textContent);
  return { devName: shown("text.lbl:not([data-rl]):not(.extra + .lbl)"), devVal: shown("text.val:not([data-rv])"), room: shown("text.lbl[data-rl]"), roomVal: shown("text.val[data-rv]"), extra: shown(".extra + text.lbl") };
});

for (const [level, devs] of [["far", false], ["mid", false], ["near", true], [undefined, true]] as const) {
  test(`${level ?? "no data-detail"}: device names and readings ${devs ? "show" : "go"}; room names, room readings and extras stay`, async ({ page }) => {
    await page.setContent(plan(level, T_STATE, { showNames: true }, T_FLOOR));
    const t = await texts(page);
    expect(t.devName.length > 0, "device name").toBe(devs);
    expect(t.devVal, "device reading").toEqual(devs ? ["21.5 °C"] : []);
    expect(t.room, "room name").toEqual(["Kitchen"]);
    expect(t.roomVal, "room reading").toEqual(["19 °C"]);
    expect(t.extra, "extra name").toEqual(["Shelf"]);
  });
}
