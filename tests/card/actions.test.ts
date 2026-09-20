import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, bindDeviceActions, fireEvent, lightFill, lightOpacity, toggleEntity } from "../../src/card/actions";
import type { Device } from "../../src/core";
import type { Hass, HassEntity } from "../../src/card/floorplan-studio-card";

const st = (state: string, attributes: Record<string, unknown> = {}): HassEntity => ({ state, attributes, last_changed: "2026-09-20T10:00:00Z" });

const LIGHT: Device = { id: "l1", type: "light", entity: "light.demo_living", x: 100, y: 100 };
const SWITCH: Device = { id: "s1", type: "switch", entity: "switch.demo_hall", x: 200, y: 100 };

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

function pointer(el: Element, type: "pointerdown" | "pointerup" | "pointercancel" | "pointerleave") {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

describe("actions: lightFill", () => {
  it("uses rgb_color when present", () => {
    expect(lightFill(st("on", { rgb_color: [255, 0, 0] }))).toBe("rgb(255,0,0)");
  });

  it("falls back to --fp-on with no rgb_color", () => {
    expect(lightFill(st("on"))).toBe("var(--fp-on)");
    expect(lightFill(undefined)).toBe("var(--fp-on)");
  });

  it("falls back to --fp-on on a malformed rgb_color (untrusted state)", () => {
    expect(lightFill(st("on", { rgb_color: [255, 0] }))).toBe("var(--fp-on)");
    expect(lightFill(st("on", { rgb_color: "red" }))).toBe("var(--fp-on)");
  });
});

describe("actions: lightOpacity", () => {
  it("is brightness/255, floored at 0.35", () => {
    expect(lightOpacity(st("on", { brightness: 255 }))).toBe(1);
    expect(lightOpacity(st("on", { brightness: 128 }))).toBeCloseTo(128 / 255, 5);
    expect(lightOpacity(st("on", { brightness: 0 }))).toBe(0.35); // would be 0 unfloored
    expect(lightOpacity(st("on", { brightness: 10 }))).toBe(0.35); // 10/255 ~= 0.039, under the floor
  });

  it("is full opacity with no brightness attribute", () => {
    expect(lightOpacity(st("on"))).toBe(1);
    expect(lightOpacity(undefined)).toBe(1);
  });
});

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
