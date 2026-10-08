import { describe, expect, it } from "vitest";
import { contrast, heatColour, inkFor, mixSrgb, pickInk, themeExtras } from "../../src/core/ink";

// S23.4 (V10): an on device is a solid disc in its own colour with a glyph in an ink chosen for 4.5:1. These are the pure
// functions behind it; the per-theme, per-type read-back lives in tests/card/device-states-css.spec.ts (finding 10).

describe("contrast", () => {
  it("is the WCAG ratio: 21 for black on white, 1 for a colour on itself, order free", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#2c7fb8", "#2c7fb8")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2); // the textbook near-miss
  });
  it("reads rgb() as well as hex", () => {
    expect(contrast("rgb(0,0,0)", "#fff")).toBeCloseTo(21, 5);
  });
});

describe("pickInk", () => {
  it("prefers the theme's own on-light ink on a pale disc, and its on-dark ink on a dark one", () => {
    expect(pickInk("#e0a800", "#2b2a27", "#fff")).toBe("#2b2a27"); // light's amber: the dark ink reads
    expect(pickInk("#b02a2a", "#2b2a27", "#fff")).toBe("#fff"); // danger red: white reads
  });
  it("falls back to pure black or white when neither theme ink reaches 4.5:1", () => {
    // #2c7fb8 (TV blue) is 4.26:1 with white and 3.6:1 with #2b2a27: both theme inks fail.
    expect(contrast("#2c7fb8", "#fff")).toBeLessThan(4.5);
    expect(contrast("#2c7fb8", "#2b2a27")).toBeLessThan(4.5);
    const ink = pickInk("#2c7fb8", "#2b2a27", "#fff");
    expect(["#000", "#fff"]).toContain(ink);
    expect(contrast("#2c7fb8", ink)).toBeGreaterThanOrEqual(4.5);
  });
  it("reaches 4.5:1 on every grey from black to white (the worst case is the crossover near #777)", () => {
    for (let v = 0; v <= 255; v++) {
      const h = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      expect(contrast(h, pickInk(h, "#2b2a27", "#fff")), h).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("inkFor is pickInk with no theme inks: black or white, whichever is stronger", () => {
    expect(inkFor("rgb(255,230,0)")).toBe("#000");
    expect(inkFor("rgb(20,20,120)")).toBe("#fff");
    expect(inkFor("not a colour")).toBe("#fff"); // untrusted input never throws
  });
});

describe("mixSrgb", () => {
  it("mixes like CSS color-mix in srgb: the first colour's share first", () => {
    expect(mixSrgb("#ffffff", "#000000", 0.55)).toBe("#8c8c8c");
    expect(mixSrgb("#ff0000", "#0000ff", 1)).toBe("#ff0000");
    expect(mixSrgb("#ff0000", "#0000ff", 0)).toBe("#0000ff");
  });
});

describe("heatColour", () => {
  it("runs cool at 0, mid at .5, hot at 1, the same ramp the stylesheet mixes in oklch", () => {
    expect(heatColour(0)).toBe("#2f86c9");
    expect(heatColour(0.5)).toBe("#f0a020");
    expect(heatColour(1)).toBe("#d63a2a");
    const q = heatColour(0.25); // between cool and mid, not either
    expect([q]).not.toContain("#2f86c9");
    expect([q]).not.toContain("#f0a020");
  });
  it("clamps an out-of-range heat instead of extrapolating", () => {
    expect(heatColour(-1)).toBe("#2f86c9");
    expect(heatColour(7)).toBe("#d63a2a");
  });
  it("has a readable ink at every step", () => {
    for (let h = 0; h <= 1; h += 0.05) { const c = heatColour(h); expect(contrast(c, inkFor(c)), `${h}`).toBeGreaterThanOrEqual(4.5); }
  });
});

describe("themeExtras", () => {
  const tokens = "--fp-idle:#8b8578;--fp-danger:#b02a2a;--fp-dev-light:#e0a800;--fp-dev-tv:#2c7fb8;--fp-bg:var(--x,#f4f0e6);--fp-on-dark:#fff;--fp-on-light:#2b2a27";
  const pairs = (css: string) => new Map((css.match(/--fp-[a-z-]+:[^;]+/g) ?? []).map((kv) => { const i = kv.indexOf(":"); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  it("writes an ink for every device colour, idle and danger, each at 4.5:1 or better on its own disc", () => {
    const x = pairs(themeExtras(tokens, false));
    for (const k of ["--fp-idle", "--fp-danger", "--fp-dev-light", "--fp-dev-tv"]) {
      const ink = x.get(`${k}-ink`);
      expect(ink, k).toBeTruthy();
      expect(contrast(pairs(tokens).get(k)!, ink!), k).toBeGreaterThanOrEqual(4.5);
    }
    expect(x.get("--fp-dev-light-ink")).toBe("#2b2a27"); // the theme ink where it is enough
  });
  it("names the glow blend by theme kind: screen on dark, multiply on light", () => {
    expect(pairs(themeExtras(tokens, true)).get("--fp-glow-blend")).toBe("screen");
    expect(pairs(themeExtras(tokens, false)).get("--fp-glow-blend")).toBe("multiply");
  });
  it("an idle override replaces idle, and every token that was the old idle, and inks from the new one", () => {
    const t = "--fp-idle:#3e6db0;--fp-dev-camera:#3e6db0;--fp-dev-light:#ff8a1f;--fp-on-dark:#fff;--fp-on-light:#2b2a27";
    const x = pairs(themeExtras(t, true, "#898f99"));
    expect(x.get("--fp-idle")).toBe("#898f99");
    expect(x.get("--fp-dev-camera")).toBe("#898f99");
    expect(x.has("--fp-dev-light")).toBe(false); // untouched tokens are not repeated
    expect(contrast("#898f99", x.get("--fp-idle-ink")!)).toBeGreaterThanOrEqual(4.5);
  });
  it("skips a token that is not a plain hex (a var() from Home Assistant) instead of guessing", () => {
    const x = pairs(themeExtras("--fp-dev-light:var(--x);--fp-idle:#8b8578", false));
    expect(x.has("--fp-dev-light-ink")).toBe(false);
    expect(x.has("--fp-idle-ink")).toBe(true);
  });
});
