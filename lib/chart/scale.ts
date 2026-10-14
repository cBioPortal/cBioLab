// Scales with ticks a reader can use: round steps (1, 2, 5 × 10ⁿ) on linear axes, powers of ten
// (and 2, 5 between them when the range is short) on log axes, each with its label format.
import { scaleLinear, scaleLog, scaleSymlog } from "d3-scale";
import { tickFormat, fmtNum } from "./format.ts";

export interface Scale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  ticks: number[];
  /** the label for one of `ticks` */
  fmt: (v: number) => string;
  log: boolean;
}

/**
 * A linear scale over [lo, hi] onto [r0, r1]. `nice` widens the domain to the outer ticks
 * (the default; pass false to keep the data's own ends, e.g. a 0–100% axis).
 */
export function linear(lo: number, hi: number, r0: number, r1: number, o: { count?: number; nice?: boolean } = {}): Scale {
  if (!(hi > lo)) { const c = Number.isFinite(lo) ? lo : 0; lo = c - (c ? Math.abs(c) * 0.5 : 1); hi = c + (c ? Math.abs(c) * 0.5 : 1); }
  const count = o.count ?? 5;
  const s = scaleLinear().domain([lo, hi]).range([r0, r1]);
  if (o.nice !== false) s.nice(count);
  const ticks = s.ticks(count);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : Math.abs(hi - lo);
  const f = (v: number) => s(v);
  return Object.assign(f, { domain: s.domain() as [number, number], range: [r0, r1] as [number, number], ticks, fmt: tickFormat(step), log: false });
}

/**
 * A log₁₀ scale over [lo, hi] (both > 0). Ticks at powers of ten; with under three decades, 2 and 5
 * between them as well, and under one decade the plain steps, so a short range still has labels.
 * `nice` (the default) widens the domain to whole decades.
 */
export function log(lo: number, hi: number, r0: number, r1: number, o: { nice?: boolean } = {}): Scale {
  lo = Math.max(lo, 1e-300); if (!(hi > lo)) hi = lo * 10;
  const s = scaleLog().domain([lo, hi]).range([r0, r1]);
  if (o.nice !== false) s.nice();
  const [d0, d1] = s.domain();
  const decades = Math.log10(d1 / d0);
  const all = s.ticks();
  const keep = decades > 6 ? (t: number) => isPow10(t) && Math.round(Math.log10(t)) % Math.ceil(decades / 6) === 0
    : decades >= 3 ? isPow10
    : (t: number) => [1, 2, 5].includes(lead(t));
  // under a decade, the round linear steps within it (0.6, 0.8, 1, 1.2 …)
  const ticks = decades < 1 ? scaleLinear().domain([d0, d1]).ticks(5) : all.filter(keep);
  const f = (v: number) => s(v);
  return Object.assign(f, { domain: [d0, d1] as [number, number], range: [r0, r1] as [number, number], ticks,
    fmt: (v: number) => v >= 1e5 && isPow10(v) ? "10" + sup(Math.round(Math.log10(v))) : fmtNum(v), log: true });
}

/**
 * A log-like scale that also takes zero (and negatives): for counts, where 0 is common and the rest
 * spans decades. Ticks at 0 and powers of ten.
 */
export function symlog(lo: number, hi: number, r0: number, r1: number): Scale {
  const s = scaleSymlog().domain([lo, hi]).range([r0, r1]);
  const ticks = [0];
  for (let p = 1; p <= Math.max(1, hi); p *= 10) ticks.push(p);
  const top = ticks[ticks.length - 1];
  if (top < hi) ticks.push(top * 10);
  const dom: [number, number] = [lo, Math.max(hi, ticks[ticks.length - 1])];
  s.domain(dom);
  const f = (v: number) => s(v);
  return Object.assign(f, { domain: dom, range: [r0, r1] as [number, number], ticks: ticks.filter((t) => t >= lo),
    fmt: (v: number) => v >= 1e5 ? "10" + sup(Math.round(Math.log10(v))) : fmtNum(v), log: true });
}

const isPow10 = (t: number) => Math.abs(Math.log10(t) - Math.round(Math.log10(t))) < 1e-9;
const lead = (t: number) => Math.round(t / 10 ** Math.floor(Math.log10(t) + 1e-9));
// Plex has no superscript minus, so only positive exponents are written this way
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (n: number) => String(n).split("").map((c) => SUP[c] ?? c).join("");
