// Labels placed beside the points they name, from measured boxes: never over another label or a
// named point, never outside the plot, and what could not be placed is returned, not dropped.

export interface Box { x: number; y: number; w: number; h: number }
export interface LabelWant { text: string; px: number; py: number; w: number; h: number }
export interface Segment { x1: number; y1: number; x2: number; y2: number }
export interface Placed { text: string; box: Box; leader: Segment | null }

/** how far beyond its point a label may sit (px); past the first it is drawn with a leader line */
const RINGS = [0, 8, 18, 32, 50, 75, 110, 150, 200];
const overlaps = (a: Box, b: Box, pad = 1) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const hitsDot = (b: Box, x: number, y: number, r: number) =>
  x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h;

/** whether segment s passes through box b (Liang–Barsky clipping) */
export function crosses(s: Segment, b: Box): boolean {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, s.x1 - b.x], [dx, b.x + b.w - s.x1], [-dy, s.y1 - b.y], [dy, b.y + b.h - s.y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-6;
}

/**
 * Greedy label placement from measured boxes, in the order given (most important first). Each label
 * tries positions around its point — beside, above, below, the diagonals — then the same further
 * out (`RINGS`), joined to its point by a leader. A position must lie inside `bounds` and must not
 * touch a label already placed or any labelled point, and its leader must not cross a placed
 * label (nor a placed leader cross it); among those left, the one covering the fewest other points
 * (`dots`), then the nearest, wins. A label with no such position is returned in `unplaced`,
 * never drawn over something and never dropped without the caller knowing.
 */
export function placeLabels(wants: LabelWant[], bounds: Box, dots: { x: number; y: number }[], r: number):
  { placed: Placed[]; unplaced: string[] } {
  const placed: Placed[] = [], unplaced: string[] = [];
  const anchors = wants.map((w) => ({ x: w.px, y: w.py }));
  const inside = (b: Box) => b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h;
  const GAP = r + 2;
  for (const w of wants) {
    let best: (Placed & { cost: number }) | null = null;
    for (let ring = 0; ring < RINGS.length; ring++) {
      const d = RINGS[ring], g = GAP + d;
      const cands: [number, number][] = [
        [w.px + g, w.py - w.h / 2], [w.px - g - w.w, w.py - w.h / 2],
        [w.px - w.w / 2, w.py - g - w.h], [w.px - w.w / 2, w.py + g],
        [w.px + g * 0.7, w.py - g * 0.7 - w.h], [w.px - g * 0.7 - w.w, w.py - g * 0.7 - w.h],
        [w.px + g * 0.7, w.py + g * 0.7], [w.px - g * 0.7 - w.w, w.py + g * 0.7],
      ];
      for (let k = 0; k < cands.length; k++) {
        const [x, y] = cands[k];
        const box = { x, y, w: w.w, h: w.h };
        if (!inside(box)) continue;
        if (placed.some((q) => overlaps(q.box, box) || (q.leader && crosses(q.leader, box)))) continue;
        if (anchors.some((a) => hitsDot(box, a.x, a.y, r + 1))) continue;
        let leader: Segment | null = null;
        if (ring > 0) {
          const ex = Math.max(box.x, Math.min(w.px, box.x + box.w)), ey = Math.max(box.y, Math.min(w.py, box.y + box.h));
          // start at the point's ring, not its centre
          const len = Math.hypot(ex - w.px, ey - w.py) || 1, k0 = (r + 1.5) / len;
          leader = { x1: w.px + (ex - w.px) * k0, y1: w.py + (ey - w.py) * k0, x2: ex, y2: ey };
          const l = leader;
          if (placed.some((q) => crosses(l, q.box))) continue;
        }
        let covered = 0;
        for (const p of dots) if (hitsDot(box, p.x, p.y, r)) covered++;
        const cost = covered * 4 + d * 0.08 + k * 0.1;
        if (!best || cost < best.cost) best = { text: w.text, box, leader, cost };
      }
    }
    if (best) placed.push({ text: best.text, box: best.box, leader: best.leader });
    else unplaced.push(w.text);
  }
  return { placed, unplaced };
}
