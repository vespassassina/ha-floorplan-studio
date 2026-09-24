# The layout format (v2), for someone drawing one

A plan is one JSON file. Everything is in **centimetres**. **x grows to the right, y grows downward**, so the top-left corner of the drawing is `[0, 0]` and a point 2 m right and 3 m down is `[200, 300]`. North is up unless `north` says otherwise. Every point is a two-number array `[x, y]`.

This page lists what you write. Leave everything else out.

## The whole file

```json
{
  "version": 2,
  "unit": "cm",
  "north": 0,
  "floors": { "ground": { ... }, "first": { ... } },
  "catalog": []
}
```

| Field | Rule |
|---|---|
| `version` | Always `2`. |
| `unit` | Always `"cm"`. |
| `north` | Degrees clockwise from the top of the drawing to north, `0` up to `359`. If north is straight up on your drawing, `0`. |
| `floors` | An **object** keyed by a short id you choose (`ground`, `first`, `basement`), not an array. Lowest floor first. |
| `catalog` | Always `[]`. |

## One floor

```json
{
  "title": "Ground",
  "outline": [[0,0],[800,0],[800,600],[0,600]],
  "owk": ["external","external","external","external"],
  "rooms": [], "walls": [], "stairs": [], "doors": [],
  "openings": [], "extras": [], "devices": [], "furniture": []
}
```

- **`title`**: text, the name of the floor.
- **`outline`**: the outer edge of the building on this floor, a closed polygon of at least 3 points, walked in either direction. Do not repeat the first point at the end; the shape closes itself.
- **`owk`**: one entry per outline point, describing the edge from that point to the next. Use `"external"` for an outside wall. Same length as `outline`.
- **`devices`** and the top-level **`catalog`**: always empty. A drawing does not know which lamp is which. The owner attaches real Home Assistant entities in the editor afterwards. Never invent an entity id.
- Every list must be present, even when empty.

Every object in `rooms`, `walls`, `stairs`, `doors`, `openings`, `extras`, `furniture` needs an **`id`**, unique within its floor. Use `room-<floor>-<n>`, `door-<floor>-<n>` and so on.

## Rooms

```json
{ "id": "room-ground-1", "name": "Living room", "area": "", "label": "", "kind": "room",
  "pts": [[0,0],[500,0],[500,400],[0,400]],
  "wk": ["external","wall","wall","external"] }
```

- **`pts`**: a closed polygon, at least 3 points, no repeated last point. A room that shares a wall with its neighbour uses **exactly the same coordinates** for the shared corners. Do not leave a gap and do not overlap.
- **`wk`**: one entry per point, describing the edge from that point to the next. **Same length as `pts`.** Each is one of:
  - `"external"` an outside wall, `"wall"` an inside wall, `"boundary"` a thin line (garden edges, zones), `"fence"`, `"edge"`, or `"none"` (not drawn).
- **`area`**: always `""`. The owner links it to a Home Assistant area later.
- **`label`**: always `""`.
- **`name`**: what the drawing calls the room. Text, required, may be empty.
- **`kind`**, one of:

| kind | use for |
|---|---|
| `room` | any enclosed room inside the house |
| `structure` | a solid block inside the house that is not a room (a chimney breast, a lift shaft) |
| `terrace` | a covered or paved outdoor area next to the house |
| `garden` | lawn, planting |
| `pavement` | paths, driveways |
| `water` | a pond or pool |
| `zone` | a dotted sub-area inside a room (a reading corner). Its `wk` must be all `"boundary"`. |
| `fill` | a hatched region, rarely needed |

`room` and `structure` must lie **inside the outline**. The others may sit outside it.

Optional: `"color": "#rrggbb"` sets a floor colour; `"texture"` (`wood-light`, `wood-warm`, `wood-dark`, `stone-white`, `stone-grey`, `stone-bluegrey`, `stone-black`) paints a pattern instead, and wins over `color`. Stairs take both too. The layout may carry `"palette": ["#rrggbb", ...]`, the custom colours the editor offers as swatches (at most 24); an assistant leaves it out.

## Doors and windows

```json
{ "id": "door-ground-1", "name": "Front door", "kind": "door", "a": [100,400], "b": [190,400] }
```

`a` and `b` are the two ends of the opening, **lying on a wall**: an edge of the outline, of a room, or of a free wall. Within about 15 cm is fine; further than that the checker calls it floating. A door is roughly 80 to 100 cm wide, a window 80 to 250.

`kind`: `door`, `glass` (glass door or wide glazed opening), `window`, `sealed` (a fixed, non-opening window). `name` is required text.

## Stairs

```json
{ "id": "stairs-ground-1", "name": "Stairs", "shape": "straight", "steps": 4, "rot": 0,
  "pts": [[500,40],[580,40],[580,200],[500,200]] }
```

- `shape` is `straight` or `round`. Nothing else exists.
- **`steps`**: whole number from 2 to 40. `rot`: degrees, `0` to `359`.
- `pts`: the rectangle the flight fills, as a polygon.
- A **curved or angled flight** is written as several `straight` sections placed end to end, each with its own `rot`.
- A **spiral** is `round`, and then also needs `dia` (outer diameter, at least 40) and `inner` (the empty well, from 0 to `dia - 40`). `pts` is the outer circle as a polygon.

## Furniture

```json
{ "id": "furniture-ground-1", "symbol": "sofa", "x": 250, "y": 320, "rot": 0, "w": 200, "h": 90 }
```

`symbol` is one of `table sofa bed cabinet chair sink toilet shower bathtub tv computer tree patio-wood patio-concrete car`. `x`, `y` is the centre. `w`, `h` are its size in cm, each between 5 and 2000. `rot` in degrees. Furniture is optional; skip anything you are not sure of.

## Walls, openings, extras

`walls` holds free-standing wall segments `{ "id", "kind": "wall", "a", "b" }` for a wall that is not the edge of any room. `openings` holds a gap in a wall, `{ "id", "a", "b" }`. `extras` holds named lines such as a balustrade, `{ "id", "name", "a", "b" }`. Leave all three `[]` unless the drawing clearly needs one.

## Placing devices from an export — a different task

Everything above is for **tracing a drawing**, where `devices` and `catalog` stay empty: a drawing does not know which lamp is which. This section is for the opposite task, which only makes sense once someone has already drawn a plan in the editor, connected it to Home Assistant, and used **File → Export**: adding and positioning devices on an **already-drawn** plan, offline, from that one downloaded file.

When Home Assistant was connected at export time, the file carries one extra top-level array, `available` — a snapshot of every entity the editor knew about at that moment:

```json
{ "entity": "light.kitchen_ceiling", "name": "Kitchen ceiling", "domain": "light",
  "area": "kitchen", "areaName": "Kitchen", "room": "Kitchen", "placed": false }
```

- **`entity`**: the real Home Assistant entity id. This is the only source of entity ids for this task — **never invent one, never guess one, never reuse an id from another layout or example.** If the entity you need is not in `available`, say so and stop; you cannot place it.
- **`name`**: its friendly name, for you to read; not written anywhere in the layout.
- **`domain`** / **`dc`**: the entity's domain (`light`, `switch`, `binary_sensor`, `sensor`, ...) and device class, when it has one (`motion`, `door`, `temperature`, ...). Use these to guess a sensible `Device.type` (`light`, `motion`, `contact`, `temp`, ...).
- **`area`** / **`areaName`**: the entity's Home Assistant area, when it has one.
- **`room`**: this plan's own room name, filled in only when that area already has a drawn room on the plan — place the device inside that room's polygon. When `room` is absent, either the entity has no area, or that area has no room drawn yet: ask, or place it near the plan's edge and say you were unsure.
- **`placed`**: `true` when the entity already has its own device icon on some floor. Skip it — placing it again would create a duplicate icon for the same entity.

To add one, push an object onto the right floor's `devices` array:

```json
{ "id": "dev-ground-9", "type": "light", "entity": "light.kitchen_ceiling", "x": 320, "y": 140 }
```

`id` unique within its floor, `type` one of the `DeviceType` values (see `docs/schema.md`), `entity` copied verbatim from `available`, `x`/`y` the centre in centimetres (or `a`/`b` for a two-point device such as a cover) — inside the room `available` named, or wherever the user told you. Leave `available` itself in the file; the editor drops it automatically the next time the file is saved or re-exported, so you don't need to strip it yourself.

`available` never appears in a file you produced yourself (tracing a drawing gives Home Assistant nothing to snapshot). It only appears in a file the user downloaded from an already-configured plan's **File → Export**, with Home Assistant connected at the time.

## Check it

```
node scripts/validate-layout.mjs my-layout.json
```

prints `ok`, or one line per problem. Fix and run again until it prints `ok`. It catches the schema errors above, metres written as centimetres, a room outside the outline, and a door that sits on no wall.

Two complete, valid examples are in `prompts/examples/`: `flat.json` (one floor) and `two-floors.json` (two floors and a stair).
