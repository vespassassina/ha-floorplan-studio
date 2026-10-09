import { CATEGORIES, CATEGORY_OF, type CategoryId } from "./categories";
import type { DeviceType, Floor } from "./schema";

/**
 * S24.6 (U6): Layers, what the plan draws by family. The families are the card's categories (`CATEGORIES`, so the
 * Studio and the card group the same way) plus Furniture. A device and an unlinked appliance belong to the family of
 * their type; every piece of furniture, a linked tv or speaker piece too, belongs to Furniture. A view keeps the list
 * of HIDDEN families: empty, the default, draws everything, and a family added later starts visible.
 * The Studio's Layers tab and the card's layer chips (S24.8) both use this module and `renderFloor`'s `hiddenLayers`.
 */
export type LayerId = CategoryId | "furniture";

export const LAYERS: readonly { id: LayerId; label: string }[] = [...CATEGORIES, { id: "furniture", label: "Furniture" }];

const IDS: readonly LayerId[] = LAYERS.map((l) => l.id);

/** The family of a device type; a type nobody placed (an untrusted layout) is Other, as in `groupByCategory`. */
export function layerOfType(t: DeviceType): LayerId {
  return Object.prototype.hasOwnProperty.call(CATEGORY_OF, t) ? CATEGORY_OF[t] : "other";
}

/** What the plan can draw as selected: one thing, or (S26.4) several devices. */
export type PlanSel = { t: string; i: number } | { t: "devs"; is: readonly number[] };

/** Whether `s` is a multi-selection that holds device `i`. Junk (no list, a non-integer entry) holds nothing. Never throws. */
export function devsHave(s: PlanSel | null | undefined, i: number): boolean {
  return s?.t === "devs" && Array.isArray((s as { is?: unknown }).is) && (s as unknown as { is: unknown[] }).is.includes(i);
}

/**
 * Whether `hidden` leaves a device, piece of furniture or unlinked appliance off the plan. A thing that `keep` names
 * (the selection, a found thing) is drawn anyway. One rule for what is drawn and what a click can pick: the Studio's
 * computed hit-test (`furnitureNear`) asks it, so nothing invisible is picked. Never throws on junk.
 */
export function layerHides(hidden: readonly LayerId[] | undefined, t: "dev" | "furn" | "unl", i: number, type?: DeviceType, ...keep: (PlanSel | null | undefined)[]): boolean {
  if (!Array.isArray(hidden) || !hidden.length) return false;
  if (keep.some((s) => (s?.t === t && (s as { i?: number }).i === i) || (t === "dev" && devsHave(s, i)))) return false;
  return hidden.includes(t === "furn" ? "furniture" : layerOfType(type as DeviceType));
}

/** Known ids only, once each, in layer order. For storage and anything else that cannot be trusted. Never throws. */
export function parseLayers(raw: unknown): LayerId[] {
  if (!Array.isArray(raw)) return [];
  const got = new Set(raw.filter((x): x is string => typeof x === "string"));
  return IDS.filter((id) => got.has(id));
}

/** One click: a shown family is hidden, a hidden one shown. */
export function toggleLayer(hidden: readonly LayerId[], id: LayerId): LayerId[] {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id); else next.add(id);
  return IDS.filter((x) => next.has(x));
}

/** Alt-click: show only `id`. When it is already the only one shown, show everything again, so the same gesture undoes it. */
export function soloLayer(hidden: readonly LayerId[], id: LayerId): LayerId[] {
  const solo = IDS.filter((x) => x !== id);
  const already = hidden.length === solo.length && solo.every((x) => hidden.includes(x));
  return already ? [] : solo;
}

/** How many things of each family a floor has. Junk counts nothing and never throws. */
export function layerCounts(f: Floor): Record<LayerId, number> {
  const out = Object.fromEntries(IDS.map((id) => [id, 0])) as Record<LayerId, number>;
  const list = (k: "devices" | "unlinked" | "furniture"): unknown[] => (Array.isArray(f?.[k]) ? (f[k] as unknown[]) : []);
  for (const k of ["devices", "unlinked"] as const) {
    for (const d of list(k)) out[layerOfType((d as { type?: DeviceType } | null)?.type as DeviceType)]++;
  }
  out.furniture = list("furniture").length;
  return out;
}

const lower = (id: LayerId) => (LAYERS.find((l) => l.id === id)?.label ?? id).toLowerCase();

/** The one line that says what is hidden; empty when nothing is. */
export function layersSummary(hidden: readonly LayerId[]): string {
  const h = parseLayers(hidden);
  if (!h.length) return "";
  if (h.length === 1) return `Layers: ${lower(h[0])} hidden`;
  if (h.length === IDS.length) return "Layers: all hidden";
  if (h.length === IDS.length - 1) return `Layers: only ${lower(IDS.find((id) => !h.includes(id))!)} shown`;
  return `Layers: ${h.length} of ${IDS.length} hidden`;
}
