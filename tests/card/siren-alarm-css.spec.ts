import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";
import { DEVICE_ICONS } from "../../src/core/icons";

// S18.14, findings 10 and 16: a CSS rule read as a string is blind to specificity. Read the siren's and the alarm's on colour
// back from Chromium in every theme: it must be a real colour, differ from the same icon at rest, and be the danger colour.
const icon = (t: string, state: string) => `<g class="dev dev-${t} ${state}"><circle class="halo" r="12"/><path d="${DEVICE_ICONS[t as "siren"]}"/></g>`;
const plan = (body: string) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`;

// S23.4: on is a solid disc in the danger colour (the glyph on it is ink); off is the glyph alone, idle.
test("siren and alarm: the on disc is danger red, not the idle grey, in every theme", async ({ page }) => {
  await page.setContent(plan(`${icon("siren", "off")}${icon("siren", "on")}${icon("alarm", "off")}${icon("alarm", "on")}<g class="probe" style="fill:var(--fp-danger)"><path d="M0 0"/></g>`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const fill = (i: number, sel: string) => getComputedStyle(g.children[i].querySelector(sel)!).fill;
      return { sOff: fill(0, "path"), sOn: fill(1, ".halo"), aOff: fill(2, "path"), aOn: fill(3, ".halo"), danger: fill(4, "path") };
    });
    for (const v of Object.values(r)) expect(v, t).toMatch(/^(rgb|color)\(/);
    expect(r.sOn, `${t}: siren on is not idle`).not.toBe(r.sOff);
    expect(r.aOn, `${t}: alarm on is not idle`).not.toBe(r.aOff);
    expect(r.sOn, `${t}: siren on is danger`).toBe(r.danger);
    expect(r.aOn, `${t}: alarm on is danger`).toBe(r.danger);
  }
});
