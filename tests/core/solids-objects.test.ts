import { describe, it, expect } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { DEVICE_TYPES, FURNITURE_SYMBOLS, type DeviceType, type Floor, type FurnitureSymbol } from "../../src/core/schema";
import { FURNITURE_HEIGHTS, FURNITURE_Z, UNLINKED_HEIGHTS } from "../../src/core/heights";

const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
/** Where plan (x, y) at height h is drawn on an unturned plan. */
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const ring = (xy: [number, number][], h: number) => xy.map(([x, y]) => P(x, y, h)).join(" ");
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["none", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const flat = (f: Floor) => renderFloor(f, { scale: 1 });
const deep = (f: Floor) => renderFloor(f, { scale: 1, view: "2.5d" });
const tops = (html: string) => [...html.matchAll(/<polygon class="bt" points="([^"]*)"\/>/g)].map((m) => m[1]);
const sides = (html: string) => [...html.matchAll(/<polygon class="bs[^"]*" points="([^"]*)"\/>/g)].map((m) => m[1]);
const piece = (symbol: string, o: Record<string, unknown> = {}) => ({ id: "m", symbol, x: 300, y: 250, rot: 0, w: 80, h: 60, ...o });
/** The corners of the unturned 80 x 60 piece at (300, 250), in the order the drawing walks them. */
const CORNERS: [number, number][] = [[260, 220], [340, 220], [340, 280], [260, 280]];

/** What each symbol becomes in 2.5D. Written out here on purpose: a new FurnitureSymbol is a type error until someone decides. */
const SOLID: Record<FurnitureSymbol, "box" | "pole" | "flat"> = {
  table: "box", sofa: "box", bed: "box", cabinet: "box", chair: "box", sink: "box", toilet: "box", shower: "box", bathtub: "box", tv: "box", computer: "box", speaker: "box",
  car: "box", tree: "pole", "patio-wood": "flat", "patio-concrete": "flat",
};
/** Whether a device of each type, mounted at its default height, gets a stem up from its icon. */
const STEM: Record<DeviceType, boolean> = {
  light: true, camera: true, motion: true, radar: true, access_point: true, ac: true, speaker: true, cover: true, switch: true, plug: false,
  contact: true, vibration: true, lock: true, temp: true, humidity: true, climate: true, boiler: true, battery: true, inverter: true, media: true, tv: true, other: true,
  heater: false, computer: false, server: false, ups: false, printer: false, car: true, person: false, vacuum: false,
};

describe("2.5D furniture", () => {
  it("decides every FurnitureSymbol, and renders what it decided", () => {
    expect(Object.keys(SOLID).sort()).toEqual([...FURNITURE_SYMBOLS].sort());
    for (const symbol of FURNITURE_SYMBOLS) {
      const html = deep(floor({ furniture: [piece(symbol)] as never }));
      const h = FURNITURE_HEIGHTS[symbol] + (FURNITURE_Z[symbol] ?? 0);
      if (SOLID[symbol] === "box") {
        expect(tops(html), symbol).toEqual([ring(CORNERS, h)]);
        expect(html, symbol).toContain(`translate(${n(300 + h * K * R)} ${n(250 - h * R)}) rotate(0)`);
      } else if (SOLID[symbol] === "pole") {
        expect(tops(html), symbol).toEqual([]);
        expect(html, symbol).toContain('class="trunk"');
        expect(html, symbol).toContain(`translate(${n(300 + h * K * R)} ${n(250 - h * R)}) rotate(0)`);
      } else {
        expect(tops(html), symbol).toEqual([]);
        expect(html, symbol).toContain("translate(300 250) rotate(0)");
        expect(html, symbol).not.toContain('class="trunk"');
      }
    }
  });

  it("2d draws none of it", () => {
    const html = flat(floor({ furniture: [piece("sofa")] as never }));
    expect(tops(html)).toEqual([]);
    expect(html).toContain("translate(300 250) rotate(0)");
  });

  it("takes its own height over the symbol's", () => {
    expect(tops(deep(floor({ furniture: [piece("sofa", { height: 200 })] as never })))).toEqual([ring(CORNERS, 200)]);
  });

  it("turns its base with rot, and keeps the symbol outline on the top face", () => {
    const html = deep(floor({ furniture: [piece("sofa", { rot: 90 })] as never }));
    // 90 degrees clockwise about the centre: (-40,-30) -> (30,-40), (40,-30) -> (30,40), (40,30) -> (-30,40), (-40,30) -> (-30,-40).
    expect(tops(html)).toEqual([ring([[330, 210], [330, 290], [270, 290], [270, 210]], 85)]);
    expect(html).toMatch(/<g transform="translate\([^)]*\) rotate\(90\) scale\(0\.8 0\.6\) translate\(-50 -50\)"><rect/);
  });

  it("shows only the faces the viewer sees: south and west, not north or east", () => {
    const s = sides(deep(floor({ furniture: [piece("sofa")] as never })));
    expect(s.length).toBe(2);
    expect(s).toContain(`${P(340, 280, 0)} ${P(260, 280, 0)} ${P(260, 280, 85)} ${P(340, 280, 85)}`);
    expect(s).toContain(`${P(260, 280, 0)} ${P(260, 220, 0)} ${P(260, 220, 85)} ${P(260, 280, 85)}`);
  });

  it("keeps the click target: faces and symbol sit inside the data-f group, with its entity class", () => {
    const html = renderFloor(floor({ furniture: [piece("sofa", { entity: "switch.s" })] as never }), { scale: 1, view: "2.5d", state: { "switch.s": { state: "on", attributes: {}, last_changed: "2026-09-19T10:00:00Z" } } });
    expect(html).toMatch(/<g data-f="0" class="furn on" color="var\(--fp-furniture\)"><polygon class="bs/);
    expect(html.indexOf('class="bt"')).toBeGreaterThan(html.indexOf('data-f="0"'));
  });

  it("is drawn after a wall behind it and before a wall in front of it", () => {
    const f = floor({ furniture: [piece("sofa")] as never, walls: [{ id: "b", a: [0, 100], b: [600, 100], kind: "wall" }, { id: "n", a: [0, 400], b: [600, 400], kind: "wall" }] as never });
    const html = deep(f), at = html.indexOf('class="furn'), back = html.indexOf(`points="0,100 600,100 `), front = html.indexOf(`points="0,400 600,400 `);
    expect([back, front].every((i) => i >= 0)).toBe(true);
    expect(back).toBeLessThan(at);
    expect(front).toBeGreaterThan(at);
  });

  it("an untrusted piece does not throw", () => {
    expect(() => deep(floor({ furniture: [piece("sofa", { w: NaN }), piece("sofa", { x: "a" }), piece("nope")] as never }))).not.toThrow();
  });
});

describe("2.5D unlinked appliances", () => {
  it("every type gets a low box at its own height under an unmoved icon", () => {
    for (const type of DEVICE_TYPES) {
      const html = deep(floor({ unlinked: [{ id: "u", type, x: 300, y: 250, rot: 0, scale: 1 }] as never }));
      const h = UNLINKED_HEIGHTS[type], c = ring([[280, 230], [320, 230], [320, 270], [280, 270]], h);
      expect(tops(html), type).toEqual([c]);
      expect(html, type).toContain('data-u="0"');
      expect(html, type).toContain("translate(288 238) scale(1)"); // the icon stays on the plan position, not lifted
    }
  });

  it("takes its own height and scale", () => {
    const html = deep(floor({ unlinked: [{ id: "u", type: "heater", x: 300, y: 250, rot: 0, scale: 2, height: 30 }] as never }));
    expect(tops(html)).toEqual([ring([[260, 210], [340, 210], [340, 290], [260, 290]], 30)]);
  });

  it("an unknown type is a box at the fallback height, escaped", () => {
    const html = deep(floor({ unlinked: [{ id: "u", type: '"><script>', x: 300, y: 250, rot: 0, scale: 1 }] as never }));
    expect(html).not.toContain("<script>");
    expect(tops(html).length).toBe(1);
  });
});

describe("2.5D stairs", () => {
  const flight = (o: Record<string, unknown>) => floor({ stairs: [{ id: "s", name: "S", pts: [[100, 100], [300, 100], [300, 200], [100, 200]], shape: "straight", steps: 5, rot: 0, ...o }] as never });

  it("a flight along x rises toward +x in steps, one block each, up to the storey height", () => {
    const t = tops(deep(flight({})));
    expect(t.length).toBe(5);
    for (let k = 0; k < 5; k++) {
      const x0 = 100 + k * 40, h = ((k + 1) / 5) * 250;
      expect(t, `step ${k}`).toContain(ring([[x0, 100], [x0 + 40, 100], [x0 + 40, 200], [x0, 200]], h));
    }
  });

  it("a flight along y rises toward -y, away from the viewer, so each riser faces it", () => {
    const t = tops(deep(flight({ pts: [[100, 100], [200, 100], [200, 300], [100, 300]] })));
    expect(t.length).toBe(5);
    expect(t).toContain(ring([[100, 260], [200, 260], [200, 300], [100, 300]], 50));
    expect(t).toContain(ring([[100, 100], [200, 100], [200, 140], [100, 140]], 250));
  });

  it("rises to the floor's own height", () => {
    const f = flight({}); f.height = 300;
    expect(tops(deep(f))).toContain(ring([[260, 100], [300, 100], [300, 200], [260, 200]], 300));
  });

  it("turns with rot", () => {
    const t = tops(deep(flight({ rot: 90 })));
    // The top step, 260-300 x 100-200, turned 90 degrees about (200, 150): x' = 200 - (y-150), y' = 150 + (x-200).
    expect(t).toContain(ring([[250, 210], [250, 250], [150, 250], [150, 210]], 250));
  });

  it("a round stair is one wedge per step, rising round the well to the storey height", () => {
    const t = tops(deep(flight({ shape: "round", dia: 160, inner: 40, pts: [[120, 70], [280, 70], [280, 230], [120, 230]] })));
    expect(t.length).toBe(8); // pi * (160 + 40) / 2 = 314 cm of run, one step per 40 cm
    expect(t.some((q) => q.includes(P(280, 150, 250)))).toBe(true); // the last wedge ends on the first one's start, at the full rise
    expect(t.some((q) => q.includes(P(280, 150, 250 / 8)) || q.split(" ").some((c) => c.startsWith(`${n(280 + (250 / 8) * K * R)},`)))).toBe(true); // and the first is one step high
  });

  it("keeps the flat stairs group, so the editor and the card still find data-s", () => {
    expect(deep(flight({}))).toContain('data-s="0"');
  });

  it("an untrusted staircase does not throw", () => {
    expect(() => deep(flight({ pts: [[NaN, 1], [2, 2]] }))).not.toThrow();
  });
});

describe("2.5D device stems", () => {
  const dev = (type: string, o: Record<string, unknown> = {}) => floor({ devices: [{ id: "d", type, entity: "x.y", x: 300, y: 250, ...o }] as never });
  const stem = (html: string) => html.match(/<line class="stem" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"\/>/);

  it("decides every DeviceType: a mount at 100 cm or more gets a stem, a person never", () => {
    for (const type of DEVICE_TYPES) expect(!!stem(deep(dev(type))), type).toBe(STEM[type]);
    expect(Object.keys(STEM).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  // 2026-10-03 (Diego): the icon rises with the walls to where the thing hangs; the small pin stays on the floor.
  it("a ceiling light's icon sits at the lifted point, its pin at the floor point, the stem between, under the icon", () => {
    const html = deep(dev("light", { x: 310, y: 240 })), m = stem(html)!;
    expect([m[1], m[2]]).toEqual(["310", "240"]);
    expect(`${m[3]},${m[4]}`).toBe(P(310, 240, 215)); // the light preset (S14.5)
    expect(html).toContain('<circle class="stem-top" cx="310" cy="240"');
    const top = P(310, 240, 215).split(",").map(Number);
    expect(html).toContain(`data-x="0" class="dev dev-light`);
    expect(html).toContain(`translate(${n(top[0] - 12)} ${n(top[1] - 12)}) scale(1)`);
    expect(html).not.toContain("translate(298 228)");
    expect(html.indexOf('class="stem"')).toBeLessThan(html.indexOf('data-x="0"'));
    expect(html.indexOf('class="stem-top"')).toBeLessThan(html.indexOf('data-x="0"'));
  });

  it("the name and the value of a lifted icon move with it, a person's and a low device's do not", () => {
    const lifted = P(300, 250, 250).split(",").map(Number);
    const named = renderFloor(dev("temp", { name: "Nm", z: 250 }), { scale: 1, view: "2.5d", showNames: true, state: { "x.y": { state: "21", attributes: {}, last_changed: "2026-01-01T00:00:00Z" } } as never });
    expect(named).toMatch(new RegExp(`<text class="lbl" x="${n(lifted[0])}" y="${n(lifted[1] - 16)}"`));
    expect(named).toMatch(new RegExp(`<text class="val" x="${n(lifted[0])}"`));
    const low = renderFloor(dev("light", { name: "Nm", z: 80 }), { scale: 1, view: "2.5d", showNames: true });
    expect(low).toContain("translate(288 238) scale(1)");
    expect(low).toContain('<text class="lbl" x="300" y="234"');
  });

  it("every DeviceType: a stemmed one is drawn at its lifted point, the rest where the plan puts them", () => {
    for (const type of DEVICE_TYPES) {
      const html = deep(dev(type, { x: 310, y: 240 }));
      if (STEM[type]) {
        const m = stem(html)!, g = html.match(/<g data-x="0"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)/)!;
        // Both are rounded to 0.01, so two roundings can differ by one in the last place (a temp sensor at 135 did): compare to 0.02.
        expect(Math.abs(+g[1] + 12 - +m[3]), type).toBeLessThanOrEqual(0.02);
        expect(Math.abs(+g[2] + 12 - +m[4]), type).toBeLessThanOrEqual(0.02);
        expect([m[1], m[2]], type).toEqual(["310", "240"]);
      } else if (type !== "person") expect(html, type).toContain("translate(298 228)");
    }
  });

  // Diego, 2026-10-03: every effect a device carries hangs with its icon. Radar targets are floor positions and stay.
  it("a lit lamp's aura, a camera's cone, a motion ring and a speaker's waves are at the lifted point", () => {
    const at = P(310, 240, 250).split(",").map(Number), lampAt = P(310, 240, 215).split(",").map(Number); // an explicit z of 250, and the light preset
    const on = (e: string, extra = {}) => ({ [e]: { state: "on", attributes: {}, last_changed: "2026-01-01T00:00:00Z" }, ...extra });
    const lamp = renderFloor(dev("light", { x: 310, y: 240 }), { scale: 1, view: "2.5d", state: on("x.y") as never });
    expect(lamp).toContain(`<circle class="aura" cx="${n(lampAt[0])}" cy="${n(lampAt[1])}"`);
    expect(renderFloor(dev("light", { x: 310, y: 240 }), { scale: 1, state: on("x.y") as never })).toContain('<circle class="aura" cx="310" cy="240"');
    // A cone, a ping and a wave live inside the icon group, so they take its translate; none is drawn outside it.
    const camera = deep(dev("camera", { x: 310, y: 240, z: 250 }));
    expect(camera.indexOf('class="cone"')).toBeGreaterThan(camera.indexOf('<g data-x="0"'));
    expect(camera).toContain(`translate(${n(at[0] - 12)} ${n(at[1] - 12)})`);
    const ping = renderFloor(dev("motion", { x: 310, y: 240, z: 250 }), { scale: 1, view: "2.5d", state: on("x.y") as never });
    expect(ping.indexOf('class="ping"')).toBeGreaterThan(ping.indexOf('<g data-x="0"'));
    const wave = renderFloor(dev("speaker", { x: 310, y: 240, z: 250 }), { scale: 1, view: "2.5d", state: { "x.y": { state: "playing", attributes: {}, last_changed: "2026-01-01T00:00:00Z" } } as never });
    expect(wave.indexOf('class="wave"')).toBeGreaterThan(wave.indexOf('<g data-x="0"'));
    expect(wave).toContain(`translate(${n(at[0] - 12)} ${n(at[1] - 12)})`);
  });

  it("a radar's targets stay on the floor while its icon is lifted", () => {
    const html = renderFloor(floor({ devices: [{ id: "r", type: "radar", entity: "x.r", x: 300, y: 250, rot: 0, targets: [{ x: "x.tx", y: "x.ty" }] }] as never }), {
      scale: 1, view: "2.5d",
      state: { "x.tx": { state: "0", attributes: {}, last_changed: "" }, "x.ty": { state: "1000", attributes: {}, last_changed: "" } } as never,
    });
    expect(html).toContain('<circle class="target" cx="300" cy="150"');
  });

  it("the lifted aura follows a turned plan and every tilt", () => {
    for (const deg of [0, 90, 180, 270]) for (const tilt of [0.25, 0.5, 1]) {
      const html = renderFloor(dev("light", { x: 310, y: 240 }), { scale: 1, view: "2.5d", tilt, rotate: { deg, pivot: [300, 250] }, state: { "x.y": { state: "on", attributes: {}, last_changed: "" } } as never });
      const s = html.match(/<line class="stem" x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/)!, a = html.match(/class="aura" cx="([^"]+)" cy="([^"]+)"/)!;
      expect([a[1], a[2]], `${deg}/${tilt}`).toEqual([s[3], s[4]]);
      expect([s[1], s[2]]).toEqual(["310", "240"]);
      expect(html).toContain(`translate(${n(+s[3] - 12)} ${n(+s[4] - 12)})`);
    }
  });

  it("takes the device's own z, and none below 100", () => {
    expect(`${stem(deep(dev("plug", { z: 300 })))![3]},${stem(deep(dev("plug", { z: 300 })))![4]}`).toBe(P(300, 250, 300));
    expect(stem(deep(dev("light", { z: 80 })))).toBeNull();
  });

  it("2d draws no stem", () => {
    expect(flat(dev("light"))).not.toContain('class="stem"');
  });

  it("a heater bar and a person never get one", () => {
    expect(stem(deep(floor({ devices: [{ id: "h", type: "heater", entity: "x.h", a: [100, 100], b: [200, 100], z: 400 }] as never })))).toBeNull();
    expect(stem(deep(dev("person", { z: 400 })))).toBeNull();
  });
});
