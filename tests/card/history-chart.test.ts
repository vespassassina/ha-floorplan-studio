import { describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { html, nothing } from "lit";
import { extractSeries, historyOverlayView } from "../../src/card/history";
import type { HistoryIndex, HistoryRow } from "../../src/card/replay/history";

const t = (k: string, vars?: Record<string, string | number>) =>
  vars ? k.replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? "")) : k;

describe("history chart chunk (S48)", () => {
  it("extracts numeric polylines (downsampled <= 120) and discrete state timelines safely", () => {
    const endMs = 1_700_000_000_000;
    const startMs = endMs - 24 * 3600_000;
    const numRows: HistoryRow[] = Array.from({ length: 180 }, (_, i) => ({
      state: String(20 + Math.sin(i / 10) * 3),
      attributes: { unit_of_measurement: "°C" },
      lu: (startMs + (i / 179) * (endMs - startMs)) / 1000,
      lc: (startMs + (i / 179) * (endMs - startMs)) / 1000,
    }));
    numRows.push({ state: "NaN", attributes: {}, lu: endMs / 1000, lc: endMs / 1000 });

    const discRows: HistoryRow[] = [
      { state: "off", attributes: {}, lu: startMs / 1000, lc: startMs / 1000 },
      { state: "on", attributes: {}, lu: (startMs + 3600_000) / 1000, lc: (startMs + 3600_000) / 1000 },
      { state: "off", attributes: {}, lu: (startMs + 7200_000) / 1000, lc: (startMs + 7200_000) / 1000 },
    ];

    const idx: HistoryIndex = new Map([
      ["sensor.room_temp", numRows],
      ["binary_sensor.motion", discRows],
      ["sensor.empty", []],
    ]);

    const series = extractSeries(
      idx,
      [
        { id: "sensor.room_temp", label: "Temp" },
        { id: "binary_sensor.motion", label: "Motion" },
        { id: "sensor.empty", label: "Empty" },
      ],
      startMs,
      endMs,
    );

    expect(series).toHaveLength(2);
    const s0 = series[0]!;
    expect(s0.kind).toBe("numeric");
    if (s0.kind === "numeric") {
      expect(s0.points.length).toBeLessThanOrEqual(120);
      expect(s0.unit).toBe("°C");
      expect(s0.min).toBeLessThan(20);
      expect(s0.max).toBeGreaterThan(20);
    }
    const s1 = series[1]!;
    expect(s1.kind).toBe("discrete");
    if (s1.kind === "discrete") {
      expect(s1.segments.some((g) => g.active && g.state === "on")).toBe(true);
      expect(s1.latest).toBe("off");
    }

    expect(extractSeries(undefined, [{ id: "x", label: "x" }], startMs, endMs)).toEqual([]);
  });

  it("renders polyline SVG, discrete strips, window controls, and empty/error states", () => {
    const endMs = 1_700_000_000_000;
    const startMs = endMs - 6 * 3600_000;
    const onWindow = vi.fn();
    const onClose = vi.fn();
    const host = document.createElement("div");

    render(historyOverlayView({ html, nothing, t }, {
      title: "Living",
      hours: 6,
      status: "ready",
      series: [
        {
          kind: "numeric",
          id: "sensor.t",
          label: "Temp",
          unit: "°C",
          points: [{ t: startMs, v: 20 }, { t: endMs, v: 22.5 }],
          min: 20,
          max: 22.5,
          latest: 22.5,
        },
        {
          kind: "discrete",
          id: "binary_sensor.m",
          label: "Motion",
          segments: [{ start: startMs, end: endMs, state: "on", active: true }],
          latest: "on",
        },
      ],
      startMs,
      endMs,
      closeIcon: "M0,0L1,1",
      onWindow,
      onClose,
    }), host);

    expect(host.querySelector(".fp-hist-ov")).not.toBeNull();
    expect(host.querySelector("polyline")).not.toBeNull();
    expect(host.querySelector(".fp-hist-bar rect[fill='var(--fp-primary)']")).not.toBeNull();
    host.querySelectorAll<HTMLButtonElement>(".fp-hist-win button")[1]!.click();
    expect(onWindow).toHaveBeenCalledWith(24);
    host.querySelector<HTMLButtonElement>(".fp-hist-x")!.click();
    expect(onClose).toHaveBeenCalledOnce();

    render(historyOverlayView({ html, nothing, t }, {
      title: "Living",
      hours: 24,
      status: "error",
      error: "No connection",
      series: [],
      startMs,
      endMs,
      closeIcon: "M0,0L1,1",
      onWindow,
      onClose,
    }), host);
    expect(host.textContent).toContain("No connection");
  });
});
