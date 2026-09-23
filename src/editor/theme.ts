/**
 * S4.8: the Home Assistant theme variables `panel.ts`'s own outer chrome (its background, text and one accent — not the
 * plan or the editor's own chrome, which already have their own theme system, `--fp-*`, with an opt-in "ha" theme; see
 * `docs/DECISIONS.md`, 2026-09-21) follows when it runs inside Home Assistant. Each has a fallback so the panel still
 * looks reasonable before `hass` sets anything, or standalone. Kept in one place so the stylesheet can't drift from it.
 */
export const PANEL_VARS = {
  background: { ha: "--primary-background-color", fallback: "#0d1522" },
  text: { ha: "--primary-text-color", fallback: "#e6e6e6" },
  accent: { ha: "--primary-color", fallback: "#1f6699" },
  accentText: { ha: "--text-primary-color", fallback: "#fff" },
} as const;

export function panelVar(key: keyof typeof PANEL_VARS): string {
  const v = PANEL_VARS[key];
  return `var(${v.ha}, ${v.fallback})`;
}
