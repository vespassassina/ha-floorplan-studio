import { describe, expect, it } from "vitest";
import { ROOM_PRIORITY, roomPriority } from "../../src/card/three/overlay";
import { ROOM_KINDS } from "../../src/core/schema";

// S28 review: which room name keeps its place when labels meet. Finding 17: a decision for every member of the union.
describe("roomPriority", () => {
  it("decides every room kind, with a finite number", () => {
    expect(Object.keys(ROOM_PRIORITY).sort()).toEqual([...ROOM_KINDS].sort());
    for (const k of ROOM_KINDS) expect(Number.isFinite(roomPriority(k)), k).toBe(true);
  });
  it("keeps the ranking that shipped: a room over a garden over water", () => {
    expect(roomPriority("room")).toBeGreaterThan(roomPriority("garden"));
    expect(roomPriority("garden")).toBeGreaterThan(roomPriority("water"));
  });
  it("a garden-, terrace-, pavement- or water-type outdoor name ranks below every indoor name", () => {
    for (const out of ["garden", "terrace", "pavement", "water"] as const) for (const inn of ["room", "structure", "zone"] as const) expect(roomPriority(out), `${out} < ${inn}`).toBeLessThan(roomPriority(inn));
  });
  it("a fill names nothing worth keeping over a room's name, and an unknown kind ranks as a room", () => {
    expect(roomPriority("fill")).toBeLessThan(roomPriority("room"));
    expect(roomPriority("nonsense")).toBe(roomPriority("room"));
  });
});

// S28 review: the overlay's held-pointer set and its size cache, in jsdom with a fake clock. Positions are the projected pixels
// (project reads x and z of the point), a label's box is measured by a stubbed getBoundingClientRect.
import { afterEach, beforeEach, vi } from "vitest";
import { createOverlay } from "../../src/card/three/overlay";

type Dev = { klass: string; style: string; icon: string; name: string; value: string; state: string; playing: boolean };
const dev = (value = ""): Dev => ({ klass: "dev", style: "", icon: "", name: "n", value, state: "on", playing: false });
const liveOf = (devices: Dev[]) => ({ night: false, labels: true, names: false, pulse: [3, 1], lights: [], doors: [], devices, pieces: [], rooms: [] }) as never;
const project = (p: readonly [number, number, number]) => ({ x: p[0], y: p[2], front: true });
const never = () => false;
const SETTLE = 160;

describe("overlay: held pointers and the size cache", () => {
  let box: HTMLElement, size: [number, number];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    box = document.createElement("div");
    document.body.appendChild(box);
    size = [0, 0];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const [width, height] = this.classList.contains("fp3-dv") ? size : [0, 0];
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); box.remove(); Reflect.deleteProperty(document, "fonts"); }); // spies first, then the clock (finding 15)
  const press = (target: EventTarget, type: string, id = 1) => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerId: id }));
  const keptIcons = (ov: ReturnType<typeof createOverlay>) => ov.state().icons.map((i) => i.kept);

  /** Icons 0 and 1 sit on top of each other (one loses); then icon 1 moves away, which a decision would notice. */
  const overlapping = () => {
    const ov = createOverlay(box), at: Record<number, [number, number, number]> = { 0: [100, 0, 100], 1: [105, 0, 100] };
    ov.set(liveOf([dev(), dev()]), { devices: new Map([[0, at[0]], [1, at[1]]]), rooms: new Map() });
    const place = () => ov.place((p) => project(p), never, 400, 400);
    place();
    expect(keptIcons(ov).filter(Boolean)).toHaveLength(1); // the first answer is at once
    ov.set(liveOf([dev(), dev()]), { devices: new Map([[0, at[0]], [1, [300, 0, 300]]]), rooms: new Map() });
    place(); // icon 1 moves off: a decision is now due, after the camera is still
    return { ov };
  };

  it.each([
    ["pointerup", () => press(window, "pointerup")],
    ["pointercancel", () => press(window, "pointercancel")],
    ["lostpointercapture", () => press(box, "lostpointercapture")],
    ["the page being hidden", () => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }],
  ])("a held pointer freezes the answer, and %s lets it through", (_name, release) => {
    const { ov } = overlapping();
    press(box, "pointerdown");
    vi.advanceTimersByTime(5 * SETTLE);
    expect(keptIcons(ov).filter(Boolean)).toHaveLength(1); // still held: nothing decided
    release();
    vi.advanceTimersByTime(3 * SETTLE);
    Reflect.deleteProperty(document, "hidden");
    expect(keptIcons(ov)).toEqual([true, true]);
    ov.dispose();
  });

  it("a size of 0 x 0 is not remembered: the label is measured again at the next decision", () => {
    const ov = createOverlay(box), pos: Record<number, [number, number, number]> = { 0: [100, 0, 100], 1: [140, 0, 135], 2: [300, 0, 300] };
    const set = () => ov.set(liveOf([dev("21 C"), dev(), dev()]), { devices: new Map(Object.entries(pos).map(([i, p]) => [+i, p])), rooms: new Map() });
    set();
    ov.place((p) => project(p), never, 400, 400); // measured while not laid out: 0 x 0
    expect(ov.state().icons.every((i) => i.kept)).toBe(true);
    size = [60, 12]; // laid out now
    pos[2] = [301, 0, 300];
    set();
    ov.place((p) => project(p), never, 400, 400); // something moved: due again
    vi.advanceTimersByTime(3 * SETTLE);
    expect(box.querySelector(".fp3-dv")!.classList.contains("fp3-lose")).toBe(true); // 60 wide it meets icon 1
    ov.dispose();
  });

  it("a font that finishes loading clears the sizes: the value is measured again", () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    const ov = createOverlay(box);
    size = [10, 12]; // the fallback font: narrow, meets nothing
    ov.set(liveOf([dev("21 C"), dev()]), { devices: new Map([[0, [100, 0, 100]], [1, [140, 0, 135]]]), rooms: new Map() });
    ov.place((p) => project(p), never, 400, 400);
    expect(box.querySelector(".fp3-dv")!.classList.contains("fp3-lose")).toBe(false);
    size = [60, 12]; // the web font arrives and the text is wider
    fonts.dispatchEvent(new Event("loadingdone"));
    vi.advanceTimersByTime(3 * SETTLE);
    ov.place((p) => project(p), never, 400, 400);
    vi.advanceTimersByTime(3 * SETTLE);
    expect(box.querySelector(".fp3-dv")!.classList.contains("fp3-lose")).toBe(true);
    ov.dispose();
  });
});
