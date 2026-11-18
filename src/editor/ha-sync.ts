import { areaMove, inside, type Device, type Floor, type HaData, type Layout, type Pt } from "../core";

type HaEntityRow = HaData["entities"][number];

/** An entity reference in the layout that is missing from Home Assistant. */
export interface HaOrphan {
  floorKey: string;
  floorTitle: string;
  kind: "device" | "room" | "furniture" | "unlinked";
  index: number;
  field:
    | "entity" | "bound" | "motion" | "power" | "trvs" | "tempSensors" | "linked"
    | "temps" | "humidity" | "water" | "haScenes" | "attached";
  entityId: string;
  label: string;
  domain: string;
  suggested?: string;
}

/** A room lacking an HA area or a device whose HA area disagrees with its plan room. */
export interface HaAreaIssue {
  kind: "room-no-area" | "device-area-diff";
  floorKey: string;
  floorTitle: string;
  roomIndex: number;
  roomName: string;
  deviceIndex?: number;
  deviceName?: string;
  entityId?: string;
  matchArea?: { id: string; name: string };
  targetArea?: { id: string; name: string };
  move?: NonNullable<ReturnType<typeof areaMove>>;
}

/** A plan floor missing in HA, unlinked from a matching HA floor, or with an area assigned to another floor. */
export interface HaFloorIssue {
  kind: "create-floor" | "link-floor" | "assign-area-floor";
  floorKey: string;
  floorTitle: string;
  floorOrder: number;
  haFloor?: { id: string; name: string };
  area?: { id: string; name: string };
}

export interface HaSyncReport {
  orphans: HaOrphan[];
  areas: HaAreaIssue[];
  floors: HaFloorIssue[];
  total: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const devicePos = (d: Device): Pt => ("a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y]);

function suggestReplacement(entityId: string, label: string, roomArea: string | undefined, entities: HaEntityRow[]): string | undefined {
  const domain = entityId.split(".")[0] ?? "";
  const slug = entityId.includes(".") ? entityId.slice(entityId.indexOf(".") + 1) : entityId;
  const wantSlug = norm(slug), wantLabel = norm(label);
  const pool = entities.filter((e) => e.domain === domain);
  const byName = pool.filter((e) => {
    const eSlug = e.id.includes(".") ? e.id.slice(e.id.indexOf(".") + 1) : e.id;
    return norm(eSlug) === wantSlug || (wantLabel && norm(e.name) === wantLabel);
  });
  if (byName.length === 1) return byName[0].id;
  if (roomArea) {
    const inArea = byName.filter((e) => e.area === roomArea);
    if (inArea.length === 1) return inArea[0].id;
  }
  return undefined;
}

function collectFloorOrphans(
  floorKey: string,
  f: Floor,
  ha: HaData,
  known: Set<string>,
  out: HaOrphan[],
) {
  const title = f.title || floorKey;
  const push = (
    kind: HaOrphan["kind"],
    index: number,
    field: HaOrphan["field"],
    entityId: unknown,
    label: string,
    roomArea?: string,
    hintName = label,
  ) => {
    if (typeof entityId !== "string" || !entityId || known.has(entityId)) return;
    const domain = entityId.split(".")[0] ?? "";
    const suggested = suggestReplacement(entityId, hintName, roomArea, ha.entities);
    out.push({ floorKey, floorTitle: title, kind, index, field, entityId, label, domain, ...(suggested ? { suggested } : {}) });
  };

  for (let i = 0; i < f.devices.length; i++) {
    const d = f.devices[i];
    const at = devicePos(d);
    const room = f.rooms.find((r) => (r.kind === "room" || r.kind === "structure") && inside(at, r.pts));
    const dName = d.name ?? d.entity;
    const prefix = room ? `${room.name} · ${dName}` : dName;
    push("device", i, "entity", d.entity, prefix, room?.area, dName);
    push("device", i, "bound", d.bound, `${prefix} (switch)`, room?.area);
    push("device", i, "motion", d.motion, `${prefix} (motion)`, room?.area);
    push("device", i, "power", d.power, `${prefix} (power)`, room?.area);
    for (const s of d.trvs ?? []) push("device", i, "trvs", s, `${prefix} (TRV)`, room?.area);
    for (const s of d.tempSensors ?? []) push("device", i, "tempSensors", s, `${prefix} (temp)`, room?.area);
    for (const s of d.linked ?? []) push("device", i, "linked", s, `${prefix} (linked)`, room?.area);
  }
  for (let i = 0; i < f.rooms.length; i++) {
    const r = f.rooms[i];
    push("room", i, "entity", r.entity, r.name, r.area);
    for (const s of r.temps ?? []) push("room", i, "temps", s, `${r.name} · temperature`, r.area);
    for (const s of r.humidity ?? []) push("room", i, "humidity", s, `${r.name} · humidity`, r.area);
    for (const s of r.motion ?? []) push("room", i, "motion", s, `${r.name} · motion`, r.area);
    for (const s of r.power ?? []) push("room", i, "power", s, `${r.name} · power`, r.area);
    for (const s of r.water ?? []) push("room", i, "water", s, `${r.name} · water`, r.area);
    for (const s of r.haScenes ?? []) push("room", i, "haScenes", s, `${r.name} · scene`, r.area);
  }
  for (let i = 0; i < f.furniture.length; i++) {
    const m = f.furniture[i];
    const label = m.name || m.symbol;
    push("furniture", i, "entity", m.entity, label);
    for (const att of m.attached ?? []) push("furniture", i, "attached", att, `${label} (attached)`);
  }
  for (let i = 0; i < (f.unlinked ?? []).length; i++) {
    const u = f.unlinked[i];
    const label = u.name || u.type;
    for (const att of u.attached ?? []) push("unlinked", i, "attached", att, `${label} (attached)`);
  }
}

/** Finds all entity orphans, room/device area mismatches, and plan-vs-HA floor mismatches. */
export function haSyncReport(layout: Layout, ha: HaData | undefined): HaSyncReport {
  if (!ha) return { orphans: [], areas: [], floors: [], total: 0 };
  const orphans: HaOrphan[] = [];
  const areas: HaAreaIssue[] = [];
  const floors: HaFloorIssue[] = [];
  const known = new Set(ha.entities.map((e) => e.id));
  const haAreasByName = new Map(ha.areas.map((a) => [a.name.trim().toLowerCase(), a]));
  const haAreasById = new Map(ha.areas.map((a) => [a.id, a]));
  const haFloorsById = new Map(ha.floors.map((fl) => [fl.id, fl]));
  const haFloorsByName = new Map(ha.floors.map((fl) => [fl.name.trim().toLowerCase(), fl]));

  const entries = Object.entries(layout.floors);
  for (let order = 0; order < entries.length; order++) {
    const [floorKey, f] = entries[order];
    const floorTitle = f.title || floorKey;

    if (known.size > 0) collectFloorOrphans(floorKey, f, ha, known, orphans);

    for (let ri = 0; ri < f.rooms.length; ri++) {
      const r = f.rooms[ri];
      if (r.kind !== "room" && r.kind !== "structure") continue;
      if (!r.area) {
        const match = haAreasByName.get(r.name.trim().toLowerCase());
        areas.push({
          kind: "room-no-area",
          floorKey,
          floorTitle,
          roomIndex: ri,
          roomName: r.name,
          ...(match ? { matchArea: { id: match.id, name: match.name } } : {}),
        });
      }
    }

    for (let di = 0; di < f.devices.length; di++) {
      const d = f.devices[di];
      const at = devicePos(d);
      const ri = f.rooms.findIndex((r) => r.area && (r.kind === "room" || r.kind === "structure") && inside(at, r.pts));
      if (ri < 0) continue;
      const r = f.rooms[ri];
      const move = areaMove(ha, d.entity, r.area);
      if (!move) continue;
      const areaObj = haAreasById.get(r.area);
      areas.push({
        kind: "device-area-diff",
        floorKey,
        floorTitle,
        roomIndex: ri,
        roomName: r.name,
        deviceIndex: di,
        deviceName: d.name,
        entityId: d.entity,
        targetArea: { id: r.area, name: areaObj?.name ?? r.area },
        move,
      });
    }

    const linkedFloor = f.ha ? haFloorsById.get(f.ha) : undefined;
    const namedFloor = haFloorsByName.get(floorTitle.trim().toLowerCase());
    if (linkedFloor) {
      for (const r of f.rooms) {
        if (!r.area) continue;
        const a = haAreasById.get(r.area);
        if (a && a.floor_id !== linkedFloor.id) {
          floors.push({
            kind: "assign-area-floor",
            floorKey,
            floorTitle,
            floorOrder: order,
            haFloor: linkedFloor,
            area: { id: a.id, name: a.name },
          });
        }
      }
    } else if (namedFloor) {
      floors.push({ kind: "link-floor", floorKey, floorTitle, floorOrder: order, haFloor: namedFloor });
      for (const r of f.rooms) {
        if (!r.area) continue;
        const a = haAreasById.get(r.area);
        if (a && a.floor_id !== namedFloor.id) {
          floors.push({
            kind: "assign-area-floor",
            floorKey,
            floorTitle,
            floorOrder: order,
            haFloor: namedFloor,
            area: { id: a.id, name: a.name },
          });
        }
      }
    } else {
      floors.push({ kind: "create-floor", floorKey, floorTitle, floorOrder: order });
    }
  }

  return { orphans, areas, floors, total: orphans.length + areas.length + floors.length };
}

/** Replaces every occurrence of `fromId` with `toId` across all floors and catalog entries. */
export function replaceEntityInLayout(layout: Layout, fromId: string, toId: string): void {
  const swap = (arr: string[] | undefined) => {
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) if (arr[i] === fromId) arr[i] = toId;
  };
  for (const f of Object.values(layout.floors)) {
    for (const d of f.devices) {
      if (d.entity === fromId) d.entity = toId;
      if (d.bound === fromId) d.bound = toId;
      if (d.motion === fromId) d.motion = toId;
      if (d.power === fromId) d.power = toId;
      swap(d.trvs);
      swap(d.tempSensors);
      swap(d.linked);
    }
    for (const r of f.rooms) {
      if (r.entity === fromId) r.entity = toId;
      swap(r.temps);
      swap(r.humidity);
      swap(r.motion);
      swap(r.power);
      swap(r.water);
      swap(r.haScenes);
    }
    for (const m of f.furniture) {
      if (m.entity === fromId) m.entity = toId;
      swap(m.attached);
    }
    for (const u of f.unlinked ?? []) swap(u.attached);
  }
  for (const c of layout.catalog ?? []) if (c.entity === fromId) c.entity = toId;
}

/** Removes or unlinks a single orphaned entity reference from `layout`. */
export function removeOrphanFromLayout(
  layout: Layout,
  o: Pick<HaOrphan, "floorKey" | "kind" | "index" | "field" | "entityId">,
): void {
  const f = layout.floors[o.floorKey];
  if (!f) return;
  const drop = (arr: string[] | undefined) => arr?.filter((id) => id !== o.entityId);
  const trimArr = <T extends object, K extends keyof T>(obj: T, key: K, arr: string[] | undefined) => {
    const next = drop(arr);
    if (next?.length) (obj as Record<string, unknown>)[key as string] = next;
    else delete (obj as Record<string, unknown>)[key as string];
  };
  if (o.kind === "device") {
    const d = f.devices[o.index];
    if (!d) return;
    if (o.field === "entity") {
      f.devices.splice(o.index, 1);
      if (layout.catalog) layout.catalog = layout.catalog.filter((c) => !(c.floor === o.floorKey && c.entity === o.entityId));
    } else if (o.field === "bound" || o.field === "motion" || o.field === "power") {
      delete d[o.field];
    } else if (o.field === "trvs" || o.field === "tempSensors" || o.field === "linked") {
      trimArr(d, o.field, d[o.field]);
    }
  } else if (o.kind === "room") {
    const r = f.rooms[o.index];
    if (!r) return;
    if (o.field === "entity") delete r.entity;
    else if (o.field === "temps" || o.field === "humidity" || o.field === "motion" || o.field === "power" || o.field === "water" || o.field === "haScenes") {
      trimArr(r, o.field, r[o.field]);
    }
  } else if (o.kind === "furniture") {
    const m = f.furniture[o.index];
    if (!m) return;
    if (o.field === "entity") delete m.entity;
    else if (o.field === "attached") trimArr(m, "attached", m.attached);
  } else if (o.kind === "unlinked") {
    const u = (f.unlinked ?? [])[o.index];
    if (!u) return;
    if (o.field === "attached") trimArr(u, "attached", u.attached);
  }
}

/** Links `roomIndex` on `floorKey` to `areaId`. */
export function setRoomAreaInLayout(layout: Layout, floorKey: string, roomIndex: number, areaId: string): void {
  const r = layout.floors[floorKey]?.rooms[roomIndex];
  if (r) r.area = areaId;
}

/** Links `floorKey` to an HA floor id `haFloorId`. */
export function setFloorHaInLayout(layout: Layout, floorKey: string, haFloorId: string): void {
  const f = layout.floors[floorKey];
  if (f) f.ha = haFloorId;
}
