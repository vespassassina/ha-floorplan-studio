/**
 * A plug is active while it draws power, not while it is merely switched on (Diego, 2026-10: "from 2 watts and
 * up"). Everything about that rule lives here, so the plan, the Active list, a room's ring and the tooltip cannot
 * disagree (CLAUDE.md finding 8). `render.ts`'s `classOf` is the one caller that decides; the rest read from it.
 */

/** A plug at or above this many watts is active. The card's `plug_watts` overrides it. */
export const PLUG_ACTIVE_WATTS = 2;

/** The shape of a state this file reads. Untrusted (finding 1): every field is checked before use. */
interface Reading { state?: unknown; attributes?: unknown }

/** `plug_watts` from untrusted config: a finite number >= 0 stands, anything else is `PLUG_ACTIVE_WATTS`. */
export function plugThreshold(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : PLUG_ACTIVE_WATTS;
}

// Plain decimals only. Number("") is 0, Number("0x10") is 16 and Number("1e3") is 1000; none of them is a reading.
const DECIMAL = /^[+-]?\d+(\.\d+)?$/;

/**
 * The watts a power sensor reports, or null when it cannot be read: not there, `unavailable`, `unknown`, not a
 * plain number, or a unit other than W and kW. A missing `unit_of_measurement` counts as W: HA's power sensors
 * always carry one, so a bare number is a hand-made or test sensor and W is the only sensible guess.
 */
export function wattsOf(s: Reading | undefined): number | null {
  if (!s || typeof s.state !== "string" || !DECIMAL.test(s.state.trim())) return null;
  const attrs = s.attributes && typeof s.attributes === "object" ? (s.attributes as Record<string, unknown>) : {};
  const unit = attrs.unit_of_measurement;
  const n = Number(s.state);
  if (unit === undefined || unit === "W") return n;
  if (unit === "kW") return n * 1000;
  return null;
}

/** A row of the entity list the auto-link searches: the editor's `HaData["entities"]`, or the card's `hass.entities`. */
export interface PowerCandidate { id: string; domain: string; dc?: string; dev?: string; cat?: string | null }

/**
 * The power sensor of the same HA device as `plugEntity`: a `sensor.*` with device class `power`, not a diagnostic
 * or config entity. Only when there is exactly one; two candidates (a plug with two outlets, say) are a guess, and
 * a wrong guess would paint a plug by another plug's draw, so the answer is then none and the user picks.
 */
export function findPowerSensor(entities: readonly PowerCandidate[] | undefined, plugEntity: string): string | undefined {
  if (!Array.isArray(entities)) return undefined;
  const rows = entities.filter((e): e is PowerCandidate => !!e && typeof e === "object" && typeof e.id === "string");
  const dev = rows.find((e) => e.id === plugEntity)?.dev;
  if (!dev) return undefined;
  const found = rows.filter((e) => e.dev === dev && e.domain === "sensor" && e.dc === "power" && !e.cat);
  return found.length === 1 ? found[0].id : undefined;
}
