import { html, nothing } from "lit";
import {
  mdiCursorDefault,
  mdiVectorPolygon,
  mdiWall,
  mdiDoor,
  mdiWindowClosedVariant,
  mdiRuler,
  mdiCubeOutline,
  mdiFullscreen,
  mdiFullscreenExit,
  mdiDragHorizontalVariant,
  mdiChevronUp,
  mdiChevronDown,
} from "@mdi/js";
import type { FloorplanStudioEditor } from "./editor-app";

// S87: Draggable floating Studio icon tool palette (Studio-only, 0 B in floorplan-studio-card.js).

const PAL_STORAGE = "floorplan-studio:palette-pos";

export interface PaletteState {
  x: number;
  y: number;
  collapsed: boolean;
}

export function loadPaletteState(): PaletteState {
  try {
    const raw = localStorage.getItem(PAL_STORAGE);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PaletteState>;
      if (typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y)) {
        return { x: Math.max(4, Math.min(2000, p.x)), y: Math.max(4, Math.min(2000, p.y)), collapsed: !!p.collapsed };
      }
    }
  } catch { /* ignore */ }
  return { x: 12, y: 12, collapsed: false };
}

export function savePaletteState(p: PaletteState): void {
  try { localStorage.setItem(PAL_STORAGE, JSON.stringify(p)); } catch { /* ignore */ }
}

const ico = (d: string) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${d} fill="currentColor"/></svg>`;

export function toolPaletteView(h: FloorplanStudioEditor) {
  const p = h.palette;
  const onGripDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX, startY = ev.clientY;
    const baseX = p.x, baseY = p.y;
    const canvas = h.renderRoot.querySelector<HTMLElement>(".canvas");
    const maxW = canvas ? Math.max(60, canvas.clientWidth - 48) : 1200;
    const maxH = canvas ? Math.max(60, canvas.clientHeight - 48) : 800;
    const onMove = (e: PointerEvent) => {
      h.palette = {
        ...h.palette,
        x: Math.max(4, Math.min(maxW, Math.round(baseX + e.clientX - startX))),
        y: Math.max(4, Math.min(maxH, Math.round(baseY + e.clientY - startY))),
      };
      h.requestUpdate();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      savePaletteState(h.palette);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggleCollapse = () => {
    h.palette = { ...h.palette, collapsed: !h.palette.collapsed };
    savePaletteState(h.palette);
    h.requestUpdate();
  };

  const drawKind = h.draw?.kind;
  const selectActive = !h.draw && !h.ruler;

  return html`<div class="tool-pal" id="toolPalette" role="toolbar" aria-label="Studio tools" style="left:${p.x}px;top:${p.y}px">
    <div class="tool-pal-hd">
      <button type="button" class="tool-grip" title="Drag tool palette" aria-label="Drag tool palette" @pointerdown=${onGripDown}>${ico(mdiDragHorizontalVariant)}</button>
      <button type="button" class="tool-min" title=${p.collapsed ? "Expand tools" : "Collapse tools"} aria-label=${p.collapsed ? "Expand tools" : "Collapse tools"} @click=${toggleCollapse}>${ico(p.collapsed ? mdiChevronDown : mdiChevronUp)}</button>
    </div>
    ${p.collapsed ? nothing : html`
      <button type="button" class="tool-btn" data-tool="select" aria-pressed=${selectActive ? "true" : "false"} title="Select & move (Esc)" @click=${() => h.selectTool()}>${ico(mdiCursorDefault)}</button>
      <button type="button" class="tool-btn" data-tool="room" aria-pressed=${drawKind === "room" ? "true" : "false"} title="Draw room" @click=${() => h.startDraw("room")}>${ico(mdiVectorPolygon)}</button>
      <button type="button" class="tool-btn" data-tool="wall" aria-pressed=${drawKind === "wall" ? "true" : "false"} title="Draw wall" @click=${() => h.startDraw("wall")}>${ico(mdiWall)}</button>
      <button type="button" class="tool-btn" data-tool="door" title="Add door" @click=${() => h.addDoor("door", 90)}>${ico(mdiDoor)}</button>
      <button type="button" class="tool-btn" data-tool="window" title="Add window" @click=${() => h.addDoor("window", 120)}>${ico(mdiWindowClosedVariant)}</button>
      <button type="button" class="tool-btn" data-tool="ruler" aria-pressed=${h.ruler ? "true" : "false"} title="Ruler (M)" @click=${() => h.toggleRuler()}>${ico(mdiRuler)}</button>
      <button type="button" class="tool-btn" data-tool="3d" aria-pressed=${h.open3d ? "true" : "false"} title="Toggle 3D preview" @click=${() => h.toggle3d()}>${ico(mdiCubeOutline)}</button>
      <button type="button" class="tool-btn" data-tool="fullscreen" aria-pressed=${h.fullscreenOn ? "true" : "false"} title="Toggle fullscreen (F)" @click=${() => h.toggleFullscreen()}>${ico(h.fullscreenOn ? mdiFullscreenExit : mdiFullscreen)}</button>
    `}
  </div>`;
}
