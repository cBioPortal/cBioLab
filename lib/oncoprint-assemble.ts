// Rows -> oncoprint render contract. Pure: no database, no environment, no I/O.
//
// This is the data logic of the oncoprint — bitmask cells, NOT_PROFILED from panel
// coverage, the driver bit from an annotation source, categorical/numeric clinical
// tracks, heatmap ramps, derived-event rows, column groups, the staircase sort and
// panel-aware frequencies — separated from where the rows come from. `buildContract`
// fetches from ClickHouse and calls this; a CLI or a notebook can call it on local
// tables, and a port in another language has this function as its conformance target.
import { heatmapTrackLabel } from "./profile-names.ts";
import { normalizeGeneTracks, type GeneTrackSpec } from "./gene-tracks.ts";
import type { Contract, Track, GroupRange, ZReference, ResolvedDisplay, DisplaySpec, SortKeySpec } from "./types.ts";

// gene-track cell bitmask
export const BITS = {
  MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16,
  SV: 32, AMP: 64, HOMDEL: 128,
  DRIVER: 256,      // any alteration in the cell is annotated (putative) driver
  PROMOTER: 512,    // 5'Flank / promoter mutations
  MRNA_HIGH: 1024, MRNA_LOW: 2048, PROT_HIGH: 4096, PROT_LOW: 8192
};
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
export interface EventRow { pid: string; gene: string; vt: string; mt?: string; mv?: string; cna?: string | number }

export interface SortKey { track: string; dir: "asc" | "desc" }

/** Sort keys as authored -> the engine's ordered {track, dir} list; up to 4. */
export function normalizeSort(sort: SortKeySpec[] | undefined): { track: string; dir: "asc" | "desc" }[] {
  const list = Array.isArray(sort) && sort.length ? sort : ["genomic"];
  return list.slice(0, 4).map((s) => {
    if (typeof s === "string") return s.startsWith("-") ? { track: s.slice(1), dir: "desc" as const } : { track: s, dir: "asc" as const };
    return { track: String((s && s.track) || ""), dir: (s && s.dir === "desc" ? "desc" : "asc") as "asc" | "desc" };
  });
}

const DISPLAY_KEYS = ["showUnaltered", "whitespace", "gaps", "clinicalLegends", "colorByType", "hideVUS", "annotate", "whiteBackground", "style", "colors"] as const;
const GAP_MODES = ["none", "gaps", "pct"] as const;
const LEGEND_MODES = ["all", "none"] as const;
const ANNOTATE_MODES = ["oncokb", "none"] as const;

/** Viewing options with defaults filled in. Unknown keys and values are rejected, never ignored. */
export function normalizeDisplay(d: DisplaySpec | undefined): ResolvedDisplay {
  const src = (d || {}) as Record<string, unknown>;
  for (const k of Object.keys(src))
    if (!(DISPLAY_KEYS as readonly string[]).includes(k))
      throw new Error("display: unknown option '" + k + "' (accepted: " + DISPLAY_KEYS.join(", ") + ")");
  const bool = (k: "showUnaltered" | "whitespace" | "colorByType" | "hideVUS" | "whiteBackground", dflt: boolean): boolean => {
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
  return {
    showUnaltered: bool("showUnaltered", true),
    whitespace: bool("whitespace", true),
    gaps: oneOf("gaps", GAP_MODES, "none"),
    clinicalLegends: oneOf("clinicalLegends", LEGEND_MODES, "all"),
    colorByType: bool("colorByType", true),
    hideVUS: bool("hideVUS", false),
    annotate: oneOf("annotate", ANNOTATE_MODES, "oncokb"),
    whiteBackground: bool("whiteBackground", false),
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
  /** study label(s) for the contract header; more than one adds a categorical Study track */
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
  /** driver call per event, and the source to echo in conventions */
  isDriver: (r: EventRow) => boolean;
  annotationSource: string;
  /** clinical attributes in track order, each with its per-column value */
  clinical: { attr: string; values: Map<string, string> }[];
  /** continuous per-gene values per profile, keyed "<columnId>|<gene>" */
  heatmap: { profileType: string; genes: string[]; isVaf: boolean; values: Map<string, number> }[];
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
  const hideVus = !!input.display?.hideVUS;
  let hiddenVus = 0;
  for (const r of events) {
    const i = pidIndex.get(r.pid);
    if (i === undefined) continue;
    const rows = rowsOfGene.get(r.gene);
    if (!rows) continue;
    let bit = 0;
    if (r.vt === "mutation") bit = mutClassBit(r.mt);
    else if (r.vt === "structural_variant") bit = BITS.SV;
    else if (r.vt === "cna") bit = Number(r.cna) >= 2 ? BITS.AMP : (Number(r.cna) <= -2 ? BITS.HOMDEL : 0);
    if (!bit) continue;
    const driver = isDriver(r);
    if (hideVus && !driver) {
      hiddenVus++;
      for (const cells of rows) if (cells[i] === NOT_PROFILED) cells[i] = 0;   // it was still assayed
      continue;
    }
    if (driver) bit |= BITS.DRIVER;
    for (const cells of rows) cells[i] = (cells[i] === NOT_PROFILED ? 0 : cells[i]) | bit; // an observed event implies profiled
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
    clinTracks.push({ kind: "clinical", label: "Study", categories: studies.slice(), cells });
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
      const span = max - min || 1;
      const cells = new Int32Array(allPids.length).fill(-1);
      for (let i = 0; i < val.length; i++) {
        const v = val[i];
        if (v == null) continue;
        const x = Number(v);
        if (Number.isFinite(x)) cells[i] = Math.round(255 * (x - min) / span);
      }
      clinTracks.push({ kind: "clinical", numeric: true, label: attr, min, max, cells });
      continue;
    }
    const counts = new Map<string, number>();
    for (let i = 0; i < val.length; i++) { const v = val[i]; if (v != null) counts.set(v, (counts.get(v) || 0) + 1); }
    const categories = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map((e) => e[0]);
    const catIdx = new Map<string, number>(categories.map((c, i) => [c, i]));
    const cells = new Int32Array(allPids.length).fill(-1);
    for (let i = 0; i < val.length; i++) {
      const v = val[i];
      if (v != null) { const ci = catIdx.get(v); cells[i] = ci === undefined ? categories.length : ci; } // last = Other
    }
    const hasOther = [...counts.keys()].some((v) => !catIdx.has(v));
    clinTracks.push({ kind: "clinical", label: attr, categories: hasOther ? [...categories, "Other"] : categories, cells });
  }

  phase("clinical");
  // ---- heatmap tracks (continuous molecular-profile values per gene) ----
  // Portal-style: z-score profiles get a fixed diverging ramp (±3, center 0)
  // so colors are comparable across oncoprints; other profiles that span zero
  // get a symmetric diverging ramp; positive-only data gets a sequential ramp.
  const heatTracks: Track[] = [];
  for (const h of heatmap) {
    const isZ = /zscore/i.test(h.profileType);
    for (const gene of h.genes) {
      const label = heatmapTrackLabel(gene, h.profileType);
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
      let min: number, max: number, center: number | null;
      if (h.isVaf) { min = 0; max = 1; center = null; }
      else if (isZ || usingRef) { min = -3; max = 3; center = 0; }
      else {
        const dMin = Math.min(...vals), dMax = Math.max(...vals);
        if (dMin < 0 && dMax > 0) { const m = Math.max(-dMin, dMax); min = -m; max = m; center = 0; }
        else { min = dMin; max = dMax; center = null; }
      }
      const span = max - min || 1;
      const cells = new Int32Array(allPids.length).fill(-1);
      allPids.forEach((p, i) => {
        const v = h.values.get(p + "|" + gene);
        if (v !== undefined) cells[i] = Math.round(255 * (Math.max(min, Math.min(max, tx(v))) - min) / span);
      });
      heatTracks.push({ kind: "heatmap", numeric: true, label, gene, profileType: h.profileType,
        note: usingRef
          ? "z-scored against " + ref!.n.toLocaleString() + " patients pooled from " + ref!.studies.length +
            " stud" + (ref!.studies.length === 1 ? "y" : "ies") + " (" + ref!.studies.join(", ") + ") — " +
            "the reference is federated even where the columns are not"
          : h.isVaf ? "allele fraction, max across a patient's mutations in the gene" : "mean across a patient's samples",
        min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100,
        center: center == null ? null : Math.round(255 * (0 - min) / span), cells });
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
  // Default is the genomic staircase: cells ranked by alteration type (CNA > SV >
  // truncating > in-frame > splice > missense > other), driver above VUS within
  // each type. sort can put clinical/derived tracks first ("-" = descending,
  // missing values always last); the staircase and patient id remain the final
  // tiebreakers so every sort is total and deterministic.
  const cellRank = (c: number): number => {
    if (c <= 0) return 0;
    const t = c & BITS.AMP ? 10 : c & BITS.HOMDEL ? 9 : c & BITS.SV ? 8 : c & BITS.TRUNCATING ? 7 :
      c & BITS.SPLICE ? 6 : c & BITS.INFRAME ? 5 : c & BITS.PROMOTER ? 4 : c & BITS.MISSENSE ? 3 :
      c & BITS.OTHER_MUT ? 2 : 1;
    return t * 2 + (c & BITS.DRIVER ? 1 : 0);
  };
  // The staircase compares every gene track in order. Doing that inside a comparator costs
  // one array read and a branch per gene per comparison — the dominant cost of a 400k-column
  // sort. Each rank is 0..17, so five bits hold it: pack the first ten genes into one float
  // (50 bits, exact in a double) and the rest into a second, then compare two numbers.
  const RANK_BITS = 32, PACKED = 10;   // ranks run 0..21, so five bits each; ten fit in a double
  const packKeys = (from: number, count: number): Float64Array => {
    const key = new Float64Array(allPids.length);
    const list = geneTracks.slice(from, from + count).map((t) => geneCells.get(t.label)!);
    for (let i = 0; i < allPids.length; i++) {
      let k = 0;
      for (const cells of list) k = k * RANK_BITS + cellRank(cells[i]);
      key[i] = k;
    }
    return key;
  };
  const keyHi = packKeys(0, PACKED);
  const keyLo = geneTracks.length > PACKED ? packKeys(PACKED, geneTracks.length - PACKED) : null;
  const genomicCmp = (x: number, y: number): number => {
    const d = keyHi[y] - keyHi[x];
    if (d) return d;
    return keyLo ? keyLo[y] - keyLo[x] : 0;
  };
  // the id tiebreaker compares integers: rank the ids once instead of on every comparison
  const idRank = new Int32Array(allPids.length);
  {
    const idx = Array.from(allPids.keys());
    idx.sort((a, b) => allPids[a] < allPids[b] ? -1 : allPids[a] > allPids[b] ? 1 : 0);
    for (let r = 0; r < idx.length; r++) idRank[idx[r]] = r;
  }
  const sortableTracks = new Map<string, Track>([...clinTracks, ...devTracks, ...heatTracks].map((t) => [t.label, t]));
  const trackCmp = (t: Track, sign: number) => (x: number, y: number): number => {
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
  const tracks: Track[] = [];
  for (const gt of geneTracks) {
    const cells = remap(geneCells.get(gt.label)!);
    const profiled = cells.filter((c) => c !== NOT_PROFILED).length;
    // an overlay is evidence about the gene, not an alteration of it: expression does not
    // enter the altered fraction, which is what the portal reports too
    const ALT = BITS.MISSENSE | BITS.TRUNCATING | BITS.INFRAME | BITS.SPLICE | BITS.OTHER_MUT | BITS.PROMOTER | BITS.SV | BITS.AMP | BITS.HOMDEL;
    const altered = cells.filter((c) => c > 0 && (c & ALT)).length;
    const driverAltered = cells.filter((c) => c > 0 && (c & ALT) && (c & BITS.DRIVER)).length;
    tracks.push({
      kind: "gene", label: gt.label, cells,
      ...(gt.members.length > 1 ? { members: gt.members } : {}),
      altered, profiled, driverAltered,
      freqPct: profiled ? Math.round(1000 * altered / profiled) / 10 : null,
      driverPct: profiled ? Math.round(1000 * driverAltered / profiled) / 10 : null
    });
  }
  for (const t of devTracks) {
    const cells = remap(t.cells);
    tracks.push({ ...t, cells, altered: cells.filter((c) => c === 1).length, profiled: cells.length,
      freqPct: Math.round(1000 * cells.filter((c) => c === 1).length / cells.length) / 10 });
  }
  for (const t of heatTracks) tracks.push({ ...t, cells: remap(t.cells) });
  for (const t of clinTracks) tracks.push({ ...t, cells: remap(t.cells) });

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
        : "one patient; a patient's samples are collapsed (clinical: patient rows win, else one sample's value; heatmap: mean across samples; VAF: max)",
      annotation: input.annotationSource, lineGap,
      sort: sort.map((s) => (s.dir === "desc" ? "-" : "") + s.track) },
    display: input.display ?? { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all", colorByType: true, hideVUS: false, annotate: "oncokb", whiteBackground: false },
    stats: { nColumns: columns.length, ms: Date.now() - t0, ...(input.display?.hideVUS ? { hiddenVus } : {}) }
  };
}
