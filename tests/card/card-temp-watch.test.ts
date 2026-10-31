import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";

// S42.4 (docs/specs/temp-range.md, decision 8): the card keeps when each room went out of range, in memory, and fills `_tempWarn`
// once a room has been out for the hold. The state shape is what HA sends (state text, attributes, last_changed), as in
// card-temp-attention.test.ts. The clock is faked; spies are restored before the clock (CLAUDE.md finding 15).
const st = (state: string) => ({ state, attributes: { unit_of_measurement: "°C" }, last_changed: "2026-10-31T09:30:15Z" });
const MIN = 60_000;
const ROOM = "room-ground-2"; // the demo's Kitchen

function mount(hold?: number) {
  const layout = structuredClone(demo) as any;
  layout.tempRange = { min: 17, max: 26, ...(hold === undefined ? {} : { hold }) };
  Object.assign(layout.floors.ground.rooms[1], { temps: ["sensor.k"] });
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout, floor: "ground" } as never);
  return el;
}
const push = async (el: FloorplanStudioCard, v: string) => {
  el.hass = { states: { "sensor.k": st(v) }, themes: { darkMode: false } } as never;
  await vi.advanceTimersByTimeAsync(0);
};

describe("S42.4 the card's onset memory", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

  it("a reading out for under the hold does not warn", async () => {
    const el = mount();
    await push(el, "27.4");
    await vi.advanceTimersByTimeAsync(5 * MIN - 1000);
    expect(el._tempWarn).toBeUndefined();
  });

  it("warns once the hold has elapsed even though no new state arrives, and the plan draws it", async () => {
    const el = mount();
    await push(el, "27.4");
    await vi.advanceTimersByTimeAsync(5 * MIN + 100);
    expect(el._tempWarn).toEqual({ [ROOM]: "hot" });
    expect(el.shadowRoot!.querySelector(`svg polygon.temp-wash-hot`)).not.toBeNull();
  });

  it("clears at once when the reading is back inside the band", async () => {
    const el = mount(0);
    await push(el, "27.4");
    expect(el._tempWarn).toEqual({ [ROOM]: "hot" });
    await push(el, "25.4");
    expect(el._tempWarn).toBeUndefined();
    expect(el.shadowRoot!.querySelector("svg .temp-wash-hot")).toBeNull();
  });

  it("a hass update with the room still out keeps the onset and the same object", async () => {
    const el = mount();
    await push(el, "27.4");
    await vi.advanceTimersByTimeAsync(3 * MIN);
    await push(el, "27.9"); // not a new onset
    await vi.advanceTimersByTimeAsync(2 * MIN + 100);
    expect(el._tempWarn).toEqual({ [ROOM]: "hot" });
  });

  it("a reading back in for one sample resets the onset", async () => {
    const el = mount();
    await push(el, "27.4");
    await vi.advanceTimersByTimeAsync(4 * MIN);
    await push(el, "25"); // inside the band
    await push(el, "27.4");
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(el._tempWarn).toBeUndefined();
  });

  it("the re-check timer is gone once the card is removed", async () => {
    const el = mount();
    await push(el, "27.4");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    el.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
