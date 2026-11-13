// THE oncoprint style: every visual decision as data, plus the three pure functions that
// turn a cell code into fills. Every renderer — server SVG, browser canvas, MCP-App canvas,
// the Python package (via the generated python/cohortlab/style.json) — reads this and draws
// what it says. A renderer knows how to fill a rectangle; it does not know what red means.
//
// Changing a colour, a band, the mutation display priority or a legend label here changes it
// everywhere at once. `npm run style:gen` regenerates the Python copy; a unit test fails on drift.

export const STYLE = {
  version: 3,
  bits: {
    MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16,
    SV: 32, AMP: 64, HOMDEL: 128,
    DRIVER: 256,      // some alteration in the cell is annotated (putative) driver: the gutter's driver %, the sort
    PROMOTER: 512,    // 5'Flank / promoter mutations, which the portal colours separately
    MRNA_HIGH: 1024, MRNA_LOW: 2048, PROT_HIGH: 4096, PROT_LOW: 8192,
    MUT_DRIVER: 16384, // the mutation classes in the cell are its driver mutations' (see the assembler)
    SV_DRIVER: 32768,  // the cell's structural variant is a driver
    GERMLINE: 65536,   // the mutation the cell shows is germline (the class and driver call drawn are a germline mutation's)
    CNA_DRIVER: 131072 // the cell's copy-number call is a driver
  },
  palette: {
    paper: "#ffffff", unaltered: "#bebebe", derived: "#0f86a1",
    text: "#1f2933", muted: "#5b6b76", groupLine: "#c9d2d8",
    categorical: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"],
    /**
     * A categorical oncoprint track's values: the portal's list (oncoprintjs makeUniqueColorGetter,
     * from D3), handed out in order to the values without a reserved colour; past its end a colour
     * already used comes back darkened (each channel × 0.95, once per pass).
     */
    clinical: ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477", "#66aa00", "#b82e2e", "#316395",
      "#994499", "#22aa99", "#aaaa11", "#6633cc", "#e67300", "#8b0707", "#651067", "#329262", "#5574a6", "#3b3eac", "#b77322",
      "#16d620", "#b91383", "#f4359e", "#9c5935", "#a9c413", "#2a778d", "#668d1c", "#bea413", "#0c5922", "#743411"],
    /**
     * Values that always take the same colour, whichever attribute holds them: the portal's
     * RESERVED_CLINICAL_VALUE_COLORS (shared/lib/Colors.ts). Keys are the value without spaces,
     * lower-cased, which is how a value is looked up (reservedColor), so "Yes", "YES" and
     * "Disease Free" / "DiseaseFree" all match as they do there.
     */
    reserved: {
      "true": "#1b9e77", "yes": "#1b9e77", "positive": "#1b9e77", "diseasefree": "#1b9e77", "tumorfree": "#1b9e77", "living": "#1b9e77",
      "alive": "#1b9e77", "notprogressed": "#1b9e77", "false": "#d95f02", "no": "#d95f02", "negative": "#d95f02", "recurred": "#d95f02",
      "progressed": "#d95f02", "recurred/progressed": "#d95f02", "withtumor": "#d95f02", "deceased": "#d95f02", "female": "#e0699e", "f": "#e0699e",
      "male": "#2986e2", "m": "#2986e2", "other": "#a9a9a9", "unknown": "#d3d3d3", "na": "#d3d3d3", "missense": "#008000",
      "inframe": "#993404", "truncating": "#000000", "fusion": "#8b00c9", "splice": "#e5802b", "promoter": "#00b7ce", "driver": "#008000",
      "vus": "#53d400", "1:deceased": "#d95f02", "1:recurred/progressed": "#d95f02", "1:recurred": "#d95f02", "1:progressed": "#d95f02", "1:yes": "#d95f02",
      "1:1": "#d95f02", "1:progression": "#d95f02", "1:event": "#d95f02", "1:deadofmelanoma": "#d95f02", "1:deadwithtumor": "#d95f02", "1:metastaticrelapse": "#d95f02",
      "1:localizedrelapse": "#d95f02", "0:living": "#1b9e77", "0:alive": "#1b9e77", "0:diseasefree": "#1b9e77", "0:no": "#1b9e77", "0:0": "#1b9e77",
      "0:progressionfree": "#1b9e77", "0:noprogression": "#1b9e77", "0:notprogressed": "#1b9e77", "0:censored": "#1b9e77", "0:censor": "#1b9e77", "0:aliveorcensored": "#1b9e77",
      "0:aliveordeadtumorfree": "#1b9e77", "0:norelapse": "#1b9e77", "0:censure": "#1b9e77", "0:ned": "#1b9e77", "wildtype": "#bebebe", "nomutation": "#bebebe",
      "amplification": "#ff0000", "gain": "#ffb6c1", "diploid": "#bebebe", "unchanged": "#bebebe", "loss": "#8fd8d8", "shallowdeletion": "#8fd8d8",
      "deepdeletion": "#0000ff"
    } as Record<string, string>
  },
  // A gene cell is drawn as layers, bottom to top: base, CNA (full height), mRNA (an outline
  // around the whole cell), protein (bars at top and bottom), SV (inset band), one mutation
  // (centre band, chosen by priority). Colours, bands and stacking are the portal's
  // (cbioportal-frontend geneticrules.ts and AlterationColors.ts), so a cell reads the same way
  // in both tools.
  //
  // A mutation and a structural variant each have two colours, `color` for a putative driver
  // and `vus` for unknown significance, chosen by that glyph's own driver bit; the pairs differ
  // in hue as well as lightness, so a VUS is a different colour rather than a faded one. A copy
  // number change has one colour whatever its annotation, as in the portal.
  glyph: {
    cna: { band: [0, 1] as [number, number], options: [
      { bit: "AMP", color: "#ff0000", label: "Amplification", order: 10 },
      { bit: "HOMDEL", color: "#0000ff", label: "Deep Deletion", order: 12 }
    ] },
    // mRNA is an outline rather than a fill so it can coexist with a CNA colour underneath
    mrna: { band: [0, 1] as [number, number], stroke: 2, options: [
      { bit: "MRNA_HIGH", color: "#ff9999", label: "mRNA High", order: 20 },
      { bit: "MRNA_LOW", color: "#6699cc", label: "mRNA Low", order: 21 }
    ] },
    protein: { options: [
      { bit: "PROT_HIGH", band: [0, 0.2] as [number, number], color: "#ff3df8", label: "Protein High", order: 30 },
      { bit: "PROT_LOW", band: [0.8, 1] as [number, number], color: "#00e1ff", label: "Protein Low", order: 31 }
    ] },
    sv: { band: [0.2, 0.8] as [number, number], bit: "SV", color: "#8b00c9", vus: "#ce92e8", label: "Structural Variant", order: 1 },
    // display priority when a cell carries several mutation classes (the portal's rule)
    mutation: { band: [1 / 3, 2 / 3] as [number, number], order: 0, priority: [
      { bit: "TRUNCATING", color: "#000000", vus: "#708090", label: "Truncating Mutation" },
      { bit: "SPLICE", color: "#e5802b", vus: "#f0b87b", label: "Splice Mutation" },
      { bit: "INFRAME", color: "#993404", vus: "#a68028", label: "Inframe Mutation" },
      { bit: "PROMOTER", color: "#00b7ce", vus: "#8cedf9", label: "Promoter Mutation" },
      { bit: "MISSENSE", color: "#008000", vus: "#53d400", label: "Missense Mutation" },
      { bit: "OTHER_MUT", color: "#cf58bc", vus: "#f96ae3", label: "Other Mutation" }
    ],
    /** one colour for every class, used when a figure turns colour-by-type off */
    single: { color: "#008000", vus: "#53d400", label: "Mutation" } },
    // a germline mutation: a thin white stripe across the mutation glyph (the portal's geneticrules.ts germline_rule_params)
    germline: { bit: "GERMLINE", color: "#ffffff", band: [0.46, 0.54] as [number, number], label: "Germline Mutation", show: true },
    /** what a legend entry adds when a glyph's driver and VUS colours differ */
    driverLabels: { driver: " (putative driver)", vus: " (unknown significance)" },
    /** a numeric track drawn as bars (the portal's bar rule: green up from the bottom of the cell) */
    bar: { color: "#008000", negative: "#ff0000" },
    /**
     * The mutation spectrum row: each column a bar of its single-base substitutions, stacked in
     * this order and sized by their share (the portal's MUTATION_SPECTRUM_CATEGORIES and _FILLS)
     */
    spectrum: { label: "Mutation spectrum", categories: ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"],
      colors: ["#3D6EB1", "#8EBFDC", "#DFF1F8", "#FCE08E", "#F78F5E", "#D62B23"] },
    /** the "Profiled for <type>" rows: the portal's reserved colour for "yes"; "no" is drawn as no data */
    profiled: { color: "#1b9e77", yes: "Yes", no: "No" },
    notProfiled: { fill: "#ffffff", stripe: { color: "#bebebe", band: [0.475, 0.525] as [number, number] }, label: "Not profiled" },
    unalteredLabel: "No alterations"
  },
  ramps: {
    sequential: { from: [222, 235, 247], to: [8, 72, 135] },            // #deebf7 -> #084887
    diverging: { low: [33, 102, 172], mid: [255, 255, 255], high: [178, 24, 43] },  // #2166ac -> white -> #b2182b
    // the portal's heatmap rows (getHeatmapTrackRuleSetParams): colours at value stops
    expression: { stops: [-3, 0, 3], colors: [[0, 0, 255], [0, 0, 0], [255, 0, 0]] },
    methylation: { stops: [0, 0.35, 1], colors: [[0, 0, 255], [255, 255, 255], [255, 0, 0]] },
    vaf: { stops: [0, 1], colors: [[241, 242, 181], [19, 80, 88]] },
    // an altered % (0-100) on a pathway diagram's gene node: PathwayMapper's own scale (GenomicDataOverlayManager),
    // white to red on log(1 + %), reaching `reach` of the way at 100% so a frequent gene is never solid red
    frequency: { from: [255, 255, 255], to: [255, 0, 0], reach: 0.8 }
  },
  // A mutational spectrum's channel colours, the portal's (cbioportal-frontend
  // MutationalSignatureBarChartUtils.ts colorMap): SBS by substitution class, DBS by reference
  // dinucleotide, ID by length, deletion or insertion and repeat type (lengths of 5 and more share
  // the "5" colour). Where the portal's list names a class twice (CG), the later entry is the one
  // it draws. A channel in none of these is drawn in `unknown`.
  signatures: {
    sbs: { "C>A": "#5DADE2", "C>G": "#154360", "C>T": "red", "T>A": "#99A3A4", "T>C": "#2ECC71", "T>G": "#F5B7B1" } as Record<string, string>,
    dbs: { AC: "skyblue", AT: "blue", CC: "lightgreen", CG: "darkred", CT: "pink", GC: "gold", TA: "#FF7F50", TC: "orange", TG: "#ba55D3", TT: "purple" } as Record<string, string>,
    id: {
      "1:Del:C": "#f39c12", "1:Del:T": "#d68910", "1:Ins:C": "#82e0aa", "1:Ins:T": "#28b463",
      "2:Del:R": "#f1948a", "3:Del:R": "#ec7063", "4:Del:R": "#e74c3c", "5:Del:R": "#F7406C",
      "2:Ins:R": "#33ffff", "3:Ins:R": "#aed6F1", "4:Ins:R": "#5dade2", "5:Ins:R": "#368BFD",
      "2:Del:M": "#D2B7F2", "3:Del:M": "#E194EB", "4:Del:M": "#DD75EA", "5:Del:M": "#DB3AEE",
      "2:Ins:M": "#aed6f1", "3:Ins:M": "#85c1e9", "4:Ins:M": "#85c1e9", "5:Ins:M": "#3498db"
    } as Record<string, string>,
    unknown: "#EE4B2B"
  },
  geometry: { rowH: 20, rowGap: 3, gutter: 168, groupGap: 10, header: 22, labelMaxChars: 17,
    // whitespace between columns: a hairline of this many px, once a column is padMinZoom px wide
    cellPad: 1, padMinZoom: 6,
    // a row pooling several genes wears the brackets that made it, the way the query spells it
    mergedBrackets: ["[", "]"] },
  percent: { label: "portal", tooltip: "portal" }   // label (gutter, gaps): 0%, <1%, else integer; tooltip: integer at 3 % and above, one decimal below; N/P
};

// Deliberately not `as const`: a resolved override is the same shape with different values,
// so the type has to admit any colour, not only the default one.
export type Style = typeof STYLE;
export type Rgb = readonly [number, number, number];
export interface Layer {
  color: string; band: readonly [number, number];
  /** when set, draw an outline of this many pixels instead of a filled band */
  stroke?: number;
}

/**
 * Fills for one gene cell, bottom to top, as fractions of the row height.
 * Self-contained on purpose (no closure over module state) so its source can be
 * embedded verbatim in the MCP-App document.
 */
export function cellLayers(code: number, S: Style): Layer[] {
  const G = S.glyph, B = S.bits as Record<string, number>;
  if (code === -1) return [{ color: G.notProfiled.fill, band: [0, 1] }, { color: G.notProfiled.stripe.color, band: G.notProfiled.stripe.band }];
  const out: Layer[] = [{ color: S.palette.unaltered, band: [0, 1] }];
  if (code <= 0) return out;
  for (const o of G.cna.options) if (code & B[o.bit]) { out.push({ color: o.color, band: G.cna.band }); break; }
  for (const o of G.mrna.options) if (code & B[o.bit]) { out.push({ color: o.color, band: G.mrna.band, stroke: G.mrna.stroke }); break; }
  for (const o of G.protein.options) if (code & B[o.bit]) out.push({ color: o.color, band: o.band });
  if (code & B[G.sv.bit]) out.push({ color: code & B.SV_DRIVER ? G.sv.color : G.sv.vus, band: G.sv.band });
  for (const m of G.mutation.priority) if (code & B[m.bit]) {
    out.push({ color: code & B.MUT_DRIVER ? m.color : m.vus, band: G.mutation.band });
    if (code & B[G.germline.bit] && G.germline.show) out.push({ color: G.germline.color, band: G.germline.band });
    break;
  }
  return out;
}

const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);
const rgb = (c: number[]): string => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";

/** Colour for a 0..255 numeric cell: diverging around `center` when given, else sequential. */
export function numericColor(v: number, center: number | null | undefined, S: Style = STYLE): string {
  if (center == null) {
    const t = Math.max(0, Math.min(1, v / 255)), a = S.ramps.sequential.from, b = S.ramps.sequential.to;
    return rgb([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
  }
  const { low, mid, high } = S.ramps.diverging;
  if (v <= center) { const t = center ? v / center : 1; return rgb([lerp(low[0], mid[0], t), lerp(low[1], mid[1], t), lerp(low[2], mid[2], t)]); }
  const t = (v - center) / (255 - center || 1);
  return rgb([lerp(mid[0], high[0], t), lerp(mid[1], high[1], t), lerp(mid[2], high[2], t)]);
}

/** A value on one of the portal's heatmap ramps: linear between its stops, clamped at the ends. */
export function rampColor(ramp: { stops: number[]; colors: number[][] }, v: number): string {
  const { stops, colors } = ramp;
  if (v <= stops[0]) return rgb(colors[0]);
  for (let i = 1; i < stops.length; i++) if (v <= stops[i]) {
    const t = (v - stops[i - 1]) / (stops[i] - stops[i - 1] || 1), a = colors[i - 1], b = colors[i];
    return rgb([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
  }
  return rgb(colors[colors.length - 1]);
}

/** A numeric cell's colour: its heatmap ramp when it has one, the generic ramps otherwise. */
export function heatColor(t: NumericScale & { ramp?: "expression" | "methylation" | "vaf"; center?: number | null }, code: number, S: Style = STYLE): string {
  return t.ramp ? rampColor(S.ramps[t.ramp], numericValue(t, code)) : numericColor(code, t.center, S);
}

/** Colour for an altered % (0..100) on a pathway diagram's gene node, as hex (so `textOn` can pick its ink). */
export function frequencyColor(pct: number, S: Style = STYLE): string {
  const { from, to, reach } = S.ramps.frequency;
  const p = Math.max(0, Math.min(100, pct));
  const t = (Math.log(1 + p) / Math.log(101)) * reach;
  return "#" + [0, 1, 2].map((i) => lerp(from[i], to[i], t).toString(16).padStart(2, "0")).join("");
}

// ---- numeric cells: a value scaled to a 0..255 code over the track's min..max -----------------
// `logScale` scales log(value + shift) instead, shift = |min| + 1, as the portal does for counts
// that span orders of magnitude.

export interface NumericScale { min?: number; max?: number; logScale?: boolean }
const logShift = (min: number): number => Math.abs(min) + 1;

/** The 0..255 code for value `x` on a track scaled over min..max. */
export function encodeNumeric(x: number, min: number, max: number, logScale = false): number {
  if (logScale) {
    const s = logShift(min), lo = Math.log(min + s), span = Math.log(max + s) - lo || 1;
    return Math.round(255 * (Math.log(x + s) - lo) / span);
  }
  return Math.round(255 * (x - min) / (max - min || 1));
}

/** The value a numeric cell's code stands for (approximately: the code has 256 steps). */
export function numericValue(t: NumericScale, code: number): number {
  const min = t.min ?? 0, max = t.max ?? 1, f = code / 255;
  if (t.logScale) { const s = logShift(min), lo = Math.log(min + s); return Math.exp(lo + f * (Math.log(max + s) - lo)) - s; }
  return min + f * (max - min);
}

/**
 * Where a bar sits in its cell, as fractions of the row height: the portal's bar rule. All values
 * at or above zero grow up from the bottom; all at or below zero hang down from the top, in the
 * negative colour; a range spanning zero grows both ways from the middle, scaled by the larger side.
 */
export function barBand(t: NumericScale, code: number): { band: [number, number]; negative: boolean } {
  const min = t.min ?? 0, max = t.max ?? 1, f = code / 255;
  if (min >= 0 || t.logScale) return { band: [1 - f, 1], negative: false };
  if (max <= 0) return { band: [0, 1 - f], negative: true };
  const v = numericValue(t, code), r = v / Math.max(-min, max);
  return v >= 0 ? { band: [0.5 - 0.5 * r, 0.5], negative: false } : { band: [0.5, 0.5 - 0.5 * r], negative: true };
}

export function categoryColor(i: number, S: Style = STYLE): string { return S.palette.categorical[i % S.palette.categorical.length]; }

/** The portal's percent format: integer at 3 % and above, one decimal below, N/P when nothing is profiled. */
export function formatPct(p: number | null | undefined): string {
  if (p == null) return "N/P";
  return (p < 3 ? Math.round(p * 10) / 10 : Math.round(p)) + "%";
}
/**
 * The portal's track-label percent (ONC-LY-4): "0%", "<1%" above 0 and under 1, otherwise an
 * integer; N/P when nothing was profiled. Gap labels use it too (ONC-STM-3).
 */
export function formatLabelPct(p: number | null | undefined): string {
  if (p == null) return "N/P";
  if (p === 0) return "0%";
  return p < 1 ? "<1%" : Math.round(p) + "%";
}
export interface GutterCounts { altered?: number; driverAltered?: number; profiled?: number; freqPct?: number | null; driverPct?: number | null }
/**
 * Gutter frequency: "driver% / any%", each in the portal's label format, from the counts when the
 * track has them (the 1-decimal % otherwise); N/P when nothing was profiled, and the portal's
 * asterisk when the denominator is smaller than the number of columns.
 */
export function formatGutterPct(t: GutterCounts, columns?: number): string {
  const pct = (n: number | undefined, p: number | null | undefined) => n != null && t.profiled ? 100 * n / t.profiled : p;
  const any = pct(t.altered, t.freqPct);
  if (any == null) return "N/P";
  const driver = pct(t.driverAltered, t.driverPct);
  const star = t.profiled != null && columns != null && t.profiled > 0 && t.profiled < columns ? "*" : "";
  return (driver != null ? formatLabelPct(driver) + " / " : "") + formatLabelPct(any) + star;
}
export const PARTIAL_PROFILE_NOTE = "* = % over the columns profiled for that gene";

/**
 * Two columns of a stacked row (the mutation spectrum), as the portal's counts comparator orders
 * them (makeCountsMapClinicalComparator): the column whose largest category comes earlier in the
 * list first, then the smaller share of that category. `values` holds k counts per column.
 */
export function stackCompare(values: ArrayLike<number>, k: number, x: number, y: number): number {
  const top = (c: number) => { let m = 0, tot = 0; for (let j = 0; j < k; j++) { const v = values[c * k + j]; tot += v; if (v > values[c * k + m]) m = j; } return { m, share: tot ? values[c * k + m] / tot : 0 }; };
  const a = top(x), b = top(y);
  return a.m !== b.m ? a.m - b.m : Math.sign(a.share - b.share);
}

/** The staircase's switches, the portal's Sort-menu toggles; left out, each is the portal's default. */
export interface StaircaseOptions { byType?: boolean; byDriver?: boolean; ignoreVus?: boolean }
/** a display's Sort switches as staircaseRank takes them (display.sortByMutationType, sortByDrivers, sortIgnoreVUS) */
export function staircaseOptions(d?: { sortByMutationType?: boolean; sortByDrivers?: boolean; sortIgnoreVUS?: boolean }): StaircaseOptions {
  return { byType: d?.sortByMutationType ?? true, byDriver: d?.sortByDrivers ?? true, ignoreVus: d?.sortIgnoreVUS ?? false };
}
/** every staircaseRank is below this: structural variant 3 × copy number 5 × mutation 13 × germline, mRNA, protein 3 each */
export const STAIRCASE_RADIX = 3 * 5 * 13 * 3 * 3 * 3;

/**
 * A gene row's cell, ranked as the portal's staircase ranks it (ONC-ST-2; its SortUtils
 * getGeneticTrackSortComparator), smaller first: structural variant, then copy number, then
 * mutation, germline, mRNA and protein, each its own key. With the driver switch on, a driver
 * comes before every VUS of its kind (a driver missense before a VUS truncation); with the type
 * switch, mutations follow the glyph priority; Ignore VUS ranks a VUS as no alteration.
 */
export function staircaseRank(c: number, o: StaircaseOptions = {}, S: Style = STYLE): number {
  const B = S.bits, byType = o.byType ?? true, byDriver = o.byDriver ?? true, ignoreVus = !!o.ignoreVus;
  const v = c > 0 ? c : 0;
  const sv = !(v & B.SV) ? 2 : v & B.SV_DRIVER ? 0 : ignoreVus ? 2 : byDriver ? 1 : 0;
  const level = v & B.AMP ? 0 : v & B.HOMDEL ? 1 : -1, cnaDrv = !!(v & B.CNA_DRIVER);
  const cna = level < 0 ? 4 : cnaDrv ? level : ignoreVus ? 4 : byDriver ? 2 + level : level;
  const cls = S.glyph.mutation.priority.findIndex((m) => v & B[m.bit as keyof typeof B]), mutDrv = !!(v & B.MUT_DRIVER);
  const counted = cls >= 0 && (mutDrv || !ignoreVus);
  const mut = !counted ? 12 : ignoreVus ? (byType ? cls : 0)
    : byType ? (byDriver && !mutDrv ? 6 + cls : cls) : (byDriver && !mutDrv ? 1 : 0);
  const germ = counted ? (v & B.GERMLINE ? 0 : 1) : 2;
  const mrna = v & B.MRNA_HIGH ? 0 : v & B.MRNA_LOW ? 1 : 2;
  const prot = v & B.PROT_HIGH ? 0 : v & B.PROT_LOW ? 1 : 2;
  return ((((sv * 5 + cna) * 13 + mut) * 3 + germ) * 3 + mrna) * 3 + prot;
}

/**
 * A case id as oncoprintjs orders it (bucketsort.ts stringToVector): each run of digits one
 * number, every other character its char code, so "P2" < "P10" and "A00N" (65, …) < "3864".
 */
export function naturalVector(id: string): number[] {
  const out: number[] = [];
  let num = -1;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (c >= 48 && c <= 57) { num = num < 0 ? c - 48 : num * 10 + c - 48; continue; }
    if (num >= 0) { out.push(num); num = -1; }
    out.push(c);
  }
  if (num >= 0) out.push(num);
  return out;
}
/** left to right, the first difference decides; a vector that runs out first comes first */
export function compareVectors(a: number[], b: number[]): number {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

export function truncateLabel(label: string, S: Style = STYLE): string {
  const n = S.geometry.labelMaxChars;
  return label.length > n ? label.slice(0, n - 1) + "…" : label;
}

/**
 * What the gutter prints for a track. A merged gene row is bracketed, so a reader can see at a
 * glance that the row pools several genes rather than naming one — the brackets are the same
 * ones that spell the row in a query. The brackets are outside the truncation, so a long label
 * still ends in a closing bracket rather than losing it to the ellipsis.
 */
export function trackLabelText(track: { label: string; members?: string[] }, S: Style = STYLE): string {
  const [open, close] = S.geometry.mergedBrackets;
  if (!track.members || track.members.length < 2) return truncateLabel(track.label, S);
  const n = Math.max(1, S.geometry.labelMaxChars - open.length - close.length);
  return open + (track.label.length > n ? track.label.slice(0, n - 1) + "…" : track.label) + close;
}

/**
 * What a track's label means, in words, for a tooltip. One owner so the canvas figure and the
 * server SVG say the same thing about the same row — including the ones a gutter label cannot
 * fit: the full name, the genes a merged row pools, and what its percentage is over.
 */
export interface TrackSummary {
  label: string; members?: string[]; kind?: string; numeric?: boolean; categories?: string[];
  altered?: number; profiled?: number; driverAltered?: number;
  freqPct?: number | null; driverPct?: number | null;
  /** same shape, sliced to one column group — see Track.byGroup */
  byGroup?: { group: string; altered: number; profiled: number; freqPct: number | null; driverPct: number | null }[];
  min?: number; max?: number; profileType?: string; note?: string;
}
export function trackTooltipLines(t: TrackSummary, columns: number, unit = "patient"): string[] {
  const n = (x: number) => x.toLocaleString("en-US");
  const lines = [t.label];
  if (t.members && t.members.length > 1) lines.push("one row over " + t.members.length + " genes: " + t.members.join(" · "));
  if (t.freqPct != null && t.profiled != null && t.altered != null) {
    lines.push(n(t.altered) + " of " + n(t.profiled) + " profiled " + unit + "s altered (" + t.freqPct + "%)");
    if (t.driverPct != null && t.driverAltered != null) lines.push(n(t.driverAltered) + " putative driver (" + t.driverPct + "%)");
    // Pooled above, one group per line here — the same split the figure already draws
    // with a group boundary, not just a number pooled across all of them.
    if (t.byGroup) for (const g of t.byGroup)
      lines.push("  " + g.group + ": " + n(g.altered) + " of " + n(g.profiled) + " altered" + (g.freqPct != null ? " (" + g.freqPct + "%)" : ""));
    if (t.profiled < columns) lines.push("not profiled in " + n(columns - t.profiled) + " of " + n(columns) + " columns");
  } else if (t.numeric && t.min != null && t.max != null) {
    lines.push((t.profileType ? t.profileType + ", " : "") + t.min + " → " + t.max);
    if (t.note) lines.push(t.note);
  } else if (t.categories) {
    lines.push(t.categories.length ? t.categories.length + " values: " + t.categories.slice(0, 6).join(", ") +
      (t.categories.length > 6 ? ", …" : "") : "no values in these columns");
  }
  return lines;
}

export interface LegendItem { label: string; color: string; kind: "swatch" | "outline" | "notProfiled" | "germline" }

/**
 * What a figure's gene cells actually draw, for its legend: every bit present, and for the
 * mutation band and the SV band which entries appear as driver and which as VUS. The mutation
 * entry is the one `cellLayers` picks by priority, not every class a cell carries, so a legend
 * never lists a colour the figure does not show.
 */
export interface GlyphPresence { bits: number; mutDriver: number; mutVus: number; svDriver: boolean; svVus: boolean; germline?: boolean }
export function glyphPresence(tracks: readonly { kind: string; cells: ArrayLike<number> }[], S: Style = STYLE): GlyphPresence {
  const B = S.bits as Record<string, number>;
  const out: GlyphPresence = { bits: 0, mutDriver: 0, mutVus: 0, svDriver: false, svVus: false, germline: false };
  // altered cells take a handful of distinct codes; look each one up once
  const seen = new Set<number>();
  for (const t of tracks) {
    if (t.kind !== "gene") continue;
    const cs = t.cells;
    for (let i = 0; i < cs.length; i++) { const c = cs[i]; if (c > 0) seen.add(c); }
  }
  for (const c of seen) {
    out.bits |= c;
    if (c & B[S.glyph.sv.bit]) { if (c & B.SV_DRIVER) out.svDriver = true; else out.svVus = true; }
    for (const m of S.glyph.mutation.priority) if (c & B[m.bit]) {
      if (c & B.MUT_DRIVER) out.mutDriver |= B[m.bit]; else out.mutVus |= B[m.bit];
      if (c & B[S.glyph.germline.bit]) out.germline = true;
      break;
    }
  }
  return out;
}

/**
 * Gene-legend entries in display order, shared by every renderer. A glyph whose driver and VUS
 * colours differ gets an entry for each, labelled the way the portal labels them; one whose
 * colours are the same (driver annotation off) gets one. With `present`, only what the cells draw.
 */
export function geneLegend(S: Style = STYLE, present?: GlyphPresence): LegendItem[] {
  const B = S.bits as Record<string, number>, G = S.glyph, L = G.driverLabels;
  const items: LegendItem[] = [];
  const pair = (e: { color: string; vus: string; label: string }, drv: boolean, vus: boolean): void => {
    if (e.color === e.vus) { if (drv || vus) items.push({ label: e.label, color: e.color, kind: "swatch" }); return; }
    if (drv) items.push({ label: e.label + L.driver, color: e.color, kind: "swatch" });
    if (vus) items.push({ label: e.label + L.vus, color: e.vus, kind: "swatch" });
  };
  const has = (bit: string): boolean => !present || (present.bits & B[bit]) !== 0;
  for (const m of G.mutation.priority) pair(m, !present || (present.mutDriver & B[m.bit]) !== 0, !present || (present.mutVus & B[m.bit]) !== 0);
  if (G.germline.show && (!present || present.germline)) items.push({ label: G.germline.label, color: G.germline.color, kind: "germline" });
  pair(G.sv, !present || present.svDriver, !present || present.svVus);
  for (const o of G.cna.options) if (has(o.bit)) items.push({ label: o.label, color: o.color, kind: "swatch" });
  for (const o of G.mrna.options) if (has(o.bit)) items.push({ label: o.label, color: o.color, kind: "outline" });
  for (const o of G.protein.options) if (has(o.bit)) items.push({ label: o.label, color: o.color, kind: "swatch" });
  items.push({ label: G.notProfiled.label, color: G.notProfiled.stripe.color, kind: "notProfiled" });
  // colour-by-type off gives every mutation class one label and colour; list it once
  const seen = new Set<string>();
  return items.filter((it) => { const k = it.label + it.color; return seen.has(k) ? false : (seen.add(k), true); });
}

// ---- user overrides ---------------------------------------------------------
// A figure may carry a partial style in its spec (`display.style`). It is merged onto the
// defaults here, once, with loud validation — an unknown key or a bad colour is an error
// naming what is accepted, never a silently ignored setting. Keys that change *meaning*
// rather than appearance are refused: the bitmask, and which alteration a mixed cell shows.

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isColor = (v: unknown): boolean => typeof v === "string" && COLOR_RE.test(v);

function mergeInto(base: unknown, over: unknown, path: string): unknown {
  if (path === "bits" || path === "version")
    throw new Error("style." + path + " is read-only: it defines what a cell means, not how it looks");
  if (isPlain(base)) {
    if (!isPlain(over)) throw new Error("style." + path + " must be an object");
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) {
      if (!(k in base)) throw new Error("style." + (path ? path + "." : "") + k + " is not a style key (accepted here: " + Object.keys(base).join(", ") + ")");
      out[k] = mergeInto((base as Record<string, unknown>)[k], v, (path ? path + "." : "") + k);
    }
    return out;
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) throw new Error("style." + path + " must be an array");
    // glyph priorities are a meaning, not a look: the same bits must stay in the same order
    if (base.length && isPlain(base[0]) && "bit" in (base[0] as object)) {
      if (over.length !== base.length) throw new Error("style." + path + ": keep all " + base.length + " entries; only their colour and label may change");
      return base.map((b, i) => {
        const o = over[i];
        if (!isPlain(o)) throw new Error("style." + path + "[" + i + "] must be an object");
        if ("bit" in o && o.bit !== (b as Record<string, unknown>).bit)
          throw new Error("style." + path + "[" + i + "].bit is read-only: reordering alteration priority changes what a mixed cell means");
        return mergeInto(b, o, path + "[" + i + "]");
      });
    }
    for (const [i, v] of over.entries()) {
      if (isColor(base[0]) && !isColor(v)) throw new Error("style." + path + "[" + i + "]: '" + String(v) + "' is not a #rrggbb colour");
      if (typeof base[0] === "number" && typeof v !== "number") throw new Error("style." + path + "[" + i + "] must be a number");
    }
    return over.slice();
  }
  if (isColor(base) && !isColor(over)) throw new Error("style." + path + ": '" + String(over) + "' is not a #rrggbb colour");
  if (typeof base === "number" && typeof over !== "number") throw new Error("style." + path + " must be a number");
  if (typeof base === "boolean" && typeof over !== "boolean") throw new Error("style." + path + " must be true or false");
  if (typeof base === "string" && typeof over !== "string") throw new Error("style." + path + " must be a string");
  return over;
}

/** Defaults with `overrides` merged on top. Returns STYLE itself when there is nothing to merge. */
export function resolveStyle(overrides?: Record<string, unknown> | null): Style {
  if (!overrides || !Object.keys(overrides).length) return STYLE;
  const merged = mergeInto(STYLE, overrides, "") as Style;
  // not-profiled has to stay readable as a distinct state, whatever the palette says
  const np = merged.glyph.notProfiled;
  if (np.fill === merged.palette.unaltered && np.stripe.color === merged.palette.unaltered)
    throw new Error("style: not-profiled would be indistinguishable from unaltered — give glyph.notProfiled a different fill or stripe");
  return merged;
}

/** The portal's fixed colour for a clinical value ("Female", "1:DECEASED", "Unknown"), if it has one. */
export function reservedColor(value: string, S: Style = STYLE): string | undefined {
  return S.palette.reserved[value.replace(/\s/g, "").toLowerCase()];
}

/**
 * Colour for a categorical cell: a per-track override first
 * (`display.colors[trackLabel][value]` — the portal's Edit Colors), then the value's reserved
 * colour, then the palette's cycle.
 */
export function trackCategoryColor(track: { label: string; categories?: string[]; profiledFor?: string }, code: number, S: Style = STYLE,
  colors?: Record<string, Record<string, string>>): string {
  const value = track.categories && track.categories[code];
  const override = value != null && colors && colors[track.label] ? colors[track.label][value] : undefined;
  if (override) return override;
  if (track.profiledFor) return S.glyph.profiled.color;
  if (value == null) return categoryColor(code, S);
  const reserved = reservedColor(value, S);
  if (reserved) return reserved;
  // the k-th value without a reserved colour takes the k-th colour of the list
  let k = 0;
  for (let i = 0; i < code; i++) if (!reservedColor(track.categories![i], S)) k++;
  return clinicalColor(k, S);
}

/** the k-th colour the portal hands a categorical track's values: its list in order, darkened once per pass past its end */
export function clinicalColor(k: number, S: Style = STYLE): string {
  const list = S.palette.clinical;
  let c = list[k % list.length];
  for (let pass = Math.floor(k / list.length); pass > 0; pass--)
    c = "#" + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.95).toString(16).padStart(2, "0")).join("");
  return c;
}


/**
 * The style a figure draws with, given its viewing options. These change no number, so they
 * are applied here rather than threaded through every renderer:
 * - colour-by-type off: every mutation class takes the single colour pair and one label;
 * - annotation off: nothing is called a driver, so every glyph draws its driver colour and the
 *   legend has one entry per glyph — the portal's rule set without recurrence;
 * - white background: unaltered and not-profiled cells are white (not-profiled keeps its line);
 * - somatic vs germline off: a germline mutation draws without its stripe, and the legend drops it.
 */
export function styleForDisplay(S: Style, display?: { colorByType?: boolean; colorByGermline?: boolean; annotate?: string; whiteBackground?: boolean }): Style {
  let out = S;
  if (display?.colorByGermline === false) out = { ...out, glyph: { ...out.glyph, germline: { ...out.glyph.germline, show: false } } };
  if (display?.colorByType === false) {
    const one = out.glyph.mutation.single;
    out = { ...out, glyph: { ...out.glyph, mutation: { ...out.glyph.mutation,
      priority: out.glyph.mutation.priority.map((m) => ({ ...m, color: one.color, vus: one.vus, label: one.label })) } } };
  }
  if (display?.annotate === "none") {
    const G = out.glyph;
    out = { ...out, glyph: { ...G, sv: { ...G.sv, vus: G.sv.color },
      mutation: { ...G.mutation, priority: G.mutation.priority.map((m) => ({ ...m, vus: m.color })) } } };
  }
  if (display?.whiteBackground)
    out = { ...out, palette: { ...out.palette, unaltered: "#ffffff" }, glyph: { ...out.glyph, notProfiled: { ...out.glyph.notProfiled, fill: "#ffffff" } } };
  return out;
}
