import { MAX_LAYOUT_BYTES, MAX_TRACE_BYTES } from "../core/schema";

/** The long side of a trace image after Load. A floor plan scan needs no more to trace walls by. */
export const TRACE_MAX_PX = 2000;
/** A PNG this small (as a data URL) stays PNG: line art keeps its sharp edges. Anything larger becomes JPEG. */
const PNG_KEEP_BYTES = 1024 * 1024;

export interface TraceImage { src: string; w: number; h: number }

function readUrl(file: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("That file could not be read."));
    r.readAsDataURL(file);
  });
}
function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => (i.naturalWidth > 0 && i.naturalHeight > 0 ? ok(i) : no(new Error("That file is not an image.")));
    i.onerror = () => no(new Error("That file is not an image. Use a PNG, JPEG or WebP."));
    i.src = url;
  });
}

/**
 * Reads an image file and redraws it at most TRACE_MAX_PX on its long side. A PNG stays PNG when the result is
 * under 1 MB; everything else is JPEG at 0.85 on white (JPEG has no transparency), then lower quality until it fits
 * MAX_TRACE_BYTES. Rejects with a message a user can act on.
 */
export async function traceImage(file: Blob, limit: number = MAX_TRACE_BYTES): Promise<TraceImage> {
  // G19: `limit` is what the image may take: the per-trace cap, or less when the rest of the plan already uses much of the save limit.
  const cap = Math.min(limit, MAX_TRACE_BYTES);
  const img = await decode(await readUrl(file));
  const k = Math.min(1, TRACE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser cannot redraw the image.");
  if (file.type === "image/png") {
    g.drawImage(img, 0, 0, w, h);
    const png = c.toDataURL("image/png");
    if (png.length <= Math.min(PNG_KEEP_BYTES, cap)) return { src: png, w, h };
    g.clearRect(0, 0, w, h);
  }
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  for (const q of [0.85, 0.7, 0.5, 0.3]) {
    const jpg = c.toDataURL("image/jpeg", q);
    if (jpg.length <= cap) return { src: jpg, w, h };
  }
  const mb = (n: number) => (n / 1e6).toFixed(1); // MAX_LAYOUT_BYTES is 3,500,000 characters: 3.5 MB, as the docs say
  if (cap >= MAX_TRACE_BYTES) throw new Error("That image is too detailed to store under 4 MB, even at low quality. Crop it first.");
  throw new Error(`That image is too big to keep with this plan: Home Assistant takes at most ${mb(MAX_LAYOUT_BYTES)} MB in one save, the rest of the plan leaves ${mb(Math.max(0, cap))} MB, and even at low quality the image needs more. Crop it, or remove another floor's trace image (Edit, Trace image…, Remove), then load it again.`);
}

/** The tenth of a degree a typed rotation lands on. Round before folding: folding first turned -0.04 into 360, which `validate` refuses. */
export function traceRotStored(deg: number): number {
  const r = Math.round(deg * 10) / 10;
  const folded = Math.round((((r % 360) + 360) % 360) * 10) / 10; // the fold adds float noise; round once more
  return folded >= 360 ? 0 : folded + 0; // `+ 0` turns -0 into 0
}
/** A stored `rot` in [0, 360) as the -180..180 the Rotation field shows. */
export const traceRotShown = (rot: number): number => Math.round((rot > 180 ? rot - 360 : rot) * 10) / 10 + 0;
