import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import type { RenderOpts } from "../../src/core/render";

// S2.4 review: renderFloor is wrapped, not replaced, so every existing test above still renders for real; this
// only lets a couple of new tests inspect the `state` overlay the card actually handed to core, which the
// rendered SVG cannot reveal for an entity that no CSS rule reads (an unrelated sensor's last_changed).
vi.mock("../../src/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core")>();
  return { ...actual, renderFloor: vi.fn(actual.renderFloor) };
});
import { renderFloor } from "../../src/core";
import { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;
const lastRenderState = () => (renderFloor as unknown as Mock).mock.calls.at(-1)![1] as RenderOpts;

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
    const doorIndex = L.floors.ground.doors.findIndex((d) => d.sensors?.includes("binary_sensor.demo_front_door"));
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

  it("draws blueprint by default, whatever hass.themes.darkMode says, and takes light or ha from the config", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    for (const dark of [true, false]) {
      el.hass = stubHass({}, dark) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("svg")!.innerHTML).toContain('data-theme="blueprint"');
    }
    el.setConfig({ layout: structuredClone(L), theme: "light" });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")!.innerHTML).toContain('data-theme="light"');
    el.setConfig({ layout: structuredClone(L), theme: "ha" });
    el.hass = stubHass({}, true) as never;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")!.innerHTML).toContain('data-theme="ha" data-mode="dark"');
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
    // Restore spies before uninstalling fake timers: `vi.spyOn(globalThis, "setInterval"/"clearInterval")` below
    // wraps the fake clock's functions, and @sinonjs/fake-timers' uninstall() only restores the real originals when
    // it finds its own function still in place; left wrapped by a leaked spy, it silently `delete`s the global
    // instead, leaving `clearInterval` undefined for the rest of the file and the card's disconnectedCallback
    // throwing on the next `document.body.innerHTML = ""` (S2.4 review: caught only by running `npm test` bare).
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

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

    // Coverage gap found in review: deleting the `_stopTimer()` call from `disconnectedCallback` left this suite
    // fully green with no error at all. A card removed from the DOM while a motion sensor is still fading leaked
    // its interval forever, invisible to every other test here (none of them exercise removal while a timer runs).
    it("Break it: stops the interval and renders no more when the card is removed from the DOM mid-fade", async () => {
      const setSpy = vi.spyOn(globalThis, "setInterval");
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), fade: 10 });
      const now = Date.parse("2026-09-19T10:00:00Z");
      vi.setSystemTime(now);
      // motion just went on: inside the 10 s fade window, so the timer is running.
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("on", { last_changed: new Date(now).toISOString() }) }) as never;
      await el.updateComplete;
      expect(setSpy).toHaveBeenCalledTimes(1);
      const timerId = setSpy.mock.results[0]!.value;
      const rendersBefore = (renderFloor as unknown as Mock).mock.calls.length;

      el.remove();

      // the same timer id the running interval was given, not just "cleared something".
      expect(clearSpy).toHaveBeenCalledWith(timerId);

      // the tick that would have re-rendered a fading sensor must produce no further render once the card is gone.
      await vi.advanceTimersByTimeAsync(1000);
      expect((renderFloor as unknown as Mock).mock.calls.length).toBe(rendersBefore);
    });
  });

  describe("S2.4 motion fade: the card remembers the last on time so an off sensor keeps fading", () => {
    beforeEach(() => vi.useFakeTimers());
    // See "the motion re-render timer" above: spies on globalThis timers must be restored before uninstalling fakes.
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

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

    it("Opus review: remembers and rewrites last_changed only for the layout's own motion entities, not every entity hass carries", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), fade: 10 });
      const t0 = Date.parse("2026-09-19T10:00:00Z");
      vi.setSystemTime(t0);
      // a houseful of unrelated entities, none on the plan: a doorbell, a sun sensor, an energy meter.
      const crowd: Record<string, ReturnType<typeof st>> = {};
      for (let i = 0; i < 50; i++) crowd[`sensor.unrelated_${i}`] = st("on", { last_changed: new Date(t0).toISOString() });

      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("on", { last_changed: new Date(t0).toISOString() }), ...crowd }) as never;
      await el.updateComplete;

      // the crowd turns off at t0+2s; so does the motion sensor.
      vi.setSystemTime(t0 + 2000);
      const crowdOff = Object.fromEntries(Object.keys(crowd).map((id) => [id, st("off", { last_changed: new Date(t0 + 2000).toISOString() })]));
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("off", { last_changed: new Date(t0 + 2000).toISOString() }), ...crowdOff }) as never;
      await el.updateComplete;

      const state = lastRenderState().state as Record<string, { last_changed: string }>;
      // the motion entity's last_changed was rewritten to its last on time (t0), not the t0+2s off event.
      expect(state["binary_sensor.demo_hall_motion"].last_changed).toBe(new Date(t0).toISOString());
      // an unrelated entity keeps its own real last_changed: the overlay must not lie about anything the plan
      // does not draw motion fade for (S2.5 reads last_changed for other device types next).
      expect(state["sensor.unrelated_0"].last_changed).toBe(new Date(t0 + 2000).toISOString());
    });

    it("Opus review: a motion sensor keeps fading across a config.floor switch, since the entity set spans every floor, not only the one shown", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), fade: 10, floor: "ground" });
      const t0 = Date.parse("2026-09-19T10:00:00Z");
      vi.setSystemTime(t0);
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("on", { last_changed: new Date(t0).toISOString() }) }) as never;
      await el.updateComplete;

      // switch to a floor that draws no motion device at all, and let the sensor go off while it is not shown.
      vi.setSystemTime(t0 + 2000);
      el.setConfig({ layout: structuredClone(L), fade: 10, floor: "first" });
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("off", { last_changed: new Date(t0 + 2000).toISOString() }) }) as never;
      await el.updateComplete;

      // back to ground: the fade must still be counted from t0, not reset by the floor switch or restarted from t0+2s.
      vi.setSystemTime(t0 + 5000);
      el.setConfig({ layout: structuredClone(L), fade: 10, floor: "ground" });
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`svg [data-x="${motionIndex}"]`)!.getAttribute("style")).toContain("--fp-fade:0.5");
    });

    it("Break it: fade 0 shows red only while on, even once the sensor carries a remembered on time from being on a moment ago", async () => {
      const setSpy = vi.spyOn(globalThis, "setInterval");
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), fade: 0 });
      const t0 = Date.parse("2026-09-19T10:00:00Z");
      vi.setSystemTime(t0);
      const classOf = () => el.shadowRoot!.querySelector(`svg [data-x="${motionIndex}"]`)!.getAttribute("class");
      const styleOf = () => el.shadowRoot!.querySelector(`svg [data-x="${motionIndex}"]`)!.getAttribute("style");

      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("on", { last_changed: new Date(t0).toISOString() }) }) as never;
      await el.updateComplete;
      expect(classOf()).toMatch(/\bon\b/);
      expect(styleOf()).toContain("--fp-fade:1");

      vi.setSystemTime(t0 + 1000);
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("off", { last_changed: new Date(t0 + 1000).toISOString() }) }) as never;
      await el.updateComplete;
      expect(classOf()).not.toMatch(/\bon\b/);
      expect(styleOf()).toContain("--fp-fade:0"); // grey at once, no lingering fade from the remembered on time
      expect(setSpy).not.toHaveBeenCalled(); // fade: 0 never has anything to fade, so the timer never starts
    });
  });

  describe("S2.5 Sensors, climate, camera, media", () => {
    const heaterIndex = L.floors.ground.devices.findIndex((d) => d.entity === "climate.demo_living");
    const cameraIndex = L.floors.ground.devices.findIndex((d) => d.entity === "camera.demo_hall");
    const mediaIndex = L.floors.first.devices.findIndex((d) => d.entity === "media_player.demo_office");
    const humidityIndex = L.floors.first.devices.findIndex((d) => d.entity === "sensor.demo_bathroom_humidity");

    it("shows temperature and humidity labels with their unit", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "sensor.demo_living_temperature": st("21.5", { attributes: { unit_of_measurement: "°C" } }) }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("svg")!.textContent).toContain("21.5 °C");

      el.setConfig({ layout: structuredClone(L), floor: "first" });
      el.hass = stubHass({ "sensor.demo_bathroom_humidity": st("48", { attributes: { unit_of_measurement: "%" } }) }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("svg")!.textContent).toContain("48 %");
      expect(el.shadowRoot!.querySelector(`svg [data-x="${humidityIndex}"]`)).not.toBeNull(); // the humidity device itself is on this floor
    });

    it("a climate entity heating gives its bar the on class; not heating leaves it off", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "climate.demo_living": st("heat", { attributes: { hvac_action: "heating" } }) }) as never;
      await el.updateComplete;
      const bar = el.shadowRoot!.querySelector(`svg [data-xbar="${heaterIndex}"]`)!;
      expect(bar.getAttribute("class")).toMatch(/\bon\b/);

      el.hass = stubHass({ "climate.demo_living": st("heat", { attributes: { hvac_action: "idle" } }) }) as never;
      await el.updateComplete;
      const bar2 = el.shadowRoot!.querySelector(`svg [data-xbar="${heaterIndex}"]`)!;
      expect(bar2.getAttribute("class")).not.toMatch(/\bon\b/);
    });

    it("a tap on the camera fires hass-more-info with its entity, not a toggle", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass(), callService } as never;
      await el.updateComplete;
      const g = el.shadowRoot!.querySelector(`svg [data-x="${cameraIndex}"]`)!;
      const moreInfo = vi.fn();
      el.addEventListener("hass-more-info", moreInfo);
      g.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      g.dispatchEvent(new Event("pointerup", { bubbles: true }));
      expect(moreInfo).toHaveBeenCalledTimes(1);
      expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "camera.demo_hall" });
      expect(callService).not.toHaveBeenCalled();
    });

    it("a tap on the media player fires hass-more-info with its entity, not a toggle, and it takes the on class while playing", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "first" });
      const callService = vi.fn();
      el.hass = { ...stubHass({ "media_player.demo_office": st("playing") }), callService } as never;
      await el.updateComplete;
      const g = el.shadowRoot!.querySelector(`svg [data-x="${mediaIndex}"]`)!;
      expect(g.getAttribute("class")).toMatch(/\bon\b/);

      const moreInfo = vi.fn();
      el.addEventListener("hass-more-info", moreInfo);
      g.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      g.dispatchEvent(new Event("pointerup", { bubbles: true }));
      expect(moreInfo).toHaveBeenCalledTimes(1);
      expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "media_player.demo_office" });
      expect(callService).not.toHaveBeenCalled();
    });

    it("Break it: a humidity sensor whose state is unknown shows a dash, not the word unknown", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "first" });
      el.hass = stubHass({ "sensor.demo_bathroom_humidity": st("unknown") }) as never;
      await el.updateComplete;
      const text = el.shadowRoot!.querySelector("svg")!.textContent ?? "";
      expect(text).toContain("–");
      expect(text).not.toContain("unknown");
    });
  });

  describe("S2.6: floor switcher (floor: \"all\")", () => {
    it("shows one chip per floor, outside the <svg>, and the chip count equals the number of floors", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "all" });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const chips = el.shadowRoot!.querySelectorAll(".fp-floors button");
      expect(chips).toHaveLength(Object.keys(L.floors).length);
      for (const chip of chips) expect(chip.closest("svg")).toBeNull(); // card chrome, not plan content
    });

    it("clicking a chip switches the shown floor, and marks the current one for a screen reader by more than colour", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "all" });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);

      const chips = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      const groundChip = chips.find((b) => b.textContent === L.floors.ground.title)!;
      const firstChip = chips.find((b) => b.textContent === L.floors.first.title)!;
      expect(groundChip.getAttribute("aria-pressed")).toBe("true");
      expect(firstChip.getAttribute("aria-pressed")).toBe("false");

      firstChip.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);
      const chips2 = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      expect(chips2.find((b) => b.textContent === L.floors.first.title)!.getAttribute("aria-pressed")).toBe("true");
      expect(chips2.find((b) => b.textContent === L.floors.ground.title)!.getAttribute("aria-pressed")).toBe("false");
    });

    it("no chips at all with an explicit floor (not \"all\")", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground" });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
    });

    it("Break it: a layout with one floor and floor: \"all\" shows one chip and throws nothing", async () => {
      const oneFloor = structuredClone(L);
      delete (oneFloor.floors as Record<string, unknown>).first;
      delete (oneFloor.floors as Record<string, unknown>).test;
      const el = await mount();
      expect(() => el.setConfig({ layout: oneFloor, floor: "all" })).not.toThrow();
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll(".fp-floors button")).toHaveLength(1);
    });

    it("Break it: a floor key that does not exist falls back to the first floor and throws nothing", async () => {
      const el = await mount();
      expect(() => el.setConfig({ layout: structuredClone(L), floor: "attic" })).not.toThrow();
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);
    });
  });

  describe("S6.5: floors config (an array of visible floors, first is the default)", () => {
    it("shows one chip per listed floor, in the given order, defaulting to the first", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floors: ["first", "ground"] });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const chips = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      expect(chips.map((b) => b.textContent)).toEqual([L.floors.first.title, L.floors.ground.title]);
      expect(chips[0]!.getAttribute("aria-pressed")).toBe("true");
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);
    });

    it("leaves out a floor the layout has but the list doesn't name", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floors: ["ground", "first"] });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const chips = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      expect(chips).toHaveLength(2);
      expect(chips.some((b) => b.textContent === L.floors.test.title)).toBe(false);
    });

    it("clicking a chip only ever switches within the listed floors", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floors: ["first", "ground"] });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const chips = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      chips.find((b) => b.textContent === L.floors.ground.title)!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);
    });

    it("floors takes precedence over an explicit floor key", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground", floors: ["first"] });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);
    });

    it("Break it: every listed floor unknown falls back to the layout's first floor, no switcher, and throws nothing", async () => {
      const el = await mount();
      expect(() => el.setConfig({ layout: structuredClone(L), floors: ["attic", "loft"] })).not.toThrow();
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);
    });

    it("Break it: an empty floors array falls back to the plain floor/all behaviour and throws nothing", async () => {
      const el = await mount();
      expect(() => el.setConfig({ layout: structuredClone(L), floors: [], floor: "first" })).not.toThrow();
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);
    });
  });

  describe("S2.6: unavailable entities carry the unavailable class (already built by S2.2/S2.5's classOf)", () => {
    it("an unavailable light's device group gets the unavailable class", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "first" });
      el.hass = stubHass({ "light.demo_bedroom": st("unavailable") }) as never;
      await el.updateComplete;
      const bedroomIndex = L.floors.first.devices.findIndex((d) => d.entity === "light.demo_bedroom");
      const g = el.shadowRoot!.querySelector(`svg [data-x="${bedroomIndex}"]`)!;
      expect(g.getAttribute("class")).toMatch(/\bunavailable\b/);
    });
  });

  describe("S2.8: a lit lamp casts an aura", () => {
    const kitchenIndex = L.floors.ground.devices.findIndex((d) => d.entity === "light.demo_kitchen"); // x:650, y:200, inside room 1 (Kitchen)

    it("one circle.aura of radius 100 at the lamp's coordinates when it is on, none when it is off", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "light.demo_kitchen": st("off") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg circle.aura")).toHaveLength(0);

      el.hass = stubHass({ "light.demo_kitchen": st("on") }) as never;
      await el.updateComplete;
      const auras = el.shadowRoot!.querySelectorAll("svg circle.aura");
      expect(auras).toHaveLength(1);
      expect(auras[0].getAttribute("cx")).toBe("650");
      expect(auras[0].getAttribute("cy")).toBe("200");
      expect(auras[0].getAttribute("r")).toBe("100");
    });

    it("a light with rgb_color: [255, 0, 0] has --fp-aura:rgb(255,0,0) in its own circle's style", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "light.demo_kitchen": st("on", { attributes: { rgb_color: [255, 0, 0] } }) }) as never;
      await el.updateComplete;
      const aura = el.shadowRoot!.querySelector("svg circle.aura")!;
      expect(aura.getAttribute("style")).toBe("--fp-aura:rgb(255,0,0)");
    });

    it("the aura does not catch the pointer: a tap that lands on it (over the Kitchen room, not the icon) fires no action", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ "light.demo_kitchen": st("on") }), callService } as never;
      await el.updateComplete;
      const aura = el.shadowRoot!.querySelector("svg circle.aura")!;
      expect(el.shadowRoot!.querySelectorAll(`svg [data-x="${kitchenIndex}"]`)).toHaveLength(1); // the icon is a sibling, not an ancestor, of the aura
      const moreInfo = vi.fn();
      el.addEventListener("hass-more-info", moreInfo);
      // closest("g[data-x], line[data-d]") from the aura itself must find nothing: it sits beside the device
      // group, not inside it (CLAUDE.md finding 3), and the CSS gives it pointer-events:none besides.
      aura.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      aura.dispatchEvent(new Event("pointerup", { bubbles: true }));
      expect(moreInfo).not.toHaveBeenCalled();
      expect(callService).not.toHaveBeenCalled();
    });
  });

  describe("S2.7: covers on doors", () => {
    const garageIndex = L.floors.ground.doors.findIndex((d) => d.id === "door-ground-3");
    const garageEntity = "cover.demo_garage_door";
    const garageName = L.floors.ground.doors.find((d) => d.id === "door-ground-3")!.name;

    function tap(el: FloorplanStudioCard, index: number) {
      const line = el.shadowRoot!.querySelector(`svg line[data-d="${index}"]`)!;
      line.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      line.dispatchEvent(new Event("pointerup", { bubbles: true }));
    }

    function dialogText(el: FloorplanStudioCard): string | null {
      return el.shadowRoot!.querySelector(".fp-dialog p")?.textContent ?? null;
    }

    function confirmButtonText(el: FloorplanStudioCard): string | null {
      return el.shadowRoot!.querySelector(".fp-dialog button.confirm")?.textContent?.trim() ?? null;
    }

    it("a tap on a door with a closed cover opens an in-card dialog reading \"Open <name>?\" with an Open button", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ [garageEntity]: st("closed") }) as never;
      await el.updateComplete;
      expect(dialogText(el)).toBeNull(); // nothing shown before the tap

      tap(el, garageIndex);
      await el.updateComplete;
      expect(dialogText(el)).toBe(`Open ${garageName}?`);
      expect(confirmButtonText(el)).toBe("Open");
      expect(el.shadowRoot!.querySelector(".fp-dialog")!.closest("svg")).toBeNull(); // card chrome, not plan content
    });

    it("Open calls callService(\"cover\", \"open_cover\", { entity_id }) when the cover is closed", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ [garageEntity]: st("closed") }), callService } as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.confirm")!.click();
      await el.updateComplete;
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith("cover", "open_cover", { entity_id: garageEntity });
      expect(dialogText(el)).toBeNull(); // dialog closes after acting
    });

    it("a tap on a door with an open cover opens a dialog reading \"Close <name>?\" with a Close button, and it calls close_cover (Opus review: text must match the action)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ [garageEntity]: st("open") }), callService } as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      expect(dialogText(el)).toBe(`Close ${garageName}?`);
      expect(confirmButtonText(el)).toBe("Close");

      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.confirm")!.click();
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith("cover", "close_cover", { entity_id: garageEntity });
    });

    it("a cover that changes state while the dialog is open re-renders the label, and the button then acts on the new state, not the one shown when the dialog opened (Opus review)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ [garageEntity]: st("closed") }), callService } as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      expect(dialogText(el)).toBe(`Open ${garageName}?`);
      expect(confirmButtonText(el)).toBe("Open");

      // the cover finishes an automation-driven open while the dialog is still up; hass's setter
      // triggers a re-render, so the label must flip before anyone can press anything.
      el.hass = { ...stubHass({ [garageEntity]: st("open") }), callService } as never;
      await el.updateComplete;
      expect(dialogText(el)).toBe(`Close ${garageName}?`);
      expect(confirmButtonText(el)).toBe("Close");

      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.confirm")!.click();
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith("cover", "close_cover", { entity_id: garageEntity }); // matches the label shown at press time, not the one at open time
    });

    it("the dialog is a labelled, modal region to assistive tech: role=\"dialog\", aria-modal=\"true\", and aria-labelledby pointing at the question text (Opus review)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ [garageEntity]: st("closed") }) as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector(".fp-dialog")!;
      expect(dialog.getAttribute("role")).toBe("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      const labelledBy = dialog.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      const label = el.shadowRoot!.getElementById(labelledBy!);
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe(dialogText(el)); // the accessible name is the question itself, kept in sync with the verb
    });

    it("Cancel calls no service and closes the dialog", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ [garageEntity]: st("closed") }), callService } as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.cancel")!.click();
      await el.updateComplete;
      expect(callService).not.toHaveBeenCalled();
      expect(dialogText(el)).toBeNull();
    });

    it("Break it: a second tap while the dialog is open does not open a second dialog", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ [garageEntity]: st("closed") }) as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      tap(el, garageIndex);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll(".fp-dialog")).toHaveLength(1);
    });

    it("Escape cancels: closes the dialog and calls no service", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ [garageEntity]: st("closed") }), callService } as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      el.shadowRoot!.querySelector(".fp-dialog-backdrop")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
      await el.updateComplete;
      expect(callService).not.toHaveBeenCalled();
      expect(dialogText(el)).toBeNull();
    });

    it("Cancel is the default focused action, not Open, and focus is trapped inside the dialog while it is open", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ [garageEntity]: st("closed") }) as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      const cancelBtn = el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.cancel")!;
      const confirmBtn = el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.confirm")!;
      expect(el.shadowRoot!.activeElement).toBe(cancelBtn);

      // Tab from the last control (Open) wraps back to the first (Cancel), not out of the dialog.
      confirmBtn.focus();
      el.shadowRoot!.querySelector(".fp-dialog-backdrop")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true }));
      expect(el.shadowRoot!.activeElement).toBe(cancelBtn);
    });

    it("focus returns to the card after the dialog closes", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ [garageEntity]: st("closed") }) as never;
      await el.updateComplete;

      tap(el, garageIndex);
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.cancel")!.click();
      await el.updateComplete;
      // the svg (the plan itself) or the card is focused again; focus does not fall back to <body>.
      expect(document.activeElement).toBe(el);
    });

    it("a cover entity missing from hass.states still opens the dialog and Open calls open_cover, throwing nothing", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass(), callService } as never; // no cover.demo_garage_door entry at all
      await el.updateComplete;

      expect(() => tap(el, garageIndex)).not.toThrow();
      await el.updateComplete;
      expect(dialogText(el)).toBe(`Open ${garageName}?`);

      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-dialog button.confirm")!.click();
      expect(callService).toHaveBeenCalledWith("cover", "open_cover", { entity_id: garageEntity });
    });
  });

  describe("S2.9: a device wears its colour when it is on", () => {
    const classOf = (el: FloorplanStudioCard, entity: string, l: Layout) => {
      const i = l.floors.ground.devices.findIndex((d) => d.entity === entity);
      return el.shadowRoot!.querySelector(`svg [data-x="${i}"]`)!.getAttribute("class") ?? "";
    };
    const withExtraDevices = () => {
      const l = structuredClone(L);
      l.floors.ground.devices.push(
        { id: "contact-x", type: "contact", entity: "binary_sensor.demo_contact", x: 700, y: 550 },
        { id: "tv-x", type: "tv", entity: "media_player.demo_tv", x: 720, y: 550 },
        { id: "computer-x", type: "computer", entity: "switch.demo_computer", x: 740, y: 550 },
      );
      return l;
    };

    it("a motion device that is on carries the on class (its colour comes from --fp-dev, pinned in editor.spec.ts)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "binary_sensor.demo_hall_motion": st("on") }) as never;
      await el.updateComplete;
      expect(classOf(el, "binary_sensor.demo_hall_motion", L)).toMatch(/\bon\b/);
    });

    it("a wall switch that is on carries the on class (its CSS colour stays idle grey, pinned in editor.spec.ts)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "switch.demo_hall": st("on") }) as never;
      await el.updateComplete;
      expect(classOf(el, "switch.demo_hall", L)).toMatch(/\bon\b/);
    });

    it("a tv, a plug and a computer that are on carry the on class; off does not", async () => {
      const l = withExtraDevices();
      const el = await mount();
      el.setConfig({ layout: l });
      el.hass = stubHass({ "media_player.demo_tv": st("on"), "switch.demo_tv_plug": st("on"), "switch.demo_computer": st("on") }) as never;
      await el.updateComplete;
      expect(classOf(el, "media_player.demo_tv", l)).toMatch(/\bon\b/);
      expect(classOf(el, "switch.demo_tv_plug", l)).toMatch(/\bon\b/);
      expect(classOf(el, "switch.demo_computer", l)).toMatch(/\bon\b/);

      el.hass = stubHass({ "media_player.demo_tv": st("off"), "switch.demo_tv_plug": st("off"), "switch.demo_computer": st("off") }) as never;
      await el.updateComplete;
      expect(classOf(el, "media_player.demo_tv", l)).not.toMatch(/\bon\b/);
      expect(classOf(el, "switch.demo_tv_plug", l)).not.toMatch(/\bon\b/);
      expect(classOf(el, "switch.demo_computer", l)).not.toMatch(/\bon\b/);
    });

    it("Break it: a light that is on and unavailable keeps the unavailable class, never the on class", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "first" });
      el.hass = stubHass({ "light.demo_bedroom": st("unavailable") }) as never;
      await el.updateComplete;
      const bedroomIndex = L.floors.first.devices.findIndex((d) => d.entity === "light.demo_bedroom");
      const g = el.shadowRoot!.querySelector(`svg [data-x="${bedroomIndex}"]`)!;
      expect(g.getAttribute("class")).toMatch(/\bunavailable\b/);
      expect(g.getAttribute("class")).not.toMatch(/\bon\b/);
    });
  });

  describe("S2.9: a custom room or piece of furniture with an entity carries the on class", () => {
    it("a room with an entity carries on when that entity is on, open or playing; off does not", async () => {
      const l = structuredClone(L);
      l.floors.ground.rooms.push({ id: "pond", name: "Pond", area: "", label: "", kind: "water", pts: [[10, 10], [60, 10], [60, 60], [10, 60]], wk: ["wall", "wall", "wall", "wall"], entity: "switch.pond_pump" });
      const idx = l.floors.ground.rooms.length - 1;
      const el = await mount();
      el.setConfig({ layout: l });
      el.hass = stubHass({ "switch.pond_pump": st("on") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`svg polygon[data-r="${idx}"]`)!.getAttribute("class")).toMatch(/\bon\b/);

      el.hass = stubHass({ "switch.pond_pump": st("off") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`svg polygon[data-r="${idx}"]`)!.getAttribute("class")).not.toMatch(/\bon\b/);
    });

    it("the same room with no entity never carries on, even with the same entity's state on", async () => {
      const l = structuredClone(L);
      l.floors.ground.rooms.push({ id: "pond2", name: "Pond2", area: "", label: "", kind: "water", pts: [[10, 10], [60, 10], [60, 60], [10, 60]], wk: ["wall", "wall", "wall", "wall"] });
      const idx = l.floors.ground.rooms.length - 1;
      const el = await mount();
      el.setConfig({ layout: l });
      el.hass = stubHass({ "switch.pond_pump": st("on") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`svg polygon[data-r="${idx}"]`)!.getAttribute("class")).not.toMatch(/\bon\b/);
    });

    it("a piece of furniture with an entity carries the on class when its state is on", async () => {
      const l = structuredClone(L);
      l.floors.ground.furniture.push({ id: "gate", symbol: "patio-wood", x: 700, y: 500, rot: 0, w: 100, h: 100, entity: "cover.gate" });
      const idx = l.floors.ground.furniture.length - 1;
      const el = await mount();
      el.setConfig({ layout: l });
      el.hass = stubHass({ "cover.gate": st("open") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(`svg g[data-f="${idx}"]`)!.getAttribute("class")).toMatch(/\bon\b/);
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

  it("sets data-theme on the host itself, matching the plan; an unknown theme falls back to blueprint; data-mode is for ha in dark only (Opus review)", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass({}, true) as never;
    await el.updateComplete;
    expect(el.getAttribute("data-theme")).toBe("blueprint");
    expect(el.hasAttribute("data-mode")).toBe(false);

    el.setConfig({ layout: structuredClone(L), theme: "ha" });
    await el.updateComplete;
    expect(el.getAttribute("data-theme")).toBe("ha");
    expect(el.getAttribute("data-mode")).toBe("dark");
    el.hass = stubHass({}, false) as never;
    await el.updateComplete;
    expect(el.hasAttribute("data-mode")).toBe(false);

    el.setConfig({ layout: structuredClone(L), theme: "neon" as never });
    el.hass = { states: {} } as never; // no themes field at all
    await el.updateComplete;
    expect(el.getAttribute("data-theme")).toBe("blueprint");
  });

  it("the message colour has no hard-coded hex fallback outside FLOORPLAN_CSS (Opus review, CLAUDE.md finding 9)", () => {
    const cssText = (FloorplanStudioCard.styles as unknown as { toString(): string }[]).map((s) => String(s)).join("\n");
    expect(cssText).not.toMatch(/--fp-text\s*,\s*#[0-9a-fA-F]{3,6}/);
  });
});
