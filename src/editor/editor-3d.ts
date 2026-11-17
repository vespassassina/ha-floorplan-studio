import {
  doorCeiling,
  doorSpan,
  floorsAroundKey,
  floorsBelow,
  floorElevation,
  floorPlace,
  openingSpan,
  plugThreshold,
  snapPoint,
  stitch,
  validate,
  worktopIndex,
  type Floor,
  type Pt,
  dist,
} from "../core";
import { liveDeps, sceneDeps, textureDeps } from "../core/three-deps";
import type { Hit3D, View3D } from "../card/three/host";
import { pivotOnArc, gridRound, movePointAll } from "./ops";
import {
  applyHeightHandle,
  handlesForSel,
  itemAnchor3D,
  moveItem3D,
  rayOnZ,
  rayZAt,
  selFromHit,
  setItemZ,
  type HandleSpec,
  type V3,
} from "./ops3d";
import { offerAreaMove } from "./editor-ha";
import { num } from "./editor-kit";
import { polyPts, type PtRef } from "./state";
import type { FloorplanStudioEditor } from "./editor-app";

type Lib3d = typeof import("../card/three/host");

declare const __FP3D_PANEL_FILE__: string | undefined;
declare const __FP3D_DEV_MOD__: string | undefined;

const THREE_FILE: string = typeof __FP3D_PANEL_FILE__ === "string" ? __FP3D_PANEL_FILE__ : "";
const DEV_MOD: string = typeof __FP3D_DEV_MOD__ === "string" ? __FP3D_DEV_MOD__ : "";

const REBUILD_MS = 80;
const DRAG_SLOP_PX = 4;

const isZoneRef = (f: Floor, ref: PtRef) =>
  "poly" in ref && (worktopIndex(ref.poly) !== null || (ref.poly[0] === "r" && (f.rooms[+ref.poly.slice(1)]?.kind === "zone" || f.rooms[+ref.poly.slice(1)]?.free === true)));

let cachedLib: Lib3d | null = null;
let loadingLib: Promise<Lib3d> | null = null;

function load3d(): Promise<Lib3d> {
  if (cachedLib) return Promise.resolve(cachedLib);
  if (!loadingLib) {
    let p: Promise<Lib3d>;
    if (DEV_MOD) {
      p = import(/* @vite-ignore */ DEV_MOD) as Promise<Lib3d>;
    } else if (!THREE_FILE || globalThis.location?.protocol === "file:") {
      p = Promise.reject(new Error("3D preview requires HTTP or Home Assistant"));
    } else {
      const base = import.meta.url.split(/[?#]/)[0].replace(/[^/]*$/, "");
      p = import(/* @vite-ignore */ `${base}${THREE_FILE}`) as Promise<Lib3d>;
    }
    loadingLib = p.then(
      (m) => ((cachedLib = m), m),
      (err) => {
        loadingLib = null;
        throw err;
      },
    );
  }
  return loadingLib;
}

type Drag3D =
  | {
      mode: "item";
      base: Floor;
      kind: "dev" | "furn" | "unl";
      i: number;
      startPx: Pt;
      anchor: V3;
      off: Pt;
      zStartRay: number | null;
      shiftZ: boolean;
      moved: boolean;
      locked: boolean;
    }
  | {
      mode: "handle";
      handle: HandleSpec;
      base: Floor;
      startPx: Pt;
      from: Pt;
      to: Pt;
      zStartRay: number | null;
      span?: { sill: number; head: number };
      moved: boolean;
    };

/** Owns the split-pane 3D preview and direct 3D manipulation in the Studio. */
export class Studio3D {
  view: View3D | null = null;
  walls: "cut" | "full" | "low" = "cut";
  loading = false;
  error = "";
  pendingBuilds = 0;

  private hostEl: HTMLElement | null = null;
  private ovEl: SVGSVGElement | null = null;
  private lastFloorKey = "";
  private lastSig = "";
  private lastBelowSig = "";
  private lastOvHtml = "";
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private drag: Drag3D | null = null;
  private pendingClick: { id: number; x: number; y: number; hit: Hit3D | null } | null = null;
  private drawnHandles: HandleSpec[] = [];

  constructor(private ed: FloorplanStudioEditor) {}

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Resets the 3D camera to frame the current floor. */
  resetCamera(): void {
    this.view?.reset();
    this.ed.requestUpdate();
  }

  /** Cycles the 3D wall cutaway mode between cut, low and full. */
  cycleWalls(): void {
    this.walls = this.walls === "cut" ? "low" : this.walls === "low" ? "full" : "cut";
    this.view?.setWalls(this.walls);
    this.ed.requestUpdate();
  }

  /** Cancels any active 3D drag, restoring the floor before it and dropping any undo snapshot. */
  cancelDrag(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    this.ed.st.replaceFloor(d.base);
    if (d.moved) this.ed.st.dropSnapshot();
    this.sync(true);
    this.ed.requestUpdate();
    return true;
  }

  /** Flushes any debounced 3D rebuild right away. */
  flush(): void {
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
      this.sync(true);
    }
  }

  /** Disposes the WebGL context and clears timers; safe to call multiple times. */
  dispose(): void {
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.unbindHost();
    this.drag = null;
    this.pendingClick = null;
    this.view?.dispose();
    this.view = null;
    this.lastFloorKey = "";
    this.lastSig = "";
    this.lastBelowSig = "";
    this.lastOvHtml = "";
    this.drawnHandles = [];
  }

  private wire(el: EventTarget, map: readonly (readonly [string, EventListener, boolean])[], add: boolean): void {
    for (const [ev, fn, cap] of map) {
      if (add) el.addEventListener(ev, fn, cap);
      else el.removeEventListener(ev, fn, cap);
    }
  }

  private hostEvents = () =>
    [
      ["pointerdown", this.onHostDown as EventListener, true],
      ["pointermove", this.onHostMove as EventListener, true],
      ["pointerup", this.onHostUp as EventListener, true],
      ["pointercancel", this.onHostUp as EventListener, true],
    ] as const;

  private ovEvents = () =>
    [
      ["pointerdown", this.onHandleDown as EventListener, false],
      ["pointermove", this.onHandleMove as EventListener, false],
      ["pointerup", this.onHandleUp as EventListener, false],
      ["pointercancel", this.onHandleUp as EventListener, false],
    ] as const;

  private unbindHost(): void {
    if (this.hostEl) { this.wire(this.hostEl, this.hostEvents(), false); this.hostEl = null; }
    if (this.ovEl) { this.wire(this.ovEl, this.ovEvents(), false); this.ovEl = null; }
  }

  private bindHost(host: HTMLElement, ov: SVGSVGElement | null): void {
    if (this.hostEl !== host) {
      if (this.hostEl) this.wire(this.hostEl, this.hostEvents(), false);
      this.hostEl = host;
      this.wire(host, this.hostEvents(), true);
    }
    if (ov && this.ovEl !== ov) {
      if (this.ovEl) this.wire(this.ovEl, this.ovEvents(), false);
      this.ovEl = ov;
      this.wire(ov, this.ovEvents(), true);
    }
  }

  /** Keeps the 3D view and overlay synchronized with the editor's floor, theme, selection and live state. */
  sync(immediate = false): void {
    if (!this.ed.open3d) {
      if (this.view || this.hostEl) this.dispose();
      return;
    }
    const host = this.ed.renderRoot.querySelector<HTMLElement>("#stage3d");
    const ov = this.ed.renderRoot.querySelector<SVGSVGElement>("#ov3d");
    if (!host) return;
    this.bindHost(host, ov);

    if (!this.view) {
      if (!cachedLib) {
        if (!this.loading && !this.error) {
          this.loading = true;
          void load3d().then(
            () => {
              this.loading = false;
              this.error = "";
              if (this.ed.open3d) this.ed.requestUpdate();
            },
            (err) => {
              this.loading = false;
              this.error = err instanceof Error ? err.message : "3D unavailable";
              this.ed.requestUpdate();
            },
          );
        }
        return;
      }
      try {
        this.view = cachedLib.createView3D(host, {
          turnDeg: this.ed.st.turnDeg,
          deps: { scene: sceneDeps, live: liveDeps, texture: textureDeps.texture },
          onFrame: () => this.drawOverlay(),
          onFail: (why) => {
            this.error = `3D unavailable: ${why}`;
            this.dispose();
            this.ed.requestUpdate();
          },
        });
      } catch (err) {
        this.error = err instanceof cachedLib.NoWebGL ? "WebGL unavailable" : "3D could not start";
        this.ed.requestUpdate();
        return;
      }
    }

    const view = this.view, st = this.ed.st, layout = st.layout, f = st.f;
    view.setTheme(`${st.theme}|${this.ed.isDark()}|${JSON.stringify(layout.wallColors ?? null)}`);
    view.setWalls(this.walls);

    const around = floorsAroundKey(layout, st.floor);
    const sig = JSON.stringify({ f, around, colors: layout.colors ?? null, wallColors: layout.wallColors ?? null });
    const floorSwitched = st.floor !== this.lastFloorKey;

    if (floorSwitched || !this.lastSig) {
      if (this.rebuildTimer !== null) {
        clearTimeout(this.rebuildTimer);
        this.rebuildTimer = null;
      }
      this.lastFloorKey = st.floor;
      this.lastSig = sig;
      view.setFloor(f, around, false);
    } else if (sig !== this.lastSig) {
      if (immediate || this.drag) {
        if (this.rebuildTimer !== null) {
          clearTimeout(this.rebuildTimer);
          this.rebuildTimer = null;
        }
        this.lastSig = sig;
        view.setFloor(f, around, true);
      } else {
        if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => {
          this.rebuildTimer = null;
          this.sync(true);
        }, REBUILD_MS);
      }
    }

    const belowMode = st.ghostFloor ? "ghost" : "none";
    const curElev = floorElevation(layout, st.floor);
    const belowList = belowMode === "ghost"
      ? floorsBelow(layout, st.floor).map((k) => ({
          floor: layout.floors[k],
          elevation: floorElevation(layout, k) - curElev,
          ...floorPlace(layout, k, st.floor),
        }))
      : [];
    const belowSig = `${belowMode}|${JSON.stringify(belowList)}`;
    if (belowSig !== this.lastBelowSig) {
      this.lastBelowSig = belowSig;
      view.setBelow(belowList, belowMode);
    }

    const now = Date.now();
    const state = this.ed.stateForRender();
    const sunAttr = state?.["sun.sun"]?.attributes;
    const sun = !st.night && typeof sunAttr?.azimuth === "number" && typeof sunAttr?.elevation === "number"
      ? { azimuth: sunAttr.azimuth, elevation: sunAttr.elevation, north: layout.north }
      : undefined;
    view.setLive(
      f,
      {
        scale: 1,
        state,
        now,
        plugWatts: plugThreshold(undefined),
        roomGlow: true,
        night: st.night,
        sun,
        labels: st.labels,
        showNames: st.showNames,
        camThumb: st.cam.on ? { ...st.cam, bust: this.ed.thumbs.bust, failed: this.ed.thumbs.failed } : undefined,
        around,
      },
      now,
    );
    view.setRing(st.sel?.t === "room" ? st.sel.i : null);
    this.drawOverlay();
  }

  /** Projects current selection wireframes and Stage 3 handles into `#ov3d`. */
  drawOverlay(): void {
    const ov = this.ed.renderRoot.querySelector<SVGSVGElement>("#ov3d");
    if (!ov || !this.view) return;
    const { wires, handles } = handlesForSel(this.ed.st.f, this.ed.st.sel);
    this.drawnHandles = handles;
    const parts: string[] = [];

    for (const w of wires) {
      const pts = w.pts.map((p) => this.view!.project(p[0], p[1], p[2]));
      if (pts.some((p) => !p || !p.front)) continue;
      const d = (pts as NonNullable<(typeof pts)[number]>[]).map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ") + (w.closed ? " Z" : "");
      parts.push(`<path class="w3d${w.zone ? " zone" : ""}" d="${d}"/>`);
    }

    for (const h of handles) {
      const p = this.view.project(h.at[0], h.at[1], h.at[2]);
      if (!p || !p.front) continue;
      const cls = h.kind === "corner" ? "h3d corner" : "h3d vert";
      parts.push(`<circle class="${cls}" data-h3d="${h.kind}" data-hid="${h.id}" cx="${num(p.x)}" cy="${num(p.y)}" r="6"><title>${h.label}</title></circle>`);
    }

    const nextHtml = parts.join("");
    if (nextHtml === this.lastOvHtml && ov.childNodes.length === parts.length) return;
    this.lastOvHtml = nextHtml;
    ov.innerHTML = nextHtml;
  }

  private onHostDown = (ev: PointerEvent) => {
    if (!this.view || ev.button !== 0 || ev.ctrlKey || ev.metaKey) return;
    const st = this.ed.st, f = st.f;
    const hit = this.view.hit(ev.clientX, ev.clientY);
    const sel = selFromHit(f, hit);

    if (sel && (sel.t === "dev" || sel.t === "furn" || sel.t === "unl")) {
      const anchor = itemAnchor3D(f, sel), ray = this.view.rayAt(ev.clientX, ev.clientY);
      if (anchor && ray) {
        ev.stopPropagation();
        try { this.hostEl?.setPointerCapture(ev.pointerId); } catch { /* synthetic */ }
        const pt = rayOnZ(ray, anchor[2]);
        const off: Pt = pt ? [pt[0] - anchor[0], pt[1] - anchor[1]] : [0, 0];
        const locked =
          sel.t === "dev" ? !!f.devices[sel.i]?.locked
          : sel.t === "furn" ? !!f.furniture[sel.i]?.locked
          : !!f.unlinked[sel.i]?.locked;
        this.drag = {
          mode: "item",
          base: structuredClone(f),
          kind: sel.t,
          i: sel.i,
          startPx: [ev.clientX, ev.clientY],
          anchor,
          off,
          zStartRay: rayZAt(ray, anchor[0], anchor[1]),
          shiftZ: ev.shiftKey,
          moved: false,
          locked,
        };
        return;
      }
    }

    this.pendingClick = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, hit };
  };

  private onHostMove = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d || d.mode !== "item" || !this.view) return;
    ev.stopPropagation();
    const movedFar = Math.hypot(ev.clientX - d.startPx[0], ev.clientY - d.startPx[1]) > DRAG_SLOP_PX;
    if (!d.moved && !movedFar) return;

    const st = this.ed.st;
    if (d.locked) return;
    if (d.kind === "furn" && st.planLocked) {
      this.drag = null;
      this.ed.planFixed();
      return;
    }

    const ray = this.view.rayAt(ev.clientX, ev.clientY);
    if (!ray) return;

    let next: Floor | null = null;
    if ((ev.shiftKey || d.shiftZ) && (d.kind === "dev" || d.kind === "furn")) {
      const zNow = rayZAt(ray, d.anchor[0], d.anchor[1]);
      if (zNow !== null && d.zStartRay !== null) {
        next = setItemZ(d.base, d.kind, d.i, d.anchor[2] + (zNow - d.zStartRay));
      }
    } else {
      const pt = rayOnZ(ray, d.anchor[2]);
      if (pt) {
        next = moveItem3D(d.base, d.kind, d.i, [pt[0] - d.off[0], pt[1] - d.off[1]], ev.altKey ? 0 : st.snapGrid);
      }
    }
    if (!next) return;
    if (!d.moved) {
      d.moved = true;
      st.sel = { t: d.kind, i: d.i };
      st.snapshot();
    }
    st.replaceFloor(next);
    this.sync(true);
    this.ed.requestUpdate();
  };

  private onHostUp = (ev: PointerEvent) => {
    if (this.drag?.mode === "item") {
      ev.stopPropagation();
      try { this.hostEl?.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
      const d = this.drag;
      this.drag = null;
      const st = this.ed.st;
      if (!d.moved || ev.type === "pointercancel") {
        if (d.moved) st.dropSnapshot();
        st.sel = { t: d.kind, i: d.i };
        this.ed.requestUpdate();
        return;
      }
      if (JSON.stringify(st.f) === JSON.stringify(d.base)) {
        st.dropSnapshot();
        this.ed.requestUpdate();
        return;
      }
      this.ed.changed(d.shiftZ || ev.shiftKey ? "Adjusted height" : "Moved in 3D");
      if (d.kind === "dev") void offerAreaMove(this.ed, d.i);
      return;
    }

    const pc = this.pendingClick;
    this.pendingClick = null;
    if (pc && pc.id === ev.pointerId && ev.type === "pointerup" && !this.view?.dragged && Math.hypot(ev.clientX - pc.x, ev.clientY - pc.y) <= 6) {
      this.ed.st.sel = selFromHit(this.ed.st.f, pc.hit);
      this.ed.requestUpdate();
    }
  };

  private onHandleDown = (ev: PointerEvent) => {
    if (!this.view || ev.button !== 0 || !this.ovEl) return;
    const el = (ev.target as Element | null)?.closest<SVGCircleElement>("[data-h3d]");
    if (!el) return;
    ev.stopPropagation();
    const hid = el.dataset.hid;
    const h = this.drawnHandles.find((x) => x.id === hid);
    if (!h) return;
    const st = this.ed.st;
    if (st.planLocked) {
      this.ed.planFixed();
      return;
    }
    const ray = this.view.rayAt(ev.clientX, ev.clientY);
    if (!ray) return;
    try { this.ovEl.setPointerCapture(ev.pointerId); } catch { /* synthetic */ }
    const span = (h.kind === "sill" || h.kind === "head") && h.list && typeof h.index === "number"
      ? (h.list === "doors" ? doorSpan(st.f.doors[h.index], doorCeiling(st.f, st.f.doors[h.index])) : openingSpan(st.f.openings[h.index]))
      : undefined;
    this.drag = {
      mode: "handle",
      handle: h,
      base: structuredClone(st.f),
      startPx: [ev.clientX, ev.clientY],
      from: [h.at[0], h.at[1]],
      to: [h.at[0], h.at[1]],
      zStartRay: rayZAt(ray, h.at[0], h.at[1]),
      span,
      moved: false,
    };
  };

  private onHandleMove = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d || d.mode !== "handle" || !this.view) return;
    ev.stopPropagation();
    if (!d.moved && Math.hypot(ev.clientX - d.startPx[0], ev.clientY - d.startPx[1]) <= DRAG_SLOP_PX) return;

    const ray = this.view.rayAt(ev.clientX, ev.clientY);
    if (!ray) return;
    const st = this.ed.st, h = d.handle;
    let next: Floor | null = null;

    if (h.kind === "corner" && h.ref) {
      const pt = rayOnZ(ray, h.at[2]);
      if (!pt) return;
      const gs = ev.altKey ? 0 : st.snapGrid;
      let to: Pt = [gridRound(pt[0], gs), gridRound(pt[1], gs)];
      if (!ev.altKey && !isZoneRef(d.base, h.ref)) {
        to = snapPoint(d.base, to, { threshold: 10, grid: gs, exclude: [d.from], neighbours: [] });
      }
      if (!("poly" in h.ref) && (h.ref.k === "walls" || h.ref.k === "openings")) {
        const seg = d.base[h.ref.k][h.ref.i];
        if (seg?.locked) to = pivotOnArc(seg[h.ref.end === "a" ? "b" : "a"], to, dist(seg.a, seg.b), d.from);
      }
      if ("poly" in h.ref) {
        const pts = polyPts(d.base, h.ref.poly) ?? [], n = pts.length;
        const neigh = [pts[(h.ref.j + 1) % n], pts[(h.ref.j + n - 1) % n]];
        if (neigh.some((q) => q && q[0] === to[0] && q[1] === to[1])) return;
      }
      next = movePointAll(d.base, d.from, to, ev.shiftKey, h.ref);
      if (next === d.base) return;
      d.to = to;
    } else {
      const zNow = rayZAt(ray, h.at[0], h.at[1]);
      if (zNow === null || d.zStartRay === null) return;
      next = applyHeightHandle(d.base, h, h.at[2] + (zNow - d.zStartRay), d.span);
    }

    if (!next) return;
    if (!d.moved) {
      d.moved = true;
      st.snapshot();
    }
    st.replaceFloor(next);
    this.sync(true);
    this.ed.requestUpdate();
  };

  private onHandleUp = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d || d.mode !== "handle") return;
    ev.stopPropagation();
    try { this.ovEl?.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    this.drag = null;
    const st = this.ed.st;
    if (!d.moved || ev.type === "pointercancel") {
      if (d.moved) {
        st.replaceFloor(d.base);
        st.dropSnapshot();
        this.sync(true);
      }
      this.ed.requestUpdate();
      return;
    }
    if (d.handle.kind === "corner" && d.handle.ref && !isZoneRef(d.base, d.handle.ref)) {
      const f = stitch(st.f, d.to);
      st.replaceFloor(f);
    }
    const v = validate(st.layout);
    if (!v.ok || JSON.stringify(st.f) === JSON.stringify(d.base)) {
      st.replaceFloor(d.base);
      st.dropSnapshot();
      this.sync(true);
      this.ed.status = v.ok ? "No change" : `Invalid geometry: ${v.errors[0]}`;
      this.ed.requestUpdate();
      return;
    }
    this.ed.changed(d.handle.kind === "corner" ? "Moved corner in 3D" : "Adjusted height in 3D");
  };
}
