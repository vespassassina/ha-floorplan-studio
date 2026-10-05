// A skipped piece of work leaves a trace a field report can use: one `console.debug` line per kind, for the life of the page.
// Debug level, so a console at its default level shows nothing, and a layout with a thousand bad pieces says it once.
const said = new Set<string>();
export function debugOnce(kind: string, err: unknown): void {
  if (said.has(kind)) return;
  said.add(kind);
  try { console.debug(`floorplan-studio: ${kind} (${err instanceof Error ? err.message : String(err)}); this is said once`); } catch { /* no console */ }
}
/** For tests: forget what was said. */
export const forgetDebug = (): void => said.clear();
