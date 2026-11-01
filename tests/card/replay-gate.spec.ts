import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { calibrate } from "./calibrate";

// R2.7, the 7-day gate (docs/specs/replay-2.md item 12, criterion 9): a floor of 180,000 rows over 93 entities, parsed and indexed as
// the card does it (replay-gate-workload.ts), in Chromium.
//
// Two tests. The CI test holds the workload to a RATIO of `calibrate`, never to milliseconds (S41.c: CI runs 3 to 6x slower than the Mac and
// absolute ceilings failed there by chance). The Mac test is the gate itself: 4x CPU throttling, under 1.5 s and 60 MB; it runs only with
// FP_GATE_MAC=1 and prints the figures that DECISIONS records.
//
// The ratio ceiling (derivation, 2026-11-01, Diego's Mac, Chromium, unthrottled, 10 runs of this test): see CEILING below.
//
// The page is vite's dev server (the Playwright webServer), which serves the real source on demand: `/@fs/<abs path>`.

const WORKLOAD = `/@fs${resolve("tests/card/replay-gate-workload.ts")}`;
const MS_LIMIT = 1500;
const HEAP_LIMIT = 60 * 1024 * 1024;
/**
 * Ceiling on (fastest of 9 runs of parse and index) / (median of 9 calibrates), unthrottled, Chromium on Diego's Mac, 2026-11-01.
 * Measured: 20 runs of this test, ratio 0.60 to 0.88, median 0.73 (the fastest run is a steady 10.6 to 13.8 ms, calibrate 15 to 18 ms).
 * With `fetchHistory` run twice inside the timed block (a parse twice as slow): 15 runs, ratio 1.10 to 1.42, all red. The ceiling, 1.0, sits
 * between the worst clean run and the best slowed one. A slow runner moves both sides of the ratio. NOT known: CI's own baseline (S41.c: CI
 * ratios for DOM work came out lower than the Mac's, so this one may sit higher or lower there; the first CI run says).
 */
const CEILING = 1.0;

interface Gate { timed(days?: number): Promise<{ ms: number; rows: number; onsets: number }>; jsonParseMs(days?: number): number; keep(days?: number): Promise<void>; release(): void }
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function open(page: Page) {
  await page.goto("/standalone.html");
  await page.evaluate(async (url) => { (window as unknown as { __gate: Gate }).__gate = (await import(/* @vite-ignore */ url)) as Gate; }, WORKLOAD);
}
const timed = (page: Page) => page.evaluate(() => (window as unknown as { __gate: Gate }).__gate.timed());

/** The heap the index holds once its reply is gone: used size after a GC with and without it, from the DevTools protocol. */
async function indexHeap(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  const used = async () => { await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize; };
  const before = await used();
  await page.evaluate(() => (window as unknown as { __gate: Gate }).__gate.keep());
  const after = await used();
  await page.evaluate(() => (window as unknown as { __gate: Gate }).__gate.release());
  await cdp.detach();
  return after - before;
}

test.describe("R2.7 the 7-day gate", () => {
  test("CI: parse and index hold a ratio to calibrate, and the index holds under 60 MB", async ({ page }) => {
    await open(page);
    // The first runs compile the code and are 2 to 3x slower; the card pays that once too, but the ratio is of the steady cost.
    for (let i = 0; i < 3; i++) await timed(page);
    // The machine is timed between the runs and the median is used: one calibrate swings 15 to 22 ms on a quiet Mac, and that swing, not the workload's, was the noise.
    const runs: number[] = [], cals: number[] = [];
    for (let i = 0; i < 9; i++) { cals.push(await calibrate(page)); runs.push((await timed(page)).ms); }
    const cal = median(cals);
    // The fastest run, not the median: GC pauses and the timer's share of 10 ms runs only add time, and a slower parseHistory raises every run.
    const best = Math.min(...runs), ratio = best / cal;
    const heap = await indexHeap(page);
    console.log(`GATE CI: parse+index best ${best.toFixed(1)} ms (runs ${runs.map((r) => r.toFixed(0)).join(" ")}), calibrate ${cal.toFixed(1)} ms, ratio ${ratio.toFixed(2)}, index heap ${(heap / 1048576).toFixed(1)} MB`);
    expect(ratio, `parse and index took ${ratio.toFixed(1)}x calibrate (${best.toFixed(1)} ms against ${cal.toFixed(1)} ms): a slowdown of parseHistory, fetchHistory or onsets, or a fixture that grew`).toBeLessThan(CEILING);
    expect(heap, "the index and onsets of 180,000 rows after a GC, in bytes").toBeLessThan(HEAP_LIMIT);
  });

  test("Mac: at 4x CPU throttling, under 1.5 s and 60 MB (FP_GATE_MAC=1)", async ({ page }) => {
    test.skip(!process.env.FP_GATE_MAC, "the Mac gate; set FP_GATE_MAC=1 to measure and print the figures");
    const out: { cold: number; warm: number; heap: number; json: number }[] = [];
    for (let i = 0; i < 5; i++) {
      // A fresh page each run: the first run in a page is the card's own, with the code not yet compiled. Warm is the second.
      await open(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const cold = (await timed(page)).ms, warm = (await timed(page)).ms, json = await page.evaluate(() => (window as unknown as { __gate: Gate }).__gate.jsonParseMs());
      const heap = await indexHeap(page);
      console.log(`GATE MAC run ${i + 1} at 4x: first run ${cold.toFixed(0)} ms, second ${warm.toFixed(0)} ms, index heap ${(heap / 1048576).toFixed(1)} MB; the client's JSON.parse of the reply ${json.toFixed(0)} ms`);
      out.push({ cold, warm, heap, json });
    }
    const col = (k: "cold" | "warm" | "heap" | "json") => out.map((o) => o[k]);
    console.log(`GATE MAC at 4x, 5 runs: first run median ${median(col("cold")).toFixed(0)} worst ${Math.max(...col("cold")).toFixed(0)} ms; second median ${median(col("warm")).toFixed(0)} worst ${Math.max(...col("warm")).toFixed(0)} ms; heap median ${(median(col("heap")) / 1048576).toFixed(1)} worst ${(Math.max(...col("heap")) / 1048576).toFixed(1)} MB; JSON.parse median ${median(col("json")).toFixed(0)} worst ${Math.max(...col("json")).toFixed(0)} ms`);
    expect(Math.max(...col("cold")), "parse and index at 4x throttle, first run, ms").toBeLessThan(MS_LIMIT);
    expect(Math.max(...col("heap")), "heap the index adds, bytes").toBeLessThan(HEAP_LIMIT);
  });
});
