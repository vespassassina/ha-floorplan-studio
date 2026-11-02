import { test, expect, type Page } from "@playwright/test";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// S36.3: Home Assistant's "By entity" card picker (frontend 2026.6) asks every `window.customCards` entry for a suggestion.
// CLAUDE.md finding 21: the shape below is copied from the HA frontend (home-assistant/frontend, read 2026-10-22 at the tags
// 20260624.2 and 20260930.4, where the first two files are byte-identical; commit b08f5bc "Add custom card suggestions in the
// entity card picker", #52228):
//   src/data/lovelace_custom_cards.ts   CustomCardEntry.getEntitySuggestion?(hass: HomeAssistant, entityId: string)
//                                         => CustomCardSuggestion | CustomCardSuggestion[] | null    ({ label?, config })
//   src/panels/lovelace/card-suggestions/index.ts   generateCardSuggestions(hass, entityId): returns early with nothing
//                                         unless hass.states[entityId] exists; calls the entry inside try/catch;
//                                         `ensureArray(result) ?? []`, so null declines; the custom ones are the "Community" row.
//   src/panels/lovelace/editor/card-editor/hui-suggestion-card.ts   the tile: `isCustomType(config.type)` ("custom:" prefix),
//                                         title = getCustomCardEntry(type without the prefix)?.name, then <hui-card .config preview>.
//   src/panels/lovelace/editor/card-editor/hui-suggestion-picker.ts  keys each tile by JSON.stringify(config).
//   test/panels/lovelace/card-suggestions/generate-card-suggestions.test.ts  the hass its tests pass: { states, localize }.
// What cannot be checked without a real Home Assistant 2026.6: the picker drawing the tile. The pieces above are all we can reach.

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

type Suggestion = { label?: string; config: { type: string } & Record<string, unknown> };

async function open(page: Page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
}

/** What HA does for one picked entity (generateCardSuggestions, custom branch), with the hass shape its own test builds. */
function suggest(page: Page, entityId: string): Promise<Suggestion[] | "threw"> {
  return page.evaluate((id) => {
    const hass = { states: { [id]: { entity_id: id, state: "on", attributes: {} } }, localize: (k: string) => k };
    const entry = (window as unknown as { customCards: { type: string; getEntitySuggestion?: (h: unknown, e: string) => unknown }[] }).customCards.find((c) => c.type === "floorplan-studio-card");
    if (!entry?.getEntitySuggestion) return [];
    try {
      const r = entry.getEntitySuggestion(hass, id);
      return r == null ? [] : ([] as unknown[]).concat(r);
    } catch {
      return "threw";
    }
  }, entityId) as Promise<Suggestion[] | "threw">;
}

// The domains the card can put on a plan (src/core/ha.ts TYPE_RULES and typeForEntity).
const DRAWN = ["light", "switch", "sensor", "binary_sensor", "climate", "cover", "camera", "fan", "lock", "media_player", "person", "device_tracker", "vacuum", "siren", "alarm_control_panel"];
// Real domains the card draws nothing for. `update.floorplan_studio_update` is the integration's own entity.
const NOT_DRAWN = ["update", "input_boolean", "weather", "automation", "script", "sun", "zone", "button", "number", "select", "todo", "calendar", "text"];

test("S36.3: the card's customCards entry implements getEntitySuggestion", async ({ page }) => {
  await open(page);
  const kind = await page.evaluate(() => {
    const e = (window as unknown as { customCards: { type: string; name?: string; getEntitySuggestion?: unknown }[] }).customCards.find((c) => c.type === "floorplan-studio-card")!;
    return { fn: typeof e.getEntitySuggestion, name: e.name };
  });
  expect(kind).toEqual({ fn: "function", name: "Floorplan Studio" });
});

test("S36.3: an entity the card draws gets one suggestion, a custom: card with a plain config", async ({ page }) => {
  await open(page);
  for (const domain of DRAWN) {
    const r = await suggest(page, `${domain}.kitchen_x`);
    expect(r, domain).not.toBe("threw");
    expect(r, domain).toEqual([{ config: { type: "custom:floorplan-studio-card" } }]);
  }
});

test("S36.3: an entity the card draws nothing for gets no suggestion", async ({ page }) => {
  await open(page);
  for (const domain of NOT_DRAWN) expect(await suggest(page, `${domain}.thing`), domain).toEqual([]);
  expect(await suggest(page, "update.floorplan_studio_update")).toEqual([]);
});

test("S36.3: junk never throws (HA catches, but logs an error per picker open)", async ({ page }) => {
  await open(page);
  for (const id of ["", "nodot", ".", "light", "LIGHT.x", " light.x", "light_x.y"]) {
    const r = await suggest(page, id);
    expect(r, JSON.stringify(id)).not.toBe("threw");
    expect(r, JSON.stringify(id)).toEqual([]);
  }
  // Called with no arguments at all.
  const bare = await page.evaluate(() => {
    const e = (window as unknown as { customCards: { type: string; getEntitySuggestion?: () => unknown }[] }).customCards.find((c) => c.type === "floorplan-studio-card")!;
    try { return e.getEntitySuggestion!() ?? null; } catch { return "threw"; }
  });
  expect(bare).toBeNull();
});

test("S36.3: the tile finds the card's name from the type, and the config survives the picker's JSON key", async ({ page }) => {
  await open(page);
  const [s] = (await suggest(page, "light.hall")) as Suggestion[];
  // hui-suggestion-card: isCustomType, stripCustomPrefix, getCustomCardEntry(...).name.
  expect(s.config.type.startsWith("custom:")).toBe(true);
  const stripped = s.config.type.slice("custom:".length);
  const name = await page.evaluate((t) => (window as unknown as { customCards: { type: string; name?: string }[] }).customCards.find((c) => c.type === t)?.name, stripped);
  expect(name).toBe("Floorplan Studio");
  expect(JSON.parse(JSON.stringify(s.config))).toEqual(s.config); // hui-suggestion-picker keys tiles by JSON.stringify(config)
  // A fresh object per call: the tile may not share one that another card's setConfig could keep.
  const same = await page.evaluate(() => {
    const e = (window as unknown as { customCards: { type: string; getEntitySuggestion: (h: unknown, id: string) => { config: object } }[] }).customCards.find((c) => c.type === "floorplan-studio-card")!;
    const h = { states: { "light.a": {} }, localize: (k: string) => k };
    return e.getEntitySuggestion(h, "light.a").config === e.getEntitySuggestion(h, "light.a").config;
  });
  expect(same).toBe(false);
});

test("S36.3: the card takes the suggested config and previews without an error when no plan is saved", async ({ page }) => {
  await open(page);
  const [s] = (await suggest(page, "light.hall")) as Suggestion[];
  // The reply websocket.py sends for a home with nothing saved is { layout: null } (finding 21).
  const shown = await page.evaluate(async (config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };
    const errors: unknown[] = [];
    window.addEventListener("error", (e) => errors.push(e.message));
    el.setConfig(config); // would throw into HA's hui-card, which shows an error card
    el.hass = { states: {}, themes: { darkMode: false }, connection: { sendMessagePromise: async () => ({ layout: null }), subscribeEvents: async () => () => {} } };
    for (let i = 0; i < 6; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); }
    return { text: el.shadowRoot.textContent ?? "", svg: el.shadowRoot.querySelector("svg") !== null, errors };
  }, s.config);
  expect(shown.text).toContain("No plan saved yet");
  expect(shown.svg).toBe(false);
  expect(shown.errors).toEqual([]);
});
