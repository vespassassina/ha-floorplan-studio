import { describe, expect, it, vi } from "vitest";
import { html, nothing, render } from "lit";
import { WINDOWS, windowOf, purgedFrom } from "../../src/card/replay/window";
import { barView, type BarModel } from "../../src/card/replay/bar";
import type { HistoryIndex, HistoryRow } from "../../src/card/replay/history";
import { keyMinute } from "../../src/card/card-replay";
import { t, tn } from "../../src/core/i18n";

// R2.5 (docs/specs/replay-2.md items 10, 11, 13): the window's length table, the keys over it, the purge span and what the bar draws from them.
const MIN = 60000, HOUR = 60 * MIN;

describe("the length table (item 10, item 11)", () => {
  it("offers 24 h and 48 h only, in that order (7 days waits for R2.7)", () => expect(WINDOWS.map((w) => w.hours)).toEqual([24, 48]));
  it("arrows move 5 minutes at 24 h and 10 at 48 h; pages one hour at both", () => {
    expect(windowOf(24)).toMatchObject({ arrow: 5, page: 60 });
    expect(windowOf(48)).toMatchObject({ arrow: 10, page: 60 });
  });
  it("an unknown length is the first one, never a throw", () => expect(windowOf(7).hours).toBe(24));
});

describe("keyMinute over a longer window", () => {
  const w = windowOf(48), max = w.hours * 60;
  const k = (key: string, v: number) => keyMinute(key, v, w.arrow, max, w.page);
  it("arrows move 10 minutes at 48 h, Page keys an hour", () => {
    expect(k("ArrowRight", 100)).toBe(110);
    expect(k("ArrowLeft", 100)).toBe(90);
    expect(k("PageUp", 100)).toBe(160);
    expect(k("PageDown", 100)).toBe(40);
  });
  it("the end is 2880 and nothing leaves the range", () => {
    expect(k("End", 5)).toBe(2880);
    expect(k("PageUp", 2870)).toBe(2880);
    expect(k("ArrowLeft", 3)).toBe(0);
  });
  it("the defaults are the 24 h bar's, so the old callers are unchanged", () => expect(keyMinute("ArrowRight", 100)).toBe(105));
});

describe("purgedFrom: where the recorder's history begins (item 13)", () => {
  const start = Date.UTC(2026, 9, 28, 12);
  const row = (lu: number): HistoryRow => ({ state: "on", attributes: {}, lu: lu / 1000, lc: lu / 1000 });
  const idx = (...firsts: number[][]): HistoryIndex => new Map(firsts.map((f, i) => [`e.${i}`, f.map(row)]));
  it("is the earliest first row when it starts later than the window", () => {
    expect(purgedFrom(idx([start + 12 * HOUR, start + 20 * HOUR], [start + 30 * HOUR]), start)).toBe(start + 12 * HOUR);
  });
  it("is null when any entity has its start state (the recorder kept the window)", () => {
    expect(purgedFrom(idx([start], [start + 30 * HOUR]), start)).toBeNull();
    expect(purgedFrom(idx([start - 5000]), start)).toBeNull();
  });
  it("one entity that is only new does not make a purge, but all of them late does", () => {
    expect(purgedFrom(idx([start], [start + 40 * HOUR]), start)).toBeNull();
    expect(purgedFrom(idx([start + 40 * HOUR], [start + 41 * HOUR]), start)).toBe(start + 40 * HOUR);
  });
  it("a first row within a minute of the start is jitter, not a purge", () => expect(purgedFrom(idx([start + 30000]), start)).toBeNull());
  it("an empty reply says nothing", () => expect(purgedFrom(new Map(), start)).toBeNull());
});

describe("the bar's length selector and purge grey", () => {
  const base: BarModel = { shown: "21:14", value: 700, max: 1440, hours: 24, ready: true, failed: false, playing: false, note: false, info: false, missing: 0, message: "", onsets: [], end: 2880 * MIN, width: 1000, at: 0 };
  const length = vi.fn();
  const handlers = { key() {}, play() {}, seek() {}, info() {}, close() {}, jump() {}, jumpBy() {}, length };
  const draw = (m: Partial<BarModel>) => { const host = document.createElement("div"); render(barView({ html, nothing, t, tn, close: "" }, { ...base, ...m }, handlers), host); return host; };
  const buttons = (h: HTMLElement) => [...h.querySelectorAll<HTMLButtonElement>(".fp-rp-len button")];

  it("a button per length, the chosen one pressed; a click asks for its hours", () => {
    const h = draw({});
    expect(buttons(h).map((b) => b.textContent!.trim())).toEqual(["24 h", "48 h"]);
    expect(buttons(h).map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    buttons(h)[1].click();
    expect(length).toHaveBeenCalledWith(48);
    expect(buttons(draw({ hours: 48, max: 2880 })).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });
  it("the group has a name", () => expect(draw({}).querySelector(".fp-rp-len")!.getAttribute("aria-label")).toBe("Window"));
  it("the slider's maximum is the window's minutes", () => expect(draw({ hours: 48, max: 2880 }).querySelector<HTMLInputElement>(".fp-rp-range")!.max).toBe("2880"));
  it("markers follow the window: the same onset sits half as far along a 48 h strip", () => {
    const end = 100 * HOUR, o = [{ entity: "e.1", t: end - 12 * HOUR, group: "lamp" as const, kind: "light" }];
    const x = (m: Partial<BarModel>) => parseFloat(draw({ end, onsets: o, ...m }).querySelector<HTMLElement>(".fp-rp-tick")!.style.left);
    const a = x({ hours: 24, max: 1440 }), b = x({ hours: 48, max: 2880 });
    expect(a).toBeCloseTo(500, 0);
    expect(b).toBeCloseTo(750, 0); // memo would keep 500 if the window were not in its key
  });
  it("no purge, no grey", () => expect(draw({}).querySelector(".fp-rp-purge")).toBeNull());
  it("a purge greys the strip from its start to where history begins, 12 h of 48 h is a quarter", () => {
    const end = 100 * HOUR;
    const grey = draw({ hours: 48, max: 2880, end, purgedFrom: end - 36 * HOUR }).querySelector<HTMLElement>(".fp-rp-purge")!;
    expect(grey.style.width).toBe("25%");
  });
  it("the info line says from when history is kept, with the date, in the card's language and clock", () => {
    const from = new Date(2026, 9, 27, 0, 0).getTime(), end = from + 36 * HOUR;
    const text = (hass: BarModel["hass"]) => draw({ hours: 48, max: 2880, end, info: true, purgedFrom: from, hass }).querySelector("[role=status]")!.textContent;
    expect(text({ language: "en", locale: { time_format: "24" } })).toMatch(/History is kept from .*27.*Oct.*00:00$|History is kept from .*Oct.*27.*00:00$/);
    expect(text({ language: "en", locale: { time_format: "12" } })).toMatch(/12:00\sAM$/);
  });
  it("a language the browser does not know is not a throw", () => {
    expect(() => draw({ info: true, purgedFrom: 1, hass: { language: "not a locale!!" } })).not.toThrow();
  });
});
