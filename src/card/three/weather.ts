// S82: 3D weather atmosphere (pure mood table + lightweight rain/snow/fog particles inside the lazy 3D chunk).
import { BufferAttribute, BufferGeometry, FogExp2, LineBasicMaterial, LineSegments, Points, PointsMaterial, type Scene } from "three";

export type WeatherKind = "clear" | "cloudy" | "fog" | "rain" | "snow";

export interface WeatherMood {
  kind: WeatherKind;
  sunScale: number;
  hemiSky: number | null;
  fogDensity: number;
  rate: number;
  speed: number;
}

const CLEAR: WeatherMood = { kind: "clear", sunScale: 1, hemiSky: null, fogDensity: 0, rate: 0, speed: 0 };

const MOODS: Readonly<Record<string, WeatherMood>> = {
  sunny: CLEAR,
  "clear-night": CLEAR,
  windy: { kind: "cloudy", sunScale: 0.85, hemiSky: 0xdce6f2, fogDensity: 0, rate: 0, speed: 0 },
  "windy-variant": { kind: "cloudy", sunScale: 0.8, hemiSky: 0xd5e0ee, fogDensity: 0, rate: 0, speed: 0 },
  partlycloudy: { kind: "cloudy", sunScale: 0.82, hemiSky: 0xdbe5f2, fogDensity: 0, rate: 0, speed: 0 },
  cloudy: { kind: "cloudy", sunScale: 0.65, hemiSky: 0xc8d4e3, fogDensity: 0, rate: 0, speed: 0 },
  fog: { kind: "fog", sunScale: 0.52, hemiSky: 0xd0d8e0, fogDensity: 0.00026, rate: 0, speed: 0 },
  rainy: { kind: "rain", sunScale: 0.5, hemiSky: 0xa6bad0, fogDensity: 0.00012, rate: 160, speed: 520 },
  pouring: { kind: "rain", sunScale: 0.42, hemiSky: 0x8ea4be, fogDensity: 0.00018, rate: 220, speed: 680 },
  hail: { kind: "rain", sunScale: 0.45, hemiSky: 0x9ab0c8, fogDensity: 0.00016, rate: 200, speed: 640 },
  lightning: { kind: "rain", sunScale: 0.44, hemiSky: 0x889cb8, fogDensity: 0.00016, rate: 120, speed: 560 },
  "lightning-rainy": { kind: "rain", sunScale: 0.4, hemiSky: 0x8498b4, fogDensity: 0.0002, rate: 220, speed: 700 },
  snowy: { kind: "snow", sunScale: 0.72, hemiSky: 0xdce8f6, fogDensity: 0.00014, rate: 160, speed: 75 },
  "snowy-rainy": { kind: "snow", sunScale: 0.6, hemiSky: 0xc4d4e6, fogDensity: 0.00016, rate: 170, speed: 120 },
};

/** Maps a Home Assistant `weather.*` state string to 3D atmospheric lighting, fog, and precipitation parameters. */
export function weatherMood(condition: unknown): WeatherMood {
  if (typeof condition !== "string") return CLEAR;
  const key = condition.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MOODS, key) ? MOODS[key]! : CLEAR;
}

const hash = (n: number) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export interface WeatherFx {
  set(mood: WeatherMood, bounds: { min: readonly number[]; max: readonly number[] } | null, bgHex: number): boolean;
  step(dtSec: number): void;
  kind(): WeatherKind;
  count(): number;
  dispose(): void;
}

/** Manages optional 3D rain streaks, drifting snowflakes, and atmospheric fog on a Three.js `Scene`. */
export function createWeatherFx(scene: Scene): WeatherFx {
  let obj: LineSegments | Points | null = null;
  let curKind: WeatherKind = "clear";
  let curKey = "";
  let curRate = 0;
  let curSpeed = 0;
  let yMin = 0, yMax = 600, x0 = -500, x1 = 500, z0 = -500, z1 = 500;
  let phase = 0;

  const clearObj = () => {
    if (!obj) return;
    scene.remove(obj);
    obj.geometry.dispose();
    (obj.material as LineBasicMaterial | PointsMaterial).dispose();
    obj = null;
    curRate = 0;
  };

  return {
    set(mood, bounds, bgHex) {
      curKind = mood.kind;
      curSpeed = mood.speed;
      scene.fog = mood.fogDensity > 0 ? new FogExp2(bgHex, mood.fogDensity) : null;
      if ((mood.kind !== "rain" && mood.kind !== "snow") || !bounds || mood.rate <= 0) {
        clearObj();
        curKey = "";
        return false;
      }
      const bx0 = bounds.min[0] ?? 0, by0 = bounds.min[1] ?? 0, bz0 = bounds.min[2] ?? 0;
      const bx1 = bounds.max[0] ?? 800, by1 = bounds.max[1] ?? 600, bz1 = bounds.max[2] ?? 300;
      const pad = Math.max(250, Math.hypot(bx1 - bx0, by1 - by0) * 0.25);
      const nextKey = `${mood.kind}|${mood.rate}|${Math.round(bx0)}|${Math.round(by0)}|${Math.round(bx1)}|${Math.round(by1)}`;
      if (nextKey === curKey && obj) return true;
      clearObj();
      curKey = nextKey;
      curRate = mood.rate;
      x0 = bx0 - pad; x1 = bx1 + pad;
      z0 = by0 - pad; z1 = by1 + pad;
      yMin = bz0; yMax = Math.max(bz1 + 420, 620);

      const geo = new BufferGeometry();
      if (mood.kind === "rain") {
        const pos = new Float32Array(mood.rate * 6);
        const len = 38;
        for (let i = 0; i < mood.rate; i++) {
          const x = x0 + hash(i * 3 + 1) * (x1 - x0);
          const y = yMin + hash(i * 3 + 2) * (yMax - yMin);
          const z = z0 + hash(i * 3 + 3) * (z1 - z0);
          pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
          pos[i * 6 + 3] = x + 6; pos[i * 6 + 4] = y - len; pos[i * 6 + 5] = z + 4;
        }
        geo.setAttribute("position", new BufferAttribute(pos, 3));
        const mat = new LineBasicMaterial({ color: 0xb8d4f4, transparent: true, opacity: 0.42, depthWrite: false });
        obj = new LineSegments(geo, mat);
      } else {
        const pos = new Float32Array(mood.rate * 3);
        for (let i = 0; i < mood.rate; i++) {
          pos[i * 3] = x0 + hash(i * 3 + 1) * (x1 - x0);
          pos[i * 3 + 1] = yMin + hash(i * 3 + 2) * (yMax - yMin);
          pos[i * 3 + 2] = z0 + hash(i * 3 + 3) * (z1 - z0);
        }
        geo.setAttribute("position", new BufferAttribute(pos, 3));
        const mat = new PointsMaterial({ color: 0xf4f8ff, size: 7, sizeAttenuation: true, transparent: true, opacity: 0.78, depthWrite: false });
        obj = new Points(geo, mat);
      }
      obj.name = "weather";
      obj.raycast = () => undefined;
      obj.frustumCulled = false;
      obj.renderOrder = 4;
      scene.add(obj);
      return true;
    },
    step(dtSec) {
      if (!obj || !(dtSec > 0)) return;
      const dt = Math.min(dtSec, 0.15);
      phase += dt;
      const attr = obj.geometry.getAttribute("position") as BufferAttribute;
      const arr = attr.array as Float32Array;
      const span = yMax - yMin || 600;
      const dy = curSpeed * dt;
      if (curKind === "rain") {
        const len = 38;
        for (let i = 0; i < curRate; i++) {
          let y = arr[i * 6 + 1]! - dy;
          if (y < yMin) y += span;
          arr[i * 6 + 1] = y;
          arr[i * 6 + 4] = y - len;
        }
      } else {
        for (let i = 0; i < curRate; i++) {
          let y = arr[i * 3 + 1]! - dy;
          if (y < yMin) y += span;
          arr[i * 3 + 1] = y;
          arr[i * 3] = arr[i * 3]! + Math.sin(phase * 1.4 + i) * 14 * dt;
        }
      }
      attr.needsUpdate = true;
    },
    kind: () => curKind,
    count: () => curRate,
    dispose() { clearObj(); scene.fog = null; },
  };
}
