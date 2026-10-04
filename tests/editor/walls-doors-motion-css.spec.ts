import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// Computed-style pairs (CLAUDE.md findings 10, 17, 18) for the wall faces, the open doors and the motion border.
// A string match on the CSS cannot see specificity; each rule is read back from Chromium in every theme.

const plan = (body: string) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`;
const P = `points="0,0 1,0 1,1"`;
const RGB = /^(rgb|color)\(/;
/** The red channel dominates: Diego's "red when open", checked on the pixel colour, not on the variable name. */
const reddish = (c: string) => {
  const n = (c.match(/[\d.]+/g) ?? []).map(Number);
  if (c.startsWith("color(")) return n[0] > n[1] * 1.4 && n[0] > n[2] * 1.4;
  return n[0] > n[1] * 1.4 && n[0] > n[2] * 1.4;
};

test("wall faces: lit, dim and plain are three distinct fills in every theme, the foot and the edge resolve and take no clicks", async ({ page }) => {
  await page.setContent(plan(`<polygon class="ws" ${P}/><polygon class="ws lit" ${P}/><polygon class="ws dim" ${P}/><polygon class="wfoot" ${P}/><line class="wl" x1="0" y1="0" x2="1" y2="1"/>`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
      const [plain, lit, dim, foot, wl] = [...g.children];
      return { plain: c(plain, "fill"), lit: c(lit, "fill"), dim: c(dim, "fill"), foot: c(foot, "fill"), footOp: c(foot, "fill-opacity"), footPe: c(foot, "pointer-events"), wl: c(wl, "stroke"), wlOp: c(wl, "stroke-opacity"), wlPe: c(wl, "pointer-events") };
    });
    for (const v of [r.plain, r.lit, r.dim, r.foot, r.wl]) expect(v, t).toMatch(RGB);
    expect(new Set([r.plain, r.lit, r.dim]).size, `${t}: three tones`).toBe(3);
    expect(Number(r.footOp), t).toBeGreaterThan(0);
    expect(Number(r.footOp), t).toBeLessThan(0.5);
    expect(Number(r.wlOp), t).toBeGreaterThan(0);
    expect([r.footPe, r.wlPe], t).toEqual(["none", "none"]);
  }
});

test("doors: the closed leaf is painted, every open piece is red, and none takes a click", async ({ page }) => {
  await page.setContent(plan(`<polygon class="door-leaf" ${P}/><polygon class="opn open" ${P}/><polygon class="opn alarm" ${P}/><polygon class="opn cover-open" ${P}/>
<polygon class="glass g-window open" ${P}/><polygon class="glass g-glass alarm" ${P}/><polygon class="ws sealed open" ${P}/><polygon class="glass g-window" ${P}/><polygon class="ws sealed" ${P}/><polygon class="glass g-window cover-open" ${P}/>`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
      const k = [...g.children];
      return {
        leaf: c(k[0], "fill"), leafPe: c(k[0], "pointer-events"), redToken: c(g, "--fp-open-door"),
        opnOpen: c(k[1], "stroke"), opnAlarm: c(k[2], "stroke"), opnCover: c(k[3], "stroke"), orange: c(g, "--fp-open"),
        winOpen: c(k[4], "fill"), glassAlarm: c(k[5], "fill"), sealedOpen: c(k[6], "fill"), winShut: c(k[7], "fill"), sealedShut: c(k[8], "fill"), winCover: c(k[9], "fill"),
        pe: k.map((e) => c(e, "pointer-events")),
      };
    });
    expect(r.leaf, t).toMatch(RGB);
    expect(r.redToken, `${t}: --fp-open-door resolves`).not.toBe("");
    for (const [name, v] of [["opn open", r.opnOpen], ["opn alarm", r.opnAlarm], ["glass open", r.winOpen], ["glass alarm", r.glassAlarm], ["sealed open", r.sealedOpen]] as const) {
      expect(reddish(v), `${t}: ${name} is red, got ${v}`).toBe(true);
    }
    expect(r.winOpen, `${t}: an open window is not its shut colour`).not.toBe(r.winShut);
    expect(r.sealedOpen, `${t}: an open sealed panel is not its shut colour`).not.toBe(r.sealedShut);
    expect(r.opnCover, `${t}: a cover left open is red like an open door`).toBe(r.opnOpen);
    expect(r.winCover, `${t}: ditto on glass`).toBe(r.winOpen);
    expect(r.pe.every((p) => p === "none"), `${t}: ${r.pe}`).toBe(true);
  }
});

test("motion border: its opacity follows --fp-fade and the radar one has its own colour, in every theme", async ({ page }) => {
  await page.setContent(plan(`<rect class="motion-perimeter" width="1" height="1"/><rect class="motion-perimeter" style="--fp-fade:0.4" width="1" height="1"/><rect class="motion-perimeter radar" width="1" height="1"/>`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
      const [full, faded, radar] = [...g.children];
      return { full: c(full, "opacity"), faded: c(faded, "opacity"), stroke: c(full, "stroke"), radar: c(radar, "stroke"), motionTok: c(g, "--fp-dev-motion"), pe: c(full, "pointer-events") };
    });
    expect(r.motionTok, `${t}: --fp-dev-motion resolves`).not.toBe("");
    expect(r.stroke, t).toMatch(RGB);
    expect(Number(r.full), t).toBe(1);
    expect(Number(r.faded), t).toBeCloseTo(0.4, 5);
    expect(r.radar, t).toMatch(RGB);
    expect(r.pe, t).toBe("none");
  }
});

// S11.1 pair (finding 10): a room's own motion ring pulses while a sensor is on, and sits still, steady, under reduced motion.
// Break it: drop `.motion-perimeter.motion-pulse` from the CSS and animation-name reads "none" for the pulsing ring.
test("room motion ring: pulses while on, steady with the fade when off, no animation under reduced motion, in every theme", async ({ page }) => {
  await page.setContent(plan(`<rect class="motion-perimeter motion-pulse" width="1" height="1"/><rect class="motion-perimeter" style="--fp-fade:0.4" width="1" height="1"/>`));
  const read = (t: string) => page.locator(`#t-${t}`).evaluate((g) => {
    const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
    const [pulse, steady] = [...g.children];
    return { pulseAnim: c(pulse, "animation-name"), steadyAnim: c(steady, "animation-name"), steadyOp: c(steady, "opacity"), stroke: c(pulse, "stroke"), pe: c(pulse, "pointer-events"), dur: c(pulse, "animation-duration") };
  });
  for (const t of THEMES) {
    const r = await read(t);
    expect(r.pulseAnim, t).toBe("fp-motion-pulse");
    expect(r.dur, t).not.toBe("0s");
    expect(r.steadyAnim, t).toBe("none");
    expect(Number(r.steadyOp), t).toBeCloseTo(0.4, 5);
    expect(r.stroke, t).toMatch(RGB); // the theme's own motion colour (red in most, gold in a-team), never a literal
    expect(r.pe, t).toBe("none");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const t of THEMES) {
    const r = await read(t);
    expect(r.pulseAnim, `${t}: reduced motion`).toBe("none");
  }
});
