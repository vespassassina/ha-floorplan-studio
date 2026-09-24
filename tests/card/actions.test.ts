import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, TAP_SLOP_PX, bindDeviceActions, fireEvent, toggleEntity } from "../../src/card/actions";
import type { Device, Door } from "../../src/core";
import type { Hass } from "../../src/card/floorplan-studio-card";

const LIGHT: Device = { id: "l1", type: "light", entity: "light.demo_living", x: 100, y: 100 };
const SWITCH: Device = { id: "s1", type: "switch", entity: "switch.demo_hall", x: 200, y: 100 };
const CAMERA: Device = { id: "c1", type: "camera", entity: "camera.demo_hall", x: 300, y: 100 };
const MEDIA: Device = { id: "m1", type: "media", entity: "media_player.demo_office", x: 400, y: 100 };
const SENSOR_DOOR: Door = { id: "d1", name: "Front door", kind: "door", a: [0, 0], b: [100, 0], sensors: ["binary_sensor.demo_front_door"] };
const COVER_DOOR: Door = { id: "d2", name: "Garage door", kind: "door", a: [0, 100], b: [100, 100], cover: "cover.demo_garage_door" };

/** A minimal `<svg><g data-x="0">...</g></svg>` with the icon's inner `<circle class="halo">` and `<path>`, matching what `renderFloor` emits. */
function svgFixture(devices: Device[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  devices.forEach((d, i) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-x", String(i));
    const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    halo.setAttribute("class", "halo");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    g.append(halo, path);
    svg.appendChild(g);
  });
  document.body.appendChild(svg);
  return svg;
}

/** A minimal `<svg><line data-d="0">...</line></svg>` with the `<title>` child `renderFloor` emits on every door. */
function doorSvgFixture(doors: Door[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  doors.forEach((d, i) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("data-d", String(i));
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = d.name;
    line.appendChild(title);
    svg.appendChild(line);
  });
  document.body.appendChild(svg);
  return svg;
}

function pointer(el: Element, type: "pointerdown" | "pointerup" | "pointercancel" | "pointerleave") {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

describe("actions: toggleEntity", () => {
  it("calls hass.callService(domain, \"toggle\", { entity_id }) with the entity's own domain", () => {
    const callService = vi.fn();
    toggleEntity({ states: {}, callService } as unknown as Hass, "light.demo_living");
    expect(callService).toHaveBeenCalledWith("light", "toggle", { entity_id: "light.demo_living" });
  });

  it("does nothing with no hass", () => {
    expect(() => toggleEntity(undefined, "light.demo_living")).not.toThrow();
  });
});

describe("actions: fireEvent", () => {
  it("dispatches a bubbling, composed CustomEvent carrying detail", () => {
    const el = document.createElement("div");
    const handler = vi.fn();
    el.addEventListener("hass-more-info", handler);
    fireEvent(el, "hass-more-info", { entityId: "light.demo_living" });
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as CustomEvent;
    expect(ev.detail).toEqual({ entityId: "light.demo_living" });
    expect(ev.bubbles).toBe(true);
    expect(ev.composed).toBe(true);
  });
});

describe("actions: bindDeviceActions", () => {
  let callService: ReturnType<typeof vi.fn>;
  let host: { hass: Hass } & EventTarget;
  let svg: SVGSVGElement;
  let unbind: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    callService = vi.fn();
    svg = svgFixture([LIGHT, SWITCH]);
    host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    unbind = bindDeviceActions(svg, host, (i) => [LIGHT, SWITCH][i]);
  });

  afterEach(() => {
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("pointerdown+up within 500 ms calls hass.callService once with light.toggle", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(100);
    pointer(g, "pointerup");
    expect(callService).toHaveBeenCalledTimes(1);
    expect(callService).toHaveBeenCalledWith("light", "toggle", { entity_id: "light.demo_living" });
  });

  it("a hold of 500 ms or more fires hass-more-info instead of toggling, even before pointerup", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(600);
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "light.demo_living" });
    pointer(g, "pointerup");
    expect(callService).not.toHaveBeenCalled(); // the hold consumed the gesture, so release does not also toggle
  });

  it("fires right at the HOLD_MS threshold", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(HOLD_MS);
    expect(moreInfo).toHaveBeenCalledTimes(1);
  });

  it("two taps within 300 ms toggle twice, not once (S2.2 Break it: no debounce that eats input)", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    vi.advanceTimersByTime(100);
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    expect(callService).toHaveBeenCalledTimes(2);
  });

  it("a tap on the inner path or halo still resolves to the device via closest(\"g[data-x]\") (CLAUDE.md finding 3)", () => {
    const g = svg.querySelector('[data-x="1"]')!;
    const path = g.querySelector("path")!;
    pointer(path, "pointerdown"); // target is the inner <path>, not the <g data-x> itself
    vi.advanceTimersByTime(50);
    pointer(path, "pointerup");
    expect(callService).toHaveBeenCalledWith("switch", "toggle", { entity_id: "switch.demo_hall" });
  });

  it("pointercancel and pointerleave abandon the gesture: no toggle, no more-info", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointercancel");
    vi.advanceTimersByTime(600);
    pointer(g, "pointerup");
    expect(callService).not.toHaveBeenCalled();
    expect(moreInfo).not.toHaveBeenCalled();
  });

  it("a pointerdown outside any device (background) does nothing", () => {
    pointer(svg, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(svg, "pointerup");
    expect(callService).not.toHaveBeenCalled();
  });

  it("the returned cleanup function removes the listeners", () => {
    unbind();
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    expect(callService).not.toHaveBeenCalled();
    unbind = () => {}; // afterEach calls unbind() again; make it a no-op since we already unbound
  });
});

describe("actions: bindDeviceActions on camera and media (S2.5)", () => {
  let callService: ReturnType<typeof vi.fn>;
  let host: { hass: Hass } & EventTarget;
  let svg: SVGSVGElement;
  let unbind: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    callService = vi.fn();
    svg = svgFixture([CAMERA, MEDIA]);
    host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    unbind = bindDeviceActions(svg, host, (i) => [CAMERA, MEDIA][i]);
  });

  afterEach(() => {
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("a tap on a camera fires hass-more-info with its own entity, not a toggle", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50); // well under HOLD_MS: a camera opens more-info on the plain tap, not only on a hold
    pointer(g, "pointerup");
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "camera.demo_hall" });
    expect(callService).not.toHaveBeenCalled();
  });

  it("a tap on a media player fires hass-more-info with its own entity, not a toggle", () => {
    const g = svg.querySelector('[data-x="1"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "media_player.demo_office" });
    expect(callService).not.toHaveBeenCalled();
  });

  it("pointercancel abandons a camera tap: no more-info", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointercancel");
    pointer(g, "pointerup");
    expect(moreInfo).not.toHaveBeenCalled();
  });
});

const SENSOR_AND_COVER_DOOR: Door = {
  id: "d3", name: "Back door", kind: "door", a: [0, 200], b: [100, 200],
  sensors: ["binary_sensor.demo_back_door"], cover: "cover.demo_back_door",
};

describe("actions: bindDeviceActions on doors (S2.3)", () => {
  let callService: ReturnType<typeof vi.fn>;
  let host: { hass: Hass } & EventTarget;
  let svg: SVGSVGElement;
  let unbind: () => void;
  let openCoverDialog: ReturnType<typeof vi.fn>;
  const DOORS = [SENSOR_DOOR, COVER_DOOR, SENSOR_AND_COVER_DOOR];

  beforeEach(() => {
    vi.useFakeTimers();
    callService = vi.fn();
    openCoverDialog = vi.fn();
    svg = doorSvgFixture(DOORS);
    host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    unbind = bindDeviceActions(svg, host, () => undefined, (i) => DOORS[i], openCoverDialog);
  });

  afterEach(() => {
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("a tap on a door with a sensor fires hass-more-info for that sensor, not a toggle (CLAUDE.md finding 3: line[data-d], not g[data-x])", () => {
    const line = svg.querySelector('[data-d="0"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(line, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(line, "pointerup");
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "binary_sensor.demo_front_door" });
    expect(callService).not.toHaveBeenCalled();
  });

  it("a tap on the door's inner <title> still resolves via closest(\"line[data-d]\")", () => {
    const line = svg.querySelector('[data-d="0"]')!;
    const title = line.querySelector("title")!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(title, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(title, "pointerup");
    expect(moreInfo).toHaveBeenCalledTimes(1);
  });

  it("S2.7: a tap on a door with a cover calls openCoverDialog with that door, not more-info or a toggle", () => {
    const line = svg.querySelector('[data-d="1"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(line, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(line, "pointerup");
    expect(openCoverDialog).toHaveBeenCalledTimes(1);
    expect(openCoverDialog).toHaveBeenCalledWith(COVER_DOOR);
    expect(moreInfo).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
  });

  it("S2.7: a door with both a sensor and a cover resolves to the dialog, not more-info (dialog wins on tap)", () => {
    const line = svg.querySelector('[data-d="2"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(line, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(line, "pointerup");
    expect(openCoverDialog).toHaveBeenCalledTimes(1);
    expect(openCoverDialog).toHaveBeenCalledWith(SENSOR_AND_COVER_DOOR);
    expect(moreInfo).not.toHaveBeenCalled();
  });

  it("S2.7: pointercancel abandons a cover door tap: openCoverDialog is not called", () => {
    const line = svg.querySelector('[data-d="1"]')!;
    pointer(line, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(line, "pointercancel");
    pointer(line, "pointerup");
    expect(openCoverDialog).not.toHaveBeenCalled();
  });

  it("pointercancel abandons a door tap: no more-info", () => {
    const line = svg.querySelector('[data-d="0"]')!;
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    pointer(line, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(line, "pointercancel");
    pointer(line, "pointerup");
    expect(moreInfo).not.toHaveBeenCalled();
  });
});

describe("actions: a battery, inverter, server or access point opens more-info on a tap (S2.13)", () => {
  it.each(["battery", "inverter", "server", "access_point"] as const)("%s: tap fires hass-more-info with its own entity and calls no service", (type) => {
    vi.useFakeTimers();
    const callService = vi.fn();
    const dev: Device = { id: "d1", type, entity: `sensor.demo_${type}`, x: 100, y: 100 };
    const svg = svgFixture([dev]);
    const host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    const unbind = bindDeviceActions(svg, host, () => dev);
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: `sensor.demo_${type}` });
    expect(callService).not.toHaveBeenCalled();
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });
});

describe("actions: a drag is a pan, not a tap (S7.4)", () => {
  let callService: ReturnType<typeof vi.fn>;
  let moreInfo: ReturnType<typeof vi.fn>;
  let host: { hass: Hass } & EventTarget;
  let svg: SVGSVGElement;
  let unbind: () => void;

  /** A pointer event at client (x, y) with its own pointerId. jsdom has no PointerEvent, so a MouseEvent carries the
   * coordinates and the id is added on top. */
  function at(el: Element, type: string, x: number, y: number, id = 1) {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "pointerId", { value: id });
    el.dispatchEvent(e);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    callService = vi.fn();
    moreInfo = vi.fn();
    svg = svgFixture([LIGHT, CAMERA]);
    host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    host.addEventListener("hass-more-info", moreInfo);
    unbind = bindDeviceActions(svg, host, (i) => [LIGHT, CAMERA][i]);
  });

  afterEach(() => {
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("TAP_SLOP_PX is 6", () => {
    expect(TAP_SLOP_PX).toBe(6);
  });

  it("a press that moves 40 px before release does not toggle", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    at(g, "pointerdown", 100, 100);
    at(g, "pointermove", 120, 100);
    at(g, "pointermove", 140, 100);
    at(g, "pointerup", 140, 100);
    expect(callService).not.toHaveBeenCalled();
  });

  it("a press that moves 7 px (just past the slop) does not toggle; 6 px still does", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    at(g, "pointerdown", 100, 100);
    at(g, "pointermove", 100, 107);
    at(g, "pointerup", 100, 107);
    expect(callService).not.toHaveBeenCalled();
    at(g, "pointerdown", 100, 100);
    at(g, "pointermove", 106, 100);
    at(g, "pointerup", 106, 100);
    expect(callService).toHaveBeenCalledTimes(1);
  });

  it("moving past the slop cancels the hold timer: no more-info after HOLD_MS", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    at(g, "pointerdown", 100, 100);
    at(g, "pointermove", 130, 100);
    vi.advanceTimersByTime(HOLD_MS + 100);
    at(g, "pointerup", 130, 100);
    expect(moreInfo).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
  });

  it("a drag that starts on a camera does not open more-info either", () => {
    const g = svg.querySelector('[data-x="1"]')!;
    at(g, "pointerdown", 100, 100);
    at(g, "pointermove", 100, 140);
    at(g, "pointerup", 100, 140);
    expect(moreInfo).not.toHaveBeenCalled();
  });

  it("a pointerup that never arrived does not leave every later tap read as a pinch", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    const primary = (type: string, id: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: 100, clientY: 100 });
      Object.defineProperty(e, "pointerId", { value: id });
      Object.defineProperty(e, "isPrimary", { value: true });
      g.dispatchEvent(e);
    };
    primary("pointerdown", 1); // its pointerup is lost somewhere outside
    primary("pointerdown", 2);
    primary("pointerup", 2);
    expect(callService).toHaveBeenCalledTimes(1);
  });

  it("a second finger down makes it a pinch: neither finger toggles on release", () => {
    const g = svg.querySelector('[data-x="0"]')!;
    at(g, "pointerdown", 100, 100, 1);
    at(svg, "pointerdown", 300, 300, 2);
    at(svg, "pointerup", 300, 300, 2);
    at(g, "pointerup", 100, 100, 1);
    expect(callService).not.toHaveBeenCalled();
    // and the next plain tap works again
    at(g, "pointerdown", 100, 100, 3);
    at(g, "pointerup", 100, 100, 3);
    expect(callService).toHaveBeenCalledTimes(1);
  });
});

describe("actions: longPress option (S7.5 kiosk)", () => {
  let callService: ReturnType<typeof vi.fn>;
  let moreInfo: ReturnType<typeof vi.fn>;
  let host: { hass: Hass } & EventTarget;
  let svg: SVGSVGElement;
  let unbind: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    callService = vi.fn();
    moreInfo = vi.fn();
    svg = svgFixture([LIGHT, SWITCH]);
    host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    host.addEventListener("hass-more-info", moreInfo);
  });

  afterEach(() => {
    unbind();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("longPress: false never fires hass-more-info on a hold, and a plain release still toggles (a hold that removed this would fail)", () => {
    unbind = bindDeviceActions(svg, host, (i) => [LIGHT, SWITCH][i], undefined, undefined, { longPress: false });
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(HOLD_MS + 100);
    expect(moreInfo).not.toHaveBeenCalled();
    pointer(g, "pointerup");
    expect(callService).toHaveBeenCalledTimes(1);
    expect(callService).toHaveBeenCalledWith("light", "toggle", { entity_id: "light.demo_living" });
  });

  it("longPress unset (default) still fires hass-more-info on the same hold, so the test above is not passing for nothing", () => {
    unbind = bindDeviceActions(svg, host, (i) => [LIGHT, SWITCH][i]);
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(HOLD_MS + 100);
    expect(moreInfo).toHaveBeenCalledTimes(1);
  });

  it("longPress: true is the same as leaving it unset", () => {
    unbind = bindDeviceActions(svg, host, (i) => [LIGHT, SWITCH][i], undefined, undefined, { longPress: true });
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(HOLD_MS + 100);
    expect(moreInfo).toHaveBeenCalledTimes(1);
  });
});

describe("actions: a person opens more-info on a tap (S7.8)", () => {
  it.each(["person.alex", "device_tracker.phone"])("%s: tap fires hass-more-info with its own entity and calls no service", (entity) => {
    vi.useFakeTimers();
    const callService = vi.fn();
    const dev: Device = { id: "p1", type: "person", entity, x: 100, y: 100, room: "sensor.alex_room" };
    const svg = svgFixture([dev]);
    const host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    const unbind = bindDeviceActions(svg, host, () => dev);
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: entity });
    expect(callService).not.toHaveBeenCalled();
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });
});

describe("actions: a radar opens more-info on a tap, never toggles (S7.9)", () => {
  it("tap fires hass-more-info with the radar's own entity and calls no service", () => {
    vi.useFakeTimers();
    const callService = vi.fn();
    const dev: Device = { id: "r1", type: "radar", entity: "binary_sensor.radar_presence", x: 100, y: 100, targets: [{ x: "sensor.r_tx", y: "sensor.r_ty" }] };
    const svg = svgFixture([dev]);
    const host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    const unbind = bindDeviceActions(svg, host, () => dev);
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "binary_sensor.radar_presence" });
    expect(callService).not.toHaveBeenCalled();
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });
});

describe("actions: a vacuum opens its own dialog on a tap, never toggles or opens more-info (S7.10)", () => {
  it("tap calls opts.openVacuumDialog with the vacuum device, fires no hass-more-info and no service", () => {
    vi.useFakeTimers();
    const callService = vi.fn();
    const dev: Device = { id: "v1", type: "vacuum", entity: "vacuum.hall", x: 100, y: 100 };
    const svg = svgFixture([dev]);
    const host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    const openVacuumDialog = vi.fn();
    const unbind = bindDeviceActions(svg, host, () => dev, undefined, undefined, { openVacuumDialog });
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(600); // longer than HOLD_MS: a hold must not turn this into more-info either
    pointer(g, "pointerup");
    expect(openVacuumDialog).toHaveBeenCalledTimes(1);
    expect(openVacuumDialog.mock.calls[0][0]).toBe(dev);
    expect(moreInfo).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("Break it: with no openVacuumDialog callback given, a tap does nothing — never falls back to toggle or more-info", () => {
    vi.useFakeTimers();
    const callService = vi.fn();
    const dev: Device = { id: "v1", type: "vacuum", entity: "vacuum.hall", x: 100, y: 100 };
    const svg = svgFixture([dev]);
    const host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
    const unbind = bindDeviceActions(svg, host, () => dev);
    const moreInfo = vi.fn();
    host.addEventListener("hass-more-info", moreInfo);
    const g = svg.querySelector('[data-x="0"]')!;
    pointer(g, "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(g, "pointerup");
    expect(moreInfo).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
    unbind();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });
});
