// Marks several figures draw the same way.

/** a coordinate to one decimal: enough for a screen, a tenth of the markup */
export const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A step function's path (a KM curve, a cumulative incidence): hold the previous level to each
 * time, then move to the new one. Steps that land within the same half pixel are merged — a curve
 * over thousands of event times is otherwise thousands of segments no screen can show — keeping
 * the extreme the curve reaches there, so nothing visible is lost.
 */
export function stepPath(points: { t: number; s: number }[], x: (t: number) => number, y: (s: number) => number,
  start: { t: number; s: number }, tEnd?: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  let px = x(start.t);
  const d: string[] = ["M" + r(px) + " " + r(y(start.s))];
  let lastX = px;
  for (const q of points) {
    const nx = x(q.t), ny = y(q.s);
    if (nx - lastX < 0.5 && d.length > 1) {
      // same pixel column: the vertical move simply continues to the new level
      d[d.length - 1] = "V" + r(ny);
    } else {
      d.push("H" + r(nx), "V" + r(ny));
      lastX = nx;
    }
    px = nx;
  }
  if (tEnd != null && x(tEnd) > px) d.push("H" + r(x(tEnd)));
  return d.join("");
}
