# Plan

Epics, then sprints, then tasks. A task is one outcome, one test, one branch.
Each task block is the full brief for the Execute role; see `docs/WORKFLOW.md`.
Tick a task only when its "Done when" list is all true.

Repository layout (fixed here, created in S1.1):

```
package.json  vite.config.ts  tsconfig.json  vitest.config.ts  playwright.config.ts  eslint.config.js
hacs.json  requirements_test.txt  pyproject.toml
src/core/    schema.ts  migrate.ts  geometry.ts  render.ts  icons.ts  index.ts
src/editor/  editor-app.ts  state.ts  panels.ts  hass-pickers.ts  standalone.html
src/card/    floorplan-studio-card.ts
custom_components/floorplan_studio/  __init__.py  manifest.json  const.py  config_flow.py  storage.py  websocket.py  panel.py
demo/        layout.json  layout.v1.json
tests/core/  tests/card/  tests/editor/  tests/integration/
prompts/     trace-from-photos.md
docs/
```

## Epics

- E1 Core: schema v2, migration, geometry, renderer, icons.
- E2 Editor: port the current editor onto the core; standalone build.
- E3 Card: live rendering and behaviours.
- E4 Integration and panel: load/save, HA-hosted editor, HACS release.
- E5 Content: furniture symbols, prompt, docs.

---

## Sprint 0 — in the private HomeFloorplan editor (vanilla JS)

Repo: `~/Documents/Software/HomeFloorplan`, file `editor/editor.src.html`,
build `bash editor/build.sh` (must print `passed`). Tests are browser checks
run with scripted clicks; record the JS used and its output in the report.

### S0.1 MDI icons for devices (done, HomeFloorplan task/S0.1)
- Outcome: each device type draws a Material Design Icon path instead of a polygon.
- Files: `editor/icons.js` (new, inlined by build.sh), `editor/editor.src.html`.
- Interface: `var ICONS = { heater: "<path d>", light: ..., switch: ..., plug: ..., temp: ..., humidity: ..., motion: ..., contact: ..., window: ..., camera: ..., climate: ..., media: ..., cover: ..., other: ... }`. Paths come from the `@mdi/js` npm package, names: radiator, lightbulb, light-switch, power-plug, thermometer, water-percent, motion-sensor, door, window-closed-variant, cctv, thermostat, television, garage, help-circle. Draw as `<g data-x="i" transform="translate(x-12k, y-12k) scale(k)"><path d="..." fill="colour"/></g>`, where `k = 1/scale()` so icons stay 24 px on screen. Heater keeps the bar plus a small icon at its centre.
- Test: in the browser, `document.querySelectorAll('[data-x] path').length === F().devices.length` for a floor where every device is visible; a screenshot at two zoom levels shows icons the same size.
- Done when: all types have an icon; the selected device still has an ink outline; hit testing on the `<g>` selects it; build passes.
- Break it: a device with an unknown `type` draws `other`, not nothing.

### S0.2 Contact sensor on doors and windows (done, task/S0.2)
- Outcome: a door or window can carry a `sensor` entity; the editor shows it and can preview the open state in orange.
- Files: `editor/editor.src.html`, `tools/migrate_catalog.py` (mark `window` catalogue entries as `contact`).
- Interface: `door.sensor` (string entity id or absent). Door panel gets a `<select id="dsens">` listing `catalog` entries of type `contact` that are not used by another door, plus "none". A `Preview open` checkbox (`#dopen`, not persisted) draws the door with `stroke="var(--ed-open)"` where `--ed-open:#f28c28`.
- Test: select a door, choose a sensor, `F().doors[i].sensor` equals the chosen id; the same id is absent from another door's list; tick preview and the door's stroke is the orange variable.
- Done when: the above holds; a contact device already placed on the plan as a point is still allowed (both forms coexist until S1.2 migration).
- Break it: deleting a door with a sensor frees the sensor for the list.

### S0.3 Schema v2 fields written by the editor (done, task/S0.3)
- Outcome: the editor writes `version: 2`, gives every room, wall, door, stairs, opening, extra and device an `id`, rooms an `area` (defaults to the slug of `name`), and loads v1 files.
- Files: `editor/editor.src.html` (`norm()`), `tools/render_layout.py` (ignore new fields).
- Interface: ids are `<kind>-<floor>-<n>` for objects without one; device ids stay as they are. `norm()` is the migration; it is idempotent.
- Test: Open the house layout, Save, and `diff <(python3 -m json.tool old) <(python3 -m json.tool new)` shows only added `version`, `id` and `area` keys. Open the saved file again and Save: byte-identical.
- Done when: the diff test holds; the room panel shows the `area` field; `docs/DECISIONS.md` in HomeFloorplan notes schema v2.
- Break it: a file with `version: 3` shows the status "Unknown layout version 3" and does not load.

---

## Sprint 1 — core and standalone editor (E1, E2)

### S1.1 Scaffold (done)
- Outcome: the repository builds, lints and runs one test.
- Files: everything in the layout above except `src/*` bodies; `src/core/index.ts` exports nothing yet; `demo/layout.json` is a two-floor, six-room house with 12 devices, three doors with sensors, one cover; `demo/layout.v1.json` is the same in v1 shape (no ids, `type: "sensor"` for temp, `type: "window"` for contacts).
- Interface: `package.json` scripts exactly as the table in WORKFLOW.md. Dependencies: `lit`, `@mdi/js`; dev: `typescript`, `vite`, `vite-plugin-singlefile`, `vitest`, `@playwright/test`, `eslint`, `typescript-eslint`, `jsdom`. Node 20. `hacs.json`: `{"name": "Floorplan Studio", "render_readme": true, "homeassistant": "2025.6.0"}`. `manifest.json`: domain `floorplan_studio`, `"version": "0.1.0"`, `"iot_class": "local_push"`, `"dependencies": ["http", "frontend", "panel_custom"]`, `"config_flow": true`.
- Test: `tests/core/smoke.test.ts` imports `demo/layout.json` and asserts `version === 2`.
- Done when: `npm ci && npm run lint && npm test && npm run build` all exit 0 and `dist/` contains the three files; `pytest` collects 0 tests without error.
- Break it: `npm run build` fails loudly if `src/editor/standalone.html` is missing.

### S1.2 Schema and migration (done)
- Outcome: typed layout, validation, v1 to v2 migration.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `tests/core/schema.test.ts`, `tests/core/migrate.test.ts`.
- Interface:
  ```ts
  export type Pt = [number, number];
  export type RoomKind = "room" | "outdoor" | "fill" | "terrace" | "structure";
  export type DoorKind = "door" | "glass" | "window" | "sealed";
  export type DeviceType = "heater" | "light" | "switch" | "plug" | "temp" | "humidity" | "motion" | "contact" | "camera" | "climate" | "media" | "cover" | "other";
  export type FurnitureSymbol = "table" | "sofa" | "bed" | "cabinet" | "chair" | "sink" | "toilet" | "shower" | "bathtub" | "tv" | "computer" | "tree" | "patio-wood" | "patio-concrete" | "car";
  export interface Room { id: string; name: string; area: string; label: string; kind: RoomKind; pts: Pt[]; w: boolean[] }
  export interface Wall { id: string; a: Pt; b: Pt; kind: "wall" | "boundary" }
  export interface Stairs { id: string; name: string; pts: Pt[] }
  export interface Door { id: string; name: string; kind: DoorKind; a: Pt; b: Pt; sensor?: string; cover?: string }
  export interface Opening { id: string; a: Pt; b: Pt }
  export interface Extra { id: string; name: string; a: Pt; b: Pt }
  export type Device = { id: string; type: DeviceType; entity: string; name?: string } & ({ x: number; y: number } | { a: Pt; b: Pt });
  export interface Furniture { id: string; symbol: FurnitureSymbol; x: number; y: number; rot: number; w: number; h: number }
  export interface Floor { title: string; outline: Pt[]; rooms: Room[]; walls: Wall[]; stairs: Stairs[]; doors: Door[]; openings: Opening[]; extras: Extra[]; devices: Device[]; furniture: Furniture[] }
  export interface CatalogEntry { id: string; floor: string; room: string; type: DeviceType; name: string; entity: string }
  export interface Layout { version: 2; unit: "cm"; north: number; floors: Record<string, Floor>; catalog: CatalogEntry[] }
  export function validate(x: unknown): { ok: true; layout: Layout } | { ok: false; errors: string[] };
  export function migrate(x: unknown): Layout;   // accepts v1 or v2; throws Error("Unknown layout version N") otherwise
  ```
  Migration rules: missing `version` or `1` → v2; add ids `<kind>-<floor>-<n>`; `area` = slug of `name`; device `sensor` → `temp`, `window` → `contact`; missing arrays → `[]`; `catalog` missing → built from placed devices. `validate` checks: every polygon ≥ 3 points, `w.length === pts.length`, ids unique per floor, device ids unique across floors, door `sensor`/`cover` are strings containing a dot, `north` in [0, 360).
- Test: `demo/layout.json` validates; `demo/layout.v1.json` migrates and validates and equals `demo/layout.json` deep-equal after ids are stripped; `migrate({version: 3})` throws with that message; each validate rule has one failing fixture.
- Done when: all tests pass; `npm run lint` clean; types exported from `src/core/index.ts`.
- Break it: `migrate(null)` throws, does not return a layout.

### S1.3 Geometry (done)
- Outcome: the editor's snapping and stitching as pure functions.
- Files: `src/core/geometry.ts`, `tests/core/geometry.test.ts`.
- Interface (all pure, return new arrays, never mutate inputs):
  ```ts
  export function dist(a: Pt, b: Pt): number;
  export function polys(f: Floor): { id: string; pts: Pt[]; room?: Room }[];   // outline "o", rooms "r<i>", stairs "s<i>"
  export function nearestEdge(f: Floor, p: Pt, maxd: number): { d: number; q: Pt; u: Pt; poly: string; i: number } | null;
  export interface SnapOpts { threshold: number; grid: number | 0; exclude: Pt[]; neighbours: Pt[] }
  export function snapPoint(f: Floor, p: Pt, o: SnapOpts): Pt;  // corner, then T-onto-edge, then neighbour axis, then grid
  export function stitch(f: Floor, pt: Pt): Floor;              // insert pt into any edge it lies on (t in (0.01,0.99), d ≤ 2), keeping w flags
  export function insertPoint(f: Floor, poly: string, i: number, pt: Pt): Floor;
  export function removePoint(f: Floor, poly: string, j: number): Floor;      // refuses below 3 points
  export function movePoints(f: Floor, from: Pt, to: Pt, detach: boolean): Floor;  // all coincident (≤2 cm) points unless detach
  export function edgeRooms(f: Floor, poly: string, i: number): { room: Room; i: number }[];
  export function toggleWall(f: Floor, poly: string, i: number): Floor;      // sets every matching room edge to the same new value
  export function mergeCorners(f: Floor, tol: number): Floor;                 // simplify.py behaviour, outline wins
  ```
- Test: fixtures for each function with numbers taken from the current editor behaviour: corner snap within threshold wins over edge; T-snap inserts exactly one point; `removePoint` on a triangle returns the same floor; `movePoints` with detach moves one point only; `mergeCorners` on two corners 20 cm apart with tol 25 yields the outline coordinate.
- Done when: tests pass; no function touches `document` or `window`.
- Break it: `snapPoint` with `threshold: 0` returns the grid-rounded input.

### S1.4 Renderer (done)
- Outcome: layout to SVG, with an optional live state overlay, used by editor and card.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/core/__snapshots__/`.
- Interface:
  ```ts
  export interface StateOverlay { [entityId: string]: { state: string; attributes: Record<string, unknown>; last_changed: string } }
  export interface RenderOpts { scale: number; selection?: { t: string; i: number } | null; showNames?: boolean; filter?: DeviceType | ""; state?: StateOverlay; now?: number; fade?: number; roomGlow?: boolean; editor?: boolean }
  export function renderFloor(f: Floor, o: RenderOpts): string;   // inner SVG markup
  export function viewBoxFor(f: Floor, pad?: number): { x: number; y: number; w: number; h: number };
  ```
  Markup contract (the editor and the card hit-test on these): rooms `polygon[data-r]`, edges `line.e[data-e="<poly>:<i>"]`, walls `line[data-w]`, doors `line[data-d]`, devices `g[data-x]` with `class="dev dev-<type> <on|off|unavailable>"`, handles `circle.h[data-h]` only when `editor`. Colours only through CSS variables (`--fp-*`), never literals. State mapping per the SPEC table: `on` class for light/switch/plug on; `open` class on a door whose `sensor` is `on`; motion sets `style="--fp-fade:<0..1>"` from `(now - last_changed)/fade`; temp and humidity add `<text class="val">` with the state and `unit_of_measurement`; unavailable/unknown add `unavailable`.
- Test: snapshot of the demo ground floor with no state; with a state fixture: the door with sensor on has class `open`, a light on has class `on`, motion changed 5 s ago with `fade: 10` has `--fp-fade:0.5`, a temp shows `21.5 °C`.
- Done when: snapshot committed; state tests pass; the string contains no `#rrggbb`.
- Break it: a device whose entity is missing from `state` renders as `off`, not as an error.

### S1.5 Icons (done)
- Outcome: one icon per device type and furniture symbol.
- Files: `src/core/icons.ts`, `tests/core/icons.test.ts`.
- Interface: `export const DEVICE_ICONS: Record<DeviceType, string>` (MDI path data, from `@mdi/js`, names as in S0.1) and `export const FURNITURE: Record<FurnitureSymbol, { w: number; h: number; svg: string }>` where `svg` is a 100×100 viewBox symbol body drawn by hand (simple outlines). Default sizes in cm: table 160×90, sofa 200×90, bed 160×200, cabinet 100×45, chair 45×45, sink 60×45, toilet 40×65, shower 90×90, bathtub 170×75, tv 120×10, computer 60×40, tree 200×200, patio-wood 300×300, patio-concrete 300×300, car 450×180.
- Test: every key of `DeviceType` and `FurnitureSymbol` (enumerated in the test) exists; each path string starts with `M`.
- Done when: test passes; licence note for MDI in README.
- Break it: none; data only.

### S1.6 Editor on the core (done)
- Outcome: the current editor's features as a Lit element using core functions.
- Files: `src/editor/editor-app.ts` (`<floorplan-studio-editor>`), `src/editor/state.ts` (layout, history, selection, view; `persist()` to `localStorage` key `floorplan-studio:layout`), `src/editor/panels.ts` (selection panels), `tests/editor/editor.spec.ts` (Playwright).
- Interface: element properties `layout: Layout`, `floor: string`, events `layout-changed` (detail: Layout) and `save-request`. Same toolbar as SPEC (floor chips, filter, Names, Add / View / File). Same pointer behaviour as the vanilla editor (see HomeFloorplan `editor/editor.src.html` for the reference behaviour, port it; do not redesign). Furniture: Add → Furniture → symbol; drag to move, panel sets w, h, rot. Devices: Add → Device lists `catalog` entries not placed, grouped by type.
- Test (Playwright, against `npm run dev`): load demo; drag a room corner 50 px, the coordinates change and a coincident corner of the neighbour moves too; Add → Device places one and the list shrinks by one; remove it, the list grows; Add → Furniture → bed places a bed; File → Save downloads a file that validates; reload restores from localStorage; File → Reset returns to the demo.
- Done when: the Playwright suite passes headless; `npm run lint` clean.
- Break it: dragging with Shift moves only the grabbed corner.

### S1.7 Standalone build (done)
- Outcome: `dist/editor.html` works from `file://` with no network.
- Files: `tests/editor/standalone.spec.ts`, `tests/setup/build.ts` (Playwright globalSetup, runs the build), `scripts/build.mjs` (builds the three bundles, names `editor.html`, copies them to `www/`). `src/editor/standalone.html` and the singlefile vite config came earlier.
- Test: Playwright opens `file:///.../dist/editor.html`, the demo renders, Open a v1 file migrates it, Save downloads v2. Network requests during the test: zero (assert with `page.on('request')`).
- Done when: test passes; file size under 1 MB.
- Break it: offline (Playwright `context.setOffline(true)`) still loads.

---

## Sprint 2 — card (E3)

### S2.1 Card element
- Outcome: `custom:floorplan-studio-card` renders a floor from config or the integration.
- Files: `src/card/floorplan-studio-card.ts`, `tests/card/card.test.ts` (vitest + jsdom).
- Interface: `class FloorplanStudioCard extends LitElement` with `setConfig(c: { floor?: string | "all"; fade?: number; room_glow?: boolean; layout?: Layout; layout_url?: string })`, `set hass(h)`, `getCardSize()`, `static getStubConfig()`. Layout source order: `config.layout`, then `config.layout_url` (fetched once), then websocket `floorplan_studio/load`. Registers itself on `window.customCards`. Renders `renderFloor(..., { state: hass.states, now: Date.now(), fade, roomGlow })` inside an `<svg>` with `viewBoxFor`. The card must draw openings (erase line) and extras (dashed line plus name): `renderFloor` already does, shared with the editor since the S1.7 review fixes, so the card only has to call it and not redraw them. A 1 s timer re-renders only while any motion device is within its fade window.
- Test: with a stub `hass` and `config.layout = demo`, the shadow DOM contains one `polygon[data-r]` per room; changing a light state in the stub and setting `hass` again toggles the `on` class.
- Done when: tests pass; `npm run build` emits `dist/floorplan-studio-card.js` under 300 kB.
- Break it: `setConfig({})` with no layout shows the text "No layout: install the Floorplan Studio integration or set layout_url".

### S2.2 Lights, switches, plugs
- Outcome: tap toggles, hold opens more-info, light colour and brightness shown.
- Files: card, `src/card/actions.ts`, `tests/card/actions.test.ts`.
- Interface: `tap` → `hass.callService(domain, "toggle", { entity_id })`; hold (≥ 500 ms) → `fireEvent(this, "hass-more-info", { entityId })`. Light on: icon `fill` from `attributes.rgb_color` if present else `--fp-on`, opacity `brightness/255` floor 0.35.
- Test: pointerdown+up within 500 ms calls `callService` once with `light.toggle`; 600 ms fires `hass-more-info`; rgb `[255,0,0]` gives `fill="rgb(255,0,0)"`.
- Done when: tests pass.
- Break it: two taps within 300 ms toggle twice, not once (no debounce that eats input).

### S2.3 Contact sensors on doors
- Outcome: a door or window with `sensor` on draws orange.
- Test: covered by render tests; card test: state on → `line[data-d].open` exists; tap on the door fires more-info for the sensor.
- Done when: the demo's three sensor doors respond in the jsdom test.
- Break it: a door whose `sensor` entity is missing from `hass.states` draws normally.

### S2.4 Motion fade
- Outcome: motion goes red on `on` and fades to grey over `fade` seconds from `last_changed`, even after the sensor returns to `off`.
- Interface: fade uses `last_changed` of the most recent `on`; the card keeps `lastOn: Record<entity, number>` updated on each `hass` set; render passes it as `now`/`last_changed` so a sensor that already went `off` keeps fading from its last `on`.
- Test: fake timers; state on at t0 → `--fp-fade:1`; at t0+5 s with `fade: 10` → `0.5`; sensor off at t0+2 s does not reset the fade; at t0+10 s → `0` and the timer stops.
- Done when: tests pass; no timer runs when nothing is fading (assert `setInterval` count).
- Break it: `fade: 0` shows red only while `on`.

### S2.5 Sensors, climate, camera, media
- Outcome: temp and humidity labels; heater bar orange when `hvac_action === "heating"`; camera and media open more-info on tap; media accent when `playing`.
- Test: stub states → label text `21.5 °C`, `48 %`; climate heating → `line.heater.on`; tap camera fires more-info with its entity.
- Done when: tests pass.
- Break it: a sensor with state `unknown` shows `–`, not `unknown`.

### S2.6 Room glow, floor switcher, unavailable
- Outcome: room fill tints when any light in it is on (`room_glow`); `floor: "all"` shows chips to switch floors; unavailable entities are struck through.
- Interface: a device is "in" a room by point-in-polygon of its `x,y` (heaters: midpoint). Chips are inside the card, top-left, class `fp-floors`.
- Test: light on in room A → `polygon[data-r].glow` for A only; chips count equals floors; unavailable → class `unavailable`.
- Done when: tests pass.
- Break it: a device outside every room glows nothing and throws nothing.

### S2.7 Covers on doors
- Outcome: a door with `cover` opens after a confirm dialog.
- Interface: tap on such a door → in-card dialog "Open <name>?" with Cancel / Open; Open calls `cover.open_cover` (or `close_cover` if `state === "open"`). Door line class `cover-open` when the cover is open.
- Test: tap → dialog text; Open → `callService("cover", "open_cover", { entity_id })`; Cancel → no call.
- Done when: tests pass.
- Break it: a second tap while the dialog is open does not open a second dialog.

---

## Sprint 3 — integration, panel, release (E4)

### S3.1 Integration: storage and websocket
- Outcome: load and save the layout inside HA.
- Files: `custom_components/floorplan_studio/{__init__.py, const.py, config_flow.py, storage.py, websocket.py, manifest.json, strings.json, translations/en.json}`, `tests/integration/test_websocket.py`, `tests/integration/conftest.py`.
- Interface: `Store(hass, 1, "floorplan_studio.layout")`; websocket commands `{"type": "floorplan_studio/load"}` → `{"layout": {...} | null}` and `{"type": "floorplan_studio/save", "layout": {...}}` → `{"ok": true}`; save validates `version == 2` and rejects anything else with `invalid_format`. Config flow: single instance, no fields. Admin only for save.
- Test: `pytest-homeassistant-custom-component`: set up entry; save demo; load returns it; save `{"version": 1}` returns `invalid_format`; non-admin save is rejected.
- Done when: `pytest` green; `hassfest` action passes.
- Break it: load before any save returns `null`, not an error.

### S3.2 Panel
- Outcome: the editor served at `/floorplan-studio` in the sidebar, saving through the websocket.
- Files: `panel.py`, `src/editor/panel.ts` (`<floorplan-studio-panel>` receives `hass`, wraps the editor, Load/Save buttons call the websocket), `__init__.py` registers static path `/floorplan_studio_static` → the integration's `www/` folder, and the panel with `panel_custom.async_register_panel(frontend_url_path="floorplan-studio", webcomponent_name="floorplan-studio-panel", module_url=..., sidebar_title="Floorplan Studio", sidebar_icon="mdi:floor-plan", require_admin=True)`. `npm run build` copies `dist/*.js` and `dist/editor.html` into `custom_components/floorplan_studio/www/`.
- Test: dev container (`.devcontainer` from the HA custom component template): open the panel, File → Load gets the demo saved in S3.1's test fixture, move a light, Save, reload the page, the light stays. Record as a Playwright test against the dev container URL when `HA_URL` and `HA_TOKEN` env vars are set; skipped otherwise.
- Done when: the manual check is recorded with a screenshot in the PR; Playwright test present and skipping cleanly without env.
- Break it: a non-admin user does not see the sidebar entry.

### S3.3 Pickers from hass
- Outcome: rooms pick an area, devices pick an entity, from HA data, grouped.
- Files: `src/editor/hass-pickers.ts`, `tests/editor/pickers.test.ts`.
- Interface: `areas(hass)` → `{id, name}[]`; `entitiesByType(hass)` → `Record<DeviceType, { entity: string; name: string; area: string | null }[]>` using domain and `device_class` (light→light; switch with device_class outlet→plug else switch; sensor temperature→temp, humidity→humidity; binary_sensor motion/occupancy→motion, door/window/garage_door/opening→contact; camera; climate; media_player; cover). Fetches `config/area_registry/list`, `config/device_registry/list`, `config/entity_registry/list` once. In the editor, Add → Device shows type → area → entity, hiding entities already placed; door panel's sensor list uses `contact` entities; the `catalog` is rebuilt from this list on Save when running in HA.
- Test: registry fixtures → grouping as above; a placed entity is absent from the list.
- Done when: tests pass; the panel in the dev container shows real areas.
- Break it: an entity with no area lands under "No area".

### S3.4 Card as a resource
- Outcome: the card JS is available to Lovelace without manual resource setup.
- Interface: `__init__.py` calls `frontend.add_extra_js_url(hass, "/floorplan_studio_static/floorplan-studio-card.js")`.
- Test: dev container: add the card by YAML, it renders the saved layout with no `layout` in config.
- Done when: screenshot in the PR; acceptance criterion 4 checked and recorded.
- Break it: with no saved layout the card shows the S2.1 message.

### S3.5 Release
- Outcome: installable through HACS as a custom repository.
- Files: `hacs.json`, `.github/workflows/{validate.yml (hassfest + hacs action), ci.yml (lint, test, build, pytest)}`, `README.md` install steps, `CHANGELOG.md`, tag `v0.1.0`.
- Test: CI green on main; fresh HA in the dev container installs from the tag and runs acceptance criteria 3 and 4.
- Done when: tag exists, README matches reality, CI badge green.
- Break it: HACS validation fails if `www/` is missing from the tag (build must run in the release workflow).

---

## Sprint 4 — content and docs (E5)

### S4.1 Furniture in editor and card
- Outcome: every symbol in `FURNITURE` can be placed, sized, rotated; the card draws them under devices.
- Test: Playwright places each symbol; render snapshot with all symbols.
- Done when: tests pass.
- Break it: rotation 450 is stored as 90.

### S4.2 Prompt
- Outcome: `prompts/trace-from-photos.md` that any of Claude, ChatGPT, Gemini, Grok can follow.
- Content: role; ask two questions first (one known dimension with the wall it belongs to; where north is on the photo); then per floor list rooms, outline, doors, windows in cm, north up, y down, as a v2 layout with `catalog: []`; output JSON only, no prose; a 20-line example; a checklist the model must satisfy before answering (closed polygons, doors on walls, no room outside the outline).
- Test: the maintainer runs it on the private photos with Claude; the JSON passes `validate()` and opens in the editor. Record model, date and pass/fail in `prompts/RESULTS.md` (no photos, no layout).
- Done when: one recorded pass; README section matches the prompt.
- Break it: the prompt tells the model what to do when it cannot read a dimension: write `null` and list it under `"unknown"`, not guess.

### S4.3 Docs
- Outcome: `docs/schema.md` (generated from `schema.ts` comments), `docs/card.md`, `docs/editor.md` with screenshots, `CONTRIBUTING.md`.
- Test: `npx markdown-link-check docs/*.md README.md` clean.
- Done when: link check passes; screenshots are of the demo, not a real house.

### S4.4 Demo and HACS default
- Outcome: a GIF in the README; submission PR to the HACS default repository.
- Done when: GIF under 3 MB; submission opened.

## Later, not planned

- Per-room presence heat map over a day.
- Import from ha-floorplan SVGs.
- Multiple layouts (several houses).
