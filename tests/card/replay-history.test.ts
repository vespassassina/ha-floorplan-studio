import { describe, expect, it } from "vitest";
import { REPLAY_CHUNK, fetchHistory, historyRequests, parseHistory, stateAt } from "../../src/card/replay/history";

// Shape of the reply, copied from Home Assistant core (checked 2026-10-28, branch dev):
//  - homeassistant/components/history/websocket_api.py: `history/history_during_period` answers with the result of
//    `get_significant_states`, an object { [entity_id]: CompressedState[] } with no wrapper.
//  - homeassistant/components/recorder/models/state.py (`row_to_compressed_state`): a row is { s, a?, lu, lc? }; `a` is left
//    out under no_attributes; `lc` is left out when it equals `lu`; both times are float seconds since the epoch.
//  - homeassistant/const.py: COMPRESSED_STATE_STATE "s", _ATTRIBUTES "a", _LAST_CHANGED "lc", _LAST_UPDATED "lu".

const T = (s: number) => s * 1000;
const ASKED = ["light.a", "sensor.b", "binary_sensor.c"];

const REPLY = {
  "light.a": [
    { s: "off", a: { brightness: 10 }, lu: 1000.5 },
    { s: "on", a: { brightness: 200 }, lu: 2000, lc: 1999 },
    { s: "off", lu: 3000 }, // no `a`: keeps the brightness of the row before
  ],
  "sensor.b": [{ s: "21.5", a: { unit: "C" }, lu: 1500, lc: 1400 }],
  "binary_sensor.c": [
    // Junk and unsorted: only the two valid rows stay, in time order.
    { s: "on", a: { x: 1 }, lu: 2500 },
    null,
    {},
    { s: "off", lu: "x" },
    { s: "off", lu: NaN },
    { s: 5, lu: 10 },
    { s: "off", lu: 1200 },
  ],
};

describe("parseHistory", () => {
  it("reads three entities, drops junk rows and sorts by lu", () => {
    const idx = parseHistory(REPLY, ASKED);
    expect([...idx.keys()].sort()).toEqual([...ASKED].sort());
    const c = idx.get("binary_sensor.c")!;
    expect(c.map((r) => r.state)).toEqual(["off", "on"]);
    expect(c.map((r) => r.lu)).toEqual([1200, 2500]);
    expect(idx.get("light.a")!).toHaveLength(3);
  });

  it("drops a time that is finite but past what a Date can hold, and stateAt never throws on the rest (B2)", () => {
    // new Date(1e20 * 1000).toISOString() throws RangeError; the limit is 8.64e12 seconds either way.
    const idx = parseHistory({
      "light.a": [{ s: "on", lu: 100, lc: 1e20 }, { s: "off", lu: -1e20 }, { s: "on", lu: 8.64e12 + 1 }, { s: "on", lu: 200, lc: -8.64e12 - 1 }],
    }, ["light.a"]);
    expect(idx.get("light.a")!.map((r) => [r.lu, r.lc])).toEqual([[100, 100], [200, 200]]); // bad lc is lc = lu; bad lu rows are gone
    expect(() => stateAt(idx, T(1e9))).not.toThrow();
    expect(stateAt(idx, T(150))["light.a"].last_changed).toBe(new Date(T(100)).toISOString());
  });

  it("gives an empty index for __proto__, constructor, a number, null, an array, a string", () => {
    const evil = JSON.parse('{"__proto__":[{"s":"on","lu":1}],"constructor":[{"s":"on","lu":1}]}');
    expect(parseHistory(evil, ["__proto__", "constructor"]).size).toBe(0);
    for (const bad of [5, null, undefined, "x", [], true]) expect(parseHistory(bad, ASKED).size).toBe(0);
  });

  it("drops an entity that was not asked for", () => {
    const idx = parseHistory({ "light.a": [{ s: "on", lu: 1 }], "light.other": [{ s: "on", lu: 1 }] }, ["light.a"]);
    expect([...idx.keys()]).toEqual(["light.a"]);
  });

  it("drops an entity whose list is not an array or has no valid row", () => {
    const idx = parseHistory({ "light.a": { s: "on", lu: 1 }, "sensor.b": [null, 3] }, ASKED);
    expect(idx.size).toBe(0);
  });
});

describe("stateAt", () => {
  const idx = parseHistory(REPLY, ASKED);

  it("is empty before every row", () => {
    expect(stateAt(idx, T(1000))).toEqual({});
  });

  it("takes the first row at its time, even by a fraction", () => {
    const s = stateAt(idx, T(1000.5));
    expect(Object.keys(s)).toEqual(["light.a"]);
    expect(s["light.a"].state).toBe("off");
    expect(s["light.a"].attributes).toEqual({ brightness: 10 });
  });

  it("takes the last row before t, one entity per its own rows", () => {
    const s = stateAt(idx, T(2100));
    expect(s["light.a"].state).toBe("on");
    expect(s["light.a"].attributes).toEqual({ brightness: 200 });
    expect(s["sensor.b"].state).toBe("21.5");
    expect(s["binary_sensor.c"].state).toBe("off");
  });

  it("takes a row exactly on its time, not the one before", () => {
    const s = stateAt(idx, T(2500));
    expect(s["binary_sensor.c"].state).toBe("on");
    expect(s["light.a"].state).toBe("on");
  });

  it("carries attributes forward over a row without them", () => {
    const s = stateAt(idx, T(3000));
    expect(s["light.a"].state).toBe("off");
    expect(s["light.a"].attributes).toEqual({ brightness: 200 });
  });

  it("holds the last row after the end", () => {
    const s = stateAt(idx, T(9e6));
    expect(s["light.a"].state).toBe("off");
    expect(s["binary_sensor.c"].state).toBe("on");
  });

  it("gives last_changed from lc as ISO, and from lu when lc is missing or not finite", () => {
    const s = stateAt(idx, T(2100));
    expect(s["light.a"].last_changed).toBe(new Date(T(1999)).toISOString());
    expect(s["binary_sensor.c"].last_changed).toBe(new Date(T(1200)).toISOString()); // lc missing: lu of the "off" row
    const odd = parseHistory({ "light.a": [{ s: "on", lu: 50, lc: "z" }] }, ["light.a"]);
    expect(stateAt(odd, T(60))["light.a"].last_changed).toBe(new Date(T(50)).toISOString());
  });

  it("starts attributes at {} when no row has any", () => {
    const i = parseHistory({ "light.a": [{ s: "on", lu: 5 }] }, ["light.a"]);
    expect(stateAt(i, T(6))["light.a"].attributes).toEqual({});
  });
});

// R2.1 (docs/specs/replay-2.md, item 1 and criteria 1 to 3). The minimal rows are copied from
// `homeassistant/components/recorder/history/modern.py` (`_sorted_states_to_dict` with minimal_response: the first row of an entity is
// the full compressed state { s, a, lu }, every later one is the short { s, lu }), the compressed shape from
// `homeassistant/components/recorder/models/state.py` and the reply wrapper from `homeassistant/components/history/websocket_api.py`
// (`{ [entity_id]: CompressedState[] }`, one reply per call, no wrapper). `lc` is left out when it equals `lu`.
const START = T(1000), END = T(2000);
type Msg = ReturnType<typeof historyRequests>[number];

describe("historyRequests (criterion 1)", () => {
  const ids = ["sun.sun", "light.a", "camera.c", "binary_sensor.d", "sensor.b", "light.a"];
  const [full, lean] = historyRequests(ids, START, END);

  it("sends two messages: the attribute domains in full, every other entity lean, sorted and unique", () => {
    expect(historyRequests(ids, START, END)).toHaveLength(2);
    expect(full).toEqual({
      type: "history/history_during_period",
      start_time: new Date(START).toISOString(),
      end_time: new Date(END).toISOString(),
      entity_ids: ["light.a"],
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: false,
      no_attributes: false,
    });
    expect(lean).toEqual({ ...full, entity_ids: ["binary_sensor.d", "camera.c", "sensor.b", "sun.sun"], significant_changes_only: true, minimal_response: true });
  });

  it("puts each entity in exactly one message, for every attribute domain", () => {
    const attr = ["light", "climate", "media_player", "cover", "fan", "vacuum", "water_heater", "humidifier"];
    const all = [...attr.map((d) => `${d}.x`), "sensor.x", "switch.x", "lock.x", "alarm_control_panel.x", "light_like.x"];
    const [a, b] = historyRequests(all, START, END);
    expect(a.entity_ids).toEqual(attr.map((d) => `${d}.x`).sort());
    expect(b.entity_ids).toEqual(["alarm_control_panel.x", "light_like.x", "lock.x", "sensor.x", "switch.x"]);
    expect([...a.entity_ids, ...b.entity_ids].sort()).toEqual([...all].sort());
  });

  it("sends one message for a floor of only sensors, one for only lights, none for no entities", () => {
    const only = historyRequests(["sensor.b", "binary_sensor.d"], START, END);
    expect(only).toHaveLength(1);
    expect(only[0].minimal_response).toBe(true);
    const lights = historyRequests(["light.a"], START, END);
    expect(lights).toHaveLength(1);
    expect(lights[0].minimal_response).toBe(false);
    expect(historyRequests([], START, END)).toEqual([]);
  });
});

describe("fetchHistory (criteria 2 and 3)", () => {
  // One fixture, as the old single call answered it (every row full) and as the pair answers it.
  const FULL = {
    "light.a": [
      { s: "off", a: { brightness: 10, rgb_color: [1, 2, 3] }, lu: 1000.5 },
      { s: "on", a: { brightness: 200, rgb_color: [255, 0, 40] }, lu: 1100, lc: 1100 },
      { s: "on", a: { brightness: 90, rgb_color: [9, 8, 7] }, lu: 1300, lc: 1100 }, // the colour changes, the state does not
      { s: "off", a: { brightness: 90, rgb_color: [9, 8, 7] }, lu: 1700 },
    ],
    "sensor.b": [
      { s: "21.5", a: { unit_of_measurement: "C", device_class: "temperature" }, lu: 1000.5 },
      { s: "22.25", a: { unit_of_measurement: "C", device_class: "temperature" }, lu: 1200 },
      { s: "19", a: { unit_of_measurement: "C", device_class: "temperature" }, lu: 1650 },
    ],
    "binary_sensor.d": [
      { s: "off", a: { device_class: "door" }, lu: 1000.5 },
      { s: "on", a: { device_class: "door" }, lu: 1400 },
      { s: "off", a: { device_class: "door" }, lu: 1900 },
    ],
  };
  const LEAN = {
    "sensor.b": [
      { s: "21.5", a: { unit_of_measurement: "C", device_class: "temperature" }, lu: 1000.5 },
      { s: "22.25", lu: 1200 },
      { s: "19", lu: 1650 },
    ],
    "binary_sensor.d": [{ s: "off", a: { device_class: "door" }, lu: 1000.5 }, { s: "on", lu: 1400 }, { s: "off", lu: 1900 }],
  };
  const ASKED_ALL = ["light.a", "sensor.b", "binary_sensor.d"];

  /** The stub answers each message with the entities it names, as HA does. */
  const server = (source: Record<string, unknown[]>, seen: Msg[] = []) => (m: Msg) => {
    seen.push(m);
    return Promise.resolve(Object.fromEntries(m.entity_ids.filter((id) => id in source).map((id) => [id, source[id]])));
  };

  it("gives the same state, unit, device class and lamp colour at ten moments as the one full reply", async () => {
    const seen: Msg[] = [];
    const lean = await fetchHistory(server({ ...FULL, ...LEAN, "light.a": FULL["light.a"] }, seen), ASKED_ALL, START, END);
    const old = parseHistory(FULL, ASKED_ALL);
    expect(seen).toHaveLength(2);
    // Asymmetric, none on a row's own second: before every row, between, on a row, after all.
    const moments = [999, 1000.5, 1099, 1100, 1150.3, 1299, 1301, 1651, 1801, 2500];
    for (const s of moments) expect(stateAt(lean, T(s)), `at ${s}`).toEqual(stateAt(old, T(s)));
    // Between the lamp's rows the colour is the row before's, and it differs from the next one's (so a mix-up fails).
    expect(stateAt(lean, T(1150.3))["light.a"].attributes).toEqual({ brightness: 200, rgb_color: [255, 0, 40] });
    expect(stateAt(lean, T(1301))["light.a"].attributes).toEqual({ brightness: 90, rgb_color: [9, 8, 7] });
    expect(stateAt(lean, T(1301))["sensor.b"].attributes).toEqual({ unit_of_measurement: "C", device_class: "temperature" });
    expect(stateAt(lean, T(1401))["binary_sensor.d"].attributes).toEqual({ device_class: "door" });
  });

  it("fails when the first call fails, when the second does, and when only the second never answers", async () => {
    const ok = server(FULL);
    const boom = { code: "unknown_error", message: "Recorder is not running" };
    await expect(fetchHistory((m) => (m.minimal_response ? ok(m) : Promise.reject(boom)), ASKED_ALL, START, END)).rejects.toEqual(boom);
    await expect(fetchHistory((m) => (m.minimal_response ? Promise.reject(boom) : ok(m)), ASKED_ALL, START, END)).rejects.toEqual(boom);
    const timeout = { code: "timeout", message: "x" };
    // The caller's `send` times each call out on its own; a rejection of the second alone must fail the floor though the first answered.
    await expect(fetchHistory((m) => (m.minimal_response ? Promise.reject(timeout) : ok(m)), ASKED_ALL, START, END)).rejects.toEqual(timeout);
  });

  it("sends nothing and gives an empty index for no entities", async () => {
    const seen: Msg[] = [];
    expect((await fetchHistory(server(FULL, seen), [], START, END)).size).toBe(0);
    expect(seen).toHaveLength(0);
  });
});

it("has a marker only this module carries", () => {
  expect(REPLAY_CHUNK).toBe("fp-replay-v1");
});
