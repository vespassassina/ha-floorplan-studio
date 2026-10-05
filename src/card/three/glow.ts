// The lamp's light on the walls of its own room (S13): beside the floor pool of fx.ts, the same lamps (the pool's budget, `MAX_POOLS`),
// one additive mesh per lamp. Each wall face that looks into the lamp's room and lies within reach gets a patch of vertices carrying the
// light at that point (light.ts `glowGrid`); a face of another room, the outside of an outer wall, a face turned away: none. The patch is
// clipped to the height the wall is drawn at, so a lowered wall has only its low part. Nothing is imported from core (see palette.ts).
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Scene } from "three";
import { facing, glowGrid, GLOW_REACH, MAX_POOLS, type Poly, type Rgb } from "./light";

/** cm off the face: clear of it for the depth buffer at the distances a house is seen from, as the pool is off the floor. */
const GLOW_LIFT = 0.8;
/** How much brighter than the floor pool's own strength a wall's patch is added: the walls are darker than the floor and stand at an angle to the sun. */
const GLOW_GAIN = 0.8;

type Pt = readonly [number, number];
/** One face of a wall solid as drawn: an edge of its ring, which way the ring is wound (`outwardSign`), and the z range it is drawn over. */
export interface GlowSide { a: Pt; b: Pt; s: 1 | -1; z0: number; z1: number }
export interface GlowSpec { at: Pt; lampZ: number; base: Poly; rgb: Rgb; level: number; room: number; boost: number }

export function createGlow(scene: Scene) {
  let muted = false;
  const slots = Array.from({ length: MAX_POOLS }, () => {
    const mat = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide });
    const mesh = new Mesh(new BufferGeometry(), mat);
    mesh.visible = false;
    mesh.frustumCulled = false; // the geometry is replaced; a stale bounding sphere would cull a patch that is on screen
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, mat, key: "", room: -1, faces: [] as { a: Pt; b: Pt; z0: number; z1: number }[] };
  });
  return {
    /** Puts the lamps in the slots (the same order as the pools); the slots left over are hidden. A slot is rebuilt only when its lamp or the drawn walls (`version`) changed. */
    set(specs: readonly GlowSpec[], sides: readonly GlowSide[], version: number) {
      slots.forEach((slot, i) => {
        const p = specs[i];
        if (!p) { slot.mesh.visible = false; slot.key = ""; slot.room = -1; slot.faces = []; return; }
        const key = JSON.stringify([p.at, p.lampZ, p.room, p.rgb, p.level, p.boost, p.base, version]);
        slot.room = p.room;
        if (key === slot.key) { slot.mesh.visible = slot.faces.length > 0 && !muted; return; }
        slot.key = key;
        const strength = 0.5 * Math.max(0, Math.min(1, p.level)) * p.boost * GLOW_GAIN, pos: number[] = [], col: number[] = [], index: number[] = [];
        slot.faces = [];
        for (const f of sides) {
          const n = facing(f.a as never, f.b as never, f.s, p.base, p.at as never);
          const g = n && glowGrid(f.a as never, f.b as never, n, f.z0, f.z1, p.at as never, p.lampZ, GLOW_REACH, GLOW_LIFT);
          if (!g) continue;
          const base = pos.length / 3;
          pos.push(...g.pos);
          for (const k of g.k) col.push(p.rgb[0] * strength * k, p.rgb[1] * strength * k, p.rgb[2] * strength * k);
          for (const j of g.index) index.push(base + j);
          slot.faces.push({ a: f.a, b: f.b, z0: f.z0, z1: f.z1 });
        }
        slot.mesh.geometry.dispose();
        const geo = new BufferGeometry();
        geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
        geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
        geo.setIndex(index);
        slot.mesh.geometry = geo;
        slot.mesh.visible = slot.faces.length > 0 && !muted;
      });
    },
    /** For the tests: hides the patches so a test can tell them from the pool light that also reaches the walls. */
    mute(on: boolean) { muted = on; for (const s of slots) s.mesh.visible = s.faces.length > 0 && !on; },
    /** For the tests: which room each slot lights and the faces it covers. */
    info: () => slots.map((s) => ({ room: s.room, visible: s.mesh.visible, faces: s.faces })),
    dispose() { for (const s of slots) { scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mat.dispose(); } },
  };
}
