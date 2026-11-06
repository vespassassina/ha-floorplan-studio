import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// B53.11, findings 10 and 18: the plant's glow and the appliance's alert are rules, and a rule read as a string says nothing about
// specificity. Each is read back from Chromium as a computed value in every theme, against a probe of the token it must wear.
const glow = `<rect class="plant-glow" x="4" y="4" width="92" height="92" rx="14"/><path d="M0 0h1"/>`;
const probe = (v: string) => `<g class="probe" style="fill:var(${v})"><path d="M0 0"/></g>`;
const BODY = `<g class="furn furn-plant thirsty">${glow}</g><g class="furn furn-plant">${glow}</g>${probe("--fp-plant-thirsty")}${probe("--fp-open-door")}`
  + `<g class="furn alert"><path class="x" d="M0 0h1"/></g><g class="furn"><path class="x" d="M0 0h1"/></g><g class="furn furn-car alert"><path class="x" d="M0 0h1"/></g>${probe("--fp-furniture")}`
  + `<g class="furn" color="var(--fp-furniture)" data-linked="pc"><path d="M0 0h1"/></g><g class="furn" color="var(--fp-furniture)" data-linked=""><path d="M0 0h1"/></g>${probe("--fp-dev-tv")}`;
const plan = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${BODY}</g>`).join("")}</svg></body></html>`;

const read = (page: import("@playwright/test").Page, t: string) => page.locator(`#t-${t}`).evaluate((g) => {
  const c = Array.from(g.children), css = (e: Element | null) => getComputedStyle(e!);
  return {
    stroke: css(c[0].querySelector(".plant-glow")).stroke, anim: css(c[0].querySelector(".plant-glow")).animationName, opacity: css(c[0].querySelector(".plant-glow")).opacity,
    calmAnim: css(c[1].querySelector(".plant-glow")).animationName, pointer: css(c[0].querySelector(".plant-glow")).pointerEvents,
    water: css(c[2].querySelector("path")).fill, door: css(c[3].querySelector("path")).fill, furniture: css(c[7].querySelector("path")).fill,
    pcColor: css(c[8]).color, tvColor: css(c[9]).color, tvToken: css(c[10].querySelector("path")).fill,
    alertColor: css(c[4]).color, plainColor: css(c[5]).color, carColor: css(c[6]).color,
  };
});

test("a thirsty plant's glow is the water blue in every theme, and breathes; a plant that is fine does not", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.stroke, `${t}: glow stroke is --fp-plant-thirsty`).toBe(r.water);
    expect(r.anim, `${t}: breathes`).toBe("fp-car-breath");
    expect(r.calmAnim, `${t}: a glow without .thirsty is still`).toBe("none");
    expect(r.pointer, `${t}: never takes a click`).toBe("none");
  }
});

test("reduced motion holds the glow still at 60 %", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.anim, t).toBe("none");
    expect(r.opacity, t).toBe("0.6");
  }
});

test("an alerting appliance wears the open-door colour; a car keeps its own alert, an ordinary piece is unchanged", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.alertColor, `${t}: alert`).toBe(r.door);
    expect(r.plainColor, `${t}: plain is not the alert`).not.toBe(r.door);
    expect(r.carColor, `${t}: a car's alert is its roof/outline, not the group colour`).not.toBe(r.door);
  }
});

test("a linked appliance or plant keeps the furniture colour at rest (data-linked=\"pc\"); a linked tv is the tv's blue", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.pcColor, `${t}: appliance idle colour`).toBe(r.furniture);
    expect(r.tvColor, `${t}: tv blue`).toBe(r.tvToken);
  }
});
