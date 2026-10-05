import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// Moved from tests/editor in S12.1: the editor has no 2.5D any more, the card does.
// 2.5D device solids CSS pairs (CLAUDE.md finding 10): a string test cannot see specificity, so each rule is read back
// from Chromium in every theme. The device solids reuse the furniture box's .bs/.bt classes, so the pair that matters
// is that the more specific .dsolid rule really wins over them, and that the on state really changes the pixel.

const plan = (body: string) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`;
const tri = `points="0,0 1,0 1,1"`;
const box = (cls: string, extra = "") => `<g class="obj dsolid ${cls}"><polygon class="bt" ${tri}/><polygon class="bs" ${tri}/><polygon class="bs w" ${tri}/>${extra}</g>`;

test("device solids CSS pair: radiator, speaker and tv faces beat the furniture box, and heating changes the pixel, in every theme", async ({ page }) => {
  await page.setContent(plan(`<g class="obj"><polygon class="bt" ${tri}/><polygon class="bs" ${tri}/><polygon class="bs w" ${tri}/></g>${box("radiator off")}${box("radiator on")}${box("speaker off")}${box("tv off")}`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const f = (el: Element) => [...el.children].map((c) => getComputedStyle(c).fill);
      const [furn, off, on, spk, tv] = [...g.children];
      return { furn: f(furn), off: f(off), on: f(on), spk: f(spk), tv: f(tv), pe: getComputedStyle(on.children[1]).pointerEvents, stroke: getComputedStyle(on.children[1]).stroke };
    });
    for (const k of [r.off, r.on, r.spk, r.tv]) {
      for (const v of k) expect(v, t).toMatch(/^(rgb|color)\(/);
      expect(new Set(k).size, `${t}: lid, side and west side are three shades`).toBe(3);
      expect(k, `${t}: not the furniture box`).not.toEqual(r.furn);
    }
    expect(r.on, `${t}: a heating radiator is not the idle one`).not.toEqual(r.off);
    expect(r.spk, `${t}: a speaker is not a radiator`).not.toEqual(r.off);
    expect(r.pe, t).toBe("none");
    expect(r.stroke, t).toMatch(/^(rgb|color)\(/);
  }
});

test("device solids CSS pair: driver marks light when playing, a screen lights when on, both take no clicks", async ({ page }) => {
  await page.setContent(plan(`${box("speaker off", `<circle class="drv" r="1"/>`)}${box("speaker on", `<circle class="drv" r="1"/>`)}${box("speaker media on", `<circle class="drv" r="1"/>`)}${box("tv off", `<polygon class="tv-screen" ${tri}/>`)}${box("tv on", `<polygon class="tv-screen" ${tri}/>`)}`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const last = (el: Element) => getComputedStyle(el.lastElementChild!);
      const [idle, on, media, tvOff, tvOn] = [...g.children];
      return { idle: last(idle).fill, on: last(on).fill, media: last(media).fill, tvOff: last(tvOff).fill, tvOn: last(tvOn).fill, devSpeaker: getComputedStyle(g).getPropertyValue("--fp-dev-speaker").trim(), devMedia: getComputedStyle(g).getPropertyValue("--fp-dev-media").trim(), pe: last(on).pointerEvents };
    });
    for (const v of [r.idle, r.on, r.media, r.tvOff, r.tvOn]) expect(v, t).toMatch(/^(rgb|color)\(/);
    expect(r.on, `${t}: playing lights the drivers`).not.toBe(r.idle);
    expect(r.tvOn, `${t}: the screen lights`).not.toBe(r.tvOff);
    expect(r.devSpeaker, t).not.toBe("");
    if (r.devMedia !== r.devSpeaker) expect(r.media, `${t}: media uses its own colour`).not.toBe(r.on);
    expect(r.pe, t).toBe("none");
  }
});
