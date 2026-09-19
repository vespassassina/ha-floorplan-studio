import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { renderFloor, viewBoxFor, FLOORPLAN_CSS, type StateOverlay } from "../../src/core/render";

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
    expect(renderFloor(ground, base).match(/<text class="lbl"/g)).toHaveLength(4); // 3 rooms and the pond; the zone label has its own class
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
    expect(ground.rooms[wi].kind).toBe("water");
    for (const p of ground.rooms[zi].pts) expect(p[0] >= 0 && p[0] <= 500 && p[1] >= 0 && p[1] <= 400).toBe(true);
  });
  it("draws every zone edge dotted (class nw), never solid, with no editor handles", () => {
    const edges = html.match(new RegExp(`<line class="[^"]*" data-e="r${zi}:\\d+"`, "g")) ?? [];
    expect(edges).toHaveLength(ground.rooms[zi].pts.length);
    for (const e of edges) expect(e).toContain('class="e nw"');
    expect(html).not.toContain("data-h=");
  });
  it("draws a zone edge dotted even if its w flag says wall", () => {
    const f = structuredClone(ground);
    f.rooms[zi].w = f.rooms[zi].w.map(() => true);
    expect(renderFloor(f, { scale: 0.5 })).toContain(`<line class="e nw" data-e="r${zi}:0"`);
  });
  it("the zone has no fill and a small name label; the water has class water and the --fp-water fill", () => {
    expect(html).toMatch(new RegExp(`<polygon data-r="${zi}" class="room room-zone"`));
    expect(FLOORPLAN_CSS).toMatch(/\.room-zone\{fill:none\}/);
    expect(html).toMatch(new RegExp(`<polygon data-r="${wi}" class="[^"]*\\bwater\\b[^"]*"`));
    expect(FLOORPLAN_CSS).toMatch(/--fp-water:#[0-9a-f]{3,8}/i);
    expect(FLOORPLAN_CSS).toMatch(/\.water\{[^}]*fill:var\(--fp-water\)/);
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
