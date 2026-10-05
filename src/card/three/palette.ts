// Which theme token paints which kind of solid. The scene module names a `role` (plain data); this table says what the
// role looks like in the card's own theme, as a CSS colour built from the `--fp-*` tokens. The viewer resolves the
// expression once per theme change on the card itself (a probe element inherits the host's tokens), so a theme added to
// the card works here with no change, and no colour is a literal (CLAUDE.md finding 9).
import { DEVICE_TYPES, FURNITURE_SYMBOLS, ROOM_KINDS, WALL_KINDS } from "../../core/schema";

export interface RoleStyle { css: string; opacity: number }

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, var(${a}) ${pct}%, var(${b}))`;
const solid = (css: string): RoleStyle => ({ css, opacity: 1 });

const ROOM: Record<string, string> = {
  room: mix("--fp-room", 100, "--fp-bg"), garden: "var(--fp-garden)", pavement: "var(--fp-pavement)", terrace: "var(--fp-terrace)",
  fill: "var(--fp-fill)", water: "var(--fp-water)",
};
const WALL: Record<string, string> = {
  wall: "var(--fp-wall)", boundary: "var(--fp-wall)", external: "var(--fp-wall-external)", fence: "var(--fp-wall-fence)", edge: "var(--fp-wall-edge)",
};
const FURNITURE: Record<string, string> = {
  tree: "var(--fp-dev-garden)", "patio-wood": "var(--fp-wall-fence)", "patio-concrete": "var(--fp-pavement)", car: mix("--fp-dev-camera", 80, "--fp-furniture"),
  sink: mix("--fp-window", 25, "--fp-furniture"), toilet: mix("--fp-window", 25, "--fp-furniture"), shower: mix("--fp-window", 25, "--fp-furniture"), bathtub: mix("--fp-window", 25, "--fp-furniture"),
};
// A device with a body in the scene (radiator, speaker, TV) is drawn at rest; the live tint is S12.5's. Every other type is a point, which has no body yet.
const DEVICE: Record<string, string> = {
  heater: mix("--fp-idle", 55, "--fp-bg"), tv: mix("--fp-on-light", 62, "--fp-furniture"), speaker: mix("--fp-on-light", 62, "--fp-furniture"),
};

const TABLE = new Map<string, RoleStyle>();
TABLE.set("slab", solid(mix("--fp-furniture", 45, "--fp-bg")));
TABLE.set("panel", solid("var(--fp-sealed)"));
TABLE.set("door-leaf", solid("var(--fp-door)"));
TABLE.set("stair", solid(mix("--fp-tread", 70, "--fp-bg")));
TABLE.set("unlinked", solid(mix("--fp-idle", 70, "--fp-bg")));
for (const k of ROOM_KINDS) if (k !== "zone" && k !== "structure") TABLE.set(`room-${k}`, solid(ROOM[k] ?? "var(--fp-room)"));
for (const k of WALL_KINDS) TABLE.set(`wall-${k}`, solid(WALL[k] ?? "var(--fp-wall)"));
for (const k of ["door", "glass", "window", "sealed", "opening"]) TABLE.set(`glass-${k}`, { css: k === "window" ? "var(--fp-window)" : "var(--fp-glass)", opacity: 0.35 });
for (const s of FURNITURE_SYMBOLS) TABLE.set(`furniture-${s}`, solid(FURNITURE[s] ?? mix("--fp-furniture", 70, "--fp-bg")));
for (const t of DEVICE_TYPES) TABLE.set(`device-${t}`, solid(DEVICE[t] ?? mix("--fp-furniture", 70, "--fp-bg")));

const FALLBACK = solid(mix("--fp-furniture", 70, "--fp-bg"));

/** Whether the palette names this role itself, rather than answering with its fallback. */
export const isKnownRole = (role: unknown): boolean => typeof role === "string" && TABLE.has(role);
/** The CSS colour and opacity of a role; an unknown one gets the furniture colour. */
export const roleStyle = (role: unknown): RoleStyle => (typeof role === "string" ? TABLE.get(role) : undefined) ?? FALLBACK;
