import type { EventGroup, Onset } from "./events";

// R2.3: where the markers of the slider go (docs/specs/replay-2.md items 5 and 6). Pure: pixels in, pixels out. Lives in the replay chunk.

/** Ticks closer than this many px are one cluster. */
export const TICK_GAP_PX = 6;
/** The motion band: 15 minutes a bucket over 24 hours. */
export const MOTION_BUCKETS = 96;

export type TickGroup = Exclude<EventGroup, "motion">;
/** Strongest first: a cluster is drawn in the colour of the highest group it holds. */
const RANK: readonly TickGroup[] = ["alarm", "opening", "lamp"];

export interface Cluster {
  /** The first tick's x, px from the strip's start. */
  x: number;
  /** The first onset in time: where a tap goes. */
  first: Onset;
  size: number;
  group: TickGroup;
  n: Record<TickGroup, number>;
  /** 8, 12 or 16 px for 1, 2 to 4, 5 or more. */
  height: number;
}

/** Lamp, opening and alarm onsets of the window as clusters on a strip `width` px wide. A tick joins the cluster when it is closer than `TICK_GAP_PX` to the one before it. */
export function clusters(onsets: readonly Onset[], start: number, end: number, width: number): Cluster[] {
  const span = end - start;
  if (!(span > 0) || !(width > 0)) return [];
  const out: Cluster[] = [];
  let lastX = -Infinity;
  for (const o of onsets.filter((o) => o.group !== "motion" && o.t >= start && o.t <= end).sort((a, b) => a.t - b.t)) {
    const x = ((o.t - start) / span) * width;
    let c = out[out.length - 1];
    if (!c || x - lastX >= TICK_GAP_PX) out.push((c = { x, first: o, size: 0, group: "lamp", n: { lamp: 0, opening: 0, alarm: 0 }, height: 8 }));
    c.size++;
    c.n[o.group as TickGroup]++;
    lastX = x;
  }
  for (const c of out) {
    c.group = RANK.find((g) => c.n[g])!;
    c.height = c.size > 4 ? 16 : c.size > 1 ? 12 : 8;
  }
  return out;
}

/** The count of motion onsets per bucket of the window. */
export function motionBuckets(onsets: readonly Onset[], start: number, end: number): number[] {
  const b = new Array<number>(MOTION_BUCKETS).fill(0);
  const span = end - start;
  if (!(span > 0)) return b;
  for (const o of onsets) if (o.group === "motion" && o.t >= start && o.t < end) b[Math.floor(((o.t - start) / span) * MOTION_BUCKETS)]++;
  return b;
}
