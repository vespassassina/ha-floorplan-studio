import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// S23.7 CSS pairs (finding 10): the plan symbols' colours, read back from Chromium in every theme and ha in dark mode.
// The markup copies what renderFloor writes (tests/core/plan-symbols.test.ts pins that side).

const CASES = [...THEMES.map((t) => ({ t, mode: "light" })), { t: "ha", mode: "dark" }] as const;
const body = `<path class="door-sym k-door" d="M0 0L0 10"/><path class="door-sym k-glass" d="M0 0L0 10"/>
<path class="door-sym k-window" d="M0 0L0 10"/><path class="door-sym k-slit" d="M0 0L0 10"/>
<path class="door-sym k-door open" d="M0 0L0 10"/><path class="door-sym k-window alarm" d="M0 0L0 10"/><path class="door-sym k-door cover-open" d="M0 0L0 10"/>
<line class="door door-door quiet" x1="0" y1="0" x2="10" y2="0"/><line class="door door-door open" x1="0" y1="0" x2="10" y2="0"/>
<line class="door door-window door-slit quiet" x1="0" y1="0" x2="10" y2="0"/><line class="door door-door sel" x1="0" y1="0" x2="10" y2="0"/>
<line class="e nw zn" x1="0" y1="0" x2="10" y2="0"/><line class="eh nw zn" x1="0" y1="0" x2="10" y2="0"/>
<line class="e nw" id="rb" x1="0" y1="0" x2="10" y2="0"/><line class="eh nw" id="rbh" x1="0" y1="0" x2="10" y2="0"/>
<rect class="p-door" style="fill:var(--fp-door)"/><rect class="p-window" style="fill:var(--fp-window)"/><rect class="p-glass" style="fill:var(--fp-glass)"/>
<rect class="p-red" style="fill:var(--fp-open-door)"/><rect class="p-wall" style="fill:var(--fp-wall)"/>`;
const html = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}">${body}</g>`).join("")}</svg></body></html>`;

test("S23.7 CSS pair: door, glass and window symbols take their tokens, glass is the window blue, red only with a state", async ({ page }) => {
  await page.setContent(html);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, cs = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    const sym = (sel: string) => { const c = cs(sel); return { stroke: c.stroke, w: c.strokeWidth, ve: c.vectorEffect, pe: c.pointerEvents, fill: c.fill }; };
    return {
      door: sym(".door-sym.k-door:not(.open):not(.cover-open)"), glass: sym(".k-glass"), window: sym(".k-window:not(.alarm)"), slit: sym(".k-slit"),
      open: sym(".k-door.open"), alarm: sym(".k-window.alarm"), cover: sym(".k-door.cover-open"),
      quiet: cs("line.door.quiet").stroke, quietSlit: cs("line.door-slit.quiet").stroke, openLine: cs("line.door.open").stroke, selLine: cs("line.door.sel").stroke,
      pDoor: cs(".p-door").fill, pWindow: cs(".p-window").fill, pGlass: cs(".p-glass").fill, pRed: cs(".p-red").fill,
    };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    expect(v.pGlass, `${tag}: --fp-glass is the window blue`).toBe(v.pWindow);
    expect(v.door.stroke, tag).toBe(v.pDoor);
    expect(v.glass.stroke, tag).toBe(v.pWindow);
    expect(v.window.stroke, tag).toBe(v.pWindow);
    expect(v.slit.stroke, tag).toBe(v.pWindow);
    for (const s of [v.door, v.glass, v.window, v.slit]) {
      expect(s.w, `${tag}: a hairline`).toBe("1px");
      expect(s.ve, tag).toBe("non-scaling-stroke");
      expect(s.pe, `${tag}: the symbol takes no clicks`).toBe("none");
      expect(s.fill, tag).toBe("none");
      expect(s.stroke, `${tag}: not red while closed`).not.toBe(v.pRed);
    }
    for (const s of [v.open, v.alarm, v.cover]) expect(s.stroke, `${tag}: red with a state`).toBe(v.pRed);
    expect(v.quiet, `${tag}: a closed door's line paints nothing`).toBe("rgba(0, 0, 0, 0)");
    expect(v.quietSlit, tag).toBe("rgba(0, 0, 0, 0)");
    expect(v.openLine, `${tag}: an open door's line is still red`).toBe(v.pRed);
    expect(v.selLine, `${tag}: a selected door's line shows`).not.toBe("rgba(0, 0, 0, 0)");
  });
});

test("S23.7 CSS pair: a zone is a 1 px dash at 35 % with no halo, in every theme", async ({ page }) => {
  await page.setContent(html);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, e = getComputedStyle(g.querySelector("line.e.nw.zn")!), h = getComputedStyle(g.querySelector("line.eh.nw.zn")!);
    return { w: e.strokeWidth, op: e.strokeOpacity, dash: e.strokeDasharray, ve: e.vectorEffect, halo: h.display, stroke: e.stroke, wall: getComputedStyle(g.querySelector(".p-wall")!).fill };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    expect(v.w, tag).toBe("1px");
    expect(v.ve, tag).toBe("non-scaling-stroke");
    expect(v.op, tag).toBe("0.35");
    expect(v.dash, tag).not.toBe("none");
    expect(v.halo, `${tag}: no white halo under a zone`).toBe("none");
    expect(v.stroke, tag).toBe(v.wall);
  });
});

// Opus review of Sprint 23, S4: the faint zone dash is a zone's alone. A boundary between two real rooms (an open plan)
// keeps what it drew before S23.7: a 1.5 cm dash 8 6 at full strength, scaling with the plan, over a 3.5 cm halo.
test("S4 CSS pair: a boundary between rooms keeps its 1.5 cm dash and its halo, in every theme", async ({ page }) => {
  await page.setContent(html);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, e = getComputedStyle(g.querySelector("#rb")!), h = getComputedStyle(g.querySelector("#rbh")!);
    return { w: e.strokeWidth, op: e.strokeOpacity, dash: e.strokeDasharray, ve: e.vectorEffect, stroke: e.stroke, halo: h.display, hw: h.strokeWidth, hdash: h.strokeDasharray, wall: getComputedStyle(g.querySelector(".p-wall")!).fill };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    expect(v.w, tag).toBe("1.5px");
    expect(v.ve, `${tag}: scales with the plan`).toBe("none");
    expect(v.op, tag).toBe("1");
    expect(v.dash, tag).toBe("8px, 6px");
    expect(v.stroke, tag).toBe(v.wall);
    expect(v.halo, `${tag}: the halo is drawn`).not.toBe("none");
    expect(v.hw, tag).toBe("3.5px");
    expect(v.hdash, tag).toBe("8px, 6px");
  });
});
