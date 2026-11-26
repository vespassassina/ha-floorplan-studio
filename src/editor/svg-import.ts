import { typeForEntity, validate } from "../core";
import type { Device, DeviceType, HaData, Layout, Pt, Room } from "../core";

// S79: Import from ha-floorplan SVGs (Studio-only, 0 B in floorplan-studio-card.js).
// Hard caps checked before loops/memory sizing to guard against hostile or huge SVGs.
export const MAX_SVG_BYTES = 5 * 1024 * 1024;
export const MAX_SVG_NODES = 4000;
export const MAX_SVG_ROOMS = 200;
export const MAX_SVG_DEVICES = 500;
const TARGET_WIDTH_CM = 1200;

const HA_DOMAINS = new Set([
  "light", "switch", "sensor", "binary_sensor", "climate", "cover", "camera",
  "media_player", "lock", "fan", "vacuum", "person", "device_tracker", "siren",
  "alarm_control_panel", "water_heater", "humidifier",
]);
const ENTITY_ID_RE = /^([a-z0-9_]+)\.([a-z0-9_]+)$/;
const AUTO_ID_RE = /^(rect|path|polygon|polyline|circle|ellipse|line|g|layer|svg|use|shape)[-_]?\d*$/i;
const SKIP_TAGS = new Set(["defs", "style", "script", "metadata", "title", "desc", "clippath", "mask", "pattern", "lineargradient", "radialgradient", "filter", "marker", "symbol"]);

type Mat = [number, number, number, number, number, number]; // [a, b, c, d, e, f]
const ID_MAT: Mat = [1, 0, 0, 1, 0, 0];

function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMat(m: Mat, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseTransform(raw: string | null): Mat {
  if (!raw) return ID_MAT;
  let m: Mat = ID_MAT;
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const fn = match[1]!.toLowerCase();
    const nums = (match[2]!.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite);
    if (fn === "translate" && nums.length >= 1) {
      m = mul(m, [1, 0, 0, 1, nums[0]!, nums[1] ?? 0]);
    } else if (fn === "scale" && nums.length >= 1) {
      m = mul(m, [nums[0]!, 0, 0, nums[1] ?? nums[0]!, 0, 0]);
    } else if (fn === "rotate" && nums.length >= 1) {
      const rad = (nums[0]! * Math.PI) / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const r: Mat = [c, s, -s, c, 0, 0];
      if (nums.length >= 3) {
        const cx = nums[1]!, cy = nums[2]!;
        m = mul(m, mul([1, 0, 0, 1, cx, cy], mul(r, [1, 0, 0, 1, -cx, -cy])));
      } else m = mul(m, r);
    } else if (fn === "matrix" && nums.length >= 6) {
      m = mul(m, [nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!]);
    }
  }
  return m;
}

function numAttr(el: Element, name: string): number | null {
  const v = el.getAttribute(name);
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseViewBox(svg: Element): { x: number; y: number; w: number; h: number } {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite) && p[2]! > 0 && p[3]! > 0) {
      return { x: p[0]!, y: p[1]!, w: p[2]!, h: p[3]! };
    }
  }
  const w = numAttr(svg, "width"), h = numAttr(svg, "height");
  if (w && w > 0 && h && h > 0) return { x: 0, y: 0, w, h };
  return { x: 0, y: 0, w: 1000, h: 800 };
}

function parsePointsAttr(raw: string | null): Pt[] {
  if (!raw) return [];
  const nums = (raw.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
}

/** Extracts polygon vertices from an SVG path `d` string (supports M/L/H/V/C/S/Q/T/A/Z, abs & rel). */
function parsePathPts(d: string | null): { pts: Pt[]; closed: boolean } {
  if (!d) return { pts: [], closed: false };
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) return { pts: [], closed: false };
  const pts: Pt[] = [];
  let closed = false, cmd = "", i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const next = () => (i < tokens.length ? Number(tokens[i++]) : NaN);
  const isCmd = (s: string) => /^[a-zA-Z]$/.test(s);

  while (i < tokens.length && pts.length < 512) {
    if (isCmd(tokens[i]!)) cmd = tokens[i++]!;
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const u = cmd.toUpperCase();
    if (u === "Z") { closed = true; cx = sx; cy = sy; cmd = ""; continue; }
    if (u === "M" || u === "L" || u === "T") {
      const x = next(), y = next();
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      if (u === "M") { sx = cx; sy = cy; cmd = rel ? "l" : "L"; }
      pts.push([cx, cy]);
    } else if (u === "H") {
      const x = next();
      if (!Number.isFinite(x)) break;
      cx = rel ? cx + x : x;
      pts.push([cx, cy]);
    } else if (u === "V") {
      const y = next();
      if (!Number.isFinite(y)) break;
      cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else if (u === "C") {
      next(); next(); next(); next();
      const x = next(), y = next();
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else if (u === "S" || u === "Q") {
      next(); next();
      const x = next(), y = next();
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else if (u === "A") {
      next(); next(); next(); next(); next();
      const x = next(), y = next();
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      pts.push([cx, cy]);
    } else break;
  }
  return { pts, closed };
}

function shapeGeometry(el: Element, mat: Mat): { pts: Pt[]; closed: boolean; center: Pt } | null {
  const tag = el.localName.toLowerCase();
  if (tag === "rect") {
    const x = numAttr(el, "x") ?? 0, y = numAttr(el, "y") ?? 0;
    const w = numAttr(el, "width") ?? 0, h = numAttr(el, "height") ?? 0;
    if (!(w > 0 && h > 0)) return null;
    const pts = [applyMat(mat, x, y), applyMat(mat, x + w, y), applyMat(mat, x + w, y + h), applyMat(mat, x, y + h)];
    return { pts, closed: true, center: applyMat(mat, x + w / 2, y + h / 2) };
  }
  if (tag === "polygon" || tag === "polyline") {
    const raw = parsePointsAttr(el.getAttribute("points"));
    if (raw.length < 2) return null;
    const pts = raw.map(([x, y]) => applyMat(mat, x, y));
    return { pts, closed: tag === "polygon", center: avgPt(pts) };
  }
  if (tag === "path") {
    const { pts: raw, closed } = parsePathPts(el.getAttribute("d"));
    if (raw.length < 2) return null;
    const pts = raw.map(([x, y]) => applyMat(mat, x, y));
    return { pts, closed, center: avgPt(pts) };
  }
  if (tag === "circle" || tag === "ellipse") {
    const cx = numAttr(el, "cx") ?? 0, cy = numAttr(el, "cy") ?? 0;
    const c = applyMat(mat, cx, cy);
    return { pts: [c], closed: false, center: c };
  }
  if (tag === "line") {
    const a = applyMat(mat, numAttr(el, "x1") ?? 0, numAttr(el, "y1") ?? 0);
    const b = applyMat(mat, numAttr(el, "x2") ?? 0, numAttr(el, "y2") ?? 0);
    return { pts: [a, b], closed: false, center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }
  if (tag === "text" || tag === "image" || tag === "use") {
    const x = numAttr(el, "x") ?? 0, y = numAttr(el, "y") ?? 0;
    const w = numAttr(el, "width") ?? 0, h = numAttr(el, "height") ?? 0;
    const c = applyMat(mat, x + w / 2, y + h / 2);
    return { pts: [c], closed: false, center: c };
  }
  return null;
}

function avgPt(pts: readonly Pt[]): Pt {
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  return [sx / pts.length, sy / pts.length];
}

function polyArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function cleanPoly(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const [x, y] of pts) {
    const p: Pt = [Math.round(x), Math.round(y)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0]![0] === out[out.length - 1]![0] && out[0]![1] === out[out.length - 1]![1]) out.pop();
  return out;
}

function entityIdOf(el: Element): string | null {
  const candidates = [
    el.getAttribute("data-entity"),
    el.getAttribute("id"),
    el.getAttribute("inkscape:label"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const s = raw.trim().toLowerCase();
    const m = ENTITY_ID_RE.exec(s);
    if (m && HA_DOMAINS.has(m[1]!)) return s;
  }
  return null;
}

function inferDeviceType(entityId: string, ha?: HaData | null): DeviceType {
  const live = ha?.entities?.find((e) => e.id === entityId);
  if (live) return typeForEntity(live, ha ?? undefined);
  const dot = entityId.indexOf(".");
  const domain = entityId.slice(0, dot), slug = entityId.slice(dot + 1);
  if (domain === "switch" && /(plug|outlet|socket)/.test(slug)) return "plug";
  if (domain === "sensor") {
    if (/(temp|temperature)/.test(slug)) return "temp";
    if (/humid/.test(slug)) return "humidity";
    if (/(power|watt|energy|meter)/.test(slug)) return "power_meter";
    if (/batt/.test(slug)) return "battery";
  }
  if (domain === "binary_sensor") {
    if (/(motion|pir|occ|presence)/.test(slug)) return "motion";
    if (/(door|window|contact|garage|gate)/.test(slug)) return "contact";
    if (/vibra/.test(slug)) return "vibration";
  }
  if (domain === "media_player") {
    if (/tv|television/.test(slug)) return "tv";
    if (/speaker|sonos|homepod|echo/.test(slug)) return "speaker";
  }
  return typeForEntity({ id: entityId, name: slug, domain });
}

function roomNameOf(el: Element, fallbackIdx: number): string {
  const titleEl = Array.from(el.children).find((c) => c.localName.toLowerCase() === "title");
  const raw = (el.getAttribute("inkscape:label") || titleEl?.textContent || el.getAttribute("id") || "").trim();
  if (!raw || AUTO_ID_RE.test(raw)) return `Room ${fallbackIdx}`;
  const nice = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return nice ? nice[0]!.toUpperCase() + nice.slice(1) : `Room ${fallbackIdx}`;
}

function slugOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "room";
}

function groupCentroid(el: Element, mat: Mat, budget: { n: number }): Pt | null {
  const pts: Pt[] = [];
  const walk = (node: Element, m: Mat) => {
    if (budget.n++ > MAX_SVG_NODES) return;
    if (SKIP_TAGS.has(node.localName.toLowerCase())) return;
    const nextM = mul(m, parseTransform(node.getAttribute("transform")));
    const g = shapeGeometry(node, nextM);
    if (g) pts.push(g.center);
    for (const child of Array.from(node.children)) walk(child, nextM);
  };
  for (const child of Array.from(el.children)) walk(child, mat);
  return pts.length ? avgPt(pts) : null;
}

export type SvgImportResult =
  | { ok: true; layout: Layout; rooms: number; devices: number }
  | { ok: false; error: string };

/** Parses an `ha-floorplan` SVG string into a validated Floorplan Studio `Layout`. */
export function importHaFloorplanSvg(svgText: string, ha?: HaData | null): SvgImportResult {
  if (typeof svgText !== "string" || !svgText.trim()) return { ok: false, error: "SVG file is empty." };
  if (svgText.length > MAX_SVG_BYTES) return { ok: false, error: `SVG exceeds the ${(MAX_SVG_BYTES / 1048576).toFixed(0)} MB import limit.` };

  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) return { ok: false, error: "File is not valid XML/SVG." };
  const svg = doc.documentElement;
  if (!svg || svg.localName.toLowerCase() !== "svg") return { ok: false, error: "Root element is not <svg>." };

  const vb = parseViewBox(svg);
  const scale = TARGET_WIDTH_CM / vb.w;
  const vbArea = vb.w * vb.h;
  const toCm = ([x, y]: Pt): Pt => [Math.round((x - vb.x) * scale), Math.round((y - vb.y) * scale)];

  const rooms: Room[] = [];
  const devices: Device[] = [];
  const seenEntities = new Set<string>();
  const budget = { n: 0 };

  const walk = (el: Element, parentMat: Mat) => {
    if (budget.n++ > MAX_SVG_NODES) return;
    const tag = el.localName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    const mat = mul(parentMat, parseTransform(el.getAttribute("transform")));

    const entityId = entityIdOf(el);
    if (entityId && !seenEntities.has(entityId) && devices.length < MAX_SVG_DEVICES) {
      const geom = shapeGeometry(el, mat);
      const center = geom ? geom.center : groupCentroid(el, mat, budget);
      if (center) {
        seenEntities.add(entityId);
        const [x, y] = toCm(center);
        const type = inferDeviceType(entityId, ha);
        const slug = entityId.slice(entityId.indexOf(".") + 1).replace(/_/g, " ");
        devices.push({ id: `dev-ground-${devices.length + 1}`, type, entity: entityId, name: slug ? slug[0]!.toUpperCase() + slug.slice(1) : entityId, x, y });
      }
      return; // do not also extract child shapes of an entity group as rooms
    }

    const geom = shapeGeometry(el, mat);
    if (geom && geom.closed && geom.pts.length >= 3 && rooms.length < MAX_SVG_ROOMS) {
      const area = polyArea(geom.pts);
      if (area >= vbArea * 0.005 && area <= vbArea * 0.85) {
        const pts = cleanPoly(geom.pts.map(toCm));
        if (pts.length >= 3 && polyArea(pts) >= 400) {
          const name = roomNameOf(el, rooms.length + 1);
          rooms.push({
            id: `room-ground-${rooms.length + 1}`,
            name,
            area: slugOf(name),
            kind: "room",
            pts,
            wk: pts.map(() => "wall"),
          });
        }
      }
    }

    for (const child of Array.from(el.children)) walk(child, mat);
  };

  for (const child of Array.from(svg.children)) walk(child, ID_MAT);

  if (!rooms.length && !devices.length) {
    return { ok: false, error: "No rooms or Home Assistant entity IDs were found in this SVG." };
  }

  // Compute enclosing floor outline
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  for (const r of rooms) for (const [x, y] of r.pts) grow(x, y);
  for (const d of devices) if ("x" in d) grow(d.x, d.y);
  const pad = rooms.length ? 0 : 100;
  if (!Number.isFinite(minX) || maxX - minX < 50 || maxY - minY < 50) {
    minX = 0; minY = 0; maxX = TARGET_WIDTH_CM; maxY = Math.round(vb.h * scale);
  } else {
    minX = Math.round(minX - pad); minY = Math.round(minY - pad);
    maxX = Math.round(maxX + pad); maxY = Math.round(maxY + pad);
  }
  const outline: Pt[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];

  const layout: Layout = {
    version: 2,
    unit: "cm",
    north: 0,
    floors: {
      ground: {
        title: "Ground",
        outline,
        rooms,
        walls: [],
        stairs: [],
        doors: [],
        openings: [],
        extras: [],
        devices,
        furniture: [],
        unlinked: [],
      },
    },
    catalog: [],
  };

  const checked = validate(layout);
  if (!checked.ok) return { ok: false, error: `Imported SVG failed layout validation: ${checked.errors[0] ?? "unknown error"}` };
  return { ok: true, layout: checked.layout, rooms: rooms.length, devices: devices.length };
}
