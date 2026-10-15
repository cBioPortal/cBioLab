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
    SV_DRIVER: 32768   // the cell's structural variant is a driver
  },
  palette: {
    paper: "#ffffff", unaltered: "#bebebe", derived: "#0f86a1",
    text: "#1f2933", muted: "#5b6b76", groupLine: "#c9d2d8",
    categorical: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"]
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
    /** what a legend entry adds when a glyph's driver and VUS colours differ */
    driverLabels: { driver: " (putative driver)", vus: " (unknown significance)" },
    notProfiled: { fill: "#ffffff", stripe: { color: "#bebebe", band: [0.475, 0.525] as [number, number] }, label: "Not profiled" },
    unalteredLabel: "No alterations"
  },
  ramps: {
    sequential: { from: [222, 235, 247], to: [8, 72, 135] },            // #deebf7 -> #084887
    diverging: { low: [33, 102, 172], mid: [255, 255, 255], high: [178, 24, 43] }  // #2166ac -> white -> #b2182b
  },
  geometry: { rowH: 20, rowGap: 3, gutter: 168, groupGap: 10, header: 22, labelMaxChars: 17, cellPadMax: 3, padMinZoom: 3, padFraction: 0.3,
    // a row pooling several genes wears the brackets that made it, the way the query spells it
    mergedBrackets: ["[", "]"] },
  percent: { gutterDecimals: 1, runRule: "portal" }   // runRule: integer at 3 % and above, one decimal below, N/P
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
  for (const m of G.mutation.priority) if (code & B[m.bit]) { out.push({ color: code & B.MUT_DRIVER ? m.color : m.vus, band: G.mutation.band }); break; }
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

export function categoryColor(i: number, S: Style = STYLE): string { return S.palette.categorical[i % S.palette.categorical.length]; }

/** The portal's percent format: integer at 3 % and above, one decimal below, N/P when nothing is profiled. */
export function formatPct(p: number | null | undefined): string {
  if (p == null) return "N/P";
  return (p < 3 ? Math.round(p * 10) / 10 : Math.round(p)) + "%";
}
/**
 * Gutter frequency: "driver% / any%" at one decimal, N/P when nothing was profiled, and the
 * portal's asterisk when the denominator is smaller than the number of columns — a reader
 * should not have to work out that a percentage was taken over part of the cohort.
 */
export function formatGutterPct(driverPct: number | null | undefined, freqPct: number | null | undefined,
  profiled?: number, columns?: number): string {
  if (freqPct == null) return "N/P";
  const star = profiled != null && columns != null && profiled > 0 && profiled < columns ? "*" : "";
  return (driverPct != null ? driverPct + "% / " + freqPct + "%" : freqPct + "%") + star;
}
export const PARTIAL_PROFILE_NOTE = "* = % over the columns profiled for that gene";

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

export interface LegendItem { label: string; color: string; kind: "swatch" | "outline" | "notProfiled" }

/**
 * What a figure's gene cells actually draw, for its legend: every bit present, and for the
 * mutation band and the SV band which entries appear as driver and which as VUS. The mutation
 * entry is the one `cellLayers` picks by priority, not every class a cell carries, so a legend
 * never lists a colour the figure does not show.
 */
export interface GlyphPresence { bits: number; mutDriver: number; mutVus: number; svDriver: boolean; svVus: boolean }
export function glyphPresence(tracks: readonly { kind: string; cells: ArrayLike<number> }[], S: Style = STYLE): GlyphPresence {
  const B = S.bits as Record<string, number>;
  const out: GlyphPresence = { bits: 0, mutDriver: 0, mutVus: 0, svDriver: false, svVus: false };
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
    for (const m of S.glyph.mutation.priority) if (c & B[m.bit]) { if (c & B.MUT_DRIVER) out.mutDriver |= B[m.bit]; else out.mutVus |= B[m.bit]; break; }
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

/**
 * Colour for a categorical cell, honouring a per-track override
 * (`display.colors[trackLabel][value]` — the portal's Edit Colors).
 */
export function trackCategoryColor(track: { label: string; categories?: string[] }, code: number, S: Style = STYLE,
  colors?: Record<string, Record<string, string>>): string {
  const value = track.categories && track.categories[code];
  const override = value != null && colors && colors[track.label] ? colors[track.label][value] : undefined;
  return override || categoryColor(code, S);
}


/**
 * The style a figure draws with, given its viewing options. These change no number, so they
 * are applied here rather than threaded through every renderer:
 * - colour-by-type off: every mutation class takes the single colour pair and one label;
 * - annotation off: nothing is called a driver, so every glyph draws its driver colour and the
 *   legend has one entry per glyph — the portal's rule set without recurrence;
 * - white background: unaltered and not-profiled cells are white (not-profiled keeps its line).
 */
export function styleForDisplay(S: Style, display?: { colorByType?: boolean; annotate?: string; whiteBackground?: boolean }): Style {
  let out = S;
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
