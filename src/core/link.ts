// B53.11: a furniture piece linked to Home Assistant, like the car (docs/specs/batch-s52.md, item 19d). Which pieces link, what their
// entities say, and the line the popup prints. Read by domain, device class and state, never by integration. Every state read
// here is untrusted (finding 1): nothing throws, junk reads as "nothing to report". One list, one status, one text.
import { carEntities, domainOf, percent, read, type CarLike, type States } from "./car-status";
import { MIN_MOISTURE, isLinked, validMinMoisture } from "./schema";
export { APPLIANCES, ELECTRIC, LINKABLE, LINKED, MIN_MOISTURE, isLinkable, isLinked, validMinMoisture } from "./schema";
import { t } from "./i18n";
import type { Device } from "./schema";

/** What `pieceDevice` returns for a linked appliance or plant: a plain device that carries the piece's symbol and entities. */
export type LinkedDevice = Device & { sym: string; attached: string[]; min?: number; plugs?: string[] };
/** What a linked piece wears on the plan: state classes for its group, and (a thirsty plant) the glow drawn under the symbol. */
export interface LinkLook { cls: string; glow: string }
/** The glow: a soft rounded frame in the symbol's 100 x 100 space. Colour, blur and breath come from the stylesheet. */
const GLOW = '<rect class="plant-glow" x="4" y="4" width="92" height="92" rx="14"/>';

/** The link status of a device `pieceDevice` made for a linked piece; null for any other device. */
export function linkedStatus(d: Device, states: States, now?: number): { sym: string; status: LinkStatus } | null {
  const sym = (d as Partial<LinkedDevice>).sym;
  return typeof sym === "string" && isLinked(sym) ? { sym, status: linkStatus(sym, { entity: d.entity, attached: (d as LinkedDevice).attached, min: (d as LinkedDevice).min, plugs: (d as LinkedDevice).plugs }, states, now) } : null;
}

/** The classes and glow for a status. ` thirsty` for a plant below its threshold, ` alert` for a door left open or an error. */
export function linkLook(sym: unknown, s: LinkStatus): LinkLook {
  return { cls: `${s.thirsty ? " thirsty" : ""}${s.alert ? " alert" : ""}${s.away ? " away" : ""}`, glow: s.thirsty ? GLOW : "" };
}

/** A power sensor above this many watts means the appliance is working. One number, here. */
export const RUN_WATTS = 5;
/** What an appliance's own state sensor says while it works: Home Connect `run`, Miele `in_use`, SmartThings `running`. Add a word here, in one place. */
const RUNNING_WORDS = new Set(["run", "running", "wash", "washing", "rinse", "rinsing", "spin", "spinning", "dry", "drying", "cooking", "heating", "in_use", "active"]);
/** What an appliance's own state sensor says while it does nothing. Only these read as "not running"; any other word ("cotton", a selected program) says nothing and the plug's power decides. */
const IDLE_WORDS = new Set(["ready", "inactive", "off", "idle", "standby", "stop", "stopped", "finished", "end", "none", "pause", "paused", "delayed_start"]);
const ERROR_WORDS = new Set(["error", "fault"]);
const DOORS = new Set(["door", "window", "opening", "garage_door"]);
/** What HA's `vacuum` domain says (`VacuumActivity`), by word. A word not here reads as nothing. */
const VAC_WORDS = new Set(["cleaning", "returning", "docked", "idle", "paused", "error"]);
/** A sensor whose state is a number or a time says a measurement, not what the appliance is doing. */
const MEASURED = new Set(["power", "energy", "battery", "timestamp", "duration", "temperature", "humidity", "moisture", "voltage", "current", "apparent_power", "power_factor", "frequency"]);

/** A piece or a device that stands for one: its entities, and (a plant) its own moisture threshold. Loose, a layout is untrusted. */
export type LinkLike = CarLike & { minMoisture?: unknown; min?: unknown; plugs?: unknown };

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
  /** Every entity of the piece that has a state is unavailable or unknown. The plan paints it unavailable (`classOf`), the text says so. */
  dead: boolean;
  /** B53.13: a plug among the entities is off, and nothing else says the appliance works. */
  plugOff: boolean;
  /** Watts and kilowatt-hours the entities report (`meterOf`); null when unread. */
  watts: number | null;
  kwh: { n: number; today: boolean } | null;
  /** B53.13: what a vacuum entity says; null for any other piece or an unreadable state. */
  vac: "cleaning" | "returning" | "docked" | "idle" | "paused" | "error" | null;
  /** A robot vacuum out cleaning or on its way back: drawn faded, like a car that is away. Always false for the dock. */
  away: boolean;
  /** A vacuum's charge in whole percent (its `battery_level`, else an attached battery sensor); null when unread. */
  battery: number | null;
}

/** Watts from a power sensor: W, or kW times 1000; null for any other unit or a number that is not one. */
function watts(r: { state: string; attrs: Record<string, unknown> }): number | null {
  const n = r.state.trim() === "" ? NaN : Number(r.state), unit = r.attrs.unit_of_measurement;
  return !Number.isFinite(n) ? null : unit === "W" ? n : unit === "kW" ? n * 1000 : null;
}

/** A meter that counts one day: HA's utility_meter says `meter_period: daily`; a Tasmota or Shelly sensor says `today` or `daily` in its id. */
const isDaily = (e: string, r: { attrs: Record<string, unknown> }): boolean => r.attrs.meter_period === "daily" || /(^|_)(today|daily)(_|$)/i.test(e.slice(e.indexOf(".") + 1));

/** The power now and the energy so far among `ids`: the first power sensor that reads; the daily energy meter if there is one, else the first total (Wh become kWh). */
export function meterOf(ids: readonly string[], states: States): { watts: number | null; kwh: { n: number; today: boolean } | null } {
  let w: number | null = null, total: number | null = null, today: number | null = null;
  for (const e of ids) {
    const r = domainOf(e) === "sensor" ? read(states, e) : null;
    if (!r) continue;
    const cls = r.attrs.device_class;
    if (cls === "power") w ??= watts(r);
    if (cls !== "energy") continue;
    const n = r.state.trim() === "" ? NaN : Number(r.state), unit = r.attrs.unit_of_measurement;
    const kwh = unit === "kWh" ? n : unit === "Wh" ? n / 1000 : NaN;
    if (!Number.isFinite(kwh) || kwh < 0) continue;
    if (isDaily(e, r)) today ??= kwh; else total ??= kwh;
  }
  return { watts: w, kwh: today !== null ? { n: today, today: true } : total !== null ? { n: total, today: false } : null };
}

/** The popup's power and energy lines: "312 W", "1.4 kWh today" (a total reads "48.26 kWh"). Empty when nothing is read. */
export function meterLines(m: { watts: number | null; kwh: { n: number; today: boolean } | null }): string[] {
  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  return [m.watts === null ? "" : t("{n} W", { n: round(m.watts, Math.abs(m.watts) < 10 ? 1 : 0) }), m.kwh === null ? "" : m.kwh.today ? t("{n} kWh today", { n: round(m.kwh.n, 2) }) : t("{n} kWh", { n: round(m.kwh.n, 2) })].filter(Boolean);
}

/** Minutes left from a timestamp sensor (the end time, ahead of `now`) or a duration sensor (min, h or s); null otherwise. */
function minutesLeft(r: { state: string; attrs: Record<string, unknown> }, cls: unknown, now: number): number | null {
  if (cls === "timestamp") { const ms = Date.parse(r.state); return Number.isFinite(ms) && ms > now ? Math.max(1, Math.ceil((ms - now) / 60000)) : null; }
  const n = r.state.trim() === "" ? NaN : Number(r.state), unit = r.attrs.unit_of_measurement;
  const per = unit === "min" ? 1 : unit === "h" ? 60 : unit === "s" ? 1 / 60 : 0;
  return cls === "duration" && per && Number.isFinite(n) && n > 0 ? Math.max(1, Math.ceil(n * per)) : null;
}

/** The vacuum's own charge: a whole percent in `battery_level`; null for anything else. */
const batteryLevel = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : null);

/** What the entities of an appliance, a robot or a plant say. `sym` decides which half is read; `now` (ms) is only for a timestamp sensor. */
export function linkStatus(sym: unknown, m: LinkLike | null | undefined, states: States, now: number = Date.now()): LinkStatus {
  const plant = sym === "plant", robot = sym === "robot-vacuum" || sym === "robot-dock";
  const ids = carEntities(m);
  const min = validMinMoisture(m?.minMoisture) ? m.minMoisture : validMinMoisture(m?.min) ? m.min : MIN_MOISTURE;
  // `program`: the appliance's own word on whether it works (true, false), null when it has none. It wins over the plug's power.
  let program: boolean | null = null, remaining: number | null = null, alert: LinkStatus["alert"] = null, plugOff = false, stoveOn = false;
  const plugs = new Set(Array.isArray(m?.plugs) ? (m.plugs as unknown[]).filter((e): e is string => typeof e === "string") : []);
  let seen = 0, gone = 0;
  let moisture: number | null = null, humidity: number | null = null, low = false, vac: LinkStatus["vac"] = null, battery: number | null = null, sensorBattery: number | null = null;
  for (const e of ids) {
    const r = read(states, e);
    if (!r) continue;
    const domain = domainOf(e), cls = r.attrs.device_class, word = r.state.trim().toLowerCase();
    seen++;
    if (word === "unavailable" || word === "unknown") gone++;
    if (plant) {
      if (domain === "sensor" && cls === "moisture" && moisture === null) moisture = percent(r);
      if (domain === "sensor" && cls === "humidity" && humidity === null) humidity = percent(r);
      // HACS plant: `moisture_status: "Low"`. Core plant: `problem: "moisture low"`, perhaps with other problems after it.
      const why = r.attrs.moisture_status, problem = r.attrs.problem;
      if (domain === "plant" && word === "problem" && ((typeof why === "string" && why.toLowerCase() === "low") || (typeof problem === "string" && problem.toLowerCase().includes("moisture low")))) low = true;
      continue;
    }
    if (domain === "vacuum" && robot && vac === null && VAC_WORDS.has(word)) { vac = word as LinkStatus["vac"]; battery = batteryLevel(r.attrs.battery_level); }
    if (domain === "sensor") {
      if (RUNNING_WORDS.has(word)) program = true;
      else if (!(typeof cls === "string" && MEASURED.has(cls)) && IDLE_WORDS.has(word)) program ??= false;
      if (ERROR_WORDS.has(word)) alert = "error";
      if (cls === "battery" && sensorBattery === null) sensorBattery = percent(r);
      remaining ??= minutesLeft(r, cls, now);
    }
    if (domain === "binary_sensor" && (word === "on" || word === "off") && (cls === "running" || cls === "power")) program = word === "on" ? true : (program ?? false);
    // Only a fridge is wrong with its door open. A washer or dishwasher is often left ajar to dry, so its door is no alert.
    if (sym === "fridge" && domain === "binary_sensor" && word === "on" && typeof cls === "string" && DOORS.has(cls) && alert === null) alert = "door";
    // A feature switch (child lock, supercool) is normally off and is no plug: only the main entity, or a switch plugMeters found, counts.
    if (domain === "switch" && word === "off" && (e === ids[0] || plugs.has(e))) plugOff = true;
    if (sym === "stove" && word === "on" && (domain === "switch" || domain === "input_boolean")) stoveOn = true;
  }
  const { watts: w, kwh } = meterOf(ids, states);
  if (vac === "error") alert = "error";
  const running = sym === "robot-vacuum" ? vac === "cleaning" || vac === "returning" : sym === "robot-dock" ? false : (program ?? (w !== null ? w > RUN_WATTS : stoveOn));
  const level = moisture ?? humidity;
  return {
    running, remaining: running ? remaining : null, alert, dead: seen > 0 && gone === seen, moisture: level, thirsty: plant && (level !== null ? level < min : low),
    plugOff: plugOff && !running && vac === null, watts: w, kwh, vac, away: sym === "robot-vacuum" && running, battery: battery ?? sensorBattery,
  };
}

/** Whether the piece is painted "on" (the amber `.on`): an appliance at work. A thirsty plant is not: it wears the blue glow instead. The plan and 3D ask this one function. */
export const linkOn = (sym: unknown, s: LinkStatus): boolean => sym !== "plant" && s.running;
/** Whether the piece belongs in Active and lights its room's row: an appliance at work, a plant that needs water. */
export const linkActive = (sym: unknown, s: LinkStatus): boolean => (sym === "plant" ? s.thirsty : s.running);

/** One line: "Running · 42 min left", "Idle", "Off at the plug", "Door open", "Error"; a robot: "Cleaning · 63 %"; a plant: "Moisture 14 %", "Needs water · 14 %". Plain text; the caller escapes it (finding 2). */
export function linkText(sym: unknown, s: LinkStatus): string {
  if (s.dead) return t("Unavailable");
  if (sym === "plant") return s.thirsty ? (s.moisture === null ? t("Needs water") : t("Needs water · {n} %", { n: s.moisture })) : s.moisture === null ? "" : t("Moisture {n} %", { n: s.moisture });
  if (s.vac) return [VAC_TEXT[s.vac](), s.battery === null ? "" : t("{n} %", { n: s.battery })].filter(Boolean).join(" · ");
  const state = s.running ? (s.remaining === null ? t("Running") : t("Running · {n} min left", { n: s.remaining })) : s.alert ? "" : s.plugOff ? t("Off at the plug") : t("Idle");
  return [state, s.alert === "door" ? t("Door open") : s.alert === "error" ? t("Error") : ""].filter(Boolean).join(" · ");
}
/** A vacuum's state word as the popup prints it. */
const VAC_TEXT: Record<NonNullable<LinkStatus["vac"]>, () => string> = {
  cleaning: () => t("Cleaning"), returning: () => t("Returning"), docked: () => t("Docked"), idle: () => t("Idle"), paused: () => t("Paused"), error: () => t("Error"),
};
