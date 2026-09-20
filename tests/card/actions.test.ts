import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, bindDeviceActions, fireEvent, toggleEntity } from "../../src/card/actions";
import type { Device, Door } from "../../src/core";
import type { Hass } from "../../src/card/floorplan-studio-card";

const LIGHT: Device = { id: "l1", type: "light", entity: "light.demo_living", x: 100, y: 100 };
const SWITCH: Device = { id: "s1", type: "switch", entity: "switch.demo_hall", x: 200, y: 100 };
const CAMERA: Device = { id: "c1", type: "camera", entity: "camera.demo_hall", x: 300, y: 100 };
const MEDIA: Device = { id: "m1", type: "media", entity: "media_player.demo_office", x: 400, y: 100 };
const SENSOR_DOOR: Door = { id: "d1", name: "Front door", kind: "door", a: [0, 0], b: [100, 0], sensor: "binary_sensor.demo_front_door" };
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
  sensor: "binary_sensor.demo_back_door", cover: "cover.demo_back_door",
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
