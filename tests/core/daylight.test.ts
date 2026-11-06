import { describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core/render";
import { outdoorShade } from "../../src/core/daylight";

describe("outdoor shade by day: weather and hour", () => {
  it("clear sky at midday is no shade", () => expect(outdoorShade("sunny", 13)).toBe(0));
  it("worse weather shades more, in a fixed order", () => {
    const o = ["sunny", "partlycloudy", "cloudy", "rainy", "pouring"].map((c) => outdoorShade(c, 13));
    expect(o).toEqual([...o].sort((a, b) => a - b));
    expect(new Set(o).size).toBe(o.length);
  });
  it("early morning and evening shade more than midday, same weather", () => {
    expect(outdoorShade("sunny", 7)).toBeGreaterThan(outdoorShade("sunny", 13));
    expect(outdoorShade("sunny", 19)).toBeGreaterThan(outdoorShade("sunny", 16));
    expect(outdoorShade("sunny", 19)).toBeCloseTo(outdoorShade("sunny", 7), 5);
  });
  it("every weather state HA knows is a decision; junk and missing are clear", () => {
    for (const c of ["clear-night", "cloudy", "exceptional", "fog", "hail", "lightning", "lightning-rainy", "partlycloudy", "pouring", "rainy", "snowy", "snowy-rainy", "sunny", "windy", "windy-variant"]) {
      const v = outdoorShade(c, 13);
      expect(Number.isFinite(v) && v >= 0 && v <= 0.35, c).toBe(true);
    }
    for (const j of [undefined, null, "", "weird", 5, {}, "__proto__", "constructor"]) expect(outdoorShade(j as never, 13), String(j)).toBe(0);
    for (const h of [NaN, Infinity, -5, 99]) expect(Number.isFinite(outdoorShade("rainy", h)) && outdoorShade("rainy", h) <= 0.35).toBe(true);
  });
});

describe("renderFloor: daylight shade", () => {
  const floor = (demo as unknown as Layout).floors.ground;
  const days = (html: string) => [...html.matchAll(/<polygon data-day="(\d+)" class="room-day" style="opacity:([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  it("draws a shade on each outdoor room only, and none at night or at 0", () => {
    const o = { scale: 0.5, now: 1, fade: 10 } as never;
    const html = renderFloor(floor, { ...(o as object), daylight: 0.2 } as never);
    const rows = days(html);
    expect(rows.length).toBeGreaterThan(0);
    for (const [i, a] of rows) { expect(["garden", "terrace", "pavement", "water"]).toContain(floor.rooms[i].kind); expect(a).toBe(0.2); }
    expect(days(renderFloor(floor, { ...(o as object), daylight: 0 } as never))).toEqual([]);
    expect(days(renderFloor(floor, { ...(o as object), daylight: 0.2, night: true } as never))).toEqual([]);
    expect(days(renderFloor(floor, { ...(o as object), daylight: NaN } as never))).toEqual([]);
    expect(days(renderFloor(floor, { ...(o as object), daylight: 5 } as never)).every(([, a]) => a <= 0.35)).toBe(true);
  });
  it("the shade is --fp-night and takes no click", () => {
    expect(FLOORPLAN_CSS).toContain(".room-day{fill:var(--fp-night);pointer-events:none}");
  });
});
