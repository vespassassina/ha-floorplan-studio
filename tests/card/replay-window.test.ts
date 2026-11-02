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
  it("offers 24 h, 48 h and 7 days, in that order (R2.7: the gate passed, docs/DECISIONS.md)", () => expect(WINDOWS.map((w) => w.hours)).toEqual([24, 48, 168]));
  it("arrows move 5 minutes at 24 h, 10 at 48 h and 30 at 7 days; pages one hour, one hour, six hours (item 11)", () => {
    expect(windowOf(24)).toMatchObject({ arrow: 5, page: 60 });
    expect(windowOf(48)).toMatchObject({ arrow: 10, page: 60 });
    expect(windowOf(168)).toMatchObject({ arrow: 30, page: 360 });
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

describe("keyMinute over 7 days", () => {
  const w = windowOf(168), max = w.hours * 60;
  const k = (key: string, v: number) => keyMinute(key, v, w.arrow, max, w.page);
  it("arrows move 30 minutes, Page keys six hours", () => {
    expect(k("ArrowRight", 1000)).toBe(1030);
    expect(k("ArrowLeft", 1000)).toBe(970);
    expect(k("PageUp", 1000)).toBe(1360);
    expect(k("PageDown", 1000)).toBe(640);
  });
  it("the end is 10080 and nothing leaves the range", () => {
    expect(k("End", 5)).toBe(10080);
    expect(k("PageUp", 9900)).toBe(10080);
    expect(k("ArrowLeft", 20)).toBe(0);
  });
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
    expect(buttons(h).map((b) => b.textContent!.trim())).toEqual(["24 h", "48 h", "7 d"]);
    expect(buttons(h).map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    buttons(h)[1].click();
    expect(length).toHaveBeenCalledWith(48);
    buttons(h)[2].click();
    expect(length).toHaveBeenCalledWith(168);
    expect(buttons(draw({ hours: 48, max: 2880 })).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(buttons(draw({ hours: 168, max: 10080 })).map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
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
  it("past 48 h the time carries its date, not its weekday: the first and last moment of 7 days share a weekday and a clock time", () => {
    const end = new Date(2026, 9, 28, 12).getTime(), hass = { language: "en", locale: { language: "en", time_format: "24" } };
    const text = (hours: number, at: number) => draw({ hours, max: hours * 60, end, at, shown: "12:00", hass }).querySelector(".fp-rp-time")!.textContent!;
    const first = text(168, new Date(2026, 9, 21, 12).getTime()), last = text(168, end);
    expect(first).not.toBe(last);
    expect(first).toMatch(/21.*Oct.*12:00|Oct.*21.*12:00/);
    expect(last).toMatch(/28.*Oct.*12:00|Oct.*28.*12:00/);
    expect(text(48, end)).toMatch(/^\w{3} 12:00$/); // 48 h keeps its weekday (Diego, 2026-11-01)
    expect(text(24, end)).toBe("12:00");
  });
  it("the 12 hour clock is kept in the date form", () => {
    const hass = { language: "en", locale: { language: "en", time_format: "12" } };
    expect(draw({ hours: 168, max: 10080, end: new Date(2026, 9, 28, 12).getTime(), at: new Date(2026, 9, 28, 12).getTime(), hass }).querySelector(".fp-rp-time")!.textContent).toMatch(/12:00\sPM$/);
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
