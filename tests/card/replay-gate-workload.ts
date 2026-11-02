import { gateFixture, type Gate } from "./replay-gate-fixture";
import { fetchHistory, type HistoryIndex } from "../../src/card/replay/history";
import { onsets, type Onset } from "../../src/card/replay/events";
import { purgedFrom } from "../../src/card/replay/window";
import { coverActive } from "../../src/core/cover";
import { doorStateOf } from "../../src/core/door-state";
import { doorRoomIndexes } from "../../src/core/active";
import { roomAt } from "../../src/core/render";

// R2.7: what the card does when a floor's history arrives, run in the page by replay-gate.spec.ts (served by vite's dev server, so it is
// the real source, not a copy). The same calls as `loadFloor` in card-replay.ts: `fetchHistory` (both calls' parse, merged), `onsets`,
// `purgedFrom`. Not the plan's drawing, the strip or the bar: those run per frame and are not what grows with the window.

const END_MS = Date.UTC(2026, 9, 28, 12);
const DAY_MS = 86400000;
const tools = { doorStateOf, coverActive, roomAt, doorRooms: doorRoomIndexes };
/** Held on `globalThis` so it stays reachable, as a floor's history is in the card, until `release`. */
const hold = globalThis as unknown as { __gateKept: { index: HistoryIndex; onsets: Onset[] } | null };

/** What `send` in the card answers: HA's reply for the entities of one call (copied from the fixture, which says where its shape comes from). */
const sender = (g: Gate) => (m: { entity_ids: string[] }) => Promise.resolve(Object.fromEntries(m.entity_ids.map((id) => [id, g.reply[id]])));

/** The two stages, apart: `parse` is `fetchHistory` (both calls' parse, merged), `onsets` is `onsets` and `purgedFrom`. `slow`: that stage runs twice, the first result dropped,
 * which is a stage that got twice as slow. `FP_GATE_SLOW` in replay-gate.spec.ts turns it on, to see the gate catch it (docs/DECISIONS.md, Sprint 44 review). */
export type Slow = "parse" | "onsets" | "both" | undefined;
async function load(g: Gate, days: number, slow?: Slow, took?: { parse: number; onsets: number }) {
  const start = END_MS - days * DAY_MS;
  const t0 = performance.now();
  if (slow === "parse" || slow === "both") await fetchHistory(sender(g), g.asked, start, END_MS);
  const index = await fetchHistory(sender(g), g.asked, start, END_MS);
  const t1 = performance.now();
  if (slow === "onsets" || slow === "both") onsets(index, g.floor, tools);
  const events = onsets(index, g.floor, tools);
  purgedFrom(index, start);
  if (took) { took.parse += t1 - t0; took.onsets += performance.now() - t1; }
  return { index, onsets: events };
}

/** One run of the workload, in ms: `times` loads of the same floor one after the other (a longer run is a steadier one). The fixture is made before the clock starts: HA built that reply, not the card. */
export async function timed(days = 7, times = 1, slow?: Slow): Promise<{ ms: number; parse: number; onsets: number; rows: number; events: number }> {
  const g = gateFixture((END_MS - days * DAY_MS) / 1000, END_MS / 1000);
  let n = 0;
  const took = { parse: 0, onsets: 0 };
  const t0 = performance.now();
  for (let i = 0; i < times; i++) n = (await load(g, days, slow, took)).onsets.length;
  return { ms: performance.now() - t0, parse: took.parse, onsets: took.onsets, rows: g.rows, events: n };
}

/** Not the card's code: the websocket client's own `JSON.parse` of the reply (7 MB of text at 7 days), which runs on the same thread before `parseHistory`. Printed beside the gate, not part of it. */
export function jsonParseMs(days = 7): number {
  const text = JSON.stringify(gateFixture((END_MS - days * DAY_MS) / 1000, END_MS / 1000).reply);
  const t0 = performance.now();
  JSON.parse(text);
  return performance.now() - t0;
}

/** Builds the index and keeps it, the reply dropped: what a floor's history costs once the reply is gone. The caller reads the heap around it. */
export async function keep(days = 7): Promise<void> {
  hold.__gateKept = await load(gateFixture((END_MS - days * DAY_MS) / 1000, END_MS / 1000), days);
}
export function release(): void { hold.__gateKept = null; }
