// `liveOf` bound to the real core helpers (see scene.ts). The card's lazy 3D chunk holds `live-build.ts`.
import { liveDeps } from "./three-deps";
import { makeLiveOf } from "./live-build";
export * from "./live-build";
export const liveOf = makeLiveOf(liveDeps);
