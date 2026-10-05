import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import type { RenderOpts } from "../../src/core/render";

// renderFloor is wrapped, not replaced (the same trick card.test.ts uses): the markup is real, and the test can read
// the `view` the card handed to core.
vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return { ...actual, renderFloor: vi.fn(actual.renderFloor) };
});
import { renderFloor } from "../../src/core";
import "../../src/card/floorplan-studio-card"; // defines the element
import type { FloorplanStudioCard, FloorplanStudioCardConfig } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;
const lastView = () => ((renderFloor as unknown as Mock).mock.calls.at(-1)![1] as RenderOpts).view;

async function mount(config: Partial<FloorplanStudioCardConfig> = {}): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout: structuredClone(L), floor: "ground", ...config } as FloorplanStudioCardConfig);
  await el.updateComplete;
  return el;
}
const select = (el: FloorplanStudioCard) => el.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="View"]');
const pick = async (el: FloorplanStudioCard, value: string) => {
  const s = select(el)!;
  s.value = value;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
};
const box = (el: FloorplanStudioCard) => el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number);
const click = async (el: FloorplanStudioCard, label: string) => {
  el.shadowRoot!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
  await el.updateComplete;
};

describe("card view option and dropdown", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is 2D with a View select in the toolbar, the zoom buttons in the stack, by default", async () => {
    const el = await mount();
    expect(lastView()).toBe("2d");
    const s = select(el)!;
    expect(s.value).toBe("2d");
    expect([...s.options].map((o) => [o.value, o.textContent!.trim()])).toEqual([["2d", "2D"], ["2.5d", "2.5D"], ["3d", "3D"]]);
    // Layout changed (card-stack): the select is in the toolbar, zoom is in the vertical stack, as in the studio.
    expect(s.closest(".fp-zoom")).not.toBeNull();
    expect(el.shadowRoot!.querySelector('button[aria-label="Zoom in"]')!.closest(".fp-stack")).not.toBeNull();
  });

  it("view: 2.5d starts in 2.5D and the select says so", async () => {
    const el = await mount({ view: "2.5d" });
    expect(lastView()).toBe("2.5d");
    expect(select(el)!.value).toBe("2.5d");
    expect(el.shadowRoot!.querySelector("svg .bs")).not.toBeNull(); // wall faces really are drawn
  });

  it("a junk view falls back to 2D, and does not throw", async () => {
    for (const v of ["", 2.5, null, {}, "2.5D", "3D", "4d"]) {
      const el = await mount({ view: v as never });
      expect(lastView(), String(v)).toBe("2d");
      expect(select(el)!.value).toBe("2d");
      el.remove();
    }
  });

  it("choosing 2.5D redraws the plan in 2.5D, and choosing 2D draws it flat again", async () => {
    const el = await mount();
    await pick(el, "2.5d");
    expect(lastView()).toBe("2.5d");
    expect(el.shadowRoot!.querySelector("svg .ws")).not.toBeNull();
    await pick(el, "2d");
    expect(lastView()).toBe("2d");
    expect(el.shadowRoot!.querySelector("svg .ws")).toBeNull();
  });

  it("ignores a value that is not an option", async () => {
    const el = await mount();
    const s = select(el)!;
    s.insertAdjacentHTML("beforeend", '<option value="3d">3D</option>');
    await pick(el, "3d");
    expect(lastView()).toBe("2d");
  });

  it("switching view keeps the zoom: the card stays zoomed in, and the zoomed box is narrower than the new fit", async () => {
    const el = await mount();
    await click(el, "Zoom in");
    const svg = el.shadowRoot!.querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("fp-zoomed");
    const zoomedFlat = box(el);
    await pick(el, "2.5d");
    expect(svg.getAttribute("class")).toContain("fp-zoomed");
    const zoomed = box(el);
    await click(el, "Fit");
    const fit25 = box(el);
    expect(zoomed[2]).toBeCloseTo(zoomedFlat[2]!, 6); // the zoom level itself did not move
    expect(zoomed[2]).toBeLessThan(fit25[2]!);
  });

  it("view_switch: false hides the select but keeps the configured view", async () => {
    const el = await mount({ view: "2.5d", view_switch: false });
    expect(select(el)).toBeNull();
    expect(lastView()).toBe("2.5d");
    expect(el.shadowRoot!.querySelector('button[aria-label="Zoom in"]')).not.toBeNull();
  });

  it("kiosk hides the select too, whatever view_switch says", async () => {
    const el = await mount({ kiosk: true, view_switch: true, view: "2.5d" });
    expect(select(el)).toBeNull();
    expect(lastView()).toBe("2.5d");
  });

  it("only view_switch: false hides it: junk keeps the default, shown", async () => {
    for (const v of ["no", 0, null, "false"]) {
      const el = await mount({ view_switch: v as never });
      expect(select(el), String(v)).not.toBeNull();
      el.remove();
    }
  });

  it("zoom: false still gets the select, and no zoom buttons", async () => {
    const el = await mount({ zoom: false });
    expect(select(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('button[aria-label="Zoom in"]')).toBeNull();
  });

  // Since the card remembers its view, the same config set again keeps the pick (card-view-memory.test.ts). A
  // config that differs in `rotation` is another card to the memory, so it starts from its own config.
  it("a new config puts the view back to the configured one", async () => {
    const el = await mount({ view: "2.5d" });
    await pick(el, "2d");
    expect(lastView()).toBe("2d");
    el.setConfig({ layout: structuredClone(L), floor: "ground", view: "2.5d", rotation: 90 } as FloorplanStudioCardConfig);
    await el.updateComplete;
    expect(lastView()).toBe("2.5d");
    expect(select(el)!.value).toBe("2.5d");
  });

  it("a hass update does not undo the pick", async () => {
    const el = await mount();
    await pick(el, "2.5d");
    el.hass = { states: {} } as never;
    await el.updateComplete;
    expect(lastView()).toBe("2.5d");
  });
});
