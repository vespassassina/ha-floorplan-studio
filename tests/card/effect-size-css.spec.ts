import { test, expect, type Page } from "@playwright/test";
import { demo } from "./helpers-3d";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";

// S14.3 (spec items 6 and 7): the effect size and the siren's louder alert, read back from Chromium (CLAUDE.md finding 10: a CSS string
// test is blind to specificity). The markup is renderFloor's own output for a floor with one device per case, so the
// class names, the `--fp-fx` custom property and the stylesheet are the real ones.

const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-09-19T10:00:00Z" });
const dev = (id: string, type: string, entity: string, x: number, extra: object = {}) => ({ id, type, entity, x, y: 300, ...extra });
const DEVICES = [
  dev("spk", "speaker", "media_player.a", 100), dev("spk2", "speaker", "media_player.b", 200, { fx: 200 }), dev("spk-half", "speaker", "media_player.c", 300, { fx: 50 }),
  dev("sir", "other", "siren.a", 400), dev("sir2", "other", "siren.b", 500, { fx: 200 }), dev("mot", "motion", "binary_sensor.m", 600), dev("mot2", "motion", "binary_sensor.n", 700, { fx: 150 }),
];
const STATE = { "media_player.a": st("playing"), "media_player.b": st("playing"), "media_player.c": st("playing"), "siren.a": st("on"), "siren.b": st("on"), "binary_sensor.m": st("on"), "binary_sensor.n": st("on") };
const markup = () => renderFloor({ ...structuredClone(demo.floors.ground), devices: DEVICES } as never, { scale: 1, state: STATE as never, now: Date.parse("2026-09-19T10:00:05Z") });
const plan = (theme = "light") => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg width="900" height="700" viewBox="0 0 900 700"><g data-theme="${theme}" data-mode="dark" id="p">${markup()}</g></svg></body></html>`;

/** The scale a ring's computed transform holds. */
const scaleOf = (page: Page, id: string, cls: string) => page.locator(`#p g[data-x="${DEVICES.findIndex((d) => d.id === id)}"] .${cls}`).first().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

test("reduced motion: the rings hold still at a size the effect size sets; the siren's is twice the speaker's, and fx scales both", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(plan());
  const r = { wave: await scaleOf(page, "spk", "wave"), wave2: await scaleOf(page, "spk2", "wave"), half: await scaleOf(page, "spk-half", "wave"), siren: await scaleOf(page, "sir", "siren-ring"), siren2: await scaleOf(page, "sir2", "siren-ring"), ping: await scaleOf(page, "mot", "ping"), ping2: await scaleOf(page, "mot2", "ping") };
  expect(r.wave).toBeCloseTo(1.5, 5); // today's pixels
  expect(r.wave2).toBeCloseTo(2, 5); // 1 + .5 * 2
  expect(r.half).toBeCloseTo(1.25, 5); // 1 + .5 * .5
  expect(r.siren).toBeCloseTo(3, 5);
  expect(r.siren / r.wave, "twice the radius").toBeCloseTo(2, 5);
  expect(r.siren2).toBeCloseTo(5, 5); // 1 + 2 * 2
  expect(r.ping).toBeCloseTo(1.5, 5);
  expect(r.ping2).toBeCloseTo(1.75, 5);
  const o = (id: string, cls: string) => page.locator(`#p g[data-x="${DEVICES.findIndex((d) => d.id === id)}"] .${cls}`).first().evaluate((el) => ({ op: getComputedStyle(el).opacity, an: getComputedStyle(el).animationName }));
  expect(await o("spk", "wave")).toEqual({ op: "0.6", an: "none" });
  expect(await o("sir", "siren-ring")).toEqual({ op: "0.8", an: "none" }); // steady, and stronger than the speaker's
});

test("normal motion: the rings end at the size the keyframes name, scaled by fx; the siren's ends at 4.8, beats faster and draws a thicker line", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setContent(plan());
  // Jump each running animation to its last moment and read the computed transform there.
  const endScale = (id: string, cls: string, ms: number) => page.locator(`#p g[data-x="${DEVICES.findIndex((d) => d.id === id)}"] .${cls}`).first().evaluate((el, t) => {
    const a = el.getAnimations()[0];
    a.pause(); a.currentTime = t;
    return new DOMMatrix(getComputedStyle(el).transform).a;
  }, ms);
  expect(await endScale("spk", "wave", 1599)).toBeCloseTo(2.4, 1);
  expect(await endScale("spk2", "wave", 1599)).toBeCloseTo(3.8, 1); // 1 + 1.4 * 2
  expect(await endScale("spk-half", "wave", 1599)).toBeCloseTo(1.7, 1); // 1 + 1.4 * .5
  expect(await endScale("sir", "siren-ring", 999)).toBeCloseTo(4.8, 1);
  expect(await endScale("sir2", "siren-ring", 999)).toBeCloseTo(8.6, 1); // 1 + 3.8 * 2
  expect(await endScale("mot", "ping", 1599)).toBeCloseTo(2.2, 1);
  expect(await endScale("mot2", "ping", 1599)).toBeCloseTo(2.8, 1); // 1 + 1.2 * 1.5
  const look = (id: string, cls: string) => page.locator(`#p g[data-x="${DEVICES.findIndex((d) => d.id === id)}"] .${cls}`).first().evaluate((el) => { const c = getComputedStyle(el); return { w: parseFloat(c.strokeWidth), d: parseFloat(c.animationDuration), pe: c.pointerEvents }; });
  const w = await look("spk", "wave"), s = await look("sir", "siren-ring");
  expect(s.w).toBeGreaterThan(w.w);
  expect(s.d).toBeLessThan(w.d);
  expect([w.pe, s.pe]).toEqual(["none", "none"]);
});

test("a siren's rings are red in every theme, not the idle grey, and its disc wears the same", async ({ page }) => {
  for (const t of THEMES) {
    await page.setContent(plan(t));
    const r = await page.evaluate((i) => {
      const g = document.querySelector(`#p g[data-x="${i}"]`)!, ring = getComputedStyle(g.querySelector(".siren-ring")!).stroke, halo = getComputedStyle(g.querySelector(".halo")!).fill;
      const idle = getComputedStyle(document.querySelector(`#p`)!).getPropertyValue("--fp-idle").trim(), danger = getComputedStyle(document.querySelector("#p")!).getPropertyValue("--fp-danger").trim();
      const probe = document.createElement("i"); probe.style.color = danger; document.body.append(probe);
      const dangerRgb = getComputedStyle(probe).color; probe.style.color = idle; const idleRgb = getComputedStyle(probe).color;
      return { ring, halo, dangerRgb, idleRgb };
    }, DEVICES.findIndex((d) => d.id === "sir"));
    expect(r.ring, t).toBe(r.dangerRgb);
    expect(r.ring, t).not.toBe(r.idleRgb);
    expect(r.halo, t).toBe(r.dangerRgb);
  }
});
