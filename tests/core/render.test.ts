import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, UNLINKED_TYPES, FURNITURE_SYMBOLS, ROOM_KINDS, type Layout, type Pt, type RoomKind, type WallKind } from "../../src/core/schema";
import { stairSteps } from "../../src/core";
import { DEVICE_ICONS } from "../../src/core/icons";
import { renderFloor, viewBoxFor, planPivot, rotateAbout, contentPoints, DEVICE_COLOURS, DEVICE_REACH, FLOORPLAN_CSS, type StateOverlay } from "../../src/core/render";

const L = demo as unknown as Layout;
const ground = L.floors.ground;
const st = (state: string, extra: Partial<StateOverlay[string]> = {}) => ({ state, attributes: {}, last_changed: "2026-09-19T10:00:00Z", ...extra });
const NOW = Date.parse("2026-09-19T10:00:05Z");
const base = { scale: 0.5, now: NOW, fade: 10 };

describe("renderFloor", () => {
  it("matches the snapshot for the demo ground floor without state", () => {
    expect(renderFloor(ground, { scale: 0.5 })).toMatchSnapshot();
  });

  it("S5.1: matches the snapshot for a floor carrying every FURNITURE_SYMBOLS symbol", () => {
    const f = { ...ground, furniture: FURNITURE_SYMBOLS.map((symbol, i) => ({ id: `f-${symbol}`, symbol, x: 100 + i * 150, y: 100, rot: 0, w: 80, h: 60 })) };
    expect(renderFloor(f, { scale: 0.5 })).toMatchSnapshot();
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
    expect(html).toMatch(/<rect class="extra" data-ex="\d+" x="100" y="450" width="100" height="70"\/>/);
    expect(html).toMatch(/<line class="extra" data-ex="\d+" x1="0" y1="0" x2="50" y2="0"\/>/);
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

  it("S2.2: a lit light's own rgb_color sets --fp-dev-fill on its device group, none of it comes from the layout's device colours", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on", { attributes: { rgb_color: [255, 0, 0] } }) } });
    expect(html).toMatch(/data-x="1"[^>]*style="[^"]*--fp-dev-fill:rgb\(255,0,0\)/);
  });

  it("S2.2: with no rgb_color the group carries no --fp-dev-fill, so the CSS var(--fp-on) fallback applies", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on") } });
    const group = html.match(/<g[^>]*data-x="1"[^>]*>/)![0];
    expect(group).not.toContain("--fp-dev-fill");
  });

  it("S2.2: a malformed rgb_color (untrusted state) sets no --fp-dev-fill instead of throwing", () => {
    const bad = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on", { attributes: { rgb_color: [255, 0] } }) } });
    expect(bad.match(/<g[^>]*data-x="1"[^>]*>/)![0]).not.toContain("--fp-dev-fill");
    const bad2 = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on", { attributes: { rgb_color: "red" } }) } });
    expect(bad2.match(/<g[^>]*data-x="1"[^>]*>/)![0]).not.toContain("--fp-dev-fill");
  });

  it("S2.2: brightness sets --fp-dev-opacity as brightness/255, floored at 0.35", () => {
    const full = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on", { attributes: { brightness: 255 } }) } });
    expect(full).toMatch(/data-x="1"[^>]*style="[^"]*--fp-dev-opacity:1"/);
    const dim = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on", { attributes: { brightness: 0 } }) } }); // 0/255 would be 0, floored to 0.35
    expect(dim).toMatch(/data-x="1"[^>]*style="[^"]*--fp-dev-opacity:0\.35"/);
    const low = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on", { attributes: { brightness: 10 } }) } }); // 10/255 ~= 0.04, under the floor
    expect(low).toMatch(/data-x="1"[^>]*style="[^"]*--fp-dev-opacity:0\.35"/);
  });

  it("S2.2: no brightness attribute sets no --fp-dev-opacity, so full opacity applies through the cascade", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on") } });
    expect(html.match(/<g[^>]*data-x="1"[^>]*>/)![0]).not.toContain("--fp-dev-opacity");
  });

  it("S2.2: a light that is off gets neither --fp-dev-fill nor --fp-dev-opacity, even with rgb_color/brightness set", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("off", { attributes: { rgb_color: [255, 0, 0], brightness: 10 } }) } });
    const group = html.match(/<g[^>]*data-x="1"[^>]*>/)![0];
    expect(group).not.toContain("--fp-dev-fill");
    expect(group).not.toContain("--fp-dev-opacity");
  });

  it("marks unavailable and unknown entities", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_living": st("unavailable"), "light.demo_kitchen": st("unknown") } });
    expect(html).toMatch(/data-x="0"[^>]*class="dev dev-light bound unavailable"/);
    expect(html).toMatch(/data-x="1"[^>]*class="dev dev-light unavailable"/);
  });

  describe("S2.8: a lit lamp casts an aura", () => {
    it("draws one circle.aura of radius 100 at a lit light's centre", () => {
      const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on") } });
      expect(html).toMatch(/<circle class="aura" cx="650" cy="200" r="100"\/>/);
    });

    it("draws no aura for a light that is off, unavailable or unknown", () => {
      const off = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("off") } });
      expect(off).not.toContain('class="aura"');
      const unavailable = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("unavailable") } });
      expect(unavailable).not.toContain('class="aura"');
      const unknown = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("unknown") } });
      expect(unknown).not.toContain('class="aura"');
      const none = renderFloor(ground, base);
      expect(none).not.toContain('class="aura"');
    });

    it("a light with rgb_color sets --fp-aura on its own circle through style", () => {
      const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on", { attributes: { rgb_color: [255, 0, 0] } }) } });
      expect(html).toMatch(/<circle class="aura" cx="650" cy="200" r="100" style="--fp-aura:rgb\(255,0,0\)"\/>/);
    });

    it("a light with no rgb_color carries no --fp-aura, so the default CSS variable applies", () => {
      const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on") } });
      expect(html).toMatch(/<circle class="aura" cx="650" cy="200" r="100"\/>/);
      expect(html).not.toContain("--fp-aura");
    });

    it("a bound light's aura follows the switch's on state but keeps the default colour (no rgb_color on the light entity itself)", () => {
      const html = renderFloor(ground, { ...base, state: { "switch.demo_living_relay": st("on") } }); // light.demo_living itself missing from state
      expect(html).toMatch(/<circle class="aura" cx="250" cy="200" r="100"\/>/);
    });

    it("every aura is drawn before every device group, so overlapping auras never hide an icon", () => {
      const html = renderFloor(ground, { ...base, state: { "light.demo_living": st("on"), "light.demo_kitchen": st("on") } });
      const auras = [...html.matchAll(/<circle class="aura"/g)].map((m) => m.index!);
      const groups = [...html.matchAll(/<g[^>]*data-x="/g)].map((m) => m.index!);
      expect(auras).toHaveLength(2);
      expect(Math.max(...auras)).toBeLessThan(Math.min(...groups));
    });

    it("the aura is drawn after the rooms", () => {
      const html = renderFloor(ground, { ...base, state: { "light.demo_kitchen": st("on") } });
      const lastRoom = html.lastIndexOf('data-r="');
      const aura = html.indexOf('class="aura"');
      expect(lastRoom).toBeGreaterThan(-1);
      expect(aura).toBeGreaterThan(lastRoom);
    });

    it("the .aura rule reads --fp-aura at --fp-alpha and never catches the pointer", () => {
      expect(FLOORPLAN_CSS).toMatch(/\.aura\{fill:var\(--fp-aura\);fill-opacity:var\(--fp-alpha\);pointer-events:none\}/);
      expect(FLOORPLAN_CSS).toContain("--fp-aura:#f0c419");
    });
  });

  it("S2.6: room_glow tints only the room a lit light sits in, by point-in-polygon of its x,y", () => {
    // light-living (device 0) sits at 250,200, inside room 0 (Living); light-kitchen (device 1) is off.
    const html = renderFloor(ground, { ...base, roomGlow: true, state: { "light.demo_living": st("on") } });
    expect(html).toMatch(/<polygon data-r="0" class="[^"]*\bglow\b[^"]*"/);
    for (let i = 1; i < ground.rooms.length; i++) expect(html).not.toMatch(new RegExp(`<polygon data-r="${i}" class="[^"]*\\bglow\\b`));
  });

  it("S2.6: with room_glow off (the default), a lit light gives no room the glow class", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_living": st("on") } });
    expect(html).not.toMatch(/\bglow\b/);
  });

  it("S2.6: a bound light counts by its own boundClassOf result, on through the switch alone still glows its room", () => {
    // light-living (device 0, in room 0) is already bound to switch.demo_living_relay in the demo layout; the
    // light's own entity is missing from state entirely, only the switch is on.
    const html = renderFloor(ground, { ...base, roomGlow: true, state: { "switch.demo_living_relay": st("on") } });
    expect(html).toMatch(/<polygon data-r="0" class="[^"]*\bglow\b[^"]*"/);
  });

  it("S2.6 Break it: a light outside every room glows nothing and throws nothing, same for a non-finite coordinate", () => {
    const f = structuredClone(ground);
    f.devices.push({ id: "stray", type: "light", entity: "light.stray", x: 5000, y: 5000 });
    f.devices.push({ id: "nan", type: "light", entity: "light.nan", x: NaN, y: 10 });
    expect(() =>
      renderFloor(f, { ...base, roomGlow: true, state: { "light.stray": st("on"), "light.nan": st("on") } }),
    ).not.toThrow();
    const html = renderFloor(f, { ...base, roomGlow: true, state: { "light.stray": st("on"), "light.nan": st("on") } });
    expect(html).not.toMatch(/\bglow\b/);
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

  it("S2.5: shows a humidity label with its unit", () => {
    const f = { ...ground, devices: [{ id: "h", type: "humidity", entity: "sensor.demo_bathroom_humidity", x: 100, y: 100 }] } as unknown as typeof ground;
    const html = renderFloor(f, { ...base, state: { "sensor.demo_bathroom_humidity": st("48", { attributes: { unit_of_measurement: "%" } }) } });
    expect(html).toContain("48 %");
  });

  it("shows a dash for an unknown sensor value", () => {
    const html = renderFloor(ground, { ...base, state: { "sensor.demo_living_temperature": st("unknown") } });
    expect(html).toMatch(/class="val"[^>]*>–</);
  });

  it("S2.5 Break it: an unavailable humidity sensor also shows a dash, not the raw word", () => {
    const f = { ...ground, devices: [{ id: "h", type: "humidity", entity: "sensor.demo_bathroom_humidity", x: 100, y: 100 }] } as unknown as typeof ground;
    const html = renderFloor(f, { ...base, state: { "sensor.demo_bathroom_humidity": st("unavailable") } });
    expect(html).toMatch(/class="val"[^>]*>–</);
    expect(html).not.toContain("unavailable<");
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
    const html = renderFloor(ground, { ...base, filter: ["switch"], selection: { t: "dev", i: 0 } });
    expect(html.match(/<g[^>]*data-x="/g)).toHaveLength(2);
  });

  it("filters devices by several types at once", () => {
    const both = renderFloor(ground, { ...base, filter: ["switch", "light"] }).match(/<g[^>]*data-x="/g)?.length;
    const single = renderFloor(ground, { ...base, filter: ["switch"] }).match(/<g[^>]*data-x="/g)?.length ?? 0;
    expect(both).toBeGreaterThan(single); // adding a second type shows more devices than either alone
    expect(renderFloor(ground, { ...base, filter: [...DEVICE_TYPES] })).toBe(renderFloor(ground, { ...base, filter: [] })); // every type checked equals no filter at all
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
    expect(FLOORPLAN_CSS).toMatch(/\.room-zone:not\(\[fill\]\)\{[^}]*fill:none\}/);
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
    // The demo ground floor has lights and a camera, so the plain 60 cm pad (S5.7) widens to DEVICE_REACH.
    expect(viewBoxFor(ground, 60)).toEqual({ x: -100, y: -100, w: 1000, h: 800 });
  });
  it("defaults to 60 cm of padding, widened when a light or camera is on the floor", () => {
    expect(viewBoxFor(ground).x).toBe(-100);
  });

  it("S5.7: keeps the plain padding exactly when nothing on the floor reaches further", () => {
    const f = structuredClone(ground);
    f.devices = [];
    expect(viewBoxFor(f, 60)).toEqual({ x: -60, y: -60, w: 920, h: 720 });
  });

  it("S5.7: widens the padding so a lamp's aura, 20 cm inside the right wall, is never clipped", () => {
    const f = structuredClone(ground);
    f.devices = [{ id: "l1", type: "light", entity: "light.x", x: 780, y: 300 }];
    const v = viewBoxFor(f, 60);
    expect(v.x + v.w).toBeGreaterThanOrEqual(780 + DEVICE_REACH);
  });

  it("S5.7: widens the padding so a camera's cone, 20 cm inside the top wall, is never clipped", () => {
    const f = structuredClone(ground);
    f.devices = [{ id: "c1", type: "camera", entity: "camera.x", x: 400, y: 20 }];
    const v = viewBoxFor(f, 60);
    expect(v.y).toBeLessThanOrEqual(20 - DEVICE_REACH);
  });

  it("S5.7 break it: a light exactly on the wall, or the plan's only device, still gives a finite box with the whole circle inside", () => {
    const f = structuredClone(ground);
    f.devices = [{ id: "l1", type: "light", entity: "light.x", x: 800, y: 300 }];
    const v = viewBoxFor(f, 60);
    expect(Number.isFinite(v.x) && Number.isFinite(v.w) && Number.isFinite(v.y) && Number.isFinite(v.h)).toBe(true);
    expect(v.x + v.w).toBeGreaterThanOrEqual(800 + DEVICE_REACH);
    expect(v.x).toBeLessThanOrEqual(800 - DEVICE_REACH);
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
    expect(FLOORPLAN_CSS).toMatch(/\.room-garden:not\(\[fill\]\)\{[^}]*--fp-room-fill:var\(--fp-garden\)[^}]*\}/);
    expect(FLOORPLAN_CSS).toMatch(/\.room-terrace:not\(\[fill\]\)\{[^}]*--fp-room-fill:var\(--fp-terrace\)[^}]*\}/);
    expect(FLOORPLAN_CSS).toMatch(/\.room-pavement:not\(\[fill\]\)\{[^}]*--fp-room-fill:var\(--fp-pavement\)[^}]*\}/);
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
    expect(FLOORPLAN_CSS).toMatch(/\.room-fill\{[^}]*fill:url\(#fp-hatch\)\}/);
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
    expect(FLOORPLAN_CSS).toContain(".room:not([fill]){--fp-room-fill:var(--fp-room-empty);fill:var(--fp-room-fill)}");
    expect(FLOORPLAN_CSS).toMatch(/\.room-fill\{[^}]*fill:url\(#fp-hatch\)\}/);
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

describe("theme (S2.12)", () => {
  it("wraps the plan in a data-theme group for a named theme, marks ha+dark, and writes nothing for an unknown name", () => {
    expect(renderFloor(ground, { ...base, theme: "blueprint" })).toContain('<g data-theme="blueprint">');
    expect(renderFloor(ground, { ...base, theme: "light" })).toContain('<g data-theme="light">');
    expect(renderFloor(ground, { ...base, theme: "ha" })).toContain('<g data-theme="ha">');
    expect(renderFloor(ground, { ...base, theme: "ha", dark: true })).toContain('<g data-theme="ha" data-mode="dark">');
    expect(renderFloor(ground, { ...base, theme: "light", dark: true })).not.toContain("data-mode"); // dark only means something to ha
    expect(renderFloor(ground, { ...base, theme: "dark" as never })).not.toContain("data-theme");
    expect(renderFloor(ground, base)).not.toContain("data-theme");
  });
  it("the default block is blueprint; light and ha override it, and ha maps only neutrals onto Home Assistant's variables, each with a fallback", () => {
    const tokenPairs = (css: string) => new Map((css.match(/--fp-[a-z-]+:[^;]+/g) ?? []).map((kv) => { const j = kv.indexOf(":"); return [kv.slice(0, j), kv.slice(j + 1).replace(/\}$/, "")]; }));
    const block = (sel: string) => FLOORPLAN_CSS.match(new RegExp(sel.replace(/[[\]().]/g, "\\$&") + "[^{]*\\{[^}]*\\}", "s"))?.[0] ?? "";
    const base_ = tokenPairs(FLOORPLAN_CSS.match(/:host,\.fp\{[^}]*\}/s)?.[0] ?? "");
    const light = tokenPairs(block(':host([data-theme="light"])'));
    // ha's un-themed neutrals fall back to midnight's fixed hexes, not to whatever the default theme (blueprint) currently is
    // (Diego's call, 2026-09-22: ha stays untouched by the new role-generated palettes).
    const midnight = tokenPairs(block(':host([data-theme="midnight"])'));
    const ha = tokenPairs(block(':host([data-theme="ha"])'));
    expect(new Set(light.keys())).toEqual(new Set(base_.keys())); // every token is defined by every theme
    for (const k of ["--fp-ink", "--fp-bg", "--fp-room", "--fp-wall", "--fp-disc", "--fp-outline", "--fp-measure", "--fp-wall-external"])
      expect(light.get(k), k).not.toBe(midnight.get(k)); // a light block copied from midnight would fail here
    for (const k of ["--fp-ink", "--fp-bg", "--fp-room", "--fp-wall", "--fp-measure"]) expect(ha.get(k), k).toMatch(/^var\(--[a-z-]+,[^)]+\)$/);
    for (const k of ["--fp-on", "--fp-danger", "--fp-warn", "--fp-primary"]) if (midnight.has(k)) expect(ha.get(k), k).toBe(midnight.get(k)); // meaning colours never follow the host's theme
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
    expect(FLOORPLAN_CSS).toContain("--fp-disc-alpha:.5");
    expect(FLOORPLAN_CSS).not.toMatch(/--fp-disc-alpha:(?!0?\.5[;},])/); // one value in every theme (Diego, 2026-09-23)
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

  it("S2.5: the heater bar carries the on class only when hvac_action is heating", () => {
    const f = { ...ground, devices: [{ id: "bar", type: "heater", entity: "climate.bar", a: [3000, 10], b: [3100, 10] }] } as unknown as typeof ground;
    const heating = renderFloor(f, { ...base, state: { "climate.bar": st("heat", { attributes: { hvac_action: "heating" } }) } });
    expect(heating).toMatch(/<line data-xbar="0" class="heater on"/);
    const idle = renderFloor(f, { ...base, state: { "climate.bar": st("heat", { attributes: { hvac_action: "idle" } }) } });
    expect(idle).toMatch(/<line data-xbar="0" class="heater off"/);
    const noState = renderFloor(f, base);
    expect(noState).toMatch(/<line data-xbar="0" class="heater off"/);
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
    const want: Record<string, string> = { light: "#e0a800", motion: "#d64545", contact: "#d64545", heater: "#e8801a", climate: "#e8801a", "ac-cool": "#2c7fb8", "ac-heat": "#e8801a", tv: "#2c7fb8", plug: "#2c7fb8", computer: "#2c7fb8", camera: "#4a4a48", garden: "#3f8f4f", person: "#1b9e77" };
    for (const [k, v] of Object.entries(want)) expect(FLOORPLAN_CSS).toContain(`--fp-dev-${k}:${v}`);
    expect(FLOORPLAN_CSS).toContain(".dev-camera path{fill:var(--fp-dev-camera)}");
    expect(FLOORPLAN_CSS).toContain(".dev.outdoor path{fill:var(--fp-dev-garden)}");
  });
});

describe("S2.9: a device wears its colour when it is on", () => {
  const dev = (type: string, entity: string, extra: Record<string, unknown> = {}) => ({ id: `${type}-x`, type, entity, x: 50, y: 50, ...extra });
  const draw = (devices: unknown[], state: StateOverlay) =>
    renderFloor({ ...ground, rooms: [], devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [] } as unknown as typeof ground, { ...base, state });
  const classOfDev = (html: string, i = 0) => html.match(new RegExp(`<g data-x="${i}" class="([^"]*)"`))![1].split(" ");

  it("one CSS rule per type sets --fp-dev on .dev-<type>.on; switch and humidity fall back to --fp-idle", () => {
    const want: Record<string, string> = {
      light: "var(--fp-dev-light)", motion: "var(--fp-dev-motion)", contact: "var(--fp-dev-contact)", heater: "var(--fp-dev-heater)",
      climate: "var(--fp-dev-climate)", tv: "var(--fp-dev-tv)", plug: "var(--fp-dev-plug)", computer: "var(--fp-dev-computer)",
      switch: "var(--fp-idle)", humidity: "var(--fp-idle)", person: "var(--fp-dev-person)",
    };
    for (const [type, value] of Object.entries(want))
      expect(FLOORPLAN_CSS, type).toContain(`.dev-${type}.on{--fp-dev:${value}}`);
  });

  it("the two shared rules read --fp-dev on the icon and the halo, and the halo keeps --fp-alpha (25%) while on", () => {
    expect(FLOORPLAN_CSS).toContain(".dev.on path{fill:var(--fp-dev-fill,var(--fp-dev));opacity:var(--fp-dev-opacity,1)}");
    expect(FLOORPLAN_CSS).toContain(".dev.on .halo{fill:var(--fp-dev);fill-opacity:var(--fp-alpha)}");
  });

  it("a contact device carries the on class, and the old --fp-open override on .dev-contact.on path is gone (a second source of the same colour)", () => {
    expect(FLOORPLAN_CSS).not.toContain(".dev-contact.on path{fill:var(--fp-open)}");
    const html = draw([dev("contact", "binary_sensor.x")], { "binary_sensor.x": st("on") });
    expect(classOfDev(html)).toEqual(["dev", "dev-contact", "on"]);
  });

  it("a door contact sensor (not a device icon) also draws red now, not the old orange --fp-open", () => {
    expect(FLOORPLAN_CSS).toContain(".door.open{stroke:var(--fp-dev-contact)}");
    expect(FLOORPLAN_CSS).toContain(".door.cover-open{stroke:var(--fp-open)}"); // a cover's own open state is unrelated to contact and stays orange
  });

  it("a motion device that is on carries the on class (its icon colour is still the fade rule, checked by its own CSS pair)", () => {
    const html = draw([dev("motion", "binary_sensor.m")], { "binary_sensor.m": st("on") });
    expect(classOfDev(html)).toEqual(["dev", "dev-motion", "on"]);
  });

  it("a tv, a plug and a computer that are on carry the on class; off does not", () => {
    for (const type of ["tv", "plug", "computer"]) {
      const on = draw([dev(type, `switch.${type}`)], { [`switch.${type}`]: st("on") });
      expect(classOfDev(on), type).toContain("on");
      const off = draw([dev(type, `switch.${type}`)], { [`switch.${type}`]: st("off") });
      expect(classOfDev(off), type).not.toContain("on");
    }
  });

  it("a wall switch that is on carries the on class, but its --fp-dev is --fp-idle, same as off", () => {
    const html = draw([dev("switch", "switch.hall")], { "switch.hall": st("on") });
    expect(classOfDev(html)).toContain("on");
    expect(FLOORPLAN_CSS).toContain(".dev-switch.on{--fp-dev:var(--fp-idle)}");
  });

  it("Break it: an unavailable light keeps the unavailable class, never on, whatever the colour rule says", () => {
    const html = draw([dev("light", "light.x")], { "light.x": st("unavailable") });
    expect(classOfDev(html)).toContain("unavailable");
    expect(classOfDev(html)).not.toContain("on");
  });
});

// The done-when says one row per type with its colour, and "grey on purpose" is a colour like any other. A type
// that nobody decided about falls through the catch-all and reads idle grey, which is indistinguishable on screen
// from a deliberate grey — the S2.9 verifier found media, cover and other sitting there while SPEC promised media
// an accent. This test makes every member of DEVICE_TYPES a decision someone had to write down.
describe("S2.9: every device type has a decided active colour", () => {
  const IDLE_ON_PURPOSE = ["switch", "humidity", "temp", "other", "camera", "battery", "inverter", "server", "access_point", "boiler", "car", "ups", "printer", "speaker"]; // S2.13: these are monitored, not switched; the S4.25 five are unlinked-only types with no entity state to read, so never on
  it.each(DEVICE_TYPES)("%s either names its own --fp-dev or is idle on purpose", (t) => {
    if (t === "ac") return; // ac has two: .dev-ac.cool.on and .dev-ac.heat.on, tested below
    const rule = new RegExp(`\\.dev-${t}\\.on\\{--fp-dev:var\\((--fp-[a-z-]+)\\)\\}`);
    const m = FLOORPLAN_CSS.match(rule);
    if (IDLE_ON_PURPOSE.includes(t)) return; // the catch-all .dev.on{--fp-dev:var(--fp-idle)} covers these
    expect(m, `no .dev-${t}.on rule: it would read idle grey with no one having chosen that`).not.toBeNull();
    expect(FLOORPLAN_CSS).toContain(`${m![1]}:#`); // the variable it names is a real token, not a typo
  });
});

describe("S2.9: a room or a piece of furniture with an entity carries the on class", () => {
  const room = (kind: string, extra: Record<string, unknown> = {}) => ({ id: "r", name: "pond", area: "", label: "", kind, pts: [[0, 0], [100, 0], [100, 100], [0, 100]], wk: Array(4).fill("wall"), ...extra });
  const furn = (extra: Record<string, unknown> = {}) => ({ id: "f", symbol: "patio-wood", x: 50, y: 50, rot: 0, w: 100, h: 100, ...extra });
  const draw = (rooms: unknown[], furniture: unknown[], state: StateOverlay) =>
    renderFloor({ ...ground, rooms, devices: [], furniture, doors: [], walls: [], openings: [], stairs: [], extras: [] } as unknown as typeof ground, { ...base, state });
  const roomClass = (html: string) => html.match(/<polygon data-r="0" class="([^"]*)"/)![1].split(" ");
  const furnClass = (html: string) => html.match(/<g data-f="0" class="([^"]*)"/)![1].split(" ");

  it("a water room with entity on carries on; the same room without the entity does not", () => {
    const withEntity = draw([room("water", { entity: "switch.pond_pump" })], [], { "switch.pond_pump": st("on") });
    expect(roomClass(withEntity)).toEqual(["room", "room-water", "water", "on"]);
    const withoutEntity = draw([room("water")], [], { "switch.pond_pump": st("on") });
    expect(roomClass(withoutEntity)).toEqual(["room", "room-water", "water"]);
  });

  it("a room with an area is never tinted this way, even with an entity", () => {
    const withArea = draw([room("water", { entity: "switch.pond_pump", area: "garden" })], [], { "switch.pond_pump": st("on") });
    expect(roomClass(withArea)).not.toContain("on");
  });

  it("open and playing also count as on; off does not", () => {
    expect(roomClass(draw([room("zone", { entity: "cover.gate" })], [], { "cover.gate": st("open") }))).toContain("on");
    expect(roomClass(draw([room("zone", { entity: "media_player.x" })], [], { "media_player.x": st("playing") }))).toContain("on");
    expect(roomClass(draw([room("zone", { entity: "cover.gate" })], [], { "cover.gate": st("closed") }))).not.toContain("on");
  });

  it("a piece of furniture with an entity carries the on class when its state is on; off, or no entity, does not", () => {
    const on = draw([], [furn({ entity: "switch.gate" })], { "switch.gate": st("on") });
    expect(furnClass(on)).toEqual(["furn", "on"]);
    const off = draw([], [furn({ entity: "switch.gate" })], { "switch.gate": st("off") });
    expect(furnClass(off)).toEqual(["furn"]);
    const noEntity = draw([], [furn()], { "switch.gate": st("on") });
    expect(furnClass(noEntity)).toEqual(["furn"]);
  });

  // The ring pass is a second polygon over the walls, and it must never take a click. The pointer-events attribute
  // on the markup is not enough on its own: the editor sets .room{pointer-events:all}, and any author rule beats a
  // presentation attribute, so the ring needs a class of its own to outrank it.
  it("the ring is marked so no rule can make it a click target, and it carries no data-r", () => {
    const html = draw([room("water", { entity: "switch.pond_pump" })], [], { "switch.pond_pump": st("on") });
    const ring = html.match(/<polygon class="room on ring"[^>]*\/>/)![0];
    expect(ring).toContain('pointer-events="none"');
    expect(ring).not.toContain("data-r");
    expect(FLOORPLAN_CSS).toContain(".room.ring{pointer-events:none}");
    const off = draw([room("water", { entity: "switch.pond_pump" })], [], { "switch.pond_pump": st("off") });
    expect(off).not.toContain("ring");
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
    f.devices = []; // pure padding/rotation geometry, not S5.7's device-reach widening
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
  const LIGHT_BLOCK = FLOORPLAN_CSS.match(/:host\(\[data-theme="light"\]\)[^{]*\{[^}]*\}/s)?.[0] ?? "";
  it("DEVICE_COLOURS gives every device type a #rrggbb default that matches the palette variables", () => {
    for (const t of DEVICE_TYPES) expect(DEVICE_COLOURS[t], t).toMatch(/^#[0-9a-f]{6}$/);
    expect(DEVICE_COLOURS.light).toBe("#e0a800");
    expect(FLOORPLAN_CSS).toContain(`--fp-dev-camera:${DEVICE_COLOURS.camera}`);
    // The editor's colour picker offers DEVICE_COLOURS[t] as the default, so a type whose palette variable says
    // one thing while this map says another shows the user a swatch the plan will not draw. Check every type that
    // has a variable of its own, not just the two that were spot-checked here before.
    for (const t of DEVICE_TYPES) {
      // the light block: DEVICE_COLOURS are the light palette, and a few types (camera) have a lighter value on blueprint
      const v = LIGHT_BLOCK.match(new RegExp(`--fp-dev-${t}:(#[0-9a-f]{6})`));
      if (v) expect(DEVICE_COLOURS[t], t).toBe(v[1]);
    }
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
  // S7.1: two more rows, 64k below then 64k above, before the centroid is kept regardless.
  const three: [number, number][] = [[200, 100], [200, 100 + 32 * k], [200, 100 - 32 * k]];
  it("S7.1: moves 64k down when the three near spots are taken", () => { expect(nameY(floor("room", three))).toBe(cy + 64 * k); });
  it("S7.1: moves 64k up when 64k down is taken too", () => { expect(nameY(floor("room", [...three, [200, 100 + 64 * k]]))).toBe(cy - 64 * k); });
  it("stays at the centroid when all five spots are taken, so nothing is dropped", () => {
    expect(nameY(floor("room", [...three, [200, 100 + 64 * k], [200, 100 - 64 * k]]))).toBe(cy);
  });
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

describe("an air conditioner shows what it is doing (S2.10)", () => {
  const ac = { id: "ac1", type: "ac", entity: "climate.ac", x: 100, y: 100 };
  const fl = { ...ground, devices: [ac] } as never;
  const draw = (state: string, attributes: Record<string, unknown> = {}) =>
    renderFloor(fl, { ...base, state: { "climate.ac": { state, attributes, last_changed: "2026-01-01T00:00:00Z" } } as never });
  const cls = (svg: string) => svg.match(/class="(dev dev-ac[^"]*)"/)?.[1];
  it.each([
    ["cooling", "cool", "dev dev-ac cool on"], ["heating", "heat", "dev dev-ac heat on"],
  ])("hvac_action %s draws %s", (a, state, want) => { expect(cls(draw(state, { hvac_action: a }))).toBe(want); });
  it("hvac_action idle is grey even when the mode is cool", () => { expect(cls(draw("cool", { hvac_action: "idle" }))).toBe("dev dev-ac off"); });
  it("with no hvac_action, state cool is blue, heat is orange, fan_only and dry are grey", () => {
    expect(cls(draw("cool"))).toBe("dev dev-ac cool on");
    expect(cls(draw("heat"))).toBe("dev dev-ac heat on");
    expect(cls(draw("fan_only"))).toBe("dev dev-ac off");
    expect(cls(draw("dry"))).toBe("dev dev-ac off");
  });
  it("break it: off wins over a stale hvac_action of cooling", () => { expect(cls(draw("off", { hvac_action: "cooling" }))).toBe("dev dev-ac off"); });
  it("unavailable is unavailable, and a missing entity draws grey without throwing", () => {
    expect(cls(draw("unavailable", { hvac_action: "cooling" }))).toBe("dev dev-ac unavailable");
    expect(cls(renderFloor(fl, { ...base, state: {} as never }))).toBe("dev dev-ac off");
  });
  it("the two colour rules exist and name real tokens", () => {
    expect(FLOORPLAN_CSS).toContain(".dev-ac.cool.on{--fp-dev:var(--fp-dev-ac-cool)}");
    expect(FLOORPLAN_CSS).toContain(".dev-ac.heat.on{--fp-dev:var(--fp-dev-ac-heat)}");
  });
});

describe("unlinked appliances (S4.25)", () => {
  const heater = { id: "u1", type: "heater" as const, x: 200, y: 200, rot: 0, scale: 1 };
  const fl = { ...ground, unlinked: [heater] } as never;

  it("draws one g[data-u] group per unlinked item, class 'dev unl', with the icon path for its type", () => {
    const html = renderFloor(fl, base);
    expect(html.match(/<g[^>]*data-u="/g)).toHaveLength(1);
    const group = html.match(/<g data-u="0"[^>]*>[^]*?<\/g>/)![0];
    expect(group).toContain('class="dev unl"');
    expect(group).toContain(DEVICE_ICONS.heater);
  });

  it("never carries .on: an unlinked item has no entity state to read", () => {
    const html = renderFloor(fl, base);
    expect(html.match(/<g data-u="0"[^>]*>/)![0]).not.toContain(" on");
  });

  it("carries .sel when it is the current selection, mirroring a device", () => {
    const sel = renderFloor(fl, { ...base, selection: { t: "unl", i: 0 } });
    expect(sel.match(/<g data-u="0"[^>]*>/)![0]).toContain("dev unl sel");
    const none = renderFloor(fl, { ...base, selection: { t: "dev", i: 0 } });
    expect(none.match(/<g data-u="0"[^>]*>/)![0]).not.toContain("sel");
  });

  it("a per-instance color becomes --fp-dev-fill; a malformed one is dropped, not thrown on", () => {
    const coloured = { ...ground, unlinked: [{ ...heater, color: "#ff0000" }] } as never;
    expect(renderFloor(coloured, base)).toMatch(/data-u="0"[^>]*style="[^"]*--fp-dev-fill:#ff0000/);
    const bad = { ...ground, unlinked: [{ ...heater, color: "red" }] } as never;
    expect(renderFloor(bad, base).match(/<g data-u="0"[^>]*>/)![0]).not.toContain("--fp-dev-fill");
  });

  it("scale changes the group's transform scale, distinct from the plan's own k", () => {
    const small = renderFloor({ ...ground, unlinked: [{ ...heater, scale: 0.25 }] } as never, base);
    const big = renderFloor({ ...ground, unlinked: [{ ...heater, scale: 4 }] } as never, base);
    const scaleOf = (svg: string) => Number(svg.match(/<g data-u="0"[^>]*>/)![0].match(/scale\(([\d.]+)\)/)![1]);
    expect(scaleOf(big)).toBeCloseTo(scaleOf(small) * 16, 3); // 4 / 0.25 = 16x
  });

  it("rot turns the glyph itself, unlike a device's icon which counter-turns to stay upright (asymmetric check, not [1,0])", () => {
    const html = renderFloor({ ...ground, unlinked: [{ ...heater, rot: 33 }] } as never, base);
    const group = html.match(/<g data-u="0"[^>]*>[^]*?<\/g>/)![0];
    expect(group).toContain('rotate(33 12 12)');
    expect(group).not.toContain("rotate(-33 12 12)"); // no counter-turn: the icon visibly rotates, like furniture
  });

  it("attached does not change the class: it is reference-only, never state (Opus finding 12 discipline)", () => {
    const withAttach = { ...ground, unlinked: [{ ...heater, attached: ["light.a"] }] } as never;
    expect(renderFloor(withAttach, base).match(/<g data-u="0"[^>]*>/)![0]).toBe(renderFloor(fl, base).match(/<g data-u="0"[^>]*>/)![0]);
  });

  it("a non-finite x or y is skipped without throwing", () => {
    const bad = { ...ground, unlinked: [{ ...heater, x: NaN }] } as never;
    expect(() => renderFloor(bad, base)).not.toThrow();
    expect(renderFloor(bad, base).match(/<g[^>]*data-u="/g)).toBeNull();
  });

  it("every UNLINKED_TYPES member has a real icon (finding 17: a union member is a decision, not a default)", () => {
    for (const t of UNLINKED_TYPES) expect(DEVICE_ICONS[t], t).toBeTruthy();
  });

  it("the CSS fill override rule exists and names --fp-dev-fill with an idle fallback", () => {
    expect(FLOORPLAN_CSS).toContain(".dev.unl path{fill:var(--fp-dev-fill,var(--fp-idle))}");
  });

  it("counts toward contentPoints, so Re-center reaches it", () => {
    expect(contentPoints(fl).some((p) => p[0] === 200 && p[1] === 200)).toBe(true);
  });
});

describe("S7.1: labels never overprint each other", () => {
  type Box = [number, number, number, number]; // x, y, w, h in the screen frame, plan units
  const unesc = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  // Written out here on purpose, not imported from render.ts: the brief's estimate, len x 0.6 x size wide by size tall,
  // the baseline 0.75 of the size below the top. A device icon is its halo, a 16k disc about the icon centre, as a square.
  const boxesOf = (html: string, rotate?: { deg: number; pivot: Pt }) => {
    const scr = (p: Pt): Pt => (rotate ? rotateAbout(p, rotate.deg, rotate.pivot) : p);
    const texts = [...html.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => {
      const a = (n: string) => Number(m[1].match(new RegExp(` ${n}="([^"]+)"`))![1]);
      const size = a("font-size"), s = unesc(m[2]), w = s.length * 0.6 * size, [x, y] = scr([a("x"), a("y")]);
      return { s, box: [x - w / 2, y - 0.75 * size, w, size] as Box };
    });
    // S7.8: a person's translate is a CSS transform in its style (px units, a comma); every other icon's is the attribute.
    const discs = [...html.matchAll(/<g data-[xu]="\d+"[^>]*(?: transform="|transform:)translate\(([-\d.]+)(?:px)?[ ,]([-\d.]+)(?:px)?\) scale\(([\d.]+)\)/g)].map((m) => {
      const s = Number(m[3]), [x, y] = scr([Number(m[1]) + 12 * s, Number(m[2]) + 12 * s]);
      return [x - 16 * s, y - 16 * s, 32 * s, 32 * s] as Box;
    });
    return { texts, discs };
  };
  const EPS = 0.05; // num() rounds every coordinate to 0.01
  const meet = (a: Box, b: Box) => a[0] < b[0] + b[2] - EPS && b[0] < a[0] + a[2] - EPS && a[1] < b[1] + b[3] - EPS && b[1] < a[1] + a[3] - EPS;
  const clashes = (html: string, rotate?: { deg: number; pivot: Pt }) => {
    const { texts, discs } = boxesOf(html, rotate), out: string[] = [];
    texts.forEach((t, i) => {
      for (const u of texts.slice(i + 1)) if (meet(t.box, u.box)) out.push(`"${t.s}" on "${u.s}"`);
      discs.forEach((d, j) => { if (meet(t.box, d)) out.push(`"${t.s}" on icon ${j}`); });
    });
    return out;
  };
  const bare = (f: typeof ground) => { f.doors = []; f.stairs = []; f.walls = []; f.furniture = []; return f; };
  // Every value the demo can show, with units, so the value boxes are as wide as they get on a card.
  const STATE: StateOverlay = {
    "sensor.demo_living_temperature": st("23.5", { attributes: { unit_of_measurement: "°C" } }),
    "sensor.demo_bedroom_temperature": st("19", { attributes: { unit_of_measurement: "°C" } }),
    "sensor.demo_bathroom_humidity": st("54", { attributes: { unit_of_measurement: "%" } }),
    "light.demo_living": st("on"), "light.demo_kitchen": st("on"), "binary_sensor.demo_hall_motion": st("on"),
  };
  const pivot = planPivot(L);

  // Scale 1 is the card; 0.5 is the editor zoomed out, where the text is twice as big against the plan.
  for (const name of ["ground", "first"] as const)
    for (const scale of [1, 0.5])
      for (const deg of [0, 90])
        it(`the demo's ${name} floor at scale ${scale}, turned ${deg}: no text on another text or on an icon`, () => {
          const rotate = deg ? { deg, pivot } : undefined;
          const f = L.floors[name];
          const html = renderFloor(f, { scale, now: NOW, state: STATE, rotate });
          const { texts, discs } = boxesOf(html, rotate);
          expect(texts.length).toBe(f.rooms.filter((r) => r.name && r.kind !== "fill").length + f.devices.filter((d) => d.type === "temp" || d.type === "humidity").length);
          expect(discs.length).toBe(f.devices.length);
          expect(clashes(html, rotate)).toEqual([]);
        });

  it("two tiny neighbouring zones whose names meet at the centroid end up on different rows", () => {
    const f = bare(structuredClone(ground));
    const wk = ["boundary", "boundary", "boundary", "boundary"];
    f.rooms = [
      { id: "a", name: "Reading nook", kind: "zone", area: "", pts: [[0, 0], [60, 0], [60, 40], [0, 40]], wk },
      { id: "b", name: "Music stand", kind: "zone", area: "", pts: [[60, 0], [120, 0], [120, 40], [60, 40]], wk },
    ] as never;
    f.devices = [];
    const html = renderFloor(f, { scale: 1 });
    const y = (n: string) => Number(html.match(new RegExp(`<text class="lbl zone"[^>]* y="([\\d.-]+)"[^>]*>${n}<`))![1]);
    expect(y("Reading nook")).toBe(20); // the first keeps its centroid
    expect(Math.abs(y("Music stand") - 20)).toBeGreaterThanOrEqual(10); // at least a whole row (size 10) away
    expect(clashes(html)).toEqual([]);
  });

  it("a room name, its label, a zone label and a sensor value on one spot all get a place of their own", () => {
    const f = bare(structuredClone(ground));
    f.rooms = [
      { id: "r", name: "Study", label: "3 x 4", kind: "room", area: "", pts: [[0, 0], [200, 0], [200, 200], [0, 200]], wk: ["wall", "wall", "wall", "wall"] },
      { id: "z", name: "Desk corner", kind: "zone", area: "", pts: [[0, 0], [200, 0], [200, 200], [0, 200]], wk: ["boundary", "boundary", "boundary", "boundary"] },
    ] as never;
    f.devices = [{ id: "t", type: "temp", entity: "sensor.t", x: 100, y: 150 }] as never;
    const html = renderFloor(f, { scale: 1, now: NOW, state: { "sensor.t": st("21.5", { attributes: { unit_of_measurement: "°C" } }) } });
    expect(html).toMatch(/<text class="lbl" x="100" y="100"[^>]*font-weight="600">Study</); // the name goes first and keeps its centroid
    for (const t of [">3 x 4<", ">Desk corner<", ">21.5 °C<"]) expect(html).toContain(t);
    expect(clashes(html)).toEqual([]);
  });

  it("a sensor value tries below its icon, then above, then to the right", () => {
    const f = bare(structuredClone(ground));
    f.rooms = [];
    const t = { id: "t", type: "temp", entity: "sensor.t", x: 100, y: 100 };
    const sw = (id: string, y: number) => ({ id, type: "switch", entity: `switch.${id}`, x: 100, y });
    const valAt = (devs: object[]) => {
      const html = renderFloor({ ...f, devices: devs } as never, { scale: 1, now: NOW, state: { "sensor.t": st("7") } });
      expect(clashes(html)).toEqual([]);
      const m = html.match(/<text class="val" x="([\d.-]+)" y="([\d.-]+)"/)!;
      return [Number(m[1]), Number(m[2])];
    };
    const below = valAt([t]);
    expect(below[0]).toBe(100); expect(below[1]).toBeGreaterThan(116);
    const above = valAt([t, sw("s", 140)]);
    expect(above[0]).toBe(100); expect(above[1]).toBeLessThan(84);
    const right = valAt([t, sw("s", 140), sw("u", 60)]);
    expect(right[0]).toBeGreaterThan(116); expect(Math.abs(right[1] - 100)).toBeLessThan(8);
  });

  it("break it: a name longer than its room still draws, whole, at the centroid", () => {
    const f = bare(structuredClone(ground));
    const long = "Storage and laundry!"; // 20 characters in a 100 cm store room: about 168 cm of text
    f.rooms = [{ id: "s", name: long, kind: "room", area: "", pts: [[0, 0], [100, 0], [100, 100], [0, 100]], wk: ["wall", "wall", "wall", "wall"] }] as never;
    f.devices = [];
    expect(renderFloor(f, { scale: 1 })).toMatch(new RegExp(`<text class="lbl" x="50" y="50"[^>]*>${long}<`));
  });

  it("break it: with every candidate row taken, a name still draws at the centroid, the one documented overlap", () => {
    const f = bare(structuredClone(ground));
    f.rooms = [{ id: "s", name: "Store", kind: "room", area: "", pts: [[0, 0], [100, 0], [100, 100], [0, 100]], wk: ["wall", "wall", "wall", "wall"] }] as never;
    f.devices = [0, 32, -32, 64, -64].map((d, i) => ({ id: `d${i}`, type: "switch", entity: `switch.d${i}`, x: 50, y: 50 + d })) as never;
    const html = renderFloor(f, { scale: 1 });
    expect(html).toMatch(/<text class="lbl" x="50" y="50"[^>]*>Store</);
    expect(clashes(html)).toEqual(['"Store" on icon 0']);
  });
});

describe("renderFloor: trace image (S7.11)", () => {
  const SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const traced = (t: Partial<NonNullable<Layout["floors"][string]["trace"]>> = {}) =>
    ({ ...structuredClone(ground), trace: { src: SRC, x: 10, y: -20, w: 500, rot: 90, alpha: 0.3, on: true, ...t } });

  it("with trace: true draws <image class=\"trace\"> first, with href, x, y, width, opacity and transform", () => {
    const html = renderFloor(traced(), { scale: 0.5, trace: true });
    expect(html.startsWith('<image class="trace"')).toBe(true);
    const img = html.slice(0, html.indexOf("/>") + 2);
    expect(img).toContain(`href="${SRC}"`);
    expect(img).toContain('x="10"');
    expect(img).toContain('y="-20"');
    expect(img).toContain('width="500"');
    expect(img).toContain('opacity="0.3"');
    expect(img).toContain('transform="rotate(90 10 -20)"');
    expect(html.match(/<image/g)).toHaveLength(1);
  });

  it("stays first inside a turned plan and inside a theme group", () => {
    const html = renderFloor(traced(), { scale: 0.5, trace: true, theme: "light", rotate: { deg: 90, pivot: [0, 0] } });
    expect(html).toMatch(/^<g data-theme="light"><g class="plan-turn"[^>]*><image class="trace"/);
  });

  it("draws nothing without the option, with the option false, or with on: false", () => {
    expect(renderFloor(traced(), { scale: 0.5 })).not.toContain("<image");
    expect(renderFloor(traced(), { scale: 0.5, trace: false })).not.toContain("<image");
    expect(renderFloor(traced({ on: false }), { scale: 0.5, trace: true })).not.toContain("<image");
    expect(renderFloor(traced(), { scale: 0.5 })).toBe(renderFloor(ground, { scale: 0.5 }));
  });

  it("draws nothing for an untrusted src that validate would refuse, and never lets a quote out", () => {
    for (const src of [`${SRC}"><script>alert(1)</script>`, "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4="]) {
      const html = renderFloor(traced({ src }), { scale: 0.5, trace: true });
      expect(html, src).not.toContain("<image");
      expect(html, src).not.toContain("<script");
    }
    expect(renderFloor(traced({ w: 0 }), { scale: 0.5, trace: true })).not.toContain("<image");
    expect(renderFloor(traced({ x: NaN }), { scale: 0.5, trace: true })).not.toContain("<image");
  });
});

describe("S7.6 night", () => {
  const nightRows = (html: string) => [...html.matchAll(/<polygon data-night="(\d+)" class="room-night( lit)?"/g)].map((m) => [Number(m[1]), !!m[2]] as const);

  it("sets class night on the root, with or without a plan theme", () => {
    expect(renderFloor(ground, { ...base, night: true })).toMatch(/^<g class="night">/);
    expect(renderFloor(ground, { ...base, night: true, theme: "light" })).toMatch(/^<g data-theme="light" class="night">/);
  });

  it("without night draws no overlay and no night class", () => {
    const html = renderFloor(ground, { ...base, theme: "light", state: { "light.demo_living": st("on") } });
    expect(html).not.toMatch(/room-night|class="night"/);
  });

  it("draws one overlay per room, outdoor kinds included, none for the zone or the stairs", () => {
    // ground: 0 Living, 1 Kitchen, 2 Hall (room), 3 Reading corner (zone), 4 Garden, 5 Pavement, 6 Garden pond (water); one staircase.
    const rows = nightRows(renderFloor(ground, { ...base, night: true }));
    expect(rows.map((r) => r[0])).toEqual([0, 1, 2, 4, 5, 6]);
    expect(rows.every((r) => !r[1])).toBe(true);
  });

  it("marks lit exactly the rooms with an on light inside them", () => {
    const rows = nightRows(renderFloor(ground, { ...base, night: true, state: { "light.demo_kitchen": st("on"), "light.demo_living": st("off") } }));
    expect(rows.filter((r) => r[1]).map((r) => r[0])).toEqual([1]);
    // a bound light that is on through its switch alone counts, as it does for room_glow
    const bound = nightRows(renderFloor(ground, { ...base, night: true, state: { "switch.demo_living_relay": st("on") } }));
    expect(bound.filter((r) => r[1]).map((r) => r[0])).toEqual([0]);
  });

  it("the overlay sits over the room fills and stairs, under the walls and devices", () => {
    const html = renderFloor(ground, { ...base, night: true });
    const firstNight = html.indexOf('class="room-night'), lastRoom = html.lastIndexOf("<polygon data-r="), stairs = html.lastIndexOf("<g data-s="), wall = html.indexOf('<line class="eh'), dev = html.indexOf("<g data-x=");
    expect(firstNight).toBeGreaterThan(lastRoom);
    expect(firstNight).toBeGreaterThan(stairs);
    expect(firstNight).toBeLessThan(wall);
    expect(firstNight).toBeLessThan(dev);
  });

  it("every room kind is a decision: overlaid or not", () => {
    const decided: Record<RoomKind, boolean> = { room: true, garden: true, pavement: true, fill: true, terrace: true, water: true, structure: false, zone: false };
    for (const kind of ROOM_KINDS) {
      const f = structuredClone(ground);
      f.rooms = [{ id: "k", name: "K", area: "", label: "", kind, pts: [[0, 0], [100, 0], [100, 100], [0, 100]], wk: Array(4).fill(kind === "zone" ? "boundary" : "wall") }];
      expect(nightRows(renderFloor(f, { ...base, night: true })).length, kind).toBe(decided[kind] ? 1 : 0);
    }
  });

  it("Break it: a light outside every room, or at a non-finite point, lights nothing and throws nothing", () => {
    const f = structuredClone(ground);
    f.devices.push({ id: "stray", type: "light", entity: "light.stray", x: 5000, y: 5000 });
    f.devices.push({ id: "nan", type: "light", entity: "light.nan", x: NaN, y: 10 });
    const html = renderFloor(f, { ...base, night: true, state: { "light.stray": st("on"), "light.nan": st("on") } });
    expect(nightRows(html).length).toBe(6);
    expect(nightRows(html).filter((r) => r[1])).toEqual([]);
  });

  it("the stylesheet fills the overlay with --fp-night, clears a lit one, and never takes a click", () => {
    expect(FLOORPLAN_CSS).toContain(".night .room-night{fill:var(--fp-night)}");
    expect(FLOORPLAN_CSS).toContain(".night .room-night.lit{fill:none}");
    expect(FLOORPLAN_CSS).toContain(".room-night{fill:none;pointer-events:none}");
  });
});

describe("S7.8: people on the plan", () => {
  // The demo ground floor without its devices: the positions below are the room's own, with no other icon to avoid.
  const empty = { ...structuredClone(ground), devices: [] as typeof ground.devices };
  const n0 = 0;
  const P = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "person", entity: `person.${id}`, x: 200, y: 520, ...extra });
  const draw = (people: unknown[], state: StateOverlay, f0 = empty) => renderFloor({ ...structuredClone(f0), devices: [...f0.devices, ...people] } as never, { ...base, state });
  const openTag = (html: string, i = n0) => html.match(new RegExp(`<g data-x="${i}"[^>]*>`))![0];
  const groupOf = (html: string, i = n0) => { const s = html.indexOf(openTag(html, i)); return html.slice(s, html.indexOf('<g data-x="', s + 5) > 0 ? html.indexOf('<g data-x="', s + 5) : undefined); };
  const classesOf = (html: string, i = n0) => openTag(html, i).match(/class="([^"]*)"/)![1].split(" ");
  /** The icon's centre, from its translate (attribute or CSS) plus half the 24-unit glyph box times its scale. */
  const centreOf = (html: string, i = n0): Pt => {
    const m = openTag(html, i).match(/translate\((-?[\d.]+)(?:px)?[ ,]+(-?[\d.]+)(?:px)?\) scale\(([\d.]+)\)/)!;
    const k = Number(m[3]);
    return [Number(m[1]) + 12 * k, Number(m[2]) + 12 * k];
  };
  const near = (a: Pt, b: Pt) => { expect(a[0]).toBeCloseTo(b[0], 1); expect(a[1]).toBeCloseTo(b[1], 1); };
  const inRect = (p: Pt, x0: number, y0: number, x1: number, y1: number) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1;

  it("home is full and on; not_home or any other zone is away and not on", () => {
    const home = classesOf(draw([P("a")], { "person.a": st("home") }));
    expect(home).toEqual(expect.arrayContaining(["dev-person", "on", "home"]));
    expect(home).not.toContain("away");
    for (const s of ["not_home", "Work"]) {
      const c = classesOf(draw([P("a")], { "person.a": st(s) }));
      expect(c, s).toContain("away");
      expect(c, s).not.toContain("on");
      expect(c, s).not.toContain("home");
    }
  });

  it("unavailable and unknown read as every other device: unavailable, neither home nor away", () => {
    for (const s of ["unavailable", "unknown"]) {
      const c = classesOf(draw([P("a")], { "person.a": st(s) }));
      expect(c, s).toContain("unavailable");
      expect(c, s).not.toContain("home");
      expect(c, s).not.toContain("away");
    }
  });

  it("away draws an away mark inside the icon group; home does not", () => {
    expect(groupOf(draw([P("a")], { "person.a": st("not_home") }))).toContain('class="away-mark"');
    expect(groupOf(draw([P("a")], { "person.a": st("home") }))).not.toContain("away-mark");
  });

  it("with no room sensor the icon stays where it was placed", () => {
    near(centreOf(draw([P("a")], { "person.a": st("home") })), [200, 520]);
  });

  it("a room sensor whose state names Kitchen moves the icon to the kitchen's centroid", () => {
    near(centreOf(draw([P("a", { room: "sensor.a_room" })], { "person.a": st("home"), "sensor.a_room": st("Kitchen") })), [650, 200]);
  });

  it("break it: the kitchen light sits at the centroid; the person moves beside it, inside the kitchen, never over it", () => {
    const n = ground.devices.length;
    const html = draw([P("a", { room: "sensor.r" })], { "person.a": st("home"), "sensor.r": st("Kitchen") }, ground);
    const p = centreOf(html, n);
    expect(Math.hypot(p[0] - 650, p[1] - 200)).toBeGreaterThanOrEqual(64); // 32k at k = 2: the two discs do not touch
    expect(inRect(p, 500, 0, 800, 400)).toBe(true);
    near(centreOf(html, 1), [650, 200]); // the light itself never moves
  });

  it("area_id and area attributes match too, case-insensitively", () => {
    near(centreOf(draw([P("a", { room: "sensor.r" })], { "person.a": st("home"), "sensor.r": st("on", { attributes: { area_id: "kitchen" } }) })), [650, 200]);
    near(centreOf(draw([P("a", { room: "sensor.r" })], { "person.a": st("home"), "sensor.r": st("on", { attributes: { area: "KITCHEN" } }) })), [650, 200]);
  });

  it("a room's area is matched before any room's name", () => {
    const f = structuredClone(empty);
    f.rooms[0].area = "kitchen"; // Living now carries the HA area "kitchen"; the room named Kitchen another one
    f.rooms[1].area = "cucina";
    near(centreOf(draw([P("a", { room: "sensor.r" })], { "person.a": st("home"), "sensor.r": st("kitchen") }, f)), [250, 200]);
  });

  it("two people in one room have different spots, both inside the room, their discs apart", () => {
    const html = draw([P("a", { room: "sensor.ra" }), P("b", { room: "sensor.rb" })], { "person.a": st("home"), "person.b": st("home"), "sensor.ra": st("Kitchen"), "sensor.rb": st("Kitchen") });
    const a = centreOf(html, n0), b = centreOf(html, n0 + 1);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(64); // two 16k discs at scale 0.5, k = 2
    for (const p of [a, b]) expect(inRect(p, 500, 0, 800, 400)).toBe(true);
  });

  it("break it: five people in one room all get their own spot", () => {
    const people = [0, 1, 2, 3, 4].map((i) => P(`p${i}`, { room: `sensor.r${i}` }));
    const state: StateOverlay = {};
    for (let i = 0; i < 5; i++) { state[`person.p${i}`] = st("home"); state[`sensor.r${i}`] = st("Kitchen"); }
    const html = draw(people, state);
    const cs = people.map((_, i) => centreOf(html, n0 + i));
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) expect(Math.hypot(cs[i][0] - cs[j][0], cs[i][1] - cs[j][1])).toBeGreaterThanOrEqual(64);
  });

  it("an unmatched room, not_home, unknown, unavailable or a missing sensor keeps the placed spot", () => {
    for (const s of ["Garage", "not_home", "unknown", "unavailable", ""])
      near(centreOf(draw([P("a", { room: "sensor.r" })], { "person.a": st("home"), "sensor.r": st(s) })), [200, 520]);
    near(centreOf(draw([P("a", { room: "sensor.r" })], { "person.a": st("home") })), [200, 520]);
  });

  it("a person who moved is placed at the room, so the room's name moves off the icon", () => {
    const f = structuredClone(ground);
    f.doors = []; f.stairs = []; f.walls = []; f.furniture = []; f.devices = [];
    f.rooms = [{ id: "d", name: "Den", kind: "room", area: "", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] }] as never;
    const nameAt = (html: string) => html.match(/<text class="lbl" x="([\d.-]+)" y="([\d.-]+)"[^>]*>Den</)!.slice(1).join(",");
    const person = [{ id: "a", type: "person", entity: "person.a", x: 50, y: 50, room: "sensor.r" }];
    expect(nameAt(draw(person, { "person.a": st("home") }, f))).toBe("200,200");
    expect(nameAt(draw(person, { "person.a": st("home"), "sensor.r": st("Den") }, f))).not.toBe("200,200");
  });

  it("the icon's position is a CSS transform, so the class rule's transition can animate a move", () => {
    const g = openTag(draw([P("a")], { "person.a": st("home") }));
    expect(g).toMatch(/style="[^"]*transform:translate\(-?[\d.]+px,-?[\d.]+px\) scale\([\d.]+\)/);
    expect(g).not.toMatch(/ transform="/);
    expect(FLOORPLAN_CSS).toContain(".dev-person{transition:transform .6s ease}");
    expect(FLOORPLAN_CSS).toContain(".dev-person.away{opacity:.35}");
  });

  it("break it: a person's names are escaped like any other device", () => {
    const html = draw([P("a", { name: '"><script>' })], { "person.a": st("home") });
    expect(html).not.toContain("<script>");
  });
});

describe("S7.9: mmWave radar targets", () => {
  // The demo ground floor without its devices, same approach as S7.8's people tests: predictable positions, no other icon in the way.
  const empty = { ...structuredClone(ground), devices: [] as typeof ground.devices };
  const R = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "radar", entity: `binary_sensor.${id}`, x: 200, y: 300, ...extra });
  const draw = (radars: unknown[], state: StateOverlay, f0 = empty) => renderFloor({ ...structuredClone(f0), devices: [...f0.devices, ...radars] } as never, { ...base, state });
  const targets = (html: string) => [...html.matchAll(/<circle class="target" cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);

  it("a target at x=0, y=2000mm with rot 90 draws 200cm screen-right of the icon (the brief's own example)", () => {
    const html = draw([R("r", { rot: 90, targets: [{ x: "sensor.tx", y: "sensor.ty" }] })], { "sensor.tx": st("0"), "sensor.ty": st("2000") });
    const [[cx, cy]] = targets(html);
    expect(cx).toBeCloseTo(200 + 200, 1); // 200cm to the right of the icon's own x=200
    expect(cy).toBeCloseTo(300, 1); // same height: rot 90 turns "ahead" from up to right
  });

  it("rot 0: forward (y) is screen-up, right (x) is screen-right, asymmetric values so an axis swap would fail", () => {
    const html = draw([R("r", { targets: [{ x: "sensor.tx", y: "sensor.ty" }] })], { "sensor.tx": st("500"), "sensor.ty": st("1500") }); // x=50cm right, y=150cm ahead
    const [[cx, cy]] = targets(html);
    expect(cx).toBeCloseTo(200 + 50, 1);
    expect(cy).toBeCloseTo(300 - 150, 1); // "ahead" moves up (smaller y)
  });

  it("a non-numeric or unavailable reading draws nothing for that pair; a missing sensor too", () => {
    for (const bad of [st("unavailable"), st("unknown"), st("not-a-number")]) {
      const html = draw([R("r", { targets: [{ x: "sensor.tx", y: "sensor.ty" }] })], { "sensor.tx": st("100"), "sensor.ty": bad });
      expect(targets(html), bad.state).toHaveLength(0);
    }
    const html = draw([R("r", { targets: [{ x: "sensor.tx", y: "sensor.ty" }] })], { "sensor.tx": st("100") }); // sensor.ty missing entirely
    expect(targets(html)).toHaveLength(0);
  });

  it("three targets draw three dots", () => {
    const html = draw([R("r", { targets: [{ x: "sensor.t0x", y: "sensor.t0y" }, { x: "sensor.t1x", y: "sensor.t1y" }, { x: "sensor.t2x", y: "sensor.t2y" }] })], {
      "sensor.t0x": st("0"), "sensor.t0y": st("0"), "sensor.t1x": st("100"), "sensor.t1y": st("0"), "sensor.t2x": st("-100"), "sensor.t2y": st("0"),
    });
    expect(targets(html)).toHaveLength(3);
  });

  it("break it: twenty pairs draw twenty dots, nothing caps the count", () => {
    const pairs = Array.from({ length: 20 }, (_, i) => ({ x: `sensor.t${i}x`, y: `sensor.t${i}y` }));
    const state: StateOverlay = {};
    for (let i = 0; i < 20; i++) { state[`sensor.t${i}x`] = st(String(i * 10)); state[`sensor.t${i}y`] = st(String(i * 5)); }
    expect(targets(draw([R("r", { targets: pairs })], state))).toHaveLength(20);
  });

  it("a target outside the floor's own outline is skipped, not clamped to the edge", () => {
    // The ground floor's outline is [[0,0],[800,0],[800,600],[0,600]]; forward (rot 0, y) from an icon at y=100 by 5m (500cm) lands at y=-400, outside.
    const html = draw([R("r", { x: 100, y: 100, targets: [{ x: "sensor.tx", y: "sensor.ty" }] })], { "sensor.tx": st("0"), "sensor.ty": st("5000") });
    expect(targets(html)).toHaveLength(0);
  });

  it("the outline check discriminates, not just always hides: the same sensor a little closer lands in bounds and is drawn", () => {
    const html = draw([R("r", { x: 100, y: 100, targets: [{ x: "sensor.tx", y: "sensor.ty" }] })], { "sensor.tx": st("0"), "sensor.ty": st("5000") });
    expect(targets(html)).toHaveLength(0); // 500cm ahead of y=100: outside
    const inBounds = draw([R("r", { x: 100, y: 100, targets: [{ x: "sensor.tx", y: "sensor.ty" }] })], { "sensor.tx": st("0"), "sensor.ty": st("-500") }); // 50cm behind: y=150, inside
    expect(targets(inBounds)).toHaveLength(1);
  });

  it("a target's own colour comes from --fp-dev-radar, and it takes no clicks", () => {
    expect(FLOORPLAN_CSS).toContain(".target{fill:var(--fp-dev-radar);stroke:var(--fp-outline);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}");
  });

  it("a radar with a presence entity wears the on class and --fp-dev-radar like any other device", () => {
    expect(FLOORPLAN_CSS).toContain(".dev-radar.on{--fp-dev:var(--fp-dev-radar)}");
    const html = draw([R("r")], { "binary_sensor.r": st("on") });
    const cls = html.match(/<g data-x="0" class="([^"]*)"/)![1].split(" ");
    expect(cls).toEqual(expect.arrayContaining(["dev-radar", "on"]));
  });
});
