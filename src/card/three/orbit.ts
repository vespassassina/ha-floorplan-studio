// The camera of the 3D view as plain maths: where it stands, and what a drag, a wheel turn and a pan do to it. No
// three.js and no DOM, so it is unit-tested without WebGL. It replaces three's OrbitControls (an addon, with damping and
// touch handling the card does not need): a small class, a few hundred bytes, and a polar clamp of its own.
//
// Frame: three's. x east, y up, z south (plan y). `azimuth` 0 puts the camera south of the target, positive turns it
// toward the east. `polar` is the angle from straight up: 0 is top-down, pi/2 the horizon.
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

export class Orbit {
  azimuth = 0;
  polar = START_POLAR;
  distance = 1;
  target: V3 = [0, 0, 0];
  private start = { azimuth: 0, polar: START_POLAR, distance: 1, target: [0, 0, 0] as V3 };
  private fit = 1;
  private lo: V3 = [0, 0, 0];
  private hi: V3 = [0, 0, 0];
  private fov: number;
  private aspect: number;

  /** `bounds` are the scene's, in the plan's frame (x, y, z up, cm); `fovDeg` the camera's vertical field; `turnDeg` the plan's turn. */
  constructor(bounds: Bounds, aspect: number, fovDeg: number, turnDeg: number) {
    const ok = bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max) && [...bounds.min, ...bounds.max].every(fin);
    const mn = ok ? bounds.min : [0, 0, 0], mx = ok ? bounds.max : [0, 0, 0];
    // Plan (x, y, z up) to three (x, z, y).
    this.lo = [mn[0], mn[2], mn[1]];
    this.hi = [mx[0], mx[2], mx[1]];
    this.fov = ((fin(fovDeg) && fovDeg > 1 && fovDeg < 120 ? fovDeg : 40) * Math.PI) / 180;
    this.aspect = fin(aspect) && aspect > 0 ? aspect : 1;
    this.target = [0, 1, 2].map((i) => (this.lo[i] + this.hi[i]) / 2) as V3;
    this.fit = this.fitDistance();
    this.distance = this.fit;
    this.azimuth = fin(turnDeg) ? (turnDeg * Math.PI) / 180 : 0;
    this.start = { azimuth: this.azimuth, polar: this.polar, distance: this.distance, target: [...this.target] };
  }

  /** The distance at which the whole house fits the narrower of the two fields of view. */
  private fitDistance(): number {
    const radius = Math.max(100, 0.5 * Math.hypot(this.hi[0] - this.lo[0], this.hi[1] - this.lo[1], this.hi[2] - this.lo[2]));
    const across = 2 * Math.atan(Math.tan(this.fov / 2) * this.aspect);
    return (0.85 * radius) / Math.sin(Math.min(this.fov, across) / 2);
  }

  /** The view got wider or taller: the next `reset` frames the house for the new shape; where the camera is now stays. */
  setAspect(aspect: number): void {
    if (!(fin(aspect) && aspect > 0) || aspect === this.aspect) return;
    this.aspect = aspect;
    this.fit = this.fitDistance();
    this.start.distance = this.fit;
  }

  /** Where the camera stands (three's frame). */
  position(): V3 {
    const s = Math.sin(this.polar) * this.distance;
    return [this.target[0] + s * Math.sin(this.azimuth), this.target[1] + Math.cos(this.polar) * this.distance, this.target[2] + s * Math.cos(this.azimuth)];
  }

  /** A drag of `dx`, `dy` pixels: right turns the house to the right, down lifts the camera. Junk changes nothing. */
  rotate(dx: number, dy: number): void {
    if (fin(dx)) this.azimuth -= dx * ROTATE_RATE;
    if (fin(dy)) this.polar = clamp(this.polar - dy * ROTATE_RATE, MIN_POLAR, MAX_POLAR);
  }

  /** `factor` below 1 comes closer, above 1 goes back. Clamped to the house's own range; junk changes nothing. */
  zoom(factor: number): void {
    if (!(fin(factor) && factor > 0)) return;
    this.distance = clamp(this.distance * factor, this.fit * NEAR_FACTOR, this.fit * FAR_FACTOR);
  }

  /** A pan of `dx`, `dy` pixels in a view `heightPx` tall: the ground follows the pointer. The target stays over the house. */
  pan(dx: number, dy: number, heightPx: number): void {
    if (!(fin(dx) && fin(dy) && fin(heightPx) && heightPx > 0)) return;
    const perPx = (2 * this.distance * Math.tan(this.fov / 2)) / heightPx, sin = Math.sin(this.azimuth), cos = Math.cos(this.azimuth);
    // right on the ground is (cos, -sin); away from the camera is (-sin, -cos).
    this.target[0] += -dx * perPx * cos + dy * perPx * -sin;
    this.target[2] += dx * perPx * sin + dy * perPx * -cos;
    const room = (i: 0 | 2) => 0.5 * (this.hi[i] - this.lo[i]) + 100;
    this.target[0] = clamp(this.target[0], this.lo[0] - room(0), this.hi[0] + room(0));
    this.target[2] = clamp(this.target[2], this.lo[2] - room(2), this.hi[2] + room(2));
  }

  /** Back to the first view: from the south (or the plan's own turn), 50 degrees up, the whole house framed. */
  reset(): void {
    this.azimuth = this.start.azimuth;
    this.polar = this.start.polar;
    this.distance = this.start.distance;
    this.target = [...this.start.target];
  }

  /** The distance that frames the house, for the near and far planes. */
  get framing(): number { return this.fit; }
  /** The size of the scene's frame, for the camera's far plane. */
  get radius(): number { return Math.max(100, 0.5 * Math.hypot(this.hi[0] - this.lo[0], this.hi[1] - this.lo[1], this.hi[2] - this.lo[2])); }
}
