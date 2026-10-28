/** The card's websocket calls to the integration, kept out of the card file. */
import { CARD_VERSION } from "./version";
import { mark } from "../core/i18n";

export interface Conn {
  sendMessagePromise<T>(msg: Record<string, unknown>): Promise<T>;
  subscribeEvents?(cb: () => void, eventType: string): Promise<() => void>;
  subscribeMessage?(cb: () => void, msg: Record<string, unknown>): Promise<() => void>;
  addEventListener?(name: string, cb: () => void): void;
  removeEventListener?(name: string, cb: () => void): void;
}

export const INSTALL_HINT = mark("No layout: install the Floorplan Studio integration or set layout_url");
export const NOTHING_SAVED = mark("No plan saved yet. Open Floorplan Studio in the sidebar to draw one.");
export const STALE_PAGE = mark("Floorplan Studio was updated. Reload this page.");
export const PLAN_UNUSABLE = mark("The plan could not be used: {why}");
const LOAD_FAILED = mark("Could not load the plan: {message}");
export const NO_ANSWER = mark("no answer");

/** S38.6: an error as the card keeps it, a key and its values, not the text. The card translates it when it draws, so a language
 * change (a hass update, no new error) changes its words. A `null` value stands for the words `NO_ANSWER`, also translated then. */
export interface StoredError { key: string; vars?: Record<string, string | null> }

/** One load in flight per connection: a dashboard of cards asks once, not once per card. Dropped when it settles, so a
 * later card, or a reload after a save, asks again. Callers get the same reply object: copy it before use. */
const inflight = new WeakMap<object, Promise<{ layout: unknown }>>();
export function loadShared(conn: Conn): Promise<{ layout: unknown }> {
  const open = inflight.get(conn);
  if (open) return open;
  const p = conn.sendMessagePromise<{ layout: unknown }>({ type: "floorplan_studio/load" });
  inflight.set(conn, p);
  const done = () => { if (inflight.get(conn) === p) inflight.delete(conn); };
  p.then(done, done);
  return p;
}

/** What to tell the user when the load failed. HA's error is `{ code, message }`; the integration's own words say what
 * is wrong. Only "unknown command" means the integration is missing, and only then is the install hint true. */
export function loadErrorText(e: unknown): StoredError {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown };
  if (code === "unknown_command") return { key: INSTALL_HINT };
  return { key: LOAD_FAILED, vars: { message: message ? String(message) : null } };
}

/** True when the integration on the server is not the build this page runs: a cached card after an update. A dev build
 * has nothing to compare, and any failure says nothing (an old integration has no such command). */
export async function pageIsStale(conn: Conn): Promise<boolean> {
  if (CARD_VERSION === "dev") return false;
  try {
    const r = await conn.sendMessagePromise<{ version?: unknown }>({ type: "floorplan_studio/version" });
    return typeof r?.version === "string" && r.version !== "" && r.version !== CARD_VERSION;
  } catch {
    return false;
  }
}
