// Rows -> oncoprint render contract. Pure: no database, no environment, no I/O.
//
// This is the data logic of the oncoprint — bitmask cells, NOT_PROFILED from panel
// coverage, the driver bit from an annotation source, categorical/numeric clinical
// tracks, heatmap ramps, derived-event rows, column groups, the staircase sort and
// panel-aware frequencies — separated from where the rows come from. `buildContract`
// fetches from ClickHouse and calls this; a CLI or a notebook can call it on local
// tables, and a port in another language has this function as its conformance target.
import { heatmapTrackLabel, assayTrackLabel, profiledTrackLabel, PROFILED_TYPES, SAMPLES_TRACK, STUDY_TRACK, type ProfiledType } from "./profile-names.ts";
import { normalizeGeneTracks, type GeneTrackSpec } from "./gene-tracks.ts";
import { STYLE, encodeNumeric, staircaseRank, staircaseOptions, STAIRCASE_RADIX, naturalVector, compareVectors } from "./oncoprint-style.ts";
export { naturalVector, compareVectors };
import { resolveDrivers, type DriverSettings } from "./driver-settings.ts";
import type { Contract, Track, GroupRange, ResolvedDisplay, DisplaySpec } from "./types.ts";
import type { ZReference, SortKeySpec } from "./views/oncoprint/types.ts";

// gene-track cell bitmask: one definition, the style's
export const BITS = STYLE.bits;
const PRIORITY_BITS = STYLE.glyph.mutation.priority.map((m) => BITS[m.bit as keyof typeof BITS]);
/** the mutation class bit a cell draws (the first by display priority), 0 for none */
const shownMutation = (c: number): number => { for (const b of PRIORITY_BITS) if (c & b) return b; return 0; };
export const NOT_PROFILED = -1;


export function mutClassBit(mt: string | undefined): number {
  if (!mt) return BITS.OTHER_MUT;
  const t = mt.toLowerCase();
  if (t.startsWith("missense")) return BITS.MISSENSE;
  if (t.startsWith("nonsense") || t.startsWith("frame_shift") || t.startsWith("nonstop")) return BITS.TRUNCATING;
  if (t.startsWith("in_frame")) return BITS.INFRAME;
  if (t.startsWith("splice")) return BITS.SPLICE;
  // the portal calls these promoter mutations; the warehouse spells them 5'Flank
  if (t.startsWith("5'flank") || t.startsWith("5_flank") || t.includes("promoter")) return BITS.PROMOTER;
  return BITS.OTHER_MUT;
}

/** One genomic event: a mutation (vt "mutation", mt = mutation type), a structural variant, or a CNA call. */
/**
 * One alteration of a column. `df` / `dt` are the study's own driver call and tier (cbp_driver,
 * cbp_driver_tiers) and `germ` marks a germline mutation; rows from an older peer or a local file
 * may lack them, which reads as no call and somatic.
 */
export interface EventRow { pid: string; gene: string; vt: string; mt?: string; mv?: string; cna?: string | number; df?: string | null; dt?: string | null; germ?: boolean | number | null }

export interface SortKey { track: string; dir: "asc" | "desc" }

/** Sort keys as authored -> the engine's ordered {track, dir} list; up to 4. */
export function normalizeSort(sort: SortKeySpec[] | undefined): { track: string; dir: "asc" | "desc" }[] {
  const list = Array.isArray(sort) && sort.length ? sort : ["genomic"];
  return list.slice(0, 4).map((s) => {
    if (typeof s === "string") return s.startsWith("-") ? { track: s.slice(1), dir: "desc" as const } : { track: s, dir: "asc" as const };
    return { track: String((s && s.track) || ""), dir: (s && s.dir === "desc" ? "desc" : "asc") as "asc" | "desc" };
  });
}

const DISPLAY_KEYS = ["showUnaltered", "whitespace", "gaps", "clinicalLegends", "colorByType", "colorByGermline", "hideVUS", "annotate", "whiteBackground",
  "sortByMutationType", "sortByDrivers", "sortIgnoreVUS", "style", "colors"] as const;
const GAP_MODES = ["none", "gaps", "pct", "pct-left"] as const;
const LEGEND_MODES = ["all", "none"] as const;
const ANNOTATE_MODES = ["oncokb", "none"] as const;

/**
 * Viewing options with defaults filled in. Unknown keys and values are rejected, never ignored.
 * The view's driver settings (`drivers`) are resolved here too: `display.annotate: "none"` and
 * `display.hideVUS` are their older spellings, read as defaults the settings override.
 */
export function normalizeDisplay(d: DisplaySpec | undefined, driverSpec?: DriverSettings): ResolvedDisplay {
  const src = (d || {}) as Record<string, unknown>;
  for (const k of Object.keys(src))
    if (!(DISPLAY_KEYS as readonly string[]).includes(k))
      throw new Error("display: unknown option '" + k + "' (accepted: " + DISPLAY_KEYS.join(", ") + ")");
  const bool = (k: "showUnaltered" | "whitespace" | "colorByType" | "colorByGermline" | "hideVUS" | "whiteBackground" | "sortByMutationType" | "sortByDrivers" | "sortIgnoreVUS", dflt: boolean): boolean => {
    const v = src[k];
    if (v === undefined) return dflt;
    if (typeof v !== "boolean") throw new Error("display." + k + " must be true or false");
    return v;
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[], dflt: T): T => {
    const v = src[k];
    if (v === undefined) return dflt;
    if (typeof v !== "string" || !allowed.includes(v as T))
      throw new Error("display." + k + ": '" + String(v) + "' is not one of " + allowed.join(", "));
    return v as T;
  };
  const colors = src.colors as ResolvedDisplay["colors"];
  if (colors !== undefined) {
    if (typeof colors !== "object" || colors === null || Array.isArray(colors)) throw new Error("display.colors must be {track: {value: color}}");
    for (const [track, byValue] of Object.entries(colors)) {
      if (typeof byValue !== "object" || byValue === null || Array.isArray(byValue)) throw new Error("display.colors['" + track + "'] must be {value: color}");
      for (const [value, color] of Object.entries(byValue))
        if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))
          throw new Error("display.colors['" + track + "']['" + value + "']: '" + String(color) + "' is not a #rrggbb colour");
    }
  }
  const older: DriverSettings = {
    ...(oneOf("annotate", ANNOTATE_MODES, "oncokb") === "none" ? { oncokb: false, custom: false, tiers: [] } : {}),
    ...(bool("hideVUS", false) ? { hideVus: true } : {}),
  };
  resolveDrivers(driverSpec);   // the settings as given are checked on their own, so an error names their own key
  const drivers = resolveDrivers({ ...older, ...(driverSpec || {}) });
  return {
    showUnaltered: bool("showUnaltered", true),
    whitespace: bool("whitespace", true),
    gaps: oneOf("gaps", GAP_MODES, "none"),
    clinicalLegends: oneOf("clinicalLegends", LEGEND_MODES, "all"),
    colorByType: bool("colorByType", true),
    colorByGermline: bool("colorByGermline", true),
    hideVUS: drivers.hideVus,
    annotate: drivers.annotated ? "oncokb" : "none",
    hideGermline: drivers.hideGermline,
    drivers,
    whiteBackground: bool("whiteBackground", false),
    // the staircase switches, echoed only when off the portal's defaults
    ...(!bool("sortByMutationType", true) ? { sortByMutationType: false } : {}),
    ...(!bool("sortByDrivers", true) ? { sortByDrivers: false } : {}),
    ...(bool("sortIgnoreVUS", false) ? { sortIgnoreVUS: true } : {}),
    ...(src.style !== undefined ? { style: src.style as Record<string, unknown> } : {}),
    ...(colors !== undefined ? { colors } : {})
  };
}

export interface AssembleInput {
  /**
   * The rows, in order: a gene symbol, or `{label?, genes}` for a merged row. `normalizeGeneTracks`
   * also fixes the order of the distinct symbols, which is the order `coverage`'s mask bits are in.
   */
  genes: GeneTrackSpec[];
  /** column groups: name + column ids in fetch order; a column id appears in at most one group */
  groups: { name: string; pids: string[] }[];
  /** study label(s) for the contract header; more than one adds the categorical "Study of origin" track */
  studies: string[];
  /** column id -> study, required when studies.length > 1 */
  studyOf?: Map<string, string>;
  events: EventRow[];
  /**
   * What each column's panel covers; a covered gene is profiled-unaltered (0) unless an event
   * says otherwise, and a column absent here is NOT_PROFILED for every gene it has no event for.
   * Either gene names (local tables) or a bitmask over the distinct gene symbols by position (the database path,
   * where one integer per patient is far cheaper to send than an array of names).
   */
  coverage: ({ pid: string; genes: string[] } | { pid: string; mask: number })[];
  /**
   * The portal's "Profiled for <type>" rows: which alteration types the figure draws (`types`),
   * and per column a bitmask over PROFILED_TYPES of those its samples were profiled for. A row
   * appears only for a type some columns were and some were not profiled for, as in the portal.
   */
  profiled?: { types: ProfiledType[]; masks: { pid: string; mask: number }[] };
  /**
   * Samples per column, patient columns only. Adds the portal's "# Samples per Patient" row when
   * some patient has more than one.
   */
  samples?: { pid: string; n: number }[];
  /** driver call per event, and the source to echo in conventions */
  isDriver: (r: EventRow) => boolean;
  annotationSource: string;
  /** clinical attributes in track order, each with its per-column value */
  clinical: { attr: string; values: Map<string, string> }[];
  /** continuous per-gene values per profile, keyed "<columnId>|<gene>" */
  /** `assay`: a generic-assay profile, whose `genes` are its entities */
  heatmap: { profileType: string; genes: string[]; isVaf: boolean; assay?: boolean; values: Map<string, number> }[];
  /** "<profileType>|<gene>" -> pooled reference (federated z-scoring) */
  zReference?: Record<string, ZReference>;
  /**
   * Thresholded molecular evidence drawn INTO the gene cells rather than as their own track:
   * mRNA as an outline, protein as thin bars, the way the portal does it. Values beyond
   * ±threshold set the high/low bit for that (column, gene).
   */
  overlays?: { kind: "mrna" | "protein"; profileType: string; threshold: number; values: Map<string, number> }[];
  /** binary phenotype rows: the column ids in the set draw as 1 */
  derived: { label: string; pids: Set<string> }[];
  sort: SortKey[];
  lineGap: number;
  /** resolved viewing options; defaults are filled in when absent */
  display?: ResolvedDisplay;
  /** what a column is; "sample" only changes the label and the caveat — the logic is identical */
  unit?: "patient" | "sample";
  /**
   * Column id -> its position in a clustering computed by the engine. The sort key "cluster"
   * reads it. Clustering needs the molecular values and a quadratic pass, so it is done once
   * where the values are fetched rather than in this pure function.
   */
  clusterRank?: Map<string, number>;
}

/**
 * What the figure's alterations carry of the study's own driver calls, for the settings menu to
 * offer them (the portal's computeCustomDriverAnnotationReport): whether any has a cbp_driver
 * value, and every cbp_driver_tiers value, sorted. Nothing when there is neither.
 */
function customDriverReport(events: readonly EventRow[]): { customDrivers?: { binary: boolean; tiers: string[] } } {
  let binary = false;
  const tiers = new Set<string>();
  for (const r of events) {
    if (r.df) binary = true;
    if (r.dt) tiers.add(r.dt);
  }
  return binary || tiers.size ? { customDrivers: { binary, tiers: [...tiers].sort() } } : {};
}

export function assembleContract(input: AssembleInput): Contract {
  const t0 = Date.now();
  const PROF = !!process.env.ONCOPRINT_PROFILE;
  let tp = Date.now();
  const phase = (name: string) => { if (PROF) { process.stderr.write("  " + name.padEnd(16) + (Date.now() - tp) + "ms\n"); tp = Date.now(); } };
  const { groups, studies, events, coverage, isDriver, clinical, heatmap, derived, sort, lineGap } = input;
  // the rows, and the flat symbol list whose order the coverage mask bits follow
  const { tracks: geneTracks, symbols: geneSymbolList } = normalizeGeneTracks(input.genes);
  const unit = input.unit === "sample" ? "sample" as const : "patient" as const;
  const multi = studies.length > 1;
  const studyOf = input.studyOf || new Map<string, string>();
  const allPids = groups.flatMap((g) => g.pids);
  if (!allPids.length) throw new Error("cohort is empty");
  const pidIndex = new Map<string, number>(allPids.map((p, i) => [p, i]));

  // ---- gene-track cells --------------------------------------------------
  // A merged row is the bitwise OR of its members, which makes it altered where any member is
  // altered and profiled where any member was profiled — the union denominator, with no
  // special case: the sentinel survives only where every member is unprofiled. A gene may
  // appear in several rows (merged, and again on its own), so one symbol maps to a LIST.
  const geneCells = new Map<string, Int32Array>(geneTracks.map((t) => [t.label, new Int32Array(allPids.length).fill(NOT_PROFILED)]));
  const rowsOfGene = new Map<string, Int32Array[]>();
  for (const t of geneTracks) for (const m of t.members) {
    const list = rowsOfGene.get(m);
    if (list) list.push(geneCells.get(t.label)!); else rowsOfGene.set(m, [geneCells.get(t.label)!]);
  }
  const rowsByMaskBit = geneSymbolList.map((g) => rowsOfGene.get(g) ?? []);
  for (const r of coverage) {
    const i = pidIndex.get(r.pid);
    if (i === undefined) continue;
    if ("mask" in r) {
      const m = r.mask;
      for (let gi = 0; gi < rowsByMaskBit.length; gi++)
        if ((m >> gi) & 1) for (const cells of rowsByMaskBit[gi]) if (cells[i] === NOT_PROFILED) cells[i] = 0;
    } else {
      for (const g of r.genes) for (const cells of rowsOfGene.get(g) || []) if (cells[i] === NOT_PROFILED) cells[i] = 0;
    }
  }
  // Hiding unknown significance drops the ALTERATION, not the cell's bits: a cell holding a
  // driver amplification and a passenger missense keeps only the amplification, and a merged
  // row's driver in one gene does not smuggle another gene's passenger through. What was
  // dropped is counted so a caption can say so.
  //
  // Driver status is per glyph, as in the portal: SV_DRIVER for the structural variant,
  // MUT_DRIVER for the mutation band, and DRIVER for "some alteration here is a driver" (the
  // driver %, the sort). The portal ranks every driver mutation above every VUS one whatever
  // the class, so a VUS mutation's class is held aside and joins the cell only where no driver
  // mutation does — a VUS truncation beside a driver missense shows as the driver missense.
  //
  // A call on a cell no panel covers — a gene its column's panels do not include (off-panel) —
  // is not drawn: the cell stays NOT_PROFILED, and the gene's % does not count it, as cBioPortal's
  // results view does (altered AND sequenced over sequenced). A merged row is profiled where any
  // member is, so it can still draw a call its gene's own row leaves out. Every call left out of
  // a row is counted, so the caption says so.
  //
  // A germline mutation is dropped like a VUS when the settings hide germline, and otherwise marks
  // its cell GERMLINE when the mutation the cell shows — the class drawn, at its driver call — is a
  // germline one (the portal's disp_germ), so the stripe never sits on a somatic call's glyph.
  const hideVus = !!input.display?.hideVUS, hideGerm = !!input.display?.hideGermline;
  let hiddenVus = 0, hiddenGerm = 0, offPanel = 0;
  const vusMut = new Map<Int32Array, Uint16Array>();   // mutation class bits all sit below 1024
  const germDrv = new Map<Int32Array, Uint16Array>(), germVus = new Map<Int32Array, Uint16Array>();
  const mark = (m: Map<Int32Array, Uint16Array>, cells: Int32Array, i: number, bit: number): void => {
    let held = m.get(cells);
    if (!held) { held = new Uint16Array(cells.length); m.set(cells, held); }
    held[i] |= bit;
  };
  for (const r of events) {
    const i = pidIndex.get(r.pid);
    if (i === undefined) continue;
    const rows = rowsOfGene.get(r.gene);
    if (!rows) continue;
    let bit = 0;
    const mut = r.vt === "mutation";
    if (mut) bit = mutClassBit(r.mt);
    else if (r.vt === "structural_variant") bit = BITS.SV;
    else if (r.vt === "cna") bit = Number(r.cna) >= 2 ? BITS.AMP : (Number(r.cna) <= -2 ? BITS.HOMDEL : 0);
    if (!bit) continue;
    const covered = rows.filter((cells) => cells[i] !== NOT_PROFILED);
    if (covered.length < rows.length) offPanel++;
    if (!covered.length) continue;
    const germ = mut && !!r.germ;
    if (germ && hideGerm) { hiddenGerm++; continue; }
    const driver = isDriver(r);
    if (hideVus && !driver) { hiddenVus++; continue; }
    if (germ) for (const cells of covered) mark(driver ? germDrv : germVus, cells, i, bit);
    if (mut && !driver) {
      for (const cells of covered) mark(vusMut, cells, i, bit);
      continue;
    }
    if (driver) bit |= BITS.DRIVER | (mut ? BITS.MUT_DRIVER : bit === BITS.SV ? BITS.SV_DRIVER : BITS.CNA_DRIVER);
    for (const cells of covered) cells[i] |= bit;
  }
  for (const [cells, held] of vusMut)
    for (let i = 0; i < cells.length; i++) if (held[i] && !(cells[i] & BITS.MUT_DRIVER)) cells[i] |= held[i];
  for (const cells of new Set([...germDrv.keys(), ...germVus.keys()])) {
    const drv = germDrv.get(cells), vus = germVus.get(cells);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c <= 0) continue;
      const shown = shownMutation(c);
      if (shown && ((c & BITS.MUT_DRIVER ? drv : vus)?.[i] ?? 0) & shown) cells[i] = c | BITS.GERMLINE;
    }
  }

  phase("gene cells");

  // ---- molecular overlays: extra bits on the gene cells --------------------
  for (const ov of input.overlays || []) {
    const hi = ov.kind === "mrna" ? BITS.MRNA_HIGH : BITS.PROT_HIGH;
    const lo = ov.kind === "mrna" ? BITS.MRNA_LOW : BITS.PROT_LOW;
    for (const t of geneTracks) {
      const cells = geneCells.get(t.label)!;
      for (const gene of t.members) for (let i = 0; i < allPids.length; i++) {
        const v = ov.values.get(allPids[i] + "|" + gene);
        if (v === undefined) continue;
        if (v >= ov.threshold) cells[i] = (cells[i] === NOT_PROFILED ? 0 : cells[i]) | hi;
        else if (v <= -ov.threshold) cells[i] = (cells[i] === NOT_PROFILED ? 0 : cells[i]) | lo;
      }
    }
  }

  // ---- clinical tracks ---------------------------------------------------
  const clinTracks: Track[] = [];
  if (multi) {
    // synthetic per-column provenance track; also the honest caveat that clinical
    // vocabularies below it are merged by attribute name, not harmonized
    const catIdx = new Map<string, number>(studies.map((s, i) => [s, i]));
    const cells = new Int32Array(allPids.length).fill(-1);
    allPids.forEach((p, i) => { const s = studyOf.get(p); if (s != null) cells[i] = catIdx.get(s)!; });
    clinTracks.push({ kind: "clinical", label: STUDY_TRACK, categories: studies.slice(), cells });
  }
  if (input.samples && unit === "patient") {
    const n = new Int32Array(allPids.length);
    for (const r of input.samples) { const i = pidIndex.get(r.pid); if (i !== undefined) n[i] = r.n; }
    let max = 0;
    for (let i = 0; i < n.length; i++) if (n[i] > max) max = n[i];
    if (max > 1) {
      const cells = new Int32Array(allPids.length);
      const values = new Float32Array(allPids.length).fill(NaN);
      for (let i = 0; i < n.length; i++) { cells[i] = n[i] ? Math.round(255 * n[i] / max) : -1; if (n[i]) values[i] = n[i]; }
      clinTracks.push({ kind: "clinical", label: SAMPLES_TRACK, numeric: true, bar: true, peak: true, min: 0, max, cells, values });
    }
  }
  if (input.profiled) {
    const mask = new Int32Array(allPids.length);
    for (const r of input.profiled.masks) { const i = pidIndex.get(r.pid); if (i !== undefined) mask[i] |= r.mask; }
    const rows: Track[] = [];
    for (const type of input.profiled.types) {
      const bit = 1 << PROFILED_TYPES.findIndex(([t]) => t === type);
      const cells = new Int32Array(allPids.length);
      let yes = 0;
      for (let i = 0; i < allPids.length; i++) if (mask[i] & bit) yes++; else cells[i] = -1;
      if (yes === 0 || yes === allPids.length) continue;
      rows.push({ kind: "clinical", label: profiledTrackLabel(type), categories: [STYLE.glyph.profiled.yes], profiledFor: type, cells });
    }
    clinTracks.push(...rows.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })));
  }
  for (const { attr, values: valByPid } of clinical) {
    // One string-keyed lookup per column, then three passes over a positional array. The map
    // is keyed by column id, and at 400k columns three passes over it was the single most
    // expensive phase of assembly.
    const val: (string | undefined)[] = new Array(allPids.length);
    for (let i = 0; i < allPids.length; i++) val[i] = valByPid.get(allPids[i]);
    // numeric attribute (≥90% of present values parse, >10 distinct) -> continuous
    // heat track: cells are the value scaled to 0..255 over the cohort's min..max
    // one pass over the columns: how many have a value, how many parse, their range and
    // distinct count. Never materialises a per-column array (a spread of 400k values throws).
    let nPresent = 0, nNumeric = 0, min = Infinity, max = -Infinity;
    const distinct = new Set<number>();
    for (let i = 0; i < val.length; i++) {
      const v = val[i];
      if (v == null) continue;
      nPresent++;
      const x = Number(v);
      if (!Number.isFinite(x)) continue;
      nNumeric++;
      if (x < min) min = x;
      if (x > max) max = x;
      if (distinct.size <= 11) distinct.add(x);
    }
    if (!nPresent) { // unknown attribute or none of these patients have it — say so
      clinTracks.push({ kind: "clinical", label: attr + " (no data)", categories: [], cells: new Int32Array(allPids.length).fill(-1) });
      continue;
    }
    if (nNumeric >= 0.9 * nPresent && distinct.size > 10) {
      // drawn as bars over the data's range, as the portal does; its fixed range for a fraction
      // of the genome, and its log scale for mutation counts
      const fraction = attr === "FRACTION_GENOME_ALTERED";
      if (fraction) { min = Math.min(min, 0); max = Math.max(max, 1); }
      const logScale = attr === "MUTATION_COUNT" && min >= 0;
      const cells = new Int32Array(allPids.length).fill(-1), values = new Float32Array(allPids.length).fill(NaN);
      for (let i = 0; i < val.length; i++) {
        const v = val[i];
        if (v == null) continue;
        const x = Number(v);
        if (Number.isFinite(x)) { cells[i] = encodeNumeric(x, min, max, logScale); values[i] = x; }
      }
      clinTracks.push({ kind: "clinical", numeric: true, bar: true, ...(logScale ? { logScale } : {}), label: attr, min, max, cells, values });
      continue;
    }
    const counts = new Map<string, number>();
    for (let i = 0; i < val.length; i++) { const v = val[i]; if (v != null) counts.set(v, (counts.get(v) || 0) + 1); }
    // every value is its own category, as in the portal, most frequent first
    const categories = [...counts.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]);
    const catIdx = new Map<string, number>(categories.map((c, i) => [c, i]));
    const cells = new Int32Array(allPids.length).fill(-1);
    for (let i = 0; i < val.length; i++) { const v = val[i]; if (v != null) cells[i] = catIdx.get(v)!; }
    clinTracks.push({ kind: "clinical", label: attr, categories, cells });
  }

  phase("clinical");
  // ---- heatmap tracks (continuous molecular-profile values per gene) ----
  // The portal's ramps, fixed so colours compare across oncoprints: a molecular profile on
  // -3..3, blue-black-red; methylation 0..1, white at 0.35; VAF 0..1, yellow to teal. A generic
  // assay is scaled to its data: diverging when it spans zero, sequential otherwise.
  const heatTracks: Track[] = [];
  for (const h of heatmap) {
    const isZ = /zscore/i.test(h.profileType);
    for (const gene of h.genes) {
      const label = h.assay ? assayTrackLabel(gene, h.profileType) : heatmapTrackLabel(gene, h.profileType);
      // A federation reference re-scores the drawn values against a distribution
      // pooled from every participating study — including ones that disclose no
      // patients, and so appear nowhere in the columns.
      const ref = (input.zReference || {})[h.profileType + "|" + gene];
      const usingRef = !!(ref && ref.sd > 0);
      const tx = (v: number) => usingRef ? (v - ref!.mean) / ref!.sd : v;
      const vals: number[] = [];
      for (const p of allPids) { const v = h.values.get(p + "|" + gene); if (v !== undefined) vals.push(tx(v)); }
      if (!vals.length) {
        heatTracks.push({ kind: "clinical", label: label + " (no data)", categories: [], cells: new Int32Array(allPids.length).fill(-1) });
        continue;
      }
      // the portal's fixed ranges and colours (ONC-TT-5..7): VAF 0..1; methylation 0..1, white at
      // 0.35; every other molecular profile, z-scored or not, -3..3 around a black 0. A generic
      // assay keeps its own range.
      const ramp: Track["ramp"] = h.assay ? undefined : h.isVaf ? "vaf" : /methylation/i.test(h.profileType) ? "methylation" : "expression";
      let min: number, max: number, center: number | null;
      if (ramp === "vaf" || ramp === "methylation") { min = 0; max = 1; center = null; }
      else if (ramp === "expression" || isZ || usingRef) { min = -3; max = 3; center = 0; }
      else {
        const dMin = Math.min(...vals), dMax = Math.max(...vals);
        if (dMin < 0 && dMax > 0) { const m = Math.max(-dMin, dMax); min = -m; max = m; center = 0; }
        else { min = dMin; max = dMax; center = null; }
      }
      const span = max - min || 1;
      const cells = new Int32Array(allPids.length).fill(-1), values = new Float32Array(allPids.length).fill(NaN);
      allPids.forEach((p, i) => {
        const v = h.values.get(p + "|" + gene);
        if (v !== undefined) { cells[i] = Math.round(255 * (Math.max(min, Math.min(max, tx(v))) - min) / span); values[i] = tx(v); }
      });
      heatTracks.push({ kind: "heatmap", numeric: true, ...(ramp ? { ramp } : {}), label, gene, profileType: h.profileType,
        note: usingRef
          ? "z-scored against " + ref!.n.toLocaleString() + " patients pooled from " + ref!.studies.length +
            " stud" + (ref!.studies.length === 1 ? "y" : "ies") + " (" + ref!.studies.join(", ") + ") — " +
            "the reference is federated even where the columns are not"
          : h.isVaf ? "allele fraction, max across a patient's mutations in the gene" : "a patient's: its samples' value furthest from 0",
        min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100,
        center: center == null ? null : Math.round(255 * (0 - min) / span), cells, values });
    }
  }

  phase("heatmap");
  // ---- derived-event tracks (cohort-DSL expressions as phenotypes) ------
  const devTracks: Track[] = [];
  for (const de of derived) {
    const cells = new Int32Array(allPids.length);
    allPids.forEach((p, i) => { cells[i] = de.pids.has(p) ? 1 : 0; });
    devTracks.push({ kind: "derivedEvent", label: String(de.label || "derived event").slice(0, 60), cells });
  }

  phase("derived");
  // ---- column sort within groups ----------------------------------------
  // Default is the portal's genomic staircase (ONC-ST-1, ONC-ST-2): each gene row, top to
  // bottom, ranks its cell by structural variant, copy number, mutation, germline, mRNA and
  // protein (staircaseRank), with a cell not profiled after an unaltered one; then the case id in
  // the portal's natural order. sort can put clinical/derived tracks first ("-" = descending,
  // missing values always last); the staircase and the id remain the final tiebreakers, so every
  // sort is total. Comparing every row inside a comparator is the dominant cost of a 400k-column
  // sort, so the rows' ranks are packed, four to a double ((STAIRCASE_RADIX + 1)^4 < 2^53), and
  // compared as numbers.
  const PER_KEY = 4, RADIX = STAIRCASE_RADIX + 1;
  const switches = staircaseOptions(input.display);
  const keys: Float64Array[] = [];
  for (let from = 0; from < geneTracks.length; from += PER_KEY) {
    const key = new Float64Array(allPids.length);
    const list = geneTracks.slice(from, from + PER_KEY).map((t) => geneCells.get(t.label)!);
    for (let i = 0; i < allPids.length; i++) {
      let k = 0;
      for (const cells of list) k = k * RADIX + (cells[i] === NOT_PROFILED ? STAIRCASE_RADIX : staircaseRank(cells[i], switches));
      key[i] = k;
    }
    keys.push(key);
  }
  const genomicCmp = (x: number, y: number): number => {
    for (const key of keys) { const d = key[x] - key[y]; if (d) return d; }
    return 0;
  };
  // the id tiebreaker compares integers: rank the ids once instead of on every comparison
  const idRank = new Int32Array(allPids.length);
  {
    // the portal's natural order of the bare case id (oncoprintjs stringToVector), then the full id
    const vec = allPids.map((p) => { const st = studyOf.get(p); return naturalVector(st && p.startsWith(st + "_") ? p.slice(st.length + 1) : p); });
    const idx = Array.from(allPids.keys());
    idx.sort((a, b) => compareVectors(vec[a], vec[b]) || (allPids[a] < allPids[b] ? -1 : allPids[a] > allPids[b] ? 1 : 0));
    for (let r = 0; r < idx.length; r++) idRank[idx[r]] = r;
  }
  const sortableTracks = new Map<string, Track>([...clinTracks, ...devTracks, ...heatTracks].map((t) => [t.label, t]));
  const trackCmp = (t: Track, sign: number) => t.values ? (x: number, y: number): number => {
    // a numeric track sorts by its exact values, missing last
    const a = t.values![x], b = t.values![y], na = Number.isNaN(a), nb = Number.isNaN(b);
    if (na || nb) return na === nb ? 0 : na ? 1 : -1;
    return sign * (a - b);
  } : (x: number, y: number): number => {
    const a = (t.cells as number[])[x], b = (t.cells as number[])[y];
    if (a === b) return 0;
    if (a === -1) return 1;
    if (b === -1) return -1;
    return sign * (a - b);
  };
  const byId = (x: number, y: number): number => idRank[x] - idRank[y];
  const cmps: ((x: number, y: number) => number)[] = sort.map((s) => {
    const sign = s.dir === "desc" ? -1 : 1;
    if (s.track === "genomic") return (x: number, y: number) => sign * genomicCmp(x, y);
    if (s.track === "id") return (x: number, y: number) => sign * byId(x, y);
    if (s.track === "cluster") {
      const rank = input.clusterRank;
      if (!rank) throw new Error("sort: 'cluster' needs a clustered profile — use \"cluster:<profileType>\"");
      const at = (i: number): number => rank.get(allPids[i]) ?? Number.MAX_SAFE_INTEGER;
      return (x: number, y: number) => sign * (at(x) - at(y));
    }
    const t = sortableTracks.get(s.track);
    if (!t) throw new Error("sort: '" + s.track + "' is not a track in this oncoprint — sortable: genomic, id, cluster:<profileType>" +
      (sortableTracks.size ? ", " + [...sortableTracks.keys()].join(", ") : "") +
      " (clinical sort keys must also be listed in clinical)");
    return trackCmp(t, sign);
  });
  cmps.push(genomicCmp);
  const order: number[] = [];
  let cursor = 0;
  const groupRanges: GroupRange[] = [];
  for (const g of groups) {
    const idxs = g.pids.map((p) => pidIndex.get(p)!);
    idxs.sort((x, y) => {
      for (const c of cmps) { const r = c(x, y); if (r) return r; }
      return idRank[x] - idRank[y];
    });
    for (const i of idxs) order.push(i); // not push(...idxs): spreads over ~100k args overflow the stack
    groupRanges.push({ name: g.name, start: cursor, count: idxs.length });
    cursor += idxs.length;
  }
  const remap = (arr: number[] | Int32Array): number[] => order.map((i) => (arr as number[])[i]);
  const columns = order.map((i) => allPids[i]);

  phase("sort");
  // ---- track meta (panel-aware frequencies) -----------------------------
  // Rows top to bottom in the portal's order: clinical (the study, sample-count and profiled-for
  // rows first), then the derived-cohort rows beside them, then genes, then heatmaps.
  const remapValues = (t: Track) => t.values ? { values: order.map((i) => { const x = t.values![i]; return Number.isNaN(x) ? null : x; }) as number[] } : {};
  const tracks: Track[] = clinTracks.map((t) => ({ ...t, cells: remap(t.cells), ...remapValues(t) }));
  // an overlay is evidence about the gene, not an alteration of it: expression does not
  // enter the altered fraction, which is what the portal reports too
  const ALT = BITS.MISSENSE | BITS.TRUNCATING | BITS.INFRAME | BITS.SPLICE | BITS.OTHER_MUT | BITS.PROMOTER | BITS.SV | BITS.AMP | BITS.HOMDEL;
  // Shared by the pooled numbers below and the per-group breakdown: same formula, just
  // over a slice of columns instead of all of them.
  const geneCounts = (slice: number[]) => {
    const profiled = slice.filter((c) => c !== NOT_PROFILED).length;
    const altered = slice.filter((c) => c > 0 && (c & ALT)).length;
    const driverAltered = slice.filter((c) => c > 0 && (c & ALT) && (c & BITS.DRIVER)).length;
    return { profiled, altered, driverAltered,
      freqPct: profiled ? Math.round(1000 * altered / profiled) / 10 : null,
      driverPct: profiled ? Math.round(1000 * driverAltered / profiled) / 10 : null };
  };
  for (const t of devTracks) {
    const cells = remap(t.cells);
    tracks.push({ ...t, cells, altered: cells.filter((c) => c === 1).length, profiled: cells.length,
      freqPct: Math.round(1000 * cells.filter((c) => c === 1).length / cells.length) / 10 });
  }
  for (const gt of geneTracks) {
    const cells = remap(geneCells.get(gt.label)!);
    const { profiled, altered, driverAltered, freqPct, driverPct } = geneCounts(cells);
    tracks.push({
      kind: "gene", label: gt.label, cells,
      ...(gt.members.length > 1 ? { members: gt.members } : {}),
      altered, profiled, driverAltered, freqPct, driverPct,
      // Pooled is enough on its own with one group; with several, the figure already
      // draws a boundary between them, so the text/provenance side gets the same split
      // rather than only ever reporting the number pooled across all of them.
      ...(groupRanges.length > 1 ? { byGroup: groupRanges.map((g) => {
        const { profiled, altered, freqPct, driverPct } = geneCounts(cells.slice(g.start, g.start + g.count));
        return { group: g.name, altered, profiled, freqPct, driverPct };
      }) } : {})
    });
  }
  for (const t of heatTracks) tracks.push({ ...t, cells: remap(t.cells), ...remapValues(t) });

  phase("track meta");
  return {
    study: multi ? studies.join(" + ") : studies[0], studies, unit,
    groups: groupRanges,
    columns,
    tracks: tracks.map((t) => ({ ...t, cells: Array.from(t.cells as number[]) })),
    conventions: { cna: "high-level only (±2)", notProfiled: "distinct cell state",
      frequencyDenominator: unit === "sample" ? "profiled samples" : "profiled patients",
      column: unit === "sample"
        ? "one sample; a cohort selects patients, so every sample of a selected patient is drawn — including samples on which the cohort's own criterion was never measured. Patient-level clinical values repeat across that patient's samples."
        : "one patient; a patient's samples are collapsed (clinical: a patient row wins, else for a NUMBER its samples' mean, MUTATION_COUNT their max, for anything else the value they agree on, otherwise \"Mixed\"; heatmap: the sample value furthest from 0; VAF: max)",
      annotation: input.annotationSource, lineGap,
      sort: sort.map((s) => (s.dir === "desc" ? "-" : "") + s.track),
      ...customDriverReport(events) },
    display: input.display ?? { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true, hideVUS: false, annotate: "oncokb", whiteBackground: false },
    stats: { nColumns: columns.length, ms: Date.now() - t0, ...(input.display?.hideVUS ? { hiddenVus } : {}), ...(hideGerm ? { hiddenGermline: hiddenGerm } : {}), ...(offPanel ? { offPanel } : {}) }
  };
}
