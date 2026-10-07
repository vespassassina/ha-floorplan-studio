import type { DeviceType } from "./schema";

/**
 * S14.6: the categories the card's Active list and Room panel group their rows by (docs/specs/card-polish-and-light.md,
 * item 12). The order of `CATEGORIES` is the order on screen. Every `DeviceType` is placed in exactly one category by
 * `CATEGORY_OF`, a `Record`, so a new type fails to compile until someone decides where it goes (CLAUDE.md finding 17).
 */
export type CategoryId = "lights" | "climate" | "security" | "media" | "power" | "covers" | "computing" | "sensors" | "people" | "other";

export const CATEGORIES: readonly { id: CategoryId; label: string }[] = [
  { id: "lights", label: "Lights" },
  { id: "climate", label: "Climate" },
  { id: "security", label: "Security" },
  { id: "media", label: "Media" },
  { id: "power", label: "Power" },
  { id: "covers", label: "Covers" },
  { id: "computing", label: "Computers and network" },
  { id: "sensors", label: "Sensors" },
  { id: "people", label: "People" },
  { id: "other", label: "Other" },
];

export const CATEGORY_OF: Record<DeviceType, CategoryId> = {
  light: "lights",
  heater: "climate", climate: "climate", ac: "climate", boiler: "climate",
  camera: "security", siren: "security", alarm: "security", lock: "security", motion: "security", contact: "security", vibration: "security", radar: "security",
  tv: "media", media: "media", speaker: "media",
  switch: "power", plug: "power", battery: "power", inverter: "power", ups: "power",
  cover: "covers",
  computer: "computing", server: "computing", access_point: "computing", printer: "computing",
  temp: "sensors", humidity: "sensors",
  person: "people",
  vacuum: "other", car: "other", other: "other",
};

export interface CategoryGroup<T> { id: CategoryId; label: string; items: T[] }

/** `items` in category order, each group keeping the input order, empty categories dropped. A type nobody placed (an
 *  untrusted layout) lands in "other" rather than throwing. */
export function groupByCategory<T extends { type: DeviceType }>(items: readonly T[]): CategoryGroup<T>[] {
  const by = new Map<CategoryId, T[]>();
  for (const it of items) {
    const id = CATEGORY_OF[it.type] ?? "other";
    const arr = by.get(id);
    if (arr) arr.push(it);
    else by.set(id, [it]);
  }
  return CATEGORIES.filter((c) => by.has(c.id)).map((c) => ({ id: c.id, label: c.label, items: by.get(c.id)! }));
}
