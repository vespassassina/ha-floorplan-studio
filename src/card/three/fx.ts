// The two light effects the live state draws on a floor (S12.5): the pool of a lit lamp and the motion edge of a room.
// Both are flat meshes just above the room's floor, owned here so view3d.ts keeps the scene and the pointer. Frame of the
// inputs: the plan's, cm; the meshes are in three.js' (x, up, planY). Nothing is imported from core (see palette.ts).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, type Scene } from "three";
import { inPoly, MAX_POOLS, type Poly, type Rgb } from "./light";
import { insetBand } from "./ring";

/** cm. How far a lamp's pool reaches over a floor that has room for it; a wall cuts it short. */
export const POOL_REACH = 220;
const RAYS = 28, RINGS = 5, CLIP_STEPS = 7;
/** cm above the floor's top: clear of it for the depth buffer at any distance a house is seen from, below a skirting. */
const POOL_LIFT = 0.6, RING_LIFT = 1;
/** cm. The motion edge: a band this far in from the room's outline (past the wall), this wide. */
export const EDGE_FROM = 12, EDGE_TO = 22;

export interface PoolSpec { at: readonly [number, number]; z: number; base: Poly; rgb: Rgb; level: number; room: number; boost: number }

/** `MAX_POOLS` flat discs of light, made once and moved: a lamp that turns on or off changes numbers, never the scene's children. */
export function createPools(scene: Scene) {
  const n = 1 + RAYS * RINGS, index: number[] = [];
  for (let r = 0; r < RAYS; r++) {
    const a = 1 + r, b = 1 + ((r + 1) % RAYS);
    index.push(0, a, b);
    for (let k = 1; k < RINGS; k++) { const a0 = 1 + k * RAYS - RAYS + r, a1 = a0 + RAYS, b0 = 1 + k * RAYS - RAYS + ((r + 1) % RAYS), b1 = b0 + RAYS; index.push(a0, a1, b1, a0, b1, b0); }
  }
  const slots = Array.from({ length: MAX_POOLS }, () => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setIndex(index);
    const mat = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide });
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false; // the vertices move; a stale bounding sphere would cull a pool that is on screen
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, geo, mat, key: "", room: -1, colour: "#000000", strength: 0 };
  });
  return {
    /** Puts the lamps in the slots, nearest first; the slots left over are hidden. Only a slot whose lamp changed is touched. */
    set(specs: readonly PoolSpec[]) {
      slots.forEach((s, i) => {
        const p = specs[i];
        if (!p) { s.mesh.visible = false; s.key = ""; s.room = -1; return; }
        const key = JSON.stringify([p.at, p.z, p.room, p.rgb, p.level, p.boost, p.base]);
        s.mesh.visible = true;
        s.room = p.room;
        if (key === s.key) return;
        s.key = key;
        const pos = s.geo.getAttribute("position") as BufferAttribute, col = s.geo.getAttribute("color") as BufferAttribute;
        const strength = 0.5 * Math.max(0, Math.min(1, p.level)) * p.boost, y = p.z + POOL_LIFT;
        pos.setXYZ(0, p.at[0], y, p.at[1]);
        col.setXYZ(0, p.rgb[0] * strength, p.rgb[1] * strength, p.rgb[2] * strength);
        for (let r = 0; r < RAYS; r++) {
          const ang = (r / RAYS) * Math.PI * 2, dx = Math.cos(ang), dy = Math.sin(ang);
          // The wall stops the light: the ray is shortened until its end lies in the room (exact for a room the lamp sees whole).
          let t = 1;
          if (!inPoly(p.base, p.at[0] + dx * POOL_REACH, p.at[1] + dy * POOL_REACH)) {
            let lo = 0, hi = 1;
            for (let c = 0; c < CLIP_STEPS; c++) { const m = (lo + hi) / 2; if (inPoly(p.base, p.at[0] + dx * POOL_REACH * m, p.at[1] + dy * POOL_REACH * m)) lo = m; else hi = m; }
            t = lo;
          }
          for (let k = 1; k <= RINGS; k++) {
            const f = k / RINGS, len = POOL_REACH * t * f, v = 1 + (k - 1) * RAYS + r, fall = (1 - f) * (1 - f) * strength;
            pos.setXYZ(v, p.at[0] + dx * len, y, p.at[1] + dy * len);
            col.setXYZ(v, p.rgb[0] * fall, p.rgb[1] * fall, p.rgb[2] * fall);
          }
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        s.colour = `#${new Color(p.rgb[0], p.rgb[1], p.rgb[2]).getHexString()}`;
        s.strength = strength;
      });
    },
    info: () => slots.map((s) => ({ room: s.room, visible: s.mesh.visible, colour: s.colour, opacity: s.strength })),
    visible: () => slots.filter((s) => s.mesh.visible).length,
    dispose() { for (const s of slots) { scene.remove(s.mesh); s.geo.dispose(); s.mat.dispose(); } },
  };
}

/** One band per room along the inside of its outline, made the first time the room needs it and kept until the floor changes. */
export function createRings(scene: Scene) {
  const rings = new Map<number, { mesh: Mesh; mat: MeshBasicMaterial; base: Poly; z: number; colour: string }>();
  return {
    /** Shows the room's edge in `colour` at `opacity` (0..1), or hides it (`null`). A room whose band cannot be made shows nothing. */
    set(room: number, base: Poly, z: number, to: { colour: Color; opacity: number } | null) {
      let r = rings.get(room);
      if (!r) {
        if (!to) return;
        const flat = insetBand(base as number[][], EDGE_FROM, EDGE_TO), pos = new Float32Array((flat.length / 2) * 3);
        for (let i = 0; i < flat.length / 2; i++) { pos[i * 3] = flat[i * 2]; pos[i * 3 + 1] = z + RING_LIFT; pos[i * 3 + 2] = flat[i * 2 + 1]; }
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(pos, 3));
        const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
        const mesh = new Mesh(geo, mat);
        mesh.renderOrder = 3;
        mesh.visible = false;
        scene.add(mesh);
        rings.set(room, (r = { mesh, mat, base, z, colour: "#000000" }));
      }
      r.mesh.visible = !!to && r.mesh.geometry.getAttribute("position").count > 0;
      if (!to) return;
      r.mat.color.copy(to.colour);
      r.mat.opacity = Math.max(0, Math.min(1, to.opacity));
      r.colour = `#${to.colour.getHexString()}`;
    },
    info: (rooms: readonly number[]) => rooms.map((room) => { const r = rings.get(room); return { room, visible: !!r?.mesh.visible, opacity: r?.mesh.visible ? r.mat.opacity : 0, colour: r?.colour ?? "#000000" }; }),
    dispose() { for (const r of rings.values()) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mat.dispose(); } rings.clear(); },
  };
}
