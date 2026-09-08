// THE oncoprint style: every visual decision as data, plus the three pure functions that
// turn a cell code into fills. Every renderer — server SVG, browser canvas, MCP-App canvas,
// the Python package (via the generated python/cohortlab/style.json) — reads this and draws
// what it says. A renderer knows how to fill a rectangle; it does not know what red means.
//
// Changing a colour, a band, the mutation display priority or a legend label here changes it
// everywhere at once. `npm run style:gen` regenerates the Python copy; a unit test fails on drift.

export const STYLE = {
  version: 1,
  bits: { MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16, SV: 32, AMP: 64, HOMDEL: 128, DRIVER: 256 },
  palette: {
    paper: "#ffffff", unaltered: "#e8ecee", derived: "#0f86a1",
    text: "#1f2933", muted: "#5b6b76", groupLine: "#c9d2d8",
    categorical: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"]
  },
  // A gene cell is drawn as layers, bottom to top: base, CNA (full height), SV (inset band),
  // one mutation (centre band, chosen by priority). Alteration layers of a cell with no
  // DRIVER bit are drawn at vusAlpha over whatever is beneath them.
  glyph: {
    cna: { band: [0, 1] as [number, number], options: [
      { bit: "AMP", color: "#e41a1c", label: "Amplification", order: 10 },
      { bit: "HOMDEL", color: "#2166ac", label: "Deep Deletion", order: 12 }
    ] },
    sv: { band: [0.15, 0.85] as [number, number], bit: "SV", color: "#8e24aa", label: "Structural Variant", order: 1 },
    // display priority when a cell carries several mutation classes (the portal's rule)
    mutation: { band: [0.3, 0.7] as [number, number], order: 0, priority: [
      { bit: "TRUNCATING", color: "#111111", label: "Truncating Mutation" },
      { bit: "SPLICE", color: "#ff8c00", label: "Splice Mutation" },
      { bit: "INFRAME", color: "#b8860b", label: "Inframe Mutation" },
      { bit: "MISSENSE", color: "#2e7d32", label: "Missense Mutation" },
      { bit: "OTHER_MUT", color: "#9467bd", label: "Other Mutation" }
    ] },
    vusAlpha: 0.35,
    notProfiled: { fill: "#f4f6f7", stripe: { color: "#dfe4e7", band: [0.45, 0.55] as [number, number] }, label: "Not profiled" },
    unalteredLabel: "No alterations",
    driverNote: "solid = putative driver, faded = unknown significance"
  },
  ramps: {
    sequential: { from: [222, 235, 247], to: [8, 72, 135] },            // #deebf7 -> #084887
    diverging: { low: [33, 102, 172], mid: [255, 255, 255], high: [178, 24, 43] }  // #2166ac -> white -> #b2182b
  },
  geometry: { rowH: 20, rowGap: 3, gutter: 168, groupGap: 10, header: 22, labelMaxChars: 17, cellPadMax: 3, padMinZoom: 3, padFraction: 0.3 },
  percent: { gutterDecimals: 1, runRule: "portal" }   // runRule: integer at 3 % and above, one decimal below, N/P
};

// Deliberately not `as const`: a resolved override is the same shape with different values,
// so the type has to admit any colour, not only the default one.
export type Style = typeof STYLE;
export type Rgb = readonly [number, number, number];
export interface Layer { color: string; band: readonly [number, number]; alpha: number }

/**
 * Fills for one gene cell, bottom to top, as fractions of the row height.
 * Self-contained on purpose (no closure over module state) so its source can be
 * embedded verbatim in the MCP-App document.
 */
export function cellLayers(code: number, S: Style): Layer[] {
  const G = S.glyph, B = S.bits as Record<string, number>;
  if (code === -1) return [{ color: G.notProfiled.fill, band: [0, 1], alpha: 1 }, { color: G.notProfiled.stripe.color, band: G.notProfiled.stripe.band, alpha: 1 }];
  const out: Layer[] = [{ color: S.palette.unaltered, band: [0, 1], alpha: 1 }];
  if (code <= 0) return out;
  const alpha = (code & B.DRIVER) ? 1 : G.vusAlpha;
  for (const o of G.cna.options) if (code & B[o.bit]) { out.push({ color: o.color, band: G.cna.band, alpha }); break; }
  if (code & B[G.sv.bit]) out.push({ color: G.sv.color, band: G.sv.band, alpha });
  for (const m of G.mutation.priority) if (code & B[m.bit]) { out.push({ color: m.color, band: G.mutation.band, alpha }); break; }
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
/** Gutter frequency: "driver% / any%" at one decimal (what the engine reports). */
export function formatGutterPct(driverPct: number | null | undefined, freqPct: number | null | undefined): string {
  if (freqPct == null) return "N/P";
  return driverPct != null ? driverPct + "% / " + freqPct + "%" : freqPct + "%";
}

export function truncateLabel(label: string, S: Style = STYLE): string {
  const n = S.geometry.labelMaxChars;
  return label.length > n ? label.slice(0, n - 1) + "…" : label;
}

/** Gene-legend entries in display order, shared by every renderer. */
export function geneLegend(S: Style = STYLE): { label: string; color: string; kind: "swatch" | "notProfiled" }[] {
  const items: { label: string; color: string; kind: "swatch" | "notProfiled" }[] = [];
  for (const m of S.glyph.mutation.priority) items.push({ label: m.label, color: m.color, kind: "swatch" });
  items.push({ label: S.glyph.sv.label, color: S.glyph.sv.color, kind: "swatch" });
  for (const o of S.glyph.cna.options) items.push({ label: o.label, color: o.color, kind: "swatch" });
  items.push({ label: S.glyph.notProfiled.label, color: S.glyph.notProfiled.stripe.color, kind: "notProfiled" });
  return items;
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
