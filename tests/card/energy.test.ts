import { describe, expect, it } from "vitest";
import { html, nothing, render } from "lit";
import { t } from "../../src/core/i18n";
import {
  ENERGY_CHUNK,
  bucketsAt,
  counterAt,
  deviceTreeAt,
  energyChipsView,
  energyOverlayView,
  parseEnergyPrefs,
  parseStats,
  statIdsFor,
} from "../../src/card/energy";

const T0 = Date.UTC(2026, 9, 28, 10, 0, 0);
const MIN = 60_000;
const B5 = 5 * MIN;

/** Hand-built HA 5-minute statistic rows starting at `t0`. */
function rows(t0: number, vals: ({ c: number | null; m?: number | null } | number | null)[]) {
  return vals.map((v, i) => {
    const start = t0 + i * B5;
    const end = start + B5;
    if (v === null) return { start, end, change: null, mean: null };
    if (typeof v === "number") return { start, end, change: v };
    return { start, end, change: v.c, ...(v.m !== undefined ? { mean: v.m } : {}) };
  });
}

// Verified against HA core `homeassistant/components/energy/data.py` and `websocket_api.py`.
const HA_UNIFIED_PREFS = {
  energy_sources: [
    {
      type: "grid",
      stat_energy_from: "sensor.grid_import",
      stat_cost: "sensor.grid_import_cost",
      entity_energy_price: null,
      number_energy_price: null,
      stat_energy_to: "sensor.grid_export",
      stat_compensation: "sensor.grid_export_compensation",
      entity_energy_price_export: null,
      number_energy_price_export: null,
      cost_adjustment_day: 0,
    },
    { type: "solar", stat_energy_from: "sensor.solar_prod", config_entry_solar_forecast: [] },
    { type: "gas", stat_energy_from: "sensor.gas_m3", stat_cost: null, number_energy_price: 1.5, entity_energy_price: null },
    { type: "water", stat_energy_from: "sensor.water_l", stat_cost: null, number_energy_price: null, entity_energy_price: "sensor.water_price" },
    { type: "battery", stat_energy_from: "sensor.batt_in", stat_energy_to: "sensor.batt_out" },
  ],
  device_consumption: [],
};

// Older HA `flow_from` / `flow_to` grid layout.
const HA_LEGACY_PREFS = {
  energy_sources: [
    {
      type: "grid",
      flow_from: [{ stat_energy_from: "sensor.imp_a", stat_cost: null, number_energy_price: 0.3, entity_energy_price: null }],
      flow_to: [{ stat_energy_to: "sensor.exp_a", stat_compensation: null, number_energy_price: 0.1, entity_energy_price: null }],
    },
    { type: "solar", stat_energy_from: "sensor.pv_a" },
  ],
};

describe("parseEnergyPrefs and statIdsFor (B56.2)", () => {
  it("parses unified HA energy/get_prefs and ignores battery", () => {
    const p = parseEnergyPrefs(HA_UNIFIED_PREFS);
    expect(p).not.toBeNull();
    expect(p!.gridFrom).toEqual([{ stat: "sensor.grid_import", cost: { statCost: "sensor.grid_import_cost" } }]);
    expect(p!.gridTo).toEqual([{ stat: "sensor.grid_export", cost: { statCost: "sensor.grid_export_compensation" } }]);
    expect(p!.solar).toEqual([{ stat: "sensor.solar_prod", cost: {} }]);
    expect(p!.gas).toEqual([{ stat: "sensor.gas_m3", cost: { fixedPrice: 1.5 } }]);
    expect(p!.water).toEqual([{ stat: "sensor.water_l", cost: { priceEntity: "sensor.water_price" } }]);
  });

  it("parses legacy flow_from/flow_to grid preferences", () => {
    const p = parseEnergyPrefs(HA_LEGACY_PREFS);
    expect(p!.gridFrom).toEqual([{ stat: "sensor.imp_a", cost: { fixedPrice: 0.3 } }]);
    expect(p!.gridTo).toEqual([{ stat: "sensor.exp_a", cost: { fixedPrice: 0.1 } }]);
    expect(p!.solar).toEqual([{ stat: "sensor.pv_a", cost: {} }]);
  });

  it("returns null when unconfigured or malformed, and drops XSS/prototype keys", () => {
    expect(parseEnergyPrefs(null)).toBeNull();
    expect(parseEnergyPrefs({ energy_sources: [] })).toBeNull();
    expect(parseEnergyPrefs({ energy_sources: [{ type: "battery", stat_energy_from: "s.b", stat_energy_to: "s.c" }] })).toBeNull();
    const xss = parseEnergyPrefs({
      energy_sources: [
        { type: "gas", stat_energy_from: "__proto__" },
        { type: "water", stat_energy_from: '"><script>alert(1)</script>' },
      ],
    });
    expect(xss?.gas ?? []).toHaveLength(0);
    expect(xss?.water[0].stat).toBe('"><script>alert(1)</script>');
  });

  it("collects deduplicated stat IDs and asks for mean only when entity price is active", () => {
    const unifiedIds = statIdsFor(parseEnergyPrefs(HA_UNIFIED_PREFS)!);
    expect(unifiedIds.needMean).toBe(true);
    expect(unifiedIds.ids).toEqual([
      "sensor.gas_m3",
      "sensor.grid_export",
      "sensor.grid_export_compensation",
      "sensor.grid_import",
      "sensor.grid_import_cost",
      "sensor.solar_prod",
      "sensor.water_l",
      "sensor.water_price",
    ]);

    const noMean = statIdsFor(parseEnergyPrefs(HA_LEGACY_PREFS)!);
    expect(noMean.needMean).toBe(false);
    expect(noMean.ids).toEqual(["sensor.exp_a", "sensor.imp_a", "sensor.pv_a"]);
  });
});

describe("counterAt 5-minute integration, cost rules, and gap handling (B56.3)", () => {
  it("integrates exact buckets and mid-bucket linear interpolation, using all 4 cost rules", () => {
    const prefs = parseEnergyPrefs(HA_UNIFIED_PREFS)!;
    const { ids } = statIdsFor(prefs);
    const stats = parseStats(
      {
        "sensor.grid_import": rows(T0, [1.0, 2.0, 1.0]),
        "sensor.grid_import_cost": rows(T0, [0.3, 0.6, 0.5]),
        "sensor.solar_prod": rows(T0, [0.5, 1.5, 2.0]),
        "sensor.grid_export": rows(T0, [0.2, 1.0, 1.5]),
        "sensor.grid_export_compensation": rows(T0, [0.02, 0.1, 0.2]),
        "sensor.gas_m3": rows(T0, [0.4, 0.8, 0.4]),
        "sensor.water_l": rows(T0, [10, 20, 50]),
        "sensor.water_price": rows(T0, [{ c: 0, m: 0.01 }, { c: 0, m: 0.02 }, { c: 0, m: 0.03 }]),
      },
      ids,
    );

    const endMs = T0 + 3 * B5;

    // t1 = T0 (start): 0 use, 0 cost
    const atStart = counterAt(prefs, stats, "electricity", T0, T0, endMs);
    expect(atStart).toMatchObject({ status: "ok", use: 0, cost: 0 });

    // t2 = T0 + 7 min (full bucket 0 + 2/5 = 0.4 of bucket 1)
    const tMid = T0 + 7 * MIN;
    // electricity use = (1.0 + 0.4*2.0) + (0.5 + 0.4*1.5) - (0.2 + 0.4*1.0) = 1.8 + 1.1 - 0.6 = 2.3
    // electricity stat_cost = 0.3 + 0.4*0.6 = 0.54
    const elecMid = counterAt(prefs, stats, "electricity", T0, tMid, endMs);
    expect(elecMid.status).toBe("ok");
    if (elecMid.status === "ok") {
      expect(elecMid.use).toBeCloseTo(2.3, 6);
      expect(elecMid.cost).toBeCloseTo(0.54, 6);
    }

    // solar use = 1.1, export compensation cost = 0.02 + 0.4*0.1 = 0.06
    const solarMid = counterAt(prefs, stats, "solar", T0, tMid, endMs);
    expect(solarMid.status).toBe("ok");
    if (solarMid.status === "ok") {
      expect(solarMid.use).toBeCloseTo(1.1, 6);
      expect(solarMid.cost).toBeCloseTo(0.06, 6);
    }

    // gas fixed price 1.5 * (0.4 + 0.4*0.8 = 0.72) = 1.08
    const gasMid = counterAt(prefs, stats, "gas", T0, tMid, endMs);
    expect(gasMid.status).toBe("ok");
    if (gasMid.status === "ok") {
      expect(gasMid.use).toBeCloseTo(0.72, 6);
      expect(gasMid.cost).toBeCloseTo(1.08, 6);
    }

    // water entity_energy_price mean * bucket change: 10*0.01 + (20*0.4)*0.02 = 0.1 + 0.16 = 0.26
    const waterMid = counterAt(prefs, stats, "water", T0, tMid, endMs);
    expect(waterMid.status).toBe("ok");
    if (waterMid.status === "ok") {
      expect(waterMid.use).toBeCloseTo(18, 6);
      expect(waterMid.cost).toBeCloseTo(0.26, 6);
    }

    // t3 = endMs (exact boundary): full 3 buckets
    const elecEnd = counterAt(prefs, stats, "electricity", T0, endMs, endMs);
    expect(elecEnd.status).toBe("ok");
    if (elecEnd.status === "ok") {
      expect(elecEnd.use).toBeCloseTo(5.3, 6); // (4.0) + (4.0) - (2.7) = 5.3
      expect(elecEnd.cost).toBeCloseTo(1.4, 6);
    }
  });

  it("shows cost: null when no price rule exists (use only)", () => {
    const prefs = parseEnergyPrefs({
      energy_sources: [{ type: "gas", stat_energy_from: "sensor.gas_only" }],
    })!;
    const stats = parseStats({ "sensor.gas_only": rows(T0, [1.2, 0.8]) }, ["sensor.gas_only"]);
    const got = counterAt(prefs, stats, "gas", T0, T0 + 2 * B5, T0 + 2 * B5);
    expect(got).toMatchObject({ status: "ok", use: 2.0, cost: null });
  });

  it("returns nodata on missing stat, null change, or missing interior/leading/trailing bucket (never 0)", () => {
    const prefs = parseEnergyPrefs({
      energy_sources: [
        { type: "gas", stat_energy_from: "sensor.gas_a" },
        { type: "water", stat_energy_from: "sensor.water_a" },
      ],
    })!;
    const endMs = T0 + 3 * B5;

    // Missing bucket in the middle (bucket 1 omitted)
    const gapMiddle = [rows(T0, [1])[0], rows(T0 + 2 * B5, [2])[0]];
    const nullRow = rows(T0, [1, null, 2]);
    // Leading gap (> 5 min after startMs)
    const leadGap = rows(T0 + 2 * B5, [2]);

    const stats = parseStats(
      { "sensor.gas_a": gapMiddle, "sensor.water_a": nullRow },
      ["sensor.gas_a", "sensor.water_a"],
    );
    expect(counterAt(prefs, stats, "gas", T0, endMs, endMs)).toEqual({ status: "nodata" });
    expect(counterAt(prefs, stats, "water", T0, endMs, endMs)).toEqual({ status: "nodata" });
    expect(counterAt(prefs, parseStats({}, ["sensor.gas_a"]), "gas", T0, endMs, endMs)).toEqual({ status: "nodata" });
    expect(counterAt(prefs, parseStats({ "sensor.gas_a": leadGap }, ["sensor.gas_a"]), "gas", T0, endMs, endMs)).toEqual({
      status: "nodata",
    });
  });
});

describe("energyChipsView rendering and settings (B56.4)", () => {
  it("renders present sources with sparklines, escapes strings, respects hide/show/spark settings, and shows no data on gap", () => {
    expect(ENERGY_CHUNK).toBe("fp-energy-v1");
    const prefs = parseEnergyPrefs(HA_UNIFIED_PREFS)!;
    const { ids } = statIdsFor(prefs);
    const stats = parseStats(
      {
        "sensor.grid_import": rows(T0, [1.0, 2.0]),
        "sensor.grid_import_cost": rows(T0, [0.3, 0.6]),
        "sensor.solar_prod": rows(T0, [0.5, 1.5]),
        "sensor.grid_export": rows(T0, [0.2, 0.4]),
        "sensor.grid_export_compensation": rows(T0, [0.02, 0.04]),
        // gas intentionally omitted -> "no data"
        "sensor.water_l": rows(T0, [10, 20]),
        "sensor.water_price": rows(T0, [{ c: 0, m: 0.01 }, { c: 0, m: 0.01 }]),
      },
      ids,
    );

    const host = document.createElement("div");
    render(
      energyChipsView(
        { html, nothing, t },
        {
          prefs,
          stats,
          startMs: T0,
          tMs: T0 + 2 * B5,
          endMs: T0 + 2 * B5,
          currency: "EUR",
          hass: { language: "en", states: { "sensor.water_l": { attributes: { unit_of_measurement: 'L"><script>' } } } },
        },
      ) as never,
      host,
    );

    const chips = [...host.querySelectorAll<HTMLElement>(".fp-en-chip")];
    expect(chips.map((c) => c.dataset.k)).toEqual(["electricity", "solar", "gas", "water"]);
    expect(host.querySelector("script")).toBeNull();
    expect(chips[0].textContent).toContain("4.4 kWh");
    expect(chips[0].textContent).toContain("€0.90");
    expect(chips[2].textContent).toContain("no data");
    expect(host.querySelectorAll(".fp-en-spark")).toHaveLength(3); // electricity, solar, water (gas is nodata)

    // Hide solar & gas, show cost only, spark off
    render(
      energyChipsView(
        { html, nothing, t },
        {
          prefs,
          stats,
          startMs: T0,
          tMs: T0 + 2 * B5,
          endMs: T0 + 2 * B5,
          currency: "EUR",
          hass: { language: "en" },
          settings: { hide: ["solar", "gas"], show: "cost", spark: false },
        },
      ) as never,
      host,
    );
    const filtered = [...host.querySelectorAll<HTMLElement>(".fp-en-chip")];
    expect(filtered.map((c) => c.dataset.k)).toEqual(["electricity", "water"]);
    expect(filtered[0].textContent).not.toContain("kWh");
    expect(filtered[0].textContent).toContain("€0.90");
    expect(host.querySelectorAll(".fp-en-spark")).toHaveLength(0);
  });
});

describe("B57.1/B57.2: bucketsAt, deviceTreeAt and energyOverlayView", () => {
  const PREFS_WITH_DEVICES = {
    energy_sources: [
      { type: "grid", stat_energy_from: "sensor.grid_import", stat_energy_to: "sensor.grid_export" },
      { type: "solar", stat_energy_from: "sensor.solar_prod" },
    ],
    device_consumption: [
      { stat_consumption: "sensor.hvac", name: "Heat pump" },
      { stat_consumption: "sensor.hvac_fan", name: "Fan", included_in_stat: "sensor.hvac" },
      { stat_consumption: "sensor.ev", name: "EV charger" },
      { stat_consumption: "sensor.cyc_a", included_in_stat: "sensor.cyc_b" },
      { stat_consumption: "sensor.cyc_b", included_in_stat: "sensor.cyc_a" },
    ],
  };

  it("parses device_consumption, includes device stat IDs, and builds nested tree with untracked remainder", () => {
    const prefs = parseEnergyPrefs(PREFS_WITH_DEVICES)!;
    expect(prefs.devices).toHaveLength(5);
    const { ids } = statIdsFor(prefs);
    expect(ids).toContain("sensor.hvac");
    expect(ids).toContain("sensor.hvac_fan");
    expect(ids).toContain("sensor.ev");

    const stats = parseStats(
      {
        "sensor.grid_import": rows(T0, [2, 2, 2]),
        "sensor.grid_export": rows(T0, [0, 0, 0]),
        "sensor.solar_prod": rows(T0, [1, 1, 1]),
        "sensor.hvac": rows(T0, [1, 1, 1]),
        "sensor.hvac_fan": rows(T0, [0.2, 0.2, 0.2]),
        "sensor.ev": rows(T0, [0.5, 0.5, 0.5]),
      },
      ids,
    );

    const tMs = T0 + 2 * B5;
    const c = counterAt(prefs, stats, "electricity", T0, tMs, T0 + 3 * B5);
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(c.use).toBeCloseTo(6);

    const tree = deviceTreeAt(prefs, stats, T0, tMs, undefined, c.use);
    expect(tree.roots.map((r) => r.stat)).toEqual(["sensor.hvac", "sensor.ev", "sensor.cyc_a", "sensor.cyc_b"]);
    expect(tree.roots[0].children.map((ch) => ch.stat)).toEqual(["sensor.hvac_fan"]);
    expect(tree.roots[0].use).toBeCloseTo(2);
    expect(tree.roots[0].children[0].use).toBeCloseTo(0.4);
    expect(tree.roots[1].use).toBeCloseTo(1);
    expect(tree.untracked).toBeCloseTo(3);
  });

  it("collects 5-minute buckets and renders overlay with faded post-t bars and t-line", () => {
    const prefs = parseEnergyPrefs(PREFS_WITH_DEVICES)!;
    const { ids } = statIdsFor(prefs);
    const stats = parseStats(
      {
        "sensor.grid_import": rows(T0, [1, 2, 3, 4]),
        "sensor.grid_export": rows(T0, [0, 0, 1, 0]),
        "sensor.solar_prod": rows(T0, [0.5, 0.5, 0.5, 0.5]),
        "sensor.hvac": rows(T0, [0.5, 0.5, 0.5, 0.5]),
        "sensor.hvac_fan": rows(T0, [0.1, 0.1, 0.1, 0.1]),
        "sensor.ev": rows(T0, [0.2, 0.2, 0.2, 0.2]),
      },
      ids,
    );
    const buckets = bucketsAt(prefs, stats, "electricity", T0, T0 + 4 * B5);
    expect(buckets.map((b) => b.value)).toEqual([1.5, 2.5, 2.5, 4.5]);

    const host = document.createElement("div");
    render(
      energyOverlayView(
        { html, nothing, t },
        {
          kind: "electricity",
          prefs,
          stats,
          startMs: T0,
          tMs: T0 + 2 * B5,
          endMs: T0 + 4 * B5,
          closeIcon: "M0,0",
          onClose: () => {},
          onDragStart: () => {},
        },
      ) as never,
      host,
    );
    expect(host.querySelectorAll(".fp-en-bar")).toHaveLength(4);
    expect(host.querySelectorAll(".fp-en-bar-after")).toHaveLength(2);
    expect(host.querySelector(".fp-en-tline")).not.toBeNull();
    expect(host.querySelector(".fp-en-tree")?.textContent).toContain("Heat pump");
    expect(host.querySelector(".fp-en-tree")?.textContent).toContain("Fan");
    expect(host.querySelector(".fp-en-untracked")?.textContent).toContain("Untracked");
  });
});
