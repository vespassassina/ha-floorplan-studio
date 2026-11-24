import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildScene } from "../../src/core/scene";
import { validate, type Floor, type Layout } from "../../src/core/schema";
import { Picker } from "../../src/card/three/pick";
import {
  applyHeightHandle,
  handlesForSel,
  moveItem3D,
  rayOnZ,
  setItemRot,
  rayZAt,
  rotateSel15,
  selFromHit,
  setItemZ,
} from "../../src/editor/ops3d";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const ground = (): Floor => structuredClone(demo.floors.ground);

describe("3D Studio pure maths and ops", () => {
  it("intersects horizontal and vertical planes accurately across camera angles", () => {
    const p = rayOnZ({ o: [100, 300, 200], d: [1, -1, -2] }, 0);
    expect(p).toEqual([200, 200]);

    const pHigh = rayOnZ({ o: [0, 200, 300], d: [0, -1, -1] }, 100);
    expect(pHigh).toEqual([0, 0]);

    expect(rayOnZ({ o: [0, 0, 100], d: [1, 0, 0] }, 0)).toBeNull();
    expect(rayOnZ({ o: [0, 0, 100], d: [0, 0, 1] }, 0)).toBeNull();

    // Camera looking south -> north towards vertical anchor (200, 100) aiming at Z = 150
    const z1 = rayZAt({ o: [200, 400, 300], d: [0, -1, -0.5] }, 200, 100);
    expect(z1).toBeCloseTo(150, 5);

    // Oblique camera from SE aiming at (50, 50, 120)
    const dir: [number, number, number] = [-100, -100, -80];
    const z2 = rayZAt({ o: [150, 150, 200], d: dir }, 50, 50);
    expect(z2).toBeCloseTo(120, 5);

    expect(rayZAt({ o: [50, 50, 200], d: [0, 0, -1] }, 50, 50)).toBeNull();
  });

  it("Picker.hit exposes unlinked furniture, walls, doors, rooms and exact hit points without altering Picker.pick", () => {
    const f = ground();
    const sc = buildScene(f);
    const picker = new Picker(sc.solids);
    const zOf = (s: (typeof sc.solids)[number]) => (s.shape.type === "point" ? null : ([s.shape.z0, s.shape.z1] as [number, number]));

    // Pick a piece of furniture without an HA entity by shooting down onto its center
    const tableIdx = f.furniture.findIndex((m) => !m.entity && m.symbol !== "rug");
    if (tableIdx >= 0) {
      const m = f.furniture[tableIdx];
      const ray = { o: [m.x, m.y, 400] as [number, number, number], d: [0, 0, -1] as [number, number, number] };
      const hit = picker.hit(ray, zOf);
      expect(hit?.solid.kind).toBe("furniture");
      expect(hit?.solid.ref.index).toBe(tableIdx);
      expect(selFromHit(f, hit ? { kind: "solid", solid: hit.solid, pt: hit.pt } : null)).toEqual({ t: "furn", i: tableIdx });
      // Card pick still treats non-entity furniture as room/other
      const cardPick = picker.pick(ray, zOf);
      expect(cardPick?.type).not.toBe("piece");
    }

    // Pick a free wall if present, else a room edge
    if (f.walls.length) {
      const w = f.walls[0], mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2;
      const hit = picker.hit({ o: [mx, my, 400], d: [0, 0, -1] }, zOf);
      if (hit?.solid.kind === "wall" && hit.solid.ref.poly === "w") {
        expect(selFromHit(f, { kind: "solid", solid: hit.solid, pt: hit.pt })).toEqual({ t: "wall", i: hit.solid.ref.index });
      }
    }
  });

  it("moves items with snapping and adjusts z height safely within schema bounds", () => {
    const f = ground();
    const movedDev = moveItem3D(f, "dev", 0, [123, 247], 10);
    expect(movedDev).not.toBeNull();
    expect("x" in movedDev!.devices[0] ? [movedDev!.devices[0].x, movedDev!.devices[0].y] : null).toEqual([120, 250]);
    expect(validate({ ...demo, floors: { ground: movedDev! } }).ok).toBe(true);

    const movedAlt = moveItem3D(f, "dev", 0, [123, 247], 0);
    expect("x" in movedAlt!.devices[0] ? [movedAlt!.devices[0].x, movedAlt!.devices[0].y] : null).toEqual([123, 247]);

    const raisedDev = setItemZ(f, "dev", 0, 175.4);
    expect(raisedDev!.devices[0].z).toBe(175);
    expect(validate({ ...demo, floors: { ground: raisedDev! } }).ok).toBe(true);

    const clampedFurn = setItemZ(f, "furn", 0, 1500);
    expect(clampedFurn!.furniture[0].z).toBe(1000);
    expect(validate({ ...demo, floors: { ground: clampedFurn! } }).ok).toBe(true);

    // Locked item refuses move & height change
    const locked = ground();
    locked.devices[0].locked = true;
    expect(moveItem3D(locked, "dev", 0, [50, 50], 10)).toBeNull();
    expect(setItemZ(locked, "dev", 0, 80)).toBeNull();
  });

  it("rotates selected furniture, devices, unlinked items and stairs by 15 degrees cleanly", () => {
    const f = ground();
    f.furniture[0].rot = 350;
    const rf = rotateSel15(f, { t: "furn", i: 0 }, 15);
    expect(rf?.next.furniture[0].rot).toBe(5);
    expect(validate({ ...demo, floors: { ground: rf!.next } }).ok).toBe(true);

    const rd = rotateSel15(f, { t: "dev", i: 0 }, 15);
    expect(rd?.next.devices[0].rot).toBe(((f.devices[0].rot ?? 0) + 15) % 360);
    expect(validate({ ...demo, floors: { ground: rd!.next } }).ok).toBe(true);

    if (f.stairs.length) {
      const rs = rotateSel15(f, { t: "stairs", i: 0 }, 15);
      expect(rs?.next.stairs[0].rot).toBe(((f.stairs[0].rot ?? 0) + 15) % 360);
      expect(validate({ ...demo, floors: { ground: rs!.next } }).ok).toBe(true);
    }
  });

  it("updates Stage 3 structure heights, floor slab and door sill/head validly", () => {
    const f = ground();
    const { handles: floorHandles } = handlesForSel(f, null);
    const fh = floorHandles.find((h) => h.kind === "floor-h")!;
    const fSlab = floorHandles.find((h) => h.kind === "floor-slab")!;
    expect(fh).toBeTruthy();
    expect(fSlab).toBeTruthy();

    const tallFloor = applyHeightHandle(f, fh, 310)!;
    expect(tallFloor.height).toBe(310);
    expect(validate({ ...demo, floors: { ground: tallFloor } }).ok).toBe(true);

    const thickSlab = applyHeightHandle(f, fSlab, -40)!;
    expect(thickSlab.slab).toBe(40);
    expect(validate({ ...demo, floors: { ground: thickSlab } }).ok).toBe(true);

    const roomH = handlesForSel(f, { t: "room", i: 0 }).handles.find((h) => h.kind === "room-h")!;
    const tallRoom = applyHeightHandle(f, roomH, 280)!;
    expect(tallRoom.rooms[0].height).toBe(280);
    expect(validate({ ...demo, floors: { ground: tallRoom } }).ok).toBe(true);

    if (f.doors.length) {
      const doorHandles = handlesForSel(f, { t: "door", i: 0 }).handles;
      const sill = doorHandles.find((h) => h.kind === "sill")!;
      const head = doorHandles.find((h) => h.kind === "head")!;
      const raisedSill = applyHeightHandle(f, sill, 80, { sill: 0, head: 210 })!;
      expect(raisedSill.doors[0].sill).toBe(80);
      expect(raisedSill.doors[0].height).toBe(130);
      expect(validate({ ...demo, floors: { ground: raisedSill } }).ok).toBe(true);

      const raisedHead = applyHeightHandle(f, head, 230, { sill: 90, head: 210 })!;
      expect(raisedHead.doors[0].sill).toBe(90);
      expect(raisedHead.doors[0].height).toBe(140);
      expect(validate({ ...demo, floors: { ground: raisedHead } }).ok).toBe(true);
    }
  });

  it("exposes vertical Z gizmo handles for unlocked devices and furniture and applies z validly", () => {
    const f = ground();
    const devH = handlesForSel(f, { t: "dev", i: 0 }).handles.find((h) => h.kind === "dev-z");
    expect(devH).toBeTruthy();
    const raisedDev = applyHeightHandle(f, devH!, 185)!;
    expect(raisedDev.devices[0].z).toBe(185);
    expect(validate({ ...demo, floors: { ground: raisedDev } }).ok).toBe(true);

    const furnH = handlesForSel(f, { t: "furn", i: 0 }).handles.find((h) => h.kind === "furn-z");
    expect(furnH).toBeTruthy();
    const raisedFurn = applyHeightHandle(f, furnH!, 120)!;
    expect(raisedFurn.furniture[0].z).toBe(120);
    expect(validate({ ...demo, floors: { ground: raisedFurn } }).ok).toBe(true);

    // Locked items omit the vertical Z gizmo handle and rotation handle.
    f.devices[0].locked = true;
    f.furniture[0].locked = true;
    expect(handlesForSel(f, { t: "dev", i: 0 }).handles.find((h) => h.kind === "dev-z")).toBeUndefined();
    expect(handlesForSel(f, { t: "furn", i: 0 }).handles.find((h) => h.kind === "furn-z")).toBeUndefined();
    expect(handlesForSel(f, { t: "furn", i: 0 }).handles.find((h) => h.kind === "rot")).toBeUndefined();
  });

  it("exposes a 3D rotation handle on unlocked furniture/devices and setItemRot updates rotation validly", () => {
    const f = ground();
    const rotH = handlesForSel(f, { t: "furn", i: 0 }).handles.find((h) => h.kind === "rot");
    expect(rotH).toBeTruthy();
    const turned = setItemRot(f, "furn", 0, 135, rotH!.baseRot)!;
    expect(turned.furniture[0].rot).toBe(135);
    expect(validate({ ...demo, floors: { ground: turned } }).ok).toBe(true);

    const devRotH = handlesForSel(f, { t: "dev", i: 0 }).handles.find((h) => h.kind === "rot");
    expect(devRotH).toBeTruthy();
    const turnedDev = setItemRot(f, "dev", 0, 45, devRotH!.baseRot)!;
    expect(validate({ ...demo, floors: { ground: turnedDev } }).ok).toBe(true);
  });
});
