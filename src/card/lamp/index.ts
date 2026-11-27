// Lazy chunk for Sprint 62 ("Lamps That Look the Part"): 7 lamp symbols and 2D/2.5D light emissions.
// Zero runtime imports from `card/` or `core/` so the chunk stays self-contained and under budget.
import type { LampRenderer } from "../../core/render";

const num = (n: number): string => String(Math.round(n * 100) / 100);
const RAD = Math.PI / 180;

function ensureDefs(defs: Set<string>, id: string, markup: string, out: string[]): void {
  if (defs.has(id)) return;
  defs.add(id);
  out.push(`<defs>${markup}</defs>`);
}

export const lampRenderer: LampRenderer = {
  aura({ kind, c, rot, scale, reach, lamp, style, clip, defs, out }) {
    const cx = num(c[0]), cy = num(c[1]);
    if (kind === "spot") {
      ensureDefs(
        defs,
        "fp-spot-falloff",
        `<radialGradient id="fp-spot-grad"><stop offset="0" stop-opacity="1"/><stop offset=".65" stop-opacity=".85"/><stop offset="1" stop-opacity="0"/></radialGradient>` +
          `<mask id="fp-spot-falloff" class="fp-falloff" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fp-spot-grad)"/></mask>`,
        out,
      );
      const r = num(38 * scale);
      out.push(`<circle class="aura lamp-aura-spot" cx="${cx}" cy="${cy}" r="${r}"${clip} mask="url(#fp-spot-falloff)"${style}/>`);
      return;
    }
    if (kind === "strip") {
      ensureDefs(
        defs,
        "fp-strip-falloff",
        `<linearGradient id="fp-strip-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-opacity="0"/><stop offset=".35" stop-opacity=".85"/><stop offset=".5" stop-opacity="1"/><stop offset=".65" stop-opacity=".85"/><stop offset="1" stop-opacity="0"/></linearGradient>` +
          `<mask id="fp-strip-falloff" class="fp-falloff" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fp-strip-grad)"/></mask>`,
        out,
      );
      const len = Math.max(20, lamp.length ?? 150);
      const halfW = len / 2 + 24 * scale;
      const halfH = 44 * scale;
      const tf = rot ? ` transform="rotate(${num(rot)} ${cx} ${cy})"` : "";
      const rect = `<rect class="aura lamp-aura-strip" x="${num(c[0] - halfW)}" y="${num(c[1] - halfH)}" width="${num(halfW * 2)}" height="${num(halfH * 2)}" rx="${num(halfH)}" mask="url(#fp-strip-falloff)"${tf}${style}/>`;
      out.push(clip ? `<g${clip}>${rect}</g>` : rect);
      return;
    }
    if (kind === "flood") {
      ensureDefs(
        defs,
        "fp-lamp-falloff",
        `<radialGradient id="fp-lamp-grad"><stop offset="0" stop-opacity="1"/><stop offset=".6" stop-opacity=".33"/><stop offset="1" stop-opacity="0"/></radialGradient>` +
          `<mask id="fp-lamp-falloff" class="fp-falloff" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fp-lamp-grad)"/></mask>`,
        out,
      );
      const ang = Math.min(160, Math.max(15, lamp.angle ?? 60));
      const r = (lamp.reach ?? 300) * scale;
      const a0 = (-90 + rot - ang / 2) * RAD;
      const a1 = (-90 + rot + ang / 2) * RAD;
      const p0 = `${num(c[0] + r * Math.cos(a0))} ${num(c[1] + r * Math.sin(a0))}`;
      const p1 = `${num(c[0] + r * Math.cos(a1))} ${num(c[1] + r * Math.sin(a1))}`;
      const d = `M${cx} ${cy}L${p0}A${num(r)} ${num(r)} 0 0 1 ${p1}Z`;
      out.push(`<path class="aura lamp-aura-flood" d="${d}"${clip} mask="url(#fp-lamp-falloff)"${style}/>`);
      return;
    }
    // floor, desk, ceiling, pole: radial pool with kind-specific radius multiplier.
    ensureDefs(
      defs,
      "fp-lamp-falloff",
      `<radialGradient id="fp-lamp-grad"><stop offset="0" stop-opacity="1"/><stop offset=".6" stop-opacity=".33"/><stop offset="1" stop-opacity="0"/></radialGradient>` +
        `<mask id="fp-lamp-falloff" class="fp-falloff" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fp-lamp-grad)"/></mask>`,
      out,
    );
    const r = kind === "street" ? (lamp.reach ?? 450) * scale : reach * (kind === "desk" ? 0.7 : kind === "ceiling" ? 1.1 : kind === "pole" ? 1.4 : 1);
    out.push(`<circle class="aura lamp-aura-${kind}" cx="${cx}" cy="${cy}" r="${num(r)}"${clip} mask="url(#fp-lamp-falloff)"${style}/>`);
  },

  icon({ kind, k, lamp }) {
    const halo = `<circle class="halo" cx="12" cy="12" r="16"/>`;
    if (kind === "floor") {
      return `${halo}<circle class="lamp-stroke" cx="12" cy="12" r="10.5" stroke-width="1" stroke-dasharray="2 2"/><circle class="lamp-stroke" cx="12" cy="12" r="7.5" stroke-width="1.8"/><path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z"/>`;
    }
    if (kind === "desk") {
      return `${halo}<path d="M7 15.5H17V17.8H7Z M10 15.5L8.2 9.5L13 6L14 7.5L10.3 10.2L11.7 15.5Z M11.8 5.2L17.5 8.5L14.2 11.2Z"/>`;
    }
    if (kind === "strip") {
      const half = Math.max(10, Math.min(500, (lamp.length ?? 150) / 2)) / k;
      return `<rect class="halo" x="${num(12 - half - 3)}" y="6" width="${num(half * 2 + 6)}" height="12" rx="6"/><path d="M${num(12 - half)} 9.5H${num(12 + half)}A2.5 2.5 0 0 1 ${num(12 + half)} 14.5H${num(12 - half)}A2.5 2.5 0 0 1 ${num(12 - half)} 9.5Z"/><line class="lamp-stroke" x1="${num(12 - half + 3)}" y1="12" x2="${num(12 + half - 3)}" y2="12" stroke-width="1.4" stroke-dasharray="2.5 2.5" stroke-linecap="round"/>`;
    }
    if (kind === "ceiling") {
      const r = Math.max(6, Math.min(100, (lamp.diameter ?? 40) / 2)) / k;
      const ir = Math.max(3, r * 0.45);
      return `<circle class="halo" cx="12" cy="12" r="${num(r + 3)}"/><circle class="lamp-stroke" cx="12" cy="12" r="${num(r)}" stroke-width="1.8"/><path d="M12 ${num(12 - ir)}A${num(ir)} ${num(ir)} 0 1 0 12 ${num(12 + ir)}A${num(ir)} ${num(ir)} 0 1 0 12 ${num(12 - ir)}Z"/>`;
    }
    if (kind === "spot") {
      return `${halo}<circle class="lamp-stroke" cx="12" cy="12" r="6.8" stroke-width="2"/><path d="M12 9A3 3 0 1 0 12 15A3 3 0 1 0 12 9Z"/>`;
    }
    if (kind === "pole") {
      return `${halo}<circle class="lamp-stroke" cx="12" cy="12" r="6.5" stroke-width="1.8"/><path class="lamp-stroke" d="M12 3.5V7M12 17V20.5M3.5 12H7M17 12H20.5" stroke-width="1.6" stroke-linecap="round"/><path d="M12 9.2A2.8 2.8 0 1 0 12 14.8A2.8 2.8 0 1 0 12 9.2Z"/>`;
    }
    if (kind === "flood") {
      return `${halo}<path d="M6.5 16L8.5 8.5H15.5L17.5 16Z M8.5 16.5H15.5V18.5H8.5Z"/><path class="lamp-stroke" d="M9.5 6.3H14.5" stroke-width="1.8" stroke-linecap="round"/>`;
    }
    if (kind === "street") {
      return `${halo}<path class="lamp-stroke" d="M9 19.5V8.5Q9 5.5 12.5 5.5H16" stroke-width="1.9" stroke-linecap="round"/><path d="M13.5 6.5H18.5L17.2 9.5H14.8Z"/><circle cx="16" cy="11.2" r="1.6"/>`;
    }
    const _exhaustive: never = kind;
    return _exhaustive;
  },
};
