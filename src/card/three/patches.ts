// The sun's patches on the floor (S38.4): one soft-edged sheet (additive; on a light theme a mix toward a tint) per window the sun shines through, lying on the room's
// floor top as a lamp's pool does (fx.ts). The geometry is sunpatch.ts; this makes the meshes and keeps them. Slots are made the
// first time a sun needs them, so a house with no sun has not one more child in its scene. Frame: the plan's, cm; the meshes are
// three's (x, up, planY). Nothing is imported from core at run time (see palette.ts).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, NormalBlending, type Scene } from "three";
import type { Rgb } from "./light";
import { MAX_SUN_PATCHES, type SunPatch } from "./sunpatch";

/** cm above the floor's top: the pool's lift, clear of it for the depth buffer, under a skirting. */
const LIFT = 0.6;
/** What a full patch (sun overhead square on to the wall) adds to the floor's colour; the pool's own peak is 0.65 by day. Vertex colours are linear, so 0.2 reads as mid grey on a dark floor. */
const GAIN = 0.45;
/** Light theme: the warm tint the floor is mixed toward (linear; reads about 245/240/228 on screen, under white), the alpha per unit of strength, and its cap. */
const LIGHT_TINT = [0.92, 0.88, 0.78], LIGHT_ALPHA = 1.4, LIGHT_ALPHA_CAP = 0.8;
/** Stations from the near edge to the far edge of a column, as fractions. Close together at both ends: that is where the feather is. */
const ROWS = [0, 0.12, 0.3, 0.7, 0.88, 1];
/** How much of the light is left at the far edge: it thins with distance, so the patch is a light and not a flat quad. */
const THIN = 0.4;
/** Feather: the weight climbs from 0 at the edge to 1 this fraction in, smoothly. */
const FEATHER_ACROSS = 0.25, FEATHER_ALONG = 0.2;

const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export interface PatchSpec { patch: SunPatch; z: number; rgb: Rgb; /** The theme is a light one (`--fp-glow-blend` is multiply): the patch mixes the floor toward a tint, never adding past white. */ light: boolean }

export function createSunPatches(scene: Scene) {
  const slots: { mesh: Mesh; geo: BufferGeometry; mat: MeshBasicMaterial; room: number; ring: [number, number][]; colour: string; k: number }[] = [];
  const make = () => {
    const geo = new BufferGeometry(), mat = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide });
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false; // the vertices are replaced; a stale bounding sphere would cull a patch that is on screen
    mesh.renderOrder = 2;
    scene.add(mesh);
    slots.push({ mesh, geo, mat, room: -1, ring: [], colour: "#000000", k: 0 });
  };
  return {
    /** Puts the patches in the slots, in the order given; the slots left over are hidden. */
    set(specs: readonly PatchSpec[]) {
      while (slots.length < Math.min(specs.length, MAX_SUN_PATCHES)) make();
      slots.forEach((s, i) => {
        const p = specs[i];
        if (!p) { s.mesh.visible = false; s.room = -1; s.ring = []; return; }
        const cols = p.patch.cols, nc = cols.length, nr = ROWS.length, size = p.light ? 4 : 3, pos = new Float32Array(nc * nr * 3), col = new Float32Array(nc * nr * size), index: number[] = [];
        // The light's strength: sin(elevation) x cos(angle) (`strength`), warm when low (the rgb). Dark: it adds to the floor. Light: the floor
        // is already pale and the sun lifts it further, so an add passes white; it mixes the floor toward a warm tint below white instead,
        // by an alpha capped at LIGHT_ALPHA_CAP, and the floor under it can never end brighter than the tint.
        const k = p.light ? Math.min(LIGHT_ALPHA * p.patch.strength, LIGHT_ALPHA_CAP) : GAIN * p.patch.strength;
        s.mat.blending = p.light ? NormalBlending : AdditiveBlending;
        s.mat.needsUpdate = true; // the colour attribute changes width with the theme, and so does the shader
        cols.forEach((c, i2) => {
          const across = ease(Math.min(i2, nc - 1 - i2) / (nc - 1) / FEATHER_ACROSS);
          ROWS.forEach((f, j) => {
            const n = i2 * nr + j, v = n * 3, w = across * ease(Math.min(f, 1 - f) / FEATHER_ALONG) * (1 - THIN * f);
            pos[v] = c.near[0] + (c.far[0] - c.near[0]) * f; pos[v + 1] = p.z + LIFT; pos[v + 2] = c.near[1] + (c.far[1] - c.near[1]) * f;
            if (p.light) { for (let q = 0; q < 3; q++) col[n * 4 + q] = LIGHT_TINT[q] * p.rgb[q]; col[n * 4 + 3] = w * k; }
            else { col[v] = p.rgb[0] * w * k; col[v + 1] = p.rgb[1] * w * k; col[v + 2] = p.rgb[2] * w * k; }
          });
        });
        for (let i2 = 0; i2 < nc - 1; i2++) for (let j = 0; j < nr - 1; j++) { const a = i2 * nr + j, b = a + nr, c2 = b + 1, d = a + 1; index.push(a, b, c2, a, c2, d); }
        s.geo.dispose(); // the renderer lets go of the buffers the old attributes held
        s.geo.setAttribute("position", new BufferAttribute(pos, 3));
        s.geo.setAttribute("color", new BufferAttribute(col, size));
        s.geo.setIndex(index);
        s.mesh.visible = true;
        s.room = p.patch.room;
        s.ring = p.patch.ring.map((q) => [q[0], q[1]]);
        s.colour = `#${new Color(p.rgb[0], p.rgb[1], p.rgb[2]).getHexString()}`;
        s.k = k;
      });
    },
    visible: () => slots.filter((s) => s.mesh.visible).length,
    /** For the tests: per shown patch, its room, outline (plan), colour and peak strength. */
    info: () => slots.filter((s) => s.mesh.visible).map((s) => ({ room: s.room, ring: s.ring, colour: s.colour, strength: s.k })),
    dispose() { for (const s of slots) { scene.remove(s.mesh); s.geo.dispose(); s.mat.dispose(); } slots.length = 0; },
  };
}
