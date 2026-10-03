// Which way a flight goes from the floor it is drawn on. The only place the default lives: render, solids and the editor
// ask here. Like heights.ts, the default is read and never stored, and every input may be junk (an untrusted file).
import { STAIR_DIRECTIONS } from "./schema";
import type { Layout, StairDirection, Stairs } from "./schema";

/** What the editor's select shows for each member. "Auto" is not a member: it is the field left out. */
export const STAIR_DIRECTION_LABELS: Record<StairDirection, string> = { up: "Up", down: "Down", both: "Up and down" };

/** Whether the house has a floor over this one and a floor under it. Floors stack in `floors` key order, lowest first. */
export interface FloorsAround { above: boolean; below: boolean }

export function floorsAround(layout: Layout, floorIndex: number): FloorsAround {
  const floors = (layout as { floors?: unknown } | null)?.floors;
  const n = typeof floors === "object" && floors !== null ? Object.keys(floors).length : 0;
  if (!Number.isInteger(floorIndex) || floorIndex < 0 || floorIndex >= n) return { above: false, below: false };
  return { above: floorIndex < n - 1, below: floorIndex > 0 };
}

/**
 * The direction a stair is drawn with. An explicit `direction` wins. Auto: up when a floor is above, else down when a
 * floor is below, else up. So the top floor shows its stairs arriving from below, with no edit, and a lone floor reads
 * as it always did. Auto never gives "both": a middle floor going both ways is a choice, made in the editor.
 * `around` absent means the caller does not know the house; the stair then reads up, the flat plan as ever.
 */
export function resolveStairDirection(stair: Stairs, around?: FloorsAround): StairDirection {
  const d = (stair as { direction?: unknown } | null)?.direction;
  if (STAIR_DIRECTIONS.includes(d as StairDirection)) return d as StairDirection;
  return around && !around.above && around.below ? "down" : "up";
}

export const stairDirection = (layout: Layout, floorIndex: number, stair: Stairs): StairDirection =>
  resolveStairDirection(stair, floorsAround(layout, floorIndex));

/** `floorsAround` for a floor named by its key, which is what the card and the editor hold. An unknown key has no neighbours. */
export const floorsAroundKey = (layout: Layout, floorKey: string): FloorsAround => {
  const floors = (layout as { floors?: unknown } | null)?.floors;
  return floorsAround(layout, typeof floors === "object" && floors !== null ? Object.keys(floors).indexOf(floorKey) : -1);
};
