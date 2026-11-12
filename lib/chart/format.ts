// THE number formats for figures and the tables beside them. One rule per kind of number, so a
// p-value, a percentage or a count reads the same in every view, and in the HTML beside it.

/** a count: 12,345 */
export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");

/**
 * A measured value at three significant figures, with thousands separators and no trailing
 * zeros: 44.85 → "44.9", 0.000123 → "0.000123", 1234567 → "1,234,567", 1.2e-7 → "1.2e-7".
 */
export function fmtNum(n: number, sig = 3): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "−∞" : "–";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 10 ** sig) return minus(Math.round(n).toLocaleString("en-US"));
  if (a < 1e-4) return minus(trimExp(n.toExponential(Math.max(0, sig - 2))));
  return minus(trimZeros(n.toPrecision(sig)));
}

/** a percentage given as 0–100: one decimal, "<0.1%" for a sliver, never "0%" for something */
export function fmtPct(pct: number, decimals = 1): string {
  if (!Number.isFinite(pct)) return "–";
  if (pct === 0) return "0%";
  const floor = 10 ** -decimals;
  if (Math.abs(pct) < floor) return (pct < 0 ? "−" : "") + "<" + floor + "%";
  if (pct === 100) return "100%";
  return minus(pct.toFixed(decimals)) + "%";
}

/** a share given as 0–1, as a percentage */
export const fmtShare = (f: number, decimals = 1): string => fmtPct(f * 100, decimals);

/**
 * A p- or q-value as cBioPortal's enrichment tables write it (toConditionalPrecision(x, 3, 0.01)):
 * from 1e-6 up to 0.01 in exponent form with three decimals ("1.235e-4"), otherwise to three
 * significant digits ("0.0123", "1.23e-12", "0.00" for an underflowed zero).
 */
export function portalP(p: number): string {
  if (!Number.isFinite(p)) return "–";
  return 0.000001 <= p && p < 0.01 ? p.toExponential(3) : p.toPrecision(3);
}

/**
 * A value at two significant digits, as cBioPortal's FormatUtils.formatNumberValueInSignificantDigits(x, 2)
 * writes it for the mutation table's SIGNAL and gnomAD frequencies: no exponent, no separators,
 * 0 as "0" (0.0000583 → "0.000058", 0.125 → "0.13", 1234 → "1200").
 */
export const portalSig2 = (x: number): string => x === 0 ? "0" : String(Number(x.toLocaleString("en-US", { maximumSignificantDigits: 2 }).replace(/,/g, "")));

/**
 * A share given as 0–1, as cBioPortal's FormatUtils.formatPercentValue writes it: one decimal and
 * no % sign, "< 0.1" when it rounds to nothing, "-" when missing (0.0234 → "2.3", 0 → "0.0").
 */
export function portalPct(f: number | null): string {
  if (f == null || Number.isNaN(f)) return "-";
  const fixed = (f * 100).toFixed(1);
  return f !== 0 && Number(fixed) === 0 ? "< 0.1" : fixed;
}

/**
 * A p- or q-value's digits: two decimals at 0.1 and up, two significant figures down to 0.001,
 * then scientific; below the double-precision floor it is "<1e-300", never "0".
 */
export function pDigits(p: number): string {
  if (!Number.isFinite(p)) return "–";
  if (p <= 1e-300) return "<1e-300";
  if (p >= 0.1) return p.toFixed(2);
  if (p >= 0.001) return trimZeros(p.toPrecision(2));
  return trimExp(p.toExponential(1));
}

/** "p = 0.012", "p = 3.4e-7", "p < 1e-300" */
export const fmtP = (p: number, name = "p"): string => {
  const d = pDigits(p);
  return d.startsWith("<") ? name + " < " + d.slice(1) : name + " = " + d;
};
export const fmtQ = (q: number): string => fmtP(q, "q");

/** a ratio (hazard, odds): two decimals, so an estimate and its interval line up */
export const fmtRatio = (r: number): string => Number.isFinite(r) && r >= 0.01 && r < 100 ? r.toFixed(2) : fmtNum(r, 2);

/** months, to one decimal: "37.2 mo" */
export const fmtMonths = (m: number): string => (Math.round(m * 10) / 10).toLocaleString("en-US") + " mo";

/** a confidence interval: "[1.2–3.4]" */
export const fmtCI = (lo: number, hi: number, f: (n: number) => string = fmtNum): string => "[" + f(lo) + "–" + f(hi) + "]";

/** tick labels for one axis: the same number of decimals on every tick, read off the step */
export function tickFormat(step: number): (n: number) => string {
  const dec = step > 0 && step < 1 ? Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
  const big = step >= 1e6;
  return (n: number) => {
    if (big) return minus(trimZeros((n / 1e6).toFixed(Math.max(0, Math.ceil(-Math.log10(step / 1e6) - 1e-9)))) + "M");
    return minus(n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
  };
}

const minus = (s: string) => s.replace(/^-/, "−");
const trimZeros = (s: string) => s.includes(".") && !s.includes("e") ? s.replace(/\.?0+$/, "") : s;
const trimExp = (s: string) => s.replace(/\.0+e/, "e").replace(/(\.\d*?)0+e/, "$1e").replace("e+", "e");
