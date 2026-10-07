import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { FURNITURE_SYMBOLS, FURNITURE, type Layout } from "../../src/core";
import { renderFloor } from "../../src/core/render";

// S18.8, S18.9, S18.13 (Diego, 2026-10-07): furniture is filled in theme colours, a playing tv or speaker shows the
// same two waves a speaker device draws, and the computer is a desk with monitor, keyboard and case.

const ground = (demo as unknown as Layout).floors.ground;
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-09-19T10:00:00Z" });
const piece = (symbol: string, entity?: string) => ({ id: `f-${symbol}`, symbol, x: 300, y: 300, rot: 0, w: 120, h: 40, ...(entity ? { entity } : {}) });
const draw = (symbol: string, state?: string, view?: "2.5d") =>
  renderFloor({ ...ground, furniture: [piece(symbol, state ? "media_player.x" : undefined)] } as any, { scale: 0.5, ...(view ? { view } : {}), ...(state ? { state: { "media_player.x": st(state) } } : {}) });
const waves = (html: string) => (html.match(/class="wave( w2)?"/g) ?? []).length;

describe("S18.8 furniture is filled", () => {
  // Finding 17: a new symbol fails here until someone gives it a fill (class "ff") or lists it as outline-only on purpose.
  const OUTLINE_ONLY: string[] = [];
  it.each(FURNITURE_SYMBOLS)("%s has a filled shape", (s) => {
    if (OUTLINE_ONLY.includes(s)) return;
    expect(FURNITURE[s].svg, s).toContain('class="ff"');
  });
  it("no symbol paints a fixed colour; colour is only currentColor and the stylesheet", () => {
    for (const s of FURNITURE_SYMBOLS) expect(FURNITURE[s].svg, s).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });
});

describe("S18.9 waves on a playing tv or speaker", () => {
  it.each(["tv", "speaker"])("a playing %s draws two waves, in 2D and 2.5D", (s) => {
    expect(waves(draw(s, "playing")), "2D").toBe(2);
    expect(waves(draw(s, "playing", "2.5d")), "2.5D").toBe(2);
  });
  it("a tv that is on but not playing is lit and silent", () => {
    const html = draw("tv", "on");
    expect(html).toMatch(/class="furn on"/);
    expect(waves(html)).toBe(0);
  });
  it("a playing sofa, or a tv with nothing playing, has no waves", () => {
    expect(waves(draw("sofa", "playing"))).toBe(0);
    expect(waves(draw("tv", "off"))).toBe(0);
    expect(waves(draw("tv"))).toBe(0);
  });
});

describe("S18.13 the computer is a computer", () => {
  it("has a desk, monitor, keyboard and case, each named", () => {
    const svg = FURNITURE.computer.svg;
    for (const part of ["desk", "monitor", "keyboard", "case"]) expect(svg, part).toContain(`data-part="${part}"`);
  });
});
