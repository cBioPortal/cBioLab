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

/**
 * A variant allele frequency as cbioportal.org writes it (getFormattedFrequencyValue,
 * TumorAlleleFreqColumnFormatter.tsx): 4 decimals below 0.01, else 2 — 0.0098 → "0.0098", 0.1754 → "0.18".
 */
export function portalVaf(f: number): string {
  return f < 0.01 ? f.toFixed(4) : f.toFixed(2);
}

/**
 * A share of a Study View chart (0–100), as cbioportal.org writes it (`getFrequencyStr`,
 * StudyViewUtils.tsx): "0%", one decimal, "99.9%" for anything from 99.9 up to but short of 100,
 * "<0.1%" below a tenth, "NA" when negative or not a number.
 */
export function portalFreq(pct: number): string {
  if (!(pct >= 0)) return "NA";
  if (pct === 0) return "0%";
  if (pct < 100 && pct >= 99.9) return "99.9%";
  return pct >= 0.1 ? pct.toFixed(1) + "%" : "<0.1%";
}

/**
 * An oncoprint track's altered percent, `100 * (altered / profiled)` as the portal computes it, as
 * its gutter and gap labels show it: OncoprintUtils percentAltered writes one decimal below 3%
 * and an integer from there, and the track-info view parses that and
 * rounds it again to an integer, "<1" between 0 and 1 (oncoprinttrackinfoview 80-97). Ours alone:
 * a percent above 0 is never "0%" (the portal prints 1 of 2,500 as "0%"); it is "<1%". Nothing
 * profiled (null) is "N/P".
 */
export function portalTrackPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "N/P";
  const shown = parseFloat(pct < 3 ? pct.toFixed(1) : pct.toFixed());
  return shown < 1 && pct > 0 ? "<1%" : Math.round(shown) + "%";
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
 * A p- or q-value as cBioPortal's Comparison tables write it, toConditionalPrecisionWithMinimum(x, 3,
 * 0.01, -10) (FormatUtils.tsx:102): "< 10^-10" for 0 or anything below 1e-10, else as portalP.
 */
export const portalPMin = (p: number): string => p === 0 || (p > 0 && Math.log10(p) < -10) ? "< 10^-10" : portalP(p);

/** An altered share (0–1) as cBioPortal's Genomic Alterations table writes it: a percentage to 2 decimals (EnrichmentsUtil, toFixed(2)), "12.28%". */
export const portalAlteredPct = (f: number): string => (f * 100).toFixed(2) + "%";

/**
 * A correlation coefficient as cBioPortal's Plots tab writes it: `toFixed(2)`, an ASCII hyphen for
 * the sign (cbioportal-frontend ScatterPlot.tsx correlationInfo, PLT-STM-4; −0.05509 → "-0.06").
 */
export const portalCorr = (r: number): string => r.toFixed(2);

/**
 * A regression line as cBioPortal's Plots tab labels it (regression@2.0.1 linear's `string`,
 * PLT-STM-7): "y = -0.1x + 11.91", or "y = 0.5x" when the intercept is 0, the numbers as JavaScript
 * prints them after rounding. A negative intercept reads "- 1.2", where the portal prints "+ -1.2".
 */
export function portalEquation(slope: number, intercept: number): string {
  const n = (x: number) => String(x === 0 ? 0 : x);
  if (intercept === 0) return "y = " + n(slope) + "x";
  return "y = " + n(slope) + "x " + (intercept < 0 ? "- " + n(-intercept) : "+ " + n(intercept));
}

/**
 * A Kaplan–Meier median with its 95% interval as cBioPortal's survival summary writes it
 * (SurvivalUtil.getMedian): months to 2 decimals, an end the band never reaches "NA" —
 * "62.79 (56.25 - NA)", "65.85 (51.48 - 80.20)", "NA" when the median is not reached.
 */
export function portalMedianCi(median: number | null, lo: number | null, hi: number | null): string {
  if (median == null) return "NA";
  if (lo == null && hi == null) return median.toFixed(2);
  return median.toFixed(2) + " (" + (lo == null ? "NA" : lo.toFixed(2)) + " - " + (hi == null ? "NA" : hi.toFixed(2)) + ")";
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

/** a 95% confidence interval, each end in the estimate's own format: "95% CI 1.01–1.50" */
export const fmtCI95 = (lo: number, hi: number, f: (n: number) => string = fmtRatio): string => "95% CI " + f(lo) + "–" + f(hi);

/** an estimate with its 95% interval: "1.23 (95% CI 1.01–1.50)" */
export const fmtEstimateCI = (est: number, lo: number, hi: number, f: (n: number) => string = fmtRatio): string =>
  f(est) + " (" + fmtCI95(lo, hi, f) + ")";

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

/**
 * A number in an oncoprint tooltip, as the portal writes it (TooltipUtils): two decimals, with a
 * clinical value's ".00" dropped ("12", "2.45"); a heatmap value keeps them ("1.00").
 */
export function portalTipNumber(x: number, clinical = true): string {
  const s = x.toFixed(2);
  return clinical && s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** a value carried as float32, at the seven significant digits it holds ("2.446799", not 2.4467992782592773) */
export const fmtFloat32 = (x: number): string => String(Number(x.toPrecision(7)));

/** a number to `d` places, as the portal's `toFixed(d)` writes it, with a hyphen for minus ("-0.3317") */
export const portalFixed = (x: number, d: number): string => x.toFixed(d);

/** a number as the portal's bare `toLocaleString()` writes it in an en-US browser: separators, three decimals at most ("1,234.568") */
export const portalLocale = (x: number): string => x.toLocaleString("en-US");

/**
 * A bin's span as the portal's formatRange(min, max) writes it (StudyViewUtils.tsx:649-673): one
 * value when the ends agree, else "(min, max]" ("(3, 4]", "(1.609, 1.792]").
 */
export const portalRange = (min: number, max: number): string =>
  min === max ? portalLocale(min) : "(" + portalLocale(min) + ", " + portalLocale(max) + "]";

/**
 * A filtered table's samples and patients as the portal's reset panel writes them (PatientSampleSummary):
 * "3 samples / 2 patients", or one count for both when they are equal, "5 samples/patients".
 */
export function portalKeptUnits(samples: number, patients: number): string {
  if (samples !== patients) return samples + (samples === 1 ? " sample" : " samples") + " / " + patients + (patients === 1 ? " patient" : " patients");
  return samples + (samples === 1 ? " sample/patient" : " samples/patients");
}
