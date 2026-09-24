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
prompts/     SKILL.md  SCHEMA.md  README.md  examples/
scripts/     validate-layout.mjs  shots.mjs
docs/
```

## Epics

- E1 Core: schema v2, migration, geometry, renderer, icons.
- E2 Editor: port the current editor onto the core; standalone build.
- E3 Card: live rendering and behaviours.
- E4 Integration and panel: load/save, HA-hosted editor, HACS release.
- E5 Content: furniture symbols, prompt, docs.
- E6 Organise: create and link HA areas, helpers, groups and automations from the plan.

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

## Sprint 1.5 — drawing (E1, E2)

Runs before the card so the renderer settles first. Core plus editor, no HA.
Schema stays version 2: every change is an added enum value or an optional
field, and `migrate` fills defaults.

### S1.8 Zones and water (done)
- Outcome: a room can be a zone (a dotted subdivision inside a room, no walls) or water (pool, pond, lake). A zone can carry its own HA area.
- Files: `src/core/schema.ts`, `src/core/render.ts`, `src/editor/panels.ts`, `src/editor/editor-app.ts`, `tests/core/schema.test.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`, `demo/layout.json`, `demo/layout.v1.json`.
- Interface: `RoomKind` gains `"zone" | "water"`. A zone's `w` flags are all `false` (`validate` reports a zone with a wall edge); `renderFloor` draws its edges dotted (existing class `nw`) with no fill and its name in a smaller label. Water gets class `water` and fills with `--fp-water`. Room panel: the kind select lists both; picking `zone` clears `w`. Add menu gains Zone and Water: a 200 x 200 cm square on the grid, centred in the view, selected. Zones do not take part in `stitch`, `snapPoint` corner snapping or `mergeCorners`: `polys(f)` still lists them (id `r<i>`) so corners drag, but a zone's corners are excluded from the snap targets of other polygons and from `stitch`, so drawing a zone never cuts a wall.
- Test: schema fixtures for both kinds and for a zone with a wall edge; render snapshot for a demo zone (the demo living room gains a "Reading corner" zone with area `reading`) and a demo garden pond; Playwright: Add, Zone places one, its edges are dotted, dragging its corner onto a wall does not insert a point in the wall.
- Done when: tests pass; snapshot updated; the card needs no change to draw both (assert `renderFloor` output contains them without `editor: true`).
- Break it: a zone with fewer than 3 points fails `validate`, like a room.

### S1.9 Wall kinds (done)
- Outcome: free walls come in five kinds: internal wall, dotted boundary, external wall, fence, outdoor edge.
- Files: `src/core/schema.ts`, `src/core/render.ts`, `src/editor/panels.ts`, `tests/core/schema.test.ts`, `tests/core/render.test.ts`.
- Interface: `Wall.kind` is `"wall" | "boundary" | "external" | "fence" | "edge"`. `renderFloor` gives `line[data-w]` the class of its kind (`wall` keeps class `e`, `boundary` keeps `nw`, the new ones get `external`, `fence`, `edge`); stroke and dash per kind through `--fp-wall-*` variables in `FLOORPLAN_CSS`: external thick, fence thin dash-dot, edge thin solid grey. Wall panel: a kind select replaces the wall/boundary toggle button. No migration: existing values keep their meaning.
- Test: `validate` accepts the five and rejects `"garden"`; render test asserts the class per kind; Playwright: change a wall's kind in the panel and the class changes.
- Done when: tests pass; `docs/SPEC.md` lists the five.
- Break it: a v1 file with `kind` missing on a wall migrates to `wall`.

### S1.10 Floors (done)
- Outcome: add, rename, delete and reorder floors in the editor.
- Files: `src/editor/state.ts`, `src/editor/editor-app.ts`, `src/editor/panels.ts`, `tests/editor/state.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: `EditorState.addFloor(title): string` (key = slug of title, `-2` suffix on clash; empty outline, all arrays empty; selects it), `renameFloor(key, title)`, `deleteFloor(key)` (refuses the last floor; returns false), `moveFloor(key, delta)`. Floor order is the object key order of `layout.floors`; `moveFloor` rebuilds the object. Toolbar: a "+" chip after the floor chips opens a title prompt (inline input, Enter adds, Esc cancels). Floor panel (shown when nothing is selected): title field, Move up, Move down, Delete with a confirm ("Delete floor <title> and everything on it?"). Catalog entries whose `floor` is the deleted key keep it: they stay unplaced and still show in Add, Device. All through `commit`, one undo step each.
- Test: state tests for each function including the last-floor refusal and key clash; Playwright: add a floor "Attic", it appears as a chip and is empty, rename it, move it first, delete it, undo brings it back with its content.
- Done when: tests pass.
- Break it: a title that slugs to an existing key gets a `-2` key, not a silent overwrite.

### S1.11 Draw mode (done)
- Outcome: draw a polyline or polygon by clicking points, after choosing what it is.
- Files: `src/editor/editor-app.ts`, `src/editor/state.ts`, `tests/editor/editor.spec.ts`.
- Interface: Add menu gains a "Draw" group: Room, Zone, Water, Outline (replaces the current outline), Wall (each of the five kinds), Opening, Structure line. Choosing one enters draw mode: status shows "Click to add points, double-click or Enter to finish, Esc to cancel"; the cursor is a crosshair; each click adds a point snapped with `snapPoint` (Alt disables); a rubber-band line follows the pointer from the last point; polygons close on the first point or on finish; for line kinds every click after the first commits one wall segment and continues from it (chain), so a fence is many walls. Finish with fewer than 3 points (polygon) or 2 (line) cancels. One undo step for the whole shape, none on cancel. Existing single-shape Add items stay.
- Test: Playwright: Draw, Room, four clicks and Enter give a room with four points at the snapped coordinates; Draw, Wall (fence), three clicks and Enter give two fence walls sharing a point; Esc after two clicks leaves the floor unchanged and the undo stack the same length.
- Done when: tests pass; the Playwright hit-testing uses `page.mouse` on the real canvas.
- Break it: a click on the first point of a 2-point polygon does not close it (needs 3).

### S1.12 Device menu (done)
- Outcome: Device is its own toolbar menu, not an item of Add.
- Files: `src/editor/editor-app.ts`, `tests/editor/editor.spec.ts`.
- Interface: toolbar order: floor chips, filter, Names, Add, Device, View, File. The Device menu lists unplaced catalog entries grouped by type (S3.3 adds area grouping), with a search field at the top that filters by name and entity id. Add loses its Device item.
- Test: Playwright: the Device menu places a device and the list shrinks; typing in the search hides non-matching entries; Add has no Device item.
- Done when: tests pass.
- Break it: a search with no match shows "No device matches", not an empty menu.

### S1.13 Opening tool (done)
- Outcome: Add, Opening places a gap in a wall, the way Add, Door places a door. The wall under it is not drawn.
- Files: `src/editor/editor-app.ts`, `src/editor/panels.ts`, `tests/editor/editor.spec.ts`, `tests/core/render.test.ts`.
- Interface: `addOpening` is renamed `addDoor` (it places doors and windows); a new `addOpeningGap(len = 120)` copies its placement: the edge nearest the view centre, along that edge (`nearestEdge`, `segmentAt`), id from `newId(f, floor, "opening")`, selected. Add menu item "Opening" (`#addGap`). Selected opening: panel "Opening" with length (cm, keeps the midpoint and direction) and Delete; end handles already exist (`data-hp`); Delete and Backspace remove it. When an end is dragged, `snapPoint` applies as for a door end. Core is unchanged: `renderFloor` already draws `.opening` over the wall with the room colour. Paint order stays: openings above walls and edges, below doors, furniture and devices.
- Test: Playwright: Add, Opening adds one entry to `floor.openings`; the wall line under it is covered (the opening line lies on the wall: `elementFromPoint` on the middle of the segment returns the opening in the editor's hit order, and a render test asserts `.opening` is emitted after the wall line it covers); length field 200 changes `dist(a, b)` to 200; Delete removes it; Undo restores it. One undo step per action.
- Done when: tests pass; the room's outline edge and a free wall both work as the host wall.
- Break it: with no wall on the floor, Add, Opening places it at the view centre and does not throw.

---

## Sprint 1.6 — editor rework (E2)

Diego used the editor and wrote a change list. It runs before the card for the
same reason Sprint 1.5 did: every item changes what `renderFloor` draws or
what the layout holds, and the card should meet all of it once. What was
decided, and what was refused, is in the top entry of `docs/DECISIONS.md`.
Schema stays version 2; `migrate` fills every new field and renames `outdoor`
to `garden`, at v1 and at v2.

Diego's list, in his words:

> - zones, stairs, water, terrace, outdoor cannot be dragged.
> - outdoor rename to garden
> - fill make it grey and with diagonal lines showing it's not usable.
> - garden make it darker green, terrace light brown
> - add a pavement style for outdoor make it grey.
> - delete button make it orange
> - when adding a new item put it top right, outside the house.
> - device icon must be on top of everything to be seen, put icons inside a
>   circle, make the circle semitransparent grey (alpha 50%)
> - the draw menu, extract from add and put next to add menu.
> - water is a type of room, so remove from the add menu
> - can stairs be a type of zone? color is good, but can we make it look
>   striped like a stair? also must be possible to make curved and round
>   stairs. so perhaps stairs needs its own type and a submenu for
>   round/straight and allow to rotate them. if round diameter can be changed.
>   and it can be dragged.
> - every placeable item should be rotatable, rooms/zones once connected/
>   snapped to other zones or rooms cannot rotate anymore. if i UNSNAP a room
>   (they must be unsnappable) then i can rotate.
> - when adding stairs they get added in all floors in the same exact position.
> - when building floors every new floor inherits the perimeter and the stair
>   position of the first floor designed. it is possible to delete a floor (red
>   button) so i can start again with a clean floor.
> - and the whole planimetry should be rotatable, the option in the view menu.
>   it rotates all floors. it is made to align to north. just do 45 degrees
>   increment
> - possibility of changing wall type, dotted, internal, external, opening,
>   fence, edge etc. now i can only draw it, i need to be able to change it and
>   as a submenu of add wall selecting the type.
> - allow to change ground color of the rooms and of the various zones. so it
>   can be customized. in the room menu.
> - make the reset button Red.
> - one wall switch can control multiple dumb lights (placed manually)
> - dumb lights when on are yellow and have a round aura (yellow, alpha 50%)
>   not too big, say 2 meter in diameter.
> - smart lights show the same aura and their color with the actual smart light
>   color. it must be attachable to the color of the light in HA
> - when devices are on their icon is lightened with the color that represents
>   them and since all icons are inside a small semi transparent circle, the
>   circle too can change color with the same color of the icon (50% alpha).
> - motion sensors, contact sensors are red.
> - lights are yellow, smart lights have their color or yellow
> - heaters/trv are orange
> - AC/heatpumps are blue if they do cold, orange if they warm, grey if they
>   are just fans/scrubbers/filters.
> - wallswitches are grey.
> - computers grey, tv grey when it's on blue.
> - garden sensors are green
> - cameras are dark grey and show a 120 degree cone of view (dark grey, 33%
>   alpha), that can be rotated to show what they see
> - humidity sensors are grey

Everything on that list that needs an entity state is a card task: S2.8 to
S2.10. Everything drawn from the layout alone is here.

### S1.14 Garden and pavement (done)
- Outcome: the room kind `outdoor` is called `garden`, and `pavement` joins it. Each outdoor kind has its own colour.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/render.ts`, `src/editor/panels.ts`, `tests/core/schema.test.ts`, `tests/core/migrate.test.ts`, `tests/core/render.test.ts`, `demo/layout.json`, `demo/layout.v1.json`, `docs/SPEC.md`.
- Interface: `RoomKind` is `"room" | "garden" | "pavement" | "fill" | "terrace" | "structure" | "zone" | "water"`; `ROOM_KINDS` in that order. `validate` rejects `"outdoor"` with the list of the eight. `migrate` maps `kind: "outdoor"` to `"garden"` on every room at v1 and at v2, before ids and areas are filled, and leaves any other kind alone. `renderFloor` keeps emitting `room room-<kind>`; `FLOORPLAN_CSS` drops `--fp-outdoor` for `--fp-garden` (#9db98a, a darker green than the old #dce6d6), `--fp-terrace` (#cdb094, light brown) and `--fp-pavement` (#c9c6bf, grey), each used by its own class. The room panel's kind select shows the eight through a new `ROOM_LABELS: Record<RoomKind, string>` in `panels.ts` (Room, Garden, Pavement, Fill, Terrace, Structure, Zone, Water) instead of the raw ids. The demo ground floor gains a garden around the pond and a pavement strip in front of the house, both in `layout.json` and `layout.v1.json` (the v1 one written as `outdoor` for the garden, so migration is exercised).
- Test: `migrate` on a fixture with `kind: "outdoor"` at version 1 and at version 2 gives `"garden"` both times and a second `migrate` changes nothing; `validate` refuses `"outdoor"` and accepts `"pavement"`; the render snapshot shows `room-garden` and `room-pavement`; `migrate(demo v1)` still deep-equals `demo/layout.json`.
- Done when: tests pass; the snapshot is updated; `npm run lint` clean; SPEC lists the eight kinds.
- Break it: a room with `kind: "garden"` already set survives `migrate` unchanged, and a room with no `kind` at all is still reported by `validate`, not silently turned into a garden.

### S1.15 Fill is hatched (done)
- Outcome: a `fill` room is grey with diagonal lines, so it reads as floor that is not a usable room.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`.
- Interface: `renderFloor` emits, as its first element and only when the floor has a room of kind `fill`, `<defs><pattern id="fp-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="var(--fp-fill)"/><line x1="0" y1="0" x2="0" y2="12" stroke="var(--fp-fill-line)" stroke-width="2"/></pattern></defs>`. `.room-fill` becomes `fill:url(#fp-hatch)`; new variables `--fp-fill` (#c4c0b8) and `--fp-fill-line` (#9a958b). The markup keeps no colour literal. The id is fixed on purpose (see DECISIONS).
- Test: a render fixture with one `fill` room contains the `<defs>` exactly once and `.room-fill` resolves to the pattern; a floor with no `fill` room emits no `<defs>`; the string still has no `#rrggbb`.
- Done when: tests pass; the demo snapshot is unchanged (the demo has no fill room).
- Break it: two `fill` rooms on one floor still emit one `<defs>`, not two.

### S1.16 A room or zone can have its own colour (done)
- Outcome: the user picks the ground colour of a room, a zone or any other polygon, and can clear it again.
- Files: `src/core/schema.ts`, `src/core/render.ts`, `src/editor/panels.ts`, `tests/core/schema.test.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: `Room` gains `color?: string`. `validate` accepts it only when it matches `/^#[0-9a-fA-F]{6}$/` and reports `"<id> color must be a colour like #aabbcc"` otherwise. `migrate` passes it through and never invents one. `renderFloor` adds `fill="<color>"` to that room's `<polygon>` when it is present and the layout passed `validate`; the class stays, so the hatch, water and zone rules still apply to a room without one. The room panel gains `<input type="color" id="rcol">` bound to `color` (`#ffffff` when absent) and a button `#rcolx` "Use the default colour" that deletes the key; both are one undo step and none when unchanged.
- Test: `validate` rejects `"red"`, `"#abc"` and `"#aabbcc; x"` and accepts `"#AABBCC"`; a render fixture with a colour has `fill="#aabbcc"` on that polygon and no other; Playwright: set the colour of the demo living room, the polygon's `fill` attribute changes, press the default button and the attribute is gone.
- Done when: tests pass.
- Break it: a colour on a room whose kind is `fill` still draws the hatch pattern over it, and neither throws.

### S1.17 Every room edge has a kind (done)
- Outcome: a room edge is one of the five wall kinds, not a boolean, so it can be external, a fence or an outdoor edge like a free wall.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/geometry.ts`, `src/core/render.ts`, `src/editor/draw.ts`, `src/editor/editor-app.ts`, `src/editor/panels.ts`, `tests/core/{schema,migrate,geometry,render}.test.ts`, `tests/editor/draw.test.ts`, `demo/layout.json`, `demo/layout.v1.json`, `docs/SPEC.md`.
- Interface: `Room.w: boolean[]` becomes `Room.wk: WallKind[]`, one entry per point, the edge from `pts[i]` to `pts[i+1]` being `wk[i]`. `migrate` writes `wk` from `w` (`true` → `"wall"`, `false` → `"boundary"`), deletes `w`, and fills a missing or short `wk` with `"wall"` up to `pts.length`; a room that already has a valid `wk` is left alone. `validate` requires `wk.length === pts.length` and each entry in `WALL_KINDS`, and requires every entry of a zone to be `"boundary"` (the old "every w false" rule). `geometry.ts`: `insertPoint`, `removePoint`, `stitch` and `mergeCorners` splice `wk` where they spliced `w`; `toggleWall(f, poly, i)` is replaced by `setEdgeKind(f, poly, i, kind: WallKind): Floor`, which writes `kind` into every room that has that edge (`edgeRooms` is unchanged) and returns `f` itself when nothing matches; `edgeRooms` keeps skipping zones. `renderFloor` gives a room edge the class of its kind, exactly as it already does for a free wall (`wall` → `e`, `boundary` → `e nw`, the rest `e <kind>`, escaped); a zone edge stays dotted whatever `wk` says. `draw.ts` `applyShape` writes `wk: pts.map(() => "wall")` for a room and `"boundary"` for a zone, water and outline-less shapes.
- Test: `migrate` on a v1 and a v2 fixture whose `w` is `[true, false, true]` gives `wk` `["wall", "boundary", "wall"]` and no `w`; a second `migrate` changes nothing; `validate` rejects a `wk` of the wrong length, an unknown kind and a zone with a `"wall"` entry; `setEdgeKind` writes `"external"` into both rooms that share an edge and leaves a zone edge alone; the render test asserts the class per kind on a room edge; `migrate(demo v1)` deep-equals `demo/layout.json`.
- Done when: tests pass; the demo layouts and the snapshot are updated; `grep -rn "\.w\b" src/core src/editor` finds no room wall flag left; SPEC describes `wk`.
- Break it: a room whose `w` is `[true, true]` on a three-point polygon migrates to three `wk` entries, the third `"wall"`, and `validate` then accepts it.

### S1.18 Change the kind of an edge or a wall (done)
- Outcome: the panel of a selected room edge sets its kind, the way the free wall panel already does.
- Files: `src/editor/panels.ts`, `tests/editor/editor.spec.ts`.
- Interface: `edgePanel` loses the "Make this edge a wall / a dotted boundary" button and gains `<select id="ek">` with the five `WALL_LABELS`, shown only when `edgeRooms` returns something (an outline edge that no room shares still has no kind to set, as today). Choosing one calls `setEdgeKind` through `commit`: one undo step, none when unchanged. The panel title shows the label of the current kind, as the wall panel does.
- Test: Playwright: select a shared edge of the demo, choose "External wall", both rooms' `wk` entries read `external` and the drawn line has class `external`; choosing the same kind again adds no undo step.
- Done when: tests pass.
- Break it: the select does not appear on a zone edge (`edgeRooms` returns nothing there), and choosing a kind on the outline edge of a room-less floor changes nothing and does not throw.

### S1.19 A free wall becomes an opening, and back (done)
- Outcome: a wall can be turned into a gap and a gap back into a wall, without deleting and redrawing.
- Files: `src/editor/panels.ts`, `src/editor/ops.ts`, `tests/editor/editor.spec.ts`.
- Interface: `ops.ts` gains `wallToOpening(f, i)` and `openingToWall(f, i, kind: WallKind)`, both pure, both keeping `a` and `b` and taking a fresh id from `newId`. The free wall panel's kind select gains a sixth entry "Opening (a gap in the wall)" with the value `opening`; choosing it runs `wallToOpening` and selects the new opening. The opening panel gains the same select, showing "Opening" plus the five wall kinds; choosing a wall kind runs `openingToWall` and selects the new wall. Each is one undo step. A room edge's select (S1.18) does not offer it: a gap in a room edge is an `openings` entry laid over it.
- Test: Playwright: select a free wall, choose Opening, `floor.walls` shrinks by one and `floor.openings` grows by one with the same ends; the opening panel then shows; choose "External wall" and it is a wall again with kind `external`; Undo twice returns to the first wall with its first kind.
- Done when: tests pass.
- Break it: converting a wall of zero length is refused with a status line, not written.

### S1.20 A new item lands outside the house (done)
- Outcome: anything added lands top right of the plan, clear of what is drawn, and the view scrolls to it.
- Files: `src/editor/ops.ts`, `src/editor/editor-app.ts`, `tests/editor/ops.test.ts` (new), `tests/editor/editor.spec.ts`.
- Interface: `ops.ts` gains `spawnPoint(f: Floor, fallback: Pt): Pt` — with an outline of three points or more, `[maxX + 150, minY]` of its bounding box, rounded to the 5 cm grid; otherwise `fallback`. `editor-app.ts` replaces `this.centre()` with `spawnPoint(this.st.f, this.centre())` in `addWall`, `addStructure`, `addArea`, `addStairs` and `addFurniture`, and in `placeDevice` when the catalog entry's room is not on the floor. `addDoor` and `addOpeningGap` keep `centre()` and the nearest-edge rule. After any of these, `ensureVisible(...pts: Pt[])` brings the whole new shape into view with a 100 cm margin: it pans by the least amount and zooms out only when the shape does not fit.
- Test: unit: `spawnPoint` on a fixture outline returns the point right of its bounding box and on the grid, and returns the fallback for an empty outline; Playwright: Add, Structure on the demo ground floor puts every point of the new structure outside the outline's bounding box, and the structure is inside the view box afterwards.
- Done when: tests pass.
- Break it: with the view scrolled far from the house, the added item is still outside the house and still comes into view.

### S1.21 Draw is its own menu (done)
- Outcome: the toolbar has Add and Draw side by side; Add places finished items, Draw takes clicks.
- Files: `src/editor/editor-app.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: toolbar order: floor chips, "+", filter, Names, Add, Draw, Device, View, File. `<details class="menu" id="mDraw">` holds the eleven Draw items that Add held (`#drawRoom`, `#drawZone`, `#drawWater`, `#drawOutline`, `#drawWall-<kind>` for the five, `#drawOpening`, `#drawExtra`), with the same ids and the same handlers; Add keeps Door, Window, Opening, Structure, Zone, Stairs and the furniture select, loses Water (a room kind: draw it or change a room's kind) and replaces the single `#addWall` with one button per kind, `#addWall-<kind>`, each placing a 200 cm wall of that kind at the spawn point. The Draw group heading and separator leave Add.
- Test: Playwright: the Add menu has no `#drawRoom` and no `#addWater`; the Draw menu has all eleven; `#addWall-fence` adds a wall with kind `fence`; opening Draw closes Add.
- Done when: tests pass; SPEC's editor section lists both menus.
- Break it: a Draw item chosen while another Draw is already running starts the new one and writes nothing from the old, as it did in Add.

### S1.22 Everything drags by its body (done)
- Outcome: any room, zone, water, structure or stairs moves when dragged by its middle, not only a structure.
- Files: `src/editor/editor-app.ts`, `tests/editor/editor.spec.ts`.
- Interface: in `onDown`, `case "room"` starts the existing `room` drag for every kind, not only `structure`; `case "stairs"` starts the same drag against `f.stairs[i].pts`. The `Drag` type's `room` case gains `list: "rooms" | "stairs"`. Dragging by the body never drags a neighbour's corner along (it is the whole polygon that moves). On drop, a room (not a zone, not stairs) is translated by the one corner-pair offset (own corner to another polygon's corner) that is smallest within the snap radius, 14 px in cm, then each of its corners is stitched. Alt drops it as it is. A room dragged away and back to within a few cm returns to its exact points and shares its edges again. A press on a body still selects it first, so a drag that does not move leaves the selection and no undo step. Panning by pressing a room body is gone; the hint already names the three ways to pan, and it gains "Drag a room, zone or stairs by the middle to move it."
- Test: Playwright: drag the demo's water pond 60 px, every point moves by the same amount and no wall gains a point; drag the demo's stairs the same way; press a room and release without moving, no undo step is recorded.
- Done when: tests pass.
- Break it: dragging a room whose corner sits on another room's corner moves only the dragged room, and the other room keeps its corner where it was.

### S1.23 Rotate a device, a wall, a door or an opening (done)
- Outcome: the things that are not polygons can be turned from their panel.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/render.ts`, `src/editor/ops.ts`, `src/editor/panels.ts`, `tests/core/{schema,render}.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: `Device` gains `rot?: number`; `validate` requires a finite number in `[0, 360)` when present; `migrate` passes it through. `renderFloor` turns a device's group by `rot` about its centre, and then turns the icon back so the glyph stays upright: only the cone of S1.31 and anything else drawn in the group's frame turns. `ops.ts` gains `rotateSegment(a, b, deg): { a, b }`, which turns a segment about its midpoint and rounds to 1 cm. The device panel gains a rotation field (`#vrot`, degrees, stored as `((n % 360) + 360) % 360`, the key deleted at 0); the wall, door and opening panels gain an angle field (`#wrot`, `#drot`, `#orot`) that sets the segment's angle through `rotateSegment`. Furniture already has one and is not touched.
- Test: `validate` rejects `rot: 400` and `rot: "90"`; a render fixture with `rot: 90` has that rotation on the device group and the reverse on the icon; Playwright: set a door's angle to 90 and its ends swap axis around the same midpoint.
- Done when: tests pass.
- Break it: a device with `rot: 0` renders byte-identical to one with no `rot` at all, so the demo snapshot does not change.

### S1.24 Unsnap a room, then rotate it (done)
- Outcome: a room or zone that shares no corner can be rotated; one that does must be unsnapped first.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/geometry.ts`, `src/editor/panels.ts`, `tests/core/{schema,geometry}.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: `Room` gains `free?: boolean`; `validate` requires a boolean when present; `migrate` passes it through. `geometry.ts`: `isFree(P)` joins `isZone(P)` everywhere a zone is excluded — `snapPoint` corner and T targets, `stitch`, `mergeCorners` and the `movePoints` grouping — so a free room neither attracts nor follows. New `snapped(f, poly): boolean`: true when any corner of that polygon is within 2 cm of a corner of another polygon that is not itself free. New `rotatePoly(f, poly, deg): Floor`, which turns the polygon about the centre of its own bounding box and rounds to 1 cm. The room panel shows, for a room or zone: a rotation field `#rrot` (degrees, applied as a delta through `rotatePoly`, one undo step) enabled when `free` or when `snapped` is false, and a button `#runsnap` "Unsnap" / "Snap back" that toggles `free`, with the hint "Unsnapped: this room no longer joins its neighbours."
- Test: `snapped` is true for two demo rooms that share a wall and false for the pond; `rotatePoly` by 90 on a square gives the square back with its corners in the new order; a free room is no longer a `snapPoint` corner target; Playwright: the rotation field of a shared room is disabled, Unsnap enables it, rotating by 30 changes the points, Undo restores them.
- Done when: tests pass.
- Break it: unsnapping a room does not move it by one centimetre, and its neighbour's corners stay where they are.

### S1.25 Stairs are straight or round, and striped (done)
- Outcome: stairs look like stairs: treads across a straight flight, spokes in a round one, with a rotation.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/render.ts`, `src/editor/ops.ts`, `src/editor/panels.ts`, `tests/core/{schema,migrate,render}.test.ts`, `tests/editor/editor.spec.ts`, `demo/layout.json`, `demo/layout.v1.json`, `docs/SPEC.md`.
- Interface: `Stairs` gains `shape: "straight" | "round"`, `steps: number` and `rot: number`, plus `dia?: number` (outer diameter) and `inner?: number` (inner diameter, the empty stairwell) for a round one. `STAIR_SHAPES` is exported next to the other enum lists. `validate`: `shape` in the list, `steps` an integer in `[2, 40]`, `rot` a finite number in `[0, 360)`, `dia` a finite number of at least 40 when `shape` is `round` and absent otherwise; `inner` a finite number in `[0, dia - 40]` on a round stair, absent on a straight one. `migrate` fills `shape: "straight"`, `steps: 12`, `rot: 0` on stairs that have none; a round stair without `inner` gets 0. `renderFloor` wraps each stairs polygon and its new treads in `<g data-s="<i>" transform="rotate(<rot> cx cy)">` about the polygon's bounding-box centre, and draws `steps - 1` tread lines with class `tread`: for `straight`, parallel lines across the shorter axis of the bounding box; for `round`, spokes from the inner rim to the outer rim, and the inner circle drawn as a hole (one path, `fill-rule: evenodd`, so the floor shows through the well). New variable `--fp-tread` (#8b8578, 1.5 wide). `ops.ts` `stairsAt` keeps its 100 × 300 cm flight and adds the new fields; a new `roundStairs(c, dia, inner)` returns the 24-gon of the outer circle with `shape: "round"` and `inner` (default 0.3 of `dia`, rounded). The stairs panel gains: shape select `#ss`, steps `#sst`, rotation `#srot`, outer diameter `#sdia` and inner diameter `#sinner`, both shown only for a round one (changing the outer regenerates `pts`; the inner is clamped to `dia - 40`). A round stair, and any stair with `rot` other than 0, draws no corner handles: `renderFloor` skips them and the editor's overlay does too. The demo keeps its straight stairs and gains nothing.
- Test: `validate` rejects `steps: 1`, `steps: 3.5`, a `dia` on a straight stair and a missing `dia` on a round one; `migrate` fills the three defaults and a second run changes nothing; a render fixture of a 12-step straight stair has 11 `line.tread` inside the stairs group and a round one has 11 spokes; a round fixture with `inner: 60` renders the hole (evenodd path) and its spokes start at radius 30; Playwright: Add, Stairs, switch the shape to round, set the diameter to 200 and the inner to 80, `pts` has 24 points on the outer circle, `inner` is 80, and no corner handle is drawn.
- Done when: tests pass; the demo snapshot is updated with the tread lines; SPEC lists the fields.
- Break it: setting the rotation of a straight stair back to 0 brings the corner handles back and they sit on the drawn corners.

### S1.26 Stairs go on every floor (done)
- Outcome: stairs added once stand in the same place on every floor.
- Files: `src/editor/state.ts`, `src/editor/editor-app.ts`, `tests/editor/state.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: `EditorState.addStairsEverywhere(t: { name; pts; shape; steps; rot; dia?; inner? }): void` snapshots the whole layout once, then pushes a copy into every floor with an id from `newId(floor, key, "stairs")` per floor, and selects the one on the current floor. `editor-app.ts` `addStairs` calls it instead of `commit`. Delete stays per floor: removing stairs removes them from the current floor only, and the stairs panel says so ("Stairs are added to every floor and deleted from one.").
- Test: state test: three floors, `addStairsEverywhere` leaves one stairs on each with the same `pts` and different ids, one undo step, and Undo removes all three; Playwright: Add, Stairs on the demo, switch to the first floor, the stairs are there at the same coordinates; delete them there and the ground floor still has its own.
- Done when: tests pass.
- Break it: a floor that already has stairs gets the new ones too, rather than being skipped: two flights are legitimate.

### S1.27 A new floor inherits the outline and the stairs (done)
- Outcome: adding a floor does not mean tracing the perimeter again.
- Files: `src/editor/state.ts`, `src/editor/panels.ts`, `tests/editor/state.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: `EditorState.addFloor(title)` copies `outline` and `stairs` (deep copies, ids from `newId` against the new floor) from the *first* floor in the key order, which is the lowest; every other array stays empty. When the first floor has no outline, the new floor has none. The floor panel's hint says where the outline came from, and Delete floor is how the user starts a clean one.
- Test: state test: a layout whose ground floor has an outline of four points and one stairs; `addFloor("Attic")` gives the attic the same four points and one stairs with a different id and no rooms; adding a second floor still copies from the ground floor, not from the attic; one undo step.
- Done when: tests pass.
- Break it: a floor added when the only floor is empty is empty too, and nothing throws.

### S1.28 Red and orange buttons (done)
- Outcome: what a button destroys is visible before it is pressed.
- Files: `src/editor/editor-app.ts`, `src/editor/panels.ts`, `tests/editor/editor.spec.ts`.
- Interface: two classes in the editor's own styles: `.btn.danger` (background `--fp-motion`, text `--fp-bg`) and `.btn.warn` (background `--fp-open`, text `--fp-bg`). `danger` goes on `#reset`, `#fdel` and `#fdelyes` only. `warn` goes on every other delete: `#delv`, `#wdel`, `#deld`, `#odel`, `#rdel`, `#vdel`, `#fdel` of the furniture panel (renamed `#fudel`, because the floor panel already owns `#fdel`) and `#sdel`. No colour literal: both classes use the existing variables.
- Test: Playwright: `#reset` and `#fdel` carry class `danger`, the selection panels' delete buttons carry `warn`, and the furniture delete button answers to `#fudel`.
- Done when: tests pass; no other test still selects `#fdel` for furniture.
- Break it: the two `#fdel` ids no longer collide: the floor panel and the furniture panel can be open in turn without either button changing meaning.

### S1.29 The device icon sits on top, in a grey circle (done)
- Outcome: no name, wall or furniture hides a device icon, and every icon has the same backing circle.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`.
- Interface: the paint order of `renderFloor` ends with room names and *then* devices, so a device group is the last element of the plan. The circle behind each icon becomes `<circle class="halo" cx="12" cy="12" r="13"/>` with `.dev .halo{fill:var(--fp-halo);fill-opacity:var(--fp-alpha)}` (`--fp-alpha` is .25, one value shared by the halo, the camera cone and the S2.8 aura; it was .5, see DECISIONS) and `--fp-halo` (#8b8578, grey) in `FLOORPLAN_CSS`; the `fill` and `fill-opacity` attributes leave the markup, so Sprint 2 can colour the halo from state with one CSS rule. Nothing else about the group changes: the class list, the title and the hit target `g[data-x]` stay.
- Test: the render snapshot shows every `g[data-x]` after the last `text.lbl` of a room; a fixture with a device inside a named room asserts the order by index; the markup has no `fill-opacity` literal on the halo.
- Done when: tests pass; the demo snapshot is updated; the editor's hit testing is unchanged (`tests/editor/editor.spec.ts` still green).
- Break it: a device whose centre is exactly the centre of a room label is still the top element at that point (`elementFromPoint` returns the device group).

### S1.30 A colour for every device type (done)
- Outcome: the palette every device colour comes from, and the types `tv`, `computer` and `ac`.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/icons.ts`, `src/core/render.ts`, `src/editor/panels.ts`, `tests/core/{schema,icons,render}.test.ts`, `docs/SPEC.md`.
- Interface: `DeviceType` gains `"ac" | "tv" | "computer"`, in `DEVICE_TYPES` after `climate`. `DEVICE_ICONS` gains their MDI paths (`air-conditioner`, `television-classic`, `desktop-tower-monitor`) and `TYPE_LABELS` their labels (Air conditioning / heat pump, TV, Computers). `FLOORPLAN_CSS` gains one variable per type that has a colour of its own: `--fp-dev-light` (#e0a800), `--fp-dev-motion` and `--fp-dev-contact` (#d64545), `--fp-dev-heater` and `--fp-dev-climate` (#e8801a), `--fp-dev-ac-cool` (#2c7fb8), `--fp-dev-ac-heat` (#e8801a), `--fp-dev-tv`, `--fp-dev-plug` and `--fp-dev-computer` (#2c7fb8), `--fp-dev-camera` (#4a4a48), `--fp-dev-garden` (#3f8f4f); switch, humidity and anything else keep `--fp-idle`; plug and computer are grey when off, blue when on. Sprint 1.6 uses only the ones that do not need a state: `.dev-camera path{fill:var(--fp-dev-camera)}` and a sensor inside a room of kind `garden` gets the class `outdoor` from `renderFloor` (point in polygon of its centre, the rooms it already walks) with `.dev.outdoor path{fill:var(--fp-dev-garden)}`. The card applies the rest in S2.9. `migrate` needs no rule: the three types are new names, and an unknown type is already left alone for `validate` to report.
- Test: `validate` accepts the three and still rejects `"fridge"`; `DEVICE_ICONS` has a path starting with `M` for every member of `DEVICE_TYPES` (the existing icons test enumerates them, so it must be extended); a render fixture with a temp sensor inside a garden room has class `outdoor` on it and one inside a normal room does not.
- Done when: tests pass; SPEC's device type list and behaviours table match.
- Break it: a device standing in a garden room *and* a zone on top of it is still `outdoor`, and a device in no room at all gets no class and does not throw.

### S1.31 A camera shows what it sees (done)
- Outcome: a camera draws a 120 degree cone in dark grey at 25 % alpha, turned by its `rot`.
- Files: `src/core/render.ts`, `src/editor/panels.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: for a device of type `camera`, `renderFloor` draws, before the icon and inside the device's group so it turns with `rot`, `<path class="cone" d="M0 0 L… A…"/>`: a 120 degree sector of radius 100 cm (was 300, see DECISIONS), centred on the device, pointing along `rot` (0 is up, degrees clockwise, as everywhere else). `.cone{fill:var(--fp-dev-camera);fill-opacity:var(--fp-alpha);pointer-events:none}` (`--fp-alpha` .25, shared with the halo; it was .33, see DECISIONS). The cone is drawn in plan units, not in the icon's screen-size frame, so it keeps its size in centimetres as the user zooms. The device panel shows the rotation field of S1.23 for every device and adds, for a camera, the hint "The cone shows a 120 degree field of view, 1 m deep."
- Test: a render fixture with a camera at `rot: 90` has one `path.cone` whose first point is the camera's centre and whose sector spans 120 degrees about the +x axis; a camera with no `rot` points up; no other device type emits a cone.
- Done when: tests pass; the demo snapshot gains the cone of the demo hall camera.
- Break it: the cone does not catch the pointer: a click in the middle of a cone that lies over a room selects the room, not the camera.

### S1.32 One wall switch, several lamps (done)
- Outcome: two or more lights can name the same wall switch, and that switch can still be an icon of its own.
- Files: `src/core/schema.ts`, `src/core/bind.ts`, `src/editor/state.ts`, `tests/core/{schema,bind}.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `validate` drops two rules — "bound is used by more than one device" and "bound is also the entity of another device" — and keeps the rest: `bound` is an entity id, only on a light, different from that light's `entity`. `bind.ts` `placedEntities` no longer adds `bound`, so a switch that some light names is still offered in the Device menu and can be placed as its own grey icon; `unplacedCatalog` follows. `EditorState.bindChoices` offers every switch and plug in the catalog except the light's own entity, whether or not it is placed or already bound elsewhere; the current one always shows. `renderFloor` is unchanged: a light is on when its own entity or its `bound` is on, and the switch's own icon reads its own state.
- Test: `validate` accepts a fixture where two lights share `switch.hall` and that switch is also a placed device; `unplacedCatalog` lists a bound switch that is not placed; Playwright: bind two demo lights to the hall switch, then place the hall switch from the Device menu and both lights and the switch are on the plan.
- Done when: tests pass; the SPEC bullet on `bound` matches; the CLAUDE.md domain note on `bound` is updated in the same commit.
- Break it: a light bound to its own entity is still refused by `validate`.

### S1.33 Rotate the whole plan (done)
- Outcome: View, Rotate turns every floor in 45 degree steps so the plan lines up with north, and the card shows the same.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/render.ts`, `src/editor/editor-app.ts`, `src/editor/state.ts`, `tests/core/{schema,migrate,render}.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `Layout` gains `rotate?: number`; `validate` requires a multiple of 45 in `[0, 360)`; `migrate` fills 0. New `planPivot(l: Layout): Pt` in `render.ts`: the centre of the bounding box of every floor's outline together, so all floors turn about one point; with no outline anywhere, `[0, 0]`. `RenderOpts` gains `rotate?: { deg: number; pivot: Pt }`; when `deg` is not 0, `renderFloor` wraps its whole output in `<g transform="rotate(<deg> <px> <py>)">` and gives every `text` and every device group an extra `rotate(<-deg> <x> <y>)` about its own anchor, so names, values and icons stay upright while the drawing turns. `viewBoxFor(f, pad, rotate?)` fits the rotated outline. The editor: `View` gains "Rotate the plan" with two buttons, `#rotl` and `#rotr`, stepping `layout.rotate` by ∓45 as one undo step, and a reading of the current angle; `toSvg` un-rotates the pointer about the pivot, which is the one place plan coordinates are made, so hit testing, snapping and drag need no other change. The card passes the same `rotate` in S2.1 and needs nothing else.
- Test: `validate` rejects 30 and 360 and accepts 0 and 315; a render fixture at 90 has the group transform and the counter-rotation on a room name; `viewBoxFor` at 90 on a wide outline returns a tall box; Playwright: rotate the demo right twice, a corner that was top left is dragged by its handle and lands where the pointer is (the un-rotation is exercised), and the stored coordinates are unchanged after a rotate right and a rotate left.
- Done when: tests pass; the demo snapshot at rotate 0 is unchanged.
- Break it: rotating twice and back leaves `layout.rotate` at 0 and every coordinate byte-identical, so the rotation is never written into the data.

---

### S1.34 The grid is a setting (done)
- Outcome: the snap grid is none, 5, 10 or 50 cm, default 10, chosen in the View menu.
- Files: `src/editor/state.ts`, `src/editor/editor-app.ts`, `src/editor/ops.ts`, `tests/editor/editor.spec.ts`, `tests/editor/state.test.ts`.
- Interface: `EditorState.snapGrid: 0 | 5 | 10 | 50` replaces the boolean (0 = none), default 10. Every place that reads the boolean or the literal 5 (`snapCorner`, the drag rounding `g5` and the device, door and room drags, the `ops.ts` helpers that place new items on the grid) reads the one number. The chip "Snap 5 cm" becomes a View menu group "Grid" with four items, the current one pressed. The choice is kept in `localStorage` under its own key, wrapped in try/catch, and is not part of the layout. Alt still disables the grid for one gesture.
- Test: state test that each of the four values rounds a drag to its multiple and 0 leaves the point free; Playwright: with 10 selected a corner dragged by a few pixels lands on a multiple of 10, with 50 on a multiple of 50, with none anywhere; reload keeps the choice. Existing tests that assumed 5 are updated and say why.
- Done when: tests pass; SPEC editor section names the four values and the default.
- Break it: a stored value of 7 or "x" falls back to 10 without throwing; storage blocked still works.

### S1.35 Floor colours for rooms (done)
- Outcome: the room panel offers twelve floor colours as swatches.
- Files: `src/core/schema.ts`, `src/editor/panels.ts`, `tests/editor/editor.spec.ts`.
- Interface: `FLOOR_COLOURS: { name: string; hex: string }[]` exported from `src/core/schema.ts`, in this order: White ceramic #f4f4f0, Marble #e2dfda, Sand #e6d5b8, Terracotta #c98a63, Light oak #d8bd94, Warm wood #b98b5c, Dark oak #86643f, Walnut #5b4130, Light grey #b4b6b8, Grey floor #8b8e91, Belgian stone #4d4e50, Lava #38393b. The room panel shows them as twelve buttons `.sw` (title and aria-label are the name, the pressed one is marked) next to the free colour input `#rcol` from S1.16 (the input stays). There is no `dark` class and no light label colour: a dark floor keeps its label readable through the white text outline of S1.46, and its walls through the white edge outline of S1.35b (see DECISIONS, 2026-09-20 "S1.35: swatches only").
- Test: Playwright: click the Belgian stone swatch, the polygon's computed fill is `rgb(77, 78, 80)` and the swatch is marked pressed; click the default button and the fill is back.
- Done when: tests pass; the twelve are in SPEC.
- Break it: a colour that is not in the list (typed in the free input) still works and no swatch is pressed.

### S1.35b Walls and edges keep a white outline (done)
- Outcome: a dark wall or edge line stays visible on a dark floor (Lava, Belgian stone).
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: `--fp-outline` (#ffffff) in `FLOORPLAN_CSS`. `renderFloor` writes, before every room edge and free wall, a twin `<line class="eh <kind classes>">` with the same ends and no `data-e`; all twins come first, then the edges, so a twin never covers a neighbour's edge. `.eh{stroke:var(--fp-outline);stroke-linecap:round;pointer-events:none}` is 2 user units wider than the edge it backs (each kind has its own rule). It is the line version of the text outline: same colour, drawn behind. The stairs edges have none.
- Test: render fixture: one `line.eh` per room edge and free wall, each before every `line.e`; Chromium: on a Lava room the twin's computed stroke is `rgb(255, 255, 255)` and its stroke-width is greater than that of its edge, and a click on the edge still selects the edge, not the twin.
- Done when: tests pass; the demo snapshot is updated.
- Break it: the twin never catches the pointer (a click on the wall selects the wall).

### S1.36 Device colours by type (done)
- Outcome: one colour per device type, changeable for the whole group at once, stored with the layout so the editor and the card agree.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/render.ts`, `src/editor/editor-app.ts`, `src/editor/panels.ts`, `tests/core/{schema,render}.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `Layout` gains `colors?: Partial<Record<DeviceType, string>>`. `validate`: keys must be device types, values `#rrggbb`. `migrate` passes it through, never invents it. `renderFloor` sets `--fp-dev-<type>` on the root svg style from `layout.colors` (else the defaults of S1.30), so the palette CSS and the card's on-colour of S2.9 both follow it. View menu, "Device colours": a panel with one row per type (label, `<input type="color">`, reset) and "Reset all". One undo step per change, in the layout so it is saved.
- Test: `validate` rejects `{ light: "red" }` and `{ fridge: "#aabbcc" }`; a render fixture with `colors.light` puts that value in the svg style; Playwright: change the light colour, every light icon's computed fill changes, undo restores, Save then Open keeps it.
- Done when: tests pass; SPEC schema and editor sections list `colors`.
- Break it: a layout with no `colors` renders exactly as before (snapshot unchanged).

---

Diego, on names:

> also for the floor name, room name, zone name, pick from a dropdown populated
> with the values from HA. we are mapping not inventing. then for custom stuff
> we can add the plan name which matches the planimetry.
>
> yes. no custom names for things that are connected to HA. HA is
> authoritative. custom things can be deployed and named and also have a
> dropdown to attach them to an HA entity.

A floor links to an HA floor and takes its title from HA. A room or a zone
links to an HA area through the `area` id it already has, and takes its name
from HA. A custom thing — a pond, a pavement, a structure, a piece of
furniture, a zone with no area — keeps a plan name and may name one HA entity,
so the card can show that entity's state on it. Standalone, with no HA data,
every field is free text, as today. Old files keep working and nothing is
renamed behind the user's back. Schema stays version 2; every new field is
optional and `migrate` never invents one. S1.37 to S1.39 do this; S1.40 to
S1.42 are three defects the verifiers found.

### S1.37 A floor, a room and a zone can point at Home Assistant (done)
- Outcome: the layout can say which HA floor a floor is, which HA area a room or zone is, and which HA entity a custom shape shows; the stored name is the last name HA gave, so a plan never renders blank.
- Files: `src/core/schema.ts`, `src/core/ha.ts`, `src/core/index.ts`, `src/core/migrate.ts`, `tests/core/{schema,migrate,ha}.test.ts`, `docs/SPEC.md`.
- Interface: `Floor` gains `ha?: string`, the HA floor id (`room.area` already holds the HA area id, so no new field there). `Room` gains `entity?: string` and `Furniture` gains `name?: string` and `entity?: string`. `validate`: `ha` must be a non-empty string; `entity` must be an entity id like `sensor.pond`; `furniture.name` must be text. No rule looks anything up: `validate` stays offline and knows nothing of HA. `migrate` passes all four through unchanged and adds none of them; a v1 or older v2 file has none and stays valid. New file `src/core/ha.ts`, exported from `src/core/index.ts`, holds the data the host hands the editor and the card, and one pure function:
  ```ts
  export interface HaData { floors: { id: string; name: string }[]; areas: { id: string; name: string; floor_id?: string }[]; entities: { id: string; name: string; domain: string }[] }
  /** Copies the layout with every linked name refreshed from HA. Unlinked and unknown links are untouched. */
  export function applyHaNames(l: Layout, ha: HaData): { layout: Layout; changed: number };
  ```
  `applyHaNames` sets `floor.title` to the name of `ha.floors` entry `floor.ha`, and `room.name` to the name of the `ha.areas` entry `room.area`, when the id is there and the name differs; `changed` counts those. A floor with no `ha`, a room with an empty or unknown `area`, and every other field are left exactly as they were. The input is never mutated. `renderFloor` is not touched: it draws `floor.title` and `room.name`, which is why the name is stored and not looked up at draw time. That is what makes the card correct before `hass` has loaded and offline.
- Test: `validate` accepts a floor with `ha: "downstairs"`, a room with `entity: "sensor.pond"` and furniture with a name, and rejects `ha: ""`, `entity: "pond"` and a numeric furniture name; `migrate` on a v1 file gives no `ha` and no `entity`, and on a v2 file with all four keeps every one byte for byte; `applyHaNames` renames a linked floor and a linked room, counts 2, leaves an unknown area id and its name alone, returns `changed: 0` for a layout with no links, and does not change the object passed in (deep-equal check against a clone).
- Done when: tests pass; `npm run lint` clean; SPEC's schema block lists `ha`, `room.entity`, `furniture.name` and `furniture.entity`.
- Break it: `applyHaNames` on a layout whose room names are already the HA names reports `changed: 0` and returns a layout deep-equal to the input, so opening a plan twice writes nothing.

### S1.38 The editor picks names from Home Assistant (done)
- Outcome: with HA data present the floor title, the room name and the zone name are dropdowns of what HA has; a shape with no area keeps a free plan name and may point at one entity.
- Files: `src/editor/editor-app.ts`, `src/editor/panels.ts`, `src/editor/state.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `<floorplan-studio-editor>` gains the property `ha: HaData | undefined` (from `src/core/ha.ts`), set by the host — the HA panel in S3.3, nothing standalone — and passed on through `EditorState.ha` and so to every panel. With `ha` undefined every field stays the text input it is today. With `ha` set:
  - Floor panel: the title input is replaced by `#fha`, a select of "(not linked)" plus every `ha.floors` name, sorted by name. Choosing a floor sets `f.ha` and `f.title` to that name in one undo step. "(not linked)" deletes `f.ha` and leaves the title as it stands, and the `#ft` text input comes back under it, so a floor HA does not know can still be named.
  - Room panel, every kind: the `name` and `area id` inputs are replaced by `#ra`, a select of "(no area — custom)" plus every `ha.areas` name, sorted by name, with the areas already used by another room on any floor gathered in an `<optgroup label="Already on the plan">` and still selectable. Choosing an area sets `room.area` to its id, `room.name` to its name, and deletes `room.entity`, in one undo step; if that area is used by another room the status line says "<Name> is already on the plan". "(no area — custom)" deletes `room.area` content (sets it to `""`) and brings back `#rn`, the free "plan name", together with `#rent`.
  - `#rent`, "shows the state of": shown only for a room with no area. A select of "(none)" plus every `ha.entities` entry, grouped by domain with `<optgroup>`, sorted by name inside each. It writes `room.entity`, deleting the key for "(none)".
  - The furniture panel gains the same pair: `#fun` (plan name, free text, always) and `#fuent` (the entity select, the same list).
  - An id stored in the layout that HA does not have keeps its own option at the end of the select, selected, labelled `<id> (not in Home Assistant)`, with the hint "Home Assistant does not have this one. Pick another, or leave it." Nothing is cleared and nothing is renamed.
  - `plan label` is unchanged for every room: it is the planimetry's own mark, not a name.
- Test: Playwright, injecting `el.ha = { floors: [...], areas: [...], entities: [...] }` with `page.evaluate` next to the existing `el.layout` injection, one fixture with two floors, four areas and three entities: with `ha` unset `#rn` is a text input and `#ra` is a text input; with `ha` set `#ra` is a `select`, choosing "Kitchen" writes the id into `room.area` and "Kitchen" into `room.name`, one undo restores both; choosing an area another room already has puts it under the optgroup and writes the status line; "(no area — custom)" brings back `#rn`, typing in it writes `room.name` and leaves `area` empty, and `#rent` then appears and writes `room.entity`; picking an area again removes `entity`; a room whose stored `area` is `bogus` shows the extra option and keeps `bogus` after a render.
- Done when: tests pass; `npm run lint` clean; SPEC's editor section describes the three dropdowns and the free-text fallback.
- Break it: with `ha` set to `{ floors: [], areas: [], entities: [] }` the selects show only their "(none)" entries, nothing throws, and no name in the layout changes.

### S1.39 An old plan meets Home Assistant without being renamed (done)
- Outcome: opening an old plan in HA offers the obvious links and refreshes the names of the ones that exist, and says so; it never renames on its own.
- Files: `src/editor/editor-app.ts`, `src/editor/panels.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: when `ha` is set (and again whenever it is set anew), the editor runs `applyHaNames` (S1.37) on the layout. The result replaces the layout without an undo step — it is part of loading, not an edit — and the status line says "<n> names updated from Home Assistant" when `changed` is not 0, and nothing when it is 0. Only a linked floor or room is touched: a room whose `area` is empty or unknown to HA keeps its name whatever it says. For such a room, the room panel shows, above the area select, `#rmatch`: "Link to the Home Assistant area <Name>", when exactly one `ha.areas` name equals `room.name` ignoring case and outer spaces. One click does what choosing that area in the select does, as one undo step. No match, or more than one, shows no button.
- Test: Playwright: load a plan whose room `area` is `kitchen` and whose name is "Old kitchen", set `ha` with an area `kitchen` named "Kitchen"; the name becomes "Kitchen", the status line says "1 names updated from Home Assistant", and File, Undo does not bring "Old kitchen" back (it is not an undo step); a room with `area: ""` named "living" and an HA area "Living" shows `#rmatch`, keeps its name until the button is clicked, and after the click has the id, the HA name and one undo step; two HA areas both named "Living" show no button.
- Done when: tests pass; `npm run lint` clean; SPEC's editor section says the refresh happens on load, is announced, and is not undoable.
- Break it: with no HA data the same plan opens with every name exactly as stored and no status message.

### S1.40 Every coloured button is readable (done)
- Outcome: the text on the red, orange and blue buttons passes WCAG AA (4.5:1) in the editor.
- Files: `src/core/render.ts` (the variables in `FLOORPLAN_CSS`), `src/editor/editor-app.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: the verifier measured 2.16:1 on `.btn.warn` (light text on `--fp-open` #f28c28), 3.85:1 on `.btn.danger` (light text on `--fp-motion` #d64545) and 3.82:1 on `.btn.primary` (light text on `--fp-window` #2c7fb8). The button colours stop borrowing the plan's colours and get three of their own in `FLOORPLAN_CSS`: `--fp-warn:#f28c28`, `--fp-danger:#b02a2a`, `--fp-primary:#1f6699`. `.btn.warn` takes dark text (`--fp-ink`, 5.9:1 on that orange), `.btn.danger` and `.btn.primary` keep light text (`--fp-bg`, 6.6:1 and 5.4:1). Background and border use the new variable, so S4.8's theme map covers them and the door and motion colours on the plan stay free to change.
- Test: Playwright: for `#reset` (danger), `#rdel` (warn) and `#save` (primary), read the computed `background-color` and `color` in Chromium, compute the WCAG contrast ratio in the test, and assert it is at least 4.5; the helper that computes the ratio is checked against two known pairs (black on white 21, #767676 on white 4.54).
- Done when: tests pass; `npm run lint` clean; SPEC's editor line on coloured buttons says they meet AA.
- Break it: putting the old `--fp-open` value back as the danger background makes the test fail, not pass by rounding.

### S1.41 A rejected number goes back to what the state holds (done)
- Outcome: a numeric field that the editor refuses or clamps shows the value the layout actually has, not what was typed.
- Files: `src/editor/panels.ts`, `tests/editor/editor.spec.ts`.
- Interface: the verifier typed 1 and then 3.5 into the stairs `#sst` while the state held 12; the field kept the refused text. `number()` in `panels.ts` takes the panel context as its first argument, binds its value with lit's `live()` directive, and calls `c.refresh()` after every change, so the field is re-rendered from the state whether the handler committed or not. Every caller is updated; the fields that already use `live` by hand (`#rrot`) are left as they are.
- Test: Playwright: with stairs of 12 steps, type 3.5 into `#sst` and blur — the field reads 12 and `stairs.steps` is 12; type 60 — the field reads 12; type 20 — the field and the state read 20; type 1 into the furniture width `#fw`, which clamps at 5 — the field reads 5.
- Done when: tests pass; `npm run lint` clean.
- Break it: a value the editor accepts is not reverted: typing 20 into `#sst` leaves 20 on screen after the re-render, so the fix cannot be a blanket reset.

### S1.42 A device never hides a room name (done)
- Outcome: a room name pushed under a device icon moves out from under it, so the demo no longer reads "Li·ng" and "Kit·hen".
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: devices stay on top (S1.29); the name moves instead. In `renderFloor`, before a room's name is written, its box is `width = 0.6 * size * name.length`, `height = 1.2 * size`, its centre 0.35 * size above the text baseline (the SVG y is the baseline), where `size` is the font size already used (14 k for a room, 10 k for a zone). A device collides when its centre is within `13 * k + height / 2` vertically and `13 * k + width / 2` horizontally of the box centre; only devices the filter draws count. The name is then tried at `cy + 28 * k`, and if that collides too at `cy - 28 * k`, and if both collide it stays at `cy`: three candidates, no search. The `label` line keeps its 16 k gap below whichever the name took. Zone names follow the same rule with their own size.
- Test: render fixtures: a room with a device on its centroid draws the name at `cy + 28k`; devices on the centroid and 24 cm below it draw it at `cy - 28k`; devices on all three spots leave it at `cy`; a room with no device near the centre is byte-identical to today; a zone follows the same three steps. Playwright on the demo: the "Living" text box and every device halo circle on that floor do not overlap (bounding boxes read from the DOM).
- Done when: tests pass; `npm run lint` clean; the demo snapshot is updated and the diff shows only the moved names.
- Break it: a device that the type filter hides does not move a name; the name sits at the centroid again once it is filtered out.

### S1.49 A Re-center button (done)
- Outcome: one click in the View menu brings the whole floor back into view after zooming and panning: every room, device, stairs, wall and piece of furniture of the current floor, not only the outline that "Fit to window" uses.
- Files: `src/core/render.ts`, `src/editor/state.ts`, `src/editor/editor-app.ts`, `tests/core/render.test.ts`, `tests/editor/state.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `contentPoints(f: Floor): Pt[]` exported from `render.ts`: every point of the outline, rooms, stairs, walls, openings, extras, furniture and devices (a heater's two ends, other devices their centre). `EditorState.recenter()` sets the view of the current floor to the box round `contentPoints` with an 80 cm margin, in the turned frame when the plan is rotated, like `fit()`; it writes nothing to the layout and is no undo step. View menu button `#recenter` "Re-center", next to "Fit to window" (the editor has no zoom buttons, so no toolbar). Zoom and pan are lost by design.
- Test: unit: `contentPoints` includes a device and a room outside the outline, and the stairs corners; `recenter` gives a view that contains all of them, also at rotate 45; Playwright: wheel-zoom in, drag the background so the plan is off screen, click Re-center: the union of the rooms', devices' and stairs' screen boxes lies inside the svg's box, at rotate 0 and at 45; the layout is byte-identical and Undo stays disabled.
- Done when: tests pass; SPEC's View entry names it.
- Break it: a floor with nothing but an empty outline, or no outline at all, does not throw and shows a sensible box.

### S1.43 Rotation is buttons: 30, 45, 60, 90, reset (done)
- Outcome: no rotation textbox is left. Four buttons turn the selected thing by 30, 45, 60 or 90 degrees, in a direction the user picks, and Reset puts it back to 0.
- Files: `src/editor/panels.ts`, `src/editor/state.ts`, `src/editor/editor-app.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: one helper `rotateButtons(c, id, current, apply)` in `panels.ts`, used by stairs (`srot`), furniture (`fr`), devices and cameras (`vrot`) and rooms (`rrot`). It draws a row: a cw/ccw toggle (`#rdir`, `aria-pressed`, default cw, kept in `EditorState.turnDir` for the session) and the buttons `#rot30`, `#rot45`, `#rot60`, `#rot90` with an id prefix per panel (`srot30`, `frot30`, `vrot30`, `rrot30`). Pressing N sets `rot = (rot + dir * N) mod 360`, one commit. A `Reset` button (`<prefix>reset`) sets `rot` to 0 and, for a device, deletes the field. A room has no stored angle (`rotatePoly` moves its corners), so it gets the four buttons and the toggle but no Reset. Rooms stay rotatable only when unsnapped; the buttons are disabled and the hint stays as it is today. Walls, doors and openings keep their `angle (deg)` field: it is an absolute angle of a line, not a turn.
- Test: Playwright, real clicks: with stairs at rot 0 click 30 then 45: rot is 75; switch to ccw and click 90: rot is 345; Reset gives 0. Same for a furniture piece and a device (Reset deletes `rot`). A snapped room has the buttons disabled; after Unsnap, 90 turns its corners a quarter turn about the centre. No `input#srot`, `#fr`, `#vrot` or `#rrot` exists. One undo reverts one press.
- Done when: tests pass; `npm run lint` clean; SPEC's rotation lines describe the buttons.
- Break it: 360 wraps to a value below 360, and a press on a locked room changes nothing and adds no undo step.

### S1.44 Stair steps are computed from the length (done)
- Outcome: the step count is never typed. It is the run length divided by a 40 cm tread, rounded.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/render.ts`, `src/editor/ops.ts`, `src/editor/panels.ts`, `tests/core/*.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `stairSteps(t: Stairs): number` in `src/core/geometry.ts` or `ops.ts`, exported from core: for a straight run `max(2, round(length / 40))`, where length is the long side of the box (the direction the treads run along); for a round stair `max(2, round(pi * (outer + inner) / 2 / 40))` on the mean circumference. `steps` stays in the schema, so old files load, but it is derived: `migrate` recomputes it and ignores a stored value that disagrees, and every edit that changes the shape recomputes it. `renderFloor` draws `stairSteps(t)` treads. The editable `#sst` field goes; the panel shows `steps: N` as read only text (`#sstn`). `validate` still requires an integer from 2 to 40 and clamps nothing.
- Test: unit: a 300 cm run gives 8 (7.5 rounds up), 100 cm gives 3 (2.5 up), 60 cm gives 2 (floor of 2 holds); a round stair of outer 200 and inner 80 gives round(pi * 140 / 40) = 11; `migrate` on a file with `steps: 30` and a 300 cm run returns 8. Playwright: no `#sst` exists; stretching the run by a corner drag changes `#sstn` and the treads drawn.
- Done when: tests pass; SPEC states the 40 cm tread.
- Break it: a run of 10 cm gives 2, not 0 or 1; a stored `steps: 99` never reaches the renderer.

### S1.45 The icon circle is white and readable (done)
- Outcome: a device icon sits on a white disc, so a coloured glyph is readable on any floor colour.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: the `.halo` circle is white at 75 % alpha with a 1 px grey border (`--fp-halo`), radius 3 px larger than the icon (r=13 in the 24-unit icon box today, so the circle grows to r=16 in that box and the 1 px border is drawn in screen pixels with `vector-effect:non-scaling-stroke`). The camera cone and the active-colour tint keep `--fp-alpha` at .25; only the disc uses the new `--fp-disc-alpha:.75` and `--fp-disc:#fff`. Both are variables in `FLOORPLAN_CSS`. The S1.42 collision uses the new radius.
- Test: render: the CSS holds the three variables and `.halo` uses them; Playwright: computed `fill` of a halo is white, `fill-opacity` .75, `stroke` grey, `stroke-width` 1px; the camera cone `fill-opacity` is still .25; the disc radius on screen equals the icon size plus 3 px.
- Done when: tests pass; the S1.42 test still passes with the new radius.
- Break it: a device on a dark room colour still shows a white disc; setting `--fp-alpha` does not change the disc.

### S1.46 All text has a white outline (done)
- Outcome: every label is readable on any background: dark grey text with a white outline, never black, never a dark-background-only rule.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: one rule for `.lbl` and `.val` and every other SVG text: `fill:var(--fp-text)` with `--fp-text:#3a3a3a`, `paint-order:stroke`, `stroke:var(--fp-outline)`, `stroke-width:3`, `stroke-linejoin:round`. `--fp-outline` is the S1.35b variable, white. Any rule that adds the outline only on a dark floor, and any `fill` that is black or `--fp-ink` on a text element, is removed. Extras and stairs names use the same class.
- Test: Playwright: for each of a room name, a zone name, a device label, a temperature value and an extra's name, the computed `fill` is rgb(58, 58, 58), `stroke` is white, `paint-order` starts with `stroke`; unit: no `fill="var(--fp-idle)"` or dark-only outline rule is left in the CSS or the markup of text.
- Done when: tests pass; SPEC's text line says white outline, dark grey text.
- Break it: a room on the darkest room colour still has the white outline on its name.

### S1.47 A room edge can be deleted (done)
- Outcome: one side of a room can be taken away. The room stays closed for area and snapping; only the line is not drawn.
- Files: `src/core/schema.ts`, `src/core/render.ts`, `src/editor/ops.ts`, `src/editor/panels.ts`, `tests/core/*.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `WALL_KINDS` gains `"none"`. `renderFloor` skips a "none" edge and its white twin (S1.35b), and its hit line; the corner handles and the selection line stay so it can be picked again. The edge panel gets an orange `Delete` button (`#edel`, class `warn`) that calls `setEdgeKind(f, ref, "none")` for the edge and for the same edge in the neighbour room when they share it (`edgeRooms`). If a door or window lies on the edge, `#edel` asks first (`#edelyes`, `#edelno`, as the floor delete does). A "none" edge is listed in the kind select as `not drawn`, so it can be brought back. Area, centroid, snapping and `inside` ignore `wk`. A zone edge is `boundary` only (existing rule) and keeps it.
- Test: unit: `validate` accepts `none`; `renderFloor` output has one fewer edge line and one fewer twin; area unchanged. Playwright: click an edge, Delete: the line is gone, the neighbour's shared edge too, undo brings both back in one step; with a door on the edge the confirm shows and Cancel changes nothing.
- Done when: tests pass; SPEC lists `none`.
- Break it: deleting all four edges of a room leaves it selectable by its fill; a stored `none` in a zone is an error.

### S1.48 A closed loop of walls becomes a room (done)
- Outcome: drawing walls until the last point meets the first makes a room, zone or garden out of them, so the user does not draw the same shape twice.
- Files: `src/editor/ops.ts`, `src/editor/state.ts`, `src/editor/editor-app.ts`, `tests/editor/ops.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `closedLoop(f, wall): Pt[] | null` in `ops.ts` walks the drawn walls from the one just added and returns the ring of points when the last end is within the snap distance of the first start and the ring has three or more corners. The ring must pass through the first point of the chain just drawn (`closedLoop(f, wall, tol, through)`): a chain that comes back to an intermediate corner stays walls. The perimeter Outline is never part of a loop. On close, the editor removes those walls and adds one room in the same commit (undo removes the whole room in one step): kind `room` for wall or external walls, `zone` for dotted, `garden` for fence or edge; `wk` per edge takes the walls' kind (`boundary` for a zone). The new room has an empty `area`, is selected, and its name field is focused; it can be renamed and linked to an HA area like any room. The status line says `Room created from 4 walls`. The ring is at most 12 walls (`MAX_RING`). A chain that closes on its first corner with more walls stays walls, and the status says `13 walls, too many to make a room (max 12)`.
- Test: unit: four walls in a ring give one room with four points and matching `wk`; three walls that do not close give null; a ring through the outline does not convert. Playwright: draw four walls with real clicks, the last onto the first point: one room exists, no walls, it is selected, one undo removes the room, and no walls come back (the walls are only drawn on commit); dotted gives a zone, fence a garden.
- Done when: tests pass; SPEC's drawing section describes it.
- Break it: closing at 30 cm from the first point (outside the snap) does not convert; two rings sharing a wall make two rooms, not one.

### Sprint 1.6 closed, 2026-09-20

S1.14 to S1.49, 60 commits, merged into `main` and pushed. On `main` after the
merge: lint clean, 457 unit tests, 284 Playwright tests, build green.

Verify (Sonnet) and review (Opus) found seven defects the suites had missed:
the hatch lost to a `:not([fill])` rule, a rotation test flaked because
`onFocusOut` cleared a newer selection, a partly shared edge survived Delete,
a wall chain closing on an intermediate corner made a broken room, a ring of
more than twelve walls failed silently, a motion sensor that was on never
faded, and a drawn ring that swallowed a wall of another kind produced a
layout `validate` refuses. Each is now a test. The lessons are in
`docs/WORKFLOW.md` and `CLAUDE.md`.

Carried into Sprint 2: `layout.colors.ac` is stored but drives no state colour
yet (S2.10 decides), the S2.8 aura reads `--fp-alpha`, and S2.9 must add the
light-fill check that S1.36 could not make yet. Left open on purpose: the demo
"Garden" and "Garden pond" names overlap, furniture width has no upper bound,
and the turn-direction toggle states its direction in both its name and its
pressed state.

## Sprint 1.7 — measuring (E2)

### S1.50 A measure grid with metre markers (done)
- Outcome: the editor shows how big things are without measuring them one by one: a faint 50 cm grid behind the plan, with the metres numbered along the X and Y axes.
- Files: `src/editor/editor-app.ts`, `src/editor/state.ts`, `src/core/render.ts` (CSS only), `tests/editor/state.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: a private `measure(k: number): string` in `editor-app.ts` returns the grid as SVG and is placed **before** the `renderFloor` output, so the plan draws over it; when the plan is turned it goes inside the same `plan-turn` group, so the grid stays square with the walls and with the snap grid. Lines are at multiples of 50 cm of the layout's own coordinates (…, -50, 0, 50, …), covering `viewBoxFor(f)` plus its padding. Two classes in `FLOORPLAN_CSS`: `.mg{stroke:var(--fp-measure);stroke-width:.5;vector-effect:non-scaling-stroke}` and `.mg.m{stroke-width:1}` for the whole-metre lines, with `--fp-measure:#3a3a3a` at `stroke-opacity:.12` for 50 cm and `.22` for a metre. Numbers are drawn at every whole metre along the top edge and the left edge of that area, as `<text class="lbl mg-n" font-size="${10 * k}">`, the value in metres with no decimals (`-2`, `0`, `3`), kept upright under plan rotation with the same `upright()` helper the length labels use, and the origin label reads `0 m` so the unit is stated once. Step up when the plan is huge: if either axis would need more than 400 lines, use 100 cm, then 500 cm; the numbers follow the step. A `measure` boolean on `EditorState`, default true, is kept in `localStorage` under `floorplan-studio:measure` next to `GRID_KEY` (a viewer preference, never in the layout, never an undo step, and a blocked storage must not throw). The View menu gets a chip `#mgrid` with `aria-pressed`, next to the Grid group.
- Test: unit: the stored preference reads back, a missing or junk value gives true, and a throwing `localStorage` is survived. Playwright: with the demo, `.mg` lines are 50 cm apart in plan units and sit before the first room in DOM order; computed `stroke-opacity` is .12 for a 50 cm line and .22 for a metre line, and `stroke-width` is the non-scaling half pixel; the number at x = 0 reads `0 m`, the one a metre right reads `1`; toggling `#mgrid` off removes every `.mg` and the choice survives a reload; at plan rotation 45 the grid lines turn with the walls while the numbers stay upright (computed screen angle 0); a floor 600 m wide draws the 5 m step and no more than 400 lines per axis.
- Done when: the tests pass, the toggle is in the View menu, and SPEC's editor section describes the measure grid. The card is untouched: `renderFloor` never emits `.mg`.
- Break it: with the grid off, Undo is still disabled by it; an empty floor (no rooms) still draws a grid around the origin and does not divide by zero; a layout whose coordinates are all negative numbers its axes with negative metres.

### S1.51 Scale furniture by its corners (done)
- Outcome: a table, a bed, a tree or a patio is sized by dragging a corner, not by typing two numbers. Devices, doors, windows and stairs are not touched.
- Files: `src/editor/editor-app.ts`, `src/editor/ops.ts`, `src/core/schema.ts` (bounds only), `src/core/render.ts` (CSS only), `tests/editor/ops.test.ts`, `tests/core/schema.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: when a furniture piece is selected, the overlay draws four `<circle class="h" data-fh="<i>:<c>">` handles at the corners of its box, `c` being `nw|ne|se|sw`, turned by the piece's `rot` like the highlight rect already is, radius `5 * k` as the other handles. A new `Drag` case `{ type: "fscale"; base: Floor; i: number; corner: "nw"|"ne"|"se"|"sw"; moved: boolean }`: the opposite corner stays where it is, the dragged corner follows the pointer in the piece's own frame (turn the pointer by `-rot` about the centre first), and `w`, `h`, `x` and `y` are recomputed from the two corners. `Shift` keeps the proportions the piece had when the drag started; the snap grid applies to the moving corner and `Alt` disables it, as everywhere else. `scaleFurniture(m, corner, to, opts)` in `ops.ts` holds the arithmetic and is unit tested on its own. One undo step per drag, named `Scaled the sofa` (its name, else its symbol), and no step when nothing moved. The width and depth fields follow the drag live. Bounds: `w` and `h` are clamped to 5 cm and 2000 cm in the drag and in the panel, and `validate` rejects a stored `w` or `h` outside that range (it has no upper bound today).
- Test: unit: `scaleFurniture` from each of the four corners moves the centre by half the change and leaves the opposite corner within 0.01 cm, at `rot` 0, 30 and 90; Shift keeps `w/h` within 0.01; the clamps hold at both ends; `validate` refuses `w` of 0, of 5000 and of `NaN`. Playwright: select the demo's sofa, drag its `se` handle with real pointer events, and its width and depth grow to the dragged size while the `nw` corner stays within 1 cm of where it was (measured from the DOM, at plan rotation 0 and at 45); Shift keeps the ratio; the panel fields show the new numbers; one Undo restores the old size exactly; a drag that ends where it started adds no undo step.
- Done when: the tests pass; SPEC's editor section says furniture scales by its corners and lists the 5 to 2000 cm bounds.
- Break it: dragging a corner past its opposite one clamps at 5 cm and never flips the piece or makes it negative; a tree at `rot` 45 scales along its own axes, not the screen's; the handles do not appear for a device or a door.
- Note: an extra (the dashed named shape) already resizes by dragging either end, so it needs no handles; say so in SPEC where extras are described. Confirm that is true before you write it.

### S1.52 The outline has wall kinds, and its edges can be deleted (done)
- Outcome: the house perimeter is external by default, its kind can be changed like any other edge, and a perimeter wall can be deleted. The demo shows external walls where the house meets outside.
- Files: `src/core/schema.ts`, `src/core/migrate.ts`, `src/core/render.ts`, `src/editor/ops.ts`, `src/editor/panels.ts`, `demo/layout.json`, `tests/core/*.test.ts`, `tests/editor/*.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: `Floor` gains `owk?: EdgeKind[]`, one entry per outline edge, same meaning as `Room.wk`. `validate` accepts it only when its length equals `outline.length` and every entry is an `EdgeKind`. `migrate` fills a missing `owk` with `external` for every edge, at v1 and at v2, so an old plan gains a proper perimeter. `renderFloor` passes it: the `o` poly becomes `{ id: "o", pts: f.outline, wk: f.owk }`, so `none` skips the line and leaves the editor's faint guide exactly as it does for a room. `insertPoint`, `removePoint` and anything else that changes `outline` keep `owk` the same length (a new point splits an edge into two of that edge's kind; a removed point leaves the kind of the edge that survives). `edgePanel` shows the kind select and the orange Delete for an outline edge too: `setEdgeKind(f, "outline", i, k)` writes `owk`, and Delete asks first when a door or window lies on that edge, as it already does. A room edge that shares the same segment is set with it, as today. The outline keeps bounding the house whatever the kinds are: `viewBoxFor`, `contentPoints`, area and snapping ignore `owk`.
- Demo: `demo/layout.json` gets `owk` of `external` on every outline edge, and every room edge that lies on the outline is `external` too, so the starter template teaches the distinction: external where the house meets outside, `wall` inside.
- Test: unit: `migrate` on the v1 file and on a v2 file without `owk` gives `external` everywhere and is idempotent; `validate` refuses a wrong length, a bad entry and a non-array; `insertPoint` and `removePoint` on the outline keep `owk` in step; `renderFloor` draws an outline edge of kind `none` as a guide only, and the demo has no `wall` edge on the perimeter. Playwright: click a perimeter edge, the panel says External wall, change it to Internal and the computed stroke-width changes from 8 to the internal width, Delete removes the line and one Undo brings it back with its kind; with a door on it the confirm shows and Cancel changes nothing; the outline still fits the view after a perimeter edge is deleted.
- Done when: tests pass; SPEC's schema block lists `owk` and the editor section says the perimeter is external by default and deletable.
- Break it: deleting every outline edge leaves the house still selectable and still framed by Fit to window; a stored `owk` one entry short is refused with a clear message; a plan turned 45 degrees still shows the external thickness.

### S1.53 A light and a dark theme (done)
- Outcome: the plan and the editor read well on a light background and on a dark night-blue one, and the dark theme matches a Home Assistant dark dashboard.
- Files: `src/core/render.ts`, `src/editor/editor-app.ts`, `src/editor/state.ts`, `src/editor/panels.ts`, `tests/core/render.test.ts`, `tests/editor/state.test.ts`, `tests/editor/editor.spec.ts`, `docs/SPEC.md`.
- Interface: every colour is already a `--fp-*` token, so a theme is a second set of values, not a second stylesheet. `FLOORPLAN_CSS` keeps today's values as the light theme on `:root`, and adds `[data-theme="dark"]` (set on the `<svg>` root, so one plan can be dark while the page is not) with the dark values, plus `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){...same...}}` so "auto" needs no script. Dark values: page `--fp-bg:#111c2b`, room fill `#1c2a3a` (a room is slightly lighter than the page), ink and walls near-white `--fp-ink:#e8e6e0`, `--fp-text:#e8e6e0` with `--fp-outline:#111c2b` (the white text outline of S1.46 inverts: light text, dark outline, the same trick the other way), `--fp-disc:#1c2a3a` with `--fp-disc-alpha:.75` and a light grey border, `--fp-measure:#e8e6e0` at the same faint opacities, `--fp-halo` and `--fp-tread` lightened. Device colours, the motion red, the heater orange and the light yellow keep their hue: they carry meaning and they read on both grounds; where one falls below 4.5:1 on the dark ground, lighten that token in the dark block rather than changing its hue. `renderFloor` gains `theme?: "light" | "dark"` in `RenderOpts`, which writes the attribute; nothing else in core reads it. The editor gets a three-way chip group in the View menu, `#th` with Auto, Light, Dark, default Auto, kept in `localStorage` under `floorplan-studio:theme` next to the grid and measure keys (never in the layout, never an undo step, a throwing storage must not break the editor). The editor's own chrome (panels, menus, chips, buttons, fields) follows the same theme: its CSS uses the same tokens, and every button keeps at least 4.5:1 contrast in both themes, the rule S1.40 set.
- Test: unit: `renderFloor` with `theme: "dark"` writes the attribute and without it writes nothing; the dark block defines every token the light block defines (compare the two key sets, so a new token cannot be forgotten). Playwright, all by computed style: in dark, the page background, a room fill, a wall stroke, a room name fill and its stroke, the device disc and the measure grid all take the dark values; a room name on a dark room has a dark outline and light fill; every `.btn` in the editor is at least 4.5:1 against its own background in both themes (compute it, as the S1.40 test does); the chip switches Light, Dark and Auto, the choice survives a reload, and Auto follows the emulated `prefers-color-scheme` both ways.
- Done when: tests pass; SPEC has a theme section listing the tokens and saying the card will follow Home Assistant's theme in Sprint 2.
- Break it: a layout with a per-room colour keeps that colour in both themes (it is the user's choice) and its name stays readable; switching theme mid-drag does not lose the drag; a blocked `localStorage` falls back to Auto.

## Sprint 2 — card (E3)

### S2.1 Card element (done)
- Outcome: `custom:floorplan-studio-card` renders a floor from config or the integration.
- Files: `src/card/floorplan-studio-card.ts`, `tests/card/card.test.ts` (vitest + jsdom).
- Interface: `class FloorplanStudioCard extends LitElement` with `setConfig(c: { floor?: string | "all"; fade?: number; room_glow?: boolean; layout?: Layout; layout_url?: string })`, `set hass(h)`, `getCardSize()`, `static getStubConfig()`. Layout source order: `config.layout`, then `config.layout_url` (fetched once), then websocket `floorplan_studio/load`. Registers itself on `window.customCards`. Renders `renderFloor(..., { state: hass.states, now: Date.now(), fade, roomGlow })` inside an `<svg>` with `viewBoxFor`. The card must draw openings (erase line) and extras (dashed line plus name): `renderFloor` already does, shared with the editor since the S1.7 review fixes, so the card only has to call it and not redraw them. A 1 s timer re-renders only while any motion device is within its fade window. The card sets `theme` (S1.53) from Home Assistant, dark when the dashboard is dark, and never hard-codes it.
- Test: with a stub `hass` and `config.layout = demo`, the shadow DOM contains one `polygon[data-r]` per room; changing a light state in the stub and setting `hass` again toggles the `on` class.
- Done when: tests pass; `npm run build` emits `dist/floorplan-studio-card.js` under 300 kB.
- Break it: `setConfig({})` with no layout shows the text "No layout: install the Floorplan Studio integration or set layout_url".

### S2.2 Lights, switches, plugs (done)
- Outcome: tap toggles, hold opens more-info, light colour and brightness shown.
- Files: card, `src/card/actions.ts`, `tests/card/actions.test.ts`, `src/core/render.ts`, `tests/core/render.test.ts` (review: colour/opacity moved into `renderFloor`, see DECISIONS).
- Interface: `tap` → `hass.callService(domain, "toggle", { entity_id })`; hold (≥ 500 ms) → `fireEvent(this, "hass-more-info", { entityId })`. Light on: icon `fill` from `attributes.rgb_color` if present else `--fp-on`, opacity `brightness/255` floor 0.35.
- Test: pointerdown+up within 500 ms calls `callService` once with `light.toggle`; 600 ms fires `hass-more-info`; rgb `[255,0,0]` gives `fill="rgb(255,0,0)"`.
- Note: the aura around a lit lamp is S2.8, the halo colour is S2.9. This task is the tap, the hold and the icon colour.
- Done when: tests pass.
- Break it: two taps within 300 ms toggle twice, not once (no debounce that eats input).

### S2.3 Contact sensors on doors (done)
- Outcome: a door or window with `sensor` on draws orange.
- Test: covered by render tests; card test: state on → `line[data-d].open` exists; tap on the door fires more-info for the sensor.
- Done when: the demo's three sensor doors respond in the jsdom test.
- Break it: a door whose `sensor` entity is missing from `hass.states` draws normally.

### S2.4 Motion fade (done)
- Outcome: motion goes red on `on` and fades to grey over `fade` seconds from `last_changed`, even after the sensor returns to `off`.
- Interface: fade uses `last_changed` of the most recent `on`; the card keeps `lastOn: Record<entity, number>` updated on each `hass` set; render passes it as `now`/`last_changed` so a sensor that already went `off` keeps fading from its last `on`.
- Test: fake timers; state on at t0 → `--fp-fade:1`; at t0+5 s with `fade: 10` → `0.5`; sensor off at t0+2 s does not reset the fade; at t0+10 s → `0` and the timer stops.
- Done when: tests pass; no timer runs when nothing is fading (assert `setInterval` count).
- Break it: `fade: 0` shows red only while `on`.

### S2.5 Sensors, climate, camera, media (done)
- Outcome: temp and humidity labels; heater bar orange when `hvac_action === "heating"`; camera and media open more-info on tap; media accent when `playing`.
- Test: stub states → label text `21.5 °C`, `48 %`; climate heating → `line.heater.on`; tap camera fires more-info with its entity.
- Done when: tests pass.
- Break it: a sensor with state `unknown` shows `–`, not `unknown`.

### S2.6 Room glow, floor switcher, unavailable (done)
- Outcome: room fill tints when any light in it is on (`room_glow`); `floor: "all"` shows chips to switch floors; unavailable entities are struck through.
- Interface: a device is "in" a room by point-in-polygon of its `x,y` (heaters: midpoint). Chips are inside the card, top-left, class `fp-floors`.
- Test: light on in room A → `polygon[data-r].glow` for A only; chips count equals floors; unavailable → class `unavailable`.
- Done when: tests pass.
- Break it: a device outside every room glows nothing and throws nothing.
- Note: unavailable was already built by S2.2/S2.3/S2.5's `classOf` (the `unavailable` class on `.dev`); this task added coverage but no new code for it. `renderFloor` still uses `opacity:.45`, not a literal strike-through, for that class — an undocumented choice already in place before this task, out of scope to change here.

### S2.7 Covers on doors (done)
- Outcome: a door with `cover` acts after a confirm dialog whose text matches the action it takes.
- Interface: tap on such a door → in-card dialog and Cancel / action button, both derived from the same live read of `hass.states[cover].state`: not `"open"` (closed, opening, unknown, unavailable, or missing) → "Open <name>?" with an Open button that calls `cover.open_cover`; `"open"` → "Close <name>?" with a Close button that calls `cover.close_cover`. The read happens again at press time, so a cover that changes state while the dialog is open re-renders the label and the eventual press acts on the state shown then, never against its own label. Door line class `cover-open` when the cover is open. The dialog carries `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the question text.
- Test: tap on a closed cover → "Open …" dialog, Open → `callService("cover", "open_cover", { entity_id })`; tap on an open cover → "Close …" dialog, Close → `callService("cover", "close_cover", { entity_id })`; a state change while the dialog is open flips the label and the eventual call matches it; Cancel → no call; the dialog's `role`/`aria-modal`/`aria-labelledby` read back correctly.
- Done when: tests pass.
- Break it: a second tap while the dialog is open does not open a second dialog.

### S2.8 A lit lamp casts an aura (done)
- Outcome: a light that is on draws a soft round aura, 2 m across, in its own colour.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/card/card.test.ts`.
- Interface: for a device of type `light` that is on, `renderFloor` draws `<circle class="aura" r="100"/>` at the device's centre, in plan units, before every device group and after the rooms, so one lamp's aura never hides another's icon. `.aura{fill:var(--fp-aura);fill-opacity:var(--fp-alpha);pointer-events:none}` (`--fp-alpha` is .25, the value of the halo and the cone; it was .5) with `--fp-aura` (#f0c419). A light whose state carries `rgb_color` sets `--fp-aura` on its own circle through the inline `style` that the device group already uses, so the aura is the colour the lamp actually shows; a lamp bound to a switch takes the switch's state and the default colour. Off, unavailable and unknown draw no aura.
- Test: a card test with one light on has one `circle.aura` of radius 100 at the lamp's coordinates and none when it is off; a light with `rgb_color: [255,0,0]` has `--fp-aura:rgb(255,0,0)` in its style; the aura does not catch the pointer (a tap at the aura's edge over a room selects nothing).
- Done when: tests pass; the markup still has no `#rrggbb` literal outside `FLOORPLAN_CSS`.
- Break it: twenty lights on at once still render in one pass and the icons stay readable (the auras are behind every icon, not behind only the next one).

### S2.9 A device wears its colour when it is on (done)
- Outcome: an active icon and its halo take the colour of the device, so the plan reads at a glance.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/card/card.test.ts`, `docs/SPEC.md`.
- Interface: `renderFloor` already puts `on` on a device group that is active. One CSS rule per type sets `--fp-dev` on `.dev-<type>.on`, and two shared rules use it: `.dev.on path{fill:var(--fp-dev)}` and `.dev.on .halo{fill:var(--fp-dev)}` (the halo keeps its `--fp-alpha` opacity, 25 %, from S1.29, so the circle lightens in the device's colour). The palette of S1.30 supplies the values: light yellow, motion and contact red, heater and climate orange, tv, plug and computer blue when on (grey when off), switch and humidity grey — grey being `--fp-idle`, so those two look the same on and off, which is what Diego's list says. A contact device draws red whether it is a device icon or a door sensor. No new state reading: `on` is the class the card already computes. Amended by S1.37: a room or a piece of furniture with an `entity` gets the same `on` class when that entity's state is `on`, `open` or `playing`, and the CSS gives the shape a light tint (`.room.on`, `.furn.on`), so a pond pump or a gate reads on the plan. A room with an `area` has no `entity` and is never tinted this way.
- Test: render fixtures with the state stub: a motion device that is on has `--fp-dev` resolving to the red variable and its halo the same; a wall switch that is on draws no brighter than off; a tv, a plug and a computer that are on are blue and off are grey; a water room with `entity` on carries `on` and the same room without the entity does not.
- Done when: tests pass; the behaviours table lists one row per type with its colour.
- Break it: a light that is on *and* unavailable keeps the unavailable styling; the colour rule does not override it.

### S2.10 An air conditioner shows what it is doing (done, 2026-09-21)
- Outcome: an `ac` device is blue when it cools, orange when it heats and grey otherwise.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/card/card.test.ts`.
- Interface: the mode is read at render time from the entity, never stored. A `state` of `off`, `unavailable` or `unknown` is grey and nothing else is looked at. Otherwise `hvac_action` decides (`cooling` → blue, `heating` → orange, anything else grey), falling back to `state` when the attribute is missing (`cool` → blue, `heat` → orange, `off`, `fan_only`, `dry` and the rest grey). `renderFloor` adds the class `cool` or `heat` to the device group, and `.dev-ac.cool` and `.dev-ac.heat` set `--fp-dev` to `--fp-dev-ac-cool` and `--fp-dev-ac-heat`; with neither class the device stays `--fp-idle`, so a fan or a filter is grey with no extra rule. The same two classes work for a heat pump, which is the same entity domain.
- Test: state stubs for `hvac_action: "cooling"`, `"heating"`, `"idle"`, a missing attribute with `state: "cool"`, and `state: "fan_only"` give blue, orange, grey, blue, grey; an `ac` entity missing from `hass.states` draws grey and throws nothing.
- Done when: tests pass.
- Break it: an entity that reports `hvac_action: "cooling"` while its state is `off` draws grey, because the state wins when it says the unit is off.
- Checked: 7 unit tests for the mode table, and a Chromium computed-fill pair (blue, orange, idle, off-beats-stale-cooling). `layout.colors.ac` stays inert by decision: one colour cannot name two states.

---

### S2.11 Screenshot harness (done, 2026-09-21)
- Outcome: `npm run shots` renders the demo plan through the built card (ground and first floor, off, on and unavailable states, light and dark) and the standalone editor to `shots/current/*.png` with a contact sheet `index.html`, and reports which images differ from a local baseline in `shots/baseline/`.
- Why: CLAUDE.md finding 16. Three S2.9 defects were green on every test and wrong on screen.
- Files: `scripts/shots.mjs`, `package.json` (`shots`), `.gitignore` (`shots/`), `docs/WORKFLOW.md`.
- Checked: two consecutive runs with no change report `identical to baseline`, so any difference is real. The baseline is gitignored: PNGs differ between machines.
- Not covered: it looks at the demo layout only, in the states listed. It says nothing about a state it does not draw.

### S2.12 Themes: blueprint by default, or inherit Home Assistant (done, 2026-09-21)
- Outcome: the card has `theme: blueprint | light | ha` (default blueprint). The editor's View menu has the same three chips. `ha` draws the plan in the dashboard's own colours.
- Why: Diego wanted the blueprint look as the default and a way to just follow HA. This replaces S1.53's Auto/Light/Dark and S2.1's darkMode-only choice.
- Files: `src/core/render.ts` (`THEMES`, `haTokens`, theme CSS blocks), `src/card/floorplan-studio-card.ts`, `src/editor/state.ts`, `src/editor/editor-app.ts` (`haDark`), `src/editor/standalone.html`, `scripts/shots.mjs` (blueprint, light, ha-light, ha-dark).
- Checked: computed-style tests for each theme in Chromium, with and without HA variables; unit tests for the token blocks; `npm run shots` looked at (27 images).
- Not covered: a real HA dashboard. The stand-in HA variables in the shots are typical values, not read from a running instance. The editor's picker default for a device colour is the light palette, so on blueprint a camera swatch (#4a4a48) differs from what the plan draws (#8a8a86).

### S2.13 Battery, inverter, server, access point (done, 2026-09-21)
- Outcome: four new device types. Each draws an icon (MDI: battery, current-ac, server, access-point) in idle grey on the round disc; a tap opens Home Assistant's more-info popup for its entity at once, never a toggle. They map to entities like any other device and appear in the editor's Add menu, filter and colour rows.
- Why: Diego's request, mid-Sprint 2. These are things you watch, not switch.
- Files: `src/core/schema.ts`, `icons.ts`, `render.ts` (`DEVICE_COLOURS`), `src/card/actions.ts` (`NO_TOGGLE`), `src/editor/panels.ts`, `scripts/shots.mjs`, `docs/SPEC.md`.
- Checked: unit test per type for tap to more-info with no service call; a Chromium pair for icon, disc and idle-grey fill; shots looked at.
- Decided: grey always, no active colour (a battery's state is a percentage, not on/off); `layout.colors` can still name one. The type id is `access_point`. Not covered: a low-battery warning colour, which needs a threshold nobody has asked for yet.

### Sprint 2 close (2026-09-21)
Verified at sprint close, not per task (WORKFLOW). One pass over the whole sprint on `main` at `6dcf88e`: `npm run lint` exit 0, unit 671 passed, Playwright 340 passed, `npm run shots` looked at (27 images).

| Task | Tests naming it | Result |
|---|---|---|
| S2.1 card element | 3 | PASS |
| S2.2 lights, switches, plugs | 11 | PASS |
| S2.3 contact sensors on doors | 4 | PASS |
| S2.4 motion fade | 3 | PASS |
| S2.5 sensors, climate, camera, media | 8 | PASS |
| S2.6 room glow, floor switcher, unavailable | 11 | PASS |
| S2.7 covers on doors | 10 | PASS |
| S2.8 lamp aura | 3 | PASS |
| S2.9 device colour when on | 17 | PASS |
| S2.10 air conditioner | 3 | PASS |
| S2.11 screenshot harness | none, a script | PASS: two runs identical to baseline |
| S2.12 themes | 18 | PASS |
| S2.13 monitored devices | 4 | PASS |

Honest limits: the builder ran this pass, not a separate session; the table shows every suite is green, not that every claim was re-derived. S2.9's media, cover and other fix was never independently re-verified. Nothing has run against a real Home Assistant or a real dashboard's colours. The card is untested as a Lovelace resource. The Python side has never executed. Lessons: CLAUDE.md findings 19 and 20.

## Sprint 3 — integration, panel, release (E4)

### S3.0 Dev environment: a real Home Assistant to test against (done 2026-09-21: pytest here, Diego's own HA for live checks)
- Decision: Diego uses his own HA. Steps in `docs/LIVE-TEST.md`. The dev container stays unused unless a Linux box appears.
- Status: `pytest` half done and green. `.venv` on Python 3.13 via uv, `requirements_test.txt` installed (Home Assistant 2026.2.3), `tests/integration/test_smoke.py` passes, and it passes from another directory too. The real-HA half is NOT done: `hass` run from that venv on this Mac dies with exit 137 (SIGKILL) right after Core Bluetooth fails to start, with a minimal config too; Docker is not installed. `.devcontainer/devcontainer.json` is written but has never been started. The way forward is Diego's own HA (the note below), or a Linux container.
- Outcome: `pytest` runs green on an empty test, and a Home Assistant instance exists that the panel can be loaded into.
- Why it is a task: nothing Python in this repo has ever executed. The six files in `custom_components/floorplan_studio/` are one-line stubs, `pytest-homeassistant-custom-component` is named in `requirements_test.txt` but is not installed, and there is no `tests/integration/`. Every later Sprint 3 task's "Done when" assumes a running HA; without this they cannot close.
- Files: `.devcontainer/devcontainer.json` (HA custom component template), `tests/integration/conftest.py`, `tests/integration/test_smoke.py`, `docs/WORKFLOW.md` command table gains the Python setup line.
- Test: `pip install -r requirements_test.txt` then `pytest` → one passing test that sets up nothing but imports `custom_components.floorplan_studio.const`.
- Done when: `pytest` exits 0 with the output pasted; the dev container starts HA and its URL is recorded.
- Break it: `pytest` run from a directory other than the repo root still finds `custom_components/` (or the failure names the fix).
- Note: Diego's own HA is an alternative to the dev container for the manual checks. His instance URL, token and layout never enter the repo — they live in a gitignored local file read by name.

### S3.1 Integration: storage and websocket (done 2026-09-21: 8 pytest green; hassfest not yet run, it needs the CI action of S3.5)
- Outcome: load and save the layout inside HA.
- Files: `custom_components/floorplan_studio/{__init__.py, const.py, config_flow.py, storage.py, websocket.py, manifest.json, strings.json, translations/en.json}`, `tests/integration/test_websocket.py`, `tests/integration/conftest.py`.
- Interface: `Store(hass, 1, "floorplan_studio.layout")`; websocket commands `{"type": "floorplan_studio/load"}` → `{"layout": {...} | null}` and `{"type": "floorplan_studio/save", "layout": {...}}` → `{"ok": true}`; save validates `version == 2` and rejects anything else with `invalid_format`. Config flow: single instance, no fields. Admin only for save.
- Test: `pytest-homeassistant-custom-component`: set up entry; save demo; load returns it; save `{"version": 1}` returns `invalid_format`; non-admin save is rejected.
- Done when: `pytest` green; `hassfest` action passes.
- Break it: load before any save returns `null`, not an error.

### S3.2 Panel (built 2026-09-21; the live check on Diego's HA is still open)
- Built: `src/editor/panel.ts`, `panel.py`, static path and sidebar entry, `tests/editor/panel.test.ts` (6), `tests/integration/test_panel.py` (3), `tests/integration/panel-live.spec.ts` (skips without `HA_URL` and `HA_TOKEN`, never run against a real HA). The built panel was also driven in Chromium against a stub `hass`: it loads, saves, shows the status. Bug found on the way: the vite `panel` build pointed at `panels.ts` (selection helpers), not the panel element.
- Open: install on Diego's HA (copy `custom_components/floorplan_studio` into `config/`, restart, add the integration), then File, Save, reload, check the sidebar entry is hidden for a non-admin. Screenshot goes in the PR.
- Outcome: the editor served at `/floorplan-studio` in the sidebar, saving through the websocket.
- Files: `panel.py`, `src/editor/panel.ts` (`<floorplan-studio-panel>` receives `hass`, wraps the editor, Load/Save buttons call the websocket), `__init__.py` registers static path `/floorplan_studio_static` → the integration's `www/` folder, and the panel with `panel_custom.async_register_panel(frontend_url_path="floorplan-studio", webcomponent_name="floorplan-studio-panel", module_url=..., sidebar_title="Floorplan Studio", sidebar_icon="mdi:floor-plan", require_admin=True)`. `npm run build` copies `dist/*.js` and `dist/editor.html` into `custom_components/floorplan_studio/www/`.
- Test: dev container (`.devcontainer` from the HA custom component template): open the panel, File → Load gets the demo saved in S3.1's test fixture, move a light, Save, reload the page, the light stays. Record as a Playwright test against the dev container URL when `HA_URL` and `HA_TOKEN` env vars are set; skipped otherwise.
- Done when: the manual check is recorded with a screenshot in the PR; Playwright test present and skipping cleanly without env.
- Break it: a non-admin user does not see the sidebar entry.

### S3.2b Load demo and blank Reset (done 2026-09-21, from Diego's first look at the panel)
- File, Load demo (blank plan only) and File, Reset to blank; fresh-install error fixed. See DECISIONS. Live check on Diego's HA is the next proof.

### S3.2c Update banner and brand icon (done 2026-09-21, Diego's requests)
- Panel banner from HACS's update entity, with Update; icon and logo in `brand/`. Not yet seen on a real HA.

### S3.2d Fixes and paint from Diego's own use (done 2026-09-21: v0.5.1 and v0.5.2 on his HA)
- v0.5.1: the panel reset the editor on every HA state update (zoom, selection, undo, edits snapping back); fixed with `guard`, with a test that fails without it. The measure grid covers the whole view with zero at the plan's top-left corner. Zoom buttons +, -, 0 top right of the canvas.
- v0.5.2: a custom room colour becomes a swatch (`layout.palette`); seven textures (three wood, four stone) for rooms and zones; stairs take colour and texture. See DECISIONS.
- Open: Diego saw rooms in light gray "until customized" when drawing or importing. Not reproduced: rooms are navy under blueprint. Likely the `ha` theme in light mode (`--secondary-background-color`). Waiting for which theme; if it is `ha`, give default rooms a tint of their own.

### S3.3 Pickers from hass (built 2026-09-21: `haData`, device entity picker, unbound marker and list; tests green; run over the live registries of Diego's HA (3 floors, 24 areas, 3185 entities); already placed entities are hidden in the picker. Not built, dropped: rebuild the catalog on Save, see DECISIONS)
- Outcome: rooms pick an area, devices pick an entity, from HA data, grouped.
- Files: `src/editor/hass-pickers.ts`, `src/editor/panel.ts`, `tests/editor/pickers.test.ts`.
- Interface: amended by S1.38: the dropdowns themselves are already in the editor and read the `ha: HaData` property; this task only fills that property from `hass`. `haData(hass): HaData` (the type is `src/core/ha.ts`) reads `config/floor_registry/list` for `floors`, `config/area_registry/list` for `areas` with their `floor_id`, and the entity registry plus `hass.states` for `entities` (`id`, friendly name, domain); the panel sets `editor.ha = haData(hass)` after every registry change and on first load, and sets nothing when a registry call fails, so the editor falls back to free text instead of showing an empty list. Also: `areas(hass)` → `{id, name}[]`; `entitiesByType(hass)` → `Record<DeviceType, { entity: string; name: string; area: string | null }[]>` using domain and `device_class` (light→light; switch with device_class outlet→plug else switch; sensor temperature→temp, humidity→humidity; binary_sensor motion/occupancy→motion, door/window/garage_door/opening→contact; camera; climate; media_player; cover). Fetches `config/area_registry/list`, `config/device_registry/list`, `config/entity_registry/list` once. In the editor, Add → Device shows type → area → entity, hiding entities already placed; door panel's sensor list uses `contact` entities; the `catalog` is rebuilt from this list on Save when running in HA.
- Test: registry fixtures → grouping as above; a placed entity is absent from the list; a `hass` stub whose registries answer gives a `HaData` with the floors, the areas with their `floor_id` and the entities with their domain, and the editor's room panel then shows the area select of S1.38.
- Done when: tests pass; the panel in the dev container shows real areas and real floors.
- Break it: an entity with no area lands under "No area"; a `hass` with no floor registry (older HA) gives `floors: []` and the floor title stays free text.
- Added 2026-09-21 (Diego's own home is loaded with some devices unbound, entity `""`): the picker must also reconnect and change. A device's Home Assistant entity field becomes a picker (today it is free text, `panels.ts` "Home Assistant entity"), offering entities of the device's type, the room's area first. Devices with an empty entity show a marker on the plan and in a "needs an entity" list, so they are easy to find. Test: an unbound device gets an entity from the picker; a bound device is switched to another; clearing it returns it to unbound. Done when the four unbound lights in the own-home layout can be attached without typing an id.

### S3.4 Card as a resource (built 2026-09-21; the script is served by the running HA, 200 and 91 KB, checked 2026-09-21; a dashboard with the card still to be seen by eye)
- Built: `panel.py` calls `frontend.add_extra_js_url` and removes it on unload. Two pytest tests, both fail with the call removed.
- Outcome: the card JS is available to Lovelace without manual resource setup.
- Interface: `__init__.py` calls `frontend.add_extra_js_url(hass, "/floorplan_studio_static/floorplan-studio-card.js")`.
- Test: dev container: add the card by YAML, it renders the saved layout with no `layout` in config.
- Done when: screenshot in the PR; acceptance criterion 4 checked and recorded.
- Break it: with no saved layout the card shows the S2.1 message.

### S3.5 Release (workflows and packaging built 2026-09-21; the tag waits for Diego's yes and a live check)
- Diego does not copy files by hand: install and updates go through HACS. `hacs.json` sets `zip_release`; `.github/workflows/release.yml` builds on a `v*` tag, checks the tag against `manifest.json`, zips the integration with `www/` and creates the release. `ci.yml` runs lint, vitest, Playwright and pytest. `validate.yml` runs hassfest and the HACS action. None of the three has run on GitHub yet.
- Outcome: installable through HACS as a custom repository.
- Files: `hacs.json`, `.github/workflows/{validate.yml (hassfest + hacs action), ci.yml (lint, test, build, pytest)}`, `README.md` install steps, `CHANGELOG.md`, tag `v0.1.0`.
- Test: CI green on main; fresh HA in the dev container installs from the tag and runs acceptance criteria 3 and 4.
- Done when: tag exists, README matches reality, CI badge green.
- Break it: HACS validation fails if `www/` is missing from the tag (build must run in the release workflow).

---

## Sprint 4 — organise the home from the plan (E6)

**Slice 4a (agreed with Diego 2026-09-21): S4.1, then S4.4, then S4.3.** S4.2, S4.5, S4.6, S4.7 and S4.8 wait for later slices.
Rules from the interview: tests use a stub `hass` that records every call; one live write on Diego's HA runs only after he says yes to
that exact write, and it carries the `floorplan-studio` label; every write asks in the dialog, except the device-to-area move (S4.3), which
offers "Don't ask again this session"; the light-from-switch button shows on a placed switch or plug only. S4.1 builds only the functions the
slice uses (`ensureLabel`, `setDeviceArea`, `setEntityArea`, `createHelper`, `confirm`); `createArea` and `createAutomation` are added by the
task that needs them. The editor gets the writer as a property set by the panel, never an import, so the standalone build cannot reach it.

Panel only: every task needs `hass`. The standalone editor hides these
controls. Rules for the whole sprint: every write to HA is confirmed in a
dialog that names what will be created; everything the tool creates carries
the HA label `floorplan-studio` (created once, S4.1) so the user can find and
remove it; HA registries have no undo, and the dialog says so. Writes go
through `hass.callWS` (registries, config flows) and `hass.callApi` (automation
config). No write ever runs on load or on save.

### S4.1 Writes to HA
- **Status: partly done in slice 4a (2026-09-21). Built: `ensureLabel`, `setDeviceArea`, `setEntityArea`, `createHelper` (finds the new entity by its config entry and labels it), `makeWriter`, `confirm` (Cancel has focus, Esc and outside click cancel, optional "remember" checkbox). Still to do: `createArea`, `createAutomation`, `openAutomation`, with the tasks that need them. Tests: `tests/editor/hass-write.test.ts`, and `grep` finds no write code in `dist/editor.html`.**
- Outcome: one module that does every HA write, with the label and the confirm dialog.
- Files: `src/editor/hass-write.ts`, `src/editor/confirm.ts`, `tests/editor/hass-write.test.ts`.
- Interface:
  ```ts
  export async function ensureLabel(hass): Promise<string>;                          // label id of "floorplan-studio", created via config/label_registry/create if missing
  export async function createArea(hass, name: string): Promise<string>;             // config/area_registry/create → area_id
  export async function setDeviceArea(hass, deviceId: string, areaId: string): Promise<void>;   // config/device_registry/update
  export async function setEntityArea(hass, entityId: string, areaId: string | null): Promise<void>;  // config/entity_registry/update
  export async function createHelper(hass, handler: "switch_as_x" | "group", steps: Record<string, unknown>[]): Promise<{ entity_id: string }>;  // config_entries/flow, one POST per step, throws with the flow's error text
  export async function createAutomation(hass, cfg: AutomationConfig): Promise<string>;  // POST config/automation/config/<id>, id = "fp_" + random; returns the entity id after the registry reports it (poll up to 5 s)
  export function openAutomation(id: string): void;                                   // history.pushState + "location-changed" event to /config/automation/edit/<id>
  export function confirm(el, title: string, lines: string[]): Promise<boolean>;      // dialog; the last line is always "Home Assistant cannot undo this."
  ```
  Every create sets `labels: [labelId]` on the resulting entity (entity registry update) or device.
- Test: stub `hass` with recorded `callWS` and `callApi`: each function sends the documented message; `ensureLabel` creates once and reuses; a flow step that returns `errors` throws with the text; `confirm` resolves false on Cancel and Esc.
- Done when: tests pass; no function is reachable from the standalone build (`grep hass-write dist/editor.html` finds nothing).
- Break it: `createAutomation` when the registry never reports the entity rejects after 5 s, not forever.

### S4.2 Areas from the plan
- Outcome: a custom room, or one whose stored `area` HA does not know, gets a button "Create area `<plan name>` in Home Assistant" in the room panel; confirming creates the area (labelled `floorplan-studio`) and links the room to it, setting `room.area`/`room.name` from what HA returns, one undo step (the area stays in HA if the edit is undone). A room already linked to a known area shows no button. The floor panel (nothing selected) gets a new "Areas not on the plan" box listing every HA area no room or zone on any floor uses; clicking one starts Draw, Room with that area preset, so the finished room takes the area's id and name instead of "New room". No room or area is ever created on load or on save — always an explicit click, then a confirm dialog.
- Deviation from PLAN: the area field stays a plain `<select>` (S1.38), not `ha-area-picker` — that adapter belongs to S4.8 (native look), not started, and nothing here needs it.
- Files: `src/editor/hass-write.ts` (`createArea`, `HaWriter.createArea`, `makeWriter`), `src/editor/draw.ts` (`AreaPreset`, `Draw`'s third constructor argument, `applyShape` naming a new room/zone from the preset), `src/editor/panels.ts` (`unplacedAreas`, the `#rcreate` button, `PanelCtx.createArea`/`drawArea`), `src/editor/editor-app.ts` (`createArea`, `startDraw` taking a preset), `tests/editor/hass-write.test.ts` (3 new), `tests/editor/draw.test.ts` (1 new), `tests/editor/editor.spec.ts` (4 new).
- Test: TDD — `createArea` and the `Draw`/`applyShape` preset both written and run first, watched fail (`createArea is not a function`; the new room keeping the plain "New room" name). The 4 Playwright tests (create + link, Cancel/failure/no-writer, the unplaced-areas box draws a preset room and then empties, no box without Home Assistant) written first too, `--repeat-each=10` clean (40/40).
- Done, 2026-09-23. `grep hass-write dist/editor.html` finds nothing — the write path stays out of the standalone build. Rendered on `/standalone.html` and looked at: the floor panel's "Areas not on the plan (2)" box lists Garage and Shed; selecting a room linked to a known area shows no create button. Full suite: lint/tsc clean, 814 vitest (7 new), 396 Playwright passed / 1 skipped (4 new), build clean.
- Break it: Cancel in the dialog writes nothing, the room stays custom and keeps its plan name; a failing `createArea` leaves the plan untouched and says so in the status line.

### S4.3 Devices into areas
- **Status: done in slice 4a for a device dropped by dragging. Deviations: the move writes the device only when the entity is its only one (`areaMove` in `core/ha.ts`), else the entity; placing from the Device menu asks nothing; the mismatch mark is a note and a "Move it to <room> in Home Assistant" button in the device panel, not a dot in the menu. Tests: `tests/core/area-move.test.ts`, `editor.spec.ts` (S4.3).**
- Outcome: placing or moving a device into a room assigns its HA area.
- Files: `src/editor/editor-app.ts`, `src/editor/panel.ts`, `tests/editor/organise.spec.ts`.
- Interface: after a device drop (place or drag end) inside a room or zone with an HA area, if the entity's device (or the entity, when it has no device) is in another area or none, ask "Move <name> to area <room>?" (one dialog per drop, with "Don't ask again this session"). Yes → `setDeviceArea` or `setEntityArea`. The Device menu (S1.12, grouped by area since S3.3) marks entities whose HA area differs from the room they sit in with a small dot and a tooltip "HA says: <area>".
- Test: Playwright: drop a device into a room with an area; dialog; Yes → `config/device_registry/update` recorded with that area; No → nothing; the dot shows for a mismatched device.
- Done when: tests pass.
- Break it: a device dropped outside every room asks nothing.

### S4.4 Light from a switch
- **Status: done in slice 4a. `EditorState.lightFromSwitch` and `canMakeLight` (`tests/editor/light-from-switch.test.ts`), button `#vmklight`, Playwright tests in `editor.spec.ts` (S4.4). Not yet run against the live HA: needs Diego's yes for one write.**
- Outcome: a placed switch can become a light helper; the plan gets the light, bound to the switch.
- Files: `src/editor/panels.ts`, `tests/editor/organise.spec.ts`.
- Interface: switch or plug device panel gains "Create light from this switch". Confirm → `createHelper(hass, "switch_as_x", [{ entity_id, target_domain: "light" }])`; the new `light.*` entity is added to the catalog and placed 30 cm to the right of the switch, type `light`, `bound` = the switch entity; the switch device is removed from the plan (the light icon now stands for both, per SPEC). One undo step for the plan change; the helper stays in HA on undo, and the status line says so.
- Test: Playwright: button on a switch; confirm; the flow messages are recorded; a bound light appears and the switch icon is gone; undo restores the switch icon, status says the helper still exists.
- Done when: tests pass.
- Break it: a switch that is already some light's `bound` has no button.

### S4.5 Groups
- Outcome: create light and motion groups from the plan, and filter the plan by group.
- Deviation from PLAN: tests landed in `tests/editor/editor.spec.ts` under a `// ---- S4.5: groups ----` marker, not a separate `organise.spec.ts` (that file was never created for any Sprint 4 task — S4.2/S4.3/S4.4 all used the same convention).
- Files: `src/core/bind.ts` (`groupKind`), `src/core/index.ts`, `src/core/ha.ts` (`HaData.entities[].members`), `src/editor/hass-pickers.ts` (`haData` populates `members` for `domain === "group"`), `src/editor/state.ts` (`Sel`'s `devs` variant, `activeGroup`, `groupDraft`), `src/editor/panels.ts` (`PanelCtx.createGroup`, `devsPanel`), `src/editor/editor-app.ts` (Shift+click accumulation, `createGroup`, the Group toolbar menu, `dimmed` passed to `renderFloor`), `src/core/render.ts` (`RenderOpts.dimmed`, the `dim` class, `.dev.dim{opacity:.3}`), `tests/core/bind.test.ts` (3 new), `tests/editor/editor.spec.ts` (6 new, plus 1 CSS pair).
- Interface: Shift+click selects several devices of one type (lights, or motion sensors); the panel shows "Create group" with a name field. Confirm → `createHelper(hass, "group", [{ next_step_id: "light" | "binary_sensor" }, { name, entities, hide_members: false, all: false }])`. The Group menu (new toolbar menu, after Device) lists HA group entities whose members are on the current floor; choosing one dims every device not in it (class `dim`); "All" clears. Group membership comes from `attributes.entity_id` of the group entity in `hass.states`.
- Test: Playwright: Shift+click two lights, Create group "Hall", the flow messages are recorded; the Group menu lists a stub group and choosing it dims the others. TDD was not followed here — the tests were written after the implementation, not before; they were run and confirmed to pass, but not first watched fail against the pre-implementation code.
- Done, 2026-09-23. `npx tsc --noEmit`/`eslint .` clean, 817 vitest passed (3 new), 376 Playwright passed (6 new + 1 CSS pair), `--repeat-each=5` on the new Playwright tests clean (30/30), build clean. `npm run shots` identical to baseline (the standalone demo carries no HA data, so it never exercises the Group menu or `dim` — that path is covered instead by the Playwright tests and a `getComputedStyle` pair for `.dev.dim`, not by looking at a render).
- Break it: a mixed selection (light and motion) shows no Create group button — `groupKind` refuses any selection that is not every-light or every-motion (unit-tested), and the UI's own Shift+click accumulation never lets a different kind join a selection in the first place (Playwright-tested); a forced mixed `{t:"devs"}` selection is also Playwright-tested directly against the panel to confirm it renders no button even if that guard were bypassed elsewhere.

### S4.6 Links and automations
- Outcome: a switch turns on several things; a motion group turns on a light group; a device gets a time schedule. Each becomes an HA automation the user finishes in HA's editor.
- Files: `src/editor/panels.ts`, `src/editor/automations.ts`, `tests/editor/automations.test.ts`, `tests/editor/organise.spec.ts`.
- Interface: `automations.ts` builds configs (pure): `switchControls(switchEntity, targets: string[])` (trigger: state of the switch, action: `homeassistant.turn_on` / `turn_off` targets, two automations or one with choose), `motionLights(motionGroup, lightGroup, offAfter: number)` (on when the group turns on; off after `offAfter` s with no motion), `schedule(entity, on: "HH:MM", off: "HH:MM")`. Panels: switch panel "Controls..." picks lights, switches, plugs or groups (many); motion group in the Group menu gets "Turns on..." picking a light group and a minutes field; light, switch, plug and media panels get "Schedule" with two time fields. Each: confirm, `createAutomation`, then `openAutomation`, so the user lands in HA's editor with the automation already saved. A single switch to a single light suggests "Create light from this switch" (S4.4) instead of an automation. The plan stores nothing about automations: HA is the source, and the room box (S4.7) shows them.
- Test: unit: each builder returns the documented config, `schedule` rejects a malformed time; Playwright: switch panel, pick two lights, confirm, `callApi` POST recorded with the built config, then `location-changed` fires with the edit URL.
- Done when: tests pass.
- Break it: picking the switch itself as a target is refused with the text "A switch cannot control itself".
- Done, 2026-09-23. Files: `src/editor/automations.ts` (`switchControls`, `motionLights`, `schedule`, `openAutomation`), `src/editor/hass-write.ts` (`createAutomation`; imports `AutomationConfig` as a type from `automations.ts` instead of redeclaring it), `src/editor/state.ts` (`controlsDraft`, `scheduleOn`/`scheduleOff`, `motionLightGroup`, `motionMinutes` session drafts; `controlsChoices`), `src/editor/panels.ts` (`controlsField`, `scheduleField`, `SCHEDULABLE`), `src/editor/editor-app.ts` (`controlsAutomation`, `scheduleAutomation`, `motionAutomation`; the Group menu's inline "Turns on..." section for a selected motion group), `tests/editor/automations.test.ts` (6 tests, pre-existing), `tests/editor/hass-write.test.ts` (20 tests, pre-existing), `tests/editor/editor.spec.ts` (4 new tests, `--repeat-each=5` clean).
  Deviations: one automation per builder with a `choose` action keyed by trigger id ("on"/"off"), not two automations, settled before this task. `openAutomation` lives in `automations.ts`, not `hass-write.ts` as the sketch implied — it touches no `hass`, and the editor's own build-safety rule ("the editor never imports `hass-write.ts`") would otherwise pull that file into the standalone bundle; `hass-write.ts` re-exports it for the existing test file. Tests landed in `editor.spec.ts`, not the never-created `organise.spec.ts` (same deviation as S4.2/S4.4/S4.5). TDD followed for the pure builders (`automations.ts`, written and tested first); not followed for the UI/Playwright layer, same disclosed deviation as S4.5. The "suggests S4.4's makeLight instead" rule is a non-blocking hint shown for a single-target light selection — the automation button stays clickable, matching the spec's word "suggests". Full suite green: 827 vitest (26 files), 406 Playwright (1 skipped), lint/tsc clean, build clean, `grep hass-write dist/editor.html` finds nothing.

### S4.7 Room box
- Outcome: selecting a room or zone shows everything HA has in its area, not only what is drawn.
- Files: `src/editor/panels.ts`, `src/editor/panel.ts`, `tests/editor/organise.spec.ts`.
- Interface: below the room panel, a box "In Home Assistant" lists the area's entities grouped by domain: devices (placed ones marked), helpers (`input_*`, `group`, `switch_as_x` lights), automations, scripts, scenes. A scene row has "Run" (`scene.turn_on`). Each row opens more-info on click. "Add to area..." opens `ha-entity-picker` limited to entities with no area; picking one runs `setEntityArea`. Automations and scripts get "Edit in HA" (navigate to their HA editor).
  Amended by S1.37: a custom room, which has no area and may have an `entity`, shows that one entity's row instead of an area list, with the same more-info click, and the S4.2 button to create an area.
- Test: Playwright with stub registries: the box lists the fixture's entities under the right headings; Run calls `scene.turn_on`; Add to area records the registry update; a custom room with `entity: "sensor.pond"` shows that row and no headings.
- Done when: tests pass.
- Break it: a custom room with no area and no entity shows "No area: set one above" and no list.
- Done, 2026-09-23. Files: `src/core/ha.ts` (`HaBoxRow`/`HaBox`, `roomHaBox`, `HaData.entities[].platform`/`.uid`), `src/core/index.ts`, `src/editor/hass-pickers.ts` (captures `platform`/`unique_id` from the entity registry), `src/editor/hass-write.ts` (`runScene`), `src/editor/panels.ts` (`haBox`/`haRow`), `src/editor/editor-app.ts` (`moreInfo`/`runScene`/`addToArea`), `tests/core/ha.test.ts`, `tests/editor/hass-write.test.ts`, `tests/editor/editor.spec.ts`.
  Deviations: "Add to area..." is a plain `<select>`, not `ha-entity-picker` (deferred to S4.8, same precedent as S4.2's area field). Tests landed in `editor.spec.ts`, not the never-created `organise.spec.ts` (same deviation as S4.2/S4.4/S4.5/S4.6). "Run" does not go through `askHa`, unlike every other HA write here — reasoned as equivalent to an ordinary card tap, not a registry change. TDD followed for the pure `roomHaBox` and `runScene` (written and tested first); not followed for the UI/Playwright layer, same disclosed deviation as S4.5/S4.6. `npm run shots` not run: this task adds only layout CSS (`.habox-h`, `.harow2`), no colour/specificity rules, and touches no `render.ts`. Full suite green: 833 vitest (26 files), 410 Playwright (1 skipped, no `--repeat-each=10` flakes on the 4 new tests), lint/tsc clean, build clean, `grep hass-write dist/editor.html` finds nothing.

### S4.8 Native look
- Outcome: the panel looks like the rest of HA, light and dark.
- Files: `src/editor/panel.ts`, `src/editor/theme.ts`, `tests/editor/theme.test.ts`.
- Interface: `theme.ts` maps every `--fp-*` variable to an HA theme variable (`--primary-color`, `--card-background-color`, `--primary-text-color`, `--divider-color`, `--state-icon-color`, `--error-color`, `--warning-color`, `--success-color`, `--info-color`); the panel sets them on its host and re-applies on `hass.themes` change. Form controls in the panel are HA's own elements when running in HA: `ha-textfield`, `ha-select`, `ha-switch`, `ha-area-picker`, `ha-entity-picker`, `mwc-button`; the standalone build keeps plain HTML controls behind the same panel code (a `pickers` adapter chosen at construction). Panel chrome uses `ha-top-app-bar-fixed` with the sidebar toggle, like HA's own panels.
- Test: unit: the map covers every `--fp-*` in `FLOORPLAN_CSS` (parsed from the string); Playwright in the dev container: screenshots in the default theme and in a dark theme, attached to the PR, no `#rrggbb` in panel CSS except the theme file.
- Done when: tests pass; screenshots reviewed.
- Break it: with `hass.themes` missing (older HA) the map falls back to the `FLOORPLAN_CSS` defaults and the panel still renders.
- Done, 2026-09-23, rescoped. This sketch predates the 2026-09-21 decision ("Themes: blueprint default... Auto is gone", `docs/DECISIONS.md`) that killed automatic HA-following on purpose: blueprint is always the default, `ha` is one opt-in theme among several, and `primary`/`danger`/`warn`/device colours deliberately never follow the dashboard (contrast risk). That decision already built everything the original "Outcome" wanted for the editor's own inner chrome — the `ha` theme, plain HTML controls throughout, `--fp-*` variables everywhere. Confirmed with Diego before building further: no automatic follow, no `ha-top-app-bar-fixed`, no native-widget (`ha-textfield`/`ha-select`/`ha-area-picker`/`ha-entity-picker`/`mwc-button`) swap — that remains a separate, much larger refactor if ever wanted, not attempted here. What was actually missing: `panel.ts`'s own outer wrapper (background/text/accent) followed three Home Assistant CSS variables, hardcoded inline with no test, so nothing stopped it drifting from what it claimed to follow. Files: `src/editor/theme.ts` (`PANEL_VARS`, `panelVar`), `src/editor/panel.ts` (its stylesheet now built from `panelVar`, values unchanged), `tests/editor/theme.test.ts`. `npm run shots` not run: the CSS values are byte-identical to before (asserted exactly, string for string, by the new unit tests), not a fresh colour decision. Full suite green: 836 vitest (26 files, 3 new), 410 Playwright (1 skipped), lint/tsc clean, build clean, `grep hass-write dist/editor.html` finds nothing.

### S4.9 Lock a wall's length (raised by Diego, 2026-09-22)
- Outcome: a wall, door or opening can have its length locked: dragging either endpoint pivots it on an arc of fixed radius around the *other* (unmoved) endpoint, so the length never changes, only the angle. Typing a length while locked still works and changes the length. Typing a length on an unlocked segment locks it, by default. A locked segment must be unlocked to be dragged freely (shorter or longer); the length can always be typed regardless of lock state.
- Files: `src/core/schema.ts` (`locked?: boolean` on `Wall`, `Door`, `Opening`), `src/editor/ops.ts` (`pivotOnArc`: projects the dragged point onto the circle centred on the fixed endpoint, radius = the segment's length when locked), `src/editor/editor-app.ts` (`onMove`'s `"corner"` case for walls and openings, `"dend"` case for doors), `src/editor/panels.ts` (`lockField` checkbox next to each length field in `wallPanel`, `doorPanel`, `openingPanel`), `tests/core/schema.test.ts`, `tests/editor/ops.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: a "length locked" checkbox in the wall, door and opening panels, next to the length field. Ticking it locks at the current length. Typing a number sets the length and ticks the box. Unticking frees it for an ordinary length-changing drag.
- Decided, 2026-09-22: dragging a locked endpoint moves it on an arc of fixed radius (the far end is the pivot, length is the radius) — Diego's own words.
- Out of scope, decided while building: room/zone polygon edges (`edgePanel`), `Extra` (no panel or selection exists for it), and the `{a,b}` `Device` variant (a heater run drags as a rigid whole body only; its length is already preserved). See `docs/DECISIONS.md`, 2026-09-22.
- Test: TDD, failing test first — done. `pivotOnArc` unit tests, schema `locked` validation tests, and four Playwright tests: a locked wall's drag stays on the arc (far end fixed, length fixed within rounding); typing a wall's length locks it and unticking frees a normal drag; a locked door's drag arcs; a locked opening's drag arcs.
- Done. Full suite green: 736 vitest, 361 Playwright, 24 pytest, tsc and eslint clean.

### S4.10 Track what the app created in HA, for cleanup (raised by Diego, 2026-09-22)
- Outcome: every area, helper, or automation floorplan-studio creates in HA is discoverable and can be found again from the editor, so deleting it locally does not orphan it in HA. Deleting something locally never deletes it in HA — it only disconnects the plan from it. A separate, explicit action removes the HA side. Scoped to the whole HA instance, not just the current plan: an item orphaned by a plan edit (its device removed from the floor, its room deleted) still shows up, which is the point — that is exactly the cleanup case.
- Design settled, 2026-09-22 (was open, now resolved): the area registry supports `labels` the same way entities and devices do (`config/area_registry/create`/`update` both take an optional `labels` list — confirmed against Home Assistant's own docs, developers.home-assistant.io/docs/area_registry_index and home-assistant.io/docs/organizing/labels). So every kind S4.10 needs to track — helper, area, automation — carries the same `floorplan-studio` label, no separate naming convention or local record needed. `createArea` (S4.2, not yet built) and `createAutomation` (S4.6, not yet built) must call `ensureLabel` and set `labels: [labelId]` on the row they create, exactly as `createHelper` already does (S4.1's stated rule, now made concrete for these two).
- Files: `src/editor/hass-write.ts` (`listLabelled`, `removeLabelled`; `createArea`/`createAutomation` gain the label-setting call when they are built in S4.2/S4.6), a new "Home Assistant" toolbar menu item in `src/editor/panels.ts` or `editor-app.ts`, `tests/editor/hass-write.test.ts`, `tests/editor/editor.spec.ts`.
- Interface:
  ```ts
  export type Labelled = { kind: "helper" | "automation" | "area"; id: string; name: string; entityId?: string };
  export async function listLabelled(hass): Promise<Labelled[]>;   // ensureLabel, then filters config/entity_registry/list, config/device_registry/list and config/area_registry/list rows whose labels include that id
  export async function removeLabelled(hass, item: Labelled): Promise<void>;  // helper: config_entries/delete(entry_id); automation: DELETE config/config/automation/config/<id>; area: config/area_registry/delete
  ```
  A `kind: "helper"` row is one whose entity or device carries a `config_entry_id` (every helper `createHelper` makes is config-entry backed: `switch_as_x`, `group`); its `id` is that entry id. `kind: "automation"` rows come from the automation domain's own entities (still label-filtered from `entity_registry/list`, `entityId` set, `id` is the automation's own id used in the delete URL). `kind: "area"` rows come straight from `area_registry/list`. The "Home Assistant" menu shows the list grouped by kind, each row a name, an "Open in HA" link (more-info for an entity, `/config/areas/area/<id>` for an area), and "Remove from Home Assistant" (the shared `confirm` dialog, ends "Home Assistant cannot undo this."). Removing a *plan* item (room, device) is unchanged: it only ever edits the plan; this menu is the one place that touches HA's own registries for cleanup.
- Test: TDD, failing test first: stub `hass` with `config_entry_id` on a helper's registry row — `listLabelled` returns it as `kind: "helper"`; a stub area row with the label returns as `kind: "area"`; `removeLabelled` on each kind sends the documented call; after S4.4 creates a helper in a Playwright test, the Home Assistant menu lists it, Remove asks then the delete call is recorded and the row is gone on reopen; a plan device removed from the floor (S1's Remove from plan) leaves the HA entity alone and it is still listed until explicitly removed here too.
- Done, 2026-09-22. `tests/editor/hass-write.test.ts` (13 new assertions across 3 `it`s), `tests/editor/editor.spec.ts` (2 new tests). Deviation from the sketch above: `listLabelled` reads `config/entity_registry/list` and `config/area_registry/list` only, not `device_registry` — `createHelper` (S4.1) labels the helper's *entity*, never its device, so a device scan would never find anything; adding it back is a one-line change if `createArea`/`createAutomation` (S4.2/S4.6, still unbuilt) ever label a device instead. The "Open in Home Assistant" link for an entity dispatches a bubbling, composed `hass-more-info` event (HA's own event for opening more-info, reaches the real frontend because panel_custom elements render directly in its DOM, not an iframe) rather than a URL, since more-info is a dialog, not a page. The Home Assistant menu only appears when `writer` is set (same rule as every other write-capable control), matching the confirm-dialog "Home Assistant cannot undo this" convention. Full suite green: 739 vitest, 363 Playwright, 24 pytest, lint/tsc clean.

### S4.11 Menus: a few root items, submenus for detail (raised by Diego, 2026-09-22)
- Outcome: the toolbar reads as a few root menus, each opening a submenu for its detail, instead of one flat list per root menu. Diego's example: Add > Zone > Room/Area/... Pure reorganisation of what already exists (Add, Draw, Device, View, File); no new capability here — S4.12/S4.13's "Add area" tool and S4.17's right-click menu are what actually add new items, and should land in the structure this task settles.
- Files: `src/editor/editor-app.ts` (the `render()` toolbar, `<details class="menu">` blocks), `tests/editor/editor.spec.ts` (every existing `#addWall-wall`, `#drawZone`, etc. locator moves under a submenu — a mechanical but wide test update, same shape as the S4.9 demo-floor fixture pass).
- Interface: to settle before building — nested `<details>` (a submenu inside Add's box) is the natural HTML fit and keeps every existing element id, so `page.locator("#addWall-wall")` keeps working; needs a click-outside/Escape check so a submenu does not trap focus. Proposed grouping, for review: Add > Door/Window/Opening (openings), Add > Wall (kind submenu, as today), Add > Zone/Structure/Stairs (areas), Add > Furniture (unchanged). Draw and Device stay flat (they are already one coherent group each). View and File stay flat.
- Test: Playwright: every existing Add-menu locator still finds its button (now one submenu-open click deeper); keyboard reaches every item in DOM order; closing the root menu closes any open submenu.
- Done, 2026-09-22. Built as proposed, confirmed by Diego before starting: Add > Openings (Door/Window/Opening), Add > Wall (kind submenu, unchanged), Add > Areas (Zone/Structure/Stairs), Add > Furniture (unchanged, flat). Draw/Device/View/File left flat, as planned. Implementation reused the existing `#devcols` inline-accordion pattern (nested `<details class="sub">` flowing under its summary) rather than an absolutely-positioned overlay, which sidesteps the focus-trap risk the interface note flagged — there is no floating layer to trap. Added `closeSubs()`, called from both `onWindowClick` branches and `closeMenus()`, so closing a root menu always collapses any submenu inside it (verified load-bearing: removing the two call sites made the new "closing Add by an outside click" test fail with the exact expected assertion, then restored). Every existing element id kept (`#addDoor`, `#addWall-<kind>`, `#addZone`, `#addStairs`, etc.), so no locator broke by id, only by nesting depth — ~30 Playwright call sites updated via two new helpers (`addSubFor`, `addItem`) plus four thin wrapper redefinitions. Three new Playwright tests: grouping + every id still reachable one level deeper; outside-click collapses an open submenu so reopening starts collapsed; Tab/DOM order reaches every item across all three submenus plus Furniture. Full suite green: lint clean, 739 vitest (unaffected), 366 Playwright passed / 1 skipped (up from 363/1). Visually verified in a live dev-server render: Add menu shows the three collapsed submenu rows plus Furniture; opening Openings expands inline; closing via outside click and reopening starts collapsed, matching the automated test.

### S4.12 An "area" drawing tool, separate from a zone (raised by Diego, 2026-09-22)
- Outcome: a new Add item draws a dotted-boundary area (draggable, resizable like a room), with a name field and an optional link to an existing HA area — the same linking S4.2 gives a room. Diego's wording keeps "area" and "zone" as separate words; needs one clarifying question before this is written up as its own interface: is this a new `RoomKind` alongside `"zone"`, or is it that `"zone"` already *is* this and the ask is really "make zone drag/resize/link work" (see S4.13, which is exactly that report). No schema or interface written yet — do not build from this bullet alone.
- Not started. Blocked on the question above.

### S4.13 A structure line ("boiler + tank", "tech area") could never be selected, on any floor (found investigating Diego's report, 2026-09-22)
- Bug report was "the ones in basement I cannot do anything with them" and read at first like a zone-selection bug (zones already work: `roomPanel`, the `"room"` hit case, `.room{pointer-events:all}` all do the right thing). The real defect was in `Extra` — the free-standing annotation kind used for things like a boiler or a tech area — which had zero entry in the `Hit`/`Sel` type system: no selection, no panel, no delete, ever, on any floor. Root cause in `render.ts`: the `.extra` CSS rule had `pointer-events:none` and the shapes carried no `data-ex` attribute, so an extra's own body could never receive a click, regardless of paint order or what was under it. Separately, the specific "wall I can't delete" report turned out to be a data/UX ambiguity (a loose `Wall` sitting almost exactly on a room's own boundary edge), not a code defect — no fix needed there.
- Fix: `.extra{pointer-events:all}` (matches `.room`'s own rationale), `data-ex` on both extra shapes, `"extra"` added to `Hit`/`Sel`, a panel (name, length, Delete), whole-body drag reusing the existing loose-entity (`LooseRef`) pattern already used for walls, and auto-select on finish (matching Opening's behaviour, which extras previously did not have). Verified load-bearing: reverting the CSS/attribute change makes the new Playwright test fail again.
- Done. Landed on `task/S4.13`.

### S4.14 A palette of existing HA entities to place onto the plan (raised by Diego, 2026-09-22)
- Design interview, 2026-09-22: click-to-place, not real drag-and-drop — every existing placement path (the Device menu, S4.18's add-from-area) is click, spawn, then drag into position, and there was no pointer-drag precedent anywhere in the editor worth inventing new gesture code to break. The palette lives as a new "Entities" item in the Add menu's existing submenu row (Openings/Wall/Areas), not a new root toolbar menu — Add is already "things that create something new", which this is. Keep S4.18's right-click "Add device from `<area>`" as it is, alongside the new palette: it's the fast, room-scoped shortcut for the common case; the palette is the general one (any entity, any area, no room needs to be drawn or right-clicked first).
- Outcome: Add > Entities lists every HA entity that is neither a device on any floor nor already in `layout.catalog` — grouped by guessed `DeviceType` (`typeForEntity`), searchable by name or entity id, each row showing its HA area name when it has one. Clicking an entity places it: at the centre of a room on the current floor whose linked area matches the entity's, when one exists (same as S4.18's add-from-area), else at a spawn point clear of everything already on the floor (the same fallback `placeDevice`/`addFurniture` use) — one undo step, via the new `EditorState.addEntity`.
- Files: `src/core/ha.ts` (`unplacedHaEntities`), `src/editor/state.ts` (`addEntity`, and `addFromArea`/S4.18 refactored onto a shared private `addHaEntity` so both build the same catalog-entry-plus-device mutation), `src/editor/editor-app.ts` (the `addEntSub` submenu markup, `onAddEntToggle`/`onAddEntSearchKey` mirroring the Device menu's own search-field pattern, `addHaEntity` click handler), `tests/core/ha.test.ts`, `tests/editor/add-entity.test.ts` (new), `tests/editor/editor.spec.ts` (3 new).
- Test: TDD throughout — `unplacedHaEntities` (3 vitest cases) and `EditorState.addEntity` (3 vitest cases) were written and run first, watched fail (`is not a function`) before being implemented; the refactor that let `addFromArea` share `addEntity`'s mutation code was verified against its own pre-existing 2 tests, unchanged, both still green. The 3 Playwright tests (palette absent with no Home Assistant / grouped and filtered by search / places at a room's centre or falls back, one undo step) were written and run first too, run `--repeat-each=10` clean (30/30) once green.
- Done, 2026-09-22. Visually verified: a throwaway Playwright script (not committed) screenshotted the open palette against the demo layout, confirmed the same grouped/searchable shape as the Device menu, then was deleted — the project's own `npm run shots` only captures the editor's default closed-menu state, so it never touches this markup and correctly reported "identical to baseline". (Checking this by hand on `npm run dev` first hit the maintainer's real house layout, restored from that origin's own `localStorage`/on-disk `layout.json` — not the demo — so that route was abandoned without further interaction, in favour of the isolated `/standalone.html` Playwright harness that forces the demo layout explicitly.) Full suite green: lint/tsc clean, 770 vitest (8 new), 384 Playwright passed / 1 skipped (3 new), production build clean.

### S4.15 Auto-place entities HA already has configured in an area (raised by Diego, 2026-09-22)
- Outcome: a button that looks at a room's linked HA area (S4.2) and places every entity HA already has in that area onto the room automatically, instead of dragging each one from S4.14's palette by hand. Depends on S4.14 existing first (same underlying "HA entity → plan device" placement code), and on S4.2 (a room's `area` link) to know which entities belong where.
- Outcome: the room panel shows "Place N Home Assistant devices of this area" when the room has a linked area and Home Assistant has entities in it that are neither drawn nor catalogued. One click places them all, one undo step, via `EditorState.placeArea` (the list is `areaToPlace`, built on S4.14's `unplacedHaEntities`). They take the free cells of a 60 cm grid about the room's centre, nearest first: inside the room, never the centre itself (the room label sits there), never within 42 cm of a device already on the floor. A room too small shrinks the grid to 10 cm; past that the rest stack on the centre. Nothing is written to Home Assistant.
- Files: `src/editor/state.ts` (`areaToPlace`, `placeArea`), `src/editor/panels.ts` (`placeAreaButton`, `PanelCtx.placeArea`), `src/editor/editor-app.ts` (the callback), `tests/editor/place-area.test.ts` (new, 4), `tests/editor/editor.spec.ts` (2 new).
- Test: written first and watched fail (`placeArea is not a function`; the Playwright test found no `#rplace`). The "keep clear" case was added after rendering showed the first version, a plain grid about the centre, sitting on the room label and the existing ceiling light; it failed (31.6 cm < 40) before the fix. Playwright S4.15 tests `--repeat-each=10`: 20/20.
- Done, 2026-09-23. Rendered on `/standalone.html` with five Living entities and looked: a ring round the existing light, no overlaps. Full suite: lint clean, 810 vitest, 391 Playwright passed / 1 skipped, build clean.

### S4.16 Filter the entity picker by floor/room/area (raised by Diego, 2026-09-22)
- Outcome: wherever an HA entity is picked (S4.14's palette; existing entity fields like a custom room's `entity`, a door's sensor/cover), a filter narrows the list by floor, room or area, prefilled to the current floor (removable). Touches `entitiesForType`/`placedEntities` in `core/` and the picker components in `panels.ts`.
- Not started. Needs a design pass once S4.14 exists to pick one filter UI reused everywhere, rather than inventing it per picker.

### S4.17 Confirm and write when a device's area changes, on a general move (raised by Diego, 2026-09-22)
- Checked, 2026-09-22: dragging an already-placed device from one room to another **on the same floor** already asks "Move <name> to area <room>?" and writes on Yes — done in slice 4a (`tests/core/area-move.test.ts`, the three S4.3 tests in `editor.spec.ts`, e.g. dragging the kitchen light into Living asks and moves its device). That half of Diego's ask is already built.
- What is not built, and is a real gap: moving a device **to a different floor**. There is no such gesture at all today — floors are separate views (one `devices` array per floor) and the only "move floor" feature that exists reorders the floor chips themselves, not a device between them. Needs Diego's answer on the interface before this is scoped: cut on one floor / paste on another, a "Move to floor…" panel action with a floor picker, or drag onto a floor chip.
- Not started. The same-floor case needs no new code. The cross-floor case needs a design question answered first.

### S4.18 Right-click menu on a room, zone or structure (raised by Diego, 2026-09-22)
- Design interview, 2026-09-22: one shared menu list across room/zone/structure (irrelevant items just don't show, not a per-kind menu); Change colour opens the existing room side panel and reuses its own swatches, rather than a new inline popover; a minimal slice of S4.14 ("add an entity from the room's HA area") ships now instead of waiting on the full palette; and — a risk raised mid-design, since several HA domains (`climate`, `switch`, `media_player`) are genuinely ambiguous and nothing could fix a wrong guess once placed — the device panel gets a permanent type selector, so any device's type can be corrected after the fact, whatever set it wrong.
- Outcome: right-clicking a room, zone or structure selects it (opening its side panel) and opens a small popup at the pointer with Change colour, Delete, and — when the room has a linked HA area — an "Add device from `<area>`" section listing that area's entities not yet on the plan; picking one calls the new `EditorState.addFromArea`, which places it as a new device at the room's centroid and a new `layout.catalog` entry, one undo step, type guessed by the existing `typeForEntity`. Separately, `devicePanel` gains a permanent type `<select>` (`deviceTypeField`) that changes a device's type and drops the fields the old type used that the new one doesn't (`bound` for light; `trvs`/`tempSensors` for heater; `linked` for ac), one undo step.
- Files: `src/editor/state.ts` (`addFromArea`), `src/editor/panels.ts` (`deviceTypeField`), `src/editor/editor-app.ts` (`ctxMenu` state, `openCtxMenuAt`/`closeCtxMenu`/`ctxDelete`/`addFromArea`/`ctxMenuView`, `.ctxmenu` CSS, the `"pan"` drag variant gaining `button`/`moved`), `tests/editor/add-from-area.test.ts` (new), `tests/editor/editor.spec.ts` (6 new: type selector + 5 context-menu tests).
- Two platform bugs found and fixed, not worked around: (1) `onDown` already calls `preventDefault()` on every right-button `pointerdown` (so a right-drag pans), which also suppresses the browser's own subsequent `contextmenu` DOM event — so the menu can't hook `@contextmenu` at all; it's opened instead from `onUp` on a stationary right-button press-release (mirroring how a left-click "room" drag already tells a click from a drag via `moved`). (2) `svg.setPointerCapture` on `pointerdown` makes every later pointer event's `ev.target` report the captured `<svg>`, not the element under the cursor — hit-testing at `pointerup` uses `(this.renderRoot as DocumentOrShadowRoot).elementFromPoint(clientX, clientY)` instead. A third, smaller bug: the right-click path never focused the host element, so Escape (which the editor's `keydown` listener only receives when the host has focus) silently did nothing until `openCtxMenuAt` added an explicit `this.focus()`.
- Test: TDD throughout — `addFromArea`'s 2 vitest cases and `deviceTypeField`'s Playwright test were written and run first, watched fail for the right reason, then implemented. The 5 context-menu Playwright tests followed the same order once the menu's shape was fixed by the design decisions above. The gesture-detection test (stationary right-click opens the menu) was run `--repeat-each=10`, 60/60 clean.
- Done, 2026-09-22. `npm run shots` run and looked at: reported `editor-blueprint`/`editor-light`/`editor-ha` differing from the local baseline, traced with a pixel-diff crop to the toolbar's Undo/Redo buttons (S4.23, already landed before this task) — the local baseline just predated that commit and had never been refreshed; not a regression, confirmed by eye, baseline re-accepted. Full suite green: lint/tsc clean, vitest and Playwright (incl. the 6 new tests) both pass with no regressions.

### S4.19 More floor textures, and let a room scale its own (raised by Diego, 2026-09-22)
- Design interview, 2026-09-22: a slider next to S4.22's rotation slider (25–200%), not a numeric board-width field — one input pattern for both, no new unit conversion. Four new textures: herringbone wood, parquet wood, terracotta tiles, a classic checkerboard — the spread already sketched below.
- Outcome: `TEXTURES` grows from 7 to 11 (5 wood, 5 stone/tile, 1 checkerboard); a room or staircase's texture reference grows `textureScale?: number` (0.25–2, 1 or omitted never stored, mirroring `textureRot`), set by a second slider in the paint panel right under rotation. `Texture` itself grows explicit `w`/`h` (each factory's tile's own natural size), replacing the old `id.startsWith("wood")` guess `texturePatterns` used to pick a tile size — a real fix, not just plumbing for scale. A scaled pattern gets its own `<pattern>` (id suffix `-s<percent>`, e.g. `-r90-s150` when rotated too) sized `w*scale`/`h*scale` with a `viewBox="0 0 w h"` mapping the tile's own content onto the new size, exactly as `-r<rot>` already works for rotation. `EditorState.paint()`'s `{ texture, rot, scale }` and a new `scaleTexture(on, i, scale, phase)` live/commit gesture (mirroring `rotateTexture` exactly) drive it.
- Files: `src/core/textures.ts` (`Texture.w`/`h`, `herringbone`/`parquet`/`checker` tile factories, 4 new entries, `normTextureScale`, `texturePatternId`/`texturePatterns` taking scale), `src/core/schema.ts` (`Room`/`Stairs.textureScale?`, validated to [0.25, 2]), `src/core/render.ts` (`paintAttr`, the `textured` map), `src/editor/state.ts` (`paint()`'s `scale` option), `src/editor/editor-app.ts` (`textureScaleGesture`, `scaleTexture`), `src/editor/panels.ts` (`PanelCtx.scaleTexture`, the scale slider), `tests/core/paint.test.ts` (8 new), `tests/editor/editor.spec.ts` (5 new S4.19 tests, plus the S1.35 swatch-count test repointed from 7 to 11 textures — Finding #19).
- Test: written after the implementation, not before — a process shortcut, said plainly rather than claimed as TDD; confirmed load-bearing immediately after by stashing the six source files and re-running the 5 new Playwright tests, all 5 failing (4 on a missing `#rscale`, 1 on the missing new swatches), then restored. The gesture test (`dragging the scale slider…`) run `--repeat-each=10`, 10/10 clean.
- Done, 2026-09-22. Visually verified: a throwaway Playwright script (not committed) against `/standalone.html` painted a room with each of the four new textures and the checkerboard at 200% scale, screenshotted, looked at, then deleted along with the screenshots — checkerboard scaling is obviously correct (visibly larger squares), terracotta reads clearly, herringbone and parquet are schematic (matching the project's existing minimalist grain/grout-line style) but legible as a textured, non-flat floor. Full suite green: lint/tsc clean, 776 vitest (8 new), 389 Playwright passed / 1 skipped (5 new, plus the S1.35 fix), production build clean.

### S4.20 File, Export: download the layout JSON directly, from any host (raised by Diego, 2026-09-22)
- Outcome: a File, Export… button downloads the current layout as JSON straight from the browser, independent of `save-request`. Closes a real gap: in the HA panel, Save writes to `.storage` and never downloads, so there was no way to get the JSON out of the panel at all; in the standalone host, Save already downloads (this duplicates it there, harmlessly — the button means the same thing everywhere).
- Files: `src/editor/editor-app.ts` (`exportJson()`, a `Blob`/`URL.createObjectURL`/anchor-click, no host or event involved), `tests/editor/editor.spec.ts`.
- Done, 2026-09-22. Filename `floorplan-studio-<ISO date>.json`. Test proves the download's content matches the live layout and that no `save-request` fires (verified load-bearing: removing the button made the test fail on the `waitForEvent("download")` timeout, then restored). Full suite green: lint/tsc clean, 739 vitest, 367 Playwright passed / 1 skipped. Visually verified live: Export… sits between Open… and Load demo in the File menu.

### S4.21 A colour-role system for themes, and new presets (raised by Diego, 2026-09-22)
- Outcome: a new module, `src/core/theme-roles.ts`, generates a theme's full `--fp-*` token set from four roles — a `base` hue shaded across every structural surface, a `fg` colour for text/icons/detail, a `line` colour for the measurement grid, and a saturated `accent` for anything "on" or "live" — instead of ~50 independent hexes per theme. A device's colour defaults to the accent (Diego: "collapse to one accent"); a theme's role definition may override specific device/entity types via an optional `devices` map when it wants them to stay distinct (Diego: "in the theme config allow for each device and entity type to have his colour"). Three new role-generated themes: `blueprint` (Diego's brief — dark blue base, white foreground, terminal-green grid, orange accent; replaces the old default), `slate` (light grey) and `terminal` (near-black, terminal green). A fourth new theme, `solarized`, is bespoke, not role-generated — the real Solarized dark palette, each device type kept in its own hue as the worked example of the `devices` override. The project's first dark theme is renamed `midnight`, keeping its old hex values exactly, so nothing already built on it moves. `ha` is untouched by this system (Diego confirmed): its fallback is still midnight's fixed hexes, not blueprint's new palette. Warn, danger, primary and their on-dark/on-light text stay one fixed pair across every theme, generated or not — folding them into the accent was tried and reverted (see below).
- Files: `src/core/theme-roles.ts` (new — `ThemeRoles`, `rolesToTokens`, a dependency-free hex↔HSL shader), `src/core/render.ts` (`THEMES`/`Theme` grows to seven; `MIDNIGHT_TOKENS` (ex-`DARK_TOKENS`), `BLUEPRINT_TOKENS`/`SLATE_TOKENS`/`TERMINAL_TOKENS` via `rolesToTokens`, `SOLARIZED_TOKENS` bespoke; `FLOORPLAN_CSS` gains a `[data-theme]` block per new theme), `src/editor/editor-app.ts` (`THEME_LABELS`), `src/card/floorplan-studio-card.ts` (doc comment), `tests/core/theme-roles.test.ts` (new, 7 tests), `tests/core/render.test.ts`, `tests/card/card.spec.ts`, `tests/editor/editor.spec.ts`, `tests/editor/theme-css.spec.ts` (repointed to the renamed `midnight` id or the new `blueprint` hexes, whichever the test was actually pinning).
- Test: TDD for the generator (`tests/core/theme-roles.test.ts`, written and run first). Load-bearing verification: reverting the device-colour collapse (`devFor` falling back to a fixed colour instead of `roles.accent`) failed the "collapse to accent" test, then was restored. `npm run shots` run and looked at: the blueprint card and editor render as a legible dark-blue plan with a white foreground, a faint green measurement grid and orange "on" icons — matches Diego's description.
- Opus review, mid-task: the first pass folded `warn`/`danger`/`primary`/`on-dark`/`on-light` into the accent role too, on the reasoning that they were "live" UI. That broke the Delete/warn button's contrast (2.1:1 white-on-orange, caught by the existing `every .btn keeps at least 4.5:1` test) and repainted every themed warn/danger button project-wide, which was never asked for — Diego's brief was about the plan's own colours (walls, doors, devices), not UI chrome. Fixed by keeping those five tokens a fixed literal pair in `rolesToTokens`, exactly as `MIDNIGHT_TOKENS`/`LIGHT_TOKENS` already had them.
- Done, 2026-09-22. Full suite green: lint/tsc clean, 747 vitest (7 new), 368 Playwright passed / 1 skipped.
- Follow-up, same day (Diego, after seeing the built editor): seven flat chips crowded the View menu, the same problem Openings/Wall/Areas solved for Add in S4.11. The theme picker moved into its own `Theme` submenu (`<details class="sub" id="thSub">`), summary text showing the current theme. Fixed a real bug this surfaced: a "keep" theme button never auto-closes its menu, and closing `View` by clicking its own summary again (the one route `onWindowClick` does not cover) left the Theme submenu open underneath — the next `setTheme` in a test then clicked it shut instead of open. Fixed with an `onOptToggle` handler on `#mOpt` that closes its subs whenever the menu itself closes, mirroring the existing `onDevToggle` pattern. Files: `src/editor/editor-app.ts` (`onOptToggle`, `#thSub`), `tests/editor/editor.spec.ts` (`setTheme()` opens `#thSub` first; the S2.12 direct-assertion test does the same). Full suite green after the fix: lint/tsc clean, 747 vitest, 368 Playwright passed / 1 skipped, the fixed test also run `--repeat-each=10` clean.

### S4.22 A texture's own rotation, with a slider in the paint panel (raised by Diego, 2026-09-22)
- Outcome: a room, zone or staircase painted with a texture (S0.5.2) can rotate that texture independently of the shape itself, 0–360° in 1° steps (Diego's explicit choice, over a recommended 0–90°/15°). Furniture is untouched — it has no fill/texture concept, only tinted line-art icons, and Diego confirmed the scope is rooms/stairs only. `Room`/`Stairs` gain `textureRot?: number`, `[0, 360)`, present only alongside a `texture` and never stored at 0 (matches the project's "don't write the default" convention). The paint panel shows a range slider once a texture is chosen; dragging it live-previews the rotation (`EditorState.replaceFloor`, no undo step per tick, the same pattern a mouse-dragged corner uses) and releasing it commits the whole drag as one step, via a new `EditorState.commitLiveEdit(before)` — none if it ended back where it started.
- Files: `src/core/schema.ts` (`textureRot` on `Room`/`Stairs`, `validate()`), `src/core/textures.ts` (`normTextureRot`, `texturePatternId`, `texturePatterns()` now takes `{id, rot}` pairs and only declares the rotations in use — the plain, unrotated pattern id is unchanged, so nothing already pinned to it breaks), `src/core/render.ts` (`paintAttr` builds the rotated fill url), `src/editor/state.ts` (`paint()` takes an optional `rot`, `commitLiveEdit`), `src/editor/editor-app.ts` (`rotateTexture`, the slider's live/commit gesture), `src/editor/panels.ts` (the `#<id>rot` slider, shown only when a texture is set), `tests/core/paint.test.ts` (5 new tests, written and run first, confirmed failing), `tests/editor/editor.spec.ts` (4 new Playwright tests: appears/disappears with the texture, live preview + one undo step, no step when a drag ends where it started, survives a save/reload).
- Test: TDD — the 5 vitest cases were written and run against no implementation first; 4 failed for the expected reasons (`commitLiveEdit` missing, `rot` silently dropped, no rotated `<pattern>`), 1 passed incidentally (pure schema validation, correct on first write). The "ends where it started" Playwright test was run `--repeat-each=10` clean.
- Done, 2026-09-22. `npm run shots` run and looked at (the demo paints no texture by default, so the shots show no visual change; a manual room painted "Light wood" and dragged to 35° in a live preview showed the board grain turn correctly). Full suite green: lint/tsc clean, 752 vitest (5 new), 372 Playwright passed / 1 skipped (4 new, incl. `--repeat-each=10` on the no-op-drag case).

### S4.23 Undo/Redo move to the toolbar (raised by Diego, 2026-09-22)
- Outcome: Undo and Redo, previously two buttons inside the File dropdown (open File, then click), now sit as standalone buttons in the top toolbar, right after the Home Assistant menu (or after File when there is no Home Assistant menu — standalone builds have no `writer`), separated by a new vertical rule (`.vsep`). Styled `.btn.light`: same computed colour and background as every other `.btn` (so the pinned S1.53 contrast-pair test still passes — Finding #10's lesson, a class that changes `background`/`color` needs a `getComputedStyle` pair, so this one deliberately leaves them alone), lighter only via `opacity:.6` (`1` on hover/focus), which does not change the computed style values the contrast test reads.
- Files: `src/editor/editor-app.ts` (moved `#undo`/`#redo` out of `#mFile`'s box, `.vsep`/`.btn.light` CSS), `tests/editor/editor.spec.ts` (one new test: not inside `#mFile .box`, visible with no menu open, `.light` class, still undo/redoes an edit).
- Test: TDD — the test was written and run first, failed on the "not inside `#mFile .box`" assertion (the buttons hadn't moved yet). The ~15 existing tests that called `menu(page, "File")` before clicking `#undo`/`#redo` needed no changes: opening File is now just an unrelated no-op before a click on an always-visible button elsewhere, and the ids stayed the same.
- Adversarial: the first version used `background:transparent;color:var(--fp-idle)`, which read as "lighter" but broke the S1.53 contrast test (2.88:1, transparent resolves to black for the ratio check) — caught by running the full suite, not just the new test, before calling it done. Fixed with `opacity` instead.
- Done, 2026-09-22. Full suite green: lint/tsc clean, 752 vitest (unchanged), 374 Playwright passed / 1 skipped (1 new, `--repeat-each=10` clean). Visually confirmed in the running editor: `#undo` computed `opacity:0.6` against `#mFile summary`'s `1`, same `background-color`/`color` on both.

### S4.24 Multi-entity attach: door/window sensors, locks, curtains; heater and AC bindings (raised by Diego, 2026-09-22)
- Outcome: a door or window attaches more than one contact sensor, more than one vibration sensor, and more than one smart lock (`Door.sensor: string` became `Door.sensors: string[]`, plus new `vibration`/`locks: string[]`; `migrate()` wraps an old single value and always drops the old key). A door's `cover` (curtain/blind) went from free text to a proper `<select>` filtered to `cover`-type catalog entries — offered on every door kind, not restricted to glass/window as first drafted, because the demo's own "Garage door" (`kind: "door"`) already uses `cover` for a garage opener; the field just carries the label "electric curtain" on a glass door or window and "cover" everywhere else. A heater attaches several TRV/climate entities and several temperature sensors (design interview, 2026-09-22: TRV + temp sensor only, no open-window cutoff — considered and declined). An AC attaches several AC-or-TRV entities to one `linked` list. Every one of these is multi-attach, not the single-entity `bound` pattern the light uses (Diego, 2026-09-22), so all five are one reusable "attach several entities, filtered by type" panel component (`multiAttachField` in `panels.ts`) — an add-select of not-yet-attached catalog entries plus one removable row per attached entity, each add and each remove its own undo step.
- New `DeviceType`s: `lock` (smart door latch) and `vibration` (distinct from `motion` — a door/window vibration sensor is a different HA `device_class`, not room presence), each with an icon, a `TYPE_LABELS` entry, and a default colour, following Finding #17 (every enum member is a decision, not a fallthrough) — including the CSS `.dev-lock.on`/`.dev-vibration.on` pair and the `DEVICE_COLOURS`/`DEVICE_ICONS` `Record` entries TypeScript forced.
- Files: `src/core/schema.ts` (`Door.sensors`/`vibration`/`locks: string[]`, `Device.trvs`/`tempSensors`/`linked: string[]`, `DEVICE_TYPES` gains `lock`/`vibration`, the `entityList` validator, `migrate()`'s `sensor` → `sensors` step), `src/core/icons.ts`, `src/core/render.ts` (`DEVICE_COLOURS`, the shared `.dev.on` CSS block, the door-open check now checks `sensors.some(...)`), `src/card/actions.ts` (door tap reads `door.sensors[0]`), `src/editor/state.ts` (`doorAttachChoices`, `coverChoices`, `deviceAttachChoices`, replacing the old single-entity `sensorChoices`), `src/editor/panels.ts` (`multiAttachField`, `doorPanel` rewritten, new `heaterFields`/`acField`), `demo/layout.json` (three doors' `sensor` → `sensors`), `tests/core/schema.test.ts`, `tests/core/icons.test.ts`, `tests/card/actions.test.ts`, `tests/editor/state.test.ts`, `tests/editor/editor.spec.ts` (the old single-sensor-picker test rewritten for multi-attach; two new tests for door vibration/locks and heater temp sensors).
- Test: TDD from `schema.ts` outward — `validate()`/`migrate()` cases written and run first, then `EditorState` choice helpers, then the panel UI, then the downstream `render.ts`/`actions.ts` consumers. Load-bearing checks: the door-sensor Playwright test was fully rewritten (not patched) because the interaction model changed from a persistent `<select>.value` to an always-reset add-select plus remove rows; the heater test presses Control+z twice to confirm one undo step per attach/remove, not one for the pair.
- Adversarial, self-caught: the first `cover` validator restricted it to `kind === "glass" | "window"`, matching the request's literal wording — this broke the demo's pre-existing "Garage door" (`kind: "door"`, has a legitimate `cover` for its opener). Caught by inspecting the fixture before running tests, not by a failure. Reverted: `cover` stays valid on every door kind, as it always was; only the UI label is kind-dependent. Recorded in `docs/DECISIONS.md`.
- Done, 2026-09-22. Full suite green: lint/tsc clean, 759 vitest (17 new: schema entity-list/gating cases, icon/colour enum coverage), 375 Playwright passed / 1 skipped (3 new/rewritten, each run `--repeat-each=10` clean). `npm run shots` run; the door and heater panels were visually confirmed live in the running editor (front door shows the attached contact sensor with a Remove button and empty vibration/locks add-selects; the garage door shows `cover` labelled "cover", not "electric curtain", with `cover.demo_garage_door` selected; the heater shows empty TRV/temperature-sensor add-selects).

### S4.25 Unlinked (but linkable) devices — heater, ac, boiler, battery, lamp, computer, tv, car, server, UPS, inverter, speaker, 3D printer (raised by Diego, 2026-09-23)
- Outcome: a new "Add > Unlinked device" select places an appliance icon that is not tied to a single entity's on/off state — a heater, ac, boiler, battery, lamp (reuses the `light` icon), computer, tv, car, server, UPS, inverter, speaker or 3D printer. It lives in its own `Floor.unlinked: Unlinked[]` array, not `furniture` (a swappable shape) or `devices` (state-driven): the point is "this is a heater", with a fixed icon from the existing `DEVICE_ICONS` set, not a furniture symbol. It can be scaled (0.25-4x), rotated, given an optional colour override (default idle grey), and named. Zero or more HA entities can be attached for reference — the same `multiAttachField` pattern S4.24 built for door sensors/locks and heater/AC bindings — but `attached` never drives the icon's colour or the card's tap behaviour, unlike a `Device`; there is no on/off state to show because nothing here is one single entity.
- Design calls carried over unchanged from the brief: own schema array (not a furniture symbol, not a `Device` variant); no live-drag gesture machinery — scale/rotation/position are committed fields edited in the panel, same as `furniturePanel`, not a drag handle; selection/highlight draws inside `renderFloor` itself via the existing `.sel` class, parallel to devices, so the editor and the card can never draw it differently (Finding #8, one draw path) — the editor's separate `overlay()` needs no new branch, matching the precedent that devices ("dev") have none either.
- 5 new `DeviceType`s: `boiler`, `car`, `ups`, `printer`, `speaker` (heatpump reuses `ac`; lamp reuses `light`). Icons are real MDI paths fetched from the upstream `Templarian/MaterialDesign` SVGs (`water-boiler`, `car`, `printer-3d`, `speaker`, `power-plug-battery`), not invented, matching how every existing `DEVICE_ICONS` entry was sourced.
- A real defect caught only by rendering and looking (Finding #16), not by the unit test written alongside the feature: the first version copied the device icon's "the group turns by `rot`, but the icon inside turns back so the glyph stays upright" pattern verbatim — correct for a device (a camera's cone should point where `rot` says while its icon face stays legible), wrong here, where nothing else sits in the group to justify the counter-turn. The result was a `rot` field that validated, saved and round-tripped through undo, but never visibly rotated anything. The unit test I wrote alongside the implementation asserted the copied (wrong) behaviour and passed — it took an actual render (a throwaway synthetic-floor script feeding `renderFloor` into a static HTML page, screenshotted, since the shared `demo/layout.json` can't carry sample unlinked items without breaking the `migrate() v1→v2` golden-equivalence test) to see a rotated TV icon sitting perfectly upright. Fixed: an unlinked appliance is a placed object like furniture, not a live-state device — `rot` now turns the glyph itself, with no counter-rotation, matching how `furniture.rot` already behaves. The test was rewritten to assert the glyph rotates (`not.toContain` the counter-turn), and the render snapshot was regenerated.
- Files: `src/core/schema.ts` (`Unlinked` interface, `Floor.unlinked`, `UNLINKED_TYPES`, the 5 new `DeviceType`s, the `each("unlinked", ...)` validate block), `src/core/migrate.ts` (`unlinked` in `KINDS`, `rot`/`scale` defaults), `src/core/icons.ts` (5 `DEVICE_ICONS` entries), `src/core/render.ts` (5 `DEVICE_COLOURS` entries, `.dev.unl path{fill:var(--fp-dev-fill,var(--fp-idle))}`, the unlinked render pass), `src/editor/state.ts` (`"unl"` selection kind, `emptyLayout`/`addFloor` fixtures, `unlinkedAttachChoices`, `newId` collision check), `src/editor/panels.ts` (`unlinkedPanel`: name, colour override + reset, scale, rotate buttons, `multiAttachField`, delete), `src/editor/editor-app.ts` (hit-testing on `g[data-u]`, drag-to-move mirroring furniture, delete on Backspace/Delete, `addUnlinked`, the Add-menu `#addUnlDev` select). `bind.ts`, `card/actions.ts` and `card/floorplan-studio-card.ts` needed no changes — confirmed by reading them, not assumed: `bind.ts` only ever reads `Device.entity`, the card's tap selector (`g[data-x], line[data-d]`) already excludes `g[data-u]`, and the card's render call is generic.
- Test: not strict TDD throughout — tests were written alongside or just after each unit, not before, except where noted. The `schema.ts` validate block was checked with the remove-and-restore technique (8 of 9 new hostile-input tests correctly fail with the block removed); the `render.ts` rotation test used an asymmetric value (33°, not `[1,0]`) and was caught and rewritten once already (see the defect above) after a real render showed it was asserting the wrong thing. No new Playwright drag/select coverage was added for the unlinked item's own interactions (place, drag, select, delete, panel fields) — an acknowledged gap, left for a follow-up task rather than rushed in.
- Three pre-existing Playwright tests pinned counts/DOM order that the new feature legitimately changes and needed updating, not the feature: the Add menu's "only the furniture select is left" assertion (now 2 selects), the Tab-order list of Add items (now ends `..., addFurn, addUnlDev`), and the Device colours row count (22 → 27, Finding #19 style — a new enum member needs its count updated wherever one was pinned).
- Adversarial: fed the `each("unlinked", ...)` validator each of the untrusted-input classes Finding #1 calls out — non-array `attached`, out-of-range `scale`/`rot`, non-`#rrggbb` `color`, an unknown `type` — each rejected without throwing.
- Done, 2026-09-23. Full suite green: lint (`eslint . && tsc --noEmit`) clean, 806 vitest (up from ~780; new: 9 schema, 4 migrate, 10 render, plus the icons/validate-cli fixture fixes), 389 Playwright passed / 1 skipped, no regressions. `npm run shots` run against the real (untouched) demo: identical to baseline — the feature adds no visible change until a layout actually places an unlinked item, confirmed separately via the throwaway render script described above (boiler/speaker/3D-printer idle grey at their set scales, a car rotated 135° and a TV rotated 90° with a blue colour override, all clearly visible and correctly oriented).

---

## Sprint 5 — content and docs (E5)

### S5.1 Furniture in editor and card
- Outcome: every symbol in `FURNITURE` can be placed, sized, rotated; the card draws them under devices.
- Test: Playwright places each symbol; render snapshot with all symbols.
- Done when: tests pass.
- Break it: rotation 450 is stored as 90.
- Done, 2026-09-23. Placing, sizing and rotating furniture, and drawing it under devices, was already built in
  Sprint 4 — this task closed the two acceptance criteria named in its own Test/Break-it lines, which had no
  dedicated coverage yet.
  - Break it (rotation 450 → 90): the editor's rotate buttons (`src/editor/panels.ts`, `furniturePanel`) already
    wrap every commit into `[0, 360)`, so 450 can only reach a layout through a hand-edited file — untrusted
    input per finding #1. Normalised in `migrate.ts` right after the existing furniture `w`/`h` clamp, same
    repair-path pattern: `m.rot = ((m.rot % 360) + 360) % 360`. TDD: `tests/core/migrate.test.ts` got a new
    `describe` (450→90, -30→330, 180 untouched, 360→0), written first and confirmed failing (3 of 4) before the
    fix, then passing (53/53 migrate tests). `validate()`'s own finite-number check on `rot` is unchanged — this
    is a repair path, not a loosened gate.
  - Playwright "places each symbol": `tests/editor/editor.spec.ts` gained "every FURNITURE_SYMBOLS entry can be
    placed from the Add menu, and the layout still validates" (iterates `FURNITURE_SYMBOLS`, asserts the tail of
    `furniture` matches the symbols in order, `validate()` passes) and "a furniture piece rotated past 360 by
    repeated button clicks stays wrapped into [0, 360)" (5 × the 90° button = 450, asserts 90 — the UI-side half
    of the break-it scenario, placement already selects the new item so no extra click is needed before `#fr90`).
    `--repeat-each=10`: 20/20 clean.
  - Render snapshot with all symbols: `tests/core/render.test.ts` got "matches the snapshot for a floor carrying
    every FURNITURE_SYMBOLS symbol" — one piece per symbol, laid out left to right, `toMatchSnapshot()`.
  - Full suite green: 845 vitest (up from 840; +4 migrate, +1 render), lint (`eslint . && tsc --noEmit`) clean,
    build clean, 412 Playwright passed / 1 skipped (up from 410; +2). `npm run shots` not run: nothing here
    touches `render.ts` or a stylesheet, only `migrate.ts` (a data-repair path, not a drawing change) and new
    test coverage.

### S5.2 Prompt (superseded by S5.8, done)
- Outcome: `prompts/trace-from-photos.md` that any of Claude, ChatGPT, Gemini, Grok can follow.
- Content: role; ask two questions first (one known dimension with the wall it belongs to; where north is on the photo); then per floor list rooms, outline, doors, windows in cm, north up, y down, as a v2 layout with `catalog: []`; output JSON only, no prose; a 20-line example; a checklist the model must satisfy before answering (closed polygons, doors on walls, no room outside the outline); stairs: only `straight` and `round` exist, so a curved or angled flight is written as several straight sections placed end to end, each with its own `rot`, and a spiral as `round` with an outer and an inner diameter.
- Test: the maintainer runs it on the private photos with Claude; the JSON passes `validate()` and opens in the editor. Record model, date and pass/fail in `prompts/RESULTS.md` (no photos, no layout).
- Done when: one recorded pass; README section matches the prompt.
- Break it: the prompt tells the model what to do when it cannot read a dimension: write `null` and list it under `"unknown"`, not guess.

### S5.3 Docs
- Outcome: `docs/schema.md` (generated from `schema.ts` comments), `docs/card.md`, `docs/editor.md` with screenshots, `CONTRIBUTING.md`.
- Test: `npx markdown-link-check docs/*.md README.md` clean.
- Done when: link check passes; screenshots are of the demo, not a real house.
- Done, 2026-09-23.
  - `docs/schema.md` is generated, not hand-written: `scripts/gen-schema-docs.mjs` walks
    `src/core/schema.ts`, pairs every exported interface/type/const with the `/** ... */` comment directly
    above it, and emits one section per pair — comment as prose, the real declaration as a `ts` code block.
    `npm run docs:schema` regenerates it; it is a no-op when nothing changed (checked). TDD: `tests/core/gen-schema-docs.test.ts`
    was written first, including a "break it" case that caught a real bug in the first version — a
    multi-line interface (`Floor`) whose "end of declaration" check required a trailing `;` kept reading
    past its own closing `}` into the next declaration's comment and body (`CatalogEntry`, then the `isObj`
    helper leaked into `Floor`'s code block). Fixed by ending a brace/bracket block the moment it balances
    to zero, semicolon or not; a brace-free declaration (a bare union) still ends at its first `;`.
  - `docs/card.md`: config keys table, the seven themes, a condensed on/off behaviour summary linking to
    `SPEC.md`'s full table rather than duplicating it, a troubleshooting section.
  - `docs/editor.md`: toolbar walkthrough, side panel, a numbered "drawing a house" sequence, snapping and
    rotation rules, a pointer to the photo-tracing skill, and the untrusted-file handling from finding #1 and
    S5.1. Three screenshots (`scripts/doc-shots.mjs`, `npm run build && node scripts/doc-shots.mjs`, only
    `demo/layout.json` ever drawn): the full editor, the Add menu open, a device selected with its panel.
  - `CONTRIBUTING.md`: setup, the command list, branch/commit/PR conventions, what never goes in a commit
    (a token, a private HA URL, a real house — only `demo/` ships), pointing at `docs/WORKFLOW.md` for the
    AI-assisted process as background, not a requirement.
  - `markdown-link-check` added as a devDependency (`npm run docs:check`); confirmed it adds no new
    vulnerability (`npm ls markdown-link-check`, `npm audit --omit=dev` stays at 0 — the 5 pre-existing
    moderate/high findings are all in the vitest/esbuild dev chain, unrelated). Every link in `docs/*.md`,
    `README.md` and `CONTRIBUTING.md` checked clean; two relative-path mistakes in the first draft of
    `CONTRIBUTING.md` (root-relative links written as if the file were inside `docs/`) were caught this way,
    not by eye.
  - README's status table and Develop section link to the new docs.
  - Full suite green: 849 vitest (up from 845; +4 gen-schema-docs), lint clean, build clean, 412 Playwright
    passed / 1 skipped (untouched by this task — no editor or card behaviour changed). `npm run shots` not
    run: nothing here touches `render.ts` or a stylesheet.

### S5.4 Demo and HACS default
- Outcome: a GIF in the README; submission PR to the HACS default repository.
- Done when: GIF under 3 MB; submission opened.
- Done, 2026-09-23, GIF half only: `scripts/demo-gif.mjs` records a short Playwright screencast of
  `demo/layout.json` — the card live (a light on, motion active, a camera streaming), then the
  standalone editor (Add menu, a device panel) — and converts it with `ffmpeg` (palette generation,
  8 fps, 640 px wide) to `docs/img/demo.gif`, 1.14 MB, under the 3 MB budget. `npm run demo-gif`
  rebuilds `dist/` first. Embedded in `README.md` under the status table. Checked by eye: extracted
  four frames with `ffmpeg -vf select=...` and read them back — the card and the editor panel both
  render correctly, not just "a GIF exists".
  The HACS default-repository submission is **not done** and needs Diego's go-ahead before any of it
  proceeds, per CLAUDE.md ("ask before push, PR or merge") — it is a PR to someone else's repository
  (`hacs/default`), not this one. Checked the requirements against this repo
  (https://www.hacs.xyz/docs/publish/include/): public ✓, `hacs.json` ✓, HACS Action + Hassfest green
  on `main` ✓, a release with the `hacs.json`-named zip attached (v0.9.0) ✓, issues enabled ✓,
  description ✓ — but `gh repo view` shows no GitHub topics set, and the docs require topics for this
  specific submission (the repo's own `.github/workflows/validate.yml` ignores that check, which is
  right for being *addable as a custom repository* but not for the *default-list submission*).
  2026-09-23: topics proposed to Diego, approved, set with `gh repo edit --add-topic` — home-assistant,
  hacs, hacs-integration, home-assistant-integration, custom-component, lovelace, lovelace-card,
  floorplan, floor-plan, dashboard. Every checked requirement now passes; only the submission PR itself
  remains, still waiting on Diego's separate go-ahead before forking `hacs/default` and opening it.

### S5.5 Help guide in the editor
- Outcome: a Help button opens a step-by-step guide in a side panel, written so a twelve-year-old can follow it without asking anyone.
- Files: `src/editor/guide.ts` (the steps, as data), `src/editor/panels.ts`, `src/core/render.ts` only if the panel needs a token, `tests/editor/guide.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: a `#help` button in the editor's toolbar toggles a side panel, not a dialog, so the reader can follow a step and do it with the guide still open. The steps are one array of `{ title: string; body: string }`, rendered as a list, each entry a short title and one or two sentences. The panel is card chrome: the editor's own DOM, never drawn by `renderFloor`. It ships inside `dist/editor.html`, so it works offline and from `file://`, and the panel is the same one the HA sidebar version shows. Open or closed is remembered in `localStorage` under `floorplan-studio:help`, next to the grid, measure and theme preferences — never in the layout, never an undo step. Escape closes it; the button says whether it is open through `aria-expanded` and nothing else (a Sprint 1.6 finding: do not state the same thing twice to a screen reader).
- Content: the first draft covers drawing the outside wall, closing it, inside walls, doors and windows, placing a device, attaching an entity, floors, saving and opening. Plain words. No "canvas", no "polygon", no "viewport". A step names what the reader clicks and what they will see happen.
- Test: the panel opens from the button and closes with Escape; the step count matches the array; every step has a non-empty title and body; the panel is reachable by keyboard from the toolbar and returns focus to the button when it closes; `getComputedStyle` in Chromium confirms it is readable in both themes.
- Done when: tests pass; someone who has never seen the tool follows the steps unaided and ends with a saved floor, and what they got stuck on is written down.
- Break it: the guide is open when the plan is rotated, when a floor is added and when a layout is loaded, and none of them closes it or loses the reader's place; the steps do not scroll away under the toolbar on a narrow window.
- Done, 2026-09-23, tests only — the second half of "Done when" (a real first-time user follows the steps unaided)
  needs an actual person, not an agent, and has not happened. Flagging it here rather than marking the task closed.
  - `src/editor/guide.ts`: `GUIDE_STEPS`, a plain `{ title, body }[]` covering outline, closing it, inside walls,
    doors/windows, stairs/zones, furniture, a device, attaching an entity, adding a floor, saving. TDD:
    `tests/editor/guide.test.ts` written first (non-empty, no leading/trailing whitespace, no "canvas"/"polygon"/
    "viewport") — confirmed failing (module didn't exist) before the file was written.
  - `src/editor/state.ts`: `HELP_KEY = "floorplan-studio:help"`, `readHelp()`, `EditorState.helpOpen` and
    `setHelp()`, the exact `GRID_KEY`/`MEASURE_KEY`/`THEME_KEY` pattern (try/catch read and write, "private mode:
    the choice lasts until reload"). `setLayout` doesn't touch it, so Open/Reset/a host `hass` update can't close
    it — that's what the "break it" line relies on, not new code written for this task.
  - `src/editor/panels.ts`: `helpPanel(close)` — a `<strong>Help</strong>`, a Close button, an `<ol class="guide">`
    of the steps. It replaces `selectionPanel` in `#panel` while open (`editor-app.ts`'s `render()`), rather than
    living in a second column, so it never fights the existing `.ed{grid-template-columns:1fr 300px}` layout.
  - `src/editor/editor-app.ts`: a plain `#help` button (`aria-expanded`, nothing else — Sprint 1.6 finding) between
    File and the Undo/Redo separator; `toggleHelp()` calls `st.setHelp()` and, when it closed the panel, focuses
    `#help` itself; `onKey` closes it on Escape the same way it closes a context menu, ahead of every other key
    handler. Found and fixed one real bug via Playwright, not by reading the code: the existing `onButtonClick`
    bubble listener (every button click hands focus back to the editor host, for Ctrl+Z/Delete) fired *after*
    `toggleHelp`'s own focus call and stole it back to the host — the same class of race the `#addFloor` exception
    already existed for. Fixed by adding `#helpClose` to that exception, not by fighting the generic handler.
  - Playwright, `tests/editor/editor.spec.ts`: opens/closes with Escape and matches `GUIDE_STEPS` exactly; keyboard
    open + Close button, both returning focus to `#help`; "break it" across a plan rotation, a floor add and a
    layout load (`#panel .guide` still there after each); a CSS pair-style check (`#panel`'s computed `color` vs.
    the host's computed `background-color`, all seven themes — no new CSS rule was added, so this isn't a Finding
    10 pair, just a plain readability check); a 480px-wide window with the last step scrolled into view. Reverted
    the fix (`git stash` on `editor-app.ts` alone) once: all 5 new tests failed as expected, restored, rebuilt,
    green again. `--repeat-each=10` on `-g "S5.5"`: 50/50, no flakes.
  - `npm run shots`: run and looked at (finding #16 applies — a new toolbar button is a render change).
    `editor-blueprint`/`editor-light`/`editor-ha` differ only by the new "Help" button sitting between File and
    Undo; the Help panel itself (`/tmp/help-panel.png`, not committed) reads cleanly in the dark theme. New
    baselines accepted.
  - Full suite green: 852 vitest (up from 849; +3 guide), lint clean, build clean, 417 Playwright passed / 1
    skipped (up from 412; +5).
  - `docs/editor.md`'s toolbar list gained a Help bullet.

### S5.6 Unavailable entities are struck through
- Outcome: the plan matches `docs/SPEC.md`, which says an unavailable entity is struck through; the CSS only dims it with `opacity:.45`.
- Note: found while building S2.6. The `unavailable` class is applied correctly everywhere; only the styling falls short. Decide whether the spec or the CSS is wrong before writing code — dimming may be the better answer, in which case the spec changes and this task is a one-line edit plus a `docs/DECISIONS.md` entry.
- Test: `getComputedStyle` in Chromium on an unavailable device in both themes.
- Done when: the spec and the pixel agree, whichever way it is settled.
- Done, 2026-09-23. Decided the pixel was right: `docs/SPEC.md`'s two "struck through" lines were the stale ones (see `docs/DECISIONS.md`). No CSS change — `.dev.unavailable{opacity:.45}` already matches, and `tests/editor/editor.spec.ts`'s existing "Opus review CSS pair" S2.9 test already covers it in Chromium, so no new test was needed. Files: `docs/SPEC.md`, `docs/DECISIONS.md`.

### S5.7 The viewBox leaves room for what a device paints around itself
- Outcome: a lamp or a camera near an outer wall shows all of what it draws, not a circle cut off by the edge of the plan.
- Note: found by the S2.8 verifier. `viewBoxFor` pads the walls' bounding box by a fixed 60 cm, but a lit lamp's aura reaches 100 cm from its centre and a camera's cone the same, so a wall-mounted sconce 20 cm inside the wall has its aura clipped (right edge at x=880 against a viewBox edge at x=860). Not new to S2.8 — the camera cone has carried the same exposure since Sprint 1 — and neither task's done-when covers it.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`.
- Interface: the padding is the greater of 60 cm and the reach of anything a device paints around its own centre. Decide one way: a constant next to the aura and cone radii that all three read, so the three cannot drift apart again.
- Test: a fixture with a light 20 cm inside the right wall gives a viewBox whose right edge is at or beyond the aura's right edge; the same for a camera at the top wall; a plan with no devices keeps the 60 cm padding exactly, so no existing snapshot moves.
- Break it: a light exactly on a wall, and a plan whose only device is a light, still give a finite viewBox with the whole circle inside it.
- Done, 2026-09-23. `DEVICE_REACH` (100 cm) is now the one constant the aura circle's `r`, the camera cone's `R` and `viewBoxFor`'s padding all read. `viewBoxFor` pads by `Math.max(pad, DEVICE_REACH)` whenever the floor has a light or a camera device, `pad` unchanged otherwise — a plan with neither keeps the caller's own padding exactly (the card and the export SVG pass 60, the editor's `fit()`/`recenter()` pass 80). The demo ground floor has both, so its default card and editor views are now a little wider; `npm run shots` confirmed the camera cone and the Living light's aura, both clipped before, sit fully inside the frame now, with nothing else changed. One knock-on: the editor's default zoom got a little wider for this floor, which shifted the snap threshold (`14 / scale`, in cm) enough that `tests/editor/editor.spec.ts`'s pond-drag test's old 20,60 px offset landed inside it; the test now drags 90,150 px, checked directly to stay clear.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts` (pond-drag offset only).
- Counts: 840 vitest/27 files (5 new for S5.7), 410 Playwright/1 skipped, `--repeat-each=10` clean on the changed pond-drag test, lint/tsc/build clean, `npm run shots` looked at and accepted as the new baseline (card and editor shots for every theme/state on the ground and first floors moved, expectedly — see above).

### S5.8 A skill any assistant can follow to draw a plan into this repo's format (built 2026-09-21, pulled forward; not yet run by a model)
- Outcome: an agent, given architect drawings, photos or a hand sketch, produces a `layout.json` that opens in the editor first time, and can check its own work before handing it over.
- Why, on top of S5.2: S5.2 is a prompt — one shot, photos in, JSON out, no way for the model to know whether it got it right. The plan is the one artefact a person cannot type by hand, so the agent path is not a convenience, it is how most people will ever get a layout. It needs a specification the model can hold in its head, worked examples, and a check it can run.
- Files: `prompts/SKILL.md` (the skill, portable prose with no tool calls, so Claude, ChatGPT, Gemini, Grok and Copilot can all follow it), `prompts/SCHEMA.md` (v2 written for a reader, not a type checker: every field, units, the sign of y, what is required), `prompts/examples/` (two small layouts, one flat, one with two floors and stairs), `scripts/validate-layout.mjs`, `tests/core/validate-cli.test.ts`.
- Interface: `node scripts/validate-layout.mjs <file>` prints either `ok` or one line per error and exits non-zero, wrapping the existing `validate()` from `src/core/schema.ts` — nothing new to keep in step, just a door into it from a shell. The skill's last step is to run it, and to fix and re-run until it prints `ok`. The skill also states the two questions to ask first (one known dimension and its wall; where north is), because scale and orientation cannot be recovered afterwards.
- Test: run the skill end to end on the demo plan's own source drawing with one model; the JSON it returns passes the CLI and opens in the editor. Record model, date and pass/fail in `prompts/RESULTS.md` — no photos, no personal layout.
- Done when: one recorded pass with a model that is not Claude, so the prose is proven portable; README's assistant buttons point at files that exist.
- Break it: a sketch with no dimension at all — the skill must make the model ask rather than invent a scale; a room drawn outside the outline must be caught by the CLI, not by the person.
- Built: `prompts/{SKILL,SCHEMA,README}.md`, `prompts/examples/{flat,two-floors}.json`, `scripts/validate-layout.mjs`, `tests/core/validate-cli.test.ts` (11 tests). The README buttons that pointed at a missing file are gone; the section links to `prompts/README.md`, which explains loading the skill into each assistant.
- **Still open, and it is the point of the task:** the "Done when" run. No model has yet traced a drawing with this skill. Until one has, and one that is not Claude, the skill is untested prose. Record it in `prompts/RESULTS.md`.

## Sprint 6 — assistant workflow (E5, E6)

Recorded in `docs/DECISIONS.md` and `CHANGELOG.md` only: S6.5 card `floors`
config and the File, Install code panel (0.10.2); S6.7 File, Export carries an
entity snapshot (0.10.3).

## Sprint 7 — decent before publishing (E3, E2, E5)

Source: `docs/REVIEW-2026-09-24.md`. Diego, 2026-09-24: "it needs to be decent
before I publish. No bugs." Every task below is a full brief; assumptions are
written into the task and stand until he overrides them. Order matters: S7.1 to
S7.3 are bugs, then card features, then presence, then the trace image, then
docs. Release 0.11.0 closes the sprint.

Shared rules for the sprint, on top of `CLAUDE.md`:

- A task that touches `render.ts` or a stylesheet runs `npm run shots` and the
  Execute role looks at the PNGs before reporting.
- A new config key is added in five places in the same commit: the card's
  config interface, `docs/SPEC.md`'s yaml block, `docs/card.md`'s table, the
  config form (S7.7, once it exists) and a card test.
- A new `DeviceType` is added in eight places in the same commit: `schema.ts`
  (`DEVICE_TYPES`, the comment), `icons.ts`, `ha.ts` (`TYPE_RULES`,
  `typeForEntity`), `render.ts` (a decided look for every state), `actions.ts`
  (`NO_TOGGLE` or a decided tap), the editor's device panel, `docs/SPEC.md`'s
  type list, `prompts/SCHEMA.md`. The union-iterating tests catch the misses.

### S7.1 Labels never overprint each other
- Outcome: no room name, zone label, room `label` or sensor value overlaps another label, a device icon or a sensor value on any floor of the demo, and the rule holds in general.
- Files: `src/core/render.ts` (`nameAt`, `hit`, the `spots` list), `tests/core/render.test.ts`.
- Interface: no schema change. A label box is `[x, y, w, h]` estimated from `len × 0.6 × size` by `size`. One `placed: Box[]` list per floor; every text drawn checks it and pushes itself. Candidates, in order: centroid; 32k below; 32k above; 64k below; 64k above; then the centroid regardless, so nothing is ever dropped. Room names go first (they are what a person reads), then room `label`s, then zone labels, then sensor values. Sensor values try below the icon, then above, then right.
- Test (write first, watch it fail): `render.test.ts` parses every `<text>` in the demo's ground and first floor, builds the same boxes, and asserts no two intersect and none intersects a device disc. A second test builds two tiny neighbouring zones whose labels would collide at the centroid and asserts they end up on different rows. Revert the fix once and see both fail.
- Done when: both tests pass; `npm run shots` shows "Garden" and "Garden pond" apart and "23.5" clear of "Reading corner"; the snapshot tests are updated and read by eye.
- Break it: a label longer than its room (a 20-character name in a 100 cm store room) still draws, at the centroid, and the test tolerates the overlap only for that documented case.
- Done, 2026-09-24. `renderFloor` builds one `placed: Box[]` list per floor, in the screen frame, so a turned plan is checked as it is seen. Device discs (and unlinked appliances) go in first, then room names, room labels, zone labels, extras' names, and sensor values last. Names, labels and extras try centroid, 32k below, 32k above, 64k below, 64k above, then keep the centroid. Values try below, above, right. `spots`, `hit` and the old three-row `nameAt` are gone; `place` and `rows` replace them. Three details went past the brief, recorded in `docs/DECISIONS.md`: the value's first spot moved from 24k to about 26k below the icon (the old one touched the disc under the brief's own box), extras and unlinked icons joined the list, device names are not placed.
  - TDD: `tests/core/render.test.ts` got a new `describe` "S7.1: labels never overprint each other" (13 tests) and the S1.42 block traded one test ("stays when all three spots are taken") for three (64k down, 64k up, all five taken). Written first and run: 13 failed, 212 passed. The demo check failed on "Garden" on "Garden pond", "Bathroom" on "54 %" and "19 °C" on its own icon; the two-zones test failed with both names on one row. After the change: 225/225. The demo check parses every `<text>` of both floors at scale 1 (the card) and 0.5 (the editor zoomed out), flat and turned 90, with every sensor value drawn, and rebuilds the boxes itself.
  - Break it: a 20-character name in a 100 cm store room draws whole at the centroid; with all five rows blocked the name keeps the centroid, and the test accepts exactly that one overlap.
  - Snapshots: two changed, one line each: "Garden pond" drops one row (y 464 to 528 at scale 0.5). Read by eye, updated.
  - Counts: 881 vitest/29 files (866 before), 448 Playwright passed / 1 skipped (`PW_PORT=5301`), lint and build clean, every command exit 0.
  - `npm run shots` looked at: `card-ground-on-blueprint`, `card-first-on-blueprint`, `card-first-off-light`, `editor-blueprint`, the Garden, Reading corner and Bathroom corners at 4x. "Garden" and "Garden pond" are two rows apart; "23.5" is clear of "Reading corner"; the bathroom's humidity value moved above its icon, off the name. Baseline not accepted here (S7.3 does that).
  - Left out: walls, doors and zone edges are not obstacles. "Garden pond" still crosses the garden's wall and the door beside it, and "23.5" sits on the Reading corner's dashed edge. The editor's corner handles can still cover a name.

### S7.2 Trim the side panel, move the status line
- Outcome: the six-line snapping paragraph is gone from every panel; it lives in Help as a step. The status line (`#status`) sits in the toolbar row, right of Undo/Redo, so feedback appears next to what caused it. Panels keep one short hint each at most.
- Files: `src/editor/editor-app.ts` (aside, toolbar, `.status` style), `src/editor/guide.ts` (new step "Moving things and snapping"), `src/editor/panels.ts` (drop the repeated `hint(...)` lines that restate Alt/Shift/Ctrl), `tests/editor/editor.spec.ts`.
- Interface: `#status` keeps its id and `role="status"`, so every existing `#status` assertion still passes. The floor panel gets one line, "Need help? Open Help.", with a button that opens the Help panel.
- Test (first): Playwright asserts the aside contains no text "Hold Alt"; the Help panel contains it; `#status` is a descendant of the toolbar (`header`/`.toolbar`) and visible; Save still writes "Saved" there.
- Done when: the tests pass; the 15 panel screenshots in `npm run shots` look right at 1280 wide; nothing in `editor.spec.ts` regresses.
- Break it: the status text is 200 characters (an error message). It ellipsises with `text-overflow`, the full text in `title`, and the toolbar does not wrap.
- Done, 2026-09-24. The side panel lost its snapping paragraph; the status line sits in the toolbar.
  - `src/editor/guide.ts`: new step "Moving things and snapping", fourth, after the walls step. It carries the
    old paragraph in plain words, plus Ctrl/Cmd+Shift+Z for redo.
  - `src/editor/editor-app.ts`: the `<p class="hint">Snapping…` and the `#status` span left `<aside>`. `#status`
    (same id, `role="status"`, now with `title` = the full text) sits after `#redo` in `.bar`. `.status` is
    `flex:1 1 12em; min-width:6em; max-width:36em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`:
    a fixed basis, not the text, sets its width, so a long message never wraps the toolbar. Menu `.box` z-index
    20 → 40, see DECISIONS.
  - `src/editor/panels.ts`: `PanelCtx.help()`; the floor panel gains "Need help? Open Help." with `#floorHelp`.
    "Alt disables the grid" dropped from the device, furniture and unlinked panels.
  - TDD: five Playwright tests written first and seen failing, all five for the right reason (aside had "Hold
    Alt"; no guide step; no "Need help"; no `.bar #status`; no status to ellipsise). The full suite then caught a
    real regression (S1.36: File, Save covered by the Device colours panel once the menus moved left); a sixth
    test pins it. Both fixes reverted once to see their tests fail: `flex:0 1 auto` grew the toolbar from 41.6
    to 64.3 px; z-index 20 put the panel over Save.
  - Gate: lint 0; `npm test` 866/866; build 0; Playwright 454 passed, 1 skipped (was 448 + 1); the six new tests
    `--repeat-each=10` 60/60; `npm run shots` 0. Looked at `editor-blueprint.png`, `editor-light.png`,
    `editor-ha.png`, plus a scratch render at 1280 with a 200-character status and the new Help step open, and
    one at 700 wide.
  - Not done: `npm run shots` renders 3 editor PNGs, not 15 panels. `docs/img/editor-*.png` (from
    `scripts/doc-shots.mjs`) still show the status under the panel; S7.3 can regenerate them.

### S7.3 Docs are true; shots baseline accepted
- Outcome: the README status table says what shipped (Organise shipped in 0.10.0; the card is in daily use; Sprint 5 docs exist); `shots/baseline` is re-accepted after S7.1; `docs/REVIEW-2026-09-24.md` is committed.
- Files: `README.md` (rows 19 and 21), `shots/baseline/` (gitignored, `npm run shots -- --accept`), `docs/REVIEW-2026-09-24.md`.
- Test: `npm run docs:check` clean.
- Done when: the table has no row that names a sprint as future when it is done.
- Done, 2026-09-25 (commit `652554c`). The shots baseline was re-accepted and `docs/img/card-overview.png`,
  `docs/img/editor-add-menu.png`, `docs/img/editor-device-panel.png` and `docs/img/editor-overview.png` were
  regenerated with `node scripts/doc-shots.mjs`, since the editor had gained zoom buttons, night preview
  and trace image, and the card had gained zoom buttons and the new device types by that point in the sprint; the
  old images no longer matched what a user sees. See the commit message for the exact reason.

### S7.4 Zoom and pan in the card
- Outcome: a phone user can pinch, drag and double-tap the plan; a desktop user can Ctrl+wheel and drag. The plan never zooms out past fit and never in past 8×. Three small buttons (+, −, fit) sit in the card's top-right corner. Taps and long presses on devices keep working after a pan; a drag that moves more than 6 px is a pan, not a tap.
- Files: `src/card/floorplan-studio-card.ts` (`viewBox` state, pointer handlers), new `src/card/viewport.ts` (pure: `zoomAt(view, k, px, py)`, `panBy(view, dx, dy)`, `clamp(view, fit)`, `pinch(view, p1, p2, q1, q2)`), `tests/card/viewport.test.ts`, `tests/card/card.spec.ts`.
- Interface: config `zoom: true | false | "wheel"` (default `true`; `"wheel"` zooms on a plain wheel too, otherwise the wheel needs Ctrl/Cmd so the dashboard still scrolls). The viewBox is the card's own state, reset on `setConfig` and on floor change, kept across `hass` updates. Pointer Events, `touch-action: none` on the svg only when `zoom` is on. No core change: `renderFloor` output is untouched; the card writes the `viewBox` attribute.
- Test (first): `viewport.test.ts` covers zoom about a point (the point stays put), clamp at fit and 8×, pan bounds (at least one third of the plan stays visible), pinch scale. `card.spec.ts` drives `page.mouse` (wheel with Ctrl, drag 40 px) and `page.touchscreen` for a double-tap, asserts the `viewBox` attribute; asserts a 40 px drag over a light does not toggle it (`callService` not called) and a plain click still does; `zoom: false` leaves the `viewBox` fixed.
- Done when: tests pass, `--repeat-each=10` clean; the buttons are visible in all seven themes (they use `--fp-*` only); `getCardSize` is unchanged.
- Break it: a wheel event while the pointer is over a floor chip scrolls the page, not the plan. A pinch that starts with one finger outside the svg is ignored.
- Done, 2026-09-24. Departures and readings of the brief are in `docs/DECISIONS.md` (S7.4 entry).
  - `src/card/viewport.ts`: `zoomAt`, `panBy`, `clamp`, `pinch`, `MAX_ZOOM = 8`, pure. TDD:
    `tests/card/viewport.test.ts` (16 tests) written first and seen failing (module missing), then green.
  - `src/card/actions.ts`: it did not cancel the hold timer on movement, and a drag ended in a toggle. Now
    `TAP_SLOP_PX = 6`: a press that moves further drops its tap and its hold timer; a second pointer drops it
    too; a primary pointer clears any pointer whose up went missing. 7 new tests in `actions.test.ts`, seen
    failing first (6 at once, then the stale-pointer one with its guard disabled).
  - The card: `zoom` config (`true` default, `"wheel"`, `false`), `_view` state reset by `setConfig` and a
    floor change, kept across `hass`; pointer and wheel handlers bound once per `<svg>` beside
    `bindDeviceActions`; `touch-action: none` via `svg.fp-zoomable` only with zoom on; +, −, fit buttons in
    `.fp-zoom`, `--fp-*` colours only, disabled at their bound. `getCardSize` unchanged.
  - `card.spec.ts`: 15 Playwright tests (Ctrl+wheel about the pointer, plain wheel ignored, `"wheel"`,
    fit/8× bounds, the buttons, a 40 px drag from a light pans and does not toggle and a click still does, a
    drag at fit does not toggle, `zoom: false`, `touch-action`, wheel over a floor chip, reset/survive, 3:1
    contrast in all seven themes and ha dark, touch double-tap, double-tap on a light, CDP two-finger pinch,
    pinch whose first finger is outside the svg). 12 seen failing before the card was wired; the 3 that passed
    are guards. Disabling the slop check and the `isPrimary` check once failed the drag tests and the
    half-pinch test. `--repeat-each=10`: 150/150.
  - Docs: `docs/SPEC.md` yaml block and a paragraph, `docs/card.md` table and example, CHANGELOG 0.11.0.
  - Suites: 889 vitest (up from 866; +16 viewport, +7 actions), lint clean, build clean, 463 Playwright
    passed / 1 skipped (up from 448 / 1). `npm run shots`: looked at card-ground-on-blueprint,
    card-ground-off-light, card-ground-off-ha-light, card-first-on-ha-dark; terminal, slate, solarized,
    midnight and ha dark zoomed in from a scratch render (shots has no terminal). Buttons read in all.

### S7.5 Kiosk mode
- Outcome: `kiosk: true` shows only the plan: no floor chips, no zoom buttons, no version, no cover dialog chrome beyond the dialog itself; long press does nothing; taps still act. Meant for a wall tablet.
- Files: `src/card/floorplan-studio-card.ts`, `src/card/actions.ts` (`bindDeviceActions` takes `{ longPress: boolean }`), `tests/card/card.spec.ts`.
- Interface: config `kiosk: boolean` (default `false`). With `floors` or `floor: all` and `kiosk: true`, the card shows the first floor and no switcher; the docs say to use one card per floor in kiosk mode.
- Test (first): a `hold` of `HOLD_MS + 100` on a light fires no `hass-more-info` under kiosk and does otherwise; `.fp-floors` and the zoom buttons are absent under kiosk.
- Done when: tests pass; `docs/card.md` has a Kiosk section with a one-card-per-floor example.
- Break it: `kiosk: "yes"` (a string) is refused by `setConfig` with a message naming the key.
- Done, 2026-09-24. Departures and readings of the brief are in `docs/DECISIONS.md` (S7.5 entry).
  - `src/card/actions.ts`: `bindDeviceActions` takes `opts?: { longPress?: boolean }`, default `true` (unset and
    `true` behave the same). `false` never starts the hold timer, so a hold never fires `hass-more-info`; the
    pointerup path is unchanged, so releasing still toggles like a plain tap. 3 new tests in `actions.test.ts`.
  - `src/card/floorplan-studio-card.ts`: `kiosk` config key (default `false`), `_kiosk()` reads it. `_floorChips()`
    returns `null` under kiosk; the zoom buttons are gated by a new `showZoomButtons` alongside the existing
    `zoom` check; `bindDeviceActions` is called with `{ longPress: !this._kiosk() }`. New `_validateConfig`,
    called from `setConfig`, refuses `kiosk` unless it is exactly `true`/`false`/`undefined`, and — S7.4 leftover
    — refuses `zoom` unless it is `true`/`false`/`"wheel"`/`undefined`, both naming the key.
  - "No version": already nothing to hide (see `docs/DECISIONS.md`); no code change needed for it.
  - Tests written first and seen failing (module/behaviour missing), then green: 3 in `actions.test.ts`, 6 in
    `card.test.ts` (kiosk hides chrome, first-floor-no-switcher, the hold, a plain tap, both bad-value refusals,
    `zoom`'s three good values still accepted), 6 in `card.spec.ts` (Playwright: chrome absence, the real
    `HOLD_MS + 100` hold with two fresh cards, a plain tap, floors + kiosk, both refusals).
  - Revert-check: hard-coded `longPress = true` in `bindDeviceActions`, ignoring `opts`. Exactly the two kiosk
    hold tests failed (`actions.test.ts` and `card.test.ts`), nothing else; restored, vitest green again.
  - Docs: `docs/SPEC.md` yaml block and a paragraph, `docs/card.md` table plus a new Kiosk mode section with a
    one-card-per-floor example, CHANGELOG 0.11.0, `docs/DECISIONS.md`.
  - Suites: 914 vitest (up from 889; +3 actions, +6 card — the pre-existing 59 failures in
    `tests/editor/state.test.ts`, `localStorage.clear()` throwing `undefined`, are unrelated to this task: they
    fail the same way on `sprint/7` with this branch's changes stashed out, so nothing here caused or fixed them.
    Filed, not fixed — out of scope for S7.5), lint clean, build clean, 475 Playwright passed / 1 skipped, exit
    0. `--repeat-each=10` on the 6 new Playwright tests: 60/60.
  - Note on the Playwright count: a first full run's log was contaminated by a concurrent agent's session writing
    to the same shared `/tmp/pw_full.log` (its output named a different worktree, `agent-a481e831...`, and showed
    7 unrelated failures that were never this branch's). Re-run to a session-private scratchpad path came back
    clean. Lesson: never share a bare `/tmp/<name>.log` path across parallel worktrees; always redirect into the
    session's own scratchpad.

### S7.6 Night fill from the sun
- Outcome: after sunset the plan darkens: every room and the ground outside get a night overlay; a room with a light on stays bright (the same detection as `room_glow`). Cheap version of realistic light. The editor can preview it.
- Files: `src/core/render.ts` (a `night` option; a `<rect class="night">` per room drawn after the room fill and before devices; root class `night`), the theme stylesheet (`--fp-night` per theme, default `rgba(4, 10, 30, .45)`; `.night .room-night { fill: var(--fp-night) }`; `.night .room-night.lit { fill: none }`), `src/card/floorplan-studio-card.ts` (reads `sun.sun`), `src/editor/editor-app.ts` (View, "Preview night", a browser pref), `src/editor/state.ts` (`NIGHT_KEY`), tests in `render.test.ts`, `card.spec.ts`, `editor.spec.ts`.
- Interface: config `night: "auto" | "on" | "off"` (default `"auto"`: night when `sun.sun` is `below_horizon`; no `sun.sun` means day) and `sun: <entity>` (default `sun.sun`). `renderFloor` option `night?: boolean`. A room is lit when any light device inside it is on. Zones, stairs and structures are not overlaid (they sit on a room). Outdoor kinds (garden, water, pavement) are overlaid like rooms.
- Test (first): `render.test.ts` asserts the root gets class `night`, one `rect.room-night` per room, `lit` on exactly the rooms with an on light; `editor.spec.ts` "Opus review CSS pair" for both rules via `getComputedStyle`; `card.spec.ts` flips `sun.sun` and asserts the class toggles, and `night: "off"` never sets it.
- Done when: tests pass; `npm run shots` gains a `night` state (ground floor, blueprint and light) and the PNGs read as night with the lit rooms bright.
- Break it: the `sun` entity is `unavailable`: day, no error. A light whose `x,y` is outside every room lights nothing.
- Done, 2026-09-24. The overlay is a `<polygon class="room-night" data-night="<room index>">` with the room's own
  points, not the brief's `<rect>` (a rect is the bounding box; on an L-shaped room it would darken the neighbour's
  corner and clear ground that is not the lit room's own), drawn after the room fills and stairs, before walls, names
  and devices. `renderFloor` reuses the `room_glow` lit-room set for `night` too. The root `<g>` carries class `night`
  whether or not a plan theme is set. The card's `night()` reads config `night` (`auto`/`on`/`off`) and `sun` (default
  `sun.sun`), treating `below_horizon` and `on` as night, anything else (including `unavailable` and a missing entity)
  as day; it re-reads on every `hass` update, so a live sunset flips the card with no new config. The editor keeps the
  choice in `localStorage` (`NIGHT_KEY`), never in the layout, never an undo step, under View, "Preview night".
  `--fp-night: rgba(4,10,30,.45)` is one value for every theme for now, added to `rolesToTokens` and both hand-written
  token strings. Four departures from the brief went to `docs/DECISIONS.md`: the polygon over a rect, the overlay
  order (after stairs too), `.room-night{pointer-events:none}` in the stylesheet, not just the attribute (finding 18,
  proven by a Playwright test with the rule removed), and `sun: <entity>` counting `on` as night as well as
  `below_horizon`.
  - TDD: written first and watched fail before the code (the previous agent's report, matched by the diff's shape).
    `render.test.ts` gained a `describe` "S7.6 night" (8 tests: root class with and without a theme, no overlay
    without `night`, one overlay per room with outdoor kinds included and none for the zone or stairs, `lit` exactly
    on rooms with an on light including one lit through its bound switch, draw order between fills/stairs and
    walls/devices, every `RoomKind` a decision via `ROOM_KINDS`, a light outside every room or at a non-finite point
    lighting nothing, and the CSS pair via `FLOORPLAN_CSS.toContain`). `card.spec.ts` gained 3 (`sun`/`night` config
    matrix over 12 cases including override and unavailable, a live `hass` update toggling the class with no new
    config, and a CSS pair in the card's own shadow root). `editor.spec.ts` gained 3 (Preview night toggling the
    overlay and surviving a reload without touching the saved layout, a click still selecting the room under the
    overlay, and the "Opus review CSS pair" per finding 10).
  - Revert-check (finding 4): removed `.night .room-night.lit{fill:none}` from `render.ts`; the `render.test.ts` CSS
    pair test failed, and both Playwright CSS pair tests (`card.spec.ts`, `editor.spec.ts`) failed with the unlit and
    lit colours equal. Restored; the diff came back byte-identical (24 insertions / 7 deletions in `render.ts`, as
    before).
  - Counts: `npm test` 889 tests / 29 files, 830 passed. 59 failures in `state.test.ts`, `add-from-area.test.ts`,
    `place-area.test.ts` and `light-from-switch.test.ts` are a pre-existing `localStorage` crash under this machine's
    Node (v26.10.0) in jsdom — reproduced identically with the S7.6 diff stashed out, so it predates this task and is
    out of scope here. The 8 new S7.6 unit tests all pass; run alone: `8 passed`. Playwright: `PW_PORT=5306`, one full
    run hit 7 unrelated failures (menu/draw-mode timing under load, none in S7.6); a second full run on a fresh port
    came back `454 passed / 1 skipped`, and the 7 also passed in isolation against both the S7.6 diff and the
    unmodified branch, so they were flaky under contention, not a regression. The 6 new S7.6 Playwright tests:
    `--repeat-each=10` came back `60 passed`. Lint (`eslint` + `tsc --noEmit`) and `npm run build` both clean.
    `npm run docs:check` clean.
  - `npm run shots` looked at: `card-ground-night-blueprint` and `card-ground-night-light` (new), against
    `card-ground-off-light` for contrast. Blueprint's grey rooms go slate, light's beige rooms, green garden, blue
    pond and white pavement all mute to the same dark blue-grey veil; the kitchen (its light on) stays the room's own
    warm fill under the on-light glow in both. Reads as night with the lit room bright, in both themes.
  - Left out: a room's own texture or fill colour is covered exactly like a plain fill — the brief does not say
    otherwise, and no shot showed it wrong. The config-form entry (S7.7) is not touched; S7.7 covers it when it lands.

### S7.7 Card config form
- Outcome: the Edit-card dialog shows a form: theme (select), floors (checkbox per floor, in order), fade (number), room_glow, zoom, kiosk, night. No YAML needed.
- Files: new `src/card/config-editor.ts` (`floorplan-studio-card-editor`), `src/card/floorplan-studio-card.ts` (`static getConfigElement()`), `tests/card/config-editor.spec.ts`.
- Interface: plain Lit element, no `ha-form` dependency (it would need HA's own elements at test time). `setConfig(config)` and `hass` setters; the floor list comes from the layout the card already loaded (`layout` or `layout_url` or the stored plan). Every change fires `config-changed` with `{ config }` in `detail`, `bubbles: true, composed: true`. A key left at its default is removed from the emitted config, so the YAML stays short.
- Test (first): Playwright creates the element, sets a config, ticks a floor and changes the theme, asserts the two events and their payloads; asserts a default value is absent from the payload.
- Done when: tests pass; `docs/card.md` says the form exists and which keys it covers.
- Break it: `setConfig` with an unknown theme shows the select on "blueprint" and does not fire.
- Done, 2026-09-24. `src/card/config-editor.ts` defines `floorplan-studio-card-editor`, a plain Lit element with no
  `ha-form`; `floorplan-studio-card.ts` imports it for its side effect and adds `static getConfigElement()`.
  Reading of the layout mirrors the card's own three sources and order (`layout`, then `layout_url` fetched once,
  then the stored plan over the websocket), through the same `migrate`/`validate` pair, never throwing on bad
  input. `kiosk`, `night` and `sun` are in the form now, ahead of S7.5/S7.6, with their planned defaults (`false`,
  `"auto"`, `"sun.sun"`); `docs/DECISIONS.md` has the S7.7 entry on why and that `FloorplanStudioCardConfig` does
  not carry them yet.
  - TDD: this task's own tests were written and passing before this closing pass (a previous run of this agent
    was killed mid-task after writing `config-editor.ts`, `config-editor-harness.html` and
    `config-editor.spec.ts` but before committing); this pass read the diff, added the docs, ran every gate fresh,
    and did a revert-check on the strip-defaults branch of `_set` (removed the `if (value === def) delete
    next[key]`, saw the two "drop at default" tests fail — 7 passed / 2 failed — restored it, saw 9/9 again).
  - Suites, run fresh in this pass: lint 0; `npm test` 904/904 (`NODE_OPTIONS=--no-experimental-webstorage`, the
    Node 26 workaround sprint/7 carries in its `test` script — this branch predates that fix, so it was set by
    hand rather than added again here); build 0; `PW_PORT=5307 npx playwright test` 478 passed / 1 skipped, 0
    failed, including the 9 new config-editor tests; the new spec alone `--repeat-each=10`: 90/90; `npm run
    docs:check` clean.
  - Not done: no CSS pair test — the element has no rule that depends on cascade specificity over another; every
    rule in its `static styles` is scoped to `:host` or a class this element alone defines.

### S7.8 People on the plan
- Outcome: a `person` device: an icon placed where the person usually is (their desk, their bed). Its entity is `person.*` or `device_tracker.*`. When the person is home the icon is full; away it is dimmed to 35 % with a small "away" mark; unknown as every other unavailable device. Optionally a `room` entity names the room the person is in right now (a BLE room-presence sensor: state, or an `area_id` or `area` attribute, that matches a room's `area` or name); then the icon moves to that room's centroid with a 600 ms CSS transition, and several people in one room spread on a ring. This is the answer to "is lighting up motion sensors enough?": motion shows that somebody is there, a person icon shows who and where.
- Files: `src/core/schema.ts` (`DeviceType` + `"person"`; `Device.room?: string`), `src/core/icons.ts` (mdi account), `src/core/ha.ts` (`TYPE_RULES.person`, `typeForEntity` for `person.` and `device_tracker.`), `src/core/render.ts` (position from `state[room]` when it names a room; class `home`/`away`; a `transform` transition class), the stylesheet, `src/card/actions.ts` (`person` in `NO_TOGGLE`; tap opens more-info), `src/editor/panels.ts` (device panel: "Room sensor" entity picker), `docs/SPEC.md`, `prompts/SCHEMA.md`, tests in `render.test.ts`, `card.spec.ts`, `editor.spec.ts`.
- Interface: `Device.room` is an entity id, validated like `entity`. `renderFloor` resolves it: `state[room].state` or `attributes.area_id` or `attributes.area`, matched against `room.area` then `room.name` case-insensitively; no match keeps the placed spot. The card passes attributes through in `state` as it already does for lights.
- Test (first): `render.test.ts`: home/away classes; a `room` state that names "Kitchen" moves the icon into the kitchen's centroid; two people in one room have different positions; an unmatched room keeps `x,y`. `icons.test.ts` and the `DEVICE_TYPES` iteration tests fail until every place is filled. `editor.spec.ts`: the device panel shows the Room sensor field only for `person`. `card.spec.ts`: a tap on a person fires more-info, never a service call.
- Done when: tests pass; the demo gains one person (in the study, home, no room sensor) so the shots show it.
- Break it: `room` set to the device's own entity (a person picking themselves) is refused by `validate` with a message. A room sensor whose state is `not_home` or `unknown` keeps the placed spot.
- Done, 2026-09-24. All of the above, as specified, plus a demo person (`person-alex`, first floor, Office, home, no room sensor). The 600 ms transition and the room-centroid match were mostly already in place from an earlier pass on this branch; this pass finished the remaining editor UI, tests, docs, demo data and the two outstanding revert-checks.
  - TDD note: the core logic (`schema.ts`, `render.ts`, `ha.ts`, `icons.ts`, `actions.ts`) was already written before this pass picked the branch back up, so its tests were written after the fact, not before — a deviation from finding 5, disclosed here. The editor.spec.ts Playwright tests (Room sensor field visibility, the CSS pair) were written and watched fail before the fix, since the panel UI itself was still unbuilt at the start of this pass.
  - Break-it results, actually run: disabling `.dev-person{transition:transform .6s ease}` (emptying the rule) failed "Opus review CSS pair: S7.8 a person glides..." with `{prop: "all", dur: "0s"}` instead of `{prop: "transform", dur: "0.6s"}`; restored, rerun green. Disabling `personRoom` (forcing an early `return -1`) failed "S7.8: when the room sensor changes, the person glides to the new room" (`moved.anims` came back `[]` instead of containing `"transform"`); restored, rerun green.
- Left out: no left-out item beyond what the brief itself scopes out.

### S7.9 mmWave radar targets
- Outcome: a `radar` device (an LD2450 through ESPHome, or any sensor that exposes target x/y in mm): the icon is the sensor; up to three dots show where the targets are, relative to the sensor's position and `rot`. The presence entity (a `binary_sensor.*occupancy`) colours the icon.
- Files: as S7.8 plus `Device.targets?: { x: string; y: string }[]` in `schema.ts`; `src/core/icons.ts` (mdi radar); `render.ts` draws `<circle class="target">` per target whose two sensors are finite; the editor panel lists target pairs with add/remove.
- Interface: the sensor's frame is x to the right, y forward, in mm, as ESPHome's LD2450 component reports; `rot` 0 means "forward" is screen-up. A target outside the floor's bounds is not drawn.
- Test (first): `render.test.ts`: a target at (0, 2000) with `rot: 90` draws 200 cm to the screen-right of the icon; `NaN` and `unavailable` draw nothing; three targets draw three dots. Union tests as S7.8.
- Done when: tests pass; `docs/card.md` has an ESPHome snippet naming the entity ids.
- Break it: 20 target pairs draw 20 dots; nothing caps it, nothing breaks.
- Done, 2026-09-24. All of the above. `Device.targets?: {x: string; y: string}[]`, validated per-pair (each an entity id, both required, hostile shapes never throw); `renderFloor` draws a `<circle class="target">` per pair whose two sensors are both finite, skipping a pair outside the floor's own outline (checked with the existing `inside()` point-in-polygon helper) rather than clamping it; `radar` in the eight places a new `DeviceType` touches (schema, icons, `ha.ts` type rules, render colour, `NO_TOGGLE`, editor panel, `docs/SPEC.md`, and `docs/schema.md` by generation — see `docs/DECISIONS.md`). The editor panel's Targets field adds/removes pairs one row at a time; a blank pair is dropped on remove, and `validate` (not the field) refuses a pair with only one of x/y filled, so a mid-edit layout can be interim without the writer needing to know that (finding 12). The demo gains one radar (`radar-office`, first floor, Office, one target) and `scripts/shots.mjs` gains a second (`mon-radar`, ground floor, Living, two targets, full on/off/gone states).
  - TDD note: as S7.8, the core logic predates this pass's tests; the editor's Targets-field-visibility test and its CSS pair were written first and watched fail, per finding 5.
  - Break-it results, actually run: removing `.dev-radar.on{--fp-dev:var(--fp-dev-radar)}` failed "Opus review CSS pair: S7.9 a radar wears --fp-dev-radar..." (`--fp-dev` came back the room-idle grey token instead); restored, rerun green. Removing the `d.type === "radar" ? targetsField(c, i) : nothing` conditional (forcing `nothing` always) failed "S7.9: the Targets field shows only for a radar..." (`#vtgadd` never appeared); restored, rerun green. Other break-it cases exercised directly in `render.test.ts` and `schema.test.ts` rather than by reverting: 20 target pairs all draw (no cap), a target just inside vs. just outside the outline is discriminated (not "always hidden"), every hostile `targets` shape in `schema.test.ts` ("never throws on a hostile targets shape") is checked against `[5, {x:"__proto__"}, [null, undefined, 5, "x"], [{x,y,extra:"><script>"}]]`.
  - Counts actually seen: `npm run lint` exit 0; `npm test` 924/924 passed, 29 files, exit 0 (after fixing an unrelated Node/vitest `localStorage` environment gap — `docs/DECISIONS.md`); `npm run build` exit 0; `PW_PORT=5308 npx playwright test` 455 passed, 1 skipped, exit 0; the seven new S7.8/S7.9 Playwright tests at `--repeat-each=10`: 70/70 passed, exit 0; `node scripts/validate-layout.mjs demo/layout.json` exit 0 ("ok", plus the pre-existing unconditional "devices or catalog are not empty" warning); `npm run docs:check` clean, exit 0.
  - `npm run shots` looked at: `card-ground-on-blueprint` and `card-ground-off-blueprint` (the radar's own icon — a distinctive three-quarter-circle sweep shape, confirmed not borrowed from `motion` or `person` — turns from idle grey to blueprint's single on-accent, with two target dots appearing only in the "on" shot, gone in "off"); `card-ground-on-light` (radar and its two target dots in radar's own purple, `--fp-dev-radar`, distinct from every other accent, dots outlined and not swallowed by the room fill or halo); `card-first-on-light` (the demo's own `radar-office` next to `person-alex`'s green "home" icon, both correctly coloured and the radar's one target dot visible — this only showed correctly after adding explicit on/off/gone states for `radar-office` to `scripts/shots.mjs`, since it had none at first and stayed idle-grey in every state).
  - Left out: no left-out item beyond what the brief itself scopes out (three-vs-many targets: the brief and this implementation both cap nothing).

### S7.10 Vacuums
- Outcome: a `vacuum` device: docked (idle grey), cleaning (active colour, a slow spin on the icon), returning (active, no spin), error (danger). Tap opens a dialog like the cover one: Start, Pause, Return to dock. No map position: most integrations expose the map as a camera or a proprietary blob, not coordinates; documented in `docs/card.md` and the decision log. A user who wants the robot to move can wait for a later task that reads a `sensor` pair, as S7.9 does.
- Files: as S7.8 (`"vacuum"`, mdi robot-vacuum, `TYPE_RULES.vacuum` on domain `vacuum`), `src/card/actions.ts` (a `vacuum` branch that opens `openVacuumDialog`), `src/card/floorplan-studio-card.ts` (the dialog, `vacuum.start|pause|return_to_base`).
- Test (first): `render.test.ts` for the four states; `card.spec.ts` taps a vacuum, asserts the dialog, clicks Return to dock, asserts `callService("vacuum", "return_to_base", { entity_id })`. A `--repeat-each=10` on the spin rule is not needed (CSS only), but the CSS pair test is.
- Done when: tests pass; the shots' monitored-types row includes a vacuum.
- Break it: state `unavailable` shows the dialog with the buttons disabled.
- Done, 2026-09-25. All of the above. `vacuum` in the eight places a new `DeviceType` touches (schema, mdi robot-vacuum path in `icons.ts`, `TYPE_RULES.vacuum` on domain `vacuum` in `ha.ts`, `render.ts` colour/class/spin, `NO_TOGGLE` in `actions.ts`, editor panel's `TYPE_LABELS`, `docs/SPEC.md`, `docs/schema.md` — a no-op regeneration since the `DeviceType` union isn't printed as its own export). `classOf()` in `render.ts` collapses `docked`/`idle`/`paused` to one idle-grey state (no map position, no distinct look between them — a decision, not an oversight, since HA reports these three almost interchangeably across vacuum integrations); `cleaning` is on with a `.spin` class (`@keyframes fp-spin`, 4s, `prefers-reduced-motion` drops it to none); `returning` is on without `.spin`; `error` is its own `danger` value, neither on nor off, painted `--fp-danger`, never conflated with `unavailable`. The dialog in `floorplan-studio-card.ts` models `_coverDialogTemplate`/`_openCoverDialog` almost exactly: a mutual-exclusion guard so only one of the cover and vacuum dialogs is ever open, and the existing `_onDialogKeydown`/Tab-cycle handler needed no change since it already queries `.fp-dialog-actions button` generically rather than by count. `unavailable`/`unknown` still opens the dialog with Start, Pause and Return to dock disabled and Cancel enabled, so a stray or unreachable vacuum can always be dismissed without leaving the user stuck.
  - TDD note, disclosed honestly: `render.ts`'s four-state class/spin logic, `actions.ts`'s vacuum tap branch and the dialog body in `floorplan-studio-card.ts` were written before their tests, continuing this task from a partially-completed state (the dialog was mid-edit when this session's continuation began) — not written test-first per finding 5. The new S7.10-specific unit tests (`ha.test.ts`, `schema.test.ts`, `render.test.ts`, `actions.test.ts`) and every Playwright test in `card.spec.ts`/`editor.spec.ts` were written afterwards but confirmed live via explicit break-it reverts (below), so each one is known to fail with its feature removed. Two pre-existing tests broke reactively when `vacuum` was added to `DEVICE_TYPES`/`typeForEntity`/the device-colours panel and were fixed, not written first: `tests/core/icons.test.ts`'s own hardcoded local `DEVICE_TYPES` list (27 → 28 keys), `tests/core/ha.test.ts`'s "falls back to other" example (`vacuum.x` now correctly maps, so the unmapped-domain example became `fan.x`), and `tests/editor/editor.spec.ts`'s "S1.36" device-colours row count (29 → 30).
  - Break-it results, actually run: reverted `.dev-vacuum.on{--fp-dev:var(--fp-dev-vacuum)}` in the stylesheet — "Opus review CSS pair: S7.10 a vacuum wears --fp-dev-vacuum..." failed, `--fp-dev` read back as the idle grey token instead of `#2f8f8f`; restored, rerun green. Reverted the `cleaning` branch's `.spin` class in `render.ts` (forced it off) — the "S7.10: a vacuum's four states" render test asserting `cleaning` spins failed (`animationName` read `none`); restored, rerun green. Reverted the `vacuum` branch in `actions.ts` to fall through to the default toggle — "actions: a vacuum opens its own dialog on a tap, never toggles" failed (`callService` was called instead of `openVacuumDialog`); restored, rerun green. Reverted `_vacuumDisabled()` to always return `false` — the card.spec.ts break-it test for `unavailable`/`unknown` (expecting `[false, true, true, true]` across Cancel/Start/Pause/Return) failed (all four read `false`); restored, rerun green. The mutual-exclusion guard was exercised directly rather than by reverting: a Playwright test taps a vacuum then a cover in the same layout and asserts only one `.fp-dialog` is ever in the DOM.
  - Counts actually seen: `npm run lint` exit 0. `npm test` 990/990 passed, 30 files, exit 0. `npm run build` exit 0. `PW_PORT=5310 npx playwright test --workers=4`: first full run caught one pre-existing regression (the S1.36 device-colours count, above, 1 failed / 520 passed / 1 skipped, exit 1); fixed, rerun clean at 521 passed / 1 skipped, exit 0. The new S7.10 Playwright tests (7 in `card.spec.ts`, 1 CSS pair in `editor.spec.ts`) at `--repeat-each=10`: 80/80 passed, exit 0. `node scripts/validate-layout.mjs demo/layout.json` exit 0 ("ok", plus the pre-existing unconditional "devices or catalog are not empty" warning). `npm run docs:check` clean, exit 0.
  - `npm run shots` looked at: `card-ground-on-light` (a teal robot-vacuum icon at the Hall row, `#2f8f8f`, visually distinct from the grey battery/cover/monitored icons beside it and from the radar's purple and the person's green); `card-ground-off-light` (the same icon, idle grey, matching every other off icon in the row — the docked state reads as "off", not as a fourth colour); `card-ground-gone-light` (dimmed to the same ~45% opacity as the rest of the row, no strikethrough); `card-ground-on-blueprint` (the icon collapses to blueprint's single on-accent orange, same as the person icon beside it, confirming blueprint's one-accent rule holds for the new type too, per finding 17/19). All four matched what the state was meant to show; no defect found by looking, unlike the S2.9 precedent finding 16 warns about.
  - Left out: the robot's live position/map is out of scope by the brief's own design (documented in `docs/card.md` and `docs/DECISIONS.md`) — a later task reading a `sensor` x/y pair, as S7.9 does for radar targets, would add it. Nothing else from the brief was skipped.

### S7.11 Trace over an image in the editor
- Outcome: a person with a scanned plan loads it under the drawing, scales it to a known length, traces the walls over it, then hides it or fades it. The image is saved with the plan so the work survives a reload; it never reaches the card, and File, Export leaves it out unless "Include trace image" is ticked.
- Files: `src/core/schema.ts` (`Floor.trace?: { src: string; x: number; y: number; w: number; rot: number; alpha: number; on: boolean }`, `src` a `data:image/...` URL ≤ 4 MB after downscaling to 2000 px on the long side, validated: prefix, size, finite numbers, `alpha` in [0, 1]), `src/core/render.ts` (draws `<image class="trace">` first, only when `opts.trace` is true; the card never passes it), `src/editor/editor-app.ts` (View, "Trace image…": Load, a Scale step, Opacity slider, Show toggle, Remove; `exportJson` strips `trace` unless the tick is on), `src/editor/state.ts` (`setTrace`, one undo step per change), `tests/core/schema.test.ts`, `tests/core/render.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: Scale: the user clicks two points on the image and types the real distance in cm; the editor sets `w` so that distance is right and keeps the image's aspect ratio. Load reads the file with `FileReader`, draws it to a canvas capped at 2000 px, exports JPEG at 0.85; PNG stays PNG under 1 MB. A layout whose `trace.src` is over the cap fails `validate` with a message that says the limit.
- Test (first): `schema.test.ts` accepts a valid trace, rejects `src: "javascript:..."`, an oversize `src`, `alpha: 2`. `render.test.ts`: with `trace: true` an `<image>` is the first child of the floor group with the right `href`, `x`, `y`, `width`, `opacity` and `transform`; without the option nothing is drawn; the card's render never passes it (a card test asserts no `image.trace` in the card's svg for a layout that has one). `editor.spec.ts`: load a 20×10 PNG fixture through `setInputFiles`, the image appears; two-point scale to 500 cm sets `w` to 500 for a full-width pair; opacity 0.3 reaches the `opacity` attribute; Show off hides it and the layout still holds it; Export without the tick has no `trace` key, with the tick it has one.
- Done when: tests pass, `--repeat-each=10` clean; `docs/editor.md` has a "Trace over a scan" section; `prompts/SCHEMA.md` says `trace` exists and that an assistant must never write one.
- Break it: a 12 MB photo downscales and saves under 4 MB. A `trace` with `w: 0` is rejected. `Ctrl/Cmd+Z` after Load removes the image.
- Done, 2026-09-24. Playwright tests for this task live in their own `tests/editor/trace.spec.ts` (14 tests) rather than inside `editor.spec.ts`, which the "Files" line named — that file is already over 6,000 lines, and the Scale-step, Load and Export flows share no fixtures with it. Departures from the brief and why are in `docs/DECISIONS.md` ("S7.11 Trace image: where it departs from the brief"): PNG/JPEG/WebP only (no SVG), room fills go see-through while a trace is shown (editor only, CSS pair tested), undo history interns each distinct image once instead of once per step, autosave drops `trace` rather than failing outright when it does not fit localStorage. Full suite: lint (`eslint .` + `tsc --noEmit`) clean; 879 vitest passed (26 new: 8 schema, 4 render, 1 card, 1 migrate, 3 state); 463 Playwright passed / 1 skipped (14 new), `trace.spec.ts` alone with `--repeat-each=10` also clean (140/140) — the first full run at the default worker count threw 7 unrelated failures ("Target page ... has been closed") from browser crashes under load on this machine, reproduced as pre-existing flakiness (not from this change) by rerunning the whole suite at `--workers=4`, green. vitest needed `NODE_OPTIONS=--no-experimental-webstorage`: Node 26 on this machine shadows jsdom's `localStorage` with its own experimental (and here file-less, so throwing) global, breaking every `localStorage.clear()` test in the repo, S7.11's included — an environment issue, not a code defect; worth a project-level note if it recurs. `npm run docs:schema` a no-op (already regenerated), `npm run docs:check` clean. `npm run shots`: looked at `editor-blueprint.png` (unaffected — the demo carries no trace) and `card-ground-on-blueprint.png` (no trace image, as required). Revert-check: removed the `o.trace &&` guard in `renderFloor`, the "draws nothing without the option" render test failed as expected, then restored and re-passed.

### S7.13 Help steps show one chevron
- Found while looking at the S7.2 shots. Every Help step drew two chevrons: ours (`summary::before`) and the browser's own list marker. `::-webkit-details-marker{display:none}` no longer hides it in Chromium; `list-style:none` on the summary does.
- Done, 2026-09-24. `src/editor/editor-app.ts` `.guide summary` gained `list-style:none`. A CSS pair test in `editor.spec.ts` reads `list-style-type` of the summary ("none") and the `::before` content; it failed first with `disclosure-closed`, then 70/70 with the S5.5 guide tests at `--repeat-each=10`. Looked at the Help panel: one chevron per step.

### S7.12 Docs, README, skills, release 0.11.0
- Outcome: every new key, type and panel is documented where a user looks: `README.md` (features, status table, card yaml), `docs/card.md`, `docs/editor.md`, `docs/schema.md` (regenerated), `prompts/SCHEMA.md` and `prompts/SKILL.md` (new device types; `trace` and `available` are never written by an assistant), `CHANGELOG.md` 0.11.0, `manifest.json` 0.11.0.
- Test: `npm run docs:check`; `npm run docs:schema` is a no-op after the commit; the README yaml block is the one `docs/card.md` shows.
- Done when: green; Diego says yes to push and tag; release finished on his HA per `CLAUDE.md`.
- Done, 2026-09-25. `README.md`: status table gets rows for person/radar/vacuum, night/zoom/kiosk/config-form and the
  trace image (all "done (0.11.0)"); the feature bullets under "What you get" name the card's new device types,
  zoom/pan, kiosk mode, the Edit-card form and the trace image; a card yaml block was added (Install section) that
  is byte-identical to `docs/card.md`'s own second yaml block. `docs/card.md`: dropped a stale line in "The
  Edit-card form" claiming kiosk/night "land in the card itself with a later release" — S7.5 and S7.6 had already
  landed them by the time this task started, so the line was a code bug (see below), not just a doc gap; added a
  **Person** bullet to "What a device looks like" (it had none: radar and vacuum were documented, person was not).
  `docs/editor.md`: added a device-panel paragraph for the Room sensor (person) and Targets (radar) fields and a
  one-line note for vacuum, plus a "Preview night" section (View, Preview night existed in code and `SPEC.md` but
  had no entry in this file). `docs/schema.md`: `npm run docs:schema` was already a no-op — `git status --short`
  came back clean before any edit here, so nothing to commit for it. `prompts/SCHEMA.md`: the domain→type guess
  list now names `person`, `radar`, `vacuum`; two new lines describe `Device.room` and `Device.targets` for the
  "placing devices from an export" task, saying explicitly not to invent either. `prompts/SKILL.md`: added a line
  that `trace` is never written by the tracing skill either (it only had the devices/catalog prohibition before).
  `docs/SPEC.md`: already listed every S7 device type, config key and the `trace` field in full — read closely,
  no gap found, so no edit made (CLAUDE.md: no rewrites). `CHANGELOG.md`: read against every S7.1–S7.11 "Done"
  record; wording already matches what shipped, nothing invented or missing — no edit made.
  `custom_components/floorplan_studio/manifest.json`: `version` → `0.11.0`.
  - **A real code bug found, not fixed (docs-only scope):** `src/card/config-editor.ts` still carries S7.7's
    placeholder comment and UI hint ("Kiosk, Night and the sun entity land with S7.5 and S7.6; the card does not
    read them yet") and an `EditorConfig` interface that redeclares `kiosk`/`night`/`sun` as if
    `FloorplanStudioCardConfig` didn't already carry them. Both S7.5 and S7.6 landed those three keys onto
    `FloorplanStudioCardConfig` itself (`src/card/floorplan-studio-card.ts`) after S7.7 was written, so the form's
    own hint text is now false and shows the user a stale disclaimer for keys the card has read since 2026-09-24.
    Left as a follow-up task; this task's brief was docs only and forbade touching `src/` without a doc test
    demanding it.
  - Cleanup item (S7.12 point 9): the brief named a duplicated consecutive `await open(page);` pair in
    `tests/card/card.spec.ts` "from S7.6". Searched the file at this branch's base commit (`652554c`) for any two
    `await open(page);` lines within 3 lines of each other — none found (56 total calls, all singly placed). Either
    it was fixed by an earlier commit on `sprint/7` or the brief's line reference was stale; no change made since
    there was nothing to remove. Ran `PW_PORT=5312 npx playwright test tests/card/card.spec.ts --workers=4` anyway,
    as asked: 53 passed, exit 0.
  - Suites run fresh, in order, after the last edit: `npm run lint` exit 0. `NODE_OPTIONS=--no-experimental-webstorage
    npm test` 990 passed / 990, 30 files, exit 0. `npm run build` exit 0. `npm run docs:check` exit 0 (36 links
    checked across 8 files, 0 broken). `npm run docs:schema` then `git status --short docs/schema.md` empty (no-op,
    both before and after this task's other edits). `node scripts/validate-layout.mjs demo/layout.json` → `ok` (plus
    the pre-existing "devices or catalog are not empty" warning, expected since the demo has real devices).
    `node scripts/validate-layout.mjs prompts/examples/flat.json` → `ok`. `node scripts/validate-layout.mjs
    prompts/examples/two-floors.json` → `ok`. `PW_PORT=5312 npx playwright test --workers=4` (full suite): 521
    passed / 1 skipped, exit 0.
  - Left out: the release itself (push, tag, HACS refresh, HA restart) — not started; needs Diego's yes per this
    task's own "Done when" line and `CLAUDE.md`'s "Release ends on Diego's HA".

## Later, not planned

- Vacuum position from an integration that exposes coordinates (none of the common ones does today).
- Per-room presence heat map over a day.
- Import from ha-floorplan SVGs.
- Multiple layouts (several houses).

- ~~Export entity catalog, for an agent placing devices.~~ **Done as S6.7**
  (2026-09-24): `Layout.available` (`src/core/schema.ts`), built by
  `availableEntities()` (`src/core/ha.ts`), baked directly into File → Export's
  own download when `hass` is connected — not a separate button, and not part
  of Save or the live editor state. See `docs/DECISIONS.md` for why the
  earlier "keep it separate, not in `layout.json`" idea (below, struck
  through) was reversed.
