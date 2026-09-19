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
    expect(renderFloor(ground, base).match(/<text class="lbl"/g)).toHaveLength(3);
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
    const html = renderFloor(ground, { ...base, state: { "light.demo_living": st("on") } });
    expect(html).toMatch(/<g[^>]*data-x="0"[^>]*class="dev dev-light on"/);
    expect(html).toMatch(/<g[^>]*data-x="1"[^>]*class="dev dev-light off"/);
  });

  it("marks unavailable and unknown entities", () => {
    const html = renderFloor(ground, { ...base, state: { "light.demo_living": st("unavailable"), "light.demo_kitchen": st("unknown") } });
    expect(html).toMatch(/data-x="0"[^>]*class="dev dev-light unavailable"/);
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
    expect(html).toMatch(/data-x="0"[^>]*class="dev dev-light off"/);
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

describe("viewBoxFor", () => {
  it("wraps the outline with padding", () => {
    expect(viewBoxFor(ground, 60)).toEqual({ x: -60, y: -60, w: 920, h: 720 });
  });
  it("defaults to 60 cm of padding", () => {
    expect(viewBoxFor(ground).x).toBe(-60);
  });
});
