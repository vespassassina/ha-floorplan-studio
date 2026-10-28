# The sun on the 3D house: Sprint 38

Status: draft, 2026-10-27, waits for Diego's yes. Plan: `docs/PLAN.md`, Sprint 38.

## Why

Review of 2026-10-22, plan C item 13: "`sun.sun` elevation and azimuth tint the side of the house facing it in 3D,
windows glow by day. Cheap in three.js, strong in a screenshot." The direction was specified as S15.3b and S15.3c for
0.17.0 and never built; only S15.3a (`north` and the compass rose) shipped. Today the 3D sun is a fixed light from the
south-west (`src/card/three/view3d.ts`, `sun.position.set(-0.5, 1, 0.8)`).

Diego, 2026-10-27: direction and low-sun warmth, plus sun patches through the windows; no new config key; the 2D wedge
(S15.3d) stays later.

## Goal

In the card's 3D view, the light comes from where the sun is, and the sun shines through the windows that face it.

## Non-goals

- Cast shadows (SPEC: "Real shadows from the sun stay a non-goal").
- The 2D wedge (S15.3d). Later.
- A config key. The sun follows the `sun` entity the card already reads for `night: auto` (default `sun.sun`).
- The Studio. It has no live 3D view; the sun is card-only on purpose (parity rule: an exception, stated).
- Floors below (ghost or solid). They keep today's fixed light and get no patches.

## Behaviour

1. **Input.** The card reads `azimuth` and `elevation` from the `sun` entity's attributes. Both must be finite numbers,
   azimuth in [0, 360), elevation in [-90, 90]. Anything else (missing, a string, `NaN`, a `binary_sensor` with no such
   attributes, the entity `unavailable`) gives no sun.
2. **When.** The sun is used while elevation > 0 and the plan is not drawn at night (`_night()` false). `night: on`
   wins over a sun above the horizon. With no sun, the light is today's fixed daylight, pixel for pixel.
3. **Direction.** `sunDir(azimuth, elevation, north)` (pure, in the 3D chunk) gives the light's direction in plan
   space: plan bearing `azimuth + north`, clockwise from plan-up (SPEC, Layout schema, `north`), at `elevation` above
   the ground. The house's on-screen turn (`rotate`, the camera's azimuth) does not change which wall is lit: the sun
   belongs to the house, not the screen.
4. **Strength and warmth.** The directional light's intensity is today's `DAY.sun` at elevation 30° and above, and
   falls linearly to 60 % of it at 0°. Under 15° its colour moves linearly from white toward warm (`#ffd9a0` at 0°).
   The hemisphere light is unchanged.
5. **Theme contrast holds.** The SPEC rule "tops, sun faces and shade faces step apart by at least 6 %" holds with the
   sun at the four compass bearings, at 10° and 50°, in every theme.
6. **Sun patches.** Each opening of kind `window`, `fullwindow`, `glass`, `slit` or `open` on an edge with the outside
   on one side (an outline edge or an `external` wall) whose outward face looks toward the sun (horizontal dot product
   > 0) casts a patch of light on the floor of the room inside. The patch is the opening (its width, from sill to head,
   `doorSpan`) projected along the sun's direction onto the floor top: a quad, clipped to the room's polygon, at most
   `SUN_REACH` (800 cm) from the wall. A door (`door`, `sealed`) casts none, nor does an opening between two rooms.
7. **Look.** A patch is additive, soft-edged (a feathered border, not a hard quad), and lies on the floor top as the
   lamp pools do (`fx.ts`). Its strength grows with `sin(elevation)` and the cosine of the angle between the sun and
   the wall's normal; low sun is warm as in 4. A light theme caps it as `LIGHT_GLOW_CAP` caps a wall glow.
8. **Budget.** At most `MAX_SUN_PATCHES` (24) patches, the largest first. They are built when the floor, the theme or
   the sun moves by 1° or more in azimuth or elevation; a state update that leaves the sun alone builds none.
9. **Bytes.** The maths, the light and the patches live in the lazy 3D chunk. The card passes the two raw numbers
   (or nothing) through `setLive`; it does not import `sunDir`. The card's growth is reported in gzip bytes.

## Acceptance criteria

Each is one test. Pixel tests drive the built card in Chromium, compare against the same view with no sun, and
assert asymmetric values (finding 4); new Playwright tests run with `--repeat-each=10` (finding 13).

1. `sunDir` at azimuth 0, 90, 180, 270 with `north` 0, 90 and 270: the expected plan direction for each of the 12
   cases. Elevation 0, -5, missing, `NaN`, `"12"`: null.
2. The card hands `{ azimuth, elevation }` to the 3D view from `sun.sun`, and from a `sun:` entity named in config;
   junk attributes and a `binary_sensor` hand nothing. Shape of `sun.sun`'s attributes copied from the HA source, and
   the test says where (finding 21).
3. Sun at azimuth 180, elevation 40, `north` 0: the south outer wall face is brighter than the north one, by at least
   the 6 % step. With `north` 180, the north face is the bright one.
4. `rotate: 90` on the same layout: the same wall is bright as with `rotate: 0`.
5. Elevation 5: the sunlit face is warmer (red over blue ratio up) than at elevation 40.
6. No sun (elevation -3, or attributes missing): the frame equals today's frame, pixel for pixel, in blueprint.
7. `night: on` with the sun at 40°: no patch, today's night light.
8. A south window, sun at 180 / 40: a floor point inside the predicted patch is brighter than without sun; a point
   outside it is not. A north window on the same floor: no patch.
9. An opening between two rooms, and a `door` on a south external wall: no patch.
10. A patch never leaves its room: a point just beyond the room's wall, inside the predicted quad, is unchanged.
11. 30 south windows: 24 patches (`data-sun-patches="24/30"` on the container, as `data-pools` today).
12. A `hass` update that changes a light but not the sun builds no patch (a build counter on the test hook).
13. Shots: `npm run shots` with the demo home, sun at 135 / 25, in blueprint, light and ha, looked at, and the
    south-east rooms at 4x (finding 16).
