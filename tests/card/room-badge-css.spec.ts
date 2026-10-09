import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

// S25.3 CSS pairs (finding 10): what Chromium computes for a room badge, not the rule as a string. The markup is
// renderFloor's own output (tests/core/rollup.test.ts pins what it writes). `data-detail` is set here by hand on the
// wrapper: the detail option itself is another task's.

const sq = [[0, 0], [400, 0], [400, 300], [0, 300]];
const floor = {
  title: "G", outline: [[-100, -100], [500, -100], [500, 400], [-100, 400]], owk: ["external", "external", "external", "external"],
  walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [],
  rooms: [{ id: "r", name: "Hall", area: "", kind: "room", pts: sq, wk: ["wall", "wall", "wall", "wall"] }],
  devices: [
    { id: "a", type: "light", entity: "light.a", x: 50, y: 50 }, { id: "m", type: "motion", entity: "bs.m", x: 60, y: 60 },
    { id: "w", type: "contact", entity: "bs.w", x: 70, y: 70 }, { id: "l", type: "lock", entity: "lock.l", x: 80, y: 80 },
  ],
} as unknown as Floor;
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-09T10:00:00Z" });
const state = { "light.a": st("on"), "bs.m": st("on"), "bs.w": st("on"), "lock.l": st("unlocked") };
const plan = renderFloor(floor, { scale: 0.5, state });
const CASES = [...THEMES.map((t) => ({ t, mode: "light" })), { t: "ha", mode: "dark" }] as const;
const refs = `<rect class="r-outline" style="fill:var(--fp-outline)"/><rect class="r-text" style="fill:var(--fp-text)"/><rect class="r-light" style="fill:var(--fp-dev-light)"/><rect class="r-motion" style="fill:var(--fp-dev-motion)"/><rect class="r-danger" style="fill:var(--fp-danger)"/><rect class="r-open" style="fill:var(--fp-open-door)"/>`;
const page0 = (detail: string | null) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg viewBox="-100 -100 600 500" width="600" height="500">${
  CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}"${detail ? ` data-detail="${detail}"` : ""}>${refs}${plan}</g>`).join("")}</svg></body></html>`;

test("S25.3 CSS pair: badges show at far and mid, not at near, and not when data-detail is absent", async ({ page }) => {
  const seen: Record<string, string> = {};
  for (const d of ["far", "mid", "near", null] as const) {
    await page.setContent(page0(d));
    seen[String(d)] = await page.evaluate(() => getComputedStyle(document.querySelector(".room-badge")!).display);
  }
  // Break it: delete the `[data-detail="far"] .room-badge,[data-detail="mid"] .room-badge` rule and far reads none; make the base rule inline and near reads inline.
  expect(seen).toEqual({ far: "inline", mid: "inline", near: "none", null: "none" });
});

test("S25.3 CSS pair: a badge's parts take their tokens in every theme, and the plate is not transparent", async ({ page }) => {
  await page.setContent(page0("far"));
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, f = (sel: string) => getComputedStyle(g.querySelector(sel)!).fill;
    return {
      plate: f(".rb-plate"), plateOp: getComputedStyle(g.querySelector(".rb-plate")!).fillOpacity, text: f(".rb-t"), light: f(".rb-light"), motion: f(".rb-motion"), alert: f(".rb-alert"), open: f(".rb-open"),
      outline: f(".r-outline"), tx: f(".r-text"), rl: f(".r-light"), rm: f(".r-motion"), rd: f(".r-danger"), ro: f(".r-open"), font: getComputedStyle(g.querySelector(".rb-t")!).fontVariantNumeric,
    };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const v = r[i]!, tag = `${c.t}/${c.mode}`;
    expect([v.plate, v.text, v.light, v.motion, v.alert, v.open], tag).toEqual([v.outline, v.tx, v.rl, v.rm, v.rd, v.ro]);
    expect(Number(v.plateOp), `${tag}: a plate, not a hole`).toBeGreaterThan(0.5);
    expect(v.font, tag).toBe("tabular-nums");
    expect(v.alert, `${tag}: an alert is not the light colour`).not.toBe(v.light);
  });
});

test("S25.3 CSS pair: a badge takes no pointer events: a real click through it reaches the room (finding 18)", async ({ page }) => {
  await page.setContent(page0("far"));
  const r = await page.evaluate(() => {
    const g = document.getElementById("c0")!, out: Record<string, string> = {};
    for (const sel of [".room-badge", ".rb-plate", ".rb-t", ".rb-light"]) out[sel] = getComputedStyle(g.querySelector(sel)!).pointerEvents;
    const b = g.querySelector(".rb-plate")!.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { pe: out, hit: hit ? { cls: hit.getAttribute("class"), inBadge: !!hit.closest(".room-badge") } : null };
  });
  expect(r.pe).toEqual({ ".room-badge": "none", ".rb-plate": "none", ".rb-t": "none", ".rb-light": "none" });
  expect(r.hit?.inBadge, `the point under the plate hits ${r.hit?.cls}`).toBe(false);
});
