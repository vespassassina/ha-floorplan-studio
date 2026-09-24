import { describe, expect, it } from "vitest";
import { rolesToTokens, type ThemeRoles } from "../../src/core/theme-roles";

const tokenPairs = (css: string) => new Map((css.match(/--fp-[a-z-]+:[^;]+/g) ?? []).map((kv) => { const i = kv.indexOf(":"); return [kv.slice(0, i), kv.slice(i + 1)]; }));

const BASE: ThemeRoles = { base: "#1c3f73", fg: "#eef3fb", fgAlpha: 0.75, line: "#35d47a", accent: "#ff8a1f", dark: true };

describe("theme-roles (S4.21)", () => {
  it("defines every token render.ts's other themes define", () => {
    // Every LIGHT_TOKENS/MIDNIGHT_TOKENS key must exist here too, or a generated theme silently falls back to nothing
    // for that property (CLAUDE.md finding: a rule checker cannot see a missing token, only a computed-style read can).
    const wanted = [
      "--fp-ink", "--fp-bg", "--fp-room", "--fp-room-empty", "--fp-garden", "--fp-terrace", "--fp-pavement", "--fp-wall",
      "--fp-idle", "--fp-on", "--fp-open", "--fp-motion", "--fp-heater", "--fp-door", "--fp-glass", "--fp-window",
      "--fp-sealed", "--fp-water", "--fp-fill", "--fp-fill-line", "--fp-tread", "--fp-halo", "--fp-alpha", "--fp-disc",
      "--fp-disc-alpha", "--fp-outline", "--fp-text", "--fp-warn", "--fp-danger", "--fp-primary", "--fp-wall-external",
      "--fp-wall-fence", "--fp-wall-edge", "--fp-measure", "--fp-glow", "--fp-aura", "--fp-active", "--fp-on-dark", "--fp-on-light",
      "--fp-furniture", "--fp-night",
      // the device types render.ts's CSS actually reads a dedicated colour for; the rest (switch, temp, humidity,
      // battery, inverter, server, access_point, other) fall back to --fp-idle in the stylesheet, no token of their own.
      "--fp-dev-light", "--fp-dev-motion", "--fp-dev-contact", "--fp-dev-heater", "--fp-dev-climate", "--fp-dev-ac-cool",
      "--fp-dev-ac-heat", "--fp-dev-tv", "--fp-dev-media", "--fp-dev-cover", "--fp-dev-plug", "--fp-dev-computer",
      "--fp-dev-camera", "--fp-dev-garden",
    ];
    const got = tokenPairs(rolesToTokens(BASE));
    for (const k of wanted) expect(got.has(k), k).toBe(true);
  });

  it("room-empty is the one fixed grey, in every theme, never the base shade (standing decision, 2026-06)", () => {
    expect(tokenPairs(rolesToTokens(BASE)).get("--fp-room-empty")).toBe("#d6d6d2");
    expect(tokenPairs(rolesToTokens({ ...BASE, dark: false })).get("--fp-room-empty")).toBe("#d6d6d2");
  });

  it("warn, danger, primary, on-dark and on-light are the same fixed pair regardless of the roles given: UI chrome, not device state", () => {
    const a = tokenPairs(rolesToTokens(BASE));
    const b = tokenPairs(rolesToTokens({ base: "#888888", fg: "#111111", fgAlpha: 0.5, line: "#00ff00", accent: "#ff00ff", dark: false }));
    for (const k of ["--fp-warn", "--fp-danger", "--fp-primary", "--fp-on-dark", "--fp-on-light"]) expect(a.get(k)).toBe(b.get(k));
  });

  it("device colours default to the single accent, unless a theme overrides that type", () => {
    const t = tokenPairs(rolesToTokens(BASE));
    expect(t.get("--fp-on")).toBe(BASE.accent);
    expect(t.get("--fp-dev-light")).toBe(BASE.accent);
    expect(t.get("--fp-dev-motion")).toBe(BASE.accent);
    const overridden = tokenPairs(rolesToTokens({ ...BASE, devices: { light: "#123456" } }));
    expect(overridden.get("--fp-dev-light")).toBe("#123456"); // the override
    expect(overridden.get("--fp-dev-motion")).toBe(BASE.accent); // every other type still collapses
  });

  it("camera and outdoor/garden device tints are a neutral shade, not the accent: they are static icon tints, never gated by .on", () => {
    const t = tokenPairs(rolesToTokens(BASE));
    expect(t.get("--fp-dev-camera")).not.toBe(BASE.accent);
    expect(t.get("--fp-dev-garden")).not.toBe(BASE.accent);
  });

  it("dark true puts the darkest shade at the background; dark false puts the lightest there", () => {
    const dark = tokenPairs(rolesToTokens(BASE));
    const light = tokenPairs(rolesToTokens({ ...BASE, dark: false }));
    // a crude luminance proxy: the hex's digits sum higher for a lighter colour
    const lum = (hex: string) => parseInt(hex.replace("#", ""), 16);
    expect(lum(dark.get("--fp-bg")!)).toBeLessThan(lum(dark.get("--fp-wall-external")!));
    expect(lum(light.get("--fp-bg")!)).toBeGreaterThan(lum(light.get("--fp-wall-external")!));
  });

  it("the measurement grid (line role) is independent of the foreground text colour", () => {
    const t = tokenPairs(rolesToTokens({ ...BASE, fg: "#ffffff", line: "#123456" }));
    expect(t.get("--fp-measure")).toBe("#123456");
    expect(t.get("--fp-ink")).toBe("#ffffff");
    expect(t.get("--fp-measure")).not.toBe(t.get("--fp-ink"));
  });
});
