// S25.6: incremental render. `renderFloor` stays the only draw path: it still returns the whole plan as markup. This file
// decides which nodes of the live <svg> have to change to become that markup, and touches only those. A state update for
// one lamp then rewrites the lamp's group (and its aura, its room's glow, a badge: whatever the markup says changed) and
// nothing else. The result is the fresh render byte for byte, because every node that is kept is equal to the new one,
// and every node that is not is the new one (or an element whose attribute names, order and values and children now match it).
import { Directive, PartType, directive, type ElementPart, type PartInfo } from "lit/directive.js";
import { noChange } from "lit";

const SVG_NS = "http://www.w3.org/2000/svg";

/** A node's identity for diffing: its serialisation. Equal keys mean equal subtrees. */
const keyOf = (n: Node): string => (n.nodeType === 1 ? (n as Element).outerHTML : `${n.nodeType}\u0000${n.nodeValue ?? ""}`);

type Op = { del: number } | { ins: number } | { keep: number; to: number };

/** Edit script between two key lists: common head and tail first, then Myers on what is left. Past `MAX_D` edits it gives up
 *  and says "replace the middle", which is still correct, only less sparing. */
const MAX_D = 600;
function script(a: string[], b: string[]): Op[] {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length, eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const ops: Op[] = [];
  for (let i = 0; i < lo; i++) ops.push({ keep: i, to: i });
  const n = ea - lo, m = eb - lo, max = n + m;
  const tail = () => { for (let k = 0; ea + k < a.length; k++) ops.push({ keep: ea + k, to: eb + k }); return ops; };
  if (n === 0 || m === 0) {
    for (let i = lo; i < ea; i++) ops.push({ del: i });
    for (let j = lo; j < eb; j++) ops.push({ ins: j });
    return tail();
  }
  const off = Math.min(max, MAX_D) + 1, v = new Int32Array(2 * off + 2), trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, MAX_D) && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[lo + x] === b[lo + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) {
    for (let i = lo; i < ea; i++) ops.push({ del: i });
    for (let j = lo; j < eb; j++) ops.push({ ins: j });
    return tail();
  }
  // Walk back from (n, m) to (0, 0), then reverse.
  const back: Op[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const vv = trace[d]!, k = x - y;
    const down = k === -d || (k !== d && vv[off + k - 1]! < vv[off + k + 1]!);
    const pk = down ? k + 1 : k - 1, px = vv[off + pk]!, py = px - pk;
    while (x > px && y > py && x > (down ? px : px + 1)) { x--; y--; back.push({ keep: lo + x, to: lo + y }); }
    if (down) { y--; back.push({ ins: lo + y }); } else { x--; back.push({ del: lo + x }); }
  }
  while (x > 0 && y > 0) { x--; y--; back.push({ keep: lo + x, to: lo + y }); }
  ops.push(...back.reverse());
  return tail();
}

/** Make `o` equal to `n` in place when both are elements of one tag with the same attribute names in the same order; false otherwise. */
function morph(o: Node, n: Node): boolean {
  if (o.nodeType === 3 && n.nodeType === 3) { if ((o as Text).data !== (n as Text).data) (o as Text).data = (n as Text).data; return true; }
  if (o.nodeType !== 1 || n.nodeType !== 1) return false;
  const oe = o as Element, ne = n as Element;
  if (oe.localName !== ne.localName || oe.namespaceURI !== ne.namespaceURI || oe.attributes.length !== ne.attributes.length) return false;
  for (let i = 0; i < oe.attributes.length; i++) if (oe.attributes[i]!.name !== ne.attributes[i]!.name) return false;
  for (let i = 0; i < ne.attributes.length; i++) { const a = ne.attributes[i]!; if (oe.getAttribute(a.name) !== a.value) oe.setAttribute(a.name, a.value); }
  patchChildren(oe, ne);
  return true;
}

function patchChildren(oldParent: Element, newParent: Element): void {
  const oc = Array.from(oldParent.childNodes), nc = Array.from(newParent.childNodes);
  const ops = script(oc.map(keyOf), nc.map(keyOf));
  const want: Node[] = [], gone: Node[] = [];
  let dels: number[] = [], inss: number[] = [];
  const flush = () => {
    // A run of removals next to a run of insertions: pair them in order, and rewrite the old node in place when it can be.
    const pairs = Math.min(dels.length, inss.length);
    for (let p = 0; p < pairs; p++) { const o = oc[dels[p]!]!, n = nc[inss[p]!]!; if (morph(o, n)) want.push(o); else { gone.push(o); want.push(n); } }
    for (let p = pairs; p < dels.length; p++) gone.push(oc[dels[p]!]!);
    for (let p = pairs; p < inss.length; p++) want.push(nc[inss[p]!]!);
    dels = []; inss = [];
  };
  for (const op of ops) {
    if ("keep" in op) { flush(); want.push(oc[op.keep]!); } else if ("del" in op) dels.push(op.del); else inss.push(op.ins);
  }
  flush();
  for (const g of gone) oldParent.removeChild(g);
  let ref: Node | null = oldParent.firstChild;
  for (const w of want) { if (w === ref) ref = ref.nextSibling; else oldParent.insertBefore(w, ref); }
}

/** Make the children of `svg` the nodes `markup` describes, touching as few as it can. The first call, or markup that is the same
 *  as last time, costs one parse or nothing. Untrusted markup cannot throw here: the parser never does. */
export function patchPlan(svg: Element, markup: string): void {
  const doc = svg.ownerDocument;
  const fresh = doc.createElementNS(SVG_NS, "svg");
  fresh.innerHTML = markup;
  if (!svg.firstChild) { while (fresh.firstChild) svg.appendChild(fresh.firstChild); return; }
  patchChildren(svg, fresh);
}

class PlanPatch extends Directive {
  private last: string | null = null;
  constructor(info: PartInfo) {
    super(info);
    if (info.type !== PartType.ELEMENT) throw new Error("planPatch goes on an element: <svg ${planPatch(markup)}>");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(_markup: string) { return noChange; }
  override update(part: ElementPart, [markup]: [string]) {
    if (markup !== this.last) { patchPlan(part.element, markup); this.last = markup; }
    return noChange;
  }
}
/** `<svg ${planPatch(markup)}>`: the plan inside is patched, not replaced, when the markup changes. */
export const planPatch = directive(PlanPatch);
