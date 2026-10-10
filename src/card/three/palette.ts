// Which theme token paints which kind of solid. The scene module names a `role` (plain data); this table says what the
// role looks like in the card's own theme, as a CSS colour built from the `--fp-*` tokens. The viewer resolves the
// expression once per theme change on the card itself (a probe element inherits the host's tokens), so a theme added to
// the card works here with no change, and no colour is a literal (CLAUDE.md finding 9).
//
// It names every member itself and imports nothing from core: the chunk must not share code with the card, or the bundler
// pulls the shared code out into a chunk the card then loads up front (docs/DECISIONS.md, S12.3). A test iterates the core
// unions (`ROOM_KINDS`, `WALL_KINDS`, `DEVICE_TYPES`, `FURNITURE_SYMBOLS`) so a new member fails until it is named here.
const ROOM_KINDS = ["room", "garden", "pavement", "fill", "terrace", "water"] as const; // a zone and a structure have no floor of their own
const WALL_KINDS = ["wall", "boundary", "external", "fence", "edge", "parapet"] as const;
const FURNITURE_SYMBOLS = ["table", "sofa", "bed", "cabinet", "chair", "sink", "toilet", "shower", "bathtub", "tv", "computer", "speaker", "tree", "patio-wood", "patio-concrete", "car"] as const;
const DEVICE_TYPES = ["heater", "light", "switch", "plug", "temp", "humidity", "motion", "contact", "camera", "climate", "ac", "tv", "computer", "media", "cover", "battery", "inverter", "server", "access_point", "lock", "vibration", "other", "boiler", "car", "ups", "printer", "speaker", "person", "radar", "vacuum", "siren", "alarm"] as const;

export interface RoleStyle { css: string; opacity: number }

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, var(${a}) ${pct}%, var(${b}))`;
const solid = (css: string): RoleStyle => ({ css, opacity: 1 });

const ROOM: Record<string, string> = {
  room: mix("--fp-room", 100, "--fp-bg"), garden: "var(--fp-garden)", pavement: "var(--fp-pavement)", terrace: "var(--fp-terrace)",
  fill: "var(--fp-fill)", water: "var(--fp-water)",
};
// A wall is the ink colour of its theme: near black in the light theme, where a solid slab of it under lighting reads as a
// hole. The 2.5D side faces already soften it this way (--fp-wall-side, 55% over the background), so the 3D walls do too.
// S28.9: the share is the theme's own --fp-wall-side-share (55%, 30% on HA dark), so the 3D walls match the 2.5D sides.
const SHARE = "var(--fp-wall-side-share, 55%)";
const side = (wall: string, extra: string) => `color-mix(in srgb, var(${wall}) ${extra}, var(--fp-bg))`;
const WALL: Record<string, string> = {
  wall: side("--fp-wall", SHARE), boundary: side("--fp-wall", SHARE), external: side("--fp-wall-external", `calc(${SHARE} + 5%)`), fence: "var(--fp-wall-fence)", edge: "var(--fp-wall-edge)", parapet: side("--fp-wall-external", `calc(${SHARE} + 5%)`),
};
const FURNITURE: Record<string, string> = {
  tree: "var(--fp-tree-edge)", "patio-wood": "var(--fp-wall-fence)", "patio-concrete": "var(--fp-pavement)", car: mix("--fp-dev-camera", 80, "--fp-furniture"),
  sink: mix("--fp-window", 25, "--fp-furniture"), toilet: mix("--fp-window", 25, "--fp-furniture"), shower: mix("--fp-window", 25, "--fp-furniture"), bathtub: mix("--fp-window", 25, "--fp-furniture"),
};
// A device with a body in the scene (radiator, speaker, TV) is drawn at rest here; the live tints are the LIVE roles below. Every other type is a point.
const DEVICE: Record<string, string> = {
  heater: mix("--fp-idle", 55, "--fp-bg"), tv: mix("--fp-on-light", 62, "--fp-furniture"), speaker: mix("--fp-on-light", 62, "--fp-furniture"),
};

const TABLE = new Map<string, RoleStyle>();
TABLE.set("slab", solid(mix("--fp-furniture", 45, "--fp-bg")));
TABLE.set("panel", solid("var(--fp-sealed)"));
TABLE.set("door-leaf", solid("var(--fp-door)"));
TABLE.set("stair", solid(mix("--fp-tread", 70, "--fp-bg")));
TABLE.set("ring", solid("var(--fp-ink)")); // the dashed outline of the picked room
TABLE.set("tree-crown", solid("var(--fp-tree)")); // S28.7: the crown, the colour of the 2D crown; the trunk (furniture-tree) is its darker edge colour
// A linked tv, speaker or computer piece: the tv's blue at rest (as `.furn[data-linked]` on the plan), the plan's on colour when on.
TABLE.set("furniture-linked", solid(mix("--fp-dev-tv", 70, "--fp-furniture")));
TABLE.set("piece-on", solid("var(--fp-active)"));
TABLE.set("unlinked", solid(mix("--fp-idle", 70, "--fp-bg")));
// What the live state paints over the rest (S12.5): a door that is open or alarmed, a garage cover that is open, a radiator that is heating,
// a TV screen that is on, a speaker's drivers, a room's motion edge, a lamp with no colour of its own. Every colour is a token.
TABLE.set("open-door", solid("var(--fp-open-door)"));
TABLE.set("door-band", { css: "var(--fp-open-door)", opacity: 0.6 }); // the slab in an open doorway while it is tripped: glass-like, alert colour
TABLE.set("door-cover", solid("var(--fp-dev-cover)"));
TABLE.set("body-heating", solid(mix("--fp-heater", 75, "--fp-bg")));
TABLE.set("screen-on", solid("var(--fp-dev-tv)"));
TABLE.set("driver-off", solid(mix("--fp-ink", 55, "--fp-furniture")));
TABLE.set("driver-on", solid("var(--fp-dev-speaker)"));
TABLE.set("motion", solid("var(--fp-dev-motion)"));
TABLE.set("motion-radar", solid("var(--fp-dev-radar)"));
TABLE.set("lamp", solid("var(--fp-dev-light)"));
TABLE.set("backdrop", solid("var(--fp-bg)"));
TABLE.set("ground", solid(mix("--fp-ink", 6, "--fp-bg"))); // S28.8: the plane under the house
TABLE.set("shade", solid("var(--fp-shade)")); // S28.8: contact shadows; their strength is --fp-shade-alpha, read by the viewer
for (const k of ROOM_KINDS) TABLE.set(`room-${k}`, solid(ROOM[k] ?? "var(--fp-room)"));
for (const k of WALL_KINDS) TABLE.set(`wall-${k}`, solid(WALL[k] ?? "var(--fp-wall)"));
for (const k of ["door", "glass", "window", "slit", "fullwindow", "sealed", "opening"]) TABLE.set(`glass-${k}`, { css: k === "window" || k === "slit" || k === "fullwindow" ? "var(--fp-window)" : "var(--fp-glass)", opacity: 0.35 });
for (const s of FURNITURE_SYMBOLS) TABLE.set(`furniture-${s}`, solid(FURNITURE[s] ?? mix("--fp-furniture", 70, "--fp-bg")));
for (const t of DEVICE_TYPES) TABLE.set(`device-${t}`, solid(DEVICE[t] ?? mix("--fp-furniture", 70, "--fp-bg")));

const FALLBACK = solid(mix("--fp-furniture", 70, "--fp-bg"));

/** Whether the palette names this role itself, rather than answering with its fallback. */
export const isKnownRole = (role: unknown): boolean => typeof role === "string" && TABLE.has(role);
/** The CSS colour and opacity of a role; an unknown one gets the furniture colour. */
export const roleStyle = (role: unknown): RoleStyle => (typeof role === "string" ? TABLE.get(role) : undefined) ?? FALLBACK;

// S28.9: a dark theme dims user paint (--fp-paint-dim, brightness and saturate) so a bright pick does not glare on a dark plan.
// The token is CSS; it is parsed here, strictly: two numbers or nothing, so a hostile value cannot reach the colour maths.
export interface PaintDim { brightness: number; saturate: number }
const NUM = "(\\d*\\.?\\d+)";
const DIM_RE = new RegExp(`^\\s*brightness\\(${NUM}\\)\\s+saturate\\(${NUM}\\)\\s*$`);
export function parsePaintDim(css: unknown): PaintDim | null {
  const m = typeof css === "string" ? DIM_RE.exec(css) : null;
  if (!m) return null;
  const brightness = Number(m[1]), saturate = Number(m[2]);
  return Number.isFinite(brightness) && Number.isFinite(saturate) ? { brightness: Math.min(brightness, 4), saturate: Math.min(saturate, 4) } : null;
}
/** The CSS filter chain in sRGB 0..255: brightness multiplies, then the saturate matrix pulls toward the luma. */
export function dimRgb(c: readonly number[], d: PaintDim): [number, number, number] {
  const [r, g, b] = c.map((v) => v * d.brightness), s = d.saturate;
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  return [
    clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
  ];
}
