import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { CatalogEntry, DeviceType, Layout } from "../../src/core/schema";
import { validate } from "../../src/core";
import { EditorState } from "../../src/editor/state";

/**
 * S10.2: attaching a placed sensor to a door, heater, ac or unlinked item pulls its device icon off the plan
 * (design interview, 2026-09-27; behaviour list in the task brief). Detaching only ever removes the attachment —
 * the catalog entry stays, so the entity shows in Add again, but no icon reappears (Diego's decision, see
 * docs/DECISIONS.md). These tests exercise `EditorState.attachEntity`, the seam every in-scope field routes through.
 */

const fresh = () => structuredClone(demo) as unknown as Layout;

/** Adds an ac device (S10.2 has no ac fixture in the demo) and an unlinked item, so `aclink` and `uuattach` have
 *  a target to attach to, same as every other in-scope field already does via the demo's doors and heater-living. */
function base(): Layout {
  const l = fresh();
  const g = l.floors.ground;
  g.devices.push({ id: "ac-test", type: "ac", entity: "climate.demo_test_ac", x: 900, y: 700 });
  g.unlinked.push({ id: "unl-test", type: "other", name: "Test appliance", x: 920, y: 720, rot: 0, scale: 1 });
  return l;
}

/** One in-scope attach field: a fresh catalog entry + device of the right type, an `attach`/`read` pair that route
 *  through `EditorState.attachEntity` exactly as `panels.ts` does, and where to look afterwards. */
interface FieldCase {
  name: string;
  entity: string;
  catalogType: DeviceType;
  keepDeviceId?: string;
  attach: (st: EditorState, entity: string) => { changed: boolean; pulled: boolean };
  read: (l: Layout) => string[] | undefined;
}

const FIELDS: FieldCase[] = [
  {
    name: "door contact sensors (dsens)", entity: "binary_sensor.test_dsens", catalogType: "contact",
    attach: (st, e) => st.attachEntity(e, (f) => { f.doors[2].sensors = [...(f.doors[2].sensors ?? []), e]; }),
    read: (l) => l.floors.ground.doors[2].sensors,
  },
  {
    name: "door vibration sensors (dvibr)", entity: "binary_sensor.test_dvibr", catalogType: "vibration",
    attach: (st, e) => st.attachEntity(e, (f) => { f.doors[2].vibration = [...(f.doors[2].vibration ?? []), e]; }),
    read: (l) => l.floors.ground.doors[2].vibration,
  },
  {
    name: "door smart locks (dlocks)", entity: "lock.test_dlocks", catalogType: "lock",
    attach: (st, e) => st.attachEntity(e, (f) => { f.doors[2].locks = [...(f.doors[2].locks ?? []), e]; }),
    read: (l) => l.floors.ground.doors[2].locks,
  },
  {
    name: "heater TRVs (htrv)", entity: "climate.test_htrv", catalogType: "climate", keepDeviceId: "heater-living",
    attach: (st, e) => st.attachEntity(e, (f) => {
      const d = f.devices.find((x) => x.id === "heater-living")!;
      d.trvs = [...(d.trvs ?? []), e];
    }, "heater-living"),
    read: (l) => (l.floors.ground.devices.find((d) => d.id === "heater-living") as { trvs?: string[] }).trvs,
  },
  {
    name: "heater temperature sensors (hsens)", entity: "sensor.test_hsens", catalogType: "temp", keepDeviceId: "heater-living",
    attach: (st, e) => st.attachEntity(e, (f) => {
      const d = f.devices.find((x) => x.id === "heater-living")!;
      d.tempSensors = [...(d.tempSensors ?? []), e];
    }, "heater-living"),
    read: (l) => (l.floors.ground.devices.find((d) => d.id === "heater-living") as { tempSensors?: string[] }).tempSensors,
  },
  {
    name: "ac linked entities (aclink)", entity: "climate.test_aclink", catalogType: "climate", keepDeviceId: "ac-test",
    attach: (st, e) => st.attachEntity(e, (f) => {
      const d = f.devices.find((x) => x.id === "ac-test")!;
      d.linked = [...(d.linked ?? []), e];
    }, "ac-test"),
    read: (l) => (l.floors.ground.devices.find((d) => d.id === "ac-test") as { linked?: string[] }).linked,
  },
  {
    name: "unlinked attached entities (uuattach)", entity: "sensor.test_uuattach", catalogType: "other",
    attach: (st, e) => st.attachEntity(e, (f) => {
      const u = f.unlinked.find((x) => x.id === "unl-test")!;
      u.attached = [...(u.attached ?? []), e];
    }),
    read: (l) => l.floors.ground.unlinked.find((u) => u.id === "unl-test")?.attached,
  },
];

describe("S10.2: EditorState.attachEntity pulls a placed icon off the plan", () => {
  for (const field of FIELDS) {
    describe(field.name, () => {
      it("pulls the icon on every floor in one undo step, and undo restores both", () => {
        const l = base();
        const catalogEntry: CatalogEntry = { id: `cat-${field.entity}`, floor: "ground", room: "", type: field.catalogType, name: "Test sensor", entity: field.entity };
        l.catalog.push(catalogEntry);
        // Placed twice — once on ground, once on "first" — so a single-floor bug (fixing only the current floor)
        // would leave one icon behind and fail the count below (finding 4: asymmetric values, not one happy path).
        l.floors.ground.devices.push({ id: "dev-ground", type: field.catalogType, entity: field.entity, x: 10, y: 10 });
        l.floors.first.devices.push({ id: "dev-first", type: field.catalogType, entity: field.entity, x: 10, y: 10 });
        const st = new EditorState(l);
        const beforeGround = st.layout.floors.ground.devices.length;
        const beforeFirst = st.layout.floors.first.devices.length;

        const r = field.attach(st, field.entity);
        expect(r).toEqual({ changed: true, pulled: true });
        expect(field.read(st.layout)).toContain(field.entity);
        expect(st.layout.floors.ground.devices.some((d) => d.id === "dev-ground")).toBe(false);
        expect(st.layout.floors.first.devices.some((d) => d.id === "dev-first")).toBe(false);
        expect(st.layout.floors.ground.devices).toHaveLength(beforeGround - 1);
        expect(st.layout.floors.first.devices).toHaveLength(beforeFirst - 1);
        // the catalog entry is untouched: the entity still shows in Add
        expect(st.layout.catalog.some((c) => c.entity === field.entity)).toBe(true);
        expect(st.canUndo).toBe(true);

        expect(st.undo()).toBe(true);
        expect(field.read(st.layout)).toBeUndefined();
        expect(st.layout.floors.ground.devices.some((d) => d.id === "dev-ground")).toBe(true);
        expect(st.layout.floors.first.devices.some((d) => d.id === "dev-first")).toBe(true);
        expect(st.canUndo).toBe(false); // exactly one step

        expect(st.redo()).toBe(true);
        expect(field.read(st.layout)).toContain(field.entity);
        expect(st.layout.floors.ground.devices.some((d) => d.id === "dev-ground")).toBe(false);
        expect(st.layout.floors.first.devices.some((d) => d.id === "dev-first")).toBe(false);
      });

      it("attaching an entity that is not placed anywhere removes no icon, one undo step", () => {
        const l = base();
        l.catalog.push({ id: `cat-${field.entity}`, floor: "ground", room: "", type: field.catalogType, name: "Test sensor", entity: field.entity });
        const st = new EditorState(l);
        const groundBefore = st.layout.floors.ground.devices.length;
        const firstBefore = st.layout.floors.first.devices.length;

        const r = field.attach(st, field.entity);
        expect(r).toEqual({ changed: true, pulled: false });
        expect(field.read(st.layout)).toContain(field.entity);
        expect(st.layout.floors.ground.devices).toHaveLength(groundBefore);
        expect(st.layout.floors.first.devices).toHaveLength(firstBefore);
        expect(st.canUndo).toBe(true);
      });

      it("the device the entity is being attached to never pulls its own icon (keepDeviceId)", () => {
        if (!field.keepDeviceId) return; // door fields have no device icon of their own to guard
        const l = base();
        l.catalog.push({ id: `cat-${field.entity}`, floor: "ground", room: "", type: field.catalogType, name: "Test sensor", entity: field.entity });
        const st = new EditorState(l);
        const own = st.layout.floors.ground.devices.find((d) => d.id === field.keepDeviceId)!;
        // A defensive check: even if the attached entity coincided with the device's own entity (never offered by
        // `deviceAttachChoices` in practice, but `attachEntity` must not rely on that alone), its icon survives.
        const savedEntity = own.entity;
        own.entity = field.entity;
        const r = field.attach(st, field.entity);
        expect(r.changed).toBe(true);
        expect(st.layout.floors.ground.devices.some((d) => d.id === field.keepDeviceId)).toBe(true);
        own.entity = savedEntity; // not asserted further; just proving the guard, not the attach's own semantics here
      });

      it("keeps the layout valid after attaching, and after detaching again", () => {
        const l = base();
        l.catalog.push({ id: `cat-${field.entity}`, floor: "ground", room: "", type: field.catalogType, name: "Test sensor", entity: field.entity });
        l.floors.ground.devices.push({ id: "dev-ground", type: field.catalogType, entity: field.entity, x: 10, y: 10 });
        const st = new EditorState(l);
        field.attach(st, field.entity);
        expect(validate(st.layout).ok).toBe(true);
        // detach: clear the list back to empty, same as the panel's Remove button (a plain edit, no attachEntity)
        st.edit((f) => {
          for (const d of f.doors) { delete d.sensors; delete d.vibration; delete d.locks; }
          for (const d of f.devices) { delete d.trvs; delete d.tempSensors; delete d.linked; }
          for (const u of f.unlinked) delete u.attached;
        });
        expect(validate(st.layout).ok).toBe(true);
        expect(st.layout.catalog.some((c) => c.entity === field.entity)).toBe(true); // still in Add
      });
    });
  }

  it("attaching '' does nothing and records no undo step", () => {
    const st = new EditorState(base());
    const r = st.attachEntity("", (f) => { f.doors[2].sensors = ["x"]; });
    expect(r).toEqual({ changed: false, pulled: false });
    expect(st.canUndo).toBe(false);
  });

  it("keeps the door selected by index across the pull, since doors and devices are separate arrays", () => {
    const l = base();
    l.catalog.push({ id: "cat-sel", floor: "ground", room: "", type: "contact", name: "Test sensor", entity: "binary_sensor.test_sel" });
    l.floors.ground.devices.unshift({ id: "dev-sel", type: "contact", entity: "binary_sensor.test_sel", x: 10, y: 10 }); // shifts every device index by one
    const st = new EditorState(l);
    st.sel = { t: "door", i: 2 };
    const r = st.attachEntity("binary_sensor.test_sel", (f) => { f.doors[2].sensors = ["binary_sensor.test_sel"]; });
    expect(r).toEqual({ changed: true, pulled: true });
    expect(st.sel).toEqual({ t: "door", i: 2 }); // untouched: a door selection does not live in the devices array
  });

  it("keeps a selected device's identity across the pull when its index shifts", () => {
    const l = base();
    l.catalog.push({ id: "cat-shift", floor: "ground", room: "", type: "contact", name: "Test sensor", entity: "binary_sensor.test_shift" });
    // placed before heater-living, so removing it shifts every later device's index down by one
    l.floors.ground.devices.unshift({ id: "dev-shift", type: "contact", entity: "binary_sensor.test_shift", x: 10, y: 10 });
    const st = new EditorState(l);
    const heaterIndex = st.layout.floors.ground.devices.findIndex((d) => d.id === "heater-living");
    st.sel = { t: "dev", i: heaterIndex };
    const r = st.attachEntity("binary_sensor.test_shift", (f) => {
      const d = f.devices.find((x) => x.id === "heater-living")!;
      d.tempSensors = [...(d.tempSensors ?? []), "binary_sensor.test_shift"];
    });
    expect(r).toEqual({ changed: true, pulled: true });
    const newHeaterIndex = st.layout.floors.ground.devices.findIndex((d) => d.id === "heater-living");
    expect(st.sel).toEqual({ t: "dev", i: newHeaterIndex });
    expect(newHeaterIndex).toBe(heaterIndex - 1); // proves the index really shifted, and the fix followed it
  });
});
