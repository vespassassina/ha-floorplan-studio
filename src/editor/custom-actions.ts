// GitHub Issue #1: Declarative third-party action registry for Studio (`window.floorplanStudioActions`).
// Third-party integrations register plain `{ id, label, icon?, title? }` descriptors; Studio renders and escapes
// them safely and emits a bubbling, composed `floorplan-studio-action` CustomEvent on click (no DOM/HTML injection).
import { DEVICE_ICONS, UI_ICONS } from "../core";

export const MAX_CUSTOM_ACTIONS = 20;

export interface CustomAction {
  id: string;
  label: string;
  /** Optional icon key from `UI_ICONS` or `DEVICE_ICONS` (unknown keys are ignored; never raw HTML/SVG). */
  icon?: string;
  title?: string;
}

export interface CustomActionDetail {
  id: string;
  floor: string;
  selection: unknown;
}

export interface CustomActionRegistry {
  register(action: CustomAction): () => void;
  unregister(id: string): boolean;
  list(): CustomAction[];
  subscribe(fn: () => void): () => void;
}

const KNOWN_ICONS: Record<string, string> = { ...DEVICE_ICONS, ...UI_ICONS };

/** Returns a safe MDI path for a known icon key, or null for unknown/hostile input. */
export function actionIconPath(icon: unknown): string | null {
  if (typeof icon !== "string") return null;
  const key = icon.trim();
  return Object.prototype.hasOwnProperty.call(KNOWN_ICONS, key) ? KNOWN_ICONS[key]! : null;
}

function cleanAction(raw: unknown): CustomAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const id = typeof a.id === "string" ? a.id.trim().slice(0, 80) : "";
  const label = typeof a.label === "string" ? a.label.trim().slice(0, 60) : "";
  if (!id || !label) return null;
  const title = typeof a.title === "string" && a.title.trim() ? a.title.trim().slice(0, 160) : undefined;
  const icon = typeof a.icon === "string" && actionIconPath(a.icon) ? a.icon.trim() : undefined;
  return { id, label, ...(icon ? { icon } : {}), ...(title ? { title } : {}) };
}

export function createActionRegistry(): CustomActionRegistry {
  const items = new Map<string, CustomAction>();
  const subs = new Set<() => void>();
  const notify = () => { for (const fn of subs) try { fn(); } catch { /* listener error isolated */ } };

  const reg: CustomActionRegistry = {
    register(action: CustomAction): () => void {
      const clean = cleanAction(action);
      if (!clean) throw new Error("floorplanStudioActions.register: action requires non-empty string id and label.");
      if (!items.has(clean.id) && items.size >= MAX_CUSTOM_ACTIONS) {
        throw new Error(`floorplanStudioActions.register: maximum of ${MAX_CUSTOM_ACTIONS} actions reached.`);
      }
      items.set(clean.id, clean);
      notify();
      return () => { reg.unregister(clean.id); };
    },
    unregister(id: string): boolean {
      const removed = items.delete(typeof id === "string" ? id.trim() : "");
      if (removed) notify();
      return removed;
    },
    list(): CustomAction[] {
      return [...items.values()].map((a) => ({ ...a }));
    },
    subscribe(fn: () => void): () => void {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
  return reg;
}

declare global {
  interface Window {
    floorplanStudioActions?: CustomActionRegistry;
  }
}

/** Returns the shared `window.floorplanStudioActions` registry, creating it once if absent. */
export function getActionRegistry(): CustomActionRegistry {
  const w = typeof window !== "undefined" ? window : (globalThis as unknown as { floorplanStudioActions?: CustomActionRegistry });
  if (!w.floorplanStudioActions || typeof w.floorplanStudioActions.list !== "function") {
    w.floorplanStudioActions = createActionRegistry();
  }
  return w.floorplanStudioActions;
}
