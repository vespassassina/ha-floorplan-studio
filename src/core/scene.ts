// stub
import type { Floor, Pt } from "./schema";
export interface Solid { id: string; kind: string; tag: string; shape: any; ref: any; paint: any }
export interface Scene { solids: Solid[]; bounds: { min: [number, number, number]; max: [number, number, number] } }
export function buildScene(_f: Floor, _o: object = {}): Scene { return { solids: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } }; }
export type { Pt };
