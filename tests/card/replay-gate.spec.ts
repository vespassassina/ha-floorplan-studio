import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { calibrate } from "./calibrate";

// R2.7, the 7-day gate (docs/specs/replay-2.md item 12, criterion 9): a floor of 180,000 rows over 93 entities, parsed and indexed as
// the card does it (replay-gate-workload.ts), in Chromium.
//
// Two tests. The CI test holds the workload to a RATIO of `calibrate` and to a balance between its two stages, never to milliseconds (S41.c: CI runs 3 to 6x slower than the Mac and
// absolute ceilings failed there by chance). The Mac test is the gate itself: 4x CPU throttling, under 1.5 s and 60 MB; it runs only with
// FP_GATE_MAC=1 and prints the figures that DECISIONS records.
//
// The ceilings (derivation, 2026-11-01, Diego's Mac, Chromium, unthrottled): see CEILING below.
//
// The page is vite's dev server (the Playwright webServer), which serves the real source on demand: `/@fs/<abs path>`.

const WORKLOAD = `/@fs${resolve("tests/card/replay-gate-workload.ts")}`;
const MS_LIMIT = 1500;
const HEAP_LIMIT = 60 * 1024 * 1024;
/**
 * Two ceilings, because one ratio of the whole load hides a slowdown of one stage (Opus review of Sprint 44: parseHistory twice as slow read only 9 to 20 % over
 * the old single ceiling, `onsets` twice as slow passed). Measured 2026-11-01, Diego's Mac, Chromium, unthrottled, a fresh page per run, 25 samples of 4 loads each;
 * clean 30 runs, each stage twice as slow (the stage run twice, `FP_GATE_SLOW`) 15 runs each; the figures are in DECISIONS.
 *
 * 1. WHOLE: (fastest sample of the load) / (fastest `calibrate`), under 5.5. Catches the whole load, or both stages, getting slower; it follows the machine, so a
 *    runner whose layout is slower than its JavaScript (or the reverse) moves it. NOT known: CI's own baseline beyond the one run (3.22).
 * 2. BALANCE: (parse and index) / (onsets), the median of the 25 samples' ratios, between STAGE_LOW and STAGE_HIGH. Both stages are timed inside the same
 *    load, a moment apart, so the machine's speed cancels and no calibrate is needed: a slow or noisy runner moves both. Catches one stage getting slower than the
 *    other: parse twice as slow reads about 1.8x the clean ratio, onsets twice as slow about half of it. NOT known: a runner whose engine or memory shifts
 *    the balance between allocation (parse) and lookups (onsets) on its own; the bounds leave 26 % (high) and 34 % (low) each way on this Mac, the whole ceiling 24 to 36 %.
 */
const CEILING = 5.5;
const STAGE_LOW = 1.25, STAGE_HIGH = 2.62;
/** To see the gate catch a slower stage: FP_GATE_SLOW=parse (or onsets, or both) makes that stage run twice. The test then fails, as it should. */
const SLOW = process.env.FP_GATE_SLOW as "parse" | "onsets" | "both" | undefined;

interface Gate { timed(days?: number, times?: number, slow?: string): Promise<{ ms: number; parse: number; onsets: number; rows: number; events: number }>; jsonParseMs(days?: number): number; keep(days?: number): Promise<void>; release(): void }
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function open(page: Page) {
  await page.goto("/standalone.html");
  await page.evaluate(async (url) => { (window as unknown as { __gate: Gate }).__gate = (await import(/* @vite-ignore */ url)) as Gate; }, WORKLOAD);
}
const timed = (page: Page, times = 1, slow?: string) => page.evaluate(([n, s]) => (window as unknown as { __gate: Gate }).__gate.timed(7, n, s), [times, slow] as const);

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
  test("CI: the load holds a ratio to calibrate, its two stages hold their balance, and the index holds under 60 MB", async ({ page }) => {
    await open(page);
    // The first runs compile the code and are 2 to 3x slower; the card pays that once too, but the ratios are of the steady cost.
    for (let i = 0; i < 3; i++) await timed(page);
    // The fastest of 25 samples, taken one after the other with a calibrate between, so a noisy patch of the machine hits both. A sample of the workload is
    // 4 loads (about 45 ms); a sample of calibrate is its own median of 5 builds (about 17 ms). Noise only adds time, so the fastest is the steady cost.
    const runs: number[] = [], cals: number[] = [], balance: number[] = [];
    for (let i = 0; i < 25; i++) { const r = await timed(page, 4, SLOW); runs.push(r.ms); balance.push(r.parse / r.onsets); cals.push(await calibrate(page)); }
    const best = Math.min(...runs), cal = Math.min(...cals), ratio = best / cal, stage = median(balance);
    const heap = await indexHeap(page);
    console.log(`GATE CI${SLOW ? ` (${SLOW} slowed)` : ""}: load best ${best.toFixed(1)} ms of 4 loads, calibrate best ${cal.toFixed(1)} ms, whole ratio ${ratio.toFixed(2)}, parse/onsets ${stage.toFixed(2)}, index heap ${(heap / 1048576).toFixed(1)} MB`);
    expect(ratio, `the load took ${ratio.toFixed(2)}x calibrate (${best.toFixed(1)} ms against ${cal.toFixed(1)} ms): a slowdown of parseHistory, fetchHistory or onsets, or a fixture that grew`).toBeLessThan(CEILING);
    expect(stage, `parse and index took ${stage.toFixed(2)}x the time of onsets: above ${STAGE_HIGH} parseHistory or fetchHistory got slower, below ${STAGE_LOW} onsets did`).toBeGreaterThan(STAGE_LOW);
    expect(stage, `parse and index took ${stage.toFixed(2)}x the time of onsets: above ${STAGE_HIGH} parseHistory or fetchHistory got slower, below ${STAGE_LOW} onsets did`).toBeLessThan(STAGE_HIGH);
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
