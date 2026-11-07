import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

// B54.4, spec D26, criterion 6, finding 10: the wash and the pipes read back from Chromium as computed values in every theme, against a probe of the
// token they must wear. A rule asserted as a string says nothing about specificity (finding 10) or about a variable that does not resolve inside a
// <pattern> (finding 16). The markup is what renderFloor draws, not a copy of it.
const floor = {
  title: "F", outline: [], walls: [], stairs: [], openings: [], extras: [], unlinked: [], doors: [], furniture: [],
  devices: [{ id: "d1", type: "climate", entity: "climate.floor", x: 100, y: 100, underfloor: true }],
  rooms: [{ id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] }],
} as unknown as Floor;
const heating = { "climate.floor": { state: "heat", attributes: { hvac_action: "heating" }, last_changed: "2026-11-07T10:00:00Z" } };
const probe = `<g class="probe" style="fill:var(--fp-floor-heat)"><path d="M0 0"/></g>`;
// One plan per theme: the markup carries one pattern with a fixed id, so each theme gets its own svg, as each card would.
const plan = () => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style>${THEMES.map((t) => `<svg id="t-${t}" data-theme="${t}" data-mode="dark">${renderFloor(floor, { scale: 1, state: heating })}${probe}</svg>`).join("")}</body></html>`;

test("the wash is the theme's floor-heat colour, translucent, and takes no click; the pipes use the pattern in that colour", async ({ page }) => {
  await page.setContent(plan());
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((svg) => {
      const w = svg.querySelector(".floor-heat")!, p = svg.querySelector(".floor-pipes")!, path = svg.querySelector("pattern#fp-pipes path")!;
      const cw = getComputedStyle(w), cp = getComputedStyle(p);
      return {
        wash: cw.fill, washOpacity: cw.fillOpacity, washStroke: cw.stroke, washEvents: cw.pointerEvents, pipeFill: cp.fill, pipeEvents: cp.pointerEvents,
        pipeStroke: getComputedStyle(path).stroke, token: getComputedStyle(svg.querySelector(".probe path")!).fill,
      };
    });
    expect(r.wash, `${t}: the wash wears --fp-floor-heat`).toBe(r.token);
    expect(r.token, `${t}: and it is a colour`).toMatch(/^rgb\(/);
    expect(Number(r.washOpacity), `${t}: translucent`).toBeGreaterThan(0.1);
    expect(Number(r.washOpacity), `${t}: and not opaque`).toBeLessThan(0.5);
    expect(r.washStroke, t).toBe("none");
    expect(r.washEvents, `${t}: wash takes no click`).toBe("none");
    expect(r.pipeEvents, `${t}: pipes take no click`).toBe("none");
    expect(r.pipeFill, `${t}: pipes fill with the pattern`).toContain("#fp-pipes");
    expect(r.pipeStroke, `${t}: the pipe run is drawn in --fp-floor-heat`).toBe(r.token);
  }
});

test("the editor's room rule does not reach the cue: it takes no click even under .room{pointer-events:all}", async ({ page }) => {
  await page.setContent(`<style>${FLOORPLAN_CSS} .room{pointer-events:all}</style><svg data-theme="blueprint">${renderFloor(floor, { scale: 1, state: heating, editor: true })}</svg>`);
  const ev = await page.evaluate(() => [".floor-heat", ".floor-pipes"].map((s) => getComputedStyle(document.querySelector(s)!).pointerEvents));
  expect(ev).toEqual(["none", "none"]);
});
