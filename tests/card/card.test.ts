import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;

/** A state map entry, matching what `hass.states` holds. */
const st = (state: string, extra: Record<string, unknown> = {}) => ({ state, attributes: {}, last_changed: "2026-09-19T10:00:00Z", ...extra });

/** A minimal stub `hass`: enough states for the demo layout's devices, a fixed theme, no websocket. */
function stubHass(overrides: Record<string, ReturnType<typeof st>> = {}, darkMode = false) {
  return {
    states: {
      "light.demo_living": st("off"),
      "light.demo_kitchen": st("off"),
      "switch.demo_hall": st("off"),
      "switch.demo_tv_plug": st("off"),
      "sensor.demo_living_temperature": st("21.5", { unit_of_measurement: "°C" }),
      "binary_sensor.demo_hall_motion": st("off"),
      "camera.demo_hall": st("idle"),
      "climate.demo_living": st("heat", { hvac_action: "off" }),
      "binary_sensor.demo_front_door": st("off"),
      ...overrides,
    },
    themes: { darkMode },
  };
}

async function mount(): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("FloorplanStudioCard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registers itself on window.customCards", () => {
    const entry = (window as unknown as { customCards: { type: string }[] }).customCards.find((c) => c.type === "floorplan-studio-card");
    expect(entry).toBeTruthy();
  });

  it("renders one polygon[data-r] per room from config.layout, and toggling a light's state toggles the .on class", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass() as never;
    await el.updateComplete;
    const svg = el.shadowRoot!.querySelector("svg")!;
    expect(svg.querySelectorAll("[data-r]")).toHaveLength(L.floors.ground.rooms.length);

    const lightGroup = svg.querySelector('[data-x="0"]')!; // light-living is devices[0]
    expect(lightGroup.getAttribute("class")).not.toMatch(/\bon\b/);

    el.hass = stubHass({ "light.demo_living": st("on") }) as never;
    await el.updateComplete;
    const svg2 = el.shadowRoot!.querySelector("svg")!;
    const lightGroup2 = svg2.querySelector('[data-x="0"]')!;
    expect(lightGroup2.getAttribute("class")).toMatch(/\bon\b/);
  });

  it("S2.3: a door's contact sensor being on gives its line[data-d] the open class", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass() as never; // binary_sensor.demo_front_door: off
    await el.updateComplete;
    const svg = el.shadowRoot!.querySelector("svg")!;
    const doorIndex = L.floors.ground.doors.findIndex((d) => d.sensor === "binary_sensor.demo_front_door");
    const line = svg.querySelector(`line[data-d="${doorIndex}"]`)!;
    expect(line.getAttribute("class")).not.toMatch(/\bopen\b/);

    el.hass = stubHass({ "binary_sensor.demo_front_door": st("on") }) as never;
    await el.updateComplete;
    const svg2 = el.shadowRoot!.querySelector("svg")!;
    const line2 = svg2.querySelector(`line[data-d="${doorIndex}"]`)!;
    expect(line2.getAttribute("class")).toMatch(/\bopen\b/);
  });

  it("S2.3: a tap on a sensor door fires hass-more-info for that sensor entity", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass() as never;
    await el.updateComplete;
    const svg = el.shadowRoot!.querySelector("svg")!;
    const doorIndex = L.floors.ground.doors.findIndex((d) => d.sensor === "binary_sensor.demo_front_door");
    const line = svg.querySelector(`line[data-d="${doorIndex}"]`)!;
    const moreInfo = vi.fn();
    el.addEventListener("hass-more-info", moreInfo);
    line.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    line.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(moreInfo).toHaveBeenCalledTimes(1);
    expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "binary_sensor.demo_front_door" });
  });

  it("S2.3 Break it: a door whose sensor entity is missing from hass.states draws normally", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    const { "binary_sensor.demo_front_door": _dropped, ...rest } = stubHass().states;
    void _dropped;
    el.hass = { states: rest, themes: { darkMode: false } } as never;
    await el.updateComplete;
    const svg = el.shadowRoot!.querySelector("svg")!;
    const doorIndex = L.floors.ground.doors.findIndex((d) => d.sensor === "binary_sensor.demo_front_door");
    const line = svg.querySelector(`line[data-d="${doorIndex}"]`)!;
    expect(line.getAttribute("class")).not.toMatch(/\bopen\b/);
  });

  it("shows the no-layout message when setConfig({}) is given no layout, url or hass", async () => {
    const el = await mount();
    el.setConfig({});
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("No layout: install the Floorplan Studio integration or set layout_url");
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
  });

  it("fetches config.layout_url once, even across repeated hass updates", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => structuredClone(L) }));
    vi.stubGlobal("fetch", fetchMock);
    const el = await mount();
    el.setConfig({ layout_url: "https://example.invalid/layout.json" });
    el.hass = stubHass() as never;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the two chained fetch/json promises settle
    await el.updateComplete;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();

    el.hass = stubHass({}, true) as never;
    await el.updateComplete;
    expect(fetchMock).toHaveBeenCalledTimes(1); // not fetched again on a later hass update
    vi.unstubAllGlobals();
  });

  it("falls back to the websocket floorplan_studio/load when there is no config.layout and no layout_url", async () => {
    const sendMessagePromise = vi.fn(async () => structuredClone(L));
    const el = await mount();
    el.setConfig({});
    el.hass = { ...stubHass(), connection: { sendMessagePromise } } as never;
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(sendMessagePromise).toHaveBeenCalledWith({ type: "floorplan_studio/load" });
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
  });

  it("sets the plan's theme from hass.themes.darkMode, dark when the dashboard is dark", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass({}, true) as never;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")!.innerHTML).toContain('data-theme="dark"');

    el.hass = stubHass({}, false) as never;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")!.innerHTML).toContain('data-theme="light"');
  });

  it("passes layout.rotate through to renderFloor and viewBoxFor", async () => {
    const el = await mount();
    const turned = structuredClone(L);
    turned.rotate = 45;
    el.setConfig({ layout: turned });
    el.hass = stubHass() as never;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")!.innerHTML).toContain('class="plan-turn" transform="rotate(45');
  });

  describe("the motion re-render timer", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs only while a motion device is inside its fade window", async () => {
      const setSpy = vi.spyOn(globalThis, "setInterval");
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), fade: 10 });
      const now = Date.parse("2026-09-19T10:00:00Z");
      vi.setSystemTime(now);
      // motion just went on: inside the 10 s fade window.
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("on", { last_changed: new Date(now).toISOString() }) }) as never;
      await el.updateComplete;
      expect(setSpy).toHaveBeenCalled();

      // advance past the fade window and let the timer's own re-render see it has expired.
      vi.setSystemTime(now + 11_000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(clearSpy).toHaveBeenCalled();
    });

    it("never starts when no motion device is inside its fade window", async () => {
      const setSpy = vi.spyOn(globalThis, "setInterval");
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), fade: 10 });
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("off", { last_changed: "2020-01-01T00:00:00Z" }) }) as never;
      await el.updateComplete;
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  it("getStubConfig returns a usable default config", () => {
    const stub = FloorplanStudioCard.getStubConfig();
    expect(stub).toEqual({ type: "custom:floorplan-studio-card" });
  });

  it("getCardSize returns a positive number", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass() as never;
    await el.updateComplete;
    expect(el.getCardSize()).toBeGreaterThan(0);
  });

  it("getCardSize accounts for layout.rotate, same as render()'s own viewBoxFor call (Opus review)", async () => {
    const el = await mount();
    const unturned = structuredClone(L);
    el.setConfig({ layout: unturned });
    el.hass = stubHass() as never;
    await el.updateComplete;
    const sizeAt0 = el.getCardSize();

    const el2 = await mount();
    const turned = structuredClone(L);
    turned.rotate = 90; // the demo outline is 800x600: 90 degrees swaps the aspect ratio getCardSize reads
    el2.setConfig({ layout: turned });
    el2.hass = stubHass() as never;
    await el2.updateComplete;
    const sizeAt90 = el2.getCardSize();

    expect(sizeAt90).not.toBe(sizeAt0);
  });

  it("sets data-theme on the host itself, matching the theme passed into renderFloor, and clears it when hass.themes is absent (Opus review)", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass({}, true) as never;
    await el.updateComplete;
    expect(el.getAttribute("data-theme")).toBe("dark");

    el.hass = stubHass({}, false) as never;
    await el.updateComplete;
    expect(el.getAttribute("data-theme")).toBe("light");

    el.hass = { states: {} } as never; // no themes field at all: never hard-coded, so no attribute
    await el.updateComplete;
    expect(el.hasAttribute("data-theme")).toBe(false);
  });

  it("the message colour has no hard-coded hex fallback outside FLOORPLAN_CSS (Opus review, CLAUDE.md finding 9)", () => {
    const cssText = (FloorplanStudioCard.styles as unknown as { toString(): string }[]).map((s) => String(s)).join("\n");
    expect(cssText).not.toMatch(/--fp-text\s*,\s*#[0-9a-fA-F]{3,6}/);
  });
});
