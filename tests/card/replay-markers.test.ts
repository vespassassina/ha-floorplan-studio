import { describe, expect, it, vi } from "vitest";
import { html, nothing, render } from "lit";
import { clusters, motionBuckets, TICK_GAP_PX, MOTION_BUCKETS } from "../../src/card/replay/markers";
import { barView, type BarModel } from "../../src/card/replay/bar";
import type { Onset, EventGroup } from "../../src/card/replay/events";
import { t, tn } from "../../src/core/i18n";

// R2.3 (docs/specs/replay-2.md items 5 to 8, criteria 5 and 12). A window of 1000 ms over a bar 1000 px wide puts an onset at t ms on x = t px.
const on = (tt: number, group: EventGroup = "lamp", entity = `e.${tt}`): Onset => ({ entity, t: tt, group, kind: group });
const win = { start: 0, end: 1000 };

describe("clusters: ticks closer than 6 px merge (criterion 5)", () => {
  const four = [on(0), on(5), on(7), on(20)];
  it("ticks at 0, 5, 7 and 20 px give two clusters, the first of three, at the first tick's x", () => {
    const c = clusters(four, win.start, win.end, 1000);
    expect(c.map((k) => k.size)).toEqual([3, 1]);
    expect(c[0].x).toBe(0);
    expect(c[0].first.t).toBe(0);
    expect(c[1].x).toBe(20);
  });
  it("at a wider bar the same events split", () => {
    const c = clusters(four, win.start, win.end, 2000); // x = 0, 10, 14, 40
    expect(c.map((k) => k.size)).toEqual([1, 2, 1]);
  });
  it("6 px apart is two, 5.9 px is one (the gap is a constant)", () => {
    expect(TICK_GAP_PX).toBe(6);
    expect(clusters([on(0), on(6)], 0, 1000, 1000)).toHaveLength(2);
    expect(clusters([on(0), on(5.9)], 0, 1000, 1000)).toHaveLength(1);
  });
  it("an alarm among lamps colours the cluster alarm; an opening among lamps, opening; the first onset in time is the target", () => {
    expect(clusters([on(3), on(1, "alarm"), on(2, "opening")], 0, 1000, 1000)[0]).toMatchObject({ group: "alarm", size: 3, first: { t: 1 } });
    expect(clusters([on(2), on(1, "opening")], 0, 1000, 1000)[0].group).toBe("opening");
    expect(clusters([on(2), on(1)], 0, 1000, 1000)[0].group).toBe("lamp");
  });
  it("counts the members by group, for the tooltip", () => {
    expect(clusters([on(0), on(1), on(2, "opening"), on(3, "alarm")], 0, 1000, 1000)[0].n).toEqual({ lamp: 2, opening: 1, alarm: 1 });
  });
  it("the height is 8, 12 or 16 px for 1, 2 to 4, or 5 and more", () => {
    const h = (n: number) => clusters(Array.from({ length: n }, (_, i) => on(i * 0.1)), 0, 1000, 1000)[0].height;
    expect([h(1), h(2), h(4), h(5), h(9)]).toEqual([8, 12, 12, 16, 16]);
  });
  it("motion is not a tick; onsets outside the window are not drawn; input order does not matter", () => {
    const c = clusters([on(500, "motion"), on(-1), on(1001), on(300), on(100)], 0, 1000, 1000);
    expect(c.map((k) => k.first.t)).toEqual([100, 300]);
  });
  it("a window of no length or a bar of no width gives nothing, not NaN", () => {
    expect(clusters([on(5)], 10, 10, 1000)).toEqual([]);
    expect(clusters([on(5)], 0, 10, 0)).toEqual([]);
  });
});

describe("motionBuckets: the band's darkness follows the count of motion onsets", () => {
  it("counts only motion onsets, in the bucket of their time", () => {
    const b = motionBuckets([on(0, "motion"), on(1, "motion"), on(2, "motion"), on(999, "motion"), on(500, "lamp"), on(1000, "motion")], 0, 1000);
    expect(b).toHaveLength(MOTION_BUCKETS);
    expect(b[0]).toBe(3);
    expect(b[MOTION_BUCKETS - 1]).toBe(1);
    expect(b.reduce((a, c) => a + c, 0)).toBe(4); // the lamp and the onset at the very end (not in the window) are not counted
  });
  it("is all zero for a window of no length", () => expect(motionBuckets([on(5, "motion")], 10, 10).every((c) => c === 0)).toBe(true));
});

describe("the strip in the bar (items 5, 6, 8)", () => {
  const base: BarModel = { shown: "12:00", value: 1440, max: 1440, ready: true, failed: false, playing: false, note: false, info: false, missing: 0, message: "", onsets: [], end: 1440 * 60000, width: 1000 };
  const handlers = { key() {}, play() {}, seek() {}, info() {}, close() {}, jump: vi.fn() };
  const draw = (m: Partial<BarModel>) => { const host = document.createElement("div"); render(barView({ html, nothing, t, tn, close: "" }, { ...base, ...m }, handlers), host); return host; };
  it("a cluster's tooltip names what it holds, by group", () => {
    const host = draw({ onsets: [on(0), on(1), on(2), on(3, "opening")] });
    expect(host.querySelector(".fp-rp-tick")?.getAttribute("title")).toBe("3 lamps, 1 door or window");
  });
  it("the strip is an image with the totals as its name", () => {
    const host = draw({ onsets: [on(0), on(100, "opening"), on(200, "alarm"), on(300, "motion", "b.a"), on(400, "motion", "b.b")] });
    const s = host.querySelector(".fp-rp-strip")!;
    expect(s.getAttribute("role")).toBe("img");
    expect(s.getAttribute("aria-label")).toBe("1 lamp, 1 door or window, 1 alarm, motion on 2 sensors");
  });
  it("no events say so; the strip is not drawn before the history is there", () => {
    expect(draw({}).querySelector(".fp-rp-strip")?.getAttribute("aria-label")).toBe("No events");
    expect(draw({ ready: false }).querySelector(".fp-rp-strip")).toBeNull();
  });
  it("an entity named like markup reaches the strip as nothing at all: the tooltip holds counts, never a name (criterion 12)", () => {
    const host = draw({ onsets: [on(0, "lamp", "light.\"><script>x</script>")] });
    expect(host.querySelector("script")).toBeNull();
    expect(host.innerHTML).not.toContain("<script");
  });
  it("a click on a tick hands its first onset to the card", () => {
    const host = draw({ onsets: [on(300), on(301)] });
    host.querySelector<HTMLElement>(".fp-rp-tick")!.click();
    expect(handlers.jump).toHaveBeenCalledWith(300);
  });
  it("a click on the strip between ticks hands over nothing", () => {
    handlers.jump.mockClear();
    const host = draw({ onsets: [on(300)] });
    host.querySelector<HTMLElement>(".fp-rp-strip")!.click();
    expect(handlers.jump).not.toHaveBeenCalled();
  });
});
