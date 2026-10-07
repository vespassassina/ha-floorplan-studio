import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import type { RenderOpts } from "../../src/core/render";

vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return { ...actual, renderFloor: vi.fn(actual.renderFloor) };
});
import { renderFloor } from "../../src/core";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, FloorplanStudioCardConfig } from "../../src/card/floorplan-studio-card";

// The keys of the card: Up and Down zoom, Left and Right pan, Space resets. Who is listening is the point of these tests: the
// card under the pointer or with focus, never a second card on the page, never someone typing.

const L = demo as unknown as Layout;
const lastOpts = () => (renderFloor as unknown as Mock).mock.calls.at(-1)![1] as RenderOpts;
const deg = () => lastOpts().rotate?.deg ?? 0;

function mockMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}
async function mount(config: Partial<FloorplanStudioCardConfig> = {}): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout: structuredClone(L), floor: "ground", ...config } as FloorplanStudioCardConfig);
  await el.updateComplete;
  return el;
}
const q = <T extends Element>(el: FloorplanStudioCard, sel: string) => el.shadowRoot!.querySelector<T>(sel);
const vbW = (el: FloorplanStudioCard) => Number(q<SVGSVGElement>(el, "svg")!.getAttribute("viewBox")!.split(/\s+/)[2]);
const vbX = (el: FloorplanStudioCard) => Number(q<SVGSVGElement>(el, "svg")!.getAttribute("viewBox")!.split(/\s+/)[0]);
const vbY = (el: FloorplanStudioCard) => Number(q<SVGSVGElement>(el, "svg")!.getAttribute("viewBox")!.split(/\s+/)[1]);
const vbH = (el: FloorplanStudioCard) => Number(q<SVGSVGElement>(el, "svg")!.getAttribute("viewBox")!.split(/\s+/)[3]);
const hover = (el: Element) => el.dispatchEvent(new Event("pointerenter"));
const leave = (el: Element) => el.dispatchEvent(new Event("pointerleave"));
/** Presses `key` where the event starts at `from` (document.body by default). Returns whether the card took it. */
function press(key: string, from: Element = document.body, init: KeyboardEventInit = {}): boolean {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true, ...init });
  from.dispatchEvent(e);
  return e.defaultPrevented;
}
const settle = async (el: FloorplanStudioCard) => { await el.updateComplete; };

beforeEach(() => {
  localStorage.clear();
  mockMotion(true);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks(); // spies first, then the clock (CLAUDE.md finding 15)
  vi.useRealTimers();
  localStorage.clear();
});

describe("card keys: what each key does", () => {
  it("+ zooms in, - zooms out", async () => {
    const el = await mount();
    hover(el);
    const w0 = vbW(el);
    expect(press("+")).toBe(true);
    await settle(el);
    const w1 = vbW(el);
    expect(w1).toBeLessThan(w0);
    press("+");
    await settle(el);
    expect(vbW(el)).toBeLessThan(w1);
    press("-");
    press("-");
    press("-");
    await settle(el);
    expect(vbW(el)).toBeGreaterThan(w0); // zooming out past fit is allowed down to MIN_ZOOM
  });

  it("Left and Right pan the view a tenth of its width either way, and never turn the plan", async () => {
    const el = await mount();
    hover(el);
    expect(press("ArrowRight")).toBe(false); // not zoomed: the whole plan is on show, nothing to pan
    press("+");
    press("+");
    await settle(el);
    const x0 = vbX(el), w = vbW(el);
    press("ArrowRight");
    await settle(el);
    expect(vbX(el) - x0).toBeCloseTo(w * 0.1, 4);
    press("ArrowLeft");
    press("ArrowLeft");
    await settle(el);
    expect(vbX(el) - x0).toBeCloseTo(-w * 0.1, 4);
    expect(deg()).toBe(0);
  });

  it("Up and Down pan the view a tenth of its height either way", async () => {
    const el = await mount();
    hover(el);
    expect(press("ArrowDown")).toBe(false); // not zoomed: nothing to pan
    press("+");
    press("+");
    await settle(el);
    const y0 = vbY(el), h = vbH(el), w0 = vbW(el);
    expect(press("ArrowDown")).toBe(true);
    await settle(el);
    expect(vbY(el) - y0).toBeCloseTo(h * 0.1, 4);
    press("ArrowUp");
    press("ArrowUp");
    await settle(el);
    expect(vbY(el) - y0).toBeCloseTo(-h * 0.1, 4);
    expect(vbW(el)).toBe(w0); // panning never zooms
  });

  it("[ and ] turn the plan 45 degrees; rotate_switch: false leaves them alone", async () => {
    const el = await mount();
    hover(el);
    expect(press("]")).toBe(true);
    await settle(el);
    expect(deg()).toBe(45);
    press("[");
    press("[");
    await settle(el);
    expect(deg()).toBe(315);
    el.remove();
    const none = await mount({ rotate_switch: false });
    hover(none);
    expect(press("[")).toBe(false);
  });

  it("the rotate buttons still turn the plan 45 degrees, and the steps wrap", async () => {
    const el = await mount();
    q<HTMLButtonElement>(el, 'button[aria-label="Rotate left"]')!.click();
    await settle(el);
    expect(deg()).toBe(315);
  });

  it("Space is Reset view: zoom, turn, view and theme back to the config's", async () => {
    const el = await mount();
    hover(el);
    const w0 = vbW(el);
    press("+");
    q<HTMLButtonElement>(el, 'button[aria-label="Rotate right"]')!.click();
    await settle(el);
    expect(vbW(el)).not.toBe(w0);
    expect(deg()).toBe(45);
    expect(press(" ")).toBe(true);
    await settle(el);
    expect(deg()).toBe(0);
    expect(vbW(el)).toBeCloseTo(w0, 6);
  });

  it("Space with nothing to reset does not swallow the key (the page can still scroll)", async () => {
    const el = await mount();
    hover(el);
    expect(press(" ")).toBe(false);
  });

  it("zoom: false: the zoom and pan keys do nothing; view_switch: false and rotate_switch: false leave them alone", async () => {
    const noZoom = await mount({ zoom: false });
    hover(noZoom);
    const w0 = vbW(noZoom);
    expect(press("+")).toBe(false);
    expect(press("ArrowRight")).toBe(false);
    expect(vbW(noZoom)).toBe(w0);
    noZoom.remove();
    const noSwitch = await mount({ view_switch: false });
    hover(noSwitch);
    expect(press("+")).toBe(true);
    expect(press("ArrowRight")).toBe(true); // zoomed now, so there is something to pan
    noSwitch.remove();
    const noRotate = await mount({ rotate_switch: false });
    hover(noRotate);
    expect(press("+")).toBe(true);
    expect(press("ArrowRight")).toBe(true); // panning has nothing to do with the rotate pair
  });

  it("kiosk draws no controls and takes no reset key; its arrows still zoom and pan", async () => {
    const el = await mount({ kiosk: true });
    hover(el);
    expect(press(" ")).toBe(false); // nothing to reset yet
    expect(press("+")).toBe(true);
    expect(press("ArrowLeft")).toBe(true);
  });

  it("other keys and Ctrl/Cmd chords pass", async () => {
    const el = await mount();
    hover(el);
    expect(press("a")).toBe(false);
    expect(press("+", document.body, { ctrlKey: true })).toBe(false);
    expect(press("ArrowLeft", document.body, { metaKey: true })).toBe(false);
  });
});

describe("card keys: which card listens", () => {
  it("a card nobody points at or focused ignores the keys", async () => {
    const el = await mount();
    const w0 = vbW(el);
    expect(press("+")).toBe(false);
    await settle(el);
    expect(vbW(el)).toBe(w0);
  });

  it("the pointer leaving ends it", async () => {
    const el = await mount();
    hover(el);
    leave(el);
    expect(press("+")).toBe(false);
  });

  it("with two cards only the one under the pointer moves", async () => {
    const a = await mount();
    const b = await mount();
    const [wa, wb] = [vbW(a), vbW(b)];
    hover(b);
    press("+");
    await settle(a);
    await settle(b);
    expect(vbW(a)).toBe(wa);
    expect(vbW(b)).toBeLessThan(wb);
  });

  it("a focused card wins over a hovered one", async () => {
    const a = await mount();
    const b = await mount();
    hover(a);
    b.focus();
    expect(document.activeElement).toBe(b);
    const [wa, wb] = [vbW(a), vbW(b)];
    press("+");
    await settle(a);
    await settle(b);
    expect(vbW(a)).toBe(wa);
    expect(vbW(b)).toBeLessThan(wb);
  });

  it("a focused card needs no pointer", async () => {
    const el = await mount();
    el.focus();
    const w0 = vbW(el);
    press("+");
    await settle(el);
    expect(vbW(el)).toBeLessThan(w0);
  });

  it("a card taken off the page stops listening", async () => {
    const el = await mount();
    hover(el);
    el.remove();
    expect(press("+")).toBe(false);
  });
});

describe("card keys: what they never take", () => {
  it("keys typed into a field elsewhere on the page, under the hovered card, are left alone", async () => {
    const el = await mount();
    hover(el);
    for (const tag of ["input", "textarea", "select"]) {
      const f = document.createElement(tag);
      document.body.appendChild(f);
      expect(press("+", f), tag).toBe(false);
      expect(press("ArrowLeft", f), tag).toBe(false);
      expect(press(" ", f), tag).toBe(false);
    }
  });

  it("a range slider keeps its arrows: the Tilt slider in the card's own toolbar", async () => {
    const el = await mount({ view: "2.5d" });
    hover(el);
    const tilt = q<HTMLInputElement>(el, 'input[type="range"][aria-label="Tilt"]')!;
    expect(press("ArrowLeft", tilt)).toBe(false);
    expect(press("+", tilt)).toBe(false);
  });

  it("Space on a focused toolbar button still activates that button, not Reset view", async () => {
    const el = await mount();
    hover(el);
    const rotate = q<HTMLButtonElement>(el, 'button[aria-label="Rotate right"]')!;
    expect(press(" ", rotate)).toBe(false);
    await settle(el);
    expect(deg()).toBe(0);
  });

  it("arrows on a focused toolbar button do work: a button has no use for them", async () => {
    const el = await mount();
    hover(el);
    const labels = q<HTMLButtonElement>(el, 'button[aria-label="Labels"]')!;
    press("+");
    await settle(el);
    const x0 = vbX(el);
    expect(press("ArrowRight", labels)).toBe(true);
    await settle(el);
    expect(vbX(el)).toBeGreaterThan(x0);
  });

  it("an open dialog keeps the keys", async () => {
    const el = await mount();
    hover(el);
    (el as unknown as { _chooserDialog: unknown })._chooserDialog = { title: "x", entities: ["light.a", "light.b"] };
    el.requestUpdate();
    await settle(el);
    expect(press("+")).toBe(false);
  });
});

describe("card keys are remembered like any other touch", () => {
  const stored = () => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-view:")).map(([, v]) => JSON.parse(v));

  it("a turn by button is in storage the moment it settles", async () => {
    const el = await mount();
    q<HTMLButtonElement>(el, 'button[aria-label="Rotate right"]')!.click();
    await settle(el);
    expect(stored()[0].floors[0][1].rotation).toBe(45);
  });

  it("a zoom by key is in storage within 200 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    const el = await mount();
    hover(el);
    press("+");
    await vi.advanceTimersByTimeAsync(200);
    expect((stored()[0]?.floors as [string, { zoom?: number }][] | undefined)?.[0]?.[1].zoom).toBeGreaterThan(1);
  });
});

describe("rotate_switch: the pair follows the other controls unless the key says otherwise", () => {
  const btn = (el: FloorplanStudioCard, l: string) => q(el, `button[aria-label="${l}"]`);
  it("every config with zoom or the View dropdown draws the pair; no control at all draws none", async () => {
    for (const [cfg, want] of [
      [{}, true], [{ view: "2.5d" }, true], [{ zoom: false }, true], [{ view_switch: false }, true],
      [{ zoom: false, view_switch: false }, false], [{ kiosk: true }, false],
      [{ kiosk: true, rotate_switch: true }, true], [{ zoom: false, view_switch: false, rotate_switch: true }, true],
      [{ rotate_switch: false }, false], [{ rotate_switch: "yes" as never }, true],
    ] as const) {
      const el = await mount(cfg);
      expect(btn(el, "Rotate left") !== null, JSON.stringify(cfg)).toBe(want);
      el.remove();
    }
  });
});
