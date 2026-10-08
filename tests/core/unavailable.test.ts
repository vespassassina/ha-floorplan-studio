import { describe, expect, it } from "vitest";
import { classOf, renderFloor } from "../../src/core/render";
import { DEVICE_TYPES, type Device, type Floor } from "../../src/core/schema";

// S23.5 (V12): unavailable is its own mark. "Off" and "I don't know" are different facts, so a dead entity of any type, a
// light, switch or plug included, is drawn unavailable: a dashed warn ring, the glyph at idle, and a small slash badge.
// This supersedes "a dead light or switch reads as off" (Diego, 2026-10-06). The computed-style half is in
// tests/card/device-states-css.spec.ts.

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T10:00:00Z" });
const dev = (type: string, entity = `${type === "siren" ? "siren" : "x"}.a`, extra: object = {}): Device => ({ id: "a", type, entity, x: 100, y: 100, ...extra }) as Device;
const floor = (devices: Device[]) => ({ title: "G", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], rooms: [], devices }) as unknown as Floor;
const group = (html: string) => html.match(/<g data-x="0"[^>]*>[\s\S]*?<\/g>/)![0];
const off = (t: string) => st(t === "alarm" ? "disarmed" : "off");

describe("every device type: dead is unavailable, not off (finding 17)", () => {
  for (const t of DEVICE_TYPES) {
    it(`${t}: unavailable and unknown both draw the unavailable mark; off does not`, () => {
      for (const dead of ["unavailable", "unknown"]) {
        expect(classOf(dev(t), { scale: 1, state: { [dev(t).entity]: st(dead) } }), `${t} ${dead}`).toBe("unavailable");
        const g = group(renderFloor(floor([dev(t)]), { scale: 1, state: { [dev(t).entity]: st(dead) } }));
        expect(g, `${t} ${dead}`).toMatch(/class="dev dev-[a-z_]+[^"]* unavailable[ "]/);
        expect(g, `${t} ${dead} badge`).toContain('class="gone-mark"');
      }
      const g = group(renderFloor(floor([dev(t)]), { scale: 1, state: { [dev(t).entity]: off(t) } }));
      expect(g, `${t} off`).not.toContain("unavailable");
      expect(g, `${t} off`).not.toContain("gone-mark");
    });
  }
  it("no state at all is still off: the card has not heard of the entity, it has not been told it is dead", () => {
    expect(classOf(dev("light"), { scale: 1, state: {} })).toBe("off");
    expect(group(renderFloor(floor([dev("light")]), { scale: 1, state: {} }))).not.toContain("gone-mark");
  });
});

describe("a bound light is one lamp: unavailable only when every known state is dead", () => {
  const lamp = dev("light", "light.a", { bound: "switch.r" });
  const cls = (l: string | null, r: string | null) => classOf(lamp, { scale: 1, state: { ...(l ? { "light.a": st(l) } : {}), ...(r ? { "switch.r": st(r) } : {}) } });
  it("both dead: unavailable", () => expect(cls("unavailable", "unknown")).toBe("unavailable"));
  it("the light dead and the relay on: on (the relay lights it)", () => expect(cls("unavailable", "on")).toBe("on"));
  it("the light dead and the relay off: off (the relay says what we know)", () => expect(cls("unavailable", "off")).toBe("off"));
  it("the light on and the relay dead: on", () => expect(cls("on", "unavailable")).toBe("on"));
  it("only the light known, and dead: unavailable", () => expect(cls("unavailable", null)).toBe("unavailable"));
  it("nothing known: off", () => expect(cls(null, null)).toBe("off"));
});

describe("the badge", () => {
  it("is a circle and a line, not a path, so no glyph rule ever paints it, and it takes no click of its own", () => {
    const g = group(renderFloor(floor([dev("light")]), { scale: 1, state: { "x.a": st("unavailable") } }));
    const badge = g.match(/<g class="gone-mark">([\s\S]*?)<\/g>/)![1];
    expect(badge).toMatch(/^<circle [^>]*\/><line [^>]*\/>$/);
    expect(badge).not.toMatch(/fill=|stroke=|#[0-9a-f]{3,6}/i); // colours come from the stylesheet
  });
});
