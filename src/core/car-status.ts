// S35.3: what a car's entities say about the car (docs/specs/car-s35.md, C5). Read by domain, device class and state, never by
// integration. Every state read here is untrusted (finding 1): nothing throws, junk reads as "nothing to report".
import { isEntityId, type Device } from "./schema";
import { t } from "./i18n";

/** A car piece or a car device: its main `entity` and the other entities attached to it. Loose on purpose, a layout is untrusted. */
export interface CarLike { entity?: unknown; attached?: unknown }
/** A device that stands for a car (`pieceDevice`): the plain device, plus the attached entities the piece carries. */
export type CarDevice = Device & { attached?: string[] };
type States = Record<string, { state?: unknown; attributes?: unknown } | undefined> | null | undefined;

export interface CarStatus {
  /** `home` or `away` from the first `device_tracker.*`; `unknown` when it is dead or unread; `none` when the car has no tracker. */
  place: "home" | "away" | "unknown" | "none";
  /** The zone's name when away in a zone; absent for `not_home` and at home. */
  zone?: string;
  charging: boolean;
  /** Battery, else fuel, as a whole percent from 0 to 100; null when neither is readable. */
  level: number | null;
  /** A lock that is unlocked or open, or a door, window or opening sensor that is on. */
  alert: boolean;
}

const domainOf = (e: string): string => e.slice(0, e.indexOf("."));
const OPENINGS = new Set(["door", "window", "opening", "garage_door"]);
/** Charge-state words by value: Tesla and Volvo send `charging`, Renault `charge_in_progress`. Add a word here, in one place. */
const CHARGING_WORDS = new Set(["charging", "charge_in_progress"]);

/** The entity ids a car carries, main first, then `attached` in order, no repeat and no junk. */
export function carEntities(m: CarLike | null | undefined): string[] {
  const list = [m?.entity, ...(Array.isArray(m?.attached) ? (m?.attached as unknown[]) : [])].filter(isEntityId);
  return [...new Set(list)];
}

/** The car's main entity, the one a tap opens: `entity`, else the first attached entity id. Null when it has none. */
export function carMain(m: CarLike | null | undefined): string | null {
  return carEntities(m)[0] ?? null;
}

interface Reading { state: string; attrs: Record<string, unknown> }
/** One entity's state and attributes, or null. A getter that throws, a number, or a missing entry all read as null. */
function read(states: States, e: string): Reading | null {
  try {
    const s = states && Object.prototype.hasOwnProperty.call(states, e) ? states[e] : undefined;
    if (!s || typeof s !== "object" || typeof s.state !== "string") return null;
    const a = s.attributes;
    return { state: s.state, attrs: a && typeof a === "object" ? (a as Record<string, unknown>) : {} };
  } catch { return null; }
}

/** A percent reading from 0 to 100, rounded; null for anything else. */
function percent(r: Reading): number | null {
  const n = r.state.trim() === "" ? NaN : Number(r.state);
  return r.attrs.unit_of_measurement === "%" && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

/** Charging, level and alert from the car's entities in order; battery wins over fuel whatever the order. */
export function carStatus(m: CarLike | null | undefined, states: States): CarStatus {
  const ids = carEntities(m);
  const tracker = ids.find((e) => domainOf(e) === "device_tracker");
  let place: CarStatus["place"] = "none", zone: string | undefined;
  if (tracker) {
    const s = read(states, tracker)?.state.trim() ?? "";
    place = s === "home" ? "home" : s === "" || s === "unknown" || s === "unavailable" ? "unknown" : "away";
    if (place === "away" && s !== "not_home") zone = s;
  }
  let charging = false, alert = false, battery: number | null = null, fuel: number | null = null;
  for (const e of ids) {
    const r = read(states, e);
    if (!r) continue;
    const domain = domainOf(e), cls = r.attrs.device_class, word = r.state.trim().toLowerCase();
    if (domain === "binary_sensor" && cls === "battery_charging" && word === "on") charging = true;
    if (domain === "sensor" && CHARGING_WORDS.has(word)) charging = true;
    if (domain === "lock" && (word === "unlocked" || word === "open")) alert = true;
    if (domain === "binary_sensor" && typeof cls === "string" && OPENINGS.has(cls) && word === "on") alert = true;
    if (domain === "sensor" && battery === null && cls === "battery") battery = percent(r);
    if (domain === "sensor" && fuel === null && e.toLowerCase().includes("fuel")) fuel = percent(r);
  }
  return { place, ...(zone ? { zone } : {}), charging, level: battery ?? fuel, alert };
}

/** One line: `Home`, `Away`, `Away · Work`, then `Charging`, then `78 %`. Plain text; the caller escapes it where it is markup (finding 2). */
export function carText(s: CarStatus): string {
  const place = s.place === "home" ? t("Home|car") : s.place === "away" ? (s.zone ? t("Away · {zone}", { zone: s.zone }) : t("Away")) : s.place === "unknown" ? t("Unknown") : "";
  return [place, s.charging ? t("Charging") : "", s.level === null ? "" : `${s.level} %`].filter(Boolean).join(" · ");
}
