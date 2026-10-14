// Whether two JSON values are equal regardless of object key order. A document read back from the
// store has its keys in jsonb's order, not the order it was written in, so comparing JSON text
// would call a just-saved document changed. Browser-safe.

function sorted(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sorted);
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x as object).sort()) {
      const v = (x as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sorted(v);
    }
    return out;
  }
  return x;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
