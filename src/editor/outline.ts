import { html, nothing, type TemplateResult } from "lit";
import { placeableDevicesInArea } from "../core/ha";
import { layoutEntries, normalize, type SearchEntry } from "../core/search";
import type { HaData, Layout, StateOverlay } from "../core";

/**
 * S24.5 (U9, U20): the Studio's Outline, the left column's first tab. floors › rooms › devices, each floor and room with
 * its device count; a device that stands in no room goes under "No room", last on its floor. The last node, "Unplaced
 * from HA", holds what Place would offer (`placeableDevicesInArea`), grouped by area. Built from the same entries as the
 * search (`layoutEntries`), so the tree and the search box always agree on names, rooms and indices.
 * The model and the keys are pure; the editor keeps which branches are open and which row is active.
 */
export interface OutlineNode {
  /** Unique in the tree: "f:<floor>", "r:<floor>:<room>", "n:<floor>", "d:<floor>:<entry id>", "u", "a:<area>", "e:<entity>". */
  id: string;
  kind: "floor" | "room" | "noroom" | "device" | "unplaced" | "area" | "entity";
  label: string;
  /** Devices under a floor or room, entities under Unplaced or an area. */
  count?: number;
  /** A light's relay, shown after an arrow: "Floor lamp → Relay 3". */
  via?: string;
  /** Where a pick goes: a floor, room or device of the layout. */
  entry?: SearchEntry;
  /** An unplaced HA entity: a pick opens Add > Device with it. */
  entity?: string;
  children?: OutlineNode[];
}

/** A device or piece's row id. Floor-scoped: a piece's id is unique on its floor only, and a device may share its id
 *  with a piece on another floor (validate allows both), so the bare id could name two rows. */
export const deviceNodeId = (e: SearchEntry): string => `d:${e.floor ?? ""}:${e.id}`;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const text = (x: unknown): string => (typeof x === "string" ? x : "");

/** The light's relay by the name a person knows it by: a plan device for it, then HA's name, then the entity id. */
function relayName(entity: string, entries: readonly SearchEntry[], state: StateOverlay | undefined, ha: HaData | undefined): string {
  const onPlan = entries.find((e) => e.kind === "device" && e.entity === entity);
  if (onPlan) return onPlan.name;
  const friendly = state?.[entity]?.attributes?.friendly_name;
  if (typeof friendly === "string" && friendly) return friendly;
  const he = Array.isArray(ha?.entities) ? ha.entities.find((e) => e?.id === entity) : undefined;
  return text(he?.name) || entity;
}

/** The whole tree. `entries` may be passed when the caller already has them (the search box uses the same list). */
export function buildOutline(layout: Layout, state: StateOverlay | undefined, ha: HaData | undefined, entries: readonly SearchEntry[] = layoutEntries(layout, state)): OutlineNode[] {
  const floors: OutlineNode[] = [];
  const rooms = new Map<string, OutlineNode>(), loose = new Map<string, OutlineNode>();
  const floorOf = new Map<string, OutlineNode>();
  for (const e of entries) {
    const fk = e.floor ?? "";
    if (e.kind === "floor") {
      const n: OutlineNode = { id: `f:${fk}`, kind: "floor", label: e.name, count: 0, entry: e, children: [] };
      floors.push(n); floorOf.set(fk, n);
    } else if (e.kind === "room") {
      const n: OutlineNode = { id: `r:${fk}:${e.room}`, kind: "room", label: e.name, count: 0, entry: e, children: [] };
      rooms.set(`${fk}:${e.room}`, n);
      floorOf.get(fk)?.children!.push(n);
    } else if (e.kind === "device") {
      const fl = floorOf.get(fk);
      if (!fl) continue;
      let home = e.room !== undefined ? rooms.get(`${fk}:${e.room}`) : undefined;
      if (!home) {
        home = loose.get(fk);
        if (!home) { home = { id: `n:${fk}`, kind: "noroom", label: "No room", count: 0, children: [] }; loose.set(fk, home); }
      }
      const d = !e.piece && e.device !== undefined ? (layout.floors[fk]?.devices?.[e.device] as unknown) : undefined;
      const bound = isObj(d) && d.type === "light" ? text(d.bound) : "";
      home.children!.push({ id: deviceNodeId(e), kind: "device", label: e.name, entry: e, ...(bound ? { via: relayName(bound, entries, state, ha) } : {}) });
      home.count!++;
      fl.count!++;
    }
  }
  for (const [fk, n] of loose) floorOf.get(fk)?.children!.push(n); // after the rooms: "No room" is last on its floor
  if (ha && Array.isArray(ha.areas) && isObj(layout) && isObj(layout.floors) && Array.isArray(layout.catalog)) {
    const seen = new Set<string>(), areas: OutlineNode[] = [];
    for (const a of ha.areas) {
      if (!isObj(a) || typeof a.id !== "string" || !a.id || seen.has(a.id)) continue;
      seen.add(a.id);
      const ents = placeableDevicesInArea(layout, ha, a.id);
      if (ents.length) areas.push({ id: `a:${a.id}`, kind: "area", label: text(a.name) || a.id, count: ents.length, children: ents.map((x) => ({ id: `e:${x.id}`, kind: "entity" as const, label: text(x.name) || x.id, entity: x.id })) });
    }
    const total = areas.reduce((s, a) => s + a.count!, 0);
    if (total) floors.push({ id: "u", kind: "unplaced", label: "Unplaced from HA", count: total, children: areas });
  }
  return floors;
}

const hay = (n: OutlineNode) => normalize(`${n.label} ${n.entity ?? n.entry?.entity ?? ""}`);

/** The tree narrowed to `query` (every word, in a name or an entity id): a matching node keeps all it holds, any other
 *  keeps only its matching descendants. `open` is every branch kept for a descendant, to be shown open. */
export function filterOutline(nodes: OutlineNode[], query: string): { nodes: OutlineNode[]; open: Set<string> } {
  const q = normalize(query), open = new Set<string>();
  if (!q) return { nodes, open };
  const words = q.split(" ");
  const walk = (list: OutlineNode[]): OutlineNode[] => {
    const out: OutlineNode[] = [];
    for (const n of list) {
      const h = hay(n);
      if (words.every((w) => h.includes(w))) { out.push(n); continue; }
      const kids = n.children ? walk(n.children) : [];
      if (kids.length) { out.push({ ...n, children: kids }); open.add(n.id); }
    }
    return out;
  };
  return { nodes: walk(nodes), open };
}

export interface OutlineRow { node: OutlineNode; level: number; parent: string | null; pos: number; size: number }

/** The rows on show: a branch's children only when it is open, so 437 devices cost nothing while their rooms are shut. */
export function visibleRows(nodes: OutlineNode[], open: ReadonlySet<string>): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (list: OutlineNode[], level: number, parent: string | null) => list.forEach((node, i) => {
    rows.push({ node, level, parent, pos: i + 1, size: list.length });
    if (node.children && open.has(node.id)) walk(node.children, level + 1, node.id);
  });
  walk(nodes, 1, null);
  return rows;
}

/** What a key does on the tree (WAI-ARIA tree pattern), or null when the key is not the tree's. `active` is the row to
 *  focus; `open` or `close` a branch to toggle; `go` to act on the active row. */
export function outlineKey(rows: OutlineRow[], active: string | null, key: string): { active: string; open?: string; close?: string; go?: true } | null {
  if (!rows.length) return null;
  const i = rows.findIndex((r) => r.node.id === active);
  // The active row went away (a filter, a branch shut above it): any key of the tree lands on the first row first.
  if (i < 0) return ["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft", "Enter", " "].includes(key) ? { active: rows[0].node.id } : null;
  const r = rows[i], id = r.node.id, branch = !!r.node.children?.length;
  const isOpen = i + 1 < rows.length && rows[i + 1].parent === id;
  switch (key) {
    case "ArrowDown": return { active: rows[Math.min(rows.length - 1, i + 1)].node.id };
    case "ArrowUp": return { active: rows[Math.max(0, i - 1)].node.id };
    case "Home": return { active: rows[0].node.id };
    case "End": return { active: rows[rows.length - 1].node.id };
    case "ArrowRight": return !branch ? { active: id } : isOpen ? { active: rows[i + 1].node.id } : { active: id, open: id };
    case "ArrowLeft": return branch && isOpen ? { active: id, close: id } : { active: r.parent ?? id };
    case "Enter": case " ": return { active: id, go: true };
    default: return null;
  }
}

/** What the tree element needs from the editor. */
export interface OutlineCtx {
  rows: OutlineRow[];
  open: ReadonlySet<string>;
  active: string | null;
  /** The row of what is selected on the plan, marked `aria-selected`. */
  selected: string | null;
  query: string;
  onQuery: (q: string) => void;
  onKey: (ev: KeyboardEvent) => void;
  onRow: (row: OutlineRow) => void;
  /** S26.21: a right-click on a row, at the pointer. */
  onCtx: (row: OutlineRow, ev: MouseEvent) => void;
  onToggle: (id: string) => void;
}

/** The filter field and the tree. Rows are flat, with `aria-level`, `aria-setsize` and `aria-posinset`; one row is in the
 *  tab order (roving tabindex), the rest are reached with the arrows. */
export function outlineView(c: OutlineCtx): TemplateResult {
  const active = c.rows.some((r) => r.node.id === c.active) ? c.active : c.rows[0]?.node.id ?? null;
  return html`
    <input id="outlineFilter" type="search" autocomplete="off" aria-label="Filter outline" placeholder="Filter outline…" .value=${c.query} @input=${(e: Event) => c.onQuery((e.target as HTMLInputElement).value)}>
    <div class="tree" id="outlineTree" role="tree" aria-label="Outline" @keydown=${c.onKey}>
      ${c.rows.length ? c.rows.map((r) => {
        const n = r.node, branch = !!n.children?.length;
        return html`<div role="treeitem" class="ti k-${n.kind}" id=${`ot-${n.id}`} data-node=${n.id}
          aria-level=${r.level} aria-setsize=${r.size} aria-posinset=${r.pos}
          aria-expanded=${branch ? (c.open.has(n.id) ? "true" : "false") : nothing}
          aria-selected=${n.id === c.selected ? "true" : "false"}
          tabindex=${n.id === active ? "0" : "-1"}
          style=${`--lvl:${r.level - 1}`}
          @click=${() => c.onRow(r)}
          @contextmenu=${(e: MouseEvent) => c.onCtx(r, e)}
        ><span class="tw" aria-hidden="true" @click=${(e: Event) => { if (branch) { e.stopPropagation(); c.onToggle(n.id); } }}>${branch ? (c.open.has(n.id) ? "▾" : "▸") : ""}</span><span class="tl">${n.label}${n.via ? html`<span class="via"> → ${n.via}</span>` : nothing}</span>${n.count !== undefined ? html`<span class="tc">${n.count}</span>` : nothing}</div>`;
      }) : html`<p class="hint">${c.query.trim() ? "Nothing matches" : "Nothing on the plan yet"}</p>`}
    </div>`;
}
