// Which of the 3D view's label boxes stay when some overlap (S28.11). Pure and DOM-free: the overlay measures, this decides.
// Greedy by priority on a grid: the best box first, every later box kept only if it meets none already kept. Equal priority:
// the larger area, then the lower index, then the earlier in the list. Touching edges do not overlap.

export interface Box { x: number; y: number; w: number; h: number; priority: number; area?: number; index?: number }

const CELL = 64, SPAN = 16; // px. A box wider than SPAN cells either way goes in a short list that is checked one by one.
const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const sound = (b: unknown): b is Box => {
  const o = b as Box | null;
  return typeof o === "object" && o !== null && ok(o.x) && ok(o.y) && ok(o.w) && ok(o.h) && o.w >= 0 && o.h >= 0 && ok(o.priority);
};
const meet = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** One flag per box, in the order given: true when the box stays. A box with a missing or non-finite number never stays. Never throws. */
export function declutter(boxes: readonly Box[]): boolean[] {
  if (!Array.isArray(boxes)) return [];
  const keep: boolean[] = new Array(boxes.length).fill(false);
  const order: number[] = [];
  boxes.forEach((b, i) => { if (sound(b)) order.push(i); });
  const num = (v: unknown, d: number) => (ok(v) ? v : d);
  order.sort((p, q) => {
    const a = boxes[p], b = boxes[q];
    return b.priority - a.priority || num(b.area, 0) - num(a.area, 0) || num(a.index, p) - num(b.index, q) || p - q;
  });
  const grid = new Map<number, Box[]>(), big: Box[] = [];
  const cells = (b: Box) => [Math.floor(b.x / CELL), Math.floor((b.x + b.w) / CELL), Math.floor(b.y / CELL), Math.floor((b.y + b.h) / CELL)];
  for (const i of order) {
    const b = boxes[i], [x0, x1, y0, y1] = cells(b), wide = x1 - x0 > SPAN || y1 - y0 > SPAN;
    let clash = big.some((o) => meet(b, o));
    if (!clash && wide) { for (const list of grid.values()) if (list.some((o) => meet(b, o))) { clash = true; break; } }
    else if (!clash) {
      for (let cx = x0; cx <= x1 && !clash; cx++) for (let cy = y0; cy <= y1 && !clash; cy++) clash = (grid.get(cx * 1048576 + cy) ?? []).some((o) => meet(b, o));
    }
    if (clash) continue;
    keep[i] = true;
    if (wide) big.push(b);
    else for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const k = cx * 1048576 + cy; (grid.get(k) ?? grid.set(k, []).get(k)!).push(b); }
  }
  return keep;
}
