// S28.2: how the floor below reads against the room it lies on, measured from the real elements. Self-contained arrows only: the
// function is serialised into the page by `page.evaluate`. The paint order is read from the document (a veil drawn after the
// ghost does not darken it), so a test on this fails on the old order and holds on the new one.
export interface GhostRead { room: number; lit: boolean; veiled: boolean; contrast: number; }

/** `want` picks a lit or an unlit room at night; `only` pins the room (to read the same room by day). By day (no overlays) any room does. */
export const readGhost = (root: ParentNode, want: "lit" | "unlit", only: number | null = null): GhostRead | null => {
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const rgba = (css: string): [number, number, number, number] => {
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = "#000"; cv.fillStyle = css; cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top: [number, number, number, number], under: [number, number, number, number]): [number, number, number, number] => {
    const a = top[3] + under[3] * (1 - top[3]);
    return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as [number, number, number, number];
  };
  const lum = (c: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const svg = root.querySelector("svg") as SVGSVGElement;
  const g = svg.querySelector("g.ghost") as SVGGElement | null;
  if (!g) return null;
  const bg = rgba(getComputedStyle(svg).getPropertyValue("--fp-bg").trim() || "#000");
  const rooms = [...svg.querySelectorAll<SVGPolygonElement>("polygon.room")].filter((p) => p.dataset.r !== undefined);
  for (const path of g.querySelectorAll<SVGPathElement>("path")) {
    const m = path.getScreenCTM()!, len = path.getTotalLength();
    for (let l = 0; l <= len; l += 3) {
      const p = path.getPointAtLength(l), x = p.x * m.a + p.y * m.c + m.e, y = p.x * m.b + p.y * m.d + m.f;
      const top = (root as unknown as DocumentOrShadowRoot).elementsFromPoint(x, y);
      const room = rooms.find((r) => top.includes(r) && !top.some((t) => t.matches("line, g[data-x], text")));
      if (!room || !room.getAttribute("class")!.match(/room-room/)) continue;
      const night = svg.querySelector<SVGPolygonElement>(`polygon[data-night="${room.dataset.r}"]`);
      const day = !svg.querySelector("polygon[data-night]");
      const lit = day || night === null || night.classList.contains("lit");
      if (only !== null && +room.dataset.r! !== only) continue;
      if (!day && lit !== (want === "lit")) continue;
      const veilRgba = night && !lit ? rgba(getComputedStyle(night).fill) : ([0, 0, 0, 0] as [number, number, number, number]);
      // a veil painted before the ghost in the document darkens it; one painted after does not
      const veiled = !!night && veilRgba[3] > 0 && !!(g.compareDocumentPosition(night) & Node.DOCUMENT_POSITION_FOLLOWING);
      const floor = over(rgba(getComputedStyle(room).fill), bg);
      const stroke = rgba(getComputedStyle(path).stroke);
      let lineC = over(stroke, floor), floorC = floor;
      if (night && veilRgba[3] > 0) {
        floorC = over(veilRgba, floor);
        lineC = veiled ? over(veilRgba, lineC) : lineC;
      }
      return { room: +room.dataset.r!, lit, veiled, contrast: ratio(lineC, floorC) };
    }
  }
  return null;
};

/** Run `readGhost` in the page, on the shadow root of the host element `host`. */
export const readGhostIn = (page: import("@playwright/test").Page, host: string, want: "lit" | "unlit", only: number | null): Promise<GhostRead | null> =>
  page.evaluate(([src, host, want, only]) => {
    const fn = (0, eval)(`(${src})`) as (r: ParentNode, w: string, o: number | null) => unknown;
    return fn(document.querySelector(host as string)!.shadowRoot!, want as string, only as number | null);
  }, [readGhost.toString(), host, want, only] as const) as Promise<GhostRead | null>;
