// What drawing a plot needs from lib/plot.ts, without the database layer it reaches: the figure
// is drawn in the browser as well as on the server, and a client bundle cannot import lib/plot.ts.

/** categories that mean "this case has none of that", which draw as neutral and never as a ring */
export function isAbsent(label: string): boolean {
  return /^(not mutated|unaltered|neutral|diploid|no structural variant|not profiled|no data|wild type|none|)$/i.test(String(label).trim());
}

/**
 * Where a point sits across its box. Deterministic from the case id, as the portal's jitter is,
 * so the same figure comes out of the server SVG, the browser and the Python package rather than
 * moving every time it is drawn.
 */
export function jitterFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const f = Math.abs(Math.sin(h >>> 0)) * 10000;
  return (f - Math.floor(f)) * 2 - 1;
}
