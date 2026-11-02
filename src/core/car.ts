import { CAR_MODELS, type CarModel, type Furniture } from "./schema";
import type { CarStatus } from "./car-status";
import { num } from "./fmt";

/**
 * S35.2: the car, once. One table drives the plan (2D, 2.5D) and the 3D scene, so the views cannot disagree about a
 * model. Lengths are along the car (`w` of the piece) and run from the tail (0) to the nose (1); the front is +x.
 * `w`, `h` and `height` are the makers' figures for a typical car of the class, in cm (spec C3). The profile numbers
 * are judgement, tuned by looking at the shots: rear glass from <= roof from <= roof to <= windscreen to.
 */
export interface CarSpec {
  w: number; h: number; height: number;
  nose: number; tail: number;          // the chamfer of the nose and tail corners, in fractions of the length
  rearGlass: number; roofFrom: number; roofTo: number; windscreen: number;
  belt: number;                        // the glass starts at this fraction of the height
  cabin: number;                       // the glass base is this fraction of the width
  axles: [number, number];             // wheel centres from the tail
  grille: boolean;
  bed?: [number, number];              // an open pickup bed, from the tail
}

export const CAR_SPEC: Record<CarModel, CarSpec> = {
  sedan:   { w: 470, h: 182, height: 145, nose: .07, tail: .06, rearGlass: .20, roofFrom: .32, roofTo: .58, windscreen: .70, belt: .55, cabin: .86, axles: [.18, .80], grille: true },
  wagon:   { w: 478, h: 183, height: 150, nose: .07, tail: .04, rearGlass: .04, roofFrom: .08, roofTo: .58, windscreen: .70, belt: .55, cabin: .86, axles: [.18, .80], grille: true },
  suv:     { w: 465, h: 188, height: 168, nose: .06, tail: .04, rearGlass: .04, roofFrom: .08, roofTo: .62, windscreen: .73, belt: .58, cabin: .88, axles: [.18, .80], grille: true },
  offroad: { w: 480, h: 196, height: 195, nose: .03, tail: .03, rearGlass: .05, roofFrom: .07, roofTo: .66, windscreen: .72, belt: .58, cabin: .92, axles: [.16, .82], grille: true },
  truck:   { w: 590, h: 203, height: 196, nose: .05, tail: .03, rearGlass: .40, roofFrom: .42, roofTo: .64, windscreen: .72, belt: .58, cabin: .90, axles: [.16, .82], grille: true, bed: [.02, .40] },
  van:     { w: 495, h: 195, height: 197, nose: .05, tail: .02, rearGlass: .02, roofFrom: .03, roofTo: .80, windscreen: .88, belt: .50, cabin: .92, axles: [.16, .82], grille: true },
  utility: { w: 429, h: 179, height: 148, nose: .06, tail: .03, rearGlass: .03, roofFrom: .05, roofTo: .70, windscreen: .80, belt: .52, cabin: .90, axles: [.18, .80], grille: true },
  citycar: { w: 360, h: 165, height: 150, nose: .10, tail: .08, rearGlass: .08, roofFrom: .14, roofTo: .60, windscreen: .74, belt: .55, cabin: .86, axles: [.18, .80], grille: true },
  electric:{ w: 472, h: 185, height: 144, nose: .10, tail: .07, rearGlass: .08, roofFrom: .26, roofTo: .56, windscreen: .74, belt: .50, cabin: .86, axles: [.18, .80], grille: false },
};

/** The spec of a model; anything that is not one (a layout is untrusted) is the sedan. `includes`, not a key lookup, so `__proto__` never matches. */
export function carSpec(model: unknown): CarSpec {
  return CAR_SPEC[(CAR_MODELS as readonly unknown[]).includes(model) ? (model as CarModel) : "sedan"];
}

export type CarPoly = [number, number][];
/** Plan polygons in a unit frame: -0.5..0.5 on both axes, +x the nose, y across. Scale by `w` and `h`, turn by `rot` about the centre. */
export interface CarParts { outline: CarPoly; rearGlass: CarPoly; roof: CarPoly; windscreen: CarPoly; mirrors: CarPoly[]; wheels: CarPoly[]; grille?: CarPoly; bed?: CarPoly }

/** 3D wheels: 64 cm long, 22 cm wide, the outer face flush with the body side (spec C4). */
export const WHEEL_LENGTH = 64, WHEEL_WIDTH = 22;
/** The roof is this much narrower than the glass base: the windscreen and rear glass slope in. */
export const ROOF_INSET = 0.08;

const q = (n: number) => Math.round(n * 1e6) / 1e6;
const rect = (x0: number, x1: number, y0: number, y1: number): CarPoly => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [q(x - 0.5), q(y)] as [number, number]);
const mirrorY = (p: CarPoly): CarPoly => p.map(([x, y]) => [x, q(-y)] as [number, number]);

export function carParts(model: unknown): CarParts {
  const s = carSpec(model);
  // The chamfer is measured in cm, not in the unit frame, and the nose tapers more than the tail: a car's front is narrower than its back.
  const ny = Math.min(0.3, 1.4 * s.nose * s.w / s.h), ty = Math.min(0.3, s.tail * s.w / s.h);
  const pt = (x: number, y: number): [number, number] => [q(x), q(y)];
  const outline: CarPoly = [
    pt(-0.5 + s.tail, -0.5), pt(0.5 - s.nose, -0.5), pt(0.5, -0.5 + ny), pt(0.5, 0.5 - ny),
    pt(0.5 - s.nose, 0.5), pt(-0.5 + s.tail, 0.5), pt(-0.5, 0.5 - ty), pt(-0.5, -0.5 + ty),
  ];
  const base = s.cabin / 2, top = (s.cabin - ROOF_INSET) / 2;
  const x = (f: number) => q(f - 0.5);
  const rearGlass: CarPoly = [[x(s.rearGlass), -base], [x(s.roofFrom), -top], [x(s.roofFrom), top], [x(s.rearGlass), base]];
  const roof: CarPoly = [[x(s.roofFrom), -top], [x(s.roofTo), -top], [x(s.roofTo), top], [x(s.roofFrom), top]];
  const windscreen: CarPoly = [[x(s.roofTo), -top], [x(s.windscreen), -base], [x(s.windscreen), base], [x(s.roofTo), top]];
  const mirror = rect(s.windscreen - 0.02, s.windscreen + 0.03, q(base - 0.01), Math.min(0.5, q(base + 0.06)));
  const half = WHEEL_LENGTH / 2 / s.w, side = 0.5 - WHEEL_WIDTH / s.h;
  const wheels = s.axles.flatMap((a) => { const w = rect(a - half, a + half, side, 0.5); return [w, mirrorY(w)]; });
  const parts: CarParts = { outline, rearGlass, roof, windscreen, mirrors: [mirror, mirrorY(mirror)], wheels };
  if (s.grille) parts.grille = rect(1 - 0.02, 1 - 0.003, q(-0.6 * (0.5 - ny)), q(0.6 * (0.5 - ny)));
  if (s.bed) parts.bed = rect(s.bed[0], s.bed[1], -0.4, 0.4);
  return parts;
}

const frame = (p: CarPoly) => p.map(([x, y]) => `${+((x + 0.5) * 100).toFixed(2)},${+((y + 0.5) * 100).toFixed(2)}`).join(" ");
const poly = (cls: string, p: CarPoly) => `<polygon class="${cls}" points="${frame(p)}"/>`;

/**
 * The top view as markup in the 100 x 100 symbol frame the plan scales to the piece. Numbers and fixed class names only;
 * colour comes from the stylesheet (`car-body`, `car-glass`, ...), never an attribute (finding 18).
 */
export function carTop(model: unknown): string {
  const p = carParts(model);
  return poly("car-body", p.outline) + (p.bed ? poly("car-bed", p.bed) : "") + p.wheels.map((w) => poly("car-tyre", w)).join("")
    + poly("car-glass", p.rearGlass) + poly("car-glass", p.windscreen) + poly("car-roof", p.roof)
    + p.mirrors.map((m) => poly("car-mirror", m)).join("") + (p.grille ? poly("car-grille", p.grille) : "");
}

const HEX = /^#[0-9a-f]{6}$/i;
export interface CarLook {
  /** ` furn-car` and the state classes, appended to the piece group's class list. */
  cls: string;
  /** ` style="--fp-car-body:#rrggbb"`, or "" when the colour is absent or not a plain hex (a layout is untrusted, finding 1). */
  style: string;
  /** The badges and the level, in a group at `%AT%` (the piece's centre, at the height it is drawn): outside the scaled symbol so circles stay round and the fade of an away car does not dim them. */
  marks: string;
  /** B53.3: a charging car's glow, a copy of the outline to draw under the top view; "" when the car is not charging. Colour and blur come from the stylesheet. */
  glow: string;
}

/**
 * S35.4 (spec C5, C7): what a car piece wears on the plan, from its status. One function for the 2D and 2.5D paths, so they cannot
 * disagree. The colour is a custom property on the group and a class rule reads it: a rule, not an attribute (finding 18).
 */
export function carLook(m: Furniture, s: CarStatus, dead: boolean): CarLook {
  // The bolt sits toward the tail, not at the centre, where the room's name is when the car is centred in its room.
  const rot = num(m.rot), away = s.place === "away";
  const badges = (away ? `<circle class="away-mark" cx="${num(m.w / 2 - 14)}" r="8"/>` : "")
    + (dead ? `<g class="gone-mark" transform="translate(${num(14 - m.w / 2)} 0) scale(1.4)"><circle r="5"/><line x1="-3" y1="3" x2="3" y2="-3"/></g>` : "")
    + (s.charging ? `<g class="car-bolt" transform="translate(${num(-m.w / 2 + Math.min(38, m.w * 0.3))} 0) rotate(${num(-m.rot)})"><circle r="10"/><path d="M2-6L-4 1h4l-2 5 6-7H2z"/></g>` : "");
  // under the car on screen: half the turned box's height, then a line
  const a = (m.rot * Math.PI) / 180, below = (Math.abs(m.w * Math.sin(a)) + Math.abs(m.h * Math.cos(a))) / 2 + 24;
  const level = s.level === null ? "" : `<text class="val" y="${num(below)}" text-anchor="middle" font-size="24">${s.level} %</text>`;
  return {
    cls: ` furn-car${away ? " away" : ""}${s.charging ? " charging" : ""}${s.alert ? " alert" : ""}`,
    style: typeof m.color === "string" && HEX.test(m.color) ? ` style="--fp-car-body:${m.color}"` : "",
    glow: s.charging ? poly("car-glow", carParts(m.model).outline) : "",
    marks: badges || level ? `<g class="car-marks" transform="translate(%AT%)"><g transform="rotate(${rot})">${badges}</g>${level}</g>` : "",
  };
}
