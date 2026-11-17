// The camera of the 3D view as plain maths: where it stands, and what a drag, a wheel turn and a pan do to it. No
// three.js and no DOM, so it is unit-tested without WebGL. It replaces three's OrbitControls (an addon, with damping and
// touch handling the card does not need): a small class, a few hundred bytes, and a polar clamp of its own.
//
// Frame: three's. x east, y up, z south (plan y). `azimuth` 0 puts the camera south of the target, positive turns it
// toward the east. `polar` is the angle from straight up: 0 is top-down, pi/2 the horizon.
import { fitBox, type Box, type Rect } from "./frame3d";

type V3 = [number, number, number];
export interface Bounds { min: V3; max: V3 }

/** radians. Not quite top-down (the azimuth would mean nothing there) and not quite the horizon (never under the floor). */
export const MIN_POLAR = 0.1, MAX_POLAR = 1.45;
/** The start: 50 degrees above the horizon. */
const START_POLAR = (40 * Math.PI) / 180;
/** radians per pixel dragged. */
const ROTATE_RATE = 0.006;
/** The closest and furthest the camera goes, as a multiple of the distance that frames the house. */
const NEAR_FACTOR = 0.15, FAR_FACTOR = 4;

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** What `setVisible` takes: the canvas in px, and what chrome lies over each edge of it, in px. */
export interface Canvas { w: number; h: number }
export interface Cover { top: number; right: number; bottom: number; left: number }
/** Under this many px wide or high the visible box is too small to frame anything in (the phone sheet at full): ignored. */
const MIN_VISIBLE = 120;

const boundsOk = (b: Bounds | null | undefined): b is Bounds =>
  !!b && Array.isArray(b.min) && Array.isArray(b.max) && b.min.length === 3 && b.max.length === 3 && [...b.min, ...b.max].every(fin) && b.min.every((v, i) => v <= b.max[i]);
/** Plan bounds (x, y, z up) as a box in three's frame (x, z, y). */
const toThree = (b: Bounds): Box => ({ min: [b.min[0], b.min[2], b.min[1]], max: [b.max[0], b.max[2], b.max[1]] });

export class Orbit {
  azimuth = 0;
  polar = START_POLAR;
  distance = 1;
  target: V3 = [0, 0, 0];
  private startAz = 0;
  /** The unit: the floor box's fit at the start angles, in the current visible box. A stored zoom is a multiple of it. */
  private unit = 1;
  private lo: V3 = [0, 0, 0];
  private hi: V3 = [0, 0, 0];
  private fovDeg: number;
  private canvas: Canvas;
  private cvr: Cover = { top: 0, right: 0, bottom: 0, left: 0 };
  private px: [number, number] = [0, 0];
  /** The box the last framing step fitted: the floor, or a focused room. */
  private box: Box;
  /** Framed: the camera is the result of a framing step and nobody has dragged, wheeled or panned since. */
  private framed = true;
  /** The floor camera a focus left, so `unfocus` and `state` can answer for it. */
  private pre: { zoom: number; dx: number; dz: number; framed: boolean; az: number; polar: number } | null = null;

  /** `bounds` are the scene's, in the plan's frame (x, y, z up, cm); `aspect` a first guess of the canvas until `setVisible` says; `fovDeg` the camera's vertical field; `turnDeg` the plan's turn. */
  constructor(bounds: Bounds, aspect: number, fovDeg: number, turnDeg: number) {
    const ok = boundsOk(bounds);
    const mn = ok ? bounds.min : [0, 0, 0], mx = ok ? bounds.max : [0, 0, 0];
    this.lo = [mn[0], mn[2], mn[1]];
    this.hi = [mx[0], mx[2], mx[1]];
    this.box = { min: this.lo, max: this.hi };
    this.fovDeg = fin(fovDeg) && fovDeg > 1 && fovDeg < 120 ? fovDeg : 40;
    this.canvas = { w: 1000 * (fin(aspect) && aspect > 0 ? aspect : 1), h: 1000 };
    this.azimuth = fin(turnDeg) ? (turnDeg * Math.PI) / 180 : 0;
    this.startAz = this.azimuth;
    this.frameFloor();
  }

  /** The visible box: the canvas less its cover. */
  private visible(c = this.canvas, v = this.cvr): Rect {
    return { left: v.left, top: v.top, right: c.w - v.right, bottom: c.h - v.bottom };
  }
  private visShift(): [number, number] {
    const v = this.visible();
    return [(v.left + v.right) / 2 - this.canvas.w / 2, (v.top + v.bottom) / 2 - this.canvas.h / 2];
  }
  private centre(): V3 { return [0, 1, 2].map((i) => (this.lo[i] + this.hi[i]) / 2) as V3; }

  /** The floor box's fit at the start angles in `vis`; the old sphere when the box cannot be fitted (junk numbers, a tiny box). */
  private unitFor(c: Canvas, vis: Rect): number {
    const f = fitBox({ min: this.lo, max: this.hi }, this.startAz, START_POLAR, this.fovDeg, c, vis);
    if (f && fin(f.distance)) return f.distance;
    const fov = (this.fovDeg * Math.PI) / 180, radius = Math.max(100, 0.5 * Math.hypot(this.hi[0] - this.lo[0], this.hi[1] - this.lo[1], this.hi[2] - this.lo[2]));
    const across = 2 * Math.atan(Math.tan(fov / 2) * (c.w / c.h));
    return (0.85 * radius) / Math.sin(Math.min(fov, across) / 2);
  }

  /** The framing step: fit `this.box` at the current angles. False (nothing changed) when it cannot be fitted. */
  private refit(): boolean {
    const f = fitBox(this.box, this.azimuth, this.polar, this.fovDeg, this.canvas, this.visible(), [this.unit * NEAR_FACTOR, this.unit * FAR_FACTOR]);
    if (!f || !fin(f.distance)) return false;
    this.distance = f.distance; // already inside the limits; the shift is for this distance
    this.target = [...f.target];
    this.px = f.shift;
    this.framed = true;
    return true;
  }

  /** The floor box, at the current angles: the first draw, Reset camera and a floor switch end here. */
  frameFloor(): void {
    this.pre = null;
    this.box = { min: this.lo, max: this.hi };
    this.unit = this.unitFor(this.canvas, this.visible());
    if (!this.refit()) { this.distance = this.unit; this.target = this.centre(); this.px = this.visShift(); this.framed = true; }
  }

  /** Fits `box` (plan frame) at the current angles, the target to its centre. False and no change for junk or a box that cannot be fitted. */
  frameTo(box: Bounds): boolean {
    if (!boundsOk(box)) return false;
    const was = this.box;
    this.box = toThree(box);
    if (this.refit()) return true;
    this.box = was;
    return false;
  }

  /** Frames a room. The camera it had is kept (only the first time) for `unfocus` and `state`. */
  focus(box: Bounds): boolean {
    const c = this.centre(), pre = this.pre ?? { zoom: this.distance / this.unit, dx: this.target[0] - c[0], dz: this.target[2] - c[2], framed: this.framed, az: this.azimuth, polar: this.polar };
    if (!this.frameTo(box)) return false;
    this.pre = pre;
    return true;
  }

  /** Back to the camera before the first focus, at the angles the camera has now. Nothing to do when nothing is focused. */
  unfocus(): void {
    const p = this.pre;
    if (!p) return;
    this.pre = null;
    this.box = { min: this.lo, max: this.hi };
    const c = this.centre();
    this.distance = clamp(p.zoom * this.unit, this.unit * NEAR_FACTOR, this.unit * FAR_FACTOR);
    this.target = [c[0] + p.dx, c[1], c[2] + p.dz];
    this.px = this.visShift();
    this.framed = false;
    if (p.framed && p.az === this.azimuth && p.polar === this.polar) this.refit();
  }

  /**
   * Another floor, the same way of looking: the camera keeps its azimuth and polar, drops any focus, and frames the new
   * bounds in the same visible box. Junk bounds change nothing.
   */
  reframe(bounds: Bounds): void {
    if (!boundsOk(bounds)) return;
    this.lo = [bounds.min[0], bounds.min[2], bounds.min[1]];
    this.hi = [bounds.max[0], bounds.max[2], bounds.max[1]];
    this.frameFloor();
  }

  /** Updates the scene bounds after a live edit without moving the camera; `reset()` later frames the new house. */
  setBounds(bounds: Bounds): void {
    if (!boundsOk(bounds)) return;
    this.lo = [bounds.min[0], bounds.min[2], bounds.min[1]];
    this.hi = [bounds.max[0], bounds.max[2], bounds.max[1]];
    this.box = { min: this.lo, max: this.hi };
  }

  /**
   * The canvas is `canvas` px and chrome covers `cover` px of its edges (F1 of the framing spec). A framed camera is
   * fitted again; a moved one keeps its angles and target and its distance follows the unit. Junk, a visible box under
   * 120 px wide or high, and a change of 1 px or less on every edge change nothing.
   */
  setVisible(canvas: Canvas, cover: Cover): void {
    if (!canvas || !fin(canvas.w) || !fin(canvas.h) || !(canvas.w > 0) || !(canvas.h > 0)) return;
    if (!cover || ![cover.top, cover.right, cover.bottom, cover.left].every((v) => fin(v) && v >= 0)) return;
    const vis = this.visible(canvas, cover), now = this.visible();
    if (vis.right - vis.left < MIN_VISIBLE || vis.bottom - vis.top < MIN_VISIBLE) return;
    const same = (a: number, b: number) => Math.abs(a - b) <= 1;
    if (same(vis.left, now.left) && same(vis.top, now.top) && same(vis.right, now.right) && same(vis.bottom, now.bottom) && same(canvas.w, this.canvas.w) && same(canvas.h, this.canvas.h)) return;
    const unit = this.unitFor(canvas, vis), was = this.unit;
    this.canvas = { w: canvas.w, h: canvas.h };
    this.cvr = { top: cover.top, right: cover.right, bottom: cover.bottom, left: cover.left };
    this.unit = unit;
    if (this.framed && this.refit()) return;
    this.distance = clamp(this.distance * (unit / was), unit * NEAR_FACTOR, unit * FAR_FACTOR);
    this.px = this.visShift();
  }

  /** How far the picture is slid on the canvas, px: right and down are positive. The view applies it as a lens shift. */
  get shift(): [number, number] { return [this.px[0], this.px[1]]; }

  /** Puts the picture's lens shift where a glide says (px). Junk changes nothing. */
  setShift(x: number, y: number): void { if (fin(x) && fin(y)) this.px = [x, y]; }

  /** Where the camera stands (three's frame). */
  position(): V3 {
    const s = Math.sin(this.polar) * this.distance;
    return [this.target[0] + s * Math.sin(this.azimuth), this.target[1] + Math.cos(this.polar) * this.distance, this.target[2] + s * Math.cos(this.azimuth)];
  }

  /** A drag of `dx`, `dy` pixels: right turns the house to the right, down lifts the camera. Junk changes nothing. */
  rotate(dx: number, dy: number): void {
    if (fin(dx)) this.azimuth -= dx * ROTATE_RATE;
    if (fin(dy)) this.polar = clamp(this.polar - dy * ROTATE_RATE, MIN_POLAR, MAX_POLAR);
    if ((fin(dx) && dx !== 0) || (fin(dy) && dy !== 0)) this.framed = false;
  }

  /** `factor` below 1 comes closer, above 1 goes back. Clamped to the house's own range; junk changes nothing. */
  zoom(factor: number): void {
    if (!(fin(factor) && factor > 0)) return;
    this.distance = clamp(this.distance * factor, this.unit * NEAR_FACTOR, this.unit * FAR_FACTOR);
    if (factor !== 1) this.framed = false;
  }

  /** A pan of `dx`, `dy` pixels in a view `heightPx` tall: the ground follows the pointer. The target stays over the house. */
  pan(dx: number, dy: number, heightPx: number): void {
    if (!(fin(dx) && fin(dy) && fin(heightPx) && heightPx > 0)) return;
    if (dx !== 0 || dy !== 0) this.framed = false;
    const perPx = (2 * this.distance * Math.tan((this.fovDeg * Math.PI) / 360)) / heightPx, sin = Math.sin(this.azimuth), cos = Math.cos(this.azimuth);
    // right on the ground is (cos, -sin); away from the camera is (-sin, -cos).
    this.target[0] += -dx * perPx * cos + dy * perPx * -sin;
    this.target[2] += dx * perPx * sin + dy * perPx * -cos;
    const room = (i: 0 | 2) => 0.5 * (this.hi[i] - this.lo[i]) + 100;
    this.target[0] = clamp(this.target[0], this.lo[0] - room(0), this.hi[0] + room(0));
    this.target[2] = clamp(this.target[2], this.lo[2] - room(2), this.hi[2] + room(2));
  }

  /** Back to the first view: from the south (or the plan's own turn), 50 degrees up, the whole house framed. Drops any focus. */
  reset(): void {
    this.azimuth = this.startAz;
    this.polar = START_POLAR;
    this.frameFloor();
  }

  /** The camera as numbers a floor can be left with and found again by (S14.4): where it looks from, the distance as a
   * multiple of the one that frames the floor, and the look-at point's offset from the floor's centre. None of them
   * depends on the size of the view, so a restore in a differently shaped card still frames the same. */
  state(): { az: number; polar: number; zoom: number; dx: number; dz: number } {
    const p = this.pre;
    if (p) return { az: this.azimuth, polar: this.polar, zoom: p.zoom, dx: p.dx, dz: p.dz }; // focused: the floor camera, with the angles now
    return { az: this.azimuth, polar: this.polar, zoom: this.distance / this.unit, dx: this.target[0] - (this.lo[0] + this.hi[0]) / 2, dz: this.target[2] - (this.lo[2] + this.hi[2]) / 2 };
  }

  /** The inverse of `state`, for a camera someone stored: untrusted, so each number is bounded the way a drag, a wheel turn
   * and a pan bound theirs, and anything that is not five finite numbers changes nothing. */
  restore(s: { az: number; polar: number; zoom: number; dx: number; dz: number }): void {
    if (!s || typeof s !== "object" || ![s.az, s.polar, s.zoom, s.dx, s.dz].every(fin)) return;
    this.azimuth = s.az;
    this.polar = clamp(s.polar, MIN_POLAR, MAX_POLAR);
    this.pre = null;
    this.box = { min: this.lo, max: this.hi };
    this.framed = false;
    this.px = this.visShift();
    this.distance = clamp(s.zoom * this.unit, this.unit * NEAR_FACTOR, this.unit * FAR_FACTOR);
    const at = (i: 0 | 2, d: number) => {
      const centre = (this.lo[i] + this.hi[i]) / 2, room = 0.5 * (this.hi[i] - this.lo[i]) + 100;
      return clamp(centre + d, this.lo[i] - room, this.hi[i] + room);
    };
    this.target = [at(0, s.dx), (this.lo[1] + this.hi[1]) / 2, at(2, s.dz)];
  }

  /** Whether the camera has a position at all: false when the bounds are so large that the distance overflowed (the view then falls back to 2D). */
  get finite(): boolean { return [this.distance, this.unit, ...this.target, ...this.px].every(fin); }

  /** The distance that frames the house, for the near and far planes. */
  get framing(): number { return this.unit; }
  /** The size of the scene's frame, for the camera's far plane. */
  get radius(): number { return Math.max(100, 0.5 * Math.hypot(this.hi[0] - this.lo[0], this.hi[1] - this.lo[1], this.hi[2] - this.lo[2])); }
}
