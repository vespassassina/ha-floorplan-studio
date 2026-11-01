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
 * Ceiling on (fastest of 15 samples of 4 loads of parse and index) / (fastest of 15 calibrates), taken alternately, unthrottled, Chromium on Diego's Mac,
 * 2026-11-01. Clean, 30 runs: ratio 3.45 to 4.30, median 3.93. With the whole load (fetchHistory, onsets, purgedFrom) run twice, 15 runs: 7.36 to 9.93,
 * median 8.39. Ceiling 5.6 is 30 % above the worst clean run, and the best slowed run is 31 % above the ceiling. A slow runner moves both sides of the
 * ratio. NOT known: CI's own baseline (S41.c: CI ratios of DOM work came out lower than the Mac's); the first CI run says.
 */
const CEILING = 5.6;

interface Gate { timed(days?: number, times?: number): Promise<{ ms: number; rows: number; onsets: number }>; jsonParseMs(days?: number): number; keep(days?: number): Promise<void>; release(): void }
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function open(page: Page) {
  await page.goto("/standalone.html");
  await page.evaluate(async (url) => { (window as unknown as { __gate: Gate }).__gate = (await import(/* @vite-ignore */ url)) as Gate; }, WORKLOAD);
}
const timed = (page: Page, times = 1) => page.evaluate((n) => (window as unknown as { __gate: Gate }).__gate.timed(7, n), times);

/** The heap the index holds once its reply is gone: used size after a forced GC (twice) with and without it, the index kept referenced, from the DevTools protocol. */
async function indexHeap(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  const used = async () => { await cdp.send("HeapProfiler.collectGarbage"); await cdp.send("HeapProfiler.collectGarbage"); return (await cdp.send("Runtime.getHeapUsage")).usedSize; };
  await page.evaluate(() => (window as unknown as { __gate: Gate }).__gate.release());
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
    // Both sides the same way: the fastest of 15 samples, taken one after the other so a noisy patch of the machine hits both. A sample of the workload is
    // 4 loads (about 45 ms); a sample of calibrate is its own median of 5 builds (about 17 ms). Noise only adds time, so the fastest is the steady cost.
    const runs: number[] = [], cals: number[] = [];
    for (let i = 0; i < 15; i++) { runs.push((await timed(page, 4)).ms); cals.push(await calibrate(page)); }
    const best = Math.min(...runs), cal = Math.min(...cals), ratio = best / cal;
    const heap = await indexHeap(page);
    console.log(`GATE CI: parse+index best ${best.toFixed(1)} ms of 4 loads, calibrate best ${cal.toFixed(1)} ms, ratio ${ratio.toFixed(2)}, index heap ${(heap / 1048576).toFixed(1)} MB`);
    expect(ratio, `parse and index took ${ratio.toFixed(2)}x calibrate (${best.toFixed(1)} ms against ${cal.toFixed(1)} ms): a slowdown of parseHistory, fetchHistory or onsets, or a fixture that grew`).toBeLessThan(CEILING);
    // Only the upper bound: after two forced GCs either side the figure can still wander by a MB, even below zero (seen once at -0.7 MB). The real size is 13 MB, 4.6x under.
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
