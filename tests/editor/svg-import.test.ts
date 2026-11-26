// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { validate, type HaData } from "../../src/core";
import { importHaFloorplanSvg, MAX_SVG_BYTES } from "../../src/editor/svg-import";

const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 1000 600">
  <defs><linearGradient id="bg"/></defs>
  <rect id="canvas_bg" x="0" y="0" width="1000" height="600" fill="#fff"/>
  <g id="layer1" transform="translate(50, 25)">
    <rect id="living_room" x="0" y="0" width="400" height="300"/>
    <polygon inkscape:label="Kitchen" id="poly_2" points="400,0 800,0 800,300 400,300"/>
    <path id="rect42" d="M 0 300 h 400 v 200 h -400 Z"/>
    <circle id="light.living_ceiling" cx="200" cy="150" r="12"/>
    <g id="binary_sensor.kitchen_motion" transform="translate(550, 120)">
      <rect x="0" y="0" width="40" height="40"/>
      <circle cx="20" cy="20" r="8"/>
    </g>
    <rect id="sensor.living_temperature" x="100" y="50" width="20" height="20"/>
    <rect id="switch.coffee_plug" x="500" y="200" width="20" height="20"/>
  </g>
</svg>`;

describe("S79: importHaFloorplanSvg", () => {
  it("extracts rooms (rect, polygon, path) and HA entity devices with Inkscape transforms", () => {
    const res = importHaFloorplanSvg(SAMPLE_SVG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.rooms).toBe(3);
    expect(res.devices).toBe(4);
    expect(validate(res.layout).ok).toBe(true);

    const g = res.layout.floors.ground!;
    expect(g.rooms.map((r) => r.name)).toEqual(["Living room", "Kitchen", "Room 3"]);
    // Canvas background rect (100% of viewBox) was filtered out.
    expect(g.rooms.every((r) => r.name !== "Canvas bg")).toBe(true);

    const byEnt = new Map(g.devices.map((d) => [d.entity, d]));
    expect(byEnt.get("light.living_ceiling")).toMatchObject({ type: "light", x: 300, y: 210 }); // (200+50)*1.2=300, (150+25)*1.2=210
    expect(byEnt.get("binary_sensor.kitchen_motion")).toMatchObject({ type: "motion", x: 744, y: 198 }); // (550+20+50)*1.2=744, (120+20+25)*1.2=198
    expect(byEnt.get("sensor.living_temperature")?.type).toBe("temp");
    expect(byEnt.get("switch.coffee_plug")?.type).toBe("plug");
  });

  it("uses live HaData device_class when connected to Home Assistant", () => {
    const ha: HaData = {
      floors: [],
      areas: [],
      entities: [{ id: "sensor.mystery_box", name: "Mystery", domain: "sensor", dc: "humidity" }],
    };
    const svg = `<svg viewBox="0 0 600 400"><rect id="sensor.mystery_box" x="100" y="100" width="20" height="20"/></svg>`;
    const res = importHaFloorplanSvg(svg, ha);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.floors.ground!.devices[0]?.type).toBe("humidity");
    expect(validate(res.layout).ok).toBe(true);
  });

  it("rejects empty, malformed, oversized, and non-SVG inputs safely", () => {
    expect(importHaFloorplanSvg("").ok).toBe(false);
    expect(importHaFloorplanSvg("<html></html>").ok).toBe(false);
    expect(importHaFloorplanSvg("<svg><unclosed>").ok).toBe(false);
    expect(importHaFloorplanSvg("<svg viewBox='0 0 100 100'></svg>").ok).toBe(false);
    const huge = `<svg>${" ".repeat(MAX_SVG_BYTES + 10)}</svg>`;
    const hugeRes = importHaFloorplanSvg(huge);
    expect(hugeRes.ok).toBe(false);
    if (!hugeRes.ok) expect(hugeRes.error).toContain("limit");
  });
});
