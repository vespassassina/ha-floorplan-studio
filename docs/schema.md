# Layout schema v2

Generated from the comments in [`src/core/schema.ts`](../src/core/schema.ts) — run
`node scripts/gen-schema-docs.mjs > docs/schema.md` after changing a comment or a field list there.
Never hand-edit this file: the next generation run throws the edit away.

For the full field-by-field validation rules (what makes a layout invalid, not just its shape), read
`validate()` in the same file, or the behaviour tables in [`SPEC.md`](SPEC.md).

## FLOOR_COLOURS

The twelve floor materials offered as swatches in the room panel (S1.35). Any #rrggbb is still valid on a room.

```ts
export const FLOOR_COLOURS: { name: string; hex: string }[] = [
  { name: "White ceramic", hex: "#f4f4f0" }, { name: "Marble", hex: "#e2dfda" }, { name: "Sand", hex: "#e6d5b8" },
  { name: "Terracotta", hex: "#c98a63" }, { name: "Light oak", hex: "#d8bd94" }, { name: "Warm wood", hex: "#b98b5c" },
  { name: "Dark oak", hex: "#86643f" }, { name: "Walnut", hex: "#5b4130" }, { name: "Light grey", hex: "#b4b6b8" },
  { name: "Grey floor", hex: "#8b8e91" }, { name: "Belgian stone", hex: "#4d4e50" }, { name: "Lava", hex: "#38393b" },
];
```

## MAX_PALETTE

Most extra colours a layout keeps in `palette`.

```ts
export const MAX_PALETTE = 24;
```

## MAX_ROOM_SENSORS

Most temperature, humidity or motion sensors one room may list.

```ts
export const MAX_ROOM_SENSORS = 20;
```

## Room

`area` is the HA area id, or empty for a custom shape. `entity` (custom shapes only) is the HA entity whose state the shape shows.  `temps`/`humidity`/`motion` (S11.1): the sensors that belong to this room, the way a door owns its contact sensors. The  plan shows no icon for them; the room shows the mean temperature and humidity under its name, and a red pulsing border  while any `motion` entity is on. At most `MAX_ROOM_SENSORS` each.

```ts
export interface Room { id: string; name: string; area: string; kind: RoomKind; pts: Pt[]; wk: EdgeKind[]; color?: string; texture?: string; textureRot?: number; textureScale?: number; free?: boolean; entity?: string; height?: number; temps?: string[]; humidity?: string[]; motion?: string[] }
```

## EdgeKind

A room edge is a wall kind, or "none": not drawn. The room stays closed for area and snapping.

```ts
export type EdgeKind = WallKind | "none";
```

## Wall

`locked` (S4.9): the segment's length is fixed. Dragging an endpoint then only pivots it, on an arc around the other endpoint.

```ts
export interface Wall { id: string; a: Pt; b: Pt; kind: WallKind; locked?: boolean; height?: number }
```

## StairDirection

Where a flight goes from this floor. Optional: absent reads from the floors around it (see `stairDirection` in stairs.ts). "both" is stacked stairs.

```ts
export type StairDirection = "up" | "down" | "both";
```

## Stairs

`dia` (outer) and `inner` (the empty well) exist on a round stair only; `pts` is its outer circle as a polygon. `rot` turns it about the centre of its box.

```ts
export interface Stairs { id: string; name: string; pts: Pt[]; shape: StairShape; steps: number; rot: number; dia?: number; inner?: number; direction?: StairDirection; color?: string; texture?: string; textureRot?: number; textureScale?: number }
```

## Door

`sensors`/`vibration`/`locks` (S4.24): every contact sensor, vibration sensor and smart lock attached to this door or window — several of each allowed. An unlocked lock reads the opening as open, same as a triggered contact sensor (Diego, 2026-09-28). `cover` (a curtain/blind entity) is not restricted by kind — a plain door's garage opener is a cover too — it just doubles as the electric-curtain field on a glass door or window. render.ts only colours the opening from `cover` on a plain `door` or `sealed` kind; on `window`/`glass` it is curtains, not a security state, and opening them never colours the window (Diego, 2026-09-28 — the office window's curtains were flipping it orange).

```ts
export interface Door { id: string; name: string; kind: DoorKind; a: Pt; b: Pt; sensors?: string[]; vibration?: string[]; locks?: string[]; cover?: string; locked?: boolean; height?: number; sill?: number }
```

## Opening

```ts
export interface Opening { id: string; a: Pt; b: Pt; locked?: boolean; height?: number; sill?: number }
```

## Extra

```ts
export interface Extra { id: string; name: string; a: Pt; b: Pt }
```

## Device

`bound` (lights only): the switch or plug that powers the same lamp. One icon on the plan, two entities in HA. Several lights may share one switch, and the switch may be an icon too. `trvs`/`tempSensors` (heater only) and `linked` (ac only), S4.24: every climate/TRV or temperature-sensor entity attached to this device — several allowed, unlike `bound`. `room` (person only), S7.8: an entity whose state, `area_id` or `area` attribute names the room the person is in (a Bermuda or ESPresense area sensor, say). The card moves the icon to that room; no match keeps the placed spot. The person's own `entity` is `person.*` or `device_tracker.*`. `targets` (radar only), S7.9: up to any number of x/y sensor-entity pairs from an mmWave presence sensor (an ESPHome LD2450, say), each pair's two entities reporting one target's position in millimetres, x to the sensor's right and y ahead of it. `entity` is the radar's own presence entity (typically a `binary_sensor.*occupancy`), which colours the icon; `rot` is which way the sensor points (`0` = ahead is screen-up), the same field a camera already uses for its cone. `motion` (lights only), S8.7: the motion sensor or motion-group entity that this light was linked to through the editor's "Turn on with... Create automation" flow — the automation the editor created, not this field, is what actually drives the light. Unlinking removes only this field; the automation itself stays in Home Assistant, untouched. Must differ from `entity`, same rule as `bound`. `power` (plugs only): the `sensor.*` (device class `power`) that measures the plug. A plug is active only while that sensor reads at least 2 W (the card's `plug_watts` changes the 2); switched on and drawing nothing is idle. Unset, the editor links the plug's sibling power sensor when it finds exactly one, and the card does the same at runtime; with no sensor at all a plug is active whenever its switch is on. Must differ from `entity`.

```ts
export type Device = { id: string; type: DeviceType; entity: string; name?: string; bound?: string; trvs?: string[]; tempSensors?: string[]; linked?: string[]; room?: string; targets?: { x: string; y: string }[]; rot?: number; motion?: string; power?: string; z?: number } & ({ x: number; y: number } | { a: Pt; b: Pt });
```

## Furniture

`name` is a plan name; `entity` is an HA entity whose state the piece shows. Both optional. `locked` (fixed):  a right-click "Fix" on the plan stops it being dragged or resized until "Unfix"; panel edits still apply.

```ts
export interface Furniture { id: string; symbol: FurnitureSymbol; x: number; y: number; rot: number; w: number; h: number; name?: string; entity?: string; locked?: boolean; height?: number }
```

## Unlinked

S4.25: an appliance placed on the plan with a fixed icon (by `type`, from `UNLINKED_TYPES`), not tied to a single entity's state. `attached` is zero or more HA entities linked to it for reference only — it never drives the icon's colour or the card's tap behaviour, unlike a `Device`. `color` overrides the idle grey; `scale` (0.25-4) resizes the icon, `rot` turns it. Furniture reused a swappable symbol; this reuses the device icon set instead because the point is "this is a heater", not "this is shaped like one".

```ts
export interface Unlinked { id: string; type: DeviceType; name?: string; x: number; y: number; rot: number; scale: number; color?: string; attached?: string[]; locked?: boolean; height?: number }
```

## Trace

S7.11: a scanned plan drawn under this floor in the editor, to trace walls over. Never drawn by the card, and left out of File, Export unless "Include trace image" is ticked. `src` is a `data:image/png|jpeg|webp;base64,` URL of at most `MAX_TRACE_BYTES`; the editor downscales to 2000 px on the long side before storing it. `x`/`y` is the image's top-left corner in cm, `w` its width in cm (the height follows the image's own aspect ratio), `rot` turns it about `x`/`y` in degrees, `alpha` is its opacity from 0 to 1, `on` false hides it and keeps it. An assistant never writes one.

```ts
export interface Trace { src: string; x: number; y: number; w: number; rot: number; alpha: number; on: boolean }
```

## Floor

`ha` is the HA floor id this floor is; when set, `title` is the name HA gave it. Heights, all optional, in cm, 0 to 1000  (`src/core/heights.ts` holds the defaults, which are read and never stored): `height` is the storey's wall and ceiling  height (250), `slab` the floor slab under the next storey (25). The same `height` on a Room (its ceiling), Wall, Furniture  and Unlinked; `height` and `sill` on a Door or Opening (a window defaults to 120 high from 90); `z` on a Device is its mount height.

```ts
export interface Floor {
  ha?: string; height?: number; slab?: number; title: string; outline: Pt[]; owk?: EdgeKind[]; rooms: Room[]; walls: Wall[]; stairs: Stairs[]; doors: Door[];
  openings: Opening[]; extras: Extra[]; devices: Device[]; furniture: Furniture[]; unlinked: Unlinked[]; trace?: Trace;
}
```

## CatalogEntry

```ts
export interface CatalogEntry { id: string; floor: string; room: string; type: DeviceType; name: string; entity: string }
```

## AvailableEntity

S6.7: one HA entity as it stood the moment the editor wrote `Layout.available` — File, Export's own snapshot, so an agent working from the downloaded file can add and position devices with no HA connection of its own. `area`/`areaName` are this entity's HA area, when it has one; `room` is this plan's own room name, only when that area already has a drawn room. `placed` is whether the entity already has its own device icon on some floor (`placedEntities`) — an agent should not place it a second time.

```ts
export interface AvailableEntity { entity: string; name: string; domain: string; area?: string; areaName?: string; room?: string; dc?: string; placed: boolean }
```

## Layout

`rotate`: the whole plan turned on screen, clockwise, in steps of 45 degrees. The stored coordinates are never turned.

```ts
export interface Layout { version: 2; unit: "cm"; north: number; rotate?: number; colors?: Partial<Record<DeviceType, string>>; palette?: string[]; floors: Record<string, Floor>; catalog: CatalogEntry[]; available?: AvailableEntity[] }
```

## MAX_TRACE_BYTES

S7.11: the most characters a floor's `trace.src` may hold, the whole data URL: 4 MB.

```ts
export const MAX_TRACE_BYTES = 4 * 1024 * 1024;
```

## MAX_LAYOUT_BYTES

Opus review 2026-09-25: Home Assistant's websocket takes 4 MiB in one message, and `floorplan_studio/save` sends the  whole layout in one. Save refuses a plan whose JSON is longer than this, and says which floors carry a trace image.

```ts
export const MAX_LAYOUT_BYTES = 3_500_000;
```

## TRACE_SRC

S7.11: a raster data URL and nothing else. SVG is left out (it is a document), and the base64 alphabet has no quote,  so a src that passes can go into an attribute as it is. Linear: no nested quantifier.

```ts
export const TRACE_SRC = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/;
```

## MOTION_TYPES

The types that mean "something moved here": the room's motion border, the icon fade and the card's fade timer all read this one list. A plain occupancy or presence sensor is typed `motion` (ha.ts), so it is in. `person` is not: it says who is home, not that a room is in use.

```ts
export const MOTION_TYPES: readonly DeviceType[] = ["motion", "radar"];
```

## UNLINKED_TYPES

S4.25: the appliance types offered in the Add > Unlinked device menu — a curated subset of DEVICE_TYPES, each with a fixed icon and no linked-entity state. "heatpump" reuses the "ac" icon and colour; there is no separate type for it.

```ts
export const UNLINKED_TYPES: readonly DeviceType[] = ["heater", "ac", "boiler", "battery", "computer", "tv", "car", "server", "ups", "inverter", "speaker", "printer", "light"];
```

