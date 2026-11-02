import { describe, it, expect } from "vitest";
import { CAR_MODELS, type Floor, type Furniture } from "../../src/core/schema";
import { activeDevices } from "../../src/core/active";
import { classOf, renderFloor, viewBoxFor, contentPoints, FLOORPLAN_CSS, THEMES, type StateOverlay } from "../../src/core/render";
import { carParts, carTop } from "../../src/core/car";
import { migrate } from "../../src/core/migrate";

// S35.4, spec C4, C5, C7, criteria 5 and 6. States are copied from the integrations' value lists (finding 21): Renault sends
// `binary_sensor` class battery_charging, Tesla and Volvo a `sensor` enum "charging", a device_tracker says home, not_home or a zone.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-17T10:00:00Z" });
const car = (extra: Partial<Furniture> = {}): Furniture => ({ id: "car", symbol: "car", x: 300, y: 200, rot: 0, w: 470, h: 182, ...extra }) as Furniture;
const floorOf = (furniture: Furniture[]): Floor => ({
  title: "F", outline: [], walls: [], stairs: [], openings: [], extras: [], unlinked: [], doors: [], devices: [], furniture,
  rooms: [{ id: "r0", name: "Garage", area: "", kind: "room", pts: [[0, 0], [800, 0], [800, 500], [0, 500]], wk: ["wall", "wall", "wall", "wall"] }],
}) as unknown as Floor;
const draw = (m: Furniture, state?: StateOverlay, view?: "2.5d") => renderFloor(floorOf([m]), { scale: 1, ...(state ? { state } : {}), ...(view ? { view } : {}) });
const groupOf = (html: string) => /<g data-f="0"[^>]*>/.exec(html)?.[0] ?? "";
const WIRED = { entity: "device_tracker.car", attached: ["sensor.car_battery", "binary_sensor.car_charging", "lock.car_doors"] };
const HOME: StateOverlay = { "device_tracker.car": st("home"), "sensor.car_battery": st("78", { device_class: "battery", unit_of_measurement: "%" }), "binary_sensor.car_charging": st("off", { device_class: "battery_charging" }), "lock.car_doors": st("locked") };

describe("renderFloor: the car piece draws its model", () => {
  it("every model draws its own silhouette in the piece's group, in 2D and 2.5D", () => {
    const seen = new Set<string>();
    for (const model of CAR_MODELS) {
      const top = carTop(model);
      seen.add(top);
      expect(draw(car({ model })), `2D ${model}`).toContain(top);
      expect(draw(car({ model }), undefined, "2.5d"), `2.5D ${model}`).toContain(top);
    }
    expect(seen.size, "nine different silhouettes").toBe(CAR_MODELS.length);
  });
  it("a car with none of the new keys and no states is a sedan, only its own group changed", () => {
    const html = draw(car());
    expect(html).toContain(carTop("sedan"));
    expect(groupOf(html)).toMatch(/class="furn furn-car"/);
    expect(groupOf(html)).not.toContain("style=");
    for (const w of [" away", " charging", " alert"]) expect(groupOf(html)).not.toContain(w);
    expect(html).not.toContain("car-marks");
    // the other furniture is byte for byte as before: no furn-car on a sofa
    expect(draw(car({ symbol: "sofa" } as never))).not.toContain("furn-car");
  });
  it("a junk model (a layout is untrusted) is a sedan, and nothing throws", () => {
    for (const model of ["Sedan", "__proto__", 5, null, {}, []]) expect(draw(car({ model } as never)), String(model)).toContain(carTop("sedan"));
  });
  it("at rot 90 the nose points down the screen: the group turns by 90 and the windscreen lies past the roof along +x of the frame", () => {
    for (const view of [undefined, "2.5d" as const]) expect(draw(car({ rot: 90 }), undefined, view)).toContain("rotate(90)");
    for (const model of CAR_MODELS) {
      const p = carParts(model), cx = (poly: [number, number][]) => poly.reduce((s, q) => s + q[0], 0) / poly.length;
      expect(cx(p.windscreen), model).toBeGreaterThan(cx(p.roof));
    }
  });
});

describe("renderFloor: the car's body colour", () => {
  it("a #rrggbb colour is a custom property on the group, never an attribute on the paint", () => {
    const html = draw(car({ color: "#c03030" }));
    expect(groupOf(html)).toContain('style="--fp-car-body:#c03030"');
    expect(html).not.toMatch(/fill="#c03030"/);
  });
  it("a forged colour, even one that skipped migrate, never reaches the markup", () => {
    for (const color of ['red"><script>alert(1)</script>', "#12345", "url(javascript:x)", 5, "#c03030;x:y"]) {
      const html = draw(car({ color } as never));
      expect(html, String(color)).not.toContain("<script");
      expect(groupOf(html), String(color)).not.toContain("style=");
    }
    const m = migrate({ version: 2, unit: "cm", north: 0, catalog: [], floors: { f: floorOf([car({ color: '"><script>' } as never)]) } });
    expect(JSON.stringify(m)).not.toContain("<script");
  });
});

describe("renderFloor: what a car's states do on the plan", () => {
  it("home: no away, no charging, no alert; the level is a value under the car", () => {
    const html = draw(car(WIRED), HOME);
    expect(groupOf(html)).not.toMatch(/ away| charging| alert/);
    expect(html).toContain("78 %");
    expect(html).not.toContain("away-mark");
  });
  it("away (not_home or a zone's name): class away and the away mark at the nose", () => {
    for (const where of ["not_home", "Work"]) {
      const html = draw(car(WIRED), { ...HOME, "device_tracker.car": st(where) });
      expect(groupOf(html), where).toMatch(/class="furn furn-car[^"]* away/);
      expect(html, where).toContain("away-mark");
    }
  });
  it("charging (Renault's binary_sensor, Tesla's enum): class charging and the bolt", () => {
    const renault = draw(car(WIRED), { ...HOME, "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }) });
    const tesla = draw(car({ entity: "device_tracker.car", attached: ["sensor.car_charge_state"] }), { "device_tracker.car": st("home"), "sensor.car_charge_state": st("charging") });
    for (const html of [renault, tesla]) { expect(groupOf(html)).toMatch(/ charging/); expect(html).toContain("car-bolt"); }
    const stopped = draw(car({ entity: "device_tracker.car", attached: ["sensor.car_charge_state"] }), { "device_tracker.car": st("home"), "sensor.car_charge_state": st("stopped") });
    expect(groupOf(stopped)).not.toMatch(/ charging/);
  });
  it("review finding 5: a charging car whose tracker is unavailable still counts as on, strokes green and shows in Active", () => {
    const state = { ...HOME, "device_tracker.car": st("unavailable"), "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }) };
    const dev = { id: "c", type: "car", entity: "device_tracker.car", attached: ["binary_sensor.car_charging"], x: 1, y: 1 } as never;
    expect(classOf(dev, { scale: 1, state })).toBe("on");
    expect(groupOf(draw(car(WIRED), state))).toMatch(/ charging/);
    expect(classOf(dev, { scale: 1, state: { ...state, "binary_sensor.car_charging": st("off", { device_class: "battery_charging" }) } })).toBe("unavailable");
    const floor = floorOf([car(WIRED)]);
    expect(activeDevices({ version: 2, unit: "cm", north: 0, catalog: [], floors: { f: floor } } as never, state as never).map((a) => a.name)).toHaveLength(1);
  });
  it("alert (an unlocked lock): class alert; charging and alert both ride the group", () => {
    const html = draw(car(WIRED), { ...HOME, "lock.car_doors": st("unlocked") });
    expect(groupOf(html)).toMatch(/ alert/);
    const both = draw(car(WIRED), { ...HOME, "lock.car_doors": st("unlocked"), "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }) });
    expect(groupOf(both)).toMatch(/ charging/);
    expect(groupOf(both)).toMatch(/ alert/);
  });
  it("a dead main entity wears the gone mark, as every device", () => {
    expect(draw(car(WIRED), { ...HOME, "device_tracker.car": st("unavailable") })).toContain("gone-mark");
    expect(draw(car(WIRED), HOME)).not.toContain("gone-mark");
  });
  it("2.5D carries the same classes and marks as 2D", () => {
    const state = { ...HOME, "device_tracker.car": st("Work"), "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }), "lock.car_doors": st("unlocked") };
    const html = draw(car(WIRED), state, "2.5d");
    expect(groupOf(html)).toMatch(/ away/); expect(groupOf(html)).toMatch(/ charging/); expect(groupOf(html)).toMatch(/ alert/);
    expect(html).toContain("away-mark"); expect(html).toContain("car-bolt"); expect(html).toContain("78 %");
  });
  it("hostile text stays text: a zone and a tracker state of \"><script> never reach the markup", () => {
    const html = draw(car({ ...WIRED, name: '"><script>x</script>' } as never), { ...HOME, "device_tracker.car": st('"><script>x</script>'), "sensor.car_battery": st('"><script>', { device_class: "battery", unit_of_measurement: "%" }) });
    expect(html).not.toContain("<script");
  });
  it("hostile states (null, numbers) do not throw", () => {
    expect(() => draw(car(WIRED), { "device_tracker.car": null, "sensor.car_battery": 5 } as never)).not.toThrow();
  });
});

/** The markup inside the `<g data-f="0">` group, by counting `<g` against `</g>` from its opening tag. */
function innerOfPiece(html: string): string {
  const at = html.indexOf('<g data-f="0"'), tag = /<g\b[^>]*>|<\/g>/g;
  tag.lastIndex = at;
  let depth = 0, m: RegExpExecArray | null;
  while ((m = tag.exec(html))) { depth += m[0] === "</g>" ? -1 : 1; if (depth === 0) return html.slice(at, m.index); }
  return html.slice(at);
}
describe("renderFloor: the marks stay outside the faded group (review finding 3)", () => {
  it("away dot, bolt and level are siblings of the car group, in 2D and in 2.5D: an away car's dot is not 35 % of itself", () => {
    const state = { ...HOME, "device_tracker.car": st("not_home"), "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }) };
    for (const view of [undefined, "2.5d" as const]) {
      const html = draw(car(WIRED), state, view);
      expect(html, `${view} has the marks`).toContain("away-mark");
      const inner = innerOfPiece(html);
      expect(inner, `${view}: the group is the car`).toContain("car-body");
      for (const mark of ["away-mark", "car-bolt", "78 %"]) expect(inner, `${view}: ${mark} is outside the group`).not.toContain(mark);
    }
  });
});

describe("renderFloor: the charging bolt sits toward the tail (review finding 8)", () => {
  const charging: StateOverlay = { ...HOME, "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }) };
  it("every model at rot 0, 90, 180, 270: the bolt is on the tail side of the centre on screen, clear of the centre and of the car's end", () => {
    for (const model of CAR_MODELS) for (const rot of [0, 90, 180, 270]) {
      const m = car({ model, rot, ...WIRED });
      const t = /class="car-bolt" transform="translate\((-?[\d.]+) 0\)/.exec(draw(m, charging))?.[1];
      expect(t, `${model} ${rot}: the bolt carries its offset`).toBeDefined();
      const bx = Number(t), a = (rot * Math.PI) / 180;
      // the badges group turns by rot: screen offset of the bolt, and of the nose direction
      const screen = [bx * Math.cos(a), bx * Math.sin(a)], nose = [Math.cos(a), Math.sin(a)];
      expect(screen[0]! * nose[0]! + screen[1]! * nose[1]!, `${model} ${rot}: behind the centre`).toBeLessThan(0);
      expect(Math.hypot(screen[0]!, screen[1]!), `${model} ${rot}: far enough from the centre to leave the room name readable`).toBeGreaterThan(m.w * 0.25);
      expect(Math.abs(bx), `${model} ${rot}: and inside the car`).toBeLessThan(m.w / 2);
    }
  });
  it("a short car (a piece may be any size) keeps the bolt inside it", () => {
    const m = car({ w: 60, h: 30, ...WIRED }), bx = Number(/class="car-bolt" transform="translate\((-?[\d.]+) 0\)/.exec(draw(m, charging))?.[1]);
    expect(bx).toBeLessThan(0); expect(Math.abs(bx)).toBeLessThan(30);
  });
});

describe("renderFloor: 2.5D builds the car from two blocks", () => {
  it("a body, and a cabin on it whose sides are glass", () => {
    const html = draw(car(), undefined, "2.5d");
    expect(html).toContain('class="car-cabin"');
    const g = html.slice(html.indexOf('<g data-f="0"'), html.indexOf("</g>", html.indexOf("car-cabin")));
    expect(g.match(/class="bt"/g)?.length, "two lids: the body's and the cabin's").toBe(2);
  });
  it("the cabin lid is above the body's: a taller car lifts its roof higher", () => {
    const lid = (height: number) => /class="car-cabin">.*?class="bt" points="([^"]+)"/s.exec(draw(car({ height }), undefined, "2.5d"))?.[1] ?? "";
    expect(lid(120)).not.toBe(lid(200));
  });
});

describe("the car's stylesheet", () => {
  it("--fp-dev-car is set in every built-in theme and in generated ones", () => {
    expect(FLOORPLAN_CSS).toMatch(/--fp-dev-car:#2e9e4f/);
    expect(FLOORPLAN_CSS).toMatch(/--fp-dev-car:#4fd17a/);
    expect(FLOORPLAN_CSS).toMatch(/--fp-dev-car:#859900/);
    expect(THEMES.length).toBeGreaterThan(3);
  });
});

describe("the plan's frame holds the whole car", () => {
  // A car is 470 cm long; its centre alone is not where it ends. Other furniture still counts by its centre (byte for byte as before).
  const edge = (m: Furniture) => { const b = viewBoxFor({ ...floorOf([m]), outline: [[0, 0], [100, 0], [100, 100], [0, 100]], rooms: [] } as Floor, 0); return { l: b.x, r: b.x + b.w, t: b.y, d: b.y + b.h }; };
  it("a car turned 90 degrees at the plan's edge is inside the box, both ends", () => {
    const b = edge(car({ x: 50, y: 50, rot: 90 }));
    expect(b.t).toBeLessThanOrEqual(50 - 470 / 2);
    expect(b.d).toBeGreaterThanOrEqual(50 + 470 / 2);
    expect(b.l).toBeLessThanOrEqual(50 - 182 / 2);
  });
  it("a sofa of the same size still counts by its centre", () => {
    const b = edge(car({ symbol: "sofa", x: 50, y: 50, rot: 90 } as never));
    expect(b.d).toBeLessThan(50 + 470 / 2);
  });
  it("contentPoints (the editor's Re-center) holds the corners too", () => {
    const ys = contentPoints({ ...floorOf([car({ x: 50, y: 50, rot: 90 })]), rooms: [] } as Floor).map((p) => p[1]);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(285);
  });
});

// B53.3, spec E item 29: a charging car carries a glow, a copy of its outline under the top view, in 2D and 2.5D; a car at rest, away or in alert has none.
describe("renderFloor: the charging car's glow", () => {
  const CHARGING: StateOverlay = { ...HOME, "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }) };
  const glows = (html: string) => html.match(/<polygon class="car-glow" points="[^"]*"/g) ?? [];
  it("a charging car draws one glow, the body's own outline, before the body", () => {
    for (const view of [undefined, "2.5d"] as const) {
      const html = draw(car(WIRED), CHARGING, view), body = /<polygon class="car-body" points="([^"]*)"/.exec(html)!;
      expect(glows(html), String(view)).toHaveLength(1);
      expect(glows(html)[0]).toContain(`points="${body[1]}"`);
      expect(html.indexOf("car-glow"), "under the body").toBeLessThan(html.indexOf("car-body"));
    }
  });
  it("home, away and alert draw none", () => {
    for (const state of [HOME, { ...HOME, "device_tracker.car": st("not_home") }, { ...HOME, "lock.car_doors": st("unlocked") }]) expect(glows(draw(car(WIRED), state))).toEqual([]);
    expect(glows(draw(car(), undefined))).toEqual([]);
  });
});
