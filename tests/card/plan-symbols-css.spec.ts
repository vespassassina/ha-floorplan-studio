import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// S23.7 CSS pairs (finding 10): the plan symbols' colours, read back from Chromium in every theme and ha in dark mode.
// The markup copies what renderFloor writes (tests/core/plan-symbols.test.ts pins that side).

const CASES = [...THEMES.map((t) => ({ t, mode: "light" })), { t: "ha", mode: "dark" }] as const;
const body = `<path class="door-sym k-window" d="M0 0L0 10"/><path class="door-sym k-slit" d="M0 0L0 10"/><path class="door-sym k-fullwindow" d="M0 0L0 10"/>
<path class="door-sym k-window open" d="M0 0L0 10"/><path class="door-sym k-window alarm" d="M0 0L0 10"/><path class="door-sym k-slit cover-open" d="M0 0L0 10"/>
<line class="door door-door quiet" x1="0" y1="0" x2="10" y2="0"/><line class="door door-door" id="shut" x1="0" y1="0" x2="10" y2="0"/><line class="door door-glass" id="shutg" x1="0" y1="0" x2="10" y2="0"/><line class="door door-glass quiet" id="holeg" x1="0" y1="0" x2="10" y2="0"/><line class="door door-door open" x1="0" y1="0" x2="10" y2="0"/>
<line class="door door-window door-slit quiet" x1="0" y1="0" x2="10" y2="0"/><line class="door door-door sel" x1="0" y1="0" x2="10" y2="0"/>
<line class="e nw zn" x1="0" y1="0" x2="10" y2="0"/><line class="eh nw zn" x1="0" y1="0" x2="10" y2="0"/>
<line class="e nw" id="rb" x1="0" y1="0" x2="10" y2="0"/><line class="eh nw" id="rbh" x1="0" y1="0" x2="10" y2="0"/>
<rect class="p-door" style="fill:var(--fp-door)"/><rect class="p-window" style="fill:var(--fp-window)"/><rect class="p-glass" style="fill:var(--fp-glass)"/>
<rect class="p-red" style="fill:var(--fp-open-door)"/><rect class="p-wall" style="fill:var(--fp-wall)"/>`;
const html = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}">${body}</g>`).join("")}</svg></body></html>`;

test("S23.7 + S25.D1 CSS pair: window symbols and the closed door and glass door lines take their tokens, glass is the window blue, red only with a state", async ({ page }) => {
  await page.setContent(html);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, cs = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    const sym = (sel: string) => { const c = cs(sel); return { stroke: c.stroke, w: c.strokeWidth, ve: c.vectorEffect, pe: c.pointerEvents, fill: c.fill }; };
    return {
      window: sym(".k-window:not(.alarm):not(.open)"), slit: sym(".k-slit:not(.cover-open)"), fullwindow: sym(".k-fullwindow"),
      open: sym(".k-window.open"), alarm: sym(".k-window.alarm"), cover: sym(".k-slit.cover-open"),
      shut: cs("#shut").stroke, shutG: cs("#shutg").stroke, shutW: cs("#shut").strokeDasharray, holeG: cs("#holeg").stroke,
      quiet: cs("line.door.quiet").stroke, quietSlit: cs("line.door-slit.quiet").stroke, openLine: cs("line.door.open").stroke, selLine: cs("line.door.sel").stroke,
      pDoor: cs(".p-door").fill, pWindow: cs(".p-window").fill, pGlass: cs(".p-glass").fill, pRed: cs(".p-red").fill,
    };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    expect(v.pGlass, `${tag}: --fp-glass is the window blue`).toBe(v.pWindow);
    // S25.D1: a door has no symbol; its closed line is the thin line across the gap, in --fp-door; a glass door's in --fp-glass.
    expect(v.shut, `${tag}: a closed door's line is --fp-door`).toBe(v.pDoor);
    expect(v.shut, `${tag}: and it paints`).not.toBe("rgba(0, 0, 0, 0)");
    expect(v.shutW, `${tag}: solid, not dashed like sealed`).toBe("none");
    expect(v.shutG, `${tag}: a closed glass door's line is --fp-glass`).toBe(v.pGlass);
    expect(v.holeG, `${tag}: a glass door with no sensor paints nothing`).toBe("rgba(0, 0, 0, 0)");
    expect(v.window.stroke, tag).toBe(v.pWindow);
    expect(v.slit.stroke, tag).toBe(v.pWindow);
    expect(v.fullwindow.stroke, `${tag}: S25.D3 a full-height window wears the window blue`).toBe(v.pWindow);
    for (const s of [v.window, v.slit]) {
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

// S1 (Opus review of S23): a window's pane fills the cut, so its outer half no longer shows the board. Read back in every
// theme: an opaque glass tint that is neither the board nor the bare room, takes no clicks, and red-tinted while open.
const paneBody = `<path class="win-pane k-window" d="M0 0L10 0L10 10L0 10Z"/><path class="win-pane k-slit" d="M0 0L10 0L10 10L0 10Z"/>
<path class="win-pane k-window open" d="M0 0L10 0L10 10L0 10Z"/><path class="win-jamb k-window" d="M0 0L0 10"/>
<path class="win-jamb k-window alarm" d="M0 0L0 10"/>
<rect class="p-bg" style="fill:var(--fp-bg)"/><rect class="p-empty" style="fill:var(--fp-room-empty)"/><rect class="p-window" style="fill:var(--fp-window)"/>
<rect class="p-red" style="fill:var(--fp-open-door)"/>`;
const paneHtml = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}">${paneBody}</g>`).join("")}</svg></body></html>`;

test("S1 CSS pair: a window's pane is an opaque glass tint, not the board and not the bare room; jambs are window hairlines", async ({ page }) => {
  await page.setContent(paneHtml);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, cs = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    const pane = (sel: string) => { const c = cs(sel); return { fill: c.fill, fo: c.fillOpacity, op: c.opacity, stroke: c.stroke, pe: c.pointerEvents }; };
    const j = (sel: string) => { const c = cs(sel); return { stroke: c.stroke, w: c.strokeWidth, ve: c.vectorEffect, pe: c.pointerEvents, fill: c.fill }; };
    return {
      win: pane(".win-pane.k-window:not(.open)"), slit: pane(".win-pane.k-slit"), open: pane(".win-pane.open"),
      jamb: j(".win-jamb:not(.alarm)"), jambAlarm: j(".win-jamb.alarm"),
      bg: cs(".p-bg").fill, empty: cs(".p-empty").fill, window: cs(".p-window").fill, red: cs(".p-red").fill,
    };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    for (const p of [v.win, v.slit]) {
      expect(p.fill, `${tag}: the pane paints`).not.toBe("none");
      expect(p.fill, tag).not.toBe("rgba(0, 0, 0, 0)");
      expect(p.fill, `${tag}: not the board`).not.toBe(v.bg);
      expect(p.fill, `${tag}: not the bare room either, it is glass`).not.toBe(v.empty);
      expect(p.fo, `${tag}: opaque, so the board cannot show through`).toBe("1");
      expect(p.op, tag).toBe("1");
      expect(p.stroke, tag).toBe("none");
      expect(p.pe, `${tag}: the pane takes no clicks`).toBe("none");
    }
    expect(v.slit.fill, tag).toBe(v.win.fill);
    expect(v.open.fill, `${tag}: an open window's pane is not the closed tint`).not.toBe(v.win.fill);
    expect(v.jamb.stroke, tag).toBe(v.window);
    expect(v.jamb.w, tag).toBe("1px");
    expect(v.jamb.ve, tag).toBe("non-scaling-stroke");
    expect(v.jamb.pe, tag).toBe("none");
    expect(v.jamb.fill, tag).toBe("none");
    expect(v.jambAlarm.stroke, `${tag}: red with a state`).toBe(v.red);
  });
});

// S23 review S1/S6: midnight's window hairlines were #2c7fb8 on a navy pane, 2.8:1, faint beside the pale wall. A line
// that marks a thing on the plan needs 3:1 on what is behind it (WCAG 1.4.11). Pinned for midnight and Home Assistant
// dark, which falls back to it; the other themes are listed in the message so a change to them shows.
test("S6: midnight's window line clears 3:1 on its pane", async ({ page }) => {
  await page.setContent(paneHtml);
  const rgb = (css: string): number[] => { const m = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(css); return m ? [m[1], m[2], m[3]].map((v) => Number(v) * 255) : (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number); };
  const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, cs = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    return { line: cs(".win-jamb:not(.alarm)").stroke, pane: cs(".win-pane.k-window:not(.open)").fill };
  }), CASES.length);
  const all = CASES.map((c, i) => ({ tag: `${c.t}/${c.mode}`, k: ratio(rgb(r[i].line), rgb(r[i].pane)) }));
  const seen = all.map((x) => `${x.tag} ${x.k.toFixed(2)}`).join(", ");
  for (const x of all.filter((a) => a.tag === "midnight/light" || a.tag === "ha/dark")) expect(x.k, `${x.tag} (${seen})`).toBeGreaterThanOrEqual(3);
});
