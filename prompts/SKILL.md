---
name: floorplan-trace
description: Turn architect drawings, photos or a hand sketch of a home into a floorplan-studio layout.json that opens in the editor. Use when the user gives you plans, photos of plans or a sketch and wants them drawn in Floorplan Studio.
---

# Trace a floor plan into Floorplan Studio

You are turning a picture of a home into one JSON file. A person will open that file in the Floorplan Studio editor, fix what is off, and attach their Home Assistant devices. Your job is the **geometry**: the outer walls, the rooms, the doors and windows, the stairs. Nothing else.

Read `SCHEMA.md` first. It is short and it is the format. `examples/flat.json` and `examples/two-floors.json` are complete files that pass the checker: copy their structure.

## 1. Ask two questions before you draw anything

Ask both, together, and wait for the answers. You cannot recover either one afterwards.

1. **Give me one real measurement**: the length of one wall, or of one room, and which wall it is. (A tape measure reading, a number printed on the drawing, or "the front door is 90 cm" all count.)
2. **Where is north on the picture?** Up, down, left, right, or an angle. If the user does not know, say `0` (up) and tell them so at the end.

If the user has no measurement at all, do not invent one. Say that scale cannot be known, offer to use a standard interior door as 90 cm and a standard step as 25 cm deep, and ask them to confirm. Then use it and say that you did.

## 2. Work out the scale

Pick one dimension the drawing gives you. Find the same distance on the picture. That gives you centimetres per unit of picture. Check it against a second dimension. If the two disagree by more than about 5 %, tell the user which two and ask which is right.

Units are **centimetres**. A 6 m wall is `600`. The commonest mistake is writing `6`.

## 3. Draw, in this order

Do one floor at a time, lowest first. Put `[0, 0]` at the top-left corner of the building, y increasing **downward**.

1. **Outline.** The outer edge of the building. Walk the corners once; do not repeat the first point. Set `owk` to `"external"` on every edge.
2. **Rooms.** One per enclosed space. Where two rooms share a wall, give the shared corners **identical coordinates**. Set `wk` per edge: `"external"` where it lies on the outline, `"wall"` between two rooms. Name each room as the drawing does. Use `area: ""` and `label: ""`.
3. **Doors and windows.** Two end points lying **on** a wall. Doors 80 to 100 cm wide. Mark glazed doors `glass`, fixed windows `sealed`.
4. **Stairs.** Only `straight` and `round` exist. A curved or angled flight is several `straight` sections end to end, each with its own `rot`. A spiral is `round` with `dia` and `inner`. Stairs appear on **every** floor they pass through. Leave out `direction`; the person sets it in the editor for stacked stairs.
5. **Furniture**, only if it is drawn clearly. Skip anything you are unsure of.
6. **Outdoors**, if drawn: a garden, terrace or pavement is a room with that `kind`, and may sit outside the outline.

7. **Heights**, only the ones the drawing states. See the next section.

Do **not** set `color`, `texture` or `palette`. Floor materials are the person's choice, made in the editor; a drawing's shading is not a colour. If the drawing labels a material (parquet, tiles), say so in the notes you give back and leave the field off.

Do **not** add devices, entities or a catalog. A drawing has no Home Assistant entities in it. Leave `devices` and `catalog` empty. Never invent an entity id. (Placing real devices on an *already-drawn* plan — including a `person`'s `room` field or a `radar`'s `targets` pairs — is a separate task, for a file exported from the editor with Home Assistant connected — see "Placing devices from an export" in `SCHEMA.md`.)

Do **not** set `trace` either. That is the owner's own scan or photo, loaded and scaled by hand in the editor (Edit, Trace image…), never written by you.

## 3a. Heights: read them, never invent them

Every height is optional and in **centimetres**. The editor and the card already know a sensible default for each (a storey is 250, a door 210, a window 120 high from 90, a sofa 85 ...), so a file with no height at all is correct. Write one only when the drawing tells you.

Look for them in section drawings, elevations and notes: `h=2.70`, `H 2.40`, `ceiling 2.50`, `h.u. 2.70` (hauteur sous plafond), `lichte Höhe 2.50`, window sills (`parapet 0.90`, `Brüstung 0.90`, `davanzale 90`), door heights (`2.10`, `2.20`), balustrade or fence heights (`1.10`). Convert metres to centimetres: `2.70` is `270`. The commonest mistake is writing `2.7`.

- **`height` on the floor**: the storey's ceiling height, when the drawing gives one for the whole floor.
- **`height` on a room**: only for a room whose ceiling differs from its floor (a lower bathroom, a double-height hall).
- **`height` on a wall** or a `fence`/`extras` guard: only for a low wall or a balustrade the drawing dimensions.
- **`height` and `sill` on a door or window**: `sill` is the bottom edge above the floor, `height` the opening itself. Set them only where they differ from the default (a window defaults to `sill` 90, `height` 120; a door to `sill` 0, `height` 210). A French window that runs to the floor is `sill` 0.
- **`slab`** (the floor thickness between storeys, default 25): only if a section gives it.
- Furniture, unlinked appliances and devices: leave their heights out. The defaults are by type.

If the drawing does not say, **leave the field out**. Do not round to a "typical" value and do not copy one floor's height to another floor that has none. A value you write that equals the default adds nothing; skip it.

## 4. When you cannot read something

Do not guess a number that decides the geometry. If a dimension is smudged, cut off or missing:

- Ask the user, if you can.
- Otherwise infer it from proportion to something you can read, and put it on the **Guessed** list you give at the end, with the value you used.

A wrong guess that is listed costs the user ten seconds. A wrong guess that is silent costs them a wall in the wrong place.

## 5. Check your own work. This is not optional.

Before you answer:

- Every polygon is closed, has at least 3 points, and does not repeat its first point.
- Every `wk` has exactly as many entries as its `pts`. `owk` matches `outline`.
- Every room of kind `room` lies inside the outline.
- Every door and window sits on a wall.
- Shared walls use identical coordinates on both sides.
- Every id is unique within its floor.
- Everything is in centimetres, heights included.
- Every height is a number from 0 to 1000 that the drawing actually states.

**If you can run commands**, save the file as `layout.json` and run

```
node scripts/validate-layout.mjs layout.json
```

from the repository. It prints `ok`, or one line per problem. Fix and run again until it prints `ok`. Do not hand over a file that does not.

**If you cannot run commands**, go through the list above line by line, out loud, against your own JSON. It is checked by a program later, and every line it rejects is a round trip for the user.

## 6. What you give back

1. The layout: if you can write files, `layout.json`. If not, one code block containing the JSON object and nothing else in the block.
2. Straight after it, a short **Guessed** list: every number you inferred, every assumption about north or scale, anything you left out. If there is nothing, write `Guessed: nothing.`
3. A **Heights** list: which heights you read from the drawing (with where: "section A-A: 2.70 m, so floor `first` `height` 270"), and which you left to the defaults. If the drawing gave none, write `Heights: none given, defaults apply.`
4. One line telling the user what to do next: open **Floorplan Studio** in the Home Assistant sidebar, **File → Open…**, choose `layout.json`, fix what is off, **Save**.

No other commentary. No praise for the drawing, no explanation of what a polygon is.
