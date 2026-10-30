// S41.d: the surface freeze (docs/WORKFLOW.md, "Surface freeze"). The card's YAML keys, its themes and its car models
// are listed here as of 2026-10-30. A new one fails this test until it is added below with the DECISIONS entry that
// says why, or until another one is removed in the same change (finding 17: a list of decisions, not a default).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { THEMES } from "../../src/core/render";
import { CAR_MODELS } from "../../src/core/schema";

const CONFIG_KEYS = [
  "type", "floor", "floors", "fade", "plug_watts", "plug_heat_from", "plug_heat_to", "room_glow", "layout", "layout_url",
  "theme", "zoom", "night", "sun", "kiosk", "tap_action", "hold_action", "open_color", "icon_size", "active_list", "center",
  "zoom_level", "view", "view_switch", "rotate_switch", "labels", "names", "tilt", "walls", "rotation", "detail",
  "ghost_floor", "floors_below", "heat_map", "camera_thumb", "camera_thumb_size", "camera_thumb_pos",
];
const FROZEN_THEMES = [
  "blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha", "coffee", "a-team", "space", "cyberpunk",
  "carpenter-brut", "beach-house",
];
const FROZEN_CARS = ["sedan", "wagon", "suv", "offroad", "truck", "van", "utility", "citycar", "electric"];

/** The keys of `FloorplanStudioCardConfig`, read from the source, so a key added to the interface is seen here. */
export function configKeys(src: string): string[] {
  const start = src.indexOf("export interface FloorplanStudioCardConfig {");
  if (start < 0) throw new Error("FloorplanStudioCardConfig not found in floorplan-studio-card.ts");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  return [...body.matchAll(/^ {2}(?:readonly\s+)?["']?([\w-]+)["']?\??:/gm)].map((m) => m[1]!);
}

describe("surface freeze", () => {
  test("the card's config keys are the frozen list", () => {
    const keys = configKeys(readFileSync("src/card/floorplan-studio-card.ts", "utf8"));
    expect(keys.length, "the parser found the interface's keys").toBeGreaterThan(30);
    expect([...keys].sort(), "a new key needs a removed one or a DECISIONS entry, then a line here").toEqual([...CONFIG_KEYS].sort());
  });
  test("the themes are the frozen list", () => {
    expect([...THEMES].sort(), "no new theme (docs/WORKFLOW.md)").toEqual([...FROZEN_THEMES].sort());
  });
  test("the car models are the frozen list", () => {
    expect([...CAR_MODELS].sort(), "no new car model (docs/WORKFLOW.md)").toEqual([...FROZEN_CARS].sort());
  });
  test("the parser sees a key added to the interface, in every form TypeScript allows", () => {
    // Opus review of S41: a required key, a readonly one and a quoted one each slipped past the first parser.
    const src = [
      "export interface FloorplanStudioCardConfig {", "  type?: string;", "  /** doc */", "  new_key?: boolean;", "  required: number;",
      "  readonly frozen?: string;", '  "quoted-key"?: boolean;', "  'single'?: boolean;", "  nested?: {", "    inner?: number;", "  };", "}", "",
    ].join("\n");
    expect(configKeys(src)).toEqual(["type", "new_key", "required", "frozen", "quoted-key", "single", "nested"]);
  });
});
