import { afterEach, describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import "../../src/card/floorplan-studio-card";
import type { FloorplanStudioCard, Hass, HassEntity } from "../../src/card/floorplan-studio-card";
import type { ReplayState } from "../../src/card/card-replay";

// S39 field report: Home Assistant's recorder keeps the sun's state but not its azimuth and elevation, so a replayed sun.sun has
// no such attributes (rows copied from a real history reply of 2026-10-28, see tests/card/replay-bar.spec.ts). `_sun()` then works
// the sun out from the replayed time and Home Assistant's own location (`hass.config`, the frontend's HassConfig).
const L = demo as unknown as Layout;
const BERLIN = { latitude: 52.52, longitude: 13.4 };
const NOON = Date.UTC(2026, 5, 21, 11, 8); // solar noon in Berlin on the solstice: due south, about 61 degrees
const st = (state: string, attributes: Record<string, unknown> = {}): HassEntity => ({ state, attributes, last_changed: "2026-06-21T00:00:00Z" });

async function mount(opts: { replay?: { sun: HassEntity; at: number }; config?: Hass["config"]; liveSun?: HassEntity }): Promise<FloorplanStudioCard> {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  document.body.appendChild(el);
  el.setConfig({ layout: structuredClone(L), floor: "ground" } as never);
  el.hass = { states: opts.liveSun ? { "sun.sun": opts.liveSun } : {}, config: opts.config } as Hass;
  await el.updateComplete;
  if (opts.replay) {
    // The replay as the card holds it once the history is there: the states last drawn for the floor on show, at `drawnT`.
    const floor = {} as never;
    // The bar ends a day after the moment shown: at the end itself the plan is live (S39 polish), and these tests are about the past.
    el._replay = { end: opts.replay.at + 86400000, t: opts.replay.at, drawnT: opts.replay.at, floors: new Map([[el._floorKey()!, floor]]), drawn: { floor, states: { "sun.sun": opts.replay.sun } } } as unknown as ReplayState;
  }
  return el;
}
afterEach(() => { document.body.innerHTML = ""; });

describe("_sun() while replaying", () => {
  it("works the sun out from the replayed time and the home's location when the recorder kept no azimuth", async () => {
    const el = await mount({ replay: { sun: st("above_horizon"), at: NOON }, config: BERLIN });
    const s = el._sun()!;
    expect(s).not.toBeNull();
    expect(s.azimuth).toBeGreaterThan(175); expect(s.azimuth).toBeLessThan(185);
    expect(s.elevation).toBeGreaterThan(60); expect(s.elevation).toBeLessThan(62);
  });
  it("follows the replayed moment, not the clock: morning is east, afternoon west", async () => {
    const am = (await mount({ replay: { sun: st("above_horizon"), at: Date.UTC(2026, 5, 21, 6, 0) }, config: BERLIN }))._sun()!;
    const pm = (await mount({ replay: { sun: st("above_horizon"), at: Date.UTC(2026, 5, 21, 17, 0) }, config: BERLIN }))._sun()!;
    expect(am.azimuth).toBeLessThan(150); expect(pm.azimuth).toBeGreaterThan(210);
  });
  it("keeps recorded attributes when they are there", async () => {
    const el = await mount({ replay: { sun: st("above_horizon", { azimuth: 123, elevation: 17 }), at: NOON }, config: BERLIN });
    expect(el._sun()).toMatchObject({ azimuth: 123, elevation: 17 });
  });
  it("is no sun without a location, and none for a location that is junk", async () => {
    for (const config of [undefined, {}, { latitude: 52.5 }, { latitude: "x", longitude: 13 }, { latitude: 99, longitude: 13 }] as Hass["config"][]) {
      expect((await mount({ replay: { sun: st("above_horizon"), at: NOON }, config }))._sun(), JSON.stringify(config)).toBeNull();
    }
  });
});

describe("_sun() live", () => {
  it("does not compute: no attributes is no sun, even with a location", async () => {
    expect((await mount({ liveSun: st("above_horizon"), config: BERLIN }))._sun()).toBeNull();
  });
  it("still reads the entity's own attributes", async () => {
    expect((await mount({ liveSun: st("above_horizon", { azimuth: 200, elevation: 30 }), config: BERLIN }))._sun()).toMatchObject({ azimuth: 200, elevation: 30 });
  });
});
