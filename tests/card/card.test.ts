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
import { planPivot, renderFloor, rotateAbout, viewBoxFor } from "../../src/core";
import { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";
import { HOLD_MS } from "../../src/card/actions";
import { MAX_ZOOM } from "../../src/card/viewport";

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
      // S8.9: a door is now two lines sharing data-d — an invisible wider "door-hit" click target (finding 3) drawn
      // first, then the real, wall-matched-thickness one this test means.
      const line = svg.querySelector(`line[data-d="${doorIndex()}"]:not(.door-hit)`)!;
      expect(line.getAttribute("class")).not.toMatch(/\bopen\b/);
      // its title identifies which door this is, so an index mix-up across floors is caught here, not silently passed
      expect(line.querySelector("title")!.textContent).toBe(
        L.floors[floor as keyof typeof L.floors].doors.find((d) => d.id === doorId)!.name,
      );

      el.hass = stubHass({ [entity]: st("on") }) as never;
      await el.updateComplete;
      const svg2 = el.shadowRoot!.querySelector("svg")!;
      const line2 = svg2.querySelector(`line[data-d="${doorIndex()}"]:not(.door-hit)`)!;
      expect(line2.getAttribute("class")).toMatch(/\bopen\b/);
      // and no other door on the same floor lit up as a side effect
      const openDoors = [...svg2.querySelectorAll("line[data-d]:not(.door-hit)")].filter((l) => l.getAttribute("class")?.match(/\bopen\b/));
      expect(openDoors).toHaveLength(1);
      expect(openDoors[0]).toBe(line2);
    });

    it("a tap on it opens the popup, and its More info fires hass-more-info with its own entity id, not another door's", async () => {
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
      await el.updateComplete;
      expect(moreInfo).not.toHaveBeenCalled(); // a tap shows the popup; it does not open more-info
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-pop-more")!.click();
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

  // S7.16: the integration answers `{ layout }`, the wrapper `websocket.py` sends (`panel.ts` reads `r.layout` too).
  // The mock here used to return a bare layout, so the card passing the whole reply to `validate` went unseen and
  // every real dashboard read "No layout" while the plan sat one key deeper.
  it("falls back to the websocket floorplan_studio/load when there is no config.layout and no layout_url", async () => {
    const sendMessagePromise = vi.fn(async () => ({ layout: structuredClone(L) }));
    const el = await mount();
    el.setConfig({});
    el.hass = { ...stubHass(), connection: { sendMessagePromise } } as never;
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(sendMessagePromise).toHaveBeenCalledWith({ type: "floorplan_studio/load" });
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
  });

  it("S7.16: a websocket reply with layout: null (nothing saved yet) shows the no-layout message, not a crash", async () => {
    const sendMessagePromise = vi.fn(async () => ({ layout: null }));
    const el = await mount();
    el.setConfig({});
    el.hass = { ...stubHass(), connection: { sendMessagePromise } } as never;
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("No layout: install the Floorplan Studio integration or set layout_url");
  });

  it("S7.16: a websocket reply whose layout is invalid says why, so the message can be matched to the plan", async () => {
    const sendMessagePromise = vi.fn(async () => ({ layout: { version: 2, north: "north", floors: {} } }));
    const el = await mount();
    el.setConfig({});
    el.hass = { ...stubHass(), connection: { sendMessagePromise } } as never;
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("north must be a number");
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

    it("a tap on the camera opens a popup with More info only, whose button fires hass-more-info with its entity; no toggle", async () => {
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
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-pop-do")).toBeNull(); // NO_TOGGLE: no operate button
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-pop-more")!.click();
      expect(moreInfo).toHaveBeenCalledTimes(1);
      expect((moreInfo.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "camera.demo_hall" });
      expect(callService).not.toHaveBeenCalled();
    });

    it("a tap on the media player opens a popup with More info only, not a toggle, and it takes the on class while playing", async () => {
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
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-pop-do")).toBeNull();
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-pop-more")!.click();
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

    // S8.12 update: an all-unknown `floors` list is the same as `floors` not being set at all (this describe
    // block's own title). With no `floor` either, and the layout having more than one floor, that now means the
    // S8.12 default switcher, not "no switcher" — this used to assert the opposite before S8.12 added that default.
    it("Break it: every listed floor unknown falls back to the S8.12 default (a switcher, the layout has more than one floor), and throws nothing", async () => {
      const el = await mount();
      expect(() => el.setConfig({ layout: structuredClone(L), floors: ["attic", "loft"] })).not.toThrow();
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll(".fp-floors button")).toHaveLength(Object.keys(L.floors).length);
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

  describe("S8.12: chips by default with more than one floor and neither floor nor floors set", () => {
    /** L minus its "first" and "test" floors — the same trim `oneFloor` tests above use. */
    const oneFloor = () => {
      const l = structuredClone(L);
      delete (l.floors as Record<string, unknown>).first;
      delete (l.floors as Record<string, unknown>).test;
      return l;
    };
    /** L minus its "test" floor: exactly two floors, ground and first, in that order. */
    const twoFloors = () => {
      const l = structuredClone(L);
      delete (l.floors as Record<string, unknown>).test;
      return l;
    };

    it("no config at all + a multi-floor layout shows one chip per floor, the first one pressed", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const chips = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      expect(chips).toHaveLength(Object.keys(L.floors).length);
      expect(chips[0]!.getAttribute("aria-pressed")).toBe("true");
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);
    });

    it("no config at all + a single-floor layout shows no .fp-floors (one chip is noise)", async () => {
      const el = await mount();
      el.setConfig({ layout: oneFloor() });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);
    });

    it("floor pinned to a real, second floor id still shows no chips and draws that floor", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "first" });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);
    });

    it("Break it: an unknown floor id with more than one floor in the layout now shows the switcher too", async () => {
      const el = await mount();
      expect(() => el.setConfig({ layout: twoFloors(), floor: "attic" })).not.toThrow();
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll(".fp-floors button")).toHaveLength(2);
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);
    });

    it("kiosk: true with no config still shows no switcher, even with more than one floor", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), kiosk: true });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
    });

    it("switching floor via the default switcher, then a hass update, keeps the switched floor", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.ground.rooms.length);

      const chips = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      const firstChip = chips.find((b) => b.textContent === L.floors.first.title)!;
      firstChip.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);

      el.hass = stubHass({ "light.demo_kitchen": st("on") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);
      const chips2 = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")];
      expect(chips2.find((b) => b.textContent === L.floors.first.title)!.getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("S7.5 kiosk mode", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("kiosk: true hides .fp-floors and the zoom buttons; kiosk: false (or unset) shows both", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floors: ["ground", "first"], kiosk: true });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
      expect(el.shadowRoot!.querySelector(".fp-zoom")).toBeNull();

      el.setConfig({ layout: structuredClone(L), floors: ["ground", "first"], kiosk: false });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).not.toBeNull();
      expect(el.shadowRoot!.querySelector(".fp-zoom")).not.toBeNull();
    });

    it("with floors: [a, b] and kiosk: true the first floor shows and there is no switcher", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floors: ["first", "ground"], kiosk: true });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-floors")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("svg [data-r]")).toHaveLength(L.floors.first.rooms.length);
    });

    it("a hold of HOLD_MS + 100 on a light fires no hass-more-info under kiosk, and does otherwise (same layout, same hold, two cards)", async () => {
      vi.useFakeTimers();

      const kioskEl = await mount();
      const kioskMoreInfo = vi.fn();
      kioskEl.addEventListener("hass-more-info", kioskMoreInfo);
      kioskEl.setConfig({ layout: structuredClone(L), kiosk: true });
      kioskEl.hass = stubHass() as never;
      await kioskEl.updateComplete;
      const g = kioskEl.shadowRoot!.querySelector('svg [data-x="0"]')!; // devices[0]: light.demo_living
      g.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(HOLD_MS + 100);
      expect(kioskMoreInfo).not.toHaveBeenCalled();
      g.dispatchEvent(new Event("pointerup", { bubbles: true }));

      // Not passing for nothing: the same hold, on an otherwise identical card without kiosk, does fire more-info.
      const plainEl = await mount();
      const plainMoreInfo = vi.fn();
      plainEl.addEventListener("hass-more-info", plainMoreInfo);
      plainEl.setConfig({ layout: structuredClone(L) });
      plainEl.hass = stubHass() as never;
      await plainEl.updateComplete;
      const g2 = plainEl.shadowRoot!.querySelector('svg [data-x="0"]')!;
      g2.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(HOLD_MS + 100);
      expect(plainMoreInfo).toHaveBeenCalledTimes(1);
      g2.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });

    it("a plain tap still opens the popup under kiosk, and its button makes the one call", async () => {
      const el = await mount();
      const callService = vi.fn();
      el.setConfig({ layout: structuredClone(L), kiosk: true });
      el.hass = { ...stubHass(), callService } as never;
      await el.updateComplete;

      const g = el.shadowRoot!.querySelector('svg [data-x="0"]')!;
      g.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      g.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await el.updateComplete;
      expect(callService).not.toHaveBeenCalled();
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-pop-do")!.click();
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith("light", "turn_on", { entity_id: "light.demo_living" }); // stubHass has the light off
    });

    it("kiosk: \"yes\" (a string) is refused by setConfig, naming the key", async () => {
      const el = await mount();
      expect(() => el.setConfig({ kiosk: "yes" as never })).toThrow(/kiosk/);
    });

    it("zoom: \"yes\" (an unknown string) is refused by setConfig, naming the key — S7.4 left this falling back to true", async () => {
      const el = await mount();
      expect(() => el.setConfig({ zoom: "yes" as never })).toThrow(/zoom/);
    });

    it("zoom: true, false and \"wheel\" are all still accepted", async () => {
      const el = await mount();
      for (const zoom of [true, false, "wheel"] as const) expect(() => el.setConfig({ zoom })).not.toThrow();
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

    it("one circle.aura of radius 150 at the lamp's coordinates when it is on, none when it is off", async () => {
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
      expect(auras[0].getAttribute("r")).toBe("150");
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

    /** S14.2: a tap opens the popup; its primary button ("Open" / "Close") is what opens the confirm dialog. */
    async function tap(el: FloorplanStudioCard, index: number) {
      const line = el.shadowRoot!.querySelector(`svg line[data-d="${index}"]`)!;
      line.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-pop-do")!.click();
    }

    function dialogText(el: FloorplanStudioCard): string | null {
      return el.shadowRoot!.querySelector(".fp-dialog p")?.textContent ?? null;
    }

    function confirmButtonText(el: FloorplanStudioCard): string | null {
      return el.shadowRoot!.querySelector(".fp-dialog button.confirm")?.textContent?.trim() ?? null;
    }

    it("a tap on a cover door opens the popup only: no dialog and no service until its button is pressed (S14.2)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ [garageEntity]: st("closed") }), callService } as never;
      await el.updateComplete;
      const line = el.shadowRoot!.querySelector(`svg line[data-d="${garageIndex}"]`)!;
      line.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('.fp-pop[role="dialog"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector(".fp-pop-do")!.textContent!.trim()).toBe("Open");
      expect(dialogText(el)).toBeNull();
      expect(callService).not.toHaveBeenCalled();
    });

    it("a tap on a door with a closed cover opens an in-card dialog reading \"Open <name>?\" with an Open button", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ [garageEntity]: st("closed") }) as never;
      await el.updateComplete;
      expect(dialogText(el)).toBeNull(); // nothing shown before the tap

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
      await el.updateComplete;
      const line = el.shadowRoot!.querySelector(`svg line[data-d="${garageIndex}"]`)!;
      line.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll(".fp-dialog")).toHaveLength(1);
      expect(el.shadowRoot!.querySelector(".fp-pop")).toBeNull(); // and no popup behind it
    });

    it("Escape cancels: closes the dialog and calls no service", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const callService = vi.fn();
      el.hass = { ...stubHass({ [garageEntity]: st("closed") }), callService } as never;
      await el.updateComplete;

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
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

      await tap(el, garageIndex);
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

      await expect(tap(el, garageIndex)).resolves.not.toThrow();
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
      l.floors.ground.rooms.push({ id: "pond", name: "Pond", area: "", kind: "water", pts: [[10, 10], [60, 10], [60, 60], [10, 60]], wk: ["wall", "wall", "wall", "wall"], entity: "switch.pond_pump" });
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
      l.floors.ground.rooms.push({ id: "pond2", name: "Pond2", area: "", kind: "water", pts: [[10, 10], [60, 10], [60, 60], [10, 60]], wk: ["wall", "wall", "wall", "wall"] });
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
      el.hass = stubHass({ "cover.gate": st("open", { attributes: { device_class: "garage" } }) }) as never; // a cover is on only as a garage, gate or door
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

  it("S8.2: getGridOptions gives HA's sections layout 12 columns, a numeric rows matching getCardSize, and floors for a narrow or short card", async () => {
    const el = await mount();
    el.setConfig({ layout: structuredClone(L) });
    el.hass = stubHass() as never;
    await el.updateComplete;
    const opts = el.getGridOptions();
    expect(opts.columns).toBe(12);
    expect(opts.rows).toBe(el.getCardSize()); // same aspect math; a fixed-height row and a masonry card size must not disagree
    expect(opts.min_columns).toBeGreaterThan(0);
    expect(opts.min_rows).toBeGreaterThan(0);
  });

  it("S8.2: getGridOptions.rows changes with layout.rotate, same as getCardSize", async () => {
    const el = await mount();
    const unturned = structuredClone(L);
    el.setConfig({ layout: unturned });
    el.hass = stubHass() as never;
    await el.updateComplete;
    const rowsAt0 = el.getGridOptions().rows;

    const el2 = await mount();
    const turned = structuredClone(L);
    turned.rotate = 90;
    el2.setConfig({ layout: turned });
    el2.hass = stubHass() as never;
    await el2.updateComplete;
    const rowsAt90 = el2.getGridOptions().rows;

    expect(rowsAt90).not.toBe(rowsAt0);
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

  // S9.2: icons stay visible on large plans. The card scales the icon group by 1 / (auto * icon_size), where
  // `auto = max(1, longest side of the fit view box / 1000)` — the same box `render()` already computes with
  // `viewBoxFor`. A synthetic floor whose outline is 1880 cm square gives, after the fixed 60 cm pad on every
  // side, a view box exactly 2000x2000 — auto = 2 on the nose, so the expected scale is exact, not approximate.
  // The demo's own ground floor gives auto = 1.04, not 1: its garden and pond sit outside the outline (0.12.14
  // fix, `viewBoxFor` bounds on every point on the floor, not the outline alone), so its fit view box is 1040 cm
  // on its longest side, not 1000.
  describe("S9.2: icons stay visible on large plans", () => {
    /** A floor whose fit view box (outline + the fixed 60 cm pad) is exactly `side` cm square, so `auto` comes
     * out as a round number. One light device near the centre, so a Playwright sibling test can click it. */
    function bigFloor(side: number) {
      const o = side - 120; // pad is 60 on every edge
      return {
        title: "Big", outline: [[0, 0], [o, 0], [o, o], [0, o]], owk: ["wall", "wall", "wall", "wall"],
        rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
        devices: [{ id: "light-big", type: "light", entity: "light.demo_big", name: "Big light", x: o / 2, y: o / 2 }],
      };
    }

    function layoutWithBigFloor(side: number): Layout {
      const l = structuredClone(L);
      (l.floors as Record<string, unknown>).big = bigFloor(side);
      return l;
    }

    it("the demo (auto 1.04, no icon_size) renders with scale 1 / 1.04", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground" });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(lastRenderState().scale).toBeCloseTo(1 / 1.04, 10);
    });

    it("a 2000 cm plan (view box exactly 2000 cm on its longest side) scales the icon group 2x, i.e. scale 0.5", async () => {
      const el = await mount();
      el.setConfig({ layout: layoutWithBigFloor(2000), floor: "big" });
      el.hass = stubHass({ "light.demo_big": st("off") }) as never;
      await el.updateComplete;
      expect(lastRenderState().scale).toBeCloseTo(0.5, 10);
    });

    it("icon_size 1.5 on the demo (auto 1.04) gives scale 1/(1.04*1.5)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground", icon_size: 1.5 });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(lastRenderState().scale).toBeCloseTo(1 / (1.04 * 1.5), 10);
    });

    it("icon_size 0 and -1 clamp to 0.5, so scale is 1/(1.04*0.5) on the demo", async () => {
      for (const bad of [0, -1]) {
        const el = await mount();
        el.setConfig({ layout: structuredClone(L), floor: "ground", icon_size: bad });
        el.hass = stubHass() as never;
        await el.updateComplete;
        expect(lastRenderState().scale, `icon_size ${bad}`).toBeCloseTo(1 / (1.04 * 0.5), 10);
      }
    });

    it("icon_size 10 clamps to 3, so scale is 1/(1.04*3) on the demo", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground", icon_size: 10 });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(lastRenderState().scale).toBeCloseTo(1 / (1.04 * 3), 10);
    });

    it('icon_size "big" (non-numeric) and NaN fall back to the default 1, so scale is 1/1.04 on the demo', async () => {
      for (const bad of ["big" as unknown as number, NaN] as const) {
        const el = await mount();
        el.setConfig({ layout: structuredClone(L), floor: "ground", icon_size: bad });
        el.hass = stubHass() as never;
        await el.updateComplete;
        expect(lastRenderState().scale, `icon_size ${String(bad)}`).toBeCloseTo(1 / 1.04, 10);
      }
    });
  });

  // S9.5: the floating active-devices panel. `src/core/active.ts` (tests/core/active.test.ts) already covers the
  // per-DEVICE_TYPE decision table; these tests are the card's own integration of it — the exact set against a
  // stub hass copying HA's real state shape (CLAUDE.md finding 21), every floor at once (not only the one drawn),
  // and the config keys that hide it.
  describe("S9.5: the active-devices panel", () => {
    beforeEach(() => {
      try { localStorage.clear(); } catch { /* jsdom always has one; guard anyway, same contract as the card's own reads */ }
    });

    /** The panel's own rows, as `[groupLabel, [rowNames...]][]`, in DOM order — the same shape `groupActiveByType`
     *  hands the template, read back out of the rendered shadow DOM rather than assumed. */
    function panelGroups(el: FloorplanStudioCard): [string, string[]][] {
      const groups = el.shadowRoot!.querySelectorAll(".fp-active-group");
      return [...groups].map((g) => [
        g.querySelector(".fp-cat-name")!.textContent!,
        [...g.querySelectorAll(".fp-active-row span")].map((s) => s.textContent!),
      ]);
    }

    it("lists exactly the active devices across every floor, not only the one the plan shows, grouped by type with a count", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) }); // floor unset, multiple floors: the plan itself shows "ground" only
      el.hass = stubHass({
        "light.demo_living": st("on"),
        "light.demo_bedroom": st("on"), // "first" floor: never drawn, but must still be listed (S9.5: every floor)
        "media_player.demo_office": st("playing"),
        "person.demo_alex": st("home"),
      }) as never;
      await el.updateComplete;

      const panel = el.shadowRoot!.querySelector(".fp-active");
      expect(panel).toBeTruthy();
      expect(panel!.querySelector(".fp-active-count")!.textContent).toBe("5"); // 2 lights + camera (always) + media + person
      expect(panelGroups(el)).toEqual([
        ["Lights", ["Living light", "Bedroom light"]],
        ["Security", ["Hall camera"]],
        ["Media", ["Office speaker"]],
        ["People", ["Alex"]],
      ]);
    });

    it("S14.6: a category header is a button that folds its group, aria-expanded follows, and the fold is remembered per card", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "light.demo_living": st("on"), "media_player.demo_office": st("playing") }) as never;
      await el.updateComplete;
      const head = (cat: string) => el.shadowRoot!.querySelector<HTMLButtonElement>(`.fp-active-group[data-cat="${cat}"] button.fp-cat`)!;
      const rows = (cat: string) => el.shadowRoot!.querySelectorAll(`.fp-active-group[data-cat="${cat}"] .fp-active-row`).length;
      expect(head("lights").getAttribute("aria-expanded")).toBe("true");
      expect(rows("lights")).toBe(1);
      head("lights").click();
      await el.updateComplete;
      expect(head("lights").getAttribute("aria-expanded")).toBe("false");
      expect(rows("lights")).toBe(0);
      expect(head("lights").querySelector(".fp-active-count")!.textContent).toBe("1"); // the count stays
      expect(rows("media")).toBe(1); // the others are untouched
      // a second card with the same config reads the fold back
      const el2 = await mount();
      el2.setConfig({ layout: structuredClone(L) });
      el2.hass = stubHass({ "light.demo_living": st("on"), "media_player.demo_office": st("playing") }) as never;
      await el2.updateComplete;
      expect(el2.shadowRoot!.querySelector('.fp-active-group[data-cat="lights"] button.fp-cat')!.getAttribute("aria-expanded")).toBe("false");
      expect(el2.shadowRoot!.querySelectorAll('.fp-active-group[data-cat="media"] .fp-active-row').length).toBe(1);
      // and a click again opens it, and storage that throws or holds junk never breaks the panel
      head("lights").click();
      await el.updateComplete;
      expect(rows("lights")).toBe(1);
    });

    it("S14.6: junk in the fold storage opens every group", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      const keys = () => Object.keys(localStorage).filter((k) => k.startsWith("fp-active-cats:"));
      el.hass = stubHass({ "light.demo_living": st("on") }) as never;
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>("button.fp-cat")!.click();
      const k = keys()[0];
      expect(k).toBeTruthy();
      localStorage.setItem(k, "{not json");
      const el2 = await mount();
      el2.setConfig({ layout: structuredClone(L) });
      el2.hass = stubHass({ "light.demo_living": st("on") }) as never;
      await el2.updateComplete;
      expect(el2.shadowRoot!.querySelector("button.fp-cat")!.getAttribute("aria-expanded")).toBe("true");
    });

    it("a bound light is listed from its switch even with the light entity itself off (reuses classOf, S9.5 spec)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "light.demo_living": st("off"), "switch.demo_living_relay": st("on") }) as never;
      await el.updateComplete;
      const names = [...el.shadowRoot!.querySelectorAll(".fp-active-row span")].map((s) => s.textContent);
      expect(names).toContain("Living light");
    });

    it("says 'Nothing on' when nothing is active but the camera still keeps the panel open (a camera is always listed)", async () => {
      const el = await mount();
      const noCam = structuredClone(L);
      noCam.floors.ground.devices = noCam.floors.ground.devices.filter((d) => d.type !== "camera");
      el.setConfig({ layout: noCam });
      el.hass = stubHass() as never; // every device off in the stub
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-empty")?.textContent).toBe("Nothing on");
      expect(el.shadowRoot!.querySelector(".fp-active-count")!.textContent).toBe("0");
    });

    it("a real click on a row opens that row's own popup (no operation), whose More info fires hass-more-info for its entity, not another's", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "light.demo_living": st("on") }) as never;
      await el.updateComplete;
      const events: CustomEvent[] = [];
      el.addEventListener("hass-more-info", (e) => events.push(e as CustomEvent));
      const rows = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-active-row")];
      const cameraRow = rows.find((r) => r.querySelector("span")?.textContent === "Hall camera")!;
      cameraRow.click();
      await el.updateComplete;
      expect(events).toHaveLength(0);
      expect(el.shadowRoot!.querySelector(".fp-pop")!.getAttribute("aria-label")).toBe("Hall camera");
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-pop-more")!.click();
      expect(events).toHaveLength(1);
      expect(events[0]!.detail).toEqual({ entityId: "camera.demo_hall" });
    });

    it("the collapse button hides the body but keeps the header and count, and is reachable by keyboard as a real button", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass({ "light.demo_living": st("on") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-body")).toBeTruthy();
      const collapseBtn = el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse")!;
      expect(collapseBtn.tagName).toBe("BUTTON"); // Enter/Space activate a real button natively, no key handler needed
      collapseBtn.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-body")).toBeNull();
      expect(el.shadowRoot!.querySelector(".fp-active-count")!.textContent).toBe("2"); // the light plus the always-listed camera
    });

    it("kiosk hides the panel even though active_list defaults to shown", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), kiosk: true });
      el.hass = stubHass({ "light.demo_living": st("on") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active")).toBeNull();
    });

    it("active_list: false hides the panel", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), active_list: false });
      el.hass = stubHass({ "light.demo_living": st("on") }) as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active")).toBeNull();
    });

    it("collapsed state survives a fresh card instance (localStorage), keyed so a different config does not share it", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass() as never;
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-body")).toBeNull();

      // A second card, same config (same storage key): reopens already collapsed.
      const el2 = await mount();
      el2.setConfig({ layout: structuredClone(L) });
      el2.hass = stubHass() as never;
      await el2.updateComplete;
      expect(el2.shadowRoot!.querySelector(".fp-active-body")).toBeNull();

      // A third card pinned to a different floor (different storage key per Opus review finding 7): opens fresh.
      const el3 = await mount();
      el3.setConfig({ layout: structuredClone(L), floor: "first" });
      el3.hass = stubHass() as never;
      await el3.updateComplete;
      expect(el3.shadowRoot!.querySelector(".fp-active-body")).toBeTruthy();
    });

    it("Opus review finding 7: two cards in websocket mode (no layout/layout_url, the default install) pinned to different floors keep separate storage, not one shared key", async () => {
      const sendMessagePromise = vi.fn(async () => ({ layout: structuredClone(L) }));
      const el = await mount();
      el.setConfig({ floor: "ground" });
      el.hass = { ...stubHass(), connection: { sendMessagePromise } } as never;
      await el.updateComplete;
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector(".fp-active")).toBeTruthy());
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-body")).toBeNull();

      const el2 = await mount();
      el2.setConfig({ floor: "first" });
      el2.hass = { ...stubHass(), connection: { sendMessagePromise } } as never;
      await el2.updateComplete;
      await vi.waitFor(() => expect(el2.shadowRoot!.querySelector(".fp-active")).toBeTruthy());
      expect(el2.shadowRoot!.querySelector(".fp-active-body")).toBeTruthy(); // its own key: opens fresh, uncollapsed
    });

    it("Opus review finding 7: an edited inline layout keeps its storage key (the seed is the layout's source, not its content)", async () => {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L) });
      el.hass = stubHass() as never;
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-body")).toBeNull();

      // Same card, edited layout (autosave-style setConfig with different device content): still collapsed.
      const edited = structuredClone(L);
      edited.floors.ground.devices = edited.floors.ground.devices.slice(1);
      el.setConfig({ layout: edited });
      el.hass = stubHass() as never;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-body")).toBeNull();
    });
  });

  // S9.6: a card pinned to one room, corridor or part of a home via `center`/`zoom_level`. `fit` below is the
  // ground floor's own real viewBoxFor box (60 cm pad, no rotate), computed the same way render() computes it —
  // asserting against a literal box here would silently stop meaning anything the day the demo layout changes.
  describe("S9.6: a card pinned to one room (center, zoom_level)", () => {
    const viewBox = (el: FloorplanStudioCard) => {
      const [x, y, w, h] = el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number);
      return { x: x!, y: y!, w: w!, h: h! };
    };
    const fit = () => viewBoxFor(L.floors.ground, 60);

    async function withConfig(config: Record<string, unknown>) {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground", ...config });
      el.hass = stubHass() as never;
      await el.updateComplete;
      return el;
    }

    it("center and zoom_level together: a box of fit/zoom size, centred on the asymmetric point given, not fit's own centre", async () => {
      const el = await withConfig({ center: [300, 700], zoom_level: 2.5 });
      const box = viewBox(el);
      const f = fit();
      expect(box.w).toBeCloseTo(f.w / 2.5, 6);
      expect(box.h).toBeCloseTo(f.h / 2.5, 6);
      expect(box.x + box.w / 2).toBeCloseTo(300, 6);
      expect(box.y + box.h / 2).toBeCloseTo(700, 6);
      // Not fit's own centre — an asymmetric input must give an asymmetric result (finding 4: a version that
      // silently ignored `center` and only applied `zoom_level` about fit's middle would pass a naive test too).
      expect(box.x + box.w / 2).not.toBeCloseTo(f.x + f.w / 2, 0);
    });

    it("clamps a centre near the plan edge to stay on the plan (the same clamp() every zoom gesture uses)", async () => {
      const f = fit();
      const el = await withConfig({ center: [f.x - 5000, f.y - 5000], zoom_level: 6 });
      const box = viewBox(el);
      expect(box.w).toBeCloseTo(f.w / 6, 6);
      const ox = Math.min(box.x + box.w, f.x + f.w) - Math.max(box.x, f.x);
      const oy = Math.min(box.y + box.h, f.y + f.h) - Math.max(box.y, f.y);
      expect(ox).toBeCloseTo(box.w / 3, 3);
      expect(oy).toBeCloseTo(box.h / 3, 3);
    });

    it("zoom_level alone zooms about fit's own centre", async () => {
      const el = await withConfig({ zoom_level: 4 });
      const box = viewBox(el);
      const f = fit();
      expect(box.w).toBeCloseTo(f.w / 4, 6);
      expect(box.x + box.w / 2).toBeCloseTo(f.x + f.w / 2, 6);
      expect(box.y + box.h / 2).toBeCloseTo(f.y + f.h / 2, 6);
    });

    it("center alone (zoom_level unset) changes nothing: the box is fit exactly", async () => {
      const el = await withConfig({ center: [123, 456] });
      expect(viewBox(el)).toEqual(fit());
    });

    it("center alone with zoom_level explicitly 1 also changes nothing", async () => {
      const el = await withConfig({ center: [123, 456], zoom_level: 1 });
      expect(viewBox(el)).toEqual(fit());
    });

    it("neither key set: fit, exactly as before S9.6", async () => {
      const el = await withConfig({});
      expect(viewBox(el)).toEqual(fit());
    });

    it("zoom_level clamps into [1, MAX_ZOOM]: 0, a negative number and past MAX_ZOOM all clamp rather than being refused", async () => {
      const f = fit();
      for (const [given, want] of [[0, 1], [-3, 1], [50, MAX_ZOOM]] as const) {
        const el = await withConfig({ zoom_level: given });
        expect(viewBox(el).w, `zoom_level ${given}`).toBeCloseTo(f.w / want, 6);
      }
    });

    it("a malformed center is ignored, silently (CLAUDE.md finding 1): never thrown on, box falls back to fit/zoom_level about the centre", async () => {
      const f = fit();
      for (const bad of [[1, 2, 3], [1], "nope", 5, null, [Number.NaN, 1], ["a", "b"]] as unknown[]) {
        const el = await withConfig({ center: bad, zoom_level: 3 });
        const box = viewBox(el);
        expect(box.w, `center ${JSON.stringify(bad)}`).toBeCloseTo(f.w / 3, 6);
        expect(box.x + box.w / 2, `center ${JSON.stringify(bad)}`).toBeCloseTo(f.x + f.w / 2, 6);
      }
    });

    it("a malformed zoom_level is ignored, silently: falls back to 1 (fit), never thrown on", async () => {
      for (const bad of ["big", Number.NaN, null, undefined, [2]] as unknown[]) {
        const el = await withConfig({ zoom_level: bad });
        expect(viewBox(el), `zoom_level ${JSON.stringify(bad)}`).toEqual(fit());
      }
    });

    it("does not throw setConfig, unlike the typo-throwing zoom/kiosk keys — center/zoom_level always fall back", () => {
      const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
      expect(() => el.setConfig({ layout: structuredClone(L), center: "nonsense" as never, zoom_level: "nonsense" as never })).not.toThrow();
    });

    it("the icon scale (S9.2) is unaffected by a pin: same scale with or without center/zoom_level", async () => {
      const withoutPin = await withConfig({});
      const scaleWithoutPin = lastRenderState().scale;
      expect(withoutPin).toBeTruthy();
      const withPin = await withConfig({ center: [300, 700], zoom_level: 3 });
      expect(lastRenderState().scale).toBe(scaleWithoutPin);
      expect(withPin).toBeTruthy();
    });

    it("the fp-zoomed class reads against the pinned home, not the whole floor: a pinned card is not \"zoomed\" at rest", async () => {
      const el = await withConfig({ center: [300, 700], zoom_level: 3 });
      const svg = el.shadowRoot!.querySelector("svg")!;
      expect(svg.getAttribute("class")).toBe("fp-zoomable");
    });

    // Opus review, 2026-09-27: `center` is documented as plan cm — the same unrotated coordinates a device sits at
    // in the layout — but the card's own box (`viewBoxFor`/`renderFloor`) is already in the *rendered* frame once
    // `rotate` is set (they turn every point themselves, unlike the editor, which draws unrotated coordinates
    // inside a rotated `<g>`). Passing the raw config centre straight into `pinnedView` pinned the wrong spot on
    // any rotated layout. `deg: 135` (not a 90°-multiple; schema only allows steps of 45, `validate` in
    // src/core/schema.ts) rules out a fix that only special-cases plain right angles.
    it("a rotated layout pins the config's plan-cm centre at the same plan point, not the unrotated one", async () => {
      const deg = 135;
      const rotated: Layout = { ...structuredClone(L), rotate: deg };
      const pivot = planPivot(rotated);
      const centerPlanCm: [number, number] = [200, 500]; // asymmetric, on the demo's 800x600 outline
      const expected = rotateAbout(centerPlanCm, deg, pivot);
      const fit = viewBoxFor(rotated.floors.ground, 60, { deg, pivot });

      const el = await mount();
      el.setConfig({ layout: rotated, floor: "ground", center: centerPlanCm, zoom_level: 3 });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const box = viewBox(el);
      expect(box.w).toBeCloseTo(fit.w / 3, 6);
      expect(box.x + box.w / 2).toBeCloseTo(expected[0], 6);
      expect(box.y + box.h / 2).toBeCloseTo(expected[1], 6);
      // Not the raw, unrotated centre either (finding 4: a version that never rotated at all would otherwise pass
      // whenever the rotated and unrotated points happen to coincide, which they do not here).
      expect(Math.abs(box.x + box.w / 2 - centerPlanCm[0])).toBeGreaterThan(5);
    });

    it("rotate: 0 (or unset) leaves the centre exactly as before — the rotation fix changes nothing for a flat plan", async () => {
      const el = await withConfig({ center: [300, 700], zoom_level: 3 });
      const box = viewBox(el);
      const f = fit();
      expect(box.x + box.w / 2).toBeCloseTo(300, 6);
      expect(box.y + box.h / 2).toBeCloseTo(700, 6);
      expect(box.w).toBeCloseTo(f.w / 3, 6);
    });
  });

  // Opus review, 2026-09-27: several cards on one floor, each pinned to a different room via `center`/`zoom_level`,
  // used to share one `localStorage` key (the seed did not read either), so folding or dragging one card's active
  // panel moved every other card's panel too, on the next reload.
  describe("S9.6 review: the active panel's storage key includes center/zoom_level (Opus, 2026-09-27)", () => {
    beforeEach(() => {
      try { localStorage.clear(); } catch { /* jsdom always has one; guard anyway */ }
    });

    async function mountPinned(config: Record<string, unknown>) {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground", ...config });
      el.hass = stubHass() as never;
      await el.updateComplete;
      return el;
    }

    it("two cards pinned to different rooms on the same floor keep separate panel storage", async () => {
      const el1 = await mountPinned({ center: [300, 700], zoom_level: 2 });
      el1.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse")!.click();
      await el1.updateComplete;
      expect(el1.shadowRoot!.querySelector(".fp-active-body")).toBeNull();

      // A second card, same floor, pinned to a different room: its own key, opens fresh (not collapsed).
      const el2 = await mountPinned({ center: [123, 456], zoom_level: 3 });
      expect(el2.shadowRoot!.querySelector(".fp-active-body")).toBeTruthy();

      // A third card with the same center/zoom_level as the first really does share its key (by design: two
      // identically-pinned cards are the same "view" as far as the panel is concerned).
      const el3 = await mountPinned({ center: [300, 700], zoom_level: 2 });
      expect(el3.shadowRoot!.querySelector(".fp-active-body")).toBeNull();
    });

    it("an unpinned card's storage key is unchanged by this fix, so its stored position still applies", async () => {
      const el = await mountPinned({});
      el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".fp-active-body")).toBeNull();

      // Same config, fresh instance: reopens already collapsed, from the very same key an unpinned card has
      // always used (this only fails if appending center/zoom_level to the seed changed the key when neither is
      // set — the regression this test guards against).
      const el2 = await mountPinned({});
      expect(el2.shadowRoot!.querySelector(".fp-active-body")).toBeNull();
    });
  });

  // Diego field report, 0.12.14: "make the card always draggable" — `zoom: false` must turn off pinch, wheel and
  // the zoom buttons without turning off the one-finger pan `_bindZoom` binds regardless. jsdom has no layout
  // engine, so `getBoundingClientRect` is stubbed on the plan's own `<svg>` (the same trick `actions.test.ts`
  // documents for pointer events) — without it, `onMove`'s `r.width` is 0 and every drag divides by zero into a
  // box `clamp` throws away as non-finite, which would pass this test whether pan works or not (finding 4).
  //
  // `clamp()` itself (viewport.test.ts, "at fit zoom there is nothing to pan") snaps any pan back to `fit` exactly
  // once the view is as wide as `fit` — there is nothing off screen to reveal, so that is correct, not a bug. The
  // pan below therefore needs `zoom_level` to pin the card narrower than `fit` first, the same way a room-pinned
  // card would be configured; only then does a drag under `zoom: false` have anywhere to go.
  describe("S7.4 review, 0.12.14: pan is not gated by zoom: false", () => {
    const box = (el: FloorplanStudioCard) => {
      const [x, y, w, h] = el.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(/\s+/).map(Number);
      return { x: x!, y: y!, w: w!, h: h! };
    };

    /** A pointer event at client (x, y) with its own pointerId; see actions.test.ts's own copy of this helper.
     * `_bindZoom`'s own `onDown` reads `isPrimary` to tell a first finger from a second (pointer id 1 is always
     * the primary one here, matching how a real first touch/click arrives). */
    function at(el: Element, type: string, x: number, y: number, id = 1) {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(e, "pointerId", { value: id });
      Object.defineProperty(e, "isPrimary", { value: id === 1 });
      el.dispatchEvent(e);
    }

    async function mountDraggable(config: Record<string, unknown>) {
      const el = await mount();
      el.setConfig({ layout: structuredClone(L), floor: "ground", ...config });
      el.hass = stubHass() as never;
      await el.updateComplete;
      const svg = el.shadowRoot!.querySelector("svg")!;
      svg.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 300, width: 300, height: 300, toJSON: () => ({}) }) as DOMRect;
      return el;
    }

    it("a one-finger drag pans the plan even with zoom: false (TAP_SLOP_PX cleared first)", async () => {
      const el = await mountDraggable({ zoom: false, zoom_level: 2 }); // pinned narrower than fit: room to pan
      const fit = box(el);
      const svg = el.shadowRoot!.querySelector("svg")!;
      at(svg, "pointerdown", 100, 100);
      at(svg, "pointermove", 108, 100); // past TAP_SLOP_PX (6)
      at(svg, "pointermove", 140, 100);
      at(svg, "pointerup", 140, 100);
      await el.updateComplete;
      const panned = box(el);
      expect(panned.w).toBeCloseTo(fit.w, 6); // a pan never changes the zoom
      expect(panned.x).toBeCloseTo(fit.x - 40 * (fit.w / 300), 6); // the plan followed the pointer 40 px right
      expect(panned.y).toBeCloseTo(fit.y, 6);
    });

    it("with zoom: false a second pointer never joins as a pinch: only the first finger's drag moves the plan", async () => {
      const el = await mountDraggable({ zoom: false, zoom_level: 2 }); // pinned narrower than fit: room to pan
      const fit = box(el);
      const svg = el.shadowRoot!.querySelector("svg")!;
      at(svg, "pointerdown", 100, 100, 1);
      at(svg, "pointerdown", 200, 100, 2); // a second finger lands; must not start a pinch
      at(svg, "pointermove", 300, 100, 2); // moving the (ignored) second finger alone must not zoom
      await el.updateComplete;
      expect(box(el)).toEqual(fit);
      at(svg, "pointermove", 140, 100, 1); // the first finger, still tracked, keeps panning
      await el.updateComplete;
      const panned = box(el);
      expect(panned.w).toBeCloseTo(fit.w, 6);
      expect(panned.x).toBeCloseTo(fit.x - 40 * (fit.w / 300), 6);
    });

    it("a plain (zoom: true) card takes the same drag as a pinch source once a second finger joins", async () => {
      const el = await mountDraggable({});
      const fit = box(el);
      const svg = el.shadowRoot!.querySelector("svg")!;
      at(svg, "pointerdown", 100, 100, 1);
      at(svg, "pointerdown", 200, 100, 2); // zoom is on: this now IS a pinch start
      at(svg, "pointermove", 250, 100, 2); // fingers spreading apart: zooms in
      await el.updateComplete;
      expect(box(el).w).toBeLessThan(fit.w);
    });

    it("with no zoom_level pin a drag stays put: the whole floor is already on screen, nothing to reveal", async () => {
      const el = await mountDraggable({ zoom: false }); // no center/zoom_level: home is the whole floor, i.e. fit
      const fit = box(el);
      const svg = el.shadowRoot!.querySelector("svg")!;
      at(svg, "pointerdown", 100, 100);
      at(svg, "pointermove", 108, 100);
      at(svg, "pointermove", 140, 100);
      at(svg, "pointerup", 140, 100);
      await el.updateComplete;
      expect(box(el)).toEqual(fit);
    });
  });
});
