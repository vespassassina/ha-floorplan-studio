// S28.1: the one shape of a tree, for every view. A trunk under a crown: 2D draws the crown as a lobed outline, 2.5D lifts it
// on a trunk, 3D puts an icosahedron there. The numbers are decided here so the three cannot drift. Pure, never throws.
import { furnitureHeight } from "./heights";
import { num } from "./fmt";
import type { Furniture, Pt } from "./schema";

/** The trunk's square side, cm. */
export const TRUNK_SIDE = 12;

/** Where a tree's parts stand. Heights are cm above the tree's own foot; radii are cm in plan. */
export interface TreeShape {
  /** The whole tree: `furnitureHeight`, 400 cm unless the layout says. */
  height: number;
  /** The trunk ends here, 60 % of the height. */
  trunkTop: number;
  /** The crown starts here, 50 % of the height. */
  crownBottom: number;
  /** The crown ends here, the full height. */
  crownTop: number;
  /** Half way up the crown: where the crown's centre is lifted to. */
  crownMiddle: number;
  /** Crown radius along the tree's width. */
  rx: number;
  /** Crown radius along the tree's depth. */
  ry: number;
  trunk: number;
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** A tree's parts from its `w`, `h` and height; null for anything that is not a drawable tree. */
export function treeShape(m: Furniture): TreeShape | null {
  if (typeof m !== "object" || m === null) return null;
  const { w, h } = m as unknown as Record<string, unknown>;
  if (!pos(w) || !pos(h)) return null;
  const height = furnitureHeight(m);
  if (!pos(height)) return null;
  return { height, trunkTop: height * 0.6, crownBottom: height * 0.5, crownTop: height, crownMiddle: height * 0.75, rx: w / 2, ry: h / 2, trunk: TRUNK_SIDE };
}

/** The shade patch is offset this far from the foot in plan cm, whatever the tree's size and turn. */
export const TREE_SHADE: Pt = [4, 6];

/** The shade patch under a tree, drawn at its foot, the same in 2D and 2.5D. "" for anything that is not a drawable tree. */
export function treeShadeSvg(m: Furniture): string {
  if (m.symbol !== "tree" || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return "";
  const tree = treeShape(m);
  if (!tree) return "";
  const cx = num(m.x + TREE_SHADE[0]), cy = num(m.y + TREE_SHADE[1]);
  return `<ellipse class="tree-shade" cx="${cx}" cy="${cy}" rx="${num(tree.rx)}" ry="${num(tree.ry)}" transform="rotate(${num(Number.isFinite(m.rot) ? m.rot : 0)} ${cx} ${cy})"/>`;
}
