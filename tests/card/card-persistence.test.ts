import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { THEMES } from "../../src/core";
import { parseStoredView } from "../../src/card/view-state";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, FloorplanStudioCardConfig } from "../../src/card/floorplan-studio-card";

// What the card writes, and when: the field report was a view that resets on every dashboard reload.

const L = demo as unknown as Layout;
function mockMotion() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}
async function mount(config: Partial<FloorplanStudioCardConfig> = {}): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout: structuredClone(L), ...config } as FloorplanStudioCardConfig);
  await el.updateComplete;
  return el;
}
const q = <T extends Element>(el: FloorplanStudioCard, sel: string) => el.shadowRoot!.querySelector<T>(sel);
const click = async (el: FloorplanStudioCard, sel: string) => { q<HTMLButtonElement>(el, sel)!.click(); await el.updateComplete; };
const stored = () => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-view:")).map(([, v]) => JSON.parse(v) as Record<string, unknown>);
const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });

beforeEach(() => { localStorage.clear(); mockMotion(); });
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks(); // spies first, then the clock (CLAUDE.md finding 15)
  vi.useRealTimers();
  localStorage.clear();
});

describe("the floor is remembered", () => {
  it("a card that switches floors (no floor pinned) comes back on the floor it was left on", async () => {
    const a = await mount();
    const first = q<HTMLButtonElement>(a, ".fp-floors button:nth-child(2)")!;
    expect(first.getAttribute("aria-pressed")).toBe("false");
    first.click();
    await a.updateComplete;
    a.remove(); // leaving flushes the save
    expect(stored()[0]?.floor).toBeTruthy();
    const b = await mount();
    expect(q(b, ".fp-floors button:nth-child(2)")!.getAttribute("aria-pressed")).toBe("true");
    expect(q(b, ".fp-floors button:nth-child(1)")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("a remembered floor the layout no longer has is ignored, not an error", async () => {
    const a = await mount();
    q<HTMLButtonElement>(a, ".fp-floors button:nth-child(2)")!.click();
    await a.updateComplete;
    a.remove();
    const [key] = Object.keys(localStorage).filter((k) => k.startsWith("fp-view:"));
    localStorage.setItem(key!, JSON.stringify({ v: 1, floor: "attic-that-is-gone" }));
    const b = await mount();
    expect(q(b, ".fp-floors button:nth-child(1)")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("parseStoredView keeps a floor string and drops junk", () => {
    const ok = () => true;
    expect(parseStoredView({ floor: "first" }, ok, THEMES).floor).toBe("first");
    for (const bad of [5, null, "", ["a"], {}, "x".repeat(201)]) expect(parseStoredView({ floor: bad }, ok, THEMES).floor, JSON.stringify(bad)).toBeUndefined();
  });
});

describe("every touch is written soon", () => {
  it("a zoom button press is in storage after 150 ms, with no page event needed", async () => {
    fakeClock();
    const el = await mount({ floor: "ground" });
    await click(el, 'button[aria-label="Zoom in"]');
    expect(stored()).toEqual([]); // debounced: a burst writes once
    await vi.advanceTimersByTimeAsync(150);
    expect(stored()[0]?.zoom).toBeGreaterThan(1);
  });

  it("a hidden page flushes at once: a tab discarded in the background never fires pagehide", async () => {
    fakeClock();
    const el = await mount({ floor: "ground" });
    await click(el, 'button[aria-label="Zoom in"]');
    expect(stored()).toEqual([]);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    delete (document as unknown as Record<string, unknown>).visibilityState;
    expect(stored()[0]?.zoom).toBeGreaterThan(1);
  });

  it("a visible page does not write on visibilitychange", async () => {
    fakeClock();
    const el = await mount({ floor: "ground" });
    await click(el, 'button[aria-label="Zoom in"]');
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stored()).toEqual([]);
  });

  it("theme, view, tilt and labels are written the moment they are touched", async () => {
    const el = await mount({ floor: "ground", theme: "terminal", view: "2.5d", tilt: 0.3 });
    const theme = q<HTMLSelectElement>(el, 'select[aria-label="Theme"]')!;
    theme.value = "light";
    theme.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    expect(stored()[0]?.theme).toBe("light");
    await click(el, 'button[aria-label="Labels"]');
    expect(stored()[0]?.labels).toBe(false);
    const view = q<HTMLSelectElement>(el, 'select[aria-label="View"]')!;
    view.value = "2d";
    view.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    expect(stored()[0]?.view).toBe("2d");
  });
});

describe("the stored view wins over the config, and Reset view gives the config back", () => {
  it("a config that sets theme and view, picked over, comes back as picked after setConfig with a new equal object", async () => {
    const cfg = { floor: "ground", theme: "terminal", view: "2.5d", tilt: 0.3 } as const;
    const el = await mount(cfg);
    const theme = q<HTMLSelectElement>(el, 'select[aria-label="Theme"]')!;
    theme.value = "light";
    theme.dispatchEvent(new Event("change", { bubbles: true }));
    await click(el, 'button[aria-label="Rotate right"]');
    el.setConfig({ layout: structuredClone(L), ...cfg } as FloorplanStudioCardConfig); // HA calls it again on a re-render
    await el.updateComplete;
    expect(q<HTMLSelectElement>(el, 'select[aria-label="Theme"]')!.value).toBe("light");
    expect(el.getAttribute("data-theme")).toBe("light");
    await click(el, 'button[aria-label="Reset view"]');
    expect(el.getAttribute("data-theme")).toBe("terminal");
    expect(stored()).toEqual([]);
  });

  it("storage that throws (private mode) is silent: the card works from its config", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const el = await mount({ floor: "ground" });
    await click(el, 'button[aria-label="Rotate right"]');
    expect(q(el, "svg")).not.toBeNull();
  });
});
