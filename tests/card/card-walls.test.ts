import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import type { RenderOpts } from "../../src/core/render";
import { WALLS_LABELS, WALLS_MODES } from "../../src/core/solids";

// Same wrapper as card-labels-tilt.test.ts: real markup, and the test reads what the card handed to core.
vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return { ...actual, renderFloor: vi.fn(actual.renderFloor) };
});
import { renderFloor } from "../../src/core";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, FloorplanStudioCardConfig } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;
const last = () => (renderFloor as unknown as Mock).mock.calls.at(-1)![1] as RenderOpts;

async function mount(config: Record<string, unknown> = {}): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout: structuredClone(L), floor: "ground", view: "2.5d", ...config } as FloorplanStudioCardConfig);
  await el.updateComplete;
  return el;
}
const select = (el: FloorplanStudioCard) => el.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="Walls"]');
const pick = async (el: FloorplanStudioCard, value: string) => {
  const s = select(el)!;
  s.value = value;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
};
const reset = (el: FloorplanStudioCard) => el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Reset view"]')!;
const stored = () => Object.keys(localStorage).filter((k) => k.startsWith("fp-view:")).map((k) => JSON.parse(localStorage.getItem(k)!));

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("card walls option", () => {
  it("is cut by default and passes the configured mode to renderFloor", async () => {
    await mount();
    expect(last().walls).toBe("cut");
    for (const m of WALLS_MODES) {
      localStorage.clear();
      await mount({ walls: m });
      expect(last().walls, m).toBe(m);
    }
  });

  it("junk config is cut (YAML is untrusted)", async () => {
    for (const v of ["FULL", "tall", "", 3, null, true, ["full"], { a: 1 }, "__proto__"]) {
      localStorage.clear();
      await mount({ walls: v });
      expect(last().walls, JSON.stringify(v)).toBe("cut");
    }
  });

  it("the select lists every mode with its label, and shows the current one", async () => {
    const el = await mount({ walls: "low" });
    const s = select(el)!;
    expect([...s.options].map((o) => [o.value, o.textContent!.trim()])).toEqual(WALLS_MODES.map((m) => [m, WALLS_LABELS[m]]));
    expect(s.value).toBe("low");
  });

  it("is in the toolbar next to the Tilt slider, in 2.5D only", async () => {
    const on = await mount();
    const tilt = on.shadowRoot!.querySelector('input[aria-label="Tilt"]')!;
    expect(select(on)!.previousElementSibling).toBe(tilt);
    const flat = await mount({ view: "2d" });
    expect(select(flat)).toBeNull();
  });

  it("a pick redraws with that mode and is stored at once", async () => {
    const el = await mount();
    await pick(el, "full");
    expect(last().walls).toBe("full");
    expect(stored().map((s) => s.walls)).toEqual(["full"]);
  });

  it("a junk pick is refused", async () => {
    const el = await mount();
    const s = select(el)!;
    s.add(new Option("x", "tall"));
    await pick(el, "tall");
    expect(last().walls).toBe("cut");
    expect(stored()).toEqual([]);
  });

  it("a stored mode is in force at the first render and wins over the config", async () => {
    const el = await mount({ walls: "low" });
    await pick(el, "full");
    document.body.innerHTML = "";
    const again = await mount({ walls: "low" });
    expect(last().walls).toBe("full");
    expect(select(again)!.value).toBe("full");
  });

  it("a hostile stored mode is dropped and the config stays in charge", async () => {
    const el = await mount({ walls: "low" });
    await pick(el, "full");
    const key = Object.keys(localStorage).find((k) => k.startsWith("fp-view:"))!;
    localStorage.setItem(key, JSON.stringify({ v: 1, walls: "tall", tilt: 0.2 }));
    document.body.innerHTML = "";
    await mount({ walls: "low" });
    expect(last().walls).toBe("low");
  });

  it("Reset view returns to the config's mode and clears the stored one", async () => {
    const el = await mount({ walls: "low" });
    await pick(el, "full");
    expect(reset(el).disabled).toBe(false);
    reset(el).click();
    await el.updateComplete;
    expect(last().walls).toBe("low");
    expect(stored()).toEqual([]);
  });
});
