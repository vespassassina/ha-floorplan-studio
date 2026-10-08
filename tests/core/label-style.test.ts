import { describe, it, expect } from "vitest";
import type { Floor, RoomKind } from "../../src/core/schema";
import { ROOM_KINDS } from "../../src/core/schema";
import { renderFloor, FLOORPLAN_CSS } from "../../src/core/render";
import { meanReading } from "../../src/core/readings";
import { liveOf } from "../../src/core/live";

// S23.1 (V2, V7, V8): one label style. The colour and the font are CSS and are read back from Chromium in
// tests/card/labels-css.spec.ts (finding 10); this file pins the markup that CSS hangs on.

const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const floor = (o: Partial<Floor>) => ({ title: "T", outline: sq(0, 0, 2000), rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o }) as unknown as Floor;
const room = (kind: RoomKind, name = "Room", pts = sq(0, 0, 1000)) => ({ id: `r-${kind}`, name, area: "", kind, pts, wk: pts.map(() => "wall" as const) });
const text = (html: string, name: string) => html.match(new RegExp(`<text [^>]*>${name}</text>`))?.[0] ?? "";
const attr = (tag: string, a: string) => tag.match(new RegExp(` ${a}="([^"]*)"`))?.[1];
const NNBSP = " ";
const st = (state: string, unit: string) => ({ state, attributes: { unit_of_measurement: unit }, last_changed: "2026-10-08T10:00:00Z" });

/** Where each kind's name stands. A new kind fails here until someone decides (finding 17). */
const SIZE: Record<RoomKind, number | null> = { room: 12, structure: 12, garden: 10, terrace: 10, pavement: 10, water: 10, zone: 10, fill: null };
const OUTDOOR: RoomKind[] = ["garden", "terrace", "pavement", "water"];

describe("S23.1: one label style", () => {
  it.each(ROOM_KINDS)("a %s name: no opacity, no weight attribute, its size decided", (kind) => {
    const html = renderFloor(floor({ rooms: [room(kind)] }), { scale: 1 });
    const t = text(html, "Room");
    if (SIZE[kind] === null) { expect(t).toBe(""); return; } // a fill draws no name
    expect(t).not.toBe("");
    expect(attr(t, "opacity"), kind).toBeUndefined();
    expect(attr(t, "font-weight"), kind).toBeUndefined();
    expect(Number(attr(t, "font-size")), kind).toBe(SIZE[kind]);
  });

  it("an outdoor name carries the outdoor class; a room and a zone do not", () => {
    for (const kind of ROOM_KINDS) {
      const t = text(renderFloor(floor({ rooms: [room(kind)] }), { scale: 1 }), "Room");
      if (!t) continue;
      expect(/class="[^"]*\bout\b/.test(t), kind).toBe(OUTDOOR.includes(kind));
    }
  });

  it("a name says which surface it sits on, so the label colour can mix into it", () => {
    const html = renderFloor(floor({ rooms: [room("garden", "Lawn", sq(0, 0, 1000)), room("room", "Den", sq(1000, 0, 800)), { ...room("zone", "Nook", sq(1100, 100, 500)), id: "z" }] }), { scale: 1 });
    expect(attr(text(html, "Lawn"), "style")).toBe("--fp-under:var(--fp-garden)");
    expect(attr(text(html, "Den"), "style")).toBe("--fp-under:var(--fp-room-empty)");
    expect(attr(text(html, "Nook"), "style")).toBe("--fp-under:var(--fp-room-empty)"); // a zone has no fill: the room under it
  });

  it("a painted room's name mixes into the room's own paint; a junk colour never reaches the attribute", () => {
    const html = renderFloor(floor({ rooms: [{ ...room("room", "Den"), color: "#b98b5c" }] }), { scale: 1 });
    expect(attr(text(html, "Den"), "style")).toBe("--fp-under:#b98b5c");
    const bad = renderFloor(floor({ rooms: [{ ...room("room", "Den"), color: '"><script>' } as never] }), { scale: 1 });
    expect(bad).not.toContain("<script>");
    expect(attr(text(bad, "Den"), "style")).toBe("--fp-under:var(--fp-room-empty)");
  });

  it("the stylesheet: --fp-label and --fp-font exist, .lbl has no opacity rule, values are tabular", () => {
    expect(FLOORPLAN_CSS).toMatch(/--fp-font:/);
    expect(FLOORPLAN_CSS).toMatch(/--fp-label:/);
    expect(FLOORPLAN_CSS).not.toMatch(/\.lbl(?![\w-])[^{]*\{[^}]*opacity/); // .lbl-leader is a line, not a name
    expect(FLOORPLAN_CSS).toMatch(/\.val\{[^}]*font-variant-numeric:tabular-nums/);
  });
});

describe("S23.1: a value never wraps between number and unit", () => {
  it("a room readout, a sensor value and the live overlay put a narrow no-break space before the unit", () => {
    expect(meanReading(["sensor.t"], { "sensor.t": st("21.5", "°C") })).toBe(`21.5${NNBSP}°C`);
    const f = floor({ rooms: [{ ...room("room", "Den"), temps: ["sensor.t"] } as never], devices: [{ id: "h", type: "humidity", entity: "sensor.h", x: 300, y: 300 } as never] });
    const state = { "sensor.t": st("21.5", "°C"), "sensor.h": st("48", "%") };
    const html = renderFloor(f, { scale: 1, state });
    expect(html).toContain(`>21.5${NNBSP}°C<`);
    expect(html).toContain(`>48${NNBSP}%<`);
    expect(html).not.toMatch(/\d %</);
    const live = liveOf(f, { scale: 1, state }, Date.parse("2026-10-08T10:00:00Z"));
    expect(live.devices.find((d) => d)?.value).toBe(`48${NNBSP}%`);
  });
});
