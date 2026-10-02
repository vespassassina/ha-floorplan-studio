import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import type { RenderOpts } from "../../src/core/render";

// Same wrapper as card-view.test.ts: real markup, and the test reads what the card handed to core.
vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return { ...actual, renderFloor: vi.fn(actual.renderFloor) };
});
import { renderFloor } from "../../src/core";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, FloorplanStudioCardConfig } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;
const last = () => (renderFloor as unknown as Mock).mock.calls.at(-1)![1] as RenderOpts;

async function mount(config: Partial<FloorplanStudioCardConfig> = {}): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout: structuredClone(L), floor: "ground", ...config } as FloorplanStudioCardConfig);
  await el.updateComplete;
  return el;
}
const slider = (el: FloorplanStudioCard) => el.shadowRoot!.querySelector<HTMLInputElement>('input[type="range"][aria-label="Tilt"]');
const drag = async (el: FloorplanStudioCard, value: string) => {
  const s = slider(el)!;
  s.value = value;
  s.dispatchEvent(new Event("input", { bubbles: true }));
  await el.updateComplete;
};
const box = (el: FloorplanStudioCard) => el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("card labels option", () => {
  it("shows text by default, and labels: false draws none", async () => {
    const on = await mount();
    expect(last().labels).not.toBe(false);
    expect(on.shadowRoot!.querySelector("svg text")).not.toBeNull();
    const off = await mount({ labels: false });
    expect(last().labels).toBe(false);
    expect(off.shadowRoot!.querySelector("svg text")).toBeNull();
    expect(off.shadowRoot!.querySelector("svg [data-x]")).not.toBeNull(); // icons stay
  });

  it("junk is true: only a real false hides", async () => {
    for (const v of ["false", 0, null, "no", {}, []]) {
      const el = await mount({ labels: v as never });
      expect(last().labels, String(v)).not.toBe(false);
      expect(el.shadowRoot!.querySelector("svg text"), String(v)).not.toBeNull();
      el.remove();
    }
  });
});

describe("card tilt option and slider", () => {
  it("has no slider in 2D; in 2.5D the slider starts at the default 0.5 and renders with it", async () => {
    expect(slider(await mount())).toBeNull();
    const el = await mount({ view: "2.5d" });
    expect(slider(el)).not.toBeNull();
    expect(Number(slider(el)!.value)).toBe(0.5);
    expect(last().tilt).toBe(0.5);
  });

  it("config tilt sets it, clamped; junk is the default", async () => {
    await mount({ view: "2.5d", tilt: 0.8 });
    expect(last().tilt).toBe(0.8);
    await mount({ view: "2.5d", tilt: 9 });
    expect(last().tilt).toBe(1);
    await mount({ view: "2.5d", tilt: -2 });
    expect(last().tilt).toBe(0);
    for (const v of ["0.2", NaN, null, {}]) {
      await mount({ view: "2.5d", tilt: v as never });
      expect(last().tilt, String(v)).toBe(0.5);
    }
  });

  it("the slider has a range of 0..1 and changes the render and the box, not the zoom", async () => {
    const el = await mount({ view: "2.5d" });
    const s = slider(el)!;
    expect([s.min, s.max].map(Number)).toEqual([0, 1]);
    const before = el.shadowRoot!.querySelector("svg")!.innerHTML, boxBefore = box(el);
    await drag(el, "1");
    expect(last().tilt).toBe(1);
    expect(el.shadowRoot!.querySelector("svg")!.innerHTML).not.toBe(before);
    expect(box(el)[1]).toBeLessThan(boxBefore[1]!); // steeper: the box reaches higher
    await drag(el, "0");
    expect(last().tilt).toBe(0);
  });

  it("dragging keeps the zoom", async () => {
    const el = await mount({ view: "2.5d" });
    el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click();
    await el.updateComplete;
    const w = box(el)[2]!;
    await drag(el, "0.9");
    expect(el.shadowRoot!.querySelector("svg")!.getAttribute("class")).toContain("fp-zoomed");
    expect(box(el)[2]).toBeCloseTo(w, 6);
  });

  it("switching to 2D hides the slider and the tilt stays put for when 2.5D comes back", async () => {
    const el = await mount({ view: "2.5d" });
    await drag(el, "0.2");
    const s = el.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="View"]')!;
    s.value = "2d";
    s.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    expect(slider(el)).toBeNull();
    s.value = "2.5d";
    s.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    expect(Number(slider(el)!.value)).toBe(0.2);
  });

  it("view_switch false and kiosk hide the slider", async () => {
    expect(slider(await mount({ view: "2.5d", view_switch: false }))).toBeNull();
    expect(slider(await mount({ view: "2.5d", kiosk: true }))).toBeNull();
  });

  it("the slider sits in the same group as the select, also when zoom is off", async () => {
    const el = await mount({ view: "2.5d", zoom: false });
    expect(slider(el)!.closest(".fp-viewonly")).toBe(el.shadowRoot!.querySelector('select[aria-label="View"]')!.closest(".fp-viewonly"));
  });
});
