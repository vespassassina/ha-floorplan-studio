import { describe, expect, it, vi } from "vitest";
import { html, nothing, render } from "lit";
import { neighbour, type EventGroup, type Onset } from "../../src/card/replay/events";
import { barView, eventSaid, type BarModel } from "../../src/card/replay/bar";
import { t, tn } from "../../src/core/i18n";

// R2.4 (docs/specs/replay-2.md item 9, criterion 7): the pure search for the previous and next onset, and what the bar draws from it.
const on = (tt: number, group: EventGroup = "lamp", kind = "light", entity = `e.${tt}`): Onset => ({ entity, t: tt, group, kind });
const list = [on(100), on(200, "motion", "motion"), on(300, "opening", "door"), on(400, "alarm", "alarm")];

describe("neighbour: the nearest onset strictly before or after a moment (item 9)", () => {
  it("next is the first onset after, previous the last before", () => {
    expect(neighbour(list, 250, 1)?.t).toBe(300);
    expect(neighbour(list, 250, -1)?.t).toBe(200);
  });
  it("a moment equal to an onset is not a jump to that onset, either way", () => {
    expect(neighbour(list, 200, 1)?.t).toBe(300);
    expect(neighbour(list, 200, -1)?.t).toBe(100);
  });
  it("the ends return nothing", () => {
    expect(neighbour(list, 400, 1)).toBeUndefined();
    expect(neighbour(list, 100, -1)).toBeUndefined();
    expect(neighbour(list, 99, -1)).toBeUndefined();
    expect(neighbour([], 5, 1)).toBeUndefined();
  });
  it("motion counts (it is a group like the others)", () => expect(neighbour(list, 100, 1)?.group).toBe("motion"));
  it("a predicate that rejects a group skips its onsets, either way", () => {
    const noMotion = (o: Onset) => o.group !== "motion";
    expect(neighbour(list, 100, 1, noMotion)?.t).toBe(300);
    expect(neighbour(list, 300, -1, noMotion)?.t).toBe(100);
    expect(neighbour(list, 100, 1, (o) => o.group === "motion")?.t).toBe(200);
  });
  it("a predicate that rejects everything is the end", () => expect(neighbour(list, 0, 1, () => false)).toBeUndefined());
  it("two onsets at one moment: next skips both, previous takes the later of the list", () => {
    const two = [on(100), on(200, "lamp", "light", "e.a"), on(200, "alarm", "alarm", "e.b"), on(300)];
    expect(neighbour(two, 100, 1)?.entity).toBe("e.a");
    expect(neighbour(two, 200, 1)?.t).toBe(300);
    expect(neighbour(two, 300, -1)?.t).toBe(200);
    expect(neighbour(two, 200, -1)?.t).toBe(100);
  });
});

describe("eventSaid: what happened, in words", () => {
  it("names a lamp, motion, a door, a cover, a lock and an alarm", () => {
    expect(eventSaid(t, on(1))).toBe("light on");
    expect(eventSaid(t, on(1, "motion", "room"))).toBe("motion");
    expect(eventSaid(t, on(1, "opening", "door"))).toBe("door opened");
    expect(eventSaid(t, on(1, "opening", "contact"))).toBe("door opened");
    expect(eventSaid(t, on(1, "opening", "cover"))).toBe("cover opened");
    expect(eventSaid(t, on(1, "opening", "lock"))).toBe("unlocked");
    expect(eventSaid(t, on(1, "alarm", "siren"))).toBe("alarm");
  });
});

describe("the bar's jump buttons and value text", () => {
  const MIN = 60000;
  const base: BarModel = { shown: "21:14", value: 700, max: 1440, hours: 24, ready: true, failed: false, playing: false, note: false, info: false, missing: 0, message: "", onsets: [], end: 1440 * MIN, width: 1000, at: 0 };
  const jumpBy = vi.fn();
  const handlers = { key() {}, play() {}, seek() {}, info() {}, close() {}, jump() {}, jumpBy, length() {} };
  const draw = (m: Partial<BarModel>) => { const host = document.createElement("div"); render(barView({ html, nothing, t, tn, close: "" }, { ...base, ...m }, handlers), host); return host; };
  const prev = (h: HTMLElement) => h.querySelector<HTMLButtonElement>(".fp-rp-prev")!;
  const next = (h: HTMLElement) => h.querySelector<HTMLButtonElement>(".fp-rp-next")!;
  const range = (h: HTMLElement) => h.querySelector<HTMLInputElement>(".fp-rp-range")!;

  it("two buttons with names; both enabled between onsets, each calls jumpBy with its way", () => {
    const h = draw({ onsets: [on(100), on(300)], at: 200 });
    expect(prev(h).getAttribute("aria-label")).toBe("Previous event");
    expect(next(h).getAttribute("aria-label")).toBe("Next event");
    expect([prev(h).disabled, next(h).disabled]).toEqual([false, false]);
    prev(h).click(); next(h).click();
    expect(jumpBy.mock.calls).toEqual([[-1], [1]]);
  });
  it("previous is disabled at the first onset and before it; next at the last onset and after it", () => {
    const o = [on(100), on(300)];
    expect([prev(draw({ onsets: o, at: 100 })).disabled, next(draw({ onsets: o, at: 100 })).disabled]).toEqual([true, false]);
    expect([prev(draw({ onsets: o, at: 300 })).disabled, next(draw({ onsets: o, at: 300 })).disabled]).toEqual([false, true]);
    expect([prev(draw({ onsets: o, at: 50 })).disabled, next(draw({ onsets: o, at: 50 })).disabled]).toEqual([true, false]);
    expect([prev(draw({ onsets: [], at: 50 })).disabled, next(draw({ onsets: [], at: 50 })).disabled]).toEqual([true, true]);
  });
  it("both are disabled until the history is there", () => {
    const h = draw({ ready: false, onsets: [on(100), on(300)], at: 200 });
    expect([prev(h).disabled, next(h).disabled]).toEqual([true, true]);
  });
  it("the value text is the time alone between events, and the time and the event on one", () => {
    const o = [on(100, "opening", "door"), on(300)];
    expect(range(draw({ onsets: o, at: 200 })).getAttribute("aria-valuetext")).toBe("21:14");
    expect(range(draw({ onsets: o, at: 100 })).getAttribute("aria-valuetext")).toBe("21:14, door opened");
    expect(range(draw({ onsets: o, at: 300 })).getAttribute("aria-valuetext")).toBe("21:14, light on");
  });
});
