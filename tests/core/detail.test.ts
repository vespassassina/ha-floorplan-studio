import { describe, expect, it } from "vitest";
import { DETAIL_MID_FROM, DETAIL_NEAR_FROM, ICONS_MIN_PLAN_PX, iconsHold, detailFor, detailLevel, parseDetailMode } from "../../src/core/detail";

describe("detailLevel (S25.1)", () => {
  it("has three bands with their edges at 1.6 and 3.2", () => {
    expect([DETAIL_MID_FROM, DETAIL_NEAR_FROM]).toEqual([1.6, 3.2]);
    expect(detailLevel(1, "auto")).toBe("far");
    expect(detailLevel(1.59, "auto")).toBe("far");
    expect(detailLevel(1.6, "auto")).toBe("mid");
    expect(detailLevel(3.19, "auto")).toBe("mid");
    expect(detailLevel(3.2, "auto")).toBe("near");
    expect(detailLevel(40, "auto")).toBe("near");
  });
  it("pins full to near and minimal to far, whatever the zoom", () => {
    for (const z of [0.2, 1, 2, 3.2, 9, NaN]) {
      expect(detailLevel(z, "full")).toBe("near");
      expect(detailLevel(z, "minimal")).toBe("far");
    }
  });
  it("falls back to near on junk zoom, and to auto on junk mode", () => {
    for (const z of [NaN, Infinity, -Infinity, undefined, null, "2", {}, [], 0, -1]) expect(detailLevel(z as never, "auto"), String(z)).toBe("near");
    expect(detailLevel(1, "bogus" as never)).toBe("far");
    expect(detailLevel(2, undefined as never)).toBe("mid");
  });
});

describe("parseDetailMode", () => {
  it("keeps the three names and falls back to auto", () => {
    for (const m of ["auto", "full", "minimal"]) expect(parseDetailMode(m)).toBe(m);
    for (const j of ["", "Full", "far", 3, null, undefined, {}, ["full"], "__proto__"]) expect(parseDetailMode(j), String(j)).toBe("auto");
  });
});

describe("detailFor: zoom relative to the fit box", () => {
  const fit = { w: 1000, h: 800 };
  it("is 1 at fit and rises as the shown box narrows", () => {
    expect(detailFor(fit, { w: 1000, h: 800 }, "auto")).toBe("far");
    expect(detailFor(fit, { w: 1000 / 1.6, h: 500 }, "auto")).toBe("mid");
    expect(detailFor(fit, { w: 1000 / 3.2, h: 250 }, "auto")).toBe("near");
  });
  it("takes the smaller ratio, as copyCardView does", () => {
    expect(detailFor(fit, { w: 100, h: 800 }, "auto")).toBe("far");
  });
  it("falls back to near on a zero or junk box", () => {
    expect(detailFor(fit, { w: 0, h: 0 }, "auto")).toBe("near");
    expect(detailFor(fit, { w: NaN, h: 5 }, "auto")).toBe("near");
    expect(detailFor(fit, null as never, "auto")).toBe("near");
  });
  it("honours the mode", () => {
    expect(detailFor(fit, { w: 10, h: 10 }, "minimal")).toBe("far");
    expect(detailFor(fit, { w: 1000, h: 800 }, "full")).toBe("near");
  });
});

describe("detailFor: icons at the default size, dots only on a small plan (S37.6)", () => {
  const fit = { w: 1000, h: 800 };
  const whole = { w: 1000, h: 800 };
  it("puts the bound at 400 px of rendered plan width", () => {
    expect(ICONS_MIN_PLAN_PX).toBe(400);
  });
  it("auto at fit: dots under 400 px, icons (mid) from 400 px", () => {
    expect(detailFor(fit, whole, "auto", 399.9)).toBe("far");
    expect(detailFor(fit, whole, "auto", 400)).toBe("mid");
    expect(detailFor(fit, whole, "auto", 1280)).toBe("mid");
    expect(detailFor(fit, whole, "auto", 0)).toBe("far");
  });
  it("a plan not measured yet (not a finite number) shows icons: when we cannot tell, show", () => {
    for (const w of [NaN, Infinity]) expect(detailFor(fit, whole, "auto", w), String(w)).toBe("mid");
  });
  it("no width at all (the Studio) leaves the zoom to decide: dots at fit", () => {
    expect(detailFor(fit, whole, "auto")).toBe("far");
    expect(detailFor(fit, whole, "auto", undefined)).toBe("far");
  });
  it("zoom still wins upward, and never downward: mid and near stay, a small plan zoomed in still reads icons", () => {
    expect(detailFor(fit, { w: 1000 / 3.2, h: 250 }, "auto", 1280)).toBe("near");
    expect(detailFor(fit, { w: 1000 / 3.2, h: 250 }, "auto", 300)).toBe("near");
    expect(detailFor(fit, { w: 1000 / 1.6, h: 500 }, "auto", 300)).toBe("mid");
  });
  it("an explicit mode wins over the width", () => {
    expect(detailFor(fit, whole, "minimal", 1280)).toBe("far");
    expect(detailFor(fit, whole, "full", 300)).toBe("near");
  });
});

describe("iconsHold (S38.7)", () => {
  it("icons from 420, dots at 380 and under, the last level in between, both ways", () => {
    expect(iconsHold(420, false)).toBe(true);
    expect(iconsHold(419.9, false)).toBe(false);
    expect(iconsHold(419.9, true)).toBe(true);
    expect(iconsHold(380.1, false)).toBe(false);
    expect(iconsHold(380.1, true)).toBe(true);
    expect(iconsHold(380, true)).toBe(false);
    expect(iconsHold(379.9, true)).toBe(false);
  });
  it("an unmeasured plan reads icons", () => {
    expect(iconsHold(Infinity, false)).toBe(true);
    expect(iconsHold(NaN, false)).toBe(true);
  });
});
