import { typeForEntity } from "../core";
import { MAX_CAR_ATTACHED } from "../core/schema";
import type { CarModel, CatalogEntry, Device, Furniture, HaData, Unlinked } from "../core";
import type { GroupedChoice } from "./sensor-order";

/** S35.7 (spec C9): the pure parts of the Studio's car panel. `EditorState` wraps them in undo steps. */

type HaEntity = HaData["entities"][number];

/** What the model select reads (spec C3), in `CAR_MODELS` order. */
export const CAR_LABELS: Record<CarModel, string> = {
  sedan: "Sedan", wagon: "Wagon", suv: "SUV", offroad: "Off-road", truck: "Pickup truck", van: "Van",
  utility: "Utility (hatchback)", citycar: "City car", electric: "Electric (Tesla-like)",
};

/** The car domains, in the order the picker lists them (spec C9). */
const CAR_DOMAINS = ["device_tracker", "sensor", "binary_sensor", "lock", "climate", "cover", "switch"];

/** The car's main entity: the one a tap opens. Absent, the first attached one (C2). */
export const carMain = (m: Pick<Furniture, "entity" | "attached">): string | undefined => m.entity ?? m.attached?.[0];

/** A name from a catalog or Home Assistant is untrusted: a missing or non-text one reads as empty (review finding 13). */
const nameOf = (e: { name?: unknown }): string => String(e.name ?? "");
const byName = (a: HaEntity, b: HaEntity) => nameOf(a).localeCompare(nameOf(b), "en") || (a.id < b.id ? -1 : 1);

/**
 * The entities offered to attach to a car, in groups that come in this order: those of the main entity's Home Assistant
 * device; those whose name or id holds the car's name; the car domains (by `CAR_DOMAINS`, then name); everything else;
 * and diagnostic ones last, whatever else they are. Without Home Assistant, the catalog stands in. The main entity and
 * what is attached already are left out.
 */
export function carAttachGroups(m: Furniture, ha: HaData | undefined, catalog: readonly CatalogEntry[]): GroupedChoice[] {
  const known = new Set<string>([...(m.attached ?? []), ...(carMain(m) ? [carMain(m)!] : [])]);
  const pool: HaEntity[] = [...(ha?.entities ?? [])];
  for (const c of catalog) if (!pool.some((e) => e.id === c.entity)) pool.push({ id: c.entity, name: c.name, domain: c.entity.split(".")[0] });
  const dev = ha?.entities.find((e) => e.id === carMain(m))?.dev;
  const car = m.symbol === "car", noun = car ? "car" : "piece";
  const word = (m.name ?? "").trim().toLowerCase();
  const holds = (e: HaEntity) => !!word && (nameOf(e).toLowerCase().includes(word) || e.id.toLowerCase().includes(word.replace(/\s+/g, "_")));
  const rank = (e: HaEntity): [number, string] => {
    if (e.cat === "diagnostic" || e.cat === "config") return [4, "Diagnostic"];
    if (dev && e.dev === dev) return [0, `This ${noun}'s device`];
    if (holds(e)) return [1, `Named like this ${noun}`];
    if (CAR_DOMAINS.includes(e.domain)) return [2, car ? "Car entities" : "Likely entities"];
    return [3, "Other"];
  };
  return pool.filter((e) => !known.has(e.id))
    .map((e) => ({ e, r: rank(e) }))
    .sort((a, b) => a.r[0] - b.r[0] || (a.r[0] === 2 ? CAR_DOMAINS.indexOf(a.e.domain) - CAR_DOMAINS.indexOf(b.e.domain) : 0) || byName(a.e, b.e))
    .map(({ e, r }): GroupedChoice => ({ group: r[1], entry: { id: e.id, floor: "", room: "", type: typeForEntity(e, ha), name: nameOf(e) || e.id, entity: e.id } }));
}

/** What "Add all from this car" attaches: the main entity's device, not yet attached, ordinary entities before diagnostic ones, at most the room the car has left (24 in all). */
export function carDeviceEntities(m: Furniture, ha: HaData | undefined): string[] {
  const main = carMain(m);
  const dev = ha?.entities.find((e) => e.id === main)?.dev;
  if (!dev) return [];
  const diag = (e: HaEntity) => (e.cat === "diagnostic" || e.cat === "config" ? 1 : 0);
  const have = new Set(m.attached ?? []);
  return ha!.entities.filter((e) => e.dev === dev && e.id !== main && !have.has(e.id))
    .sort((a, b) => diag(a) - diag(b) || byName(a, b))
    .slice(0, Math.max(0, MAX_CAR_ATTACHED - have.size))
    .map((e) => e.id);
}

const isEntity = (x: unknown): x is string => typeof x === "string" && x.includes(".");

/**
 * A car piece (a sedan, 470 x 182) from a device or unlinked appliance of type `car`: same point and turn; a device's `entity`
 * is the main one, an appliance's `attached` carries over, `color` and `name` stay. Only what `validate` accepts is kept, since
 * the appliance may come from a file that had not been checked.
 */
export function convertedCar(from: Device | Unlinked, id: string): Furniture {
  // A device may be a line (a, b) in a hand-written file; its middle is the point.
  const [x, y] = "x" in from ? [from.x, from.y] : [(from.a[0] + from.b[0]) / 2, (from.a[1] + from.b[1]) / 2];
  const piece: Furniture = { id, symbol: "car", x, y, rot: typeof from.rot === "number" && Number.isFinite(from.rot) ? from.rot : 0, w: 470, h: 182 };
  if (typeof from.name === "string" && from.name.trim()) piece.name = from.name;
  if ("entity" in from && isEntity(from.entity)) piece.entity = from.entity;
  if ("color" in from && typeof from.color === "string" && /^#[0-9a-fA-F]{6}$/.test(from.color)) piece.color = from.color.toLowerCase();
  if ("attached" in from && Array.isArray(from.attached)) {
    const kept = [...new Set(from.attached.filter(isEntity))].slice(0, MAX_CAR_ATTACHED);
    if (kept.length) piece.attached = kept;
  }
  return piece;
}
