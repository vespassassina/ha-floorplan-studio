// B53.11: a furniture piece linked to Home Assistant, like the car (docs/specs/batch-s52.md, item 19d). Which pieces link, what their
// entities say, and the line the popup prints. Read by domain, device class and state, never by integration. Every state read
// here is untrusted (finding 1): nothing throws, junk reads as "nothing to report". One list, one status, one text.
import { carEntities, domainOf, percent, read, type CarLike, type States } from "./car-status";
import { MIN_MOISTURE, isLinked, validMinMoisture } from "./schema";
export { APPLIANCES, LINKABLE, LINKED, MIN_MOISTURE, isLinkable, isLinked, validMinMoisture } from "./schema";
import { t } from "./i18n";
import type { Device } from "./schema";

/** What `pieceDevice` returns for a linked appliance or plant: a plain device that carries the piece's symbol and entities. */
export type LinkedDevice = Device & { sym: string; attached: string[]; min?: number };
/** What a linked piece wears on the plan: state classes for its group, and (a thirsty plant) the glow drawn under the symbol. */
export interface LinkLook { cls: string; glow: string }
/** The glow: a soft rounded frame in the symbol's 100 x 100 space. Colour, blur and breath come from the stylesheet. */
const GLOW = '<rect class="plant-glow" x="4" y="4" width="92" height="92" rx="14"/>';

/** The link status of a device `pieceDevice` made for a linked piece; null for any other device. */
export function linkedStatus(d: Device, states: States, now?: number): { sym: string; status: LinkStatus } | null {
  const sym = (d as Partial<LinkedDevice>).sym;
  return typeof sym === "string" && isLinked(sym) ? { sym, status: linkStatus(sym, { entity: d.entity, attached: (d as LinkedDevice).attached, min: (d as LinkedDevice).min }, states, now) } : null;
}

/** The classes and glow for a status. ` thirsty` for a plant below its threshold, ` alert` for a door left open or an error. */
export function linkLook(sym: unknown, s: LinkStatus): LinkLook {
  return { cls: `${s.thirsty ? " thirsty" : ""}${s.alert ? " alert" : ""}`, glow: s.thirsty ? GLOW : "" };
}

/** A power sensor above this many watts means the appliance is working. One number, here. */
export const RUN_WATTS = 5;
/** What an appliance's own state sensor says while it works: Home Connect `run`, Miele `in_use`, SmartThings `running`. Add a word here, in one place. */
const RUNNING_WORDS = new Set(["run", "running", "wash", "washing", "rinse", "rinsing", "spin", "spinning", "dry", "drying", "cooking", "heating", "in_use", "active"]);
const ERROR_WORDS = new Set(["error", "fault"]);
const DOORS = new Set(["door", "window", "opening", "garage_door"]);

/** A piece or a device that stands for one: its entities, and (a plant) its own moisture threshold. Loose, a layout is untrusted. */
export type LinkLike = CarLike & { minMoisture?: unknown; min?: unknown };

export interface LinkStatus {
  /** An appliance at work. Always false for a plant. */
  running: boolean;
  /** Whole minutes left of the program, at least 1; null when unknown or not running. */
  remaining: number | null;
  /** `door`: a door or opening sensor is on. `error`: a state sensor says error or fault. */
  alert: "door" | "error" | null;
  /** A plant's moisture, a whole percent; null when unread. */
  moisture: number | null;
  /** A plant below its threshold, or one its `plant.*` entity calls low. Always false for an appliance. */
  thirsty: boolean;
}

/** Watts from a power sensor: W, or kW times 1000; null for any other unit or a number that is not one. */
function watts(r: { state: string; attrs: Record<string, unknown> }): number | null {
  const n = r.state.trim() === "" ? NaN : Number(r.state), unit = r.attrs.unit_of_measurement;
  return !Number.isFinite(n) ? null : unit === "W" ? n : unit === "kW" ? n * 1000 : null;
}

/** Minutes left from a timestamp sensor (the end time, ahead of `now`) or a duration sensor (min, h or s); null otherwise. */
function minutesLeft(r: { state: string; attrs: Record<string, unknown> }, cls: unknown, now: number): number | null {
  if (cls === "timestamp") { const ms = Date.parse(r.state); return Number.isFinite(ms) && ms > now ? Math.max(1, Math.ceil((ms - now) / 60000)) : null; }
  const n = r.state.trim() === "" ? NaN : Number(r.state), unit = r.attrs.unit_of_measurement;
  const per = unit === "min" ? 1 : unit === "h" ? 60 : unit === "s" ? 1 / 60 : 0;
  return cls === "duration" && per && Number.isFinite(n) && n > 0 ? Math.max(1, Math.ceil(n * per)) : null;
}

/** What the entities of an appliance or a plant say. `sym` decides which half is read; `now` (ms) is only for a timestamp sensor. */
export function linkStatus(sym: unknown, m: LinkLike | null | undefined, states: States, now: number = Date.now()): LinkStatus {
  const plant = sym === "plant";
  const ids = carEntities(m);
  const min = validMinMoisture(m?.minMoisture) ? m.minMoisture : validMinMoisture(m?.min) ? m.min : MIN_MOISTURE;
  let running = false, remaining: number | null = null, alert: LinkStatus["alert"] = null;
  let moisture: number | null = null, humidity: number | null = null, low = false;
  for (const e of ids) {
    const r = read(states, e);
    if (!r) continue;
    const domain = domainOf(e), cls = r.attrs.device_class, word = r.state.trim().toLowerCase();
    if (plant) {
      if (domain === "sensor" && cls === "moisture" && moisture === null) moisture = percent(r);
      if (domain === "sensor" && cls === "humidity" && humidity === null) humidity = percent(r);
      const why = r.attrs.moisture_status;
      if (domain === "plant" && word === "problem" && typeof why === "string" && why.toLowerCase() === "low") low = true;
      continue;
    }
    if (domain === "sensor") {
      if (RUNNING_WORDS.has(word)) running = true;
      if (ERROR_WORDS.has(word)) alert = "error";
      if (cls === "power" && (watts(r) ?? 0) > RUN_WATTS) running = true;
      remaining ??= minutesLeft(r, cls, now);
    }
    if (domain === "binary_sensor" && word === "on") {
      if (cls === "running" || cls === "power") running = true;
      if (typeof cls === "string" && DOORS.has(cls) && alert === null) alert = "door";
    }
    if (sym === "stove" && word === "on" && (domain === "switch" || domain === "input_boolean")) running = true;
  }
  const level = moisture ?? humidity;
  return { running, remaining: running ? remaining : null, alert, moisture: level, thirsty: plant && (level !== null ? level < min : low) };
}

/** Whether the piece reads "on": an appliance at work, a plant that needs water. The plan, Active and 3D all ask this one function. */
export const linkOn = (sym: unknown, s: LinkStatus): boolean => (sym === "plant" ? s.thirsty : s.running);

/** One line: "Running · 42 min left", "Idle", "Door open", "Error"; a plant: "Moisture 14 %", "Needs water · 14 %". Plain text; the caller escapes it (finding 2). */
export function linkText(sym: unknown, s: LinkStatus): string {
  if (sym === "plant") return s.thirsty ? (s.moisture === null ? t("Needs water") : t("Needs water · {n} %", { n: s.moisture })) : s.moisture === null ? "" : t("Moisture {n} %", { n: s.moisture });
  const state = s.running ? (s.remaining === null ? t("Running") : t("Running · {n} min left", { n: s.remaining })) : s.alert ? "" : t("Idle");
  return [state, s.alert === "door" ? t("Door open") : s.alert === "error" ? t("Error") : ""].filter(Boolean).join(" · ");
}
