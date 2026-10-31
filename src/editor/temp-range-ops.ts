import { tempRangeProblems } from "../core/schema";

/** S42.5: the temperature range fields. The layout holds °C; the user sees the unit Home Assistant is set to. */
export type TempUnit = "°C" | "°F";

/** HA's `unit_system.temperature` as the editor's unit: anything but °F is °C (the standalone page has no HA and shows °C). */
export const tempUnitOf = (ha: unknown): TempUnit => (ha === "°F" ? "°F" : "°C");

const tenth = (n: number) => Math.round(n * 10) / 10;

/** A stored °C value as the user's unit, to 0.1. */
export const toShown = (c: number, unit: TempUnit): number => tenth(unit === "°F" ? (c * 9) / 5 + 32 : c);
/** A value typed in the user's unit as °C, to 0.1: what the layout stores. */
export const fromShown = (n: number, unit: TempUnit): number => tenth(unit === "°F" ? ((n - 32) * 5) / 9 : n);

/** What a temperature box holds: empty is "unset" (undefined), a comma is a decimal point, anything else that is not a finite number is an error. */
export function parseShown(raw: string, unit: TempUnit): { ok: true; c: number | undefined } | { ok: false } {
  const s = raw.trim();
  if (s === "") return { ok: true, c: undefined };
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? { ok: true, c: fromShown(n, unit) } : { ok: false };
}

export interface HouseRange { min?: number; max?: number; hold?: number }

/** `range` without its unset keys, so `{ min: undefined }` is never stored (JSON drops it anyway, but a compare would see a change). */
export function compact<T extends object>(range: T): T {
  return Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)) as T;
}

/** The first thing wrong with a range, in words, or "" when `validate` would take it. The same rule `validate` uses, so a field can never write what Save refuses. */
export function rangeProblem(range: unknown, house: boolean): string {
  return tempRangeProblems(range, house)[0] ?? "";
}
