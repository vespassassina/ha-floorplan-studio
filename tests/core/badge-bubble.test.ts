// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUBBLE_TAP_MS, bindBadgeBubble, type Bubble } from "../../src/core/badge-bubble";
import type { BadgeInfo } from "../../src/core/room-badges";

// B55.4 (F37). jsdom has no layout, so each badge gets the rect it would have, and the pointer events carry the shapes the engines send:
// Chromium: touch, its own pointer id. WebKit: a touch tap clicks with the mouse id (1) and a mouse is 1. Firefox: every touch is id 0.
// A bubble must open on all of them, and on an engine that names no type at all (fails open).
const rect = (l: number, t: number, w = 18, h = 18) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
const SHAPES: [string, { pointerType: string; pointerId: number }][] = [
  ["chromium touch", { pointerType: "touch", pointerId: 7 }], ["webkit touch (mouse id)", { pointerType: "touch", pointerId: 1 }],
  ["firefox touch (id 0)", { pointerType: "touch", pointerId: 0 }], ["no type at all", { pointerType: "", pointerId: 0 }],
];
const fire = (el: EventTarget, type: string, x: number, y: number, shape: { pointerType: string; pointerId: number }, buttons = 0) => {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, composed: true, buttons });
  Object.defineProperties(e, { pointerType: { value: shape.pointerType }, pointerId: { value: shape.pointerId } });
  el.dispatchEvent(e);
};
const MOUSE = { pointerType: "mouse", pointerId: 1 };
const tap = (el: EventTarget, x: number, y: number, shape: { pointerType: string; pointerId: number }) => { fire(el, "pointerdown", x, y, shape); fire(el, "pointerup", x, y, shape); };

let svg: SVGSVGElement, mount: HTMLElement, bubble: Bubble, infoOf: ReturnType<typeof vi.fn>;
const el = () => mount.querySelector<HTMLElement>(".fp-bubble")!;
const open = () => !el().hidden;
const INFO: BadgeInfo = { kind: "lights", title: "Lights", on: true, tone: "", rows: ["1 of 2 on", "Kitchen"] };
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div id="m"><svg><g data-cb="0:lights"></g><g data-cb="0:motion"></g></svg></div><p id="away">x</p>`;
  mount = document.getElementById("m")!; svg = mount.querySelector("svg")!;
  const [a, b] = Array.from(svg.querySelectorAll("g"));
  a.getBoundingClientRect = () => rect(10, 10); b.getBoundingClientRect = () => rect(34, 10);
  mount.getBoundingClientRect = () => rect(0, 0, 400, 300);
  infoOf = vi.fn((_ri: number, kind: string) => (kind === "lights" ? INFO : kind === "motion" ? { ...INFO, kind: "motion", title: "Motion", rows: ["Motion now"] } : undefined));
  bubble = bindBadgeBubble({ svg, mount, rect: () => mount.getBoundingClientRect(), info: infoOf as never });
});
afterEach(() => { bubble.destroy(); vi.restoreAllMocks(); vi.useRealTimers(); }); // finding 15: spies back before the clock

describe("badge bubble: a mouse hovers", () => {
  it("opens over a badge, names it with its rows, and closes when the pointer leaves the badge", () => {
    fire(svg, "pointermove", 15, 15, MOUSE);
    expect(open()).toBe(true);
    expect(el().textContent).toBe("Lights" + "1 of 2 on" + "Kitchen");
    fire(svg, "pointermove", 200, 200, MOUSE);
    expect(open()).toBe(false);
  });
  it("moves from one badge to the next and says the second's words", () => {
    fire(svg, "pointermove", 15, 15, MOUSE); fire(svg, "pointermove", 40, 15, MOUSE);
    expect(el().textContent).toBe("MotionMotion now");
  });
  it("is not opened by a drag, and a leave closes it", () => {
    fire(svg, "pointermove", 15, 15, MOUSE, 1);
    expect(open()).toBe(false);
    fire(svg, "pointermove", 15, 15, MOUSE); fire(svg, "pointerleave", 15, 15, MOUSE);
    expect(open()).toBe(false);
  });
  it("a mouse click does not toggle it shut (hover already opened it)", () => {
    fire(svg, "pointermove", 15, 15, MOUSE); tap(svg, 15, 15, MOUSE);
    expect(open()).toBe(true);
  });
});

describe.each(SHAPES)("badge bubble: a finger taps (%s)", (_name, shape) => {
  it("opens on a tap on the badge, closes on a second tap on it", () => {
    tap(svg, 15, 15, shape);
    expect(open()).toBe(true);
    tap(svg, 15, 15, shape);
    expect(open()).toBe(false);
  });
  it("closes on a tap away, in the plan or outside it, but not on the tap that opens the next badge", () => {
    tap(svg, 15, 15, shape);
    tap(svg, 40, 15, shape);
    expect(open()).toBe(true);
    expect(el().textContent).toBe("MotionMotion now");
    tap(svg, 300, 200, shape);
    expect(open()).toBe(false);
    tap(svg, 15, 15, shape);
    fire(document.getElementById("away")!, "pointerdown", 380, 280, shape);
    expect(open()).toBe(false);
  });
  it("closes itself after 4 s, and not before", () => {
    tap(svg, 15, 15, shape);
    vi.advanceTimersByTime(BUBBLE_TAP_MS - 1);
    expect(open()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(open()).toBe(false);
  });
  it("a drag that starts on a badge is a pan, not a tap", () => {
    fire(svg, "pointerdown", 15, 15, shape); fire(svg, "pointerup", 60, 15, shape);
    expect(open()).toBe(false);
  });
  it("a finger does not hover", () => {
    fire(svg, "pointermove", 15, 15, shape);
    expect(open()).toBe(false);
  });
});

describe("badge bubble: upkeep", () => {
  it("refresh rewrites the words from the new state, and closes when the badge is gone or says nothing", () => {
    tap(svg, 15, 15, SHAPES[0][1]);
    infoOf.mockImplementation(() => ({ ...INFO, rows: ["2 of 2 on"] }));
    bubble.refresh();
    expect(el().textContent).toBe("Lights2 of 2 on");
    infoOf.mockImplementation(() => undefined);
    bubble.refresh();
    expect(open()).toBe(false);
  });
  it("words are text, never markup", () => {
    infoOf.mockImplementation(() => ({ ...INFO, title: '"><script>x</script>', rows: ["<img src=x onerror=1>"] }));
    tap(svg, 15, 15, SHAPES[0][1]);
    expect(el().querySelector("script, img")).toBeNull();
    expect(el().textContent).toContain("<img");
  });
  it("destroy takes the element and the page listener away", () => {
    bubble.destroy();
    expect(mount.querySelector(".fp-bubble")).toBeNull();
    tap(svg, 15, 15, SHAPES[0][1]);
    expect(mount.querySelector(".fp-bubble")).toBeNull();
  });
});
