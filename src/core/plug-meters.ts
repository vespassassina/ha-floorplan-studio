// B53.13: attach a plug's switch to an electric piece and the plug's own power and energy sensors (same HA device) join the piece. The
// card runs this on the layout it loaded, so 2D, 2.5D, 3D, Active, the popup, the chooser and the replay all see the same entities.
import { carEntities, domainOf, read, type States } from "./car-status";
import { findPowerSensor, type PowerCandidate } from "./power";
import { ELECTRIC, MAX_CAR_ATTACHED, type Furniture, type Layout } from "./schema";

/** A row of `hass.entities` as the card has it. Loose: the registry is not ours. */
type Registry = Record<string, { device_id?: unknown; entity_category?: unknown } | null | undefined>;

/** The registry rows of the given HA devices, with each entity's device class from its state (the card's `_powerLinks` reads it the same way). */
export function rowsOfDevices(reg: Registry, states: States, devs: ReadonlySet<string>): PowerCandidate[] {
  const rows: PowerCandidate[] = [];
  for (const [id, e] of Object.entries(reg)) {
    const dev = e?.device_id;
    if (typeof dev !== "string" || !devs.has(dev)) continue;
    const dc = read(states, id)?.attrs.device_class;
    rows.push({ id, domain: domainOf(id), dc: typeof dc === "string" ? dc : undefined, dev, cat: typeof e?.entity_category === "string" ? e.entity_category : null });
  }
  return rows;
}

const ROBOTS: readonly string[] = ["robot-vacuum", "robot-dock"];
const deviceOf = (reg: Registry, id: string): string | undefined => { const d = reg[id]?.device_id; return typeof d === "string" && d ? d : undefined; };

/**
 * The layout with each electric piece's plug readings attached: for every `switch.*` among the piece's entities, the one power sensor
 * and the energy sensors of its HA device (not diagnostic). A kind the piece already has a sensor for is left alone, so what the
 * user attached wins. Returns `layout` itself when nothing changes, else a copy; the layout given is never touched.
 */
export function plugMeters(layout: Layout, reg: Registry | null | undefined, states: States): Layout {
  if (!reg || typeof reg !== "object" || !states) return layout;
  try {
    const pieces: { f: string; i: number; ids: string[] }[] = [], devs = new Set<string>();
    for (const [k, f] of Object.entries(layout.floors)) (Array.isArray(f?.furniture) ? f.furniture : []).forEach((m: Furniture, i: number) => {
      if (!m || typeof m !== "object" || !ELECTRIC.includes(m.symbol)) return;
      // A switch brings its power and energy sensors; a robot's vacuum brings its battery (core vacuums no longer carry `battery_level`).
      const ids = carEntities(m), anchors = ids.filter((e) => domainOf(e) === "switch" || (ROBOTS.includes(m.symbol) && domainOf(e) === "vacuum"));
      if (!anchors.length) return;
      pieces.push({ f: k, i, ids });
      for (const p of anchors) { const d = deviceOf(reg, p); if (d) devs.add(d); }
    });
    if (!devs.size) return layout;
    const rows = rowsOfDevices(reg, states, devs), floors = { ...layout.floors }, copied = new Set<string>();
    for (const { f, i, ids } of pieces) {
      const has = (cls: string) => ids.some((e) => domainOf(e) === "sensor" && read(states, e)?.attrs.device_class === cls);
      const add: string[] = [], plugs: string[] = [];
      if (ROBOTS.includes((floors[f].furniture[i] as Furniture).symbol) && !has("battery")) {
        for (const v of ids.filter((e) => domainOf(e) === "vacuum")) {
          const dev = rows.find((r) => r.id === v)?.dev, bat = dev ? rows.find((r) => r.dev === dev && r.domain === "sensor" && r.dc === "battery") : undefined;
          if (bat) { add.push(bat.id); break; }
        }
      }
      for (const p of ids.filter((e) => domainOf(e) === "switch")) {
        const pd = rows.find((r) => r.id === p)?.dev;
        // The plug is the switch that shares its HA device with a power or energy sensor; a child lock does not (`linkStatus` reads `plugs`).
        if (pd && rows.some((r) => r.dev === pd && r.domain === "sensor" && (r.dc === "power" || r.dc === "energy"))) plugs.push(p);
        const power = has("power") || add.some((e) => rows.find((r) => r.id === e)?.dc === "power") ? undefined : findPowerSensor(rows, p);
        if (power) add.push(power);
        const dev = rows.find((r) => r.id === p)?.dev;
        if (!has("energy") && !add.some((e) => rows.find((r) => r.id === e)?.dc === "energy")) add.push(...rows.filter((r) => r.dev === dev && r.domain === "sensor" && r.dc === "energy" && !r.cat).map((r) => r.id).slice(0, 3));
      }
      const fresh = add.filter((e) => !ids.includes(e));
      if (!fresh.length && !plugs.length) continue;
      if (!copied.has(f)) { floors[f] = { ...floors[f], furniture: [...floors[f].furniture] }; copied.add(f); }
      const m = floors[f].furniture[i] as Furniture & { attached?: unknown };
      const kept = Array.isArray(m.attached) ? (m.attached as unknown[]).filter((e): e is string => typeof e === "string") : [];
      floors[f].furniture[i] = { ...m, ...(fresh.length ? { attached: [...kept, ...fresh].slice(0, MAX_CAR_ATTACHED) } : {}), ...(plugs.length ? { plugs } : {}) } as Furniture;
    }
    return copied.size ? { ...layout, floors } : layout;
  } catch { return layout; }
}
