import { describe, expect, it } from "vitest";
import { PANEL_VARS, panelVar } from "../../src/editor/theme";

// S4.8: panel.ts's own outer chrome (background, text, accent) follows a few Home Assistant theme variables, each with a
// fallback so it still looks reasonable standalone or before HA sets anything. This file is the one place that mapping is
// written, so panel.ts's stylesheet can never drift from it silently.
describe("theme.ts (S4.8): the panel's own HA variable map", () => {
  it("every entry names a real-looking HA CSS variable and a valid hex fallback", () => {
    for (const [key, v] of Object.entries(PANEL_VARS)) {
      expect(v.ha, key).toMatch(/^--[a-z-]+$/);
      expect(v.fallback, key).toMatch(/^#[0-9a-f]{3,6}$/i);
    }
  });

  it("panelVar renders a var() with the HA name first and the fallback second", () => {
    expect(panelVar("background")).toBe("var(--primary-background-color, #0d1522)");
    expect(panelVar("text")).toBe("var(--primary-text-color, #e6e6e6)");
    expect(panelVar("accent")).toBe("var(--primary-color, #1f6699)");
    expect(panelVar("accentText")).toBe("var(--text-primary-color, #fff)");
  });

  it("no two roles follow the same HA variable", () => {
    const has = Object.values(PANEL_VARS).map((v) => v.ha);
    expect(new Set(has).size).toBe(has.length);
  });
});
