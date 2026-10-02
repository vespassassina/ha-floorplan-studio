import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import type { RenderOpts } from "../../src/core/render";

// renderFloor is wrapped, not replaced (same trick as card-view.test.ts): real markup, and the test reads the
// rotation the card handed to core.
vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return { ...actual, renderFloor: vi.fn(actual.renderFloor) };
});
import { THEMES, planPivot, renderFloor, rotateAbout, viewBoxFor } from "../../src/core";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, FloorplanStudioCardConfig } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;
const lastOpts = () => (renderFloor as unknown as Mock).mock.calls.at(-1)![1] as RenderOpts;
const deg = () => lastOpts().rotate?.deg ?? 0;

/** jsdom has no matchMedia: `reduce` says whether the user asked for reduced motion. */
function mockMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

async function mount(config: Partial<FloorplanStudioCardConfig> = {}, layout: Layout = structuredClone(L)): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout, floor: "ground", ...config } as FloorplanStudioCardConfig);
  await el.updateComplete;
  return el;
}
const q = <T extends Element>(el: FloorplanStudioCard, sel: string) => el.shadowRoot!.querySelector<T>(sel);
const btn = (el: FloorplanStudioCard, label: string) => q<HTMLButtonElement>(el, `button[aria-label="${label}"]`);
const click = async (el: FloorplanStudioCard, label: string) => {
  btn(el, label)!.click();
  await el.updateComplete;
};
const vb = (el: FloorplanStudioCard) => q<SVGSVGElement>(el, "svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number) as [number, number, number, number];
const themeSelect = (el: FloorplanStudioCard) => q<HTMLSelectElement>(el, 'select[aria-label="Theme"]');
const viewSelect = (el: FloorplanStudioCard) => q<HTMLSelectElement>(el, 'select[aria-label="View"]');
const choose = async (el: FloorplanStudioCard, s: HTMLSelectElement, value: string) => {
  s.value = value;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
};
const stored = () => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-view:"));
const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
const advance = async (el: FloorplanStudioCard, ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await el.updateComplete;
};

beforeEach(() => {
  localStorage.clear();
  mockMotion(true); // most tests want the turn to land at once; the animation tests switch it off
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks(); // spies first, then the clock (CLAUDE.md finding 15)
  vi.useRealTimers();
  localStorage.clear();
});

describe("rotate buttons and the config rotation", () => {
  it("has rotate left and right next to the zoom buttons, and Reset view and Theme in the same group", async () => {
    const el = await mount();
    const group = btn(el, "Zoom in")!.closest(".fp-zoom");
    for (const l of ["Rotate left", "Rotate right", "Reset view"]) expect(btn(el, l)!.closest(".fp-zoom"), l).toBe(group);
    expect(themeSelect(el)!.closest(".fp-zoom")).toBe(group);
  });

  it("they are hidden with view_switch: false and in kiosk, like the View select", async () => {
    for (const cfg of [{ view_switch: false }, { kiosk: true }]) {
      const el = await mount(cfg);
      for (const l of ["Rotate left", "Rotate right", "Reset view"]) expect(btn(el, l), `${l} ${JSON.stringify(cfg)}`).toBeNull();
      expect(themeSelect(el)).toBeNull();
      el.remove();
    }
  });

  it("config rotation is the starting angle: junk is 0, anything else a multiple of 45 in 0..315", async () => {
    for (const [v, want] of [[undefined, 0], ["x", 0], [NaN, 0], [null, 0], [{}, 0], [90, 90], [100, 90], [-45, 315], [405, 45], [23, 45]] as const) {
      const el = await mount({ rotation: v as never });
      expect(deg(), String(v)).toBe(want);
      el.remove();
    }
  });

  it("the effective angle is the layout's own rotate plus the user's step", async () => {
    const turned = structuredClone(L);
    turned.rotate = 45;
    const el = await mount({ rotation: 90 }, turned);
    expect(deg()).toBe(135);
    await click(el, "Rotate right");
    expect(deg()).toBe(180);
    await click(el, "Rotate left");
    await click(el, "Rotate left");
    expect(deg()).toBe(90);
  });

  it("turning right is +45, left is -45, and the steps wrap: 315 -> 0 is one step", async () => {
    const el = await mount({ rotation: 315 });
    await click(el, "Rotate right");
    expect(deg()).toBe(0);
    await click(el, "Rotate left");
    expect(deg()).toBe(315);
  });

  it("icons and names stay upright: text carries the counter-rotation of the plan's turn", async () => {
    const el = await mount({ rotation: 45 });
    const t = q<SVGTextElement>(el, "svg text.lbl")!;
    expect(t.getAttribute("transform")).toMatch(/^rotate\(-45 /);
  });
});

describe("a turn keeps the same plan point at the centre of the screen", () => {
  const centreOnPlan = (el: FloorplanStudioCard, layout: Layout): [number, number] => {
    const [x, y, w, h] = vb(el);
    return rotateAbout([x + w / 2, y + h / 2], -deg(), planPivot(layout));
  };

  it("zoomed and panned, 45 and 90 degrees either way", async () => {
    for (const steps of [1, 2, -1, -3, 4]) {
      const turned = structuredClone(L);
      turned.rotate = 45;
      const el = await mount({}, turned);
      await click(el, "Zoom in");
      await click(el, "Zoom in");
      const before = centreOnPlan(el, turned);
      const zoomBefore = viewBoxFor(turned.floors.ground!, 60, { deg: deg(), pivot: planPivot(turned) }).w / vb(el)[2];
      for (let i = 0; i < Math.abs(steps); i++) await click(el, steps > 0 ? "Rotate right" : "Rotate left");
      const after = centreOnPlan(el, turned);
      expect(after[0], `x after ${steps}`).toBeCloseTo(before[0], 4);
      expect(after[1], `y after ${steps}`).toBeCloseTo(before[1], 4);
      const zoomAfter = viewBoxFor(turned.floors.ground!, 60, { deg: deg(), pivot: planPivot(turned) }).w / vb(el)[2];
      expect(zoomAfter, `zoom after ${steps}`).toBeCloseTo(zoomBefore, 4);
      el.remove();
    }
  });

  it("2.5D: the box after a turn still bounds the whole fit box, lift included", async () => {
    const el = await mount({ view: "2.5d", rotation: 45 });
    const fit = viewBoxFor(L.floors.ground!, 60, { deg: 45, pivot: planPivot(L) }, "2.5d", 0.5);
    const [x, y, w, h] = vb(el);
    expect(x).toBeLessThanOrEqual(fit.x + 1e-6);
    expect(y).toBeLessThanOrEqual(fit.y + 1e-6);
    expect(x + w).toBeGreaterThanOrEqual(fit.x + fit.w - 1e-6);
    expect(y + h).toBeGreaterThanOrEqual(fit.y + fit.h - 1e-6);
  });
});

describe("the turn is animated", () => {
  beforeEach(() => {
    mockMotion(false);
    fakeClock();
  });

  it("goes through intermediate angles in about 350 ms and ends exactly on the step", async () => {
    const el = await mount();
    await click(el, "Rotate right");
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      await advance(el, 32);
      seen.push(deg());
    }
    expect(seen.some((d) => d > 1 && d < 44)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!); // never backwards
    expect(seen.at(-1)).toBe(45);
    // ease-in-out: slower than linear at the start (a quarter of the time covers less than a quarter of the turn)
    localStorage.clear(); // the first card remembered its turn
    const el2 = await mount();
    await click(el2, "Rotate right");
    await advance(el2, 88);
    expect(deg()).toBeLessThan(45 * 0.25);
    expect(deg()).toBeGreaterThan(0);
  });

  it("the end state is byte-identical to a direct render at that angle", async () => {
    const direct = await mount({ rotation: 45 });
    const want = q<SVGSVGElement>(direct, "svg")!.innerHTML;
    const wantBox = vb(direct);
    direct.remove();
    const el = await mount();
    await click(el, "Rotate right");
    await advance(el, 600);
    expect(q<SVGSVGElement>(el, "svg")!.innerHTML).toBe(want);
    expect(vb(el)).toEqual(wantBox);
  });

  it("a second click mid-turn retargets: no jump back, no drift, lands on 90", async () => {
    const el = await mount();
    await click(el, "Rotate right");
    await advance(el, 150);
    const mid = deg();
    expect(mid).toBeGreaterThan(0);
    await click(el, "Rotate right");
    expect(deg()).toBeGreaterThanOrEqual(mid - 1e-9); // continues from where it is
    await advance(el, 1000);
    expect(deg()).toBe(90);
    expect(localStorage.length).toBeGreaterThan(0);
  });

  it("opposite clicks mid-turn net to the step they add up to", async () => {
    const el = await mount();
    await click(el, "Rotate right");
    await advance(el, 100);
    await click(el, "Rotate left");
    await advance(el, 1000);
    expect(deg()).toBe(0);
  });

  it("315 -> 0 turns the short way (+45), never back through 270", async () => {
    const el = await mount({ rotation: 315 });
    await click(el, "Rotate right");
    const seen: number[] = [];
    for (let i = 0; i < 14; i++) {
      await advance(el, 32);
      seen.push(((deg() % 360) + 360) % 360);
    }
    expect(Math.min(...seen.filter((d) => d > 200))).toBeGreaterThanOrEqual(315 - 1e-9); // never below 315 on the way
    expect(seen.at(-1)).toBe(0);
  });

  it("reduced motion skips the animation: the new angle is there at once", async () => {
    mockMotion(true);
    const el = await mount();
    await click(el, "Rotate right");
    expect(deg()).toBe(45);
  });

  it("the plan takes no taps while it turns, and does again after", async () => {
    const el = await mount();
    const svg = q<SVGSVGElement>(el, "svg")!;
    await click(el, "Rotate right");
    expect(svg.classList.contains("fp-turning")).toBe(true);
    await advance(el, 600);
    expect(svg.classList.contains("fp-turning")).toBe(false);
  });

  it("leaving the page cancels the frame loop: no frame fires after disconnect", async () => {
    const el = await mount();
    await click(el, "Rotate right");
    const calls = (renderFloor as unknown as Mock).mock.calls.length;
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    el.remove();
    expect(cancel).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect((renderFloor as unknown as Mock).mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the card remembers its view", () => {
  it("remembers rotation, view, tilt, theme and labels, immediately, and a fresh card comes back with them", async () => {
    const a = await mount();
    await click(a, "Rotate right");
    await click(a, "Rotate right");
    await choose(a, viewSelect(a)!, "2.5d");
    await choose(a, themeSelect(a)!, "light");
    await click(a, "Labels");
    expect(stored()).toHaveLength(1);
    a.remove();

    const b = await mount();
    expect(deg()).toBe(90);
    expect(lastOpts().view).toBe("2.5d");
    expect(lastOpts().theme).toBe("light");
    expect(lastOpts().labels).toBe(false);
    expect(b.getAttribute("data-theme")).toBe("light");
    expect(viewSelect(b)!.value).toBe("2.5d");
    expect(themeSelect(b)!.value).toBe("light");
  });

  it("restores before the first render: no frame is drawn with the default first", async () => {
    const a = await mount();
    await click(a, "Rotate right");
    await choose(a, themeSelect(a)!, "midnight");
    a.remove();
    (renderFloor as unknown as Mock).mockClear();
    await mount();
    const calls = (renderFloor as unknown as Mock).mock.calls.map((c) => c[1] as RenderOpts);
    expect(calls.length).toBeGreaterThan(0);
    for (const o of calls) {
      expect(o.rotate?.deg).toBe(45);
      expect(o.theme).toBe("midnight");
    }
  });

  it("remembers zoom and focus: a fresh card shows the same box", async () => {
    const a = await mount();
    await click(a, "Zoom in");
    await click(a, "Zoom in");
    const box = vb(a);
    a.remove(); // leaving flushes the debounced save: nothing waits 400 ms for the page to close
    const b = await mount();
    const got = vb(b);
    for (let i = 0; i < 4; i++) expect(got[i]!).toBeCloseTo(box[i]!, 3);
  });

  it("zoom and focus come back at the same plan point after a rotation", async () => {
    const a = await mount();
    await click(a, "Zoom in");
    await click(a, "Zoom in");
    await click(a, "Rotate right");
    const box = vb(a);
    a.remove();
    const b = await mount();
    expect(deg()).toBe(45);
    const got = vb(b);
    for (let i = 0; i < 4; i++) expect(got[i]!).toBeCloseTo(box[i]!, 3);
  });

  it("a stored entry beats the config; with nothing stored the config applies", async () => {
    const plain = await mount({ theme: "slate", view: "2.5d", rotation: 90, labels: false });
    expect(lastOpts().theme).toBe("slate");
    expect(lastOpts().view).toBe("2.5d");
    expect(deg()).toBe(90);
    expect(lastOpts().labels).toBe(false);
    expect(stored()).toHaveLength(0); // looking is not choosing: nothing is written
    await choose(plain, themeSelect(plain)!, "terminal");
    plain.remove();
    await mount({ theme: "slate", view: "2.5d", rotation: 90, labels: false });
    expect(lastOpts().theme).toBe("terminal"); // stored wins
    expect(lastOpts().view).toBe("2.5d"); // never chosen: config still in charge
    expect(deg()).toBe(90);
  });

  it("junk in storage is dropped field by field and never throws", async () => {
    const seed = await mount();
    await choose(seed, themeSelect(seed)!, "light");
    const [key] = stored()[0]!;
    seed.remove();
    for (const raw of ["{", "null", "[]", '{"rotation":"x","theme":"neon","view":"9d","tilt":"a","zoom":2,"focus":"no"}', '{"theme":"midnight","rotation":999999}', "\u0000"]) {
      localStorage.setItem(key, raw);
      const el = await mount();
      expect((THEMES as readonly string[]).includes(lastOpts().theme!)).toBe(true);
      expect(deg() % 45).toBe(0);
      el.remove();
    }
    localStorage.setItem(key, '{"theme":"midnight","rotation":999999,"view":"9d"}');
    await mount();
    expect(lastOpts().theme).toBe("midnight"); // the good field survived
    expect(lastOpts().view).toBe("2d");
  });

  it("a stored focus far off the plan is pulled back so the plan stays in view", async () => {
    const seed = await mount();
    await click(seed, "Zoom in");
    await choose(seed, themeSelect(seed)!, "light"); // forces a write
    const [key] = stored()[0]!;
    seed.remove();
    localStorage.setItem(key, JSON.stringify({ zoom: 4, focus: [9e5, -9e5] }));
    const el = await mount();
    const fit = viewBoxFor(L.floors.ground!, 60, undefined, "2d", 0.5);
    const [x, y, w, h] = vb(el);
    expect(x).toBeLessThan(fit.x + fit.w); // some of the box overlaps the plan
    expect(x + w).toBeGreaterThan(fit.x);
    expect(y).toBeLessThan(fit.y + fit.h);
    expect(y + h).toBeGreaterThan(fit.y);
  });

  it("two cards with different keys do not share a memory", async () => {
    const a = await mount({ floor: "ground" });
    await click(a, "Rotate right");
    a.remove();
    const other = await mount({ floor: "first" });
    expect(deg()).toBe(0);
    await choose(other, themeSelect(other)!, "light");
    other.remove();
    await mount({ floor: "ground" });
    expect(deg()).toBe(45);
    expect(lastOpts().theme).not.toBe("light");
    expect(stored()).toHaveLength(2);
  });

  it("a card with another view or rotation in its config is another card to the memory", async () => {
    const a = await mount({ view: "2.5d" });
    await click(a, "Rotate right");
    a.remove();
    await mount({ view: "2d" });
    expect(deg()).toBe(0);
  });

  it("storage that throws (private mode, blocked) leaves a working card", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const el = await mount();
    await click(el, "Rotate right");
    await choose(el, themeSelect(el)!, "light");
    await click(el, "Zoom in");
    await click(el, "Reset view");
    expect(deg()).toBe(0);
    el.remove();
  });

  it("pan and zoom saves are debounced: a burst writes once, after it settles", async () => {
    fakeClock();
    const set = vi.spyOn(Storage.prototype, "setItem");
    const el = await mount();
    set.mockClear();
    for (let i = 0; i < 6; i++) await click(el, "Zoom in");
    expect(set).not.toHaveBeenCalled();
    await advance(el, 2000);
    const mine = set.mock.calls.filter(([k]) => String(k).startsWith("fp-view:"));
    expect(mine).toHaveLength(1);
  });

  it("a discrete choice (theme) is written at once", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    const el = await mount();
    await choose(el, themeSelect(el)!, "light");
    expect(set.mock.calls.some(([k]) => String(k).startsWith("fp-view:"))).toBe(true);
  });
});

describe("the theme select", () => {
  it("lists every theme with a readable label, and choosing sets the host theme live", async () => {
    const el = await mount({ theme: "midnight" });
    const s = themeSelect(el)!;
    expect([...s.options].map((o) => o.value)).toEqual([...THEMES]);
    for (const o of s.options) expect(o.textContent!.trim(), o.value).toMatch(/^[A-Z]/);
    expect(s.value).toBe("midnight");
    await choose(el, s, "terminal");
    expect(el.getAttribute("data-theme")).toBe("terminal");
  });

  it("ignores a value that is not a theme", async () => {
    const el = await mount({ theme: "midnight" });
    const s = themeSelect(el)!;
    const o = document.createElement("option");
    o.value = "neon";
    s.append(o);
    await choose(el, s, "neon");
    expect(el.getAttribute("data-theme")).toBe("midnight");
  });
});

describe("Reset view", () => {
  it("returns every view option to the config, keeps the floor, and clears the stored entry", async () => {
    const turned = structuredClone(L);
    const el = await mount({ floor: "all", theme: "slate", view: "2d", tilt: 0.2, labels: true, rotation: 90 }, turned);
    q<HTMLButtonElement>(el, '.fp-floors button[aria-pressed="false"]')!.click(); // the second floor
    await el.updateComplete;
    await click(el, "Zoom in");
    await click(el, "Rotate right");
    await choose(el, viewSelect(el)!, "2.5d");
    await choose(el, themeSelect(el)!, "light");
    await click(el, "Labels");
    expect(stored()).toHaveLength(1);
    await click(el, "Reset view");
    expect(deg()).toBe(90);
    expect(lastOpts().view).toBe("2d");
    expect(lastOpts().theme).toBe("slate");
    expect(lastOpts().tilt).toBeCloseTo(0.2, 6);
    expect(lastOpts().labels).toBe(true);
    expect(el.getAttribute("data-theme")).toBe("slate");
    expect(stored()).toHaveLength(0);
    const fit = viewBoxFor(turned.floors.first!, 60, { deg: 90, pivot: planPivot(turned) });
    const got = vb(el);
    for (let i = 0; i < 4; i++) expect(got[i]!).toBeCloseTo([fit.x, fit.y, fit.w, fit.h][i]!, 3); // the second floor's own fit
    expect(q(el, '.fp-floors button[aria-pressed="true"]')!.textContent).toBe("First");
  });

  it("animates the rotation back the short way: 315 -> config 0 is +45", async () => {
    mockMotion(false);
    fakeClock();
    const el = await mount();
    await click(el, "Rotate left"); // 315
    await advance(el, 600);
    expect(deg()).toBe(315);
    await click(el, "Reset view");
    const seen: number[] = [];
    for (let i = 0; i < 14; i++) {
      await advance(el, 32);
      seen.push(deg());
    }
    expect(Math.min(...seen.map((d) => ((d % 360) + 360) % 360).filter((d) => d > 200))).toBeGreaterThanOrEqual(315 - 1e-9);
    expect(((seen.at(-1)! % 360) + 360) % 360).toBe(0);
  });

  it("is disabled when nothing differs from the config, enabled after a change", async () => {
    const el = await mount();
    expect(btn(el, "Reset view")!.disabled).toBe(true);
    await click(el, "Rotate right");
    expect(btn(el, "Reset view")!.disabled).toBe(false);
    await click(el, "Reset view");
    expect(btn(el, "Reset view")!.disabled).toBe(true);
  });

  it("the Fit button stays and fits only: rotation and theme are untouched", async () => {
    const el = await mount();
    await click(el, "Rotate right");
    await choose(el, themeSelect(el)!, "light");
    await click(el, "Zoom in");
    await click(el, "Fit");
    expect(deg()).toBe(45);
    expect(lastOpts().theme).toBe("light");
  });
});
