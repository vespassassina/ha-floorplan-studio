import type { Pt } from "../core";
import { num } from "./editor-kit";

// S83: Studio interactive measurement ruler tool (Studio-only, 0 B in floorplan-studio-card.js).

export interface RulerState {
  a: Pt | null;
  b: Pt | null;
  locked: boolean;
}

export interface RulerMeasure {
  cm: number;
  dx: number;
  dy: number;
  label: string;
  status: string;
}

/** Pure distance formatting for the Studio ruler tool (metric cm / m + Δx, Δy). */
export function formatRulerMeasure(a: Pt, b: Pt): RulerMeasure {
  const dx = Math.round(Math.abs(b[0] - a[0]));
  const dy = Math.round(Math.abs(b[1] - a[1]));
  const cm = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));
  const label = cm >= 100 ? `${(cm / 100).toFixed(2)} m · ${cm} cm` : `${cm} cm`;
  const main = cm >= 100 ? `${(cm / 100).toFixed(2)} m (${cm} cm)` : `${cm} cm`;
  const status = `Measured ${main} — Δx ${dx} cm, Δy ${dy} cm. Click again to measure or Esc to exit.`;
  return { cm, dx, dy, label, status };
}

/** SVG overlay for the active ruler line, endpoints, and upright midpoint label. */
export function rulerSvg(r: RulerState | null, k: number, turnDeg: number): string {
  if (!r?.a) return "";
  const a = r.a, b = r.b;
  const dotR = 4.5 * k;
  const parts: string[] = [
    `<circle class="ruler-pt" cx="${num(a[0])}" cy="${num(a[1])}" r="${num(dotR)}"/>`,
  ];
  if (b && (b[0] !== a[0] || b[1] !== a[1])) {
    const m = formatRulerMeasure(a, b);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const up = turnDeg % 360 ? ` transform="rotate(${num(-turnDeg)} ${num(mx)} ${num(my)})"` : "";
    parts.unshift(`<line class="ruler-ln" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`);
    parts.push(`<circle class="ruler-pt" cx="${num(b[0])}" cy="${num(b[1])}" r="${num(dotR)}"/>`);
    parts.push(`<text class="len ruler-lbl" x="${num(mx)}" y="${num(my - 6 * k)}"${up} text-anchor="middle" font-size="${num(11 * k)}">${m.label}</text>`);
  }
  return `<g class="ruler-ov" pointer-events="none">${parts.join("")}</g>`;
}
