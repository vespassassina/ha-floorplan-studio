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

// The keys of the card: arrows zoom and rotate, Space resets. Who is listening is the point of these tests: the
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
  it("Up zooms in, Down zooms out", async () => {
    const el = await mount();
    hover(el);
    const w0 = vbW(el);
    expect(press("ArrowUp")).toBe(true);
    await settle(el);
    const w1 = vbW(el);
    expect(w1).toBeLessThan(w0);
    press("ArrowUp");
    await settle(el);
    expect(vbW(el)).toBeLessThan(w1);
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    await settle(el);
    expect(vbW(el)).toBeGreaterThan(w0); // zooming out past fit is allowed down to MIN_ZOOM
  });

  it("Left and Right turn the plan 45 degrees either way; the steps wrap", async () => {
    const el = await mount();
    hover(el);
    press("ArrowRight");
    await settle(el);
    expect(deg()).toBe(45);
    press("ArrowLeft");
    press("ArrowLeft");
    await settle(el);
    expect(deg()).toBe(315);
  });

  it("Space is Reset view: zoom, turn, view and theme back to the config's", async () => {
    const el = await mount();
    hover(el);
    const w0 = vbW(el);
    press("ArrowUp");
    press("ArrowRight");
    await settle(el);
    expect(vbW(el)).not.toBe(w0);
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

  it("zoom: false: the zoom keys do nothing and the rotation keys still turn; view_switch: false: the other way round", async () => {
    const noZoom = await mount({ zoom: false });
    hover(noZoom);
    const w0 = vbW(noZoom);
    expect(press("ArrowUp")).toBe(false);
    expect(vbW(noZoom)).toBe(w0);
    press("ArrowRight");
    await settle(noZoom);
    expect(deg()).toBe(45);
    noZoom.remove();
    const noSwitch = await mount({ view_switch: false });
    hover(noSwitch);
    expect(press("ArrowRight")).toBe(true); // the rotate buttons are there without the View dropdown, so are the keys
    expect(press("ArrowUp")).toBe(true);
    noSwitch.remove();
    const noRotate = await mount({ rotate_switch: false });
    hover(noRotate);
    expect(press("ArrowRight")).toBe(false);
    expect(press("ArrowUp")).toBe(true);
  });

  it("kiosk draws no controls and takes no rotation or reset keys", async () => {
    const el = await mount({ kiosk: true });
    hover(el);
    expect(press("ArrowLeft")).toBe(false);
    expect(press(" ")).toBe(false);
  });

  it("other keys and Ctrl/Cmd chords pass", async () => {
    const el = await mount();
    hover(el);
    expect(press("a")).toBe(false);
    expect(press("ArrowUp", document.body, { ctrlKey: true })).toBe(false);
    expect(press("ArrowLeft", document.body, { metaKey: true })).toBe(false);
  });
});

describe("card keys: which card listens", () => {
  it("a card nobody points at or focused ignores the keys", async () => {
    const el = await mount();
    const w0 = vbW(el);
    expect(press("ArrowUp")).toBe(false);
    await settle(el);
    expect(vbW(el)).toBe(w0);
  });

  it("the pointer leaving ends it", async () => {
    const el = await mount();
    hover(el);
    leave(el);
    expect(press("ArrowUp")).toBe(false);
  });

  it("with two cards only the one under the pointer moves", async () => {
    const a = await mount();
    const b = await mount();
    const [wa, wb] = [vbW(a), vbW(b)];
    hover(b);
    press("ArrowUp");
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
    press("ArrowUp");
    await settle(a);
    await settle(b);
    expect(vbW(a)).toBe(wa);
    expect(vbW(b)).toBeLessThan(wb);
  });

  it("a focused card needs no pointer", async () => {
    const el = await mount();
    el.focus();
    const w0 = vbW(el);
    press("ArrowUp");
    await settle(el);
    expect(vbW(el)).toBeLessThan(w0);
  });

  it("a card taken off the page stops listening", async () => {
    const el = await mount();
    hover(el);
    el.remove();
    expect(press("ArrowUp")).toBe(false);
  });
});

describe("card keys: what they never take", () => {
  it("keys typed into a field elsewhere on the page, under the hovered card, are left alone", async () => {
    const el = await mount();
    hover(el);
    for (const tag of ["input", "textarea", "select"]) {
      const f = document.createElement(tag);
      document.body.appendChild(f);
      expect(press("ArrowUp", f), tag).toBe(false);
      expect(press("ArrowLeft", f), tag).toBe(false);
      expect(press(" ", f), tag).toBe(false);
    }
  });

  it("a range slider keeps its arrows: the Tilt slider in the card's own toolbar", async () => {
    const el = await mount({ view: "2.5d" });
    hover(el);
    const tilt = q<HTMLInputElement>(el, 'input[type="range"][aria-label="Tilt"]')!;
    expect(press("ArrowLeft", tilt)).toBe(false);
    expect(press("ArrowUp", tilt)).toBe(false);
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
    expect(press("ArrowRight", labels)).toBe(true);
    await settle(el);
    expect(deg()).toBe(45);
  });

  it("an open dialog keeps the keys", async () => {
    const el = await mount();
    hover(el);
    (el as unknown as { _chooserDialog: unknown })._chooserDialog = { title: "x", entities: ["light.a", "light.b"] };
    el.requestUpdate();
    await settle(el);
    expect(press("ArrowUp")).toBe(false);
  });
});

describe("card keys are remembered like any other touch", () => {
  const stored = () => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-view:")).map(([, v]) => JSON.parse(v));

  it("a turn by key is in storage the moment it settles", async () => {
    const el = await mount();
    hover(el);
    press("ArrowRight");
    await settle(el);
    expect(stored()[0].floors[0][1].rotation).toBe(45);
  });

  it("a zoom by key is in storage within 200 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    const el = await mount();
    hover(el);
    press("ArrowUp");
    await vi.advanceTimersByTimeAsync(200);
    expect((stored()[0]?.floors as [string, { zoom?: number }][] | undefined)?.[0]?.[1].zoom).toBeGreaterThan(1);
  });
});

describe("rotate_switch: the pair and Left/Right follow the other controls unless the key says otherwise", () => {
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
      hover(el);
      expect(press("ArrowRight"), `key ${JSON.stringify(cfg)}`).toBe(want);
      el.remove();
    }
  });
});
