import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, TAP_SLOP_PX, bindDeviceActions, fireEvent } from "../../src/card/actions";
import type { TapTarget } from "../../src/card/actions";
import { entitiesOfDoor } from "../../src/core";
import type { Device, Door, Unlinked } from "../../src/core";
import type { Hass } from "../../src/card/floorplan-studio-card";

// S14.2: a tap never operates anything. It asks `openPopup` to show the device's popup; a hold opens more-info (or the
// chooser). `callService` is on the host so that every test can say "and nothing was called".

const LIGHT: Device = { id: "l1", type: "light", entity: "light.demo_living", x: 100, y: 100 };
const SWITCH: Device = { id: "s1", type: "switch", entity: "switch.demo_hall", x: 200, y: 100 };
const CAMERA: Device = { id: "c1", type: "camera", entity: "camera.demo_hall", x: 300, y: 100 };
const MEDIA: Device = { id: "m1", type: "media", entity: "media_player.demo_office", x: 400, y: 100 };
const SENSOR_DOOR: Door = { id: "d1", name: "Front door", kind: "door", a: [0, 0], b: [100, 0], sensors: ["binary_sensor.demo_front_door"] };
const COVER_DOOR: Door = { id: "d2", name: "Garage door", kind: "door", a: [0, 100], b: [100, 100], cover: "cover.demo_garage_door" };
const COVER_AND_SENSOR_DOOR: Door = {
  id: "d6", name: "Garage door", kind: "door", a: [0, 500], b: [100, 500],
  cover: "cover.demo_garage_door", sensors: ["binary_sensor.demo_garage_contact"],
};
const MULTI_DOOR: Door = {
  id: "d4", name: "Side door", kind: "door", a: [0, 300], b: [100, 300],
  sensors: ["binary_sensor.side_contact"], vibration: ["binary_sensor.side_vibration"],
};
const NOTHING_DOOR: Door = { id: "d5", name: "Bare door", kind: "door", a: [0, 400], b: [100, 400] };
const TWO_ATTACHED: Unlinked = { id: "u1", type: "other", name: "Water heater", x: 100, y: 100, rot: 0, scale: 1, attached: ["sensor.wh_temp", "sensor.wh_pressure"] };
const ONE_ATTACHED: Unlinked = { id: "u2", type: "other", name: "Fuse box", x: 200, y: 100, rot: 0, scale: 1, attached: ["sensor.fuse_box"] };
const NONE_ATTACHED: Unlinked = { id: "u3", type: "other", name: "Bookshelf", x: 300, y: 100, rot: 0, scale: 1 };

const NS = "http://www.w3.org/2000/svg";

/** `<svg><g data-x="0">...</g></svg>` with the inner `<circle class="halo">` and `<path>`, as `renderFloor` emits. `attr` is `data-x` or `data-u`. */
function svgFixture(count: number, attr = "data-x"): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (let i = 0; i < count; i++) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute(attr, String(i));
    g.append(document.createElementNS(NS, "circle"), document.createElementNS(NS, "path"));
    svg.appendChild(g);
  }
  document.body.appendChild(svg);
  return svg;
}

/** `<svg><line data-d="0"><title/></line></svg>`, the `<title>` child `renderFloor` emits on every door. */
function doorSvgFixture(count: number): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (let i = 0; i < count; i++) {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("data-d", String(i));
    line.appendChild(document.createElementNS(NS, "title"));
    svg.appendChild(line);
  }
  document.body.appendChild(svg);
  return svg;
}

function pointer(el: Element, type: "pointerdown" | "pointerup" | "pointercancel" | "pointerleave") {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** A pointer event at client (x, y) with its own pointerId. jsdom has no PointerEvent, so a MouseEvent carries the coordinates. */
function at(el: Element, type: string, x: number, y: number, id = 1) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, "pointerId", { value: id });
  el.dispatchEvent(e);
}

type Opts = NonNullable<Parameters<typeof bindDeviceActions>[4]>;

/** Everything a test needs: the svg, the host with its spies, the binder already bound, and a `tap` / `hold` helper. */
function rig(o: { devices?: Device[]; doors?: Door[]; unlinked?: Unlinked; opts?: Opts; count?: number }) {
  vi.useFakeTimers();
  const callService = vi.fn(), moreInfo = vi.fn(), openPopup = vi.fn(), openChooser = vi.fn();
  const svg = o.doors ? doorSvgFixture(o.doors.length) : svgFixture(o.unlinked ? 1 : (o.devices?.length ?? 1), o.unlinked ? "data-u" : "data-x");
  const host = Object.assign(document.createElement("div"), { hass: { states: {}, callService } as unknown as Hass });
  host.addEventListener("hass-more-info", moreInfo);
  const unbind = bindDeviceActions(
    svg, host, (i) => o.devices?.[i], (i) => o.doors?.[i],
    { openPopup, openChooser, getUnlinked: () => o.unlinked, ...o.opts },
  );
  const el = (i = 0) => svg.querySelector(`[data-x="${i}"], [data-d="${i}"], [data-u="${i}"]`)!;
  const tap = (i = 0, ms = 50) => { pointer(el(i), "pointerdown"); vi.advanceTimersByTime(ms); pointer(el(i), "pointerup"); };
  const hold = (i = 0) => { pointer(el(i), "pointerdown"); vi.advanceTimersByTime(HOLD_MS); };
  const detail = () => (moreInfo.mock.calls[0]![0] as CustomEvent).detail;
  return { svg, host, callService, moreInfo, openPopup, openChooser, unbind, el, tap, hold, detail };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe("actions: a tap opens the popup and operates nothing (S14.2)", () => {
  it("a tap on a light asks for the popup with that device and the pointer's position, and calls no service", () => {
    const r = rig({ devices: [LIGHT, SWITCH] });
    at(r.el(0), "pointerdown", 140, 90);
    at(r.el(0), "pointerup", 140, 90);
    expect(r.openPopup).toHaveBeenCalledTimes(1);
    const [target, where, from] = r.openPopup.mock.calls[0]! as [TapTarget, { x: number; y: number }, Element | null];
    expect(target).toEqual({ device: LIGHT, index: 0 });
    expect(where).toEqual({ x: 140, y: 90 });
    expect(from).toBeNull(); // a plan icon is not a button: nothing to give focus back to
    expect(r.callService).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
  });

  it("the second device resolves to the second device", () => {
    const r = rig({ devices: [LIGHT, SWITCH] });
    r.tap(1);
    expect(r.openPopup.mock.calls[0]![0]).toEqual({ device: SWITCH, index: 1 });
  });

  it("a hold of HOLD_MS fires hass-more-info, not the popup, and the release does neither again", () => {
    const r = rig({ devices: [LIGHT] });
    r.hold();
    expect(r.moreInfo).toHaveBeenCalledTimes(1);
    expect(r.detail()).toEqual({ entityId: "light.demo_living" });
    pointer(r.el(), "pointerup");
    expect(r.openPopup).not.toHaveBeenCalled();
    expect(r.callService).not.toHaveBeenCalled();
  });

  it("a release just before HOLD_MS is a tap", () => {
    const r = rig({ devices: [LIGHT] });
    r.tap(0, HOLD_MS - 1);
    expect(r.openPopup).toHaveBeenCalledTimes(1);
    expect(r.moreInfo).not.toHaveBeenCalled();
  });

  it("two taps within 300 ms ask twice (no debounce eats input; the card turns the second into a close)", () => {
    const r = rig({ devices: [LIGHT] });
    r.tap(0, 50);
    vi.advanceTimersByTime(100);
    r.tap(0, 50);
    expect(r.openPopup).toHaveBeenCalledTimes(2);
  });

  it("a tap on the inner path resolves through closest(\"g[data-x]\") (CLAUDE.md finding 3)", () => {
    const r = rig({ devices: [LIGHT, SWITCH] });
    const path = r.el(1).querySelector("path")!;
    pointer(path, "pointerdown");
    pointer(path, "pointerup");
    expect(r.openPopup.mock.calls[0]![0]).toEqual({ device: SWITCH, index: 1 });
  });

  it("a button[data-x] (an Active-list row) passes itself as the element to give focus back to", () => {
    const r = rig({ devices: [LIGHT] });
    const b = document.createElement("button");
    b.setAttribute("data-x", "0");
    r.svg.appendChild(b);
    pointer(b, "pointerdown");
    pointer(b, "pointerup");
    expect(r.openPopup.mock.calls[0]![2]).toBe(b);
  });

  it("pointercancel and pointerleave abandon the gesture: no popup, no more-info", () => {
    const r = rig({ devices: [LIGHT] });
    pointer(r.el(), "pointerdown");
    vi.advanceTimersByTime(50);
    pointer(r.el(), "pointercancel");
    vi.advanceTimersByTime(600);
    pointer(r.el(), "pointerup");
    pointer(r.el(), "pointerdown");
    pointer(r.el(), "pointerleave");
    pointer(r.el(), "pointerup");
    expect(r.openPopup).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
  });

  it("a press on the background does nothing", () => {
    const r = rig({ devices: [LIGHT] });
    pointer(r.svg, "pointerdown");
    pointer(r.svg, "pointerup");
    expect(r.openPopup).not.toHaveBeenCalled();
  });

  it("the returned cleanup removes the listeners", () => {
    const r = rig({ devices: [LIGHT] });
    r.unbind();
    r.tap();
    expect(r.openPopup).not.toHaveBeenCalled();
  });

  it("with no openPopup callback a tap still calls no service", () => {
    const r = rig({ devices: [LIGHT], opts: { openPopup: undefined } });
    r.tap();
    expect(r.callService).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
  });
});

// A camera, media player or speaker has no toggle (NO_TOGGLE): the popup shows name, state and More info only. That
// is the popup's business (popup.ts); the binder's is to ask for it, the same as for any device.
describe("actions: devices without a toggle ask for the popup too", () => {
  it.each([CAMERA, MEDIA,
    { id: "b", type: "battery", entity: "sensor.b", x: 1, y: 1 } as Device,
    { id: "i", type: "inverter", entity: "sensor.i", x: 1, y: 1 } as Device,
    { id: "sv", type: "server", entity: "sensor.sv", x: 1, y: 1 } as Device,
    { id: "ap", type: "access_point", entity: "sensor.ap", x: 1, y: 1 } as Device,
    { id: "p", type: "person", entity: "person.alex", x: 1, y: 1, room: "sensor.alex_room" } as Device,
    { id: "r", type: "radar", entity: "binary_sensor.radar_presence", x: 1, y: 1 } as Device,
  ])("$type: a tap asks for the popup, calls no service and opens no more-info", (dev) => {
    const r = rig({ devices: [dev] });
    r.tap();
    expect(r.openPopup).toHaveBeenCalledTimes(1);
    expect(r.openPopup.mock.calls[0]![0]).toEqual({ device: dev, index: 0 });
    expect(r.moreInfo).not.toHaveBeenCalled();
    expect(r.callService).not.toHaveBeenCalled();
  });

  it("a hold on a camera still opens more-info directly", () => {
    const r = rig({ devices: [CAMERA] });
    r.hold();
    expect(r.detail()).toEqual({ entityId: "camera.demo_hall" });
  });

  it("a heater with two TRVs: a tap asks for the popup, a HOLD opens more-info for the heater's own entity", () => {
    const dev: Device = { id: "h1", type: "heater", entity: "climate.demo_heater", name: "Living room heater", a: [0, 0], b: [10, 0], trvs: ["climate.trv1", "climate.trv2"] };
    const r = rig({ devices: [dev] });
    r.tap();
    expect(r.openPopup).toHaveBeenCalledTimes(1);
    expect(r.openChooser).not.toHaveBeenCalled();
    r.hold();
    expect(r.detail()).toEqual({ entityId: "climate.demo_heater" });
    expect(r.openChooser).not.toHaveBeenCalled();
    pointer(r.el(), "pointerup");
    expect(r.callService).not.toHaveBeenCalled();
  });

  it("a light with a bound switch: a hold opens more-info for the light alone, never the chooser", () => {
    const dev: Device = { id: "l1", type: "light", entity: "light.demo_living", bound: "switch.demo_living", x: 100, y: 100 };
    const r = rig({ devices: [dev] });
    r.hold();
    expect(r.detail()).toEqual({ entityId: "light.demo_living" });
    expect(r.openChooser).not.toHaveBeenCalled();
  });
});

describe("actions: a drag is a pan, not a tap (S7.4)", () => {
  it("TAP_SLOP_PX is 6", () => {
    expect(TAP_SLOP_PX).toBe(6);
  });

  it("a press that moves 40 px before release opens no popup", () => {
    const r = rig({ devices: [LIGHT] });
    at(r.el(), "pointerdown", 100, 100);
    at(r.el(), "pointermove", 120, 100);
    at(r.el(), "pointermove", 140, 100);
    at(r.el(), "pointerup", 140, 100);
    expect(r.openPopup).not.toHaveBeenCalled();
  });

  it("7 px is a drag; 6 px is still a tap", () => {
    const r = rig({ devices: [LIGHT] });
    at(r.el(), "pointerdown", 100, 100);
    at(r.el(), "pointermove", 100, 107);
    at(r.el(), "pointerup", 100, 107);
    expect(r.openPopup).not.toHaveBeenCalled();
    at(r.el(), "pointerdown", 100, 100);
    at(r.el(), "pointermove", 106, 100);
    at(r.el(), "pointerup", 106, 100);
    expect(r.openPopup).toHaveBeenCalledTimes(1);
  });

  it("moving past the slop cancels the hold timer: no more-info after HOLD_MS", () => {
    const r = rig({ devices: [LIGHT] });
    at(r.el(), "pointerdown", 100, 100);
    at(r.el(), "pointermove", 130, 100);
    vi.advanceTimersByTime(HOLD_MS + 100);
    at(r.el(), "pointerup", 130, 100);
    expect(r.moreInfo).not.toHaveBeenCalled();
    expect(r.openPopup).not.toHaveBeenCalled();
  });

  it("a drag that starts on a camera opens nothing either", () => {
    const r = rig({ devices: [CAMERA] });
    at(r.el(), "pointerdown", 100, 100);
    at(r.el(), "pointermove", 100, 140);
    at(r.el(), "pointerup", 100, 140);
    expect(r.openPopup).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
  });

  it("a pointerup that never arrived does not leave every later tap read as a pinch", () => {
    const r = rig({ devices: [LIGHT] });
    const primary = (type: string, id: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: 100, clientY: 100 });
      Object.defineProperty(e, "pointerId", { value: id });
      Object.defineProperty(e, "isPrimary", { value: true });
      r.el().dispatchEvent(e);
    };
    primary("pointerdown", 1); // its pointerup is lost somewhere outside
    primary("pointerdown", 2);
    primary("pointerup", 2);
    expect(r.openPopup).toHaveBeenCalledTimes(1);
  });

  it("a second finger down makes it a pinch: neither finger opens the popup, and the next plain tap works", () => {
    const r = rig({ devices: [LIGHT] });
    at(r.el(), "pointerdown", 100, 100, 1);
    at(r.svg, "pointerdown", 300, 300, 2);
    at(r.svg, "pointerup", 300, 300, 2);
    at(r.el(), "pointerup", 100, 100, 1);
    expect(r.openPopup).not.toHaveBeenCalled();
    at(r.el(), "pointerdown", 100, 100, 3);
    at(r.el(), "pointerup", 100, 100, 3);
    expect(r.openPopup).toHaveBeenCalledTimes(1);
  });
});

describe("actions: longPress option (S7.5 kiosk)", () => {
  it("longPress: false never fires hass-more-info on a hold, and the release still asks for the popup", () => {
    const r = rig({ devices: [LIGHT], opts: { longPress: false } });
    pointer(r.el(), "pointerdown");
    vi.advanceTimersByTime(HOLD_MS + 100);
    expect(r.moreInfo).not.toHaveBeenCalled();
    pointer(r.el(), "pointerup");
    expect(r.openPopup).toHaveBeenCalledTimes(1);
  });

  it("unset and true both fire more-info on the same hold, so the case above is not passing for nothing", () => {
    for (const opts of [{}, { longPress: true }]) {
      const r = rig({ devices: [LIGHT], opts });
      r.hold();
      expect(r.moreInfo).toHaveBeenCalledTimes(1);
      r.unbind();
    }
  });
});

describe("actions: a vacuum opens its own dialog on a tap (S7.10)", () => {
  const VAC: Device = { id: "v1", type: "vacuum", entity: "vacuum.hall", x: 100, y: 100 };

  it("tap calls openVacuumDialog with the device; no popup, no more-info, no service, even after a long press", () => {
    const openVacuumDialog = vi.fn();
    const r = rig({ devices: [VAC], opts: { openVacuumDialog } });
    r.tap(0, 600);
    expect(openVacuumDialog).toHaveBeenCalledTimes(1);
    expect(openVacuumDialog.mock.calls[0]![0]).toBe(VAC);
    expect(r.openPopup).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
    expect(r.callService).not.toHaveBeenCalled();
  });

  it("with no openVacuumDialog given a tap does nothing", () => {
    const r = rig({ devices: [VAC] });
    r.tap();
    expect(r.openPopup).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
    expect(r.callService).not.toHaveBeenCalled();
  });
});

describe("actions: doors (S2.3, S2.7, S14.2)", () => {
  it("a tap on a door with a sensor asks for the popup with that door (CLAUDE.md finding 3: line[data-d])", () => {
    const r = rig({ doors: [SENSOR_DOOR] });
    r.tap();
    expect(r.openPopup).toHaveBeenCalledTimes(1);
    expect(r.openPopup.mock.calls[0]![0]).toEqual({ door: SENSOR_DOOR, index: 0 });
    expect(r.moreInfo).not.toHaveBeenCalled();
    expect(r.callService).not.toHaveBeenCalled();
  });

  it("a tap on the door's inner <title> still resolves via closest(\"line[data-d]\")", () => {
    const r = rig({ doors: [SENSOR_DOOR] });
    const title = r.el().querySelector("title")!;
    pointer(title, "pointerdown");
    pointer(title, "pointerup");
    expect(r.openPopup).toHaveBeenCalledTimes(1);
  });

  it("a tap on a door with a cover asks for the popup, which owns the confirm dialog; no more-info, no chooser", () => {
    const r = rig({ doors: [COVER_DOOR] });
    r.tap();
    expect(r.openPopup.mock.calls[0]![0]).toEqual({ door: COVER_DOOR, index: 0 });
    expect(r.openChooser).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
    expect(r.callService).not.toHaveBeenCalled();
  });

  it("a door with several entities asks for the popup on a tap; its chooser comes from the popup's More info", () => {
    const r = rig({ doors: [MULTI_DOOR] });
    r.tap();
    expect(r.openPopup).toHaveBeenCalledTimes(1);
    expect(r.openChooser).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
  });

  it("a hold on a door with two entities opens the chooser with both", () => {
    const r = rig({ doors: [MULTI_DOOR] });
    r.hold();
    expect(r.openChooser).toHaveBeenCalledWith("Side door", ["binary_sensor.side_contact", "binary_sensor.side_vibration"]);
    expect(r.openPopup).not.toHaveBeenCalled();
  });

  it("a door with nothing attached and no cover: a tap and a hold do nothing", () => {
    const r = rig({ doors: [NOTHING_DOOR] });
    r.tap();
    r.hold();
    expect(r.openPopup).not.toHaveBeenCalled();
    expect(r.openChooser).not.toHaveBeenCalled();
    expect(r.moreInfo).not.toHaveBeenCalled();
  });

  it("pointercancel abandons a door tap", () => {
    const r = rig({ doors: [COVER_DOOR, MULTI_DOOR] });
    for (const i of [0, 1]) {
      pointer(r.el(i), "pointerdown");
      pointer(r.el(i), "pointercancel");
      pointer(r.el(i), "pointerup");
    }
    expect(r.openPopup).not.toHaveBeenCalled();
  });

  it("entitiesOfDoor includes the cover entity", () => {
    expect(entitiesOfDoor(COVER_AND_SENSOR_DOOR)).toEqual(["cover.demo_garage_door", "binary_sensor.demo_garage_contact"]);
  });

  it("a HOLD on a door with a cover and a sensor opens the chooser, cover row included, not the popup", () => {
    const r = rig({ doors: [COVER_AND_SENSOR_DOOR] });
    r.hold();
    expect(r.openChooser).toHaveBeenCalledWith("Garage door", ["cover.demo_garage_door", "binary_sensor.demo_garage_contact"]);
    pointer(r.el(), "pointerup");
    expect(r.openPopup).not.toHaveBeenCalled(); // the hold consumed the gesture
  });

  it("a HOLD on a door with only a cover opens more-info for the cover", () => {
    const r = rig({ doors: [COVER_DOOR] });
    r.hold();
    expect(r.detail()).toEqual({ entityId: "cover.demo_garage_door" });
    expect(r.openChooser).not.toHaveBeenCalled();
  });

  it("kiosk mode: a door with a cover starts no hold timer, so only the tap's popup ever asks", () => {
    const r = rig({ doors: [COVER_AND_SENSOR_DOOR], opts: { longPress: false } });
    pointer(r.el(), "pointerdown");
    vi.advanceTimersByTime(HOLD_MS * 4);
    expect(r.openChooser).not.toHaveBeenCalled();
    pointer(r.el(), "pointerup");
    expect(r.openPopup).toHaveBeenCalledTimes(1);
  });
});

describe("actions: an unlinked appliance (g[data-u]) with attached entities", () => {
  it("a tap asks for the popup with the appliance; with one or two attachments alike, and calls no service", () => {
    for (const u of [TWO_ATTACHED, ONE_ATTACHED]) {
      const r = rig({ unlinked: u });
      r.tap();
      expect(r.openPopup).toHaveBeenCalledTimes(1);
      expect(r.openPopup.mock.calls[0]![0]).toEqual({ unlinked: u, index: 0 });
      expect(r.moreInfo).not.toHaveBeenCalled();
      expect(r.callService).not.toHaveBeenCalled();
      r.unbind();
    }
  });

  it("a hold with two attachments opens the chooser with both; with one it opens more-info", () => {
    const two = rig({ unlinked: TWO_ATTACHED });
    two.hold();
    expect(two.openChooser).toHaveBeenCalledWith("Water heater", ["sensor.wh_temp", "sensor.wh_pressure"]);
    two.unbind();
    const one = rig({ unlinked: ONE_ATTACHED });
    one.hold();
    expect(one.detail()).toEqual({ entityId: "sensor.fuse_box" });
    expect(one.openChooser).not.toHaveBeenCalled();
  });

  it("no attachments: a tap does nothing", () => {
    const r = rig({ unlinked: NONE_ATTACHED });
    r.tap();
    expect(r.openPopup).not.toHaveBeenCalled();
  });

  it("a tap on the inner path still resolves via closest(\"g[data-u]\") (CLAUDE.md finding 3)", () => {
    const r = rig({ unlinked: ONE_ATTACHED });
    const path = r.el().querySelector("path")!;
    pointer(path, "pointerdown");
    pointer(path, "pointerup");
    expect(r.openPopup).toHaveBeenCalledTimes(1);
  });

  it("two attachments with no openChooser given: a hold does nothing, never falls back to the first entity", () => {
    const r = rig({ unlinked: TWO_ATTACHED, opts: { openChooser: undefined } });
    r.hold();
    expect(r.moreInfo).not.toHaveBeenCalled();
  });

  it("pointercancel abandons an unlinked tap", () => {
    const r = rig({ unlinked: TWO_ATTACHED });
    pointer(r.el(), "pointerdown");
    pointer(r.el(), "pointercancel");
    pointer(r.el(), "pointerup");
    expect(r.openPopup).not.toHaveBeenCalled();
  });
});

describe("actions: opts.resolve (S12.4, the 3D view picks with a ray)", () => {
  it("a press on a plain element asks for the popup of the device `resolve` names, and a null answer does nothing", () => {
    const r = rig({ devices: [LIGHT, SWITCH] });
    r.unbind();
    let answer: Element | null = r.el(1);
    const openPopup = vi.fn();
    const unbind = bindDeviceActions(r.svg, r.host, (i) => [LIGHT, SWITCH][i], undefined, { openPopup, resolve: () => answer });
    pointer(r.svg, "pointerdown"); // the target is the svg itself, which carries no data-x
    pointer(r.svg, "pointerup");
    expect(openPopup).toHaveBeenCalledTimes(1);
    expect(openPopup.mock.calls[0]![0]).toEqual({ device: SWITCH, index: 1 });
    answer = null;
    pointer(r.svg, "pointerdown");
    pointer(r.svg, "pointerup");
    expect(openPopup).toHaveBeenCalledTimes(1);
    unbind();
  });

  it("the 3D view's drag threshold equals the tap slop, so no press is both a tap here and a drag there", async () => {
    const { DRAG_PX } = await import("../../src/card/three/view3d");
    expect(DRAG_PX).toBe(TAP_SLOP_PX);
  });
});

describe("actions: a speaker or TV object linked to a media player stands in for the player", () => {
  const obj = (type: Unlinked["type"], attached?: string[]): Unlinked => ({ id: "u9", type, name: "Object", x: 10, y: 10, rot: 0, scale: 1, ...(attached ? { attached } : {}) });
  it.each(["speaker", "tv"] as const)("a tap on a %s with a media_player opens that player's more-info and no popup", (type) => {
    const r = rig({ unlinked: obj(type, ["sensor.noise", "media_player.living"]) });
    r.tap();
    expect(r.detail()).toEqual({ entityId: "media_player.living" });
    expect(r.openPopup).not.toHaveBeenCalled();
    expect(r.callService).not.toHaveBeenCalled();
  });
  it("a hold does the same", () => {
    const r = rig({ unlinked: obj("speaker", ["media_player.living"]) });
    r.hold();
    expect(r.detail()).toEqual({ entityId: "media_player.living" });
  });
  it("without a media_player, or on another type, a tap is the popup as before", () => {
    for (const u of [obj("speaker", ["sensor.noise"]), obj("speaker"), obj("heater", ["media_player.living"])]) {
      const r = rig({ unlinked: u });
      r.tap();
      expect(r.moreInfo).not.toHaveBeenCalled();
      expect(r.openPopup.mock.calls.length).toBe(u.attached?.length ? 1 : 0);
      r.unbind();
    }
  });
});
