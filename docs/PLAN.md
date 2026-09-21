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

### S3.3 Pickers from hass
- Outcome: rooms pick an area, devices pick an entity, from HA data, grouped.
- Files: `src/editor/hass-pickers.ts`, `src/editor/panel.ts`, `tests/editor/pickers.test.ts`.
- Interface: amended by S1.38: the dropdowns themselves are already in the editor and read the `ha: HaData` property; this task only fills that property from `hass`. `haData(hass): HaData` (the type is `src/core/ha.ts`) reads `config/floor_registry/list` for `floors`, `config/area_registry/list` for `areas` with their `floor_id`, and the entity registry plus `hass.states` for `entities` (`id`, friendly name, domain); the panel sets `editor.ha = haData(hass)` after every registry change and on first load, and sets nothing when a registry call fails, so the editor falls back to free text instead of showing an empty list. Also: `areas(hass)` → `{id, name}[]`; `entitiesByType(hass)` → `Record<DeviceType, { entity: string; name: string; area: string | null }[]>` using domain and `device_class` (light→light; switch with device_class outlet→plug else switch; sensor temperature→temp, humidity→humidity; binary_sensor motion/occupancy→motion, door/window/garage_door/opening→contact; camera; climate; media_player; cover). Fetches `config/area_registry/list`, `config/device_registry/list`, `config/entity_registry/list` once. In the editor, Add → Device shows type → area → entity, hiding entities already placed; door panel's sensor list uses `contact` entities; the `catalog` is rebuilt from this list on Save when running in HA.
- Test: registry fixtures → grouping as above; a placed entity is absent from the list; a `hass` stub whose registries answer gives a `HaData` with the floors, the areas with their `floor_id` and the entities with their domain, and the editor's room panel then shows the area select of S1.38.
- Done when: tests pass; the panel in the dev container shows real areas and real floors.
- Break it: an entity with no area lands under "No area"; a `hass` with no floor registry (older HA) gives `floors: []` and the floor title stays free text.

### S3.4 Card as a resource (built 2026-09-21; live check open)
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

Panel only: every task needs `hass`. The standalone editor hides these
controls. Rules for the whole sprint: every write to HA is confirmed in a
dialog that names what will be created; everything the tool creates carries
the HA label `floorplan-studio` (created once, S4.1) so the user can find and
remove it; HA registries have no undo, and the dialog says so. Writes go
through `hass.callWS` (registries, config flows) and `hass.callApi` (automation
config). No write ever runs on load or on save.

### S4.1 Writes to HA
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
- Outcome: rooms and zones create HA areas; HA areas without a room are listed so the user can draw them.
- Files: `src/editor/panels.ts`, `src/editor/panel.ts`, `tests/editor/organise.spec.ts` (Playwright with a stub `hass` injected into the panel).
- Interface: amended by S1.38, which already made the area field a dropdown of what HA has; here the plain `select` becomes `ha-area-picker` in the panel build (the adapter of S4.8), and creating an area stays what it always was: an explicit choice, never automatic. A custom room — no `area` — gains a button "Create area <plan name> in HA" that runs `createArea` and then sets `room.area` to the new id and `room.name` to the new name, as choosing an area does. A room whose stored `area` is unknown to HA gets the same button with its plan name. No room is ever created in HA on load, on save, or by picking a name. A side box "Areas not on the plan" lists HA areas no room or zone uses; clicking one starts Draw, Room (S1.11) with `area` preset and `name` from the area.
- Test: Playwright: a custom room shows the button; click, confirm, `callWS` recorded, the select shows the new area and the room takes its name; a room already linked to a known area shows no button; an unused area appears in the box and disappears once a room takes it.
- Done when: tests pass; screenshot in the PR.
- Break it: Cancel in the dialog writes nothing, the room stays custom and keeps its plan name.

### S4.3 Devices into areas
- Outcome: placing or moving a device into a room assigns its HA area.
- Files: `src/editor/editor-app.ts`, `src/editor/panel.ts`, `tests/editor/organise.spec.ts`.
- Interface: after a device drop (place or drag end) inside a room or zone with an HA area, if the entity's device (or the entity, when it has no device) is in another area or none, ask "Move <name> to area <room>?" (one dialog per drop, with "Don't ask again this session"). Yes → `setDeviceArea` or `setEntityArea`. The Device menu (S1.12, grouped by area since S3.3) marks entities whose HA area differs from the room they sit in with a small dot and a tooltip "HA says: <area>".
- Test: Playwright: drop a device into a room with an area; dialog; Yes → `config/device_registry/update` recorded with that area; No → nothing; the dot shows for a mismatched device.
- Done when: tests pass.
- Break it: a device dropped outside every room asks nothing.

### S4.4 Light from a switch
- Outcome: a placed switch can become a light helper; the plan gets the light, bound to the switch.
- Files: `src/editor/panels.ts`, `tests/editor/organise.spec.ts`.
- Interface: switch or plug device panel gains "Create light from this switch". Confirm → `createHelper(hass, "switch_as_x", [{ entity_id, target_domain: "light" }])`; the new `light.*` entity is added to the catalog and placed 30 cm to the right of the switch, type `light`, `bound` = the switch entity; the switch device is removed from the plan (the light icon now stands for both, per SPEC). One undo step for the plan change; the helper stays in HA on undo, and the status line says so.
- Test: Playwright: button on a switch; confirm; the flow messages are recorded; a bound light appears and the switch icon is gone; undo restores the switch icon, status says the helper still exists.
- Done when: tests pass.
- Break it: a switch that is already some light's `bound` has no button.

### S4.5 Groups
- Outcome: create light and motion groups from the plan, and filter the plan by group.
- Files: `src/editor/editor-app.ts`, `src/editor/panels.ts`, `tests/editor/organise.spec.ts`.
- Interface: Shift+click selects several devices of one type (lights, or motion sensors); the panel shows "Create group" with a name field. Confirm → `createHelper(hass, "group", [{ next_step_id: "light" | "binary_sensor" }, { name, entities, hide_members: false, all: false }])`. The Group menu (new toolbar menu, after Device) lists HA group entities whose members are on the current floor; choosing one dims every device not in it (class `dim`); "All" clears. Group membership comes from `attributes.entity_id` of the group entity in `hass.states`.
- Test: Playwright: Shift+click two lights, Create group "Hall", the flow messages are recorded; the Group menu lists a stub group and choosing it dims the others.
- Done when: tests pass.
- Break it: a mixed selection (light and motion) shows no Create group button.

### S4.6 Links and automations
- Outcome: a switch turns on several things; a motion group turns on a light group; a device gets a time schedule. Each becomes an HA automation the user finishes in HA's editor.
- Files: `src/editor/panels.ts`, `src/editor/automations.ts`, `tests/editor/automations.test.ts`, `tests/editor/organise.spec.ts`.
- Interface: `automations.ts` builds configs (pure): `switchControls(switchEntity, targets: string[])` (trigger: state of the switch, action: `homeassistant.turn_on` / `turn_off` targets, two automations or one with choose), `motionLights(motionGroup, lightGroup, offAfter: number)` (on when the group turns on; off after `offAfter` s with no motion), `schedule(entity, on: "HH:MM", off: "HH:MM")`. Panels: switch panel "Controls..." picks lights, switches, plugs or groups (many); motion group in the Group menu gets "Turns on..." picking a light group and a minutes field; light, switch, plug and media panels get "Schedule" with two time fields. Each: confirm, `createAutomation`, then `openAutomation`, so the user lands in HA's editor with the automation already saved. A single switch to a single light suggests "Create light from this switch" (S4.4) instead of an automation. The plan stores nothing about automations: HA is the source, and the room box (S4.7) shows them.
- Test: unit: each builder returns the documented config, `schedule` rejects a malformed time; Playwright: switch panel, pick two lights, confirm, `callApi` POST recorded with the built config, then `location-changed` fires with the edit URL.
- Done when: tests pass.
- Break it: picking the switch itself as a target is refused with the text "A switch cannot control itself".

### S4.7 Room box
- Outcome: selecting a room or zone shows everything HA has in its area, not only what is drawn.
- Files: `src/editor/panels.ts`, `src/editor/panel.ts`, `tests/editor/organise.spec.ts`.
- Interface: below the room panel, a box "In Home Assistant" lists the area's entities grouped by domain: devices (placed ones marked), helpers (`input_*`, `group`, `switch_as_x` lights), automations, scripts, scenes. A scene row has "Run" (`scene.turn_on`). Each row opens more-info on click. "Add to area..." opens `ha-entity-picker` limited to entities with no area; picking one runs `setEntityArea`. Automations and scripts get "Edit in HA" (navigate to their HA editor).
  Amended by S1.37: a custom room, which has no area and may have an `entity`, shows that one entity's row instead of an area list, with the same more-info click, and the S4.2 button to create an area.
- Test: Playwright with stub registries: the box lists the fixture's entities under the right headings; Run calls `scene.turn_on`; Add to area records the registry update; a custom room with `entity: "sensor.pond"` shows that row and no headings.
- Done when: tests pass.
- Break it: a custom room with no area and no entity shows "No area: set one above" and no list.

### S4.8 Native look
- Outcome: the panel looks like the rest of HA, light and dark.
- Files: `src/editor/panel.ts`, `src/editor/theme.ts`, `tests/editor/theme.test.ts`.
- Interface: `theme.ts` maps every `--fp-*` variable to an HA theme variable (`--primary-color`, `--card-background-color`, `--primary-text-color`, `--divider-color`, `--state-icon-color`, `--error-color`, `--warning-color`, `--success-color`, `--info-color`); the panel sets them on its host and re-applies on `hass.themes` change. Form controls in the panel are HA's own elements when running in HA: `ha-textfield`, `ha-select`, `ha-switch`, `ha-area-picker`, `ha-entity-picker`, `mwc-button`; the standalone build keeps plain HTML controls behind the same panel code (a `pickers` adapter chosen at construction). Panel chrome uses `ha-top-app-bar-fixed` with the sidebar toggle, like HA's own panels.
- Test: unit: the map covers every `--fp-*` in `FLOORPLAN_CSS` (parsed from the string); Playwright in the dev container: screenshots in the default theme and in a dark theme, attached to the PR, no `#rrggbb` in panel CSS except the theme file.
- Done when: tests pass; screenshots reviewed.
- Break it: with `hass.themes` missing (older HA) the map falls back to the `FLOORPLAN_CSS` defaults and the panel still renders.

---

## Sprint 5 — content and docs (E5)

### S5.1 Furniture in editor and card
- Outcome: every symbol in `FURNITURE` can be placed, sized, rotated; the card draws them under devices.
- Test: Playwright places each symbol; render snapshot with all symbols.
- Done when: tests pass.
- Break it: rotation 450 is stored as 90.

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

### S5.4 Demo and HACS default
- Outcome: a GIF in the README; submission PR to the HACS default repository.
- Done when: GIF under 3 MB; submission opened.

### S5.5 Help guide in the editor
- Outcome: a Help button opens a step-by-step guide in a side panel, written so a twelve-year-old can follow it without asking anyone.
- Files: `src/editor/guide.ts` (the steps, as data), `src/editor/panels.ts`, `src/core/render.ts` only if the panel needs a token, `tests/editor/guide.test.ts`, `tests/editor/editor.spec.ts`.
- Interface: a `#help` button in the editor's toolbar toggles a side panel, not a dialog, so the reader can follow a step and do it with the guide still open. The steps are one array of `{ title: string; body: string }`, rendered as a list, each entry a short title and one or two sentences. The panel is card chrome: the editor's own DOM, never drawn by `renderFloor`. It ships inside `dist/editor.html`, so it works offline and from `file://`, and the panel is the same one the HA sidebar version shows. Open or closed is remembered in `localStorage` under `floorplan-studio:help`, next to the grid, measure and theme preferences — never in the layout, never an undo step. Escape closes it; the button says whether it is open through `aria-expanded` and nothing else (a Sprint 1.6 finding: do not state the same thing twice to a screen reader).
- Content: the first draft covers drawing the outside wall, closing it, inside walls, doors and windows, placing a device, attaching an entity, floors, saving and opening. Plain words. No "canvas", no "polygon", no "viewport". A step names what the reader clicks and what they will see happen.
- Test: the panel opens from the button and closes with Escape; the step count matches the array; every step has a non-empty title and body; the panel is reachable by keyboard from the toolbar and returns focus to the button when it closes; `getComputedStyle` in Chromium confirms it is readable in both themes.
- Done when: tests pass; someone who has never seen the tool follows the steps unaided and ends with a saved floor, and what they got stuck on is written down.
- Break it: the guide is open when the plan is rotated, when a floor is added and when a layout is loaded, and none of them closes it or loses the reader's place; the steps do not scroll away under the toolbar on a narrow window.

### S5.6 Unavailable entities are struck through
- Outcome: the plan matches `docs/SPEC.md`, which says an unavailable entity is struck through; the CSS only dims it with `opacity:.45`.
- Note: found while building S2.6. The `unavailable` class is applied correctly everywhere; only the styling falls short. Decide whether the spec or the CSS is wrong before writing code — dimming may be the better answer, in which case the spec changes and this task is a one-line edit plus a `docs/DECISIONS.md` entry.
- Test: `getComputedStyle` in Chromium on an unavailable device in both themes.
- Done when: the spec and the pixel agree, whichever way it is settled.

### S5.7 The viewBox leaves room for what a device paints around itself
- Outcome: a lamp or a camera near an outer wall shows all of what it draws, not a circle cut off by the edge of the plan.
- Note: found by the S2.8 verifier. `viewBoxFor` pads the walls' bounding box by a fixed 60 cm, but a lit lamp's aura reaches 100 cm from its centre and a camera's cone the same, so a wall-mounted sconce 20 cm inside the wall has its aura clipped (right edge at x=880 against a viewBox edge at x=860). Not new to S2.8 — the camera cone has carried the same exposure since Sprint 1 — and neither task's done-when covers it.
- Files: `src/core/render.ts`, `tests/core/render.test.ts`.
- Interface: the padding is the greater of 60 cm and the reach of anything a device paints around its own centre. Decide one way: a constant next to the aura and cone radii that all three read, so the three cannot drift apart again.
- Test: a fixture with a light 20 cm inside the right wall gives a viewBox whose right edge is at or beyond the aura's right edge; the same for a camera at the top wall; a plan with no devices keeps the 60 cm padding exactly, so no existing snapshot moves.
- Break it: a light exactly on a wall, and a plan whose only device is a light, still give a finite viewBox with the whole circle inside it.

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

## Later, not planned

- Per-room presence heat map over a day.
- Import from ha-floorplan SVGs.
- Multiple layouts (several houses).
