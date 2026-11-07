import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, validate, type Floor } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { FLOORPLAN_CSS, THEMES, renderFloor, type StateOverlay } from "../../src/core/render";
import { liveDeps } from "../../src/core/three-deps";
import { makeLiveOf } from "../../src/core/live-build";

// B54.4, spec D (items 24-28), criterion 6: `underfloor: true` on a climate or heater. While its hvac_action is "heating" the room that holds
// the icon gets a warm wash and a pipe pattern; nothing else does. A layout is untrusted (finding 1): validate never throws, migrate drops
// what validate would refuse. State shapes are HA's climate entity: state is the hvac mode, `hvac_action` the live action (same as classOf reads).
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-11-07T10:00:00Z" });
const device = (type: string, extra: Record<string, unknown> = {}) => ({ id: "d1", type, entity: type === "climate" ? "climate.floor" : "light.x", x: 100, y: 100, ...extra });
const layoutOf = (d: unknown) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { Ground: { title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [d], furniture: [], unlinked: [] } } });
const errorsOf = (d: unknown): string[] => { const r = validate(layoutOf(d)); return r.ok ? [] : r.errors; };
const deviceOf = (l: unknown) => (l as { floors: { Ground: { devices: Record<string, unknown>[] } } }).floors.Ground.devices[0];

describe("validate: underfloor", () => {
  it("accepts true on a climate and a heater, and none", () => {
    expect(errorsOf(device("climate", { underfloor: true }))).toEqual([]);
    expect(errorsOf(device("heater", { entity: "climate.h", underfloor: true }))).toEqual([]);
    expect(errorsOf(device("climate"))).toEqual([]);
  });
  it("refuses it on every other type and names the device", () => {
    for (const t of DEVICE_TYPES.filter((x) => x !== "climate" && x !== "heater")) {
      const e = errorsOf(device(t, { underfloor: true }));
      expect(e.length, t).toBe(1);
      expect(e[0], t).toMatch(/d1 underfloor is only allowed on a climate or heater/);
    }
  });
  it("refuses a value that is not true", () => {
    for (const bad of [false, "true", 1, null, {}, []]) expect(errorsOf(device("climate", { underfloor: bad })).join("\n"), String(bad)).toMatch(/d1 underfloor must be true/);
  });
  it("never throws on hostile devices", () => {
    for (const d of [{ type: "climate", underfloor: Symbol.iterator }, { type: "__proto__", underfloor: true }, { type: "climate", underfloor: { valueOf() { throw new Error("x"); } } }, null, 5])
      expect(() => validate(layoutOf(d))).not.toThrow();
  });
});

describe("migrate: underfloor", () => {
  it("keeps true on a climate and a heater", () => {
    expect(deviceOf(migrate(layoutOf(device("climate", { underfloor: true })))).underfloor).toBe(true);
    expect(deviceOf(migrate(layoutOf(device("heater", { underfloor: true })))).underfloor).toBe(true);
  });
  it("drops it from other types and when it is not true, and the result validates", () => {
    for (const [t, v] of [["light", true], ["switch", true], ["climate", false], ["climate", "true"], ["heater", 1], ["heater", null]] as const) {
      const l = migrate(layoutOf(device(t, { underfloor: v })));
      expect("underfloor" in deviceOf(l), `${t} ${String(v)}`).toBe(false);
      expect(validate(l).ok, `${t} ${String(v)}`).toBe(true);
    }
  });
});

// Two rooms side by side: the device at (100,100) sits in A (0..400), B (400..800) is its neighbour.
const floorOf = (devices: unknown[]): Floor => ({
  title: "F", outline: [], walls: [], stairs: [], openings: [], extras: [], unlinked: [], doors: [], furniture: [], devices,
  rooms: [
    { id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] },
    { id: "b", name: "B", area: "", kind: "room", pts: [[400, 0], [800, 0], [800, 400], [400, 400]], wk: ["wall", "wall", "wall", "wall"] },
  ],
}) as unknown as Floor;
const UF = { id: "d1", type: "climate", entity: "climate.floor", x: 100, y: 100, underfloor: true };
const heating: StateOverlay = { "climate.floor": st("heat", { hvac_action: "heating" }) };
const wash = (html: string) => [...html.matchAll(/<polygon[^>]*class="floor-heat"[^>]*>/g)].map((m) => m[0]);
const pipes = (html: string) => [...html.matchAll(/<polygon[^>]*class="floor-pipes"[^>]*>/g)].map((m) => m[0]);

describe("renderFloor: the underfloor cue", () => {
  it("washes and patterns the room that holds the icon while hvac_action is heating, and no other room", () => {
    const html = renderFloor(floorOf([UF]), { scale: 1, state: heating });
    expect(wash(html)).toHaveLength(1);
    expect(wash(html)[0]).toContain('data-fh="0"');
    expect(pipes(html)).toHaveLength(1);
    expect(pipes(html)[0]).toContain('data-fp="0"');
    expect(html).toContain('id="fp-pipes"');
  });
  it("follows the room of the icon: moved into B, B is the one", () => {
    const html = renderFloor(floorOf([{ ...UF, x: 600 }]), { scale: 1, state: heating });
    expect(wash(html)[0]).toContain('data-fh="1"');
  });
  it("shows nothing for idle, off, unavailable, a missing attribute, a missing entity or a missing flag", () => {
    for (const s of [st("heat", { hvac_action: "idle" }), st("off", { hvac_action: "off" }), st("unavailable", { hvac_action: "heating" }), st("heat", {}), st("heat", { hvac_action: "cooling" }), st("off", { hvac_action: "heating" })])
      expect(wash(renderFloor(floorOf([UF]), { scale: 1, state: { "climate.floor": s } })), JSON.stringify(s)).toHaveLength(0);
    expect(wash(renderFloor(floorOf([UF]), { scale: 1, state: {} }))).toHaveLength(0);
    expect(wash(renderFloor(floorOf([UF]), { scale: 1 }))).toHaveLength(0);
    const plain: Record<string, unknown> = { ...UF };
    delete plain.underfloor;
    expect(wash(renderFloor(floorOf([plain]), { scale: 1, state: heating }))).toHaveLength(0);
    expect(renderFloor(floorOf([UF]), { scale: 1, state: { "climate.floor": st("heat", { hvac_action: "idle" }) } })).not.toContain("fp-pipes");
  });
  it("a heater bar (a, b) counts by its middle; a flagged device outside every room has no cue", () => {
    const bar = { id: "h", type: "heater", entity: "climate.floor", a: [500, 50], b: [700, 50], underfloor: true };
    expect(wash(renderFloor(floorOf([bar]), { scale: 1, state: heating }))[0]).toContain('data-fh="1"');
    expect(wash(renderFloor(floorOf([{ ...UF, x: 2000, y: 2000 }]), { scale: 1, state: heating }))).toHaveLength(0);
  });
  it("only a climate or heater: a light carrying the flag (refused by validate) draws no cue", () => {
    expect(wash(renderFloor(floorOf([{ ...UF, type: "light", entity: "light.floor" }]), { scale: 1, state: { "light.floor": st("on", { hvac_action: "heating" }) } }))).toHaveLength(0);
  });
  it("under the heat map the pipes stay and the wash gives way", () => {
    const html = renderFloor(floorOf([UF]), { scale: 1, state: heating, heat: "temperature" });
    expect(wash(html)).toHaveLength(0);
    expect(pipes(html)).toHaveLength(1);
  });
  it("is drawn over the room fill and under the icons, and takes no click", () => {
    const html = renderFloor(floorOf([UF]), { scale: 1, state: heating });
    expect(html.indexOf('class="floor-heat"')).toBeGreaterThan(html.indexOf('data-r="0"'));
    expect(html.indexOf('class="floor-heat"')).toBeLessThan(html.indexOf('data-x="0"'));
    expect(FLOORPLAN_CSS).toMatch(/\.floor-heat\{[^}]*pointer-events:none/);
    expect(FLOORPLAN_CSS).toMatch(/\.floor-pipes\{[^}]*pointer-events:none/);
  });
  it("nothing animates", () => {
    expect(/\.floor-(heat|pipes)[^{]*\{[^}]*animation/.test(FLOORPLAN_CSS)).toBe(false);
  });
});

describe("--fp-floor-heat", () => {
  it("is set on every theme's own token line, and is a warm colour on each", () => {
    for (const th of THEMES) {
      const block = new RegExp(`\\n\\[data-theme="${th}"\\]\\{([^}]*)\\}`).exec(FLOORPLAN_CSS.replace(/,\[data-theme="[^"]+"\]\{/g, (m) => `\n${m.slice(1)}`))?.[1] ?? "";
      const hex = /--fp-floor-heat:(#[0-9a-f]{6})/i.exec(block)?.[1];
      expect(hex, th).toBeTruthy();
      const [r, , b] = [1, 3, 5].map((k) => parseInt(hex!.slice(k, k + 2), 16));
      expect(r, `${th} ${hex} is redder than blue`).toBeGreaterThan(b + 60);
    }
  });
  it("the HA dark set has it too", () => {
    expect(/\[data-theme="ha"\]\[data-mode="dark"\]\{[^}]*--fp-floor-heat:#/.test(FLOORPLAN_CSS)).toBe(true);
  });
});

describe("live3d: heated rooms", () => {
  const live = makeLiveOf(liveDeps);
  it("lists the room of a heating underfloor device, and none otherwise", () => {
    expect(live(floorOf([{ ...UF, x: 600 }]), { scale: 1, state: heating }, 0).heated).toEqual([1]);
    expect(live(floorOf([UF]), { scale: 1, state: { "climate.floor": st("heat", { hvac_action: "idle" }) } }, 0).heated).toEqual([]);
    expect(live(floorOf([UF]), { scale: 1 }, 0).heated).toEqual([]);
  });
});
