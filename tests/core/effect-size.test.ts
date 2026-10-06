import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { migrate } from "../../src/core/migrate";
import { DEVICE_TYPES, FX_MAX, FX_MIN, FX_TYPES, drawsEffect, validate, type DeviceType, type Layout } from "../../src/core/schema";
import { liveOf } from "../../src/core/live";
import { FLOORPLAN_CSS, LIGHT_REACH, renderFloor, viewBoxFor, type StateOverlay } from "../../src/core/render";

// S14.3: a device's effect size, `fx`, a percent of the type's own aura, ring or wave. Absent means 100.
const L = demo as unknown as Layout;
const ground = L.floors.ground;
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-09-19T10:00:00Z" });
const base = { scale: 0.5, now: Date.parse("2026-09-19T10:00:05Z"), fade: 10 };
const dev = (type: string, entity: string, extra: object = {}) => ({ id: `${type}-x`, type, entity, x: 400, y: 300, ...extra });
const draw = (devices: unknown[], state: StateOverlay) => renderFloor({ ...structuredClone(ground), devices } as never, { ...base, state });
const group = (html: string) => html.match(/<g data-x="0"[^>]*>.*?<\/g>/s)![0];
const opening = (html: string) => html.match(/<g data-x="0"[^>]*>/)![0];
/** The state that makes each type draw its effect, if it draws one. */
const ACTIVE = (type: string) => (type === "speaker" || type === "media" ? "playing" : "on");

describe("fx in validate and migrate", () => {
  const withFx = (v: unknown) => { const l = structuredClone(demo) as any; l.floors.ground.devices[0].fx = v; return l; };
  const errorsOf = (l: unknown) => { const r = validate(l); return r.ok ? [] : r.errors; };
  it("accepts the bounds and anything between, and an absent field", () => {
    expect(FX_MIN).toBe(25); expect(FX_MAX).toBe(300);
    for (const v of [25, 26.5, 100, 150, 299.9, 300]) expect(errorsOf(withFx(v)), String(v)).toEqual([]);
    expect(errorsOf(structuredClone(demo))).toEqual([]);
  });
  it("refuses junk and out-of-range values, one error that names the floor, the device and the range", () => {
    for (const v of [24.99, 300.01, 0, -100, NaN, Infinity, "150", null, {}, [], true]) {
      const e = errorsOf(withFx(v)).filter((m) => m.includes("fx"));
      expect(e.length, String(v)).toBe(1);
      expect(e[0]).toContain("floor ground:");
      expect(e[0]).toContain(ground.devices[0].id);
      expect(e[0]).toMatch(/25 to 300/);
    }
  });
  it("migrate keeps a valid value and drops junk, so the file opens and validates", () => {
    expect((migrate(withFx(77)).floors.ground.devices[0] as any).fx).toBe(77);
    for (const v of [24, 301, 0, NaN, Infinity, "150", null, {}, [], true, -3]) {
      const m = migrate(withFx(v));
      expect("fx" in m.floors.ground.devices[0], String(v)).toBe(false);
      expect(validate(m).ok, String(v)).toBe(true);
    }
  });
  it("migrate survives a __proto__ floor and devices that are not objects, and gives the demo back unchanged", () => {
    const l: any = JSON.parse('{"version":2,"north":0,"floors":{"__proto__":{"devices":[5,{"id":"d","type":"light","entity":"light.a","x":1,"y":1,"fx":"big"}]}},"catalog":[]}');
    const f: any = Object.values(migrate(l).floors)[0];
    expect(f.devices).toHaveLength(1);
    expect(f.devices[0]).not.toHaveProperty("fx");
    expect(JSON.stringify(migrate(structuredClone(demo)))).not.toContain('"fx"');
    expect(migrate(structuredClone(demo))).toEqual(demo);
  });
});

describe("which types draw an effect", () => {
  it("every device type is decided: it draws a ring, an aura or a wave exactly when FX_TYPES lists it", () => {
    for (const type of DEVICE_TYPES as readonly DeviceType[]) {
      const html = draw([dev(type, "x.y", { fx: 150 })], { "x.y": st(ACTIVE(type)) });
      const drew = /class="(aura|ping|wave|siren-ring)/.test(html);
      expect(drew, type).toBe((FX_TYPES as readonly string[]).includes(type));
      expect(drawsEffect({ type, entity: "x.y" }), type).toBe(drew);
    }
    expect([...FX_TYPES].sort()).toEqual(["contact", "light", "media", "motion", "speaker"]);
  });
  it("a siren is a device whose entity is in the siren domain, whatever its type", () => {
    expect(drawsEffect({ type: "other", entity: "siren.hall" })).toBe(true);
    expect(drawsEffect({ type: "switch", entity: "switch.siren_power" })).toBe(false);
    expect(drawsEffect({ type: "other", entity: "x.y" })).toBe(false);
  });
});

describe("the size is read by the picture", () => {
  it("2D is byte-identical when the field is absent or 100: no custom property, same markup", () => {
    const state: StateOverlay = { "light.l": st("on"), "binary_sensor.m": st("on"), "media_player.s": st("playing") };
    const devs = [dev("light", "light.l"), dev("motion", "binary_sensor.m"), dev("speaker", "media_player.s")];
    const plain = draw(devs, state);
    expect(plain).not.toContain("--fp-fx");
    expect(draw(devs.map((d) => ({ ...d, fx: 100 })), state)).toBe(plain);
  });
  it("a lit lamp's aura reach is 150 cm at 100, 225 at 150 and 75 at 50", () => {
    const r = (fx?: number) => /class="aura"[^>]* r="([\d.]+)"|class="aura" cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"/.exec(draw([dev("light", "light.l", fx === undefined ? {} : { fx })], { "light.l": st("on") }))!;
    const reach = (fx?: number) => { const m = r(fx); return Number(m[1] ?? m[2]); };
    expect(LIGHT_REACH).toBe(150);
    expect([reach(), reach(100), reach(150), reach(50), reach(300), reach(25)]).toEqual([150, 150, 225, 75, 450, 37.5]);
  });
  it("an off lamp draws no aura at any size", () => {
    expect(draw([dev("light", "light.l", { fx: 200 })], { "light.l": st("off") })).not.toContain('class="aura"');
  });
  it("the group carries --fp-fx as the fraction, for rings and waves to read", () => {
    const style = (type: string, e: string, s: string, fx: number) => opening(draw([dev(type, e, { fx })], { [e]: st(s) }));
    expect(style("speaker", "media_player.s", "playing", 150)).toContain("--fp-fx:1.5");
    expect(style("speaker", "media_player.s", "playing", 50)).toContain("--fp-fx:0.5");
    expect(style("motion", "binary_sensor.m", "on", 300)).toContain("--fp-fx:3");
    expect(style("contact", "binary_sensor.c", "on", 150)).toContain("--fp-fx:1.5");
    expect(style("other", "siren.hall", "on", 200)).toContain("--fp-fx:2");
  });
  it("a type that draws no effect ignores the field", () => {
    expect(draw([dev("plug", "x.y", { fx: 200 })], { "x.y": st("on") })).toBe(draw([dev("plug", "x.y")], { "x.y": st("on") }));
  });
  it("the box that fits the plan grows with a lamp's reach", () => {
    const f = (fx?: number) => ({ ...structuredClone(ground), devices: [{ ...dev("light", "light.l", fx === undefined ? {} : { fx }), x: 0, y: 0 }] }) as never;
    const w = (fx?: number) => viewBoxFor(f(fx)).w;
    // A lamp in the corner: 37.5 cm reach (25 %) stays inside the margin, 150 sticks out, 450 sticks out three times as far.
    expect(w(300)).toBeGreaterThan(w());
    expect(w()).toBeGreaterThan(w(25));
    expect(w(300) - w()).toBeCloseTo(300);
  });
  it("junk in a layout that skipped migrate draws at 100", () => {
    for (const fx of ["big", NaN, -5, 0, Infinity, null, 9999]) {
      const html = draw([dev("light", "light.l", { fx })], { "light.l": st("on") });
      expect(html, String(fx)).toContain('r="150"');
      expect(html, String(fx)).not.toContain("--fp-fx");
    }
  });
});

describe("a siren's alert is louder than any other device's", () => {
  it("an on siren draws two staggered rings; off, unavailable, or not a siren, none", () => {
    const on = group(draw([dev("other", "siren.hall")], { "siren.hall": st("on") }));
    expect((on.match(/class="siren-ring/g) ?? []).length).toBe(2);
    expect(on).toMatch(/<circle class="siren-ring" cx="12" cy="12" r="16"[^>]*\/><circle class="siren-ring w2" cx="12" cy="12" r="16"[^>]*\/><circle class="halo"/);
    for (const s of ["off", "unavailable", "unknown"]) expect(group(draw([dev("other", "siren.hall")], { "siren.hall": st(s) })), s).not.toContain("siren-ring");
    expect(group(draw([dev("other", "siren.hall")], {}))).not.toContain("siren-ring");
    expect(group(draw([dev("other", "switch.hall")], { "switch.hall": st("on") }))).not.toContain("siren-ring");
  });
  it("the stylesheet gives it 2x the speaker's radius and a stronger pulse, and reduced motion keeps it steady, 2x too", () => {
    const rule = (re: RegExp) => FLOORPLAN_CSS.match(re)?.[1] ?? "";
    const wave = rule(/@keyframes fp-wave\{from\{[^}]*\}to\{transform:scale\(calc\(([^}]*)\)\)/), siren = rule(/@keyframes fp-siren\{from\{[^}]*\}to\{transform:scale\(calc\(([^}]*)\)\)/);
    expect(wave).toBe("1 + 1.4*var(--fp-fx,1)");
    expect(siren).toBe("1 + 3.8*var(--fp-fx,1)"); // 4.8 at the end against 2.4: twice the radius
    const w = FLOORPLAN_CSS.match(/\.wave\{[^}]*stroke-width:(\d+(?:\.\d+)?)[^}]*animation:fp-wave ([\d.]+)s/)!, s = FLOORPLAN_CSS.match(/\.siren-ring\{[^}]*stroke-width:(\d+(?:\.\d+)?)[^}]*animation:fp-siren ([\d.]+)s/)!;
    expect(Number(s[1])).toBeGreaterThan(Number(w[1]));
    expect(Number(s[2])).toBeLessThan(Number(w[2]));
    expect(FLOORPLAN_CSS).toContain(".siren-ring{transform:scale(calc(1 + 2*var(--fp-fx,1)))");
    expect(FLOORPLAN_CSS).toContain(".ping,.door-alert,.wave,.siren-ring{animation:none}");
  });
});

describe("the 3D view is told the size", () => {
  const live = (fx?: unknown) => {
    const f = { ...structuredClone(ground), devices: [dev("light", "light.l", fx === undefined ? {} : { fx }), dev("speaker", "media_player.s", fx === undefined ? {} : { fx }), dev("other", "siren.a", fx === undefined ? {} : { fx })] } as never;
    return liveOf(f, { ...base, state: { "light.l": st("on"), "media_player.s": st("playing"), "siren.a": st("on") } }, base.now);
  };
  it("a lit lamp carries its size as a fraction; at 100 or without the field the JSON is the same as before", () => {
    expect(live(150).lights[0].scale).toBe(1.5);
    expect(live(50).lights[0].scale).toBe(0.5);
    expect(live().lights[0]).not.toHaveProperty("scale");
    expect(JSON.stringify(live(100))).toBe(JSON.stringify(live()));
    expect(live("big").lights[0]).not.toHaveProperty("scale"); // junk that skipped migrate reads as 100
  });
  it("the icons carry --fp-fx for the rings, and a siren's icon carries its rings", () => {
    const l = live(200);
    expect(l.devices[1]!.style).toContain("--fp-fx:2");
    expect(l.devices[2]!.style).toContain("--fp-fx:2");
    expect(l.devices[2]!.icon).toContain("siren-ring");
    expect(l.devices[2]!.klass).toContain("siren");
    expect(live().devices[1]!.style).toBe("");
  });
});
