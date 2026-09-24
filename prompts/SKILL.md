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
4. **Stairs.** Only `straight` and `round` exist. A curved or angled flight is several `straight` sections end to end, each with its own `rot`. A spiral is `round` with `dia` and `inner`. Stairs appear on **every** floor they pass through.
5. **Furniture**, only if it is drawn clearly. Skip anything you are unsure of.
6. **Outdoors**, if drawn: a garden, terrace or pavement is a room with that `kind`, and may sit outside the outline.

Do **not** set `color`, `texture` or `palette`. Floor materials are the person's choice, made in the editor; a drawing's shading is not a colour. If the drawing labels a material (parquet, tiles), say so in the notes you give back and leave the field off.

Do **not** add devices, entities or a catalog. A drawing has no Home Assistant entities in it. Leave `devices` and `catalog` empty. Never invent an entity id. (Placing real devices on an *already-drawn* plan is a separate task, for a file exported from the editor with Home Assistant connected — see "Placing devices from an export" in `SCHEMA.md`.)

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
- Everything is in centimetres.

**If you can run commands**, save the file as `layout.json` and run

```
node scripts/validate-layout.mjs layout.json
```

from the repository. It prints `ok`, or one line per problem. Fix and run again until it prints `ok`. Do not hand over a file that does not.

**If you cannot run commands**, go through the list above line by line, out loud, against your own JSON. It is checked by a program later, and every line it rejects is a round trip for the user.

## 6. What you give back

1. The layout: if you can write files, `layout.json`. If not, one code block containing the JSON object and nothing else in the block.
2. Straight after it, a short **Guessed** list: every number you inferred, every assumption about north or scale, anything you left out. If there is nothing, write `Guessed: nothing.`
3. One line telling the user what to do next: open `dist/editor.html` (or the Floorplan Studio panel), **File → Open**, choose `layout.json`, fix what is off, **Save**.

No other commentary. No praise for the drawing, no explanation of what a polygon is.
