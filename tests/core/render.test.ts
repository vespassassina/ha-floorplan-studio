import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, type Layout, type WallKind } from "../../src/core/schema";
import { stairSteps } from "../../src/core";
import { renderFloor, viewBoxFor, planPivot, rotateAbout, contentPoints, DEVICE_COLOURS, FLOORPLAN_CSS, type StateOverlay } from "../../src/core/render";

const L = demo as unknown as Layout;
const ground = L.floors.ground;
const st = (state: string, extra: Partial<StateOverlay[string]> = {}) => ({ state, attributes: {}, last_changed: "2026-09-19T10:00:00Z", ...extra });
const NOW = Date.parse("2026-09-19T10:00:05Z");
const base = { scale: 0.5, now: NOW, fade: 10 };

describe("renderFloor", () => {
  it("matches the snapshot for the demo ground floor without state", () => {
    expect(renderFloor(ground, { scale: 0.5 })).toMatchSnapshot();
  });

  it("draws room.label under the name, escaped, and nothing when it is empty", () => {
    const f = structuredClone(ground);
    f.rooms[0].label = '<i>3 x 4</i> & "co"';
    const html = renderFloor(f, base);
    expect(html).toMatch(/<text class="lbl"[^>]*>&lt;i&gt;3 x 4&lt;\/i&gt; &amp; &quot;co&quot;<\/text>/);
    expect(html).not.toContain("<i>");
    expect(renderFloor(ground, base).match(/<text class="lbl"/g)).toHaveLength(6); // 3 rooms, garden, pavement and the pond; the zone label has its own class
  });

  it("draws openings as erase lines and extras as dashed shapes with escaped names", () => {
    const f = structuredClone(ground);
    f.openings.push({ id: "o1", a: [100, 400], b: [200, 400] });
    f.extras.push({ id: "x1", name: "<b>shed</b>", a: [100, 450], b: [200, 520] }, { id: "x2", name: "path", a: [0, 0], b: [50, 0] });
    const html = renderFloor(f, base);
    expect(html).toMatch(/<line class="opening" x1="100" y1="400" x2="200" y2="400"\/>/);
    expect(html).toMatch(/<rect class="extra" x="100" y="450" width="100" height="70"\/>/);
    expect(html).toMatch(/<line class="extra" x1="0" y1="0" x2="50" y2="0"\/>/);
    expect(html).toContain("&lt;b&gt;shed&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("paints stairs, openings and extras under the devices and the room names", () => {
    const f = structuredClone(ground);
    f.openings.push({ id: "o1", a: [100, 400], b: [200, 400] });
    f.extras.push({ id: "x1", name: "shed", a: [100, 450], b: [200, 520] });
    const html = renderFloor(f, { ...base, showNames: true });
    const firstDevice = html.indexOf("data-x=");
    const roomName = html.indexOf("font-weight=\"600\"");
    for (const under of ['data-s="0"', 'data-e="s0:0"', 'class="opening"', 'class="extra"', ">shed</text>"]) {
      const at = html.indexOf(under);
      expect(at, under).toBeGreaterThan(-1);
      expect(at, under).toBeLessThan(firstDevice);
      expect(at, under).toBeLessThan(roomName);
    }
  });

  it("paints an opening after the wall line and the room edge it covers, so the wall under it is not visible", () => {
    const f = structuredClone(ground);
    f.walls.push({ id: "w1", a: [100, 700], b: [300, 700], kind: "wall" });
    f.openings.push({ id: "o1", a: [150, 700], b: [250, 700] }, { id: "o2", a: [200, 400], b: [300, 400] });
    const html = renderFloor(f, base);
    const wall = html.indexOf('data-w="0"'), edge = html.indexOf('data-e="r0:2"'), o = [...html.matchAll(/<line class="opening"/g)].map((m) => m.index!);
    expect(wall).toBeGreaterThan(-1);
    expect(edge).toBeGreaterThan(-1);
    expect(o).toHaveLength(2);
    for (const at of o) { expect(at).toBeGreaterThan(wall); expect(at).toBeGreaterThan(edge); }
    expect(html.lastIndexOf('data-e="')).toBeLessThan(o[0]); // after every edge line
    expect(html.indexOf('data-d="0"')).toBeGreaterThan(o[1]); // and under the doors
  });

  it("draws one polygon per room, one group per device, one line per door", () => {
    const html = renderFloor(ground, base);
    expect(html.match(/<polygon[^>]*data-r="/g)).toHaveLength(ground.rooms.length);
    expect(html.match(/<g[^>]*data-x="/g)).toHaveLength(ground.devices.length);
    expect(html.match(/<line[^>]*data-d="/g)).toHaveLength(ground.doors.length);
  });

  it("marks a door open when its contact sensor is on", () => {
    const html = renderFloor(ground, { ...base, state: { "binary_sensor.demo_front_door": st("on") } });
    expect(html).toMatch(/<line[^>]*data-d="0"[^>]*class="[^"]*\bopen\b/);
    expect(html).not.toMatch(/<line[^>]*data-d="1"[^>]*class="[^"]*\bopen\b/);
  });

  it("marks a cover door open when the cover is open", () => {
    const html = renderFloor(ground, { ...base, state: { "cover.demo_garage_door": st("open") } });
    expect(html).toMatch(/<line[^>]*data-d="2"[^>]*class="[^"]*cover-open/);
  });

  it("gives a light that is on the on class", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on") } });
    expect(html).toMatch(/<g[^>]*data-x="1"[^>]*class="dev dev-light on"/);
    expect(html).toMatch(/<g[^>]*data-x="2"[^>]*class="dev dev-switch off"/);
  });

  it("marks unavailable and unknown entities", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_living": st("unavailable"), "light.demo_kitchen": st("unknown") } });
    expect(html).toMatch(/data-x="0"[^>]*class="dev dev-light bound unavailable"/);
    expect(html).toMatch(/data-x="1"[^>]*class="dev dev-light unavailable"/);
  });

  it("fades motion from last_changed over `fade` seconds", () => {
    const html = renderFloor(ground, { ...base, state: { "binary_sensor.demo_hall_motion": st("on") } });
    expect(html).toMatch(/data-x="5"[^>]*style="[^"]*--fp-fade:0\.5/);
    const early = renderFloor(ground, { ...base, now: NOW - 3000, state: { "binary_sensor.demo_hall_motion": st("on") } });
    expect(early).toMatch(/data-x="5"[^>]*style="[^"]*--fp-fade:0\.8/);
    const late = renderFloor(ground, { ...base, now: NOW + 60000, state: { "binary_sensor.demo_hall_motion": st("on") } });
    expect(late).toMatch(/data-x="5"[^>]*style="[^"]*--fp-fade:0[;"]/);
  });

  it("does not let a fixed motion colour override the fade while on", () => {
    expect(FLOORPLAN_CSS).not.toMatch(/\.dev-motion\.on path/);
  });

  it("survives an unreadable last_changed", () => {
    const html = renderFloor(ground, { ...base, state: { "binary_sensor.demo_hall_motion": st("on", { last_changed: "not a date" }) } });
    expect(html).not.toContain("NaN");
  });

  it("skips a device with non-finite coordinates", () => {
    const f = structuredClone(ground) as any;
    f.devices[0].x = NaN;
    const html = renderFloor(f, base);
    expect(html).not.toContain("NaN");
    expect(html.match(/<g[^>]*data-x="/g)).toHaveLength(ground.devices.length - 1);
  });

  it("escapes kind and type so a hostile layout cannot inject markup", () => {
    const f = structuredClone(ground) as any;
    f.rooms[0].kind = '"><script>x</script>';
    f.doors[0].kind = '"><script>x</script>';
    f.devices[0].type = '"><script>x</script>';
    expect(renderFloor(f, base)).not.toContain("<script>");
  });

  it("draws a door with no name", () => {
    const f = structuredClone(ground) as any;
    delete f.doors[0].name;
    expect(renderFloor(f, base)).not.toContain("undefined");
  });

  it("gives an empty outline a default view box", () => {
    const f = structuredClone(ground) as any;
    f.outline = [];
    const v = viewBoxFor(f);
    expect([v.x, v.y, v.w, v.h].every(Number.isFinite)).toBe(true);
  });

  it("shows temperature and humidity as labels with units", () => {
    const html = renderFloor(ground, { ...base, state: { "sensor.demo_living_temperature": st("21.5", { attributes: { unit_of_measurement: "°C" } }) } });
    expect(html).toContain("21.5 °C");
  });

  it("shows a dash for an unknown sensor value", () => {
    const html = renderFloor(ground, { ...base, state: { "sensor.demo_living_temperature": st("unknown") } });
    expect(html).toMatch(/class="val"[^>]*>–</);
  });

  it("renders a device whose entity is missing from state as off, without error", () => {
    const html = renderFloor(ground, { ...base, state: {} });
    expect(html).toMatch(/data-x="0"[^>]*class="dev dev-light bound off"/);
    expect(html).toMatch(/data-x="1"[^>]*class="dev dev-light off"/);
  });

  it("draws editor handles only in editor mode", () => {
    expect(renderFloor(ground, base)).not.toContain("data-h=");
    expect(renderFloor(ground, { ...base, editor: true })).toContain("data-h=");
  });

  it("filters devices by type and keeps the selected one", () => {
    const html = renderFloor(ground, { ...base, filter: "switch", selection: { t: "dev", i: 0 } });
    expect(html.match(/<g[^>]*data-x="/g)).toHaveLength(2);
  });

  it("escapes names", () => {
    const f = structuredClone(ground);
    f.devices[0].name = "<b>x</b>";
    expect(renderFloor(f, { ...base, showNames: true })).not.toContain("<b>x</b>");
  });

  it("uses no literal hex colours", () => {
    const html = renderFloor(ground, { ...base, editor: true, showNames: true, state: { "light.demo_living": st("on") } });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("zones and water", () => {
  const html = renderFloor(ground, { scale: 0.5 }); // no editor: the card draws the same
  const zi = ground.rooms.findIndex((r) => r.kind === "zone"), wi = ground.rooms.findIndex((r) => r.kind === "water");

  it("the demo has a Reading corner zone (area reading) inside the living room and a water pond", () => {
    expect(zi).toBeGreaterThan(-1);
    expect(wi).toBeGreaterThan(-1);
    expect(ground.rooms[zi]).toMatchObject({ name: "Reading corner", area: "reading" });
    expect(ground.rooms[wi]).toMatchObject({ kind: "water", area: "" }); // water is scenery, not an HA area
    for (const p of ground.rooms[zi].pts) expect(p[0] >= 0 && p[0] <= 500 && p[1] >= 0 && p[1] <= 400).toBe(true);
  });
  it("draws every zone edge dotted (class nw), never solid, with no editor handles", () => {
    const edges = html.match(new RegExp(`<line class="[^"]*" data-e="r${zi}:\\d+"`, "g")) ?? [];
    expect(edges).toHaveLength(ground.rooms[zi].pts.length);
    for (const e of edges) expect(e).toContain('class="e nw"');
    expect(html).not.toContain("data-h=");
  });
  it("draws a zone edge dotted even if its wk says wall", () => {
    const f = structuredClone(ground);
    f.rooms[zi].wk = f.rooms[zi].wk.map((): WallKind => "wall");
    expect(renderFloor(f, { scale: 0.5 })).toContain(`<line class="e nw" data-e="r${zi}:0"`);
  });
  it("the zone has no fill and a small name label; the water has class water and the --fp-water fill", () => {
    expect(html).toMatch(new RegExp(`<polygon data-r="${zi}" class="room room-zone"`));
    expect(FLOORPLAN_CSS).toMatch(/\.room-zone:not\(\[fill\]\)\{fill:none\}/);
    expect(html).toMatch(new RegExp(`<polygon data-r="${wi}" class="[^"]*\\bwater\\b[^"]*"`));
    expect(FLOORPLAN_CSS).toMatch(/--fp-water:#[0-9a-f]{3,8}/i);
    expect(FLOORPLAN_CSS).toMatch(/\.room-water:not\(\[fill\]\)\{[^}]*fill:var\(--fp-water\)/);
    expect(html).toMatch(/<text class="lbl zone"[^>]*font-size="20"[^>]*>Reading corner<\/text>/);
  });
  it("puts no literal colour in the zone and water markup", () => {
    const mine = html.split("\n").filter((l) => new RegExp(`data-(r="(${zi}|${wi})"|e="r(${zi}|${wi}):)`).test(l)).join("\n");
    expect(mine).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|fill="|stroke="/i);
  });
  it("escapes the name, area-free label and kind of zone and water", () => {
    const f = structuredClone(ground);
    f.rooms[zi].name = '"><script>x</script>';
    f.rooms[wi].name = '"><script>y</script>';
    f.rooms[wi].kind = '"><script>z</script>' as never;
    const out = renderFloor(f, { scale: 1, editor: true });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&quot;&gt;&lt;script&gt;x");
  });
  it("the editor adds handles for zone corners", () => {
    const out = renderFloor(ground, { scale: 1, editor: true });
    expect(out).toContain(`data-h="r${zi}:0"`);
  });
});

describe("viewBoxFor", () => {
  it("wraps the outline with padding", () => {
    expect(viewBoxFor(ground, 60)).toEqual({ x: -60, y: -60, w: 920, h: 720 });
  });
  it("defaults to 60 cm of padding", () => {
    expect(viewBoxFor(ground).x).toBe(-60);
  });
});

describe("bound light", () => {
  const f = structuredClone(ground);
  const L1 = "light.demo_living", S1 = "switch.demo_living_relay";
  const g = (state: StateOverlay | undefined, floor = f) =>
    renderFloor(floor, { ...base, state }).match(/<g[^>]*data-x="\d+"[^>]*class="dev dev-light[^"]*"[^>]*>[^]*?<\/g>/g)!.find((s) => s.includes("Living"))!;
  const cls = (s: string) => /class="([^"]*)"/.exec(s)![1];

  it("uses the class token bound and shows both names in the title", () => {
    const html = g({});
    expect(cls(html)).toBe("dev dev-light bound off");
    expect(html).toContain("<title>light: Living light + switch.demo_living_relay</title>");
  });
  it("is on when the light is on and the switch is off", () => {
    expect(cls(g({ [L1]: st("on"), [S1]: st("off") }))).toBe("dev dev-light bound on");
  });
  it("is on when the light is off and the switch is on", () => {
    expect(cls(g({ [L1]: st("off"), [S1]: st("on") }))).toBe("dev dev-light bound on");
  });
  it("is off when both are off", () => {
    expect(cls(g({ [L1]: st("off"), [S1]: st("off") }))).toBe("dev dev-light bound off");
  });
  it("is unavailable only when every present state is unavailable or unknown", () => {
    expect(cls(g({ [L1]: st("unavailable"), [S1]: st("unknown") }))).toBe("dev dev-light bound unavailable");
    expect(cls(g({ [L1]: st("unavailable") }))).toBe("dev dev-light bound unavailable");
    expect(cls(g({ [L1]: st("unavailable"), [S1]: st("on") }))).toBe("dev dev-light bound on");
    expect(cls(g({ [L1]: st("unavailable"), [S1]: st("off") }))).toBe("dev dev-light bound off");
  });
  it("uses the one state that is present", () => {
    expect(cls(g({ [S1]: st("on") }))).toBe("dev dev-light bound on");
    expect(cls(g({ [L1]: st("on") }))).toBe("dev dev-light bound on");
  });
  it("escapes a hostile bound value", () => {
    const h = structuredClone(f);
    const d = h.devices.find((x) => x.id === "light-living") as any;
    d.bound = '<img src=x onerror=alert(1)>."';
    d.name = '"><b>';
    const html = renderFloor(h, { ...base, state: {} });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
  });
  it("leaves an unbound light unchanged", () => {
    const u = structuredClone(f);
    delete (u.devices.find((x) => x.id === "light-living") as any).bound;
    const html = renderFloor(u, { ...base, state: { [L1]: st("on") } });
    expect(html).toContain('class="dev dev-light on"');
    expect(html).toContain("<title>light: Living light</title>");
    expect(html).not.toContain("bound");
  });
  it("names the bound entity by friendly_name when known, else by its id", () => {
    expect(g({ [S1]: st("off", { attributes: { friendly_name: "Relay <1>" } }) })).toContain("<title>light: Living light + Relay &lt;1&gt;</title>");
  });
});

describe("zone paint order", () => {
  it("draws a zone polygon after the rooms even when it comes first in the array", () => {
    const f = structuredClone(ground);
    const zi = f.rooms.findIndex((r) => r.kind === "zone");
    f.rooms.unshift(...f.rooms.splice(zi, 1));
    const html = renderFloor(f, { scale: 0.5 });
    const at = (i: number) => html.indexOf(`<polygon data-r="${i}"`);
    expect(at(0)).toBeGreaterThan(at(1));
    expect(at(0)).toBeGreaterThan(at(2));
    expect(at(0)).toBeGreaterThan(at(3));
    expect(at(0)).toBeGreaterThan(-1);
  });
});

describe("wall kinds", () => {
  const kinds = ["wall", "boundary", "external", "fence", "edge"] as const;
  const withWalls = () => {
    const f = structuredClone(ground);
    f.walls = kinds.map((kind, i) => ({ id: `w${i}`, a: [0, 500 + i * 20] as [number, number], b: [100, 500 + i * 20] as [number, number], kind }));
    return f;
  };
  const line = (html: string, i: number) => html.match(new RegExp(`<line class="([^"]*)" data-w="${i}"`))?.[1];

  it("gives each free wall the class of its kind; wall and boundary keep e and e nw", () => {
    const html = renderFloor(withWalls(), base);
    expect(kinds.map((_, i) => line(html, i))).toEqual(["e", "e nw", "e external", "e fence", "e edge"]);
  });
  it("styles the new kinds through --fp-wall-* variables that have defaults, and the markup holds no colour", () => {
    for (const k of ["external", "fence", "edge"]) {
      expect(FLOORPLAN_CSS).toMatch(new RegExp(`--fp-wall-${k}:#[0-9a-f]{3,8}`, "i"));
      expect(FLOORPLAN_CSS).toMatch(new RegExp(`\\.e\\.${k}\\{[^}]*stroke:var\\(--fp-wall-${k}\\)`));
    }
    expect(FLOORPLAN_CSS).toMatch(/\.e\.external\{[^}]*stroke-width:(\d+(\.\d+)?)/);
    expect(FLOORPLAN_CSS).toMatch(/\.e\.fence\{[^}]*stroke-dasharray:\d+ \d+ \d+ \d+/); // dash-dot
    const walls = renderFloor(withWalls(), base).split("\n").filter((l) => l.includes("data-w=")).join("\n");
    expect(walls).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|stroke="|style=/i);
  });
  it("the external wall is thicker than a wall, the fence is thinner", () => {
    const w = (k: string) => +(FLOORPLAN_CSS.match(new RegExp(`\\.e\\.${k}\\{[^}]*stroke-width:([\\d.]+)`))?.[1] ?? NaN);
    const wall = +(FLOORPLAN_CSS.match(/\.e\{[^}]*stroke-width:([\d.]+)/)?.[1] ?? NaN);
    expect(w("external")).toBeGreaterThan(wall);
    expect(w("fence")).toBeLessThan(wall);
    expect(w("edge")).toBeLessThan(wall);
  });
  it("escapes a kind that skipped validation", () => {
    const f = withWalls();
    (f.walls[0] as any).kind = '"><script>alert(1)</script>';
    const html = renderFloor(f, base);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("renderFloor never throws on a layout that skipped validate (review S1.5, finding 5)", () => {
  for (const bad of [5, { a: 1 }, ["x", 2], null, undefined, true]) {
    it(`name, label and title fields = ${JSON.stringify(bad)}`, () => {
      const f: any = structuredClone(ground);
      f.rooms[0].name = bad; f.rooms[0].label = bad; f.rooms[3].name = bad; f.rooms[3].label = bad;
      f.stairs[0].name = bad; f.doors[0].name = bad; f.devices[0].name = bad;
      f.extras.push({ id: "x1", name: bad, a: [0, 0], b: [50, 50] });
      expect(() => renderFloor(f, { ...base, showNames: true })).not.toThrow();
    });
  }
  it("shows an object name as text, not markup", () => {
    const f: any = structuredClone(ground);
    f.extras.push({ id: "x1", name: ["<b>"], a: [0, 0], b: [50, 50] });
    const html = renderFloor(f, base);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("garden and pavement (S1.14)", () => {
  it("draws room-garden and room-pavement, each with its own colour variable", () => {
    const html = renderFloor(ground, base);
    expect(html).toContain('class="room room-garden"');
    expect(html).toContain('class="room room-pavement"');
    expect(FLOORPLAN_CSS).toMatch(/\.room-garden:not\(\[fill\]\)\{fill:var\(--fp-garden\)\}/);
    expect(FLOORPLAN_CSS).toMatch(/\.room-terrace:not\(\[fill\]\)\{fill:var\(--fp-terrace\)\}/);
    expect(FLOORPLAN_CSS).toMatch(/\.room-pavement:not\(\[fill\]\)\{fill:var\(--fp-pavement\)\}/);
    expect(FLOORPLAN_CSS).not.toContain("--fp-outdoor");
    for (const [v, c] of [["garden", "#9db98a"], ["terrace", "#cdb094"], ["pavement", "#c9c6bf"]]) expect(FLOORPLAN_CSS).toContain(`--fp-${v}:${c}`);
  });
});

describe("fill is hatched (S1.15)", () => {
  const withFill = (n: number) => {
    const f = structuredClone(ground);
    for (let i = 0; i < n; i++) f.rooms.push({ id: `fill${i}`, name: `F${i}`, area: "", label: "", kind: "fill", pts: [[0, 0], [50, 0], [50, 50]], wk: ["wall", "wall", "wall"] });
    return f;
  };
  it("emits the hatch pattern first, once, and the class points at it", () => {
    const html = renderFloor(withFill(1), base);
    expect(html.startsWith('<defs><pattern id="fp-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">')).toBe(true);
    expect(html.match(/<defs>/g)).toHaveLength(1);
    expect(html).toContain('<rect width="12" height="12" fill="var(--fp-fill)"/>');
    expect(html).toContain('stroke="var(--fp-fill-line)"');
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(FLOORPLAN_CSS).toMatch(/\.room-fill\{fill:url\(#fp-hatch\)\}/);
    expect(FLOORPLAN_CSS).toContain("--fp-fill:#c4c0b8");
    expect(FLOORPLAN_CSS).toContain("--fp-fill-line:#9a958b");
  });
  it("emits no defs on a floor without a fill room", () => {
    expect(renderFloor(ground, base)).not.toContain("<defs>");
  });
  it("two fill rooms still emit one defs", () => {
    expect(renderFloor(withFill(2), base).match(/<defs>/g)).toHaveLength(1);
  });
});

describe("room colour (S1.16)", () => {
  it("puts fill on that polygon only, and leaves the class", () => {
    const f = structuredClone(ground);
    f.rooms[1].color = "#aabbcc";
    const html = renderFloor(f, base);
    expect(html.match(/<polygon data-r="\d+"[^>]* fill="#aabbcc"/g)).toHaveLength(1);
    expect(html).toContain('<polygon data-r="1" class="room room-room" fill="#aabbcc"');
    expect(html.match(/ fill="#aabbcc"/g)).toHaveLength(1);
  });
  it("wins over the class colour rules, except that fill keeps its hatch", () => {
    for (const k of ["garden", "pavement", "terrace", "water", "zone"])
      expect(FLOORPLAN_CSS).toMatch(new RegExp(`\\.room-${k}:not\\(\\[fill\\]\\)`));
    expect(FLOORPLAN_CSS).toContain(".room:not([fill]){fill:var(--fp-room)}");
    expect(FLOORPLAN_CSS).toMatch(/\.room-fill\{fill:url\(#fp-hatch\)\}/);
  });
  it("a hostile colour that skipped validate is not written into the markup", () => {
    const f = structuredClone(ground);
    f.rooms[0].color = '"><script>x</script>';
    expect(renderFloor(f, base)).not.toContain("script");
  });
  it("a fill room with a colour renders and still emits the hatch", () => {
    const f = structuredClone(ground);
    f.rooms.push({ id: "f1", name: "F", area: "", label: "", kind: "fill", pts: [[0, 0], [50, 0], [50, 50]], wk: ["wall", "wall", "wall"], color: "#aabbcc" });
    const html = renderFloor(f, base);
    expect(html).toContain("<defs>");
    expect(html).toContain('class="room room-fill" fill="#aabbcc"');
  });
});

describe("room edge kinds (S1.17)", () => {
  const kinds = ["wall", "boundary", "external", "fence", "edge"] as const;
  it("gives a room edge the class of its kind", () => {
    const f = structuredClone(ground);
    f.rooms[0].wk = [...kinds].slice(0, 4) as never;
    f.rooms[1].wk = ["edge", "wall", "wall", "wall"];
    const html = renderFloor(f, base);
    const cls = (id: string) => html.match(new RegExp(`<line class="([^"]*)" data-e="${id}"`))?.[1];
    expect([0, 1, 2, 3].map((i) => cls(`r0:${i}`))).toEqual(["e", "e nw", "e external", "e fence"]);
    expect(cls("r1:0")).toBe("e edge");
  });
  it("a zone edge stays dotted whatever wk says, and a hostile kind is escaped", () => {
    const f = structuredClone(ground);
    const zi = f.rooms.findIndex((r) => r.kind === "zone");
    f.rooms[zi].wk = ["fence", "fence", "fence", "fence"];
    f.rooms[0].wk[0] = '"><script>x</script>' as never;
    const html = renderFloor(f, base);
    expect(html).toContain(`class="e nw" data-e="r${zi}:0"`);
    expect(html).not.toContain("<script>");
  });
});

describe("outline edge kinds (S1.52)", () => {
  const kinds = ["wall", "boundary", "external", "fence", "edge"] as const;
  it("gives the outline the class of its owk, external by default", () => {
    const html = renderFloor(ground, base);
    const cls = (i: number) => html.match(new RegExp(`<line class="([^"]*)" data-e="o:${i}"`))?.[1];
    expect([0, 1, 2, 3].every((i) => cls(i) === "e external")).toBe(true); // the demo's owk is external all round
  });
  it("takes any wall kind on the outline, same classes as a room edge", () => {
    const f = structuredClone(ground);
    f.owk = [...kinds].slice(0, 4) as never;
    const html = renderFloor(f, base);
    const cls = (i: number) => html.match(new RegExp(`<line class="([^"]*)" data-e="o:${i}"`))?.[1];
    expect([0, 1, 2, 3].map(cls)).toEqual(["e", "e nw", "e external", "e fence"]);
  });
  it("draws an outline edge of kind none as a guide only in the editor, not as a line", () => {
    const f = structuredClone(ground);
    f.owk = ["none", "external", "external", "external"];
    const card = renderFloor(f, base);
    expect(card).not.toContain('data-e="o:0"');
    const editor = renderFloor(f, { ...base, editor: true });
    expect(editor).toContain('class="e none" data-e="o:0"');
  });
  it("the demo's perimeter is external, not the wall default", () => {
    expect(ground.owk).toEqual(["external", "external", "external", "external"]);
  });
});

describe("theme (S1.53)", () => {
  it("writes a data-theme attribute when given one, and nothing when not", () => {
    expect(renderFloor(ground, { ...base, theme: "dark" })).toContain('<g data-theme="dark">');
    expect(renderFloor(ground, { ...base, theme: "light" })).toContain('<g data-theme="light">');
    expect(renderFloor(ground, base)).not.toContain("data-theme");
  });
  it("the dark block defines every token the light block defines, with the same names AND real dark values, so a dark block copied from light (or a forgotten token) would fail", () => {
    const tokenPairs = (css: string) => new Map((css.match(/--fp-[a-z-]+:[^;]+/g) ?? []).map((kv) => { const j = kv.indexOf(":"); return [kv.slice(0, j), kv.slice(j + 1)]; }));
    const [light] = FLOORPLAN_CSS.match(/:host,\.fp\{[^}]*\}/s) ?? [""];
    const [dataLight] = FLOORPLAN_CSS.match(/\[data-theme="light"\]\{[^}]*\}/s) ?? [""];
    const [dark] = FLOORPLAN_CSS.match(/:host\(\[data-theme="dark"\]\)[^{]*\{[^}]*\}/s) ?? [""];
    const [auto] = FLOORPLAN_CSS.match(/@media[^{]*\{[^{]*\{[^}]*\}/s) ?? [""];
    const lightTokens = tokenPairs(light), darkTokens = tokenPairs(dark), autoTokens = tokenPairs(auto), dataLightTokens = tokenPairs(dataLight);
    expect(new Set(darkTokens.keys())).toEqual(new Set(lightTokens.keys())); // same token names...
    expect(darkTokens).toEqual(autoTokens); // ...and the explicit dark block and the media-query one are the same shared constant
    expect(dataLightTokens).toEqual(lightTokens); // the nested [data-theme="light"] block matches the base light block exactly
    // The structural neutrals a dark background actually breaks must differ from light: a dark block that was
    // a copy-paste of light (same names, same values) would pass the name-only check above but fail here.
    for (const k of ["--fp-ink", "--fp-bg", "--fp-room", "--fp-wall", "--fp-disc", "--fp-outline", "--fp-measure", "--fp-wall-external"])
      expect(darkTokens.get(k), k).not.toBe(lightTokens.get(k));
  });
});

describe("device rotation (S1.23)", () => {
  const withRot = (rot?: number) => { const f = structuredClone(ground); if (rot !== undefined) (f.devices[0] as { rot?: number }).rot = rot; return renderFloor(f, base); };
  const group = (html: string) => html.match(/<g data-x="0"[^>]*>/)![0];

  it("turns the device group by rot about its centre and the icon back by the same amount", () => {
    const html = withRot(90);
    expect(group(html)).toMatch(/transform="translate\([^)]*\) scale\([^)]*\) rotate\(90 12 12\)"/);
    expect(html).toMatch(/<g data-x="0"[^>]*>(<title>[^<]*<\/title>)<g transform="rotate\(-90 12 12\)"><circle[^>]*\/><path d="[^"]*"\/><\/g><\/g>/);
  });

  it("a device with rot 0 renders byte-identical to one with no rot", () => {
    expect(withRot(0)).toBe(withRot());
    expect(withRot()).toBe(renderFloor(ground, base));
    expect(group(withRot())).not.toContain("rotate(");
  });

  it("does not touch the other devices", () => {
    const a = withRot(), b = withRot(45);
    expect(b.match(/<g data-x="[1-9]"[^>]*>/g)).toEqual(a.match(/<g data-x="[1-9]"[^>]*>/g));
  });
});

describe("stairs treads (S1.25)", () => {
  const withStairs = (t: object) => { const f = structuredClone(ground); Object.assign(f.stairs[0], t); return renderFloor(f, base); };
  const group = (html: string) => html.match(/<g data-s="0"[^>]*>[\s\S]*?<\/g>/)![0];
  const round = { shape: "round", dia: 200, inner: 60, steps: 12, pts: Array.from({ length: 24 }, (_, i): [number, number] => [Math.round(500 + 100 * Math.cos((i * Math.PI) / 12)), Math.round(400 + 100 * Math.sin((i * Math.PI) / 12))]) };

  it("wraps a straight flight in a group with its rotation about the box centre and draws steps - 1 treads across it", () => {
    const g = group(withStairs({ shape: "straight", steps: 99, rot: 30 })); // a stored count is ignored: the run gives 160 / 40 = 4
    expect(g).toContain('transform="rotate(30 740 500)"');
    const treads = [...g.matchAll(/<line class="tread" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"\/>/g)];
    expect(treads).toHaveLength(3);
    // the demo flight is 80 x 160: treads run across the 80 cm side, every 40 cm
    for (const [i, m] of treads.entries()) {
      expect([m[1], m[3]]).toEqual(["700", "780"]);
      expect(+m[2]).toBeCloseTo(420 + (i + 1) * 40, 1);
      expect(m[4]).toBe(m[2]);
    }
    expect(g).toContain('class="stairs room"');
  });
  it("draws the treads of a flight that is wider than long across its short side", () => {
    const g = group(withStairs({ pts: [[0, 0], [200, 0], [200, 50], [0, 50]] }));
    const treads = [...g.matchAll(/<line class="tread" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)];
    expect(treads.map((m) => [m[1], m[2], m[3], m[4]])).toEqual([["40", "0", "40", "50"], ["80", "0", "80", "50"], ["120", "0", "120", "50"], ["160", "0", "160", "50"]]);
  });
  it("draws a round stair as one even-odd path with a hole, and 9 spokes (pi * 130 / 40 rounds to 10 steps) from the inner to the outer rim", () => {
    const g = group(withStairs(round));
    expect(g).toMatch(/<path class="stairs room" fill-rule="evenodd" d="M/);
    expect(g).not.toContain("<polygon");
    const spokes = [...g.matchAll(/<line class="tread" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"\/>/g)];
    expect(spokes).toHaveLength(9);
    for (const m of spokes) {
      expect(Math.hypot(+m[1] - 500, +m[2] - 400)).toBeCloseTo(30, 0);
      expect(Math.hypot(+m[3] - 500, +m[4] - 400)).toBeCloseTo(100, 0);
    }
  });
  it("a round stair with no inner draws no hole and its spokes start at the centre", () => {
    const g = group(withStairs({ ...round, inner: 0 }));
    expect(g).toMatch(/<path class="stairs room" fill-rule="evenodd" d="[^M]*M[^M]*Z"/);
    expect(g).toMatch(/class="tread" x1="500" y1="400"/);
  });
  it("draws edges with data-e only for an unrotated straight stair", () => {
    expect(withStairs({})).toContain('data-e="s0:0"');
    expect(withStairs({ rot: 30 })).not.toContain('data-e="s0:');
    expect(withStairs(round)).not.toContain('data-e="s0:');
  });
  it("the tread style exists", () => expect(FLOORPLAN_CSS).toMatch(/--fp-tread:#8b8578/));
  it("S1.50: the measure grid style exists: thin, non-scaling, brighter on the metre", () => {
    expect(FLOORPLAN_CSS).toContain("--fp-measure:#3a3a3a");
    expect(FLOORPLAN_CSS).toMatch(/\.mg\{stroke:var\(--fp-measure\);stroke-width:\.5;vector-effect:non-scaling-stroke\}/);
    expect(FLOORPLAN_CSS).toMatch(/\.mg\.m\{stroke-width:1\}/);
  });
  it("a stair that skipped migrate still draws (no shape, no steps)", () => {
    const f = structuredClone(ground) as any;
    delete f.stairs[0].shape; delete f.stairs[0].steps; delete f.stairs[0].rot;
    expect(group(renderFloor(f, base)).match(/class="tread"/g)).toHaveLength(3);
  });
});

describe("stairSteps (S1.44)", () => {
  const box = (w: number, h: number) => ({ pts: [[0, 0], [w, 0], [w, h], [0, h]] as [number, number][], shape: "straight" as const });
  it("is one per 40 cm of the long side, rounded, from 2 to 40", () => {
    expect(stairSteps(box(100, 300))).toBe(8); // 7.5 rounds up
    expect(stairSteps(box(300, 100))).toBe(8);
    expect(stairSteps(box(100, 100))).toBe(3); // 2.5 rounds up
    expect(stairSteps(box(60, 30))).toBe(2);
    expect(stairSteps(box(10, 10))).toBe(2);
    expect(stairSteps(box(5000, 100))).toBe(40);
  });
  it("uses the mean circumference of a round stair", () => {
    expect(stairSteps({ ...box(200, 200), shape: "round", dia: 200, inner: 80 })).toBe(11);
    expect(stairSteps({ ...box(200, 200), shape: "round", dia: 200 })).toBe(8);
  });
  it("survives rubbish points", () => { expect(stairSteps({ pts: [] as never, shape: "straight" })).toBe(2); });
});

describe("devices sit on top (S1.29)", () => {
  const html = renderFloor(ground, base);
  it("every device group comes after the last room name", () => {
    const lastName = html.lastIndexOf('<text class="lbl"');
    const firstDev = html.indexOf("<g data-x=");
    expect(lastName).toBeGreaterThan(-1);
    expect(firstDev).toBeGreaterThan(lastName);
  });
  it("the halo is a class, with no inline fill", () => {
    expect(html).toContain('<circle class="halo" cx="12" cy="12" r="16"/>'); // the icon is 12 out, the disc 3 more plus one
    expect(html).not.toContain("fill-opacity");
    expect(FLOORPLAN_CSS).toMatch(/\.dev \.halo\{fill:var\(--fp-disc\);fill-opacity:var\(--fp-disc-alpha\);stroke:var\(--fp-halo\);stroke-width:1;vector-effect:non-scaling-stroke\}/);
    expect(FLOORPLAN_CSS).toContain("--fp-halo:#8b8578");
    expect(FLOORPLAN_CSS).toContain("--fp-disc:#fff");
    expect(FLOORPLAN_CSS).toContain("--fp-disc-alpha:.75");
  });
  it("a device on a room-name spot draws after that name", () => {
    const room = ground.rooms.find((r) => r.name && r.kind !== "fill" && r.kind !== "zone")!;
    const cx = room.pts.reduce((s, p) => s + p[0], 0) / room.pts.length, cy = room.pts.reduce((s, p) => s + p[1], 0) / room.pts.length;
    const f = { ...ground, devices: [{ id: "d", type: "light", entity: "light.x", x: cx, y: cy }] } as unknown as typeof ground;
    const h = renderFloor(f, base);
    expect(h.indexOf("<g data-x=")).toBeGreaterThan(h.indexOf(`>${room.name}</text>`));
  });
  it("fix/heater-bar-under-icon: a heater's bar draws before its icon group, so the icon paints on top", () => {
    const f = { ...ground, devices: [{ id: "bar", type: "heater", entity: "climate.bar", a: [3000, 10], b: [3100, 10] }] } as unknown as typeof ground;
    const h = renderFloor(f, base);
    const bar = h.indexOf('data-xbar="0"'), icon = h.indexOf('data-x="0"');
    expect(bar).toBeGreaterThan(-1);
    expect(icon).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(icon);
  });
});

describe("outdoor sensors and the palette (S1.30)", () => {
  const room = (kind: string, pts: [number, number][]) => ({ id: kind, name: "", area: "", label: "", kind, pts, wk: pts.map(() => "boundary") });
  const dev = (type: string, x: number, y: number) => ({ id: `${type}-${x}`, type, entity: "sensor.x", x, y });
  const draw = (rooms: unknown[], devices: unknown[]) =>
    renderFloor({ ...ground, rooms, devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [] } as unknown as typeof ground, base);
  const box = (x: number, y: number): [number, number][] => [[x, y], [x + 100, y], [x + 100, y + 100], [x, y + 100]];
  const classOfDev = (html: string, i: number) => html.match(new RegExp(`<g data-x="${i}" class="([^"]*)"`))![1].split(" ");

  it("a temp sensor inside a garden room gets outdoor; one in a normal room does not", () => {
    const html = draw([room("garden", box(0, 0)), room("room", box(300, 0))], [dev("temp", 50, 50), dev("temp", 350, 50)]);
    expect(classOfDev(html, 0)).toContain("outdoor");
    expect(classOfDev(html, 1)).not.toContain("outdoor");
  });
  it("a zone on top of the garden does not stop the sensor being outdoor", () => {
    const html = draw([room("garden", box(0, 0)), room("zone", box(20, 20))], [dev("humidity", 50, 50)]);
    expect(classOfDev(html, 0)).toContain("outdoor");
  });
  it("a device in no room gets no class and nothing throws", () => {
    const html = draw([room("garden", box(0, 0))], [dev("temp", 900, 900)]);
    expect(classOfDev(html, 0)).not.toContain("outdoor");
    expect(() => draw([], [dev("temp", 1, 1)])).not.toThrow();
  });
  it("a motion sensor keeps its own colour rule in the garden", () => {
    expect(classOfDev(draw([room("garden", box(0, 0))], [dev("motion", 50, 50)]), 0)).not.toContain("outdoor");
  });
  it("carries the palette", () => {
    const want: Record<string, string> = { light: "#e0a800", motion: "#d64545", contact: "#d64545", heater: "#e8801a", climate: "#e8801a", "ac-cool": "#2c7fb8", "ac-heat": "#e8801a", tv: "#2c7fb8", plug: "#2c7fb8", computer: "#2c7fb8", camera: "#4a4a48", garden: "#3f8f4f" };
    for (const [k, v] of Object.entries(want)) expect(FLOORPLAN_CSS).toContain(`--fp-dev-${k}:${v}`);
    expect(FLOORPLAN_CSS).toContain(".dev-camera path{fill:var(--fp-dev-camera)}");
    expect(FLOORPLAN_CSS).toContain(".dev.outdoor path{fill:var(--fp-dev-garden)}");
  });
});

describe("camera cone (S1.31)", () => {
  const ci = ground.devices.findIndex((d) => d.type === "camera");
  const withRot = (rot?: number, scale = 0.5) => {
    const f = structuredClone(ground);
    if (rot !== undefined) (f.devices[ci] as { rot?: number }).rot = rot;
    return renderFloor(f, { ...base, scale });
  };
  const group = (html: string) => html.match(new RegExp(`<g data-x="${ci}"[\\s\\S]*?</g>`))![0];
  /** The cone's path in the device group's frame: centre, the two ends of the arc and its radius. */
  const cone = (html: string) => {
    const m = group(html).match(/<path class="cone" d="M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)A([\d.-]+) ([\d.-]+) 0 0 1 ([\d.-]+) ([\d.-]+)Z"\/>/)!;
    const n = m.slice(1).map(Number);
    return { c: [n[0], n[1]], p1: [n[2], n[3]], p2: [n[6], n[7]], r: n[4] };
  };
  /** Bearing in degrees from +x, y down (clockwise), of a point about c after the group's rotation `rot`. */
  const bearing = (c: number[], p: number[], rot: number) => {
    const a = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI + rot;
    return ((Math.round(a) + 540) % 360) - 180;
  };

  it("draws one cone, before the icon and inside the group, from the icon centre", () => {
    const g = group(withRot(90));
    expect(g.match(/class="cone"/g)).toHaveLength(1);
    expect(g.indexOf('class="cone"')).toBeLessThan(g.indexOf('class="halo"'));
    expect(cone(withRot(90)).c).toEqual([12, 12]);
  });

  it("at rot 90 spans 120 degrees about +x; with no rot it points up", () => {
    const a = cone(withRot(90));
    expect([bearing(a.c, a.p1, 90), bearing(a.c, a.p2, 90)]).toEqual([-60, 60]);
    const b = cone(withRot());
    expect([bearing(b.c, b.p1, 0), bearing(b.c, b.p2, 0)]).toEqual([-150, -30]); // up is -90
  });

  it("is 100 cm deep whatever the zoom: the radius in the scaled frame is 100 x scale", () => {
    expect(cone(withRot(undefined, 0.5)).r).toBe(50);
    expect(cone(withRot(undefined, 2)).r).toBe(200);
  });

  it("no other device type emits a cone, and the cone lets the pointer through", () => {
    expect(renderFloor(ground, base).match(/class="cone"/g)).toHaveLength(1);
    const f = structuredClone(ground);
    f.devices = f.devices.filter((d) => d.type !== "camera");
    expect(renderFloor(f, base)).not.toContain("cone");
    expect(FLOORPLAN_CSS).toMatch(/path\.cone\{[^}]*fill:var\(--fp-dev-camera\)[^}]*fill-opacity:var\(--fp-alpha\)[^}]*pointer-events:none/);
  });
});

describe("the cone has its own alpha, the disc another (fix/cone-length, S1.45)", () => {
  it("--fp-alpha is 25 % and the cone reads it; the disc reads --fp-disc-alpha; no other opacity literal is left", () => {
    expect(FLOORPLAN_CSS).toContain("--fp-alpha:.25");
    expect(FLOORPLAN_CSS).not.toMatch(/\.dev \.halo\{[^}]*--fp-alpha/);
    expect(FLOORPLAN_CSS).toMatch(/path\.cone\{[^}]*fill-opacity:var\(--fp-alpha\)/);
    expect(FLOORPLAN_CSS).not.toMatch(/fill-opacity:\.(33|5)\b/);
  });
});

describe("plan rotation (S1.33)", () => {
  const pivot = planPivot(L);
  const turned = (deg: number, f = ground, o: object = {}) => renderFloor(f, { ...base, rotate: { deg, pivot }, ...o });

  it("planPivot is the centre of the box round every outline, and the origin with none", () => {
    expect(pivot).toEqual([400, 300]);
    const l = structuredClone(L);
    l.floors.first.outline = [[0, 0], [1600, 0], [1600, 200]]; // wider than the ground floor: the pivot follows both
    expect(planPivot(l)).toEqual([800, 300]);
    for (const f of Object.values(l.floors)) f.outline = [];
    expect(planPivot(l)).toEqual([0, 0]);
  });

  it("wraps everything in one group turned about the pivot, and rotate 0 or none changes nothing", () => {
    const html = turned(90);
    expect(html.startsWith('<g class="plan-turn" transform="rotate(90 400 300)">')).toBe(true);
    expect(html.endsWith("</g>")).toBe(true);
    expect(turned(0)).toBe(renderFloor(ground, base));
    expect(turned(360)).toBe(renderFloor(ground, base));
    expect(renderFloor(ground, { ...base, rotate: undefined })).toBe(renderFloor(ground, base));
  });

  it("turns every text back about its own anchor, by the opposite angle", () => {
    const html = turned(90, ground, { showNames: true, state: { "sensor.demo_living_temperature": st("21.5", { attributes: { unit_of_measurement: "°C" } }) } });
    const texts = html.match(/<text [^>]*>/g)!;
    expect(texts.length).toBeGreaterThan(8);
    for (const t of texts) {
      const x = t.match(/ x="([^"]+)"/)![1], y = t.match(/ y="([^"]+)"/)![1];
      expect(t, t).toContain(`transform="rotate(-90 ${x} ${y})"`);
    }
    expect(renderFloor(ground, base).match(/<text [^>]*transform=/)).toBeNull(); // not at rotate 0
    expect(turned(45).match(/<text [^>]*>/g)!.every((t) => t.includes("rotate(-45 "))).toBe(true);
  });

  it("keeps every icon upright: the group turns by rot, the icon back by rot plus the plan angle; the cone is not turned back", () => {
    const f = structuredClone(ground);
    const ci = f.devices.findIndex((d) => d.type === "camera");
    (f.devices[ci] as { rot?: number }).rot = 30;
    const html = turned(90, f);
    expect(html).toMatch(/rotate\(30 12 12\)"><title>[^<]*<\/title><path class="cone"[^>]*\/><g transform="rotate\(-120 12 12\)"><circle/);
    // a device with no rot of its own: the icon alone takes the plan angle back
    expect(html).toMatch(/<g data-x="0"[^>]*><title>[^<]*<\/title><g transform="rotate\(-90 12 12\)"><circle/);
    // a full turn in total needs no wrapper
    (f.devices[ci] as { rot?: number }).rot = 270;
    expect(turned(90, f)).toMatch(new RegExp(`<g data-x="${ci}"[^>]*><title>[^<]*</title><path class="cone"[^>]*/><circle`));
  });

  it("draws the same shapes: every stored coordinate in the markup is the one it is without a turn", () => {
    const coords = (h: string) => h.match(/ (?:points|x1|y1|x2|y2|cx|cy)="[^"]*"/g);
    expect(coords(turned(90))).toEqual(coords(renderFloor(ground, base)));
    expect(coords(turned(90))!.length).toBeGreaterThan(50);
  });

  it("viewBoxFor at 90 on a wide outline is tall, at 45 it is the box of the turned corners, at 0 or none unchanged", () => {
    const f = structuredClone(ground);
    f.outline = [[0, 0], [1000, 0], [1000, 200], [0, 200]];
    const flat = viewBoxFor(f, 0);
    expect(flat).toEqual({ x: 0, y: 0, w: 1000, h: 200 });
    const piv: [number, number] = [500, 100];
    const tall = viewBoxFor(f, 0, { deg: 90, pivot: piv });
    expect(tall.w).toBeCloseTo(200); expect(tall.h).toBeCloseTo(1000);
    expect(tall.x + tall.w / 2).toBeCloseTo(500); expect(tall.y + tall.h / 2).toBeCloseTo(100); // turned about its own centre: the centre stays
    const d = viewBoxFor(f, 0, { deg: 45, pivot: piv });
    expect(d.w).toBeCloseTo((1000 + 200) / Math.SQRT2);
    expect(viewBoxFor(f, 0, { deg: 0, pivot: piv })).toEqual(flat);
    expect(viewBoxFor(f, 60)).toEqual(viewBoxFor(f, 60, undefined));
  });

  it("rotateAbout: a quarter turn clockwise on screen takes the top of a plan to the right", () => {
    const p = rotateAbout([0, -10], 90, [0, 0]);
    expect(p[0]).toBeCloseTo(10); expect(p[1]).toBeCloseTo(0);
    expect(rotateAbout([5, 5], 360, [1, 1])[0]).toBeCloseTo(5);
  });
});

describe("device colours (S1.36)", () => {
  it("without colors the output is the same as before: no wrapper, no style", () => {
    expect(renderFloor(ground, { scale: 0.5, colors: undefined })).toBe(renderFloor(ground, { scale: 0.5 }));
    expect(renderFloor(ground, { scale: 0.5, colors: {} })).toBe(renderFloor(ground, { scale: 0.5 }));
    expect(renderFloor(ground, { scale: 0.5 })).not.toContain("--fp-dev-");
  });
  it("puts each chosen colour in one style as --fp-dev-<type>, around the drawing", () => {
    const html = renderFloor(ground, { scale: 0.5, colors: { light: "#aabbcc", camera: "#112233" } });
    expect(html.startsWith('<g class="dev-colours" style="--fp-dev-light:#aabbcc;--fp-dev-camera:#112233">')).toBe(true);
    expect(html.endsWith("</g>")).toBe(true);
    expect(renderFloor(ground, { scale: 0.5 })).toBe(html.slice(html.indexOf(">") + 1, -4)); // the rest is unchanged
  });
  it("skips what is not a device type or #rrggbb, so nothing untrusted reaches the attribute", () => {
    const html = renderFloor(ground, { scale: 0.5, colors: { fridge: "#aabbcc", light: 'red;" onload="x', tv: "#abcdef" } as any });
    expect(html).toContain('style="--fp-dev-tv:#abcdef"');
    expect(html).not.toContain("fridge"); expect(html).not.toContain("onload");
    expect(renderFloor(ground, { scale: 0.5, colors: { light: "nope" } as any })).toBe(renderFloor(ground, { scale: 0.5 }));
  });
  it("DEVICE_COLOURS gives every device type a #rrggbb default that matches the palette variables", () => {
    for (const t of DEVICE_TYPES) expect(DEVICE_COLOURS[t], t).toMatch(/^#[0-9a-f]{6}$/);
    expect(DEVICE_COLOURS.light).toBe("#e0a800");
    expect(FLOORPLAN_CSS).toContain(`--fp-dev-camera:${DEVICE_COLOURS.camera}`);
  });
});

describe("contentPoints (S1.49)", () => {
  it("has the outline, every room, stairs, wall, device and piece of furniture, also those outside the outline", () => {
    const f = structuredClone(ground);
    f.devices.push({ id: "far", type: "temp", entity: "sensor.far", x: 2000, y: -300 } as any);
    f.devices.push({ id: "bar", type: "heater", entity: "climate.bar", a: [3000, 10], b: [3100, 10] } as any);
    const pts = contentPoints(f), has = (p: [number, number]) => pts.some((q) => q[0] === p[0] && q[1] === p[1]);
    for (const p of f.outline) expect(has(p)).toBe(true);
    for (const r of f.rooms) for (const p of r.pts) expect(has(p)).toBe(true);
    for (const t of f.stairs) for (const p of t.pts) expect(has(p)).toBe(true);
    expect(has([2000, -300])).toBe(true);
    expect(has([3000, 10]) && has([3100, 10])).toBe(true);
  });
  it("is empty for a floor with nothing on it, and never contains a non-number", () => {
    expect(contentPoints({ title: "E", outline: [], rooms: [], walls: [], doors: [], openings: [], extras: [], stairs: [], furniture: [], devices: [] } as any)).toEqual([]);
    const f = structuredClone(ground);
    (f.devices[0] as any).x = NaN;
    expect(contentPoints(f).every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
  });
});

describe("S1.35b: a white twin under every edge", () => {
  it("draws one line.eh per room edge and free wall, all before every line.e, without data attributes", () => {
    const f = structuredClone(ground);
    f.walls.push({ id: "w1", a: [100, 700], b: [300, 700], kind: "fence" });
    const html = renderFloor(f, base);
    const twins = [...html.matchAll(/<line class="eh[^"]*"[^>]*>/g)];
    const edges = [...html.matchAll(/<line class="e(?: nw| external| fence| edge)?" data-[ew]=[^>]*>/g)];
    const n = f.outline.length + f.rooms.reduce((s, r) => s + r.pts.length, 0) + f.walls.length;
    expect(twins).toHaveLength(n);
    expect(edges).toHaveLength(n);
    expect(twins.every((m) => !m[0].includes("data-"))).toBe(true);
    expect(Math.max(...twins.map((m) => m.index!))).toBeLessThan(Math.min(...edges.map((m) => m.index!)));
    expect(html).toContain('class="eh fence"');
  });
  it("gives the twin the colour --fp-outline and the stairs edges none", () => {
    expect(FLOORPLAN_CSS).toContain("--fp-outline:#fff");
    expect(renderFloor(ground, base).match(/class="e se"/g)?.length).toBeGreaterThan(0);
    expect(renderFloor(ground, base)).not.toMatch(/class="eh se"/);
  });
});

describe("S1.42: a device never hides a room name", () => {
  const k = 2; // scale 0.5
  const floor = (kind: "room" | "zone", devs: [number, number][], filter?: string) => {
    const f = structuredClone(ground);
    f.rooms = [{ id: "r", name: "Lounge", kind, area: "", pts: [[0, 0], [400, 0], [400, 200], [0, 200]] } as never];
    f.devices = devs.map(([x, y], i) => ({ id: `d${i}`, type: "light", entity: `light.d${i}`, x, y }) as never);
    f.doors = []; f.stairs = []; f.walls = []; f.furniture = [];
    return renderFloor(f, { scale: 0.5, ...(filter ? { filter: filter as never } : {}) });
  };
  const nameY = (html: string) => Number(html.match(/<text class="lbl(?: zone)?"[^>]* y="([\d.-]+)"[^>]*>Lounge</)![1]);
  const cy = 100;

  it("stays put with no device near", () => { expect(nameY(floor("room", []))).toBe(cy); expect(nameY(floor("room", [[20, 20]]))).toBe(cy); });
  it("moves down 32k when a device sits on the centroid", () => { expect(nameY(floor("room", [[200, 100]]))).toBe(cy + 32 * k); });
  it("moves up when the spot below is taken too", () => { expect(nameY(floor("room", [[200, 100], [200, 100 + 32 * k]]))).toBe(cy - 32 * k); });
  it("stays when all three spots are taken", () => { expect(nameY(floor("room", [[200, 100], [200, 100 + 32 * k], [200, 100 - 32 * k]]))).toBe(cy); });
  it("a zone follows the same steps with its smaller size", () => {
    expect(nameY(floor("zone", [[200, 100]]))).toBe(cy + 32 * k);
    expect(nameY(floor("zone", [[200, 100], [200, 100 + 32 * k]]))).toBe(cy - 32 * k);
  });
  it("counts only devices the filter draws", () => { expect(nameY(floor("room", [[200, 100]], "heater"))).toBe(cy); });
  it("a device far to the side does not move the name", () => { expect(nameY(floor("room", [[380, 100]]))).toBe(cy); });
  it("the label follows the name", () => {
    const f = structuredClone(ground);
    f.rooms = [{ id: "r", name: "Lounge", label: "3 x 4", kind: "room", area: "", pts: [[0, 0], [400, 0], [400, 200], [0, 200]] } as never];
    f.devices = [{ id: "d", type: "light", entity: "light.d", x: 200, y: 100 } as never];
    const html = renderFloor(f, { scale: 0.5 });
    expect(html).toMatch(new RegExp(`y="${100 + 32 * k + 16 * k}"[^>]*>3 x 4<`));
  });
});

describe("S1.46: one text style", () => {
  it("every text class is dark grey with the white outline; no black, no dark-only rule", () => {
    expect(FLOORPLAN_CSS).toContain("--fp-text:#3a3a3a");
    expect(FLOORPLAN_CSS).toMatch(/\.val,\.lbl\{fill:var\(--fp-text\);paint-order:stroke;stroke:var\(--fp-outline\);stroke-width:3;stroke-linejoin:round\}/);
    expect(FLOORPLAN_CSS).not.toMatch(/\.(val|lbl)[^{]*\{[^}]*fill:var\(--fp-ink\)/);
    expect(FLOORPLAN_CSS).not.toMatch(/\.lbl[^{]*\{[^}]*stroke:var\(--fp-bg\)/);
  });
  it("no text carries its own fill", () => {
    const f = structuredClone(ground);
    f.extras.push({ id: "x", name: "Shed", a: [0, 0], b: [10, 10] } as never);
    for (const m of renderFloor(f, base).matchAll(/<text [^>]*>/g)) expect(m[0]).not.toMatch(/ fill=/);
  });
});

describe("S1.47: an edge of kind none", () => {
  const withNone = () => { const f = structuredClone(ground); f.rooms[0].wk[1] = "none"; return f; };
  const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
  it("draws no line and no twin on the card", () => {
    const a = renderFloor(ground, base), b = renderFloor(withNone(), base);
    expect(count(b, /<line class="e[ "][^>]*data-e/g)).toBe(count(a, /<line class="e[ "][^>]*data-e/g) - 1);
    expect(count(b, /<line class="eh/g)).toBe(count(a, /<line class="eh/g) - 1);
    expect(b).not.toContain('data-e="r0:1"');
  });
  it("the editor keeps a faint guide with data-e, so the edge can be picked again, and no twin", () => {
    const b = renderFloor(withNone(), { ...base, editor: true });
    expect(b).toContain('<line class="e none" data-e="r0:1"');
    expect(FLOORPLAN_CSS).toMatch(/\.e\.none\{[^}]*stroke-dasharray/);
  });
});
