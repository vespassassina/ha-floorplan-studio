import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core/render";

// S25.5 computed-style pair (CLAUDE.md finding 10): every spider rule read back from Chromium on the markup renderFloor draws.
// Leader, pin and name never take a click (finding 18: class rules, not attributes); a fanned member stays drawn at far, an
// idle device that is not fanned does not.

const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-09-18T10:00:00Z" });
const floor = {
  outline: [], rooms: [], walls: [], openings: [], doors: [], stairs: [], extras: [], furniture: [], unlinked: [],
  devices: [{ id: "a", type: "light", entity: "light.a", name: "A", x: 100, y: 100 }, { id: "b", type: "light", entity: "light.b", name: "B", x: 104, y: 100 }, { id: "c", type: "light", entity: "light.c", name: "C", x: 300, y: 300 }],
};
const page_ = (detail: string, theme: string) => {
  const body = renderFloor(floor as never, { scale: 1, theme: theme as never, detail: detail as never, state: { "light.a": st("off"), "light.b": st("off"), "light.c": st("off") } as never,
    now: Date.parse("2026-09-19T10:00:05Z"), spider: [{ i: 0, at: [60, 60] }, { i: 1, at: [160, 60] }] });
  return `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg width="600" height="400" viewBox="0 0 400 400" id="p">${body}</svg></body></html>`;
};

for (const theme of ["light", "midnight", "blueprint"]) {
  test(`${theme}: leader, pin and name take no click and are drawn in the plan's ink`, async ({ page }) => {
    await page.setContent(page_("near", theme));
    const r = await page.evaluate(() => {
      const cs = (sel: string) => { const e = document.querySelector(sel)!; const s = getComputedStyle(e); return { pe: s.pointerEvents, stroke: s.stroke, fill: s.fill, sw: s.strokeWidth, display: s.display, ls: s.paintOrder }; };
      const root = getComputedStyle(document.querySelector("#p")!);
      return { leader: cs(".spider-leader"), pin: cs(".spider-pin"), lbl: cs(".spider-lbl"), text: root.getPropertyValue("--fp-text").trim() };
    });
    expect(r.leader.pe).toBe("none");
    expect(r.pin.pe).toBe("none");
    expect(r.lbl.pe).toBe("none");
    expect(r.leader.stroke).not.toBe("none");
    expect(r.leader.sw).toBe("1px");
    expect(r.pin.fill).not.toBe("none");
    expect(r.lbl.fill).not.toBe("none");
    expect(r.lbl.sw).toBe("3px"); // the halo, so a name reads over a room fill
  });
}

test("far: a fanned member stays drawn with its glyph and disc, an idle device that is not fanned does not", async ({ page }) => {
  await page.setContent(page_("far", "light"));
  const r = await page.evaluate(() => [0, 1, 2].map((i) => {
    const g = document.querySelector(`#p g[data-x="${i}"]`)!;
    return { group: getComputedStyle(g).display, glyph: getComputedStyle(g.querySelector("path:not(.cone)")!).display, halo: getComputedStyle(g.querySelector(".halo")!).transform };
  }));
  for (const m of [r[0], r[1]]) {
    expect(m.group).not.toBe("none");
    expect(m.glyph).not.toBe("none");
    expect(m.halo).toBe("none"); // full-size disc, not the far dot's 0.5 scale
  }
  expect(r[2].group).toBe("none");
});

test("a fanned member is drawn at its spot, away from the true one", async ({ page }) => {
  await page.setContent(page_("near", "light"));
  const r = await page.evaluate(() => {
    const g = document.querySelector('#p g[data-x="1"]')!.getBoundingClientRect(), pin = document.querySelectorAll("#p .spider-pin")[1].getBoundingClientRect();
    return { dx: Math.abs((g.x + g.width / 2) - (pin.x + pin.width / 2)), n: document.querySelectorAll("#p .spider-leader").length };
  });
  expect(r.n).toBe(2);
  expect(r.dx).toBeGreaterThan(40);
});
