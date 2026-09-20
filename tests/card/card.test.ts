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

  // The demo's three sensor doors (Opus review: "respond in the jsdom test" means all three, not one
  // driven three times, and the third one — on the "first" floor, which the card does not show by
  // default — is the case that catches floor-scoped door indexing bugs the other two cannot).
  const SENSOR_DOORS = [
    { floor: "ground", doorId: "door-ground-1", entity: "binary_sensor.demo_front_door" },
    { floor: "ground", doorId: "door-ground-2", entity: "binary_sensor.demo_patio_door" },
    { floor: "first", doorId: "door-first-1", entity: "binary_sensor.demo_bedroom_window" },
  ] as const;

  describe.each(SENSOR_DOORS)("S2.3: sensor door $doorId on floor $floor", ({ floor, doorId, entity }) => {
    /** `line[data-d]` indices are per floor, so the index must come from that floor's own `doors` array, not `ground`'s. */
    function doorIndex(): number {
      const i = L.floors[floor as keyof typeof L.floors].doors.findIndex((d) => d.id === doorId);
      expect(i).toBeGreaterThanOrEqual(0); // the demo must still have this door, or the test proves nothing
      return i;
    }

    it("sensor off draws no open class on its own line[data-d], on on the sensor's own entity gives it the open class", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor });
      el.hass = stubHass({ [entity]: st("off") }) as never;
      await el.updateComplete;
      const svg = el.shadowRoot!.querySelector("svg")!;
      const line = svg.querySelector(`line[data-d="${doorIndex()}"]`)!;
      expect(line.getAttribute("class")).not.toMatch(/\bopen\b/);
      // its title identifies which door this is, so an index mix-up across floors is caught here, not silently passed
      expect(line.querySelector("title")!.textContent).toBe(
        L.floors[floor as keyof typeof L.floors].doors.find((d) => d.id === doorId)!.name,
      );

      el.hass = stubHass({ [entity]: st("on") }) as never;
      await el.updateComplete;
      const svg2 = el.shadowRoot!.querySelector("svg")!;
      const line2 = svg2.querySelector(`line[data-d="${doorIndex()}"]`)!;
      expect(line2.getAttribute("class")).toMatch(/\bopen\b/);
      // and no other door on the same floor lit up as a side effect
      const openDoors = [...svg2.querySelectorAll("line[data-d]")].filter((l) => l.getAttribute("class")?.match(/\bopen\b/));
      expect(openDoors).toHaveLength(1);
      expect(openDoors[0]).toBe(line2);
    });

    it("a tap on it fires hass-more-info with its own entity id, not another door's", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const svg = el.shadowRoot!.querySelector("svg")!;
      const line = svg.querySelector(`line[data-d="${doorIndex()}"]`)!;
      const moreInfo = vi.fn();
      el.addEventListener("hass-more-info", moreInfo);
      line.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      expect(moreInfo).toHaveBeenCalledTimes(1);
      expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: entity });
    });
  });

  it("S2.3 Opus review: with all three sensors on and config.floor: \"first\", only the first floor's window is .open — a wrong floor index would light a ground door instead", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L), floor: "first" });
    el.hass = stubHass({
      "binary_sensor.demo_front_door": st("on"),
      "binary_sensor.demo_patio_door": st("on"),
      "binary_sensor.demo_bedroom_window": st("on"),
    }) as never;
    await el.updateComplete;
    const svg = el.shadowRoot!.querySelector("svg")!;
    const openDoors = [...svg.querySelectorAll("line[data-d]")].filter((l) => l.getAttribute("class")?.match(/\bopen\b/));
    expect(openDoors).toHaveLength(1);
    expect(openDoors[0].querySelector("title")!.textContent).toBe("Bedroom window");
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

  describe("S2.4 motion fade: the card remembers the last on time so an off sensor keeps fading", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const motionIndex = L.floors.ground.devices.findIndex((d) => d.entity === "binary_sensor.demo_hall_motion");

    it("fades from the entity's last on time, not from a later off event, and stops the timer once the fade is over", async () => {
      const setSpy = vi.spyOn(globalThis, "setInterval");
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), fade: 10 });
      const t0 = Date.parse("2026-09-19T10:00:00Z");
      vi.setSystemTime(t0);
      const styleOf = () => el.shadowRoot!.querySelector(`svg [data-x="${motionIndex}"]`)!.getAttribute("style");

      // on at t0: fully red.
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("on", { last_changed: new Date(t0).toISOString() }) }) as never;
      await el.updateComplete;
      expect(styleOf()).toContain("--fp-fade:1");
      expect(setSpy).toHaveBeenCalledTimes(1);

      // t0+2s: the sensor returns to off. This must not reset the fade window.
      vi.setSystemTime(t0 + 2000);
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("off", { last_changed: new Date(t0 + 2000).toISOString() }) }) as never;
      await el.updateComplete;
      // still one interval: a later hass set while already fading must not start a second timer.
      expect(setSpy).toHaveBeenCalledTimes(1);

      // t0+5s, fade: 10 -> half faded, counted from the original on time (t0), not the t0+2s off event.
      // advanceTimersByTimeAsync itself moves the fake clock forward by its argument, on top of setSystemTime,
      // so the target instant is set 1000ms early and reached exactly when the interval's own tick fires.
      vi.setSystemTime(t0 + 4000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(styleOf()).toContain("--fp-fade:0.5");

      // t0+10s -> fully faded, and the timer stops itself.
      vi.setSystemTime(t0 + 9000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(styleOf()).toContain("--fp-fade:0");
      expect(clearSpy).toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledTimes(1); // never restarted a second timer along the way
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
