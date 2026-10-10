// S28.7: the crown of a tree in 3D. The scene builder cuts the trunk at treeShape's trunk top and puts the crown's z range
// and the tree's turn in the solid (`ref.crown`); this file turns those solids into the matrices of ONE InstancedMesh of
// unit icosahedra, so 5000 trees are one draw call. Plain maths here, no core import (the chunk shares no code with the card).
// A layout is untrusted input: a solid that cannot give a crown is skipped, and nothing throws.
import { BufferAttribute, IcosahedronGeometry, InstancedMesh, Matrix4, type BufferGeometry, type Material } from "three";
import type { Solid } from "../../core/scene";

/** Icosahedron detail 2: 180 flat faces, a rounded blob that reads as foliage and costs little (one mesh for every tree). */
export const CROWN_SEGMENTS = 2;
/** The share of its radius a vertex may move in or out: a slight irregularity, the same for every crown. */
const LUMP = 0.07;
/** cm. Past this a size is not a tree; it also keeps every matrix finite in float32. */
const LIMIT = 1e6;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** One column-major 4x4 per crown, in three's frame (plan x stays x, plan z is y, plan y is z). */
export function crownMatrices(solids: readonly Solid[]): { count: number; matrices: Float32Array } {
  const out: number[] = [];
  for (const s of Array.isArray(solids) ? solids : []) {
    if (typeof s !== "object" || s === null || s.kind !== "furniture" || s.shape?.type !== "prism" || !Array.isArray(s.shape.base) || s.shape.base.length < 3) continue;
    const size = s.ref?.size, crown = s.ref?.crown;
    if (!Array.isArray(size) || !num(size[0]) || !num(size[1]) || !(size[0] > 0) || !(size[1] > 0) || size[0] > LIMIT || size[1] > LIMIT) continue;
    if (typeof crown !== "object" || crown === null || !num(crown.z0) || !num(crown.z1) || !num(crown.rot) || !(crown.z1 > crown.z0) || Math.abs(crown.z0) > LIMIT || Math.abs(crown.z1) > LIMIT) continue;
    let cx = 0, cy = 0, ok = true;
    for (const p of s.shape.base) { if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) { ok = false; break; } cx += p[0]; cy += p[1]; }
    if (!ok) continue;
    cx /= s.shape.base.length; cy /= s.shape.base.length;
    // A round crown (S28 final): never taller than it is wide. It stands on crown.z0, where the trunk enters it; a wide tree keeps its whole range.
    const sx = size[0] / 2, sz = size[1] / 2, sy = Math.min((crown.z1 - crown.z0) / 2, Math.max(sx, sz)), mid = crown.z0 + sy, th = (crown.rot * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    // T * rotY(-th) * S. Plan turns clockwise on the page by `rot`; in three's frame that is a turn about y by -th.
    out.push(c * sx, 0, sn * sx, 0, 0, sy, 0, 0, -sn * sz, 0, c * sz, 0, cx, mid, cy, 1);
  }
  return { count: out.length / 16, matrices: Float32Array.from(out) };
}

/** The unit crown, scaled so its box is exactly [-1, 1] on every axis: a matrix then puts the box where the tree's numbers say. */
function crownGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(1, CROWN_SEGMENTS).toNonIndexed(), pos = g.getAttribute("position") as BufferAttribute;
  // A slight lump: each vertex moves along its radius by a fixed pseudo-random amount from its own direction, so a shared corner moves once.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453, k = 1 + LUMP * (2 * (h - Math.floor(h)) - 1);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeBoundingBox();
  const b = g.boundingBox!;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, (2 * pos.getX(i) - b.max.x - b.min.x) / (b.max.x - b.min.x), (2 * pos.getY(i) - b.max.y - b.min.y) / (b.max.y - b.min.y), (2 * pos.getZ(i) - b.max.z - b.min.z) / (b.max.z - b.min.z));
  g.computeVertexNormals(); // flat: each face is its own three vertices
  g.computeBoundingBox(); // the box of the fitted shape: exactly [-1, 1]
  g.computeBoundingSphere();
  return g;
}

/** One InstancedMesh of every crown in `solids`, or null if there is none. The caller owns the mesh and its material. */
export function crownMesh(solids: readonly Solid[], material: Material): InstancedMesh | null {
  const { count, matrices } = crownMatrices(solids);
  if (!count) return null;
  const mesh = new InstancedMesh(crownGeometry(), material, count), at = new Matrix4();
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, at.fromArray(matrices, i * 16));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "crowns";
  mesh.raycast = () => undefined; // never picked: a tap on a crown picks what is under it
  mesh.frustumCulled = false; // the bounding sphere of an instanced mesh follows its instances since r15x; off is safe for one mesh
  return mesh;
}
