// S14.2: the rules behind the tap popup, as plain functions: what its one button does for a device, where OFF asks first,
// and what a light's controls may offer. No DOM here; the card draws it (floorplan-studio-card.ts).
import { NO_TOGGLE } from "./actions";
import { lampOffCalls, type Device, type SceneCall, type StateOverlay } from "../core";

export interface PopupOp {
  /** The button's text. */
  label: string;
  domain: string;
  service: string;
  /** The text of the confirm step the button turns into before it acts, or null when it acts at once. Only a turn OFF of anything but a light asks. */
  confirm: string | null;
  /** S22.1: the calls the button makes instead of one `domain.service` on the subject's entity (a relay-lit lamp's Turn off). */
  calls?: SceneCall[];
}

/** Domains `turn_on` and `turn_off` exist for, and the card operates. A sensor, a button or a scene is not one. */
const SWITCHABLE = new Set(["light", "switch", "input_boolean", "fan", "siren", "climate", "humidifier", "water_heater", "automation", "remote", "media_player", "group"]);
const GONE = new Set(["unavailable", "unknown"]);

/**
 * The button of a device's popup, or null when it has none (a sensor, a camera, a vacuum, a media player: those only name their
 * state and offer More info). Follows the entity's domain; the type only rules out what the card never operates (`NO_TOGGLE`).
 * ON, lock, unlock, open and close act at once. Turning OFF asks first, except a light's (Diego, 2026-10-06). A state that is
 * missing or `unavailable` has no button: there is nothing to act on.
 */
export function popupOp(type: string, entity: string | undefined, state: string | undefined): PopupOp | null {
  if (!entity || NO_TOGGLE.has(type) || typeof state !== "string" || GONE.has(state)) return null;
  const domain = entity.split(".")[0] ?? "";
  if (domain === "lock") return state === "locked" ? { label: "Unlock", domain, service: "unlock", confirm: null } : { label: "Lock", domain, service: "lock", confirm: null };
  if (domain === "cover") return state === "open" ? { label: "Close", domain, service: "close_cover", confirm: null } : { label: "Open", domain, service: "open_cover", confirm: null };
  if (!SWITCHABLE.has(domain)) return null;
  const call = domain === "group" ? "homeassistant" : domain; // the `group` domain has no turn_on / turn_off; `homeassistant.turn_*` does it
  if (state === "off") return { label: "Turn on", domain: call, service: "turn_on", confirm: null };
  return { label: "Turn off", domain: call, service: "turn_off", confirm: domain === "light" ? null : "Confirm turn off" };
}

/**
 * S22.1: a light's button, with its `bound` relay counted. The plan draws the lamp on while the relay is on, so then the
 * button is Turn off, at once as for any light, and it calls `lampOffCalls`: `switch.turn_off` on the relay, and
 * `light.turn_off` on the light when that is on too. A relay that is off (or none) leaves today's rule, `popupOp`.
 */
export function lampOp(d: Device, states: StateOverlay | undefined): PopupOp | null {
  const relay = d.type === "light" && typeof d.bound === "string" ? d.bound : "";
  if (relay && states?.[relay]?.state === "on") {
    const calls = lampOffCalls(d, states);
    const first = calls[calls.length - 1]!; // the relay's call: presetCalls puts the light's first
    return { label: "Turn off", domain: first.domain, service: "turn_off", confirm: null, calls };
  }
  return popupOp(d.type, d.entity, states?.[d.entity]?.state);
}

export interface LightCaps { brightness: boolean; temp: { min: number; max: number } | null; hue: boolean }

const COLOUR_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];
const kelvin = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt);

/** What a light can do, from its `supported_color_modes` (any mode but `onoff` dims) and, with none listed, from an own `brightness`. */
export function lightCaps(attrs: Record<string, unknown> | undefined): LightCaps {
  const a = attrs && typeof attrs === "object" ? attrs : {};
  const modes = Array.isArray(a.supported_color_modes) ? a.supported_color_modes.filter((m): m is string => typeof m === "string") : [];
  const brightness = modes.length ? modes.some((m) => m !== "onoff") : typeof a.brightness === "number";
  let min = kelvin(a.min_color_temp_kelvin, 2000), max = kelvin(a.max_color_temp_kelvin, 6500);
  if (!(min < max)) { min = 2000; max = 6500; }
  return { brightness, temp: modes.includes("color_temp") ? { min, max } : null, hue: modes.some((m) => COLOUR_MODES.includes(m)) };
}
