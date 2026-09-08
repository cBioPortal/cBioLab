// Rows -> oncoprint render contract. Pure: no database, no environment, no I/O.
//
// This is the data logic of the oncoprint — bitmask cells, NOT_PROFILED from panel
// coverage, the driver bit from an annotation source, categorical/numeric clinical
// tracks, heatmap ramps, derived-event rows, column groups, the staircase sort and
// panel-aware frequencies — separated from where the rows come from. `buildContract`
// fetches from ClickHouse and calls this; a CLI or a notebook can call it on local
// tables, and a port in another language has this function as its conformance target.
import { heatmapTrackLabel } from "./profile-names.ts";
import type { Contract, Track, GroupRange, ZReference, ResolvedDisplay, DisplaySpec, SortKeySpec } from "./types.ts";

// gene-track cell bitmask
export const BITS = {
  MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16,
  SV: 32, AMP: 64, HOMDEL: 128,
  DRIVER: 256   // any alteration in the cell is annotated (putative) driver
};
export const NOT_PROFILED = -1;

export function mutClassBit(mt: string | undefined): number {
  if (!mt) return BITS.OTHER_MUT;
  const t = mt.toLowerCase();
  if (t.startsWith("missense")) return BITS.MISSENSE;
  if (t.startsWith("nonsense") || t.startsWith("frame_shift") || t.startsWith("nonstop")) return BITS.TRUNCATING;
  if (t.startsWith("in_frame")) return BITS.INFRAME;
  if (t.startsWith("splice")) return BITS.SPLICE;
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

const DISPLAY_KEYS = ["showUnaltered", "whitespace", "gaps", "clinicalLegends", "style", "colors"] as const;
const GAP_MODES = ["none", "gaps", "pct"] as const;
const LEGEND_MODES = ["all", "none"] as const;

/** Viewing options with defaults filled in. Unknown keys and values are rejected, never ignored. */
export function normalizeDisplay(d: DisplaySpec | undefined): ResolvedDisplay {
  const src = (d || {}) as Record<string, unknown>;
  for (const k of Object.keys(src))
    if (!(DISPLAY_KEYS as readonly string[]).includes(k))
      throw new Error("display: unknown option '" + k + "' (accepted: " + DISPLAY_KEYS.join(", ") + ")");
  const bool = (k: "showUnaltered" | "whitespace", dflt: boolean): boolean => {
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
    ...(src.style !== undefined ? { style: src.style as Record<string, unknown> } : {}),
    ...(colors !== undefined ? { colors } : {})
  };
}


export interface AssembleInput {
  /** gene tracks, in order (already validated / uppercased) */
  genes: string[];
  /** column groups: name + column ids in fetch order; a column id appears in at most one group */
  groups: { name: string; pids: string[] }[];
  /** study label(s) for the contract header; more than one adds a categorical Study track */
  studies: string[];
  /** column id -> study, required when studies.length > 1 */
  studyOf?: Map<string, string>;
  events: EventRow[];
  /** covered genes per column id; a covered gene is profiled-unaltered (0) unless an event says otherwise.
   *  A column absent here is NOT_PROFILED for every gene it has no event for. */
  coverage: { pid: string; genes: string[] }[];
  /** driver call per event, and the source to echo in conventions */
  isDriver: (r: EventRow) => boolean;
  annotationSource: string;
  /** clinical attributes in track order, each with its per-column value */
  clinical: { attr: string; values: Map<string, string> }[];
  /** continuous per-gene values per profile, keyed "<columnId>|<gene>" */
  heatmap: { profileType: string; genes: string[]; isVaf: boolean; values: Map<string, number> }[];
  /** "<profileType>|<gene>" -> pooled reference (federated z-scoring) */
  zReference?: Record<string, ZReference>;
  /** binary phenotype rows: the column ids in the set draw as 1 */
  derived: { label: string; pids: Set<string> }[];
  sort: SortKey[];
  lineGap: number;
  /** resolved viewing options; defaults are filled in when absent */
  display?: ResolvedDisplay;
}

export function assembleContract(input: AssembleInput): Contract {
  const t0 = Date.now();
  const { genes, groups, studies, events, coverage, isDriver, clinical, heatmap, derived, sort, lineGap } = input;
  const multi = studies.length > 1;
  const studyOf = input.studyOf || new Map<string, string>();
  const allPids = groups.flatMap((g) => g.pids);
  if (!allPids.length) throw new Error("cohort is empty");
  const pidIndex = new Map<string, number>(allPids.map((p, i) => [p, i]));

  // ---- gene-track cells --------------------------------------------------
  const geneCells = new Map<string, Int32Array>(genes.map((g) => [g, new Int32Array(allPids.length).fill(NOT_PROFILED)]));
  for (const r of coverage) {
    const i = pidIndex.get(r.pid);
    if (i === undefined) continue;
    for (const g of r.genes) { const cells = geneCells.get(g); if (cells && cells[i] === NOT_PROFILED) cells[i] = 0; }
  }
  for (const r of events) {
    const i = pidIndex.get(r.pid);
    if (i === undefined) continue;
    const cells = geneCells.get(r.gene);
    if (!cells) continue;
    let bit = 0;
    if (r.vt === "mutation") bit = mutClassBit(r.mt);
    else if (r.vt === "structural_variant") bit = BITS.SV;
    else if (r.vt === "cna") bit = Number(r.cna) >= 2 ? BITS.AMP : (Number(r.cna) <= -2 ? BITS.HOMDEL : 0);
    if (!bit) continue;
    if (isDriver(r)) bit |= BITS.DRIVER;
    cells[i] = (cells[i] === NOT_PROFILED ? 0 : cells[i]) | bit; // an observed event implies profiled
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
    // numeric attribute (≥90% of present values parse, >10 distinct) -> continuous
    // heat track: cells are the value scaled to 0..255 over the cohort's min..max
    const present = allPids.map((p) => valByPid.get(p)).filter((v): v is string => v != null);
    if (!present.length) { // unknown attribute or none of these patients have it — say so
      clinTracks.push({ kind: "clinical", label: attr + " (no data)", categories: [], cells: new Int32Array(allPids.length).fill(-1) });
      continue;
    }
    const nums = present.map(Number).filter(Number.isFinite);
    if (present.length && nums.length >= 0.9 * present.length && new Set(nums).size > 10) {
      const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
      const cells = new Int32Array(allPids.length).fill(-1);
      allPids.forEach((p, i) => {
        const x = Number(valByPid.get(p));
        if (Number.isFinite(x)) cells[i] = Math.round(255 * (x - min) / span);
      });
      clinTracks.push({ kind: "clinical", numeric: true, label: attr, min, max, cells });
      continue;
    }
    const counts = new Map<string, number>();
    for (const p of allPids) { const v = valByPid.get(p); if (v != null) counts.set(v, (counts.get(v) || 0) + 1); }
    const categories = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map((e) => e[0]);
    const catIdx = new Map<string, number>(categories.map((c, i) => [c, i]));
    const cells = new Int32Array(allPids.length).fill(-1);
    allPids.forEach((p, i) => {
      const v = valByPid.get(p);
      if (v != null) cells[i] = catIdx.has(v) ? catIdx.get(v)! : categories.length; // last = Other
    });
    const hasOther = [...counts.keys()].some((v) => !catIdx.has(v));
    clinTracks.push({ kind: "clinical", label: attr, categories: hasOther ? [...categories, "Other"] : categories, cells });
  }

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

  // ---- derived-event tracks (cohort-DSL expressions as phenotypes) ------
  const devTracks: Track[] = [];
  for (const de of derived) {
    const cells = new Int32Array(allPids.length);
    allPids.forEach((p, i) => { cells[i] = de.pids.has(p) ? 1 : 0; });
    devTracks.push({ kind: "derivedEvent", label: String(de.label || "derived event").slice(0, 60), cells });
  }

  // ---- column sort within groups ----------------------------------------
  // Default is the genomic staircase: cells ranked by alteration type (CNA > SV >
  // truncating > in-frame > splice > missense > other), driver above VUS within
  // each type. sort can put clinical/derived tracks first ("-" = descending,
  // missing values always last); the staircase and patient id remain the final
  // tiebreakers so every sort is total and deterministic.
  const cellRank = (c: number): number => {
    if (c <= 0) return 0;
    const t = c & BITS.AMP ? 8 : c & BITS.HOMDEL ? 7 : c & BITS.SV ? 6 : c & BITS.TRUNCATING ? 5 :
      c & BITS.INFRAME ? 4 : c & BITS.SPLICE ? 3 : c & BITS.MISSENSE ? 2 : 1;
    return t * 2 + (c & BITS.DRIVER ? 1 : 0);
  };
  const genomicCmp = (x: number, y: number): number => {
    for (const gene of genes) {
      const cells = geneCells.get(gene)!;
      const rx = cellRank(cells[x]), ry = cellRank(cells[y]);
      if (rx !== ry) return ry - rx;
    }
    return 0;
  };
  const sortableTracks = new Map<string, Track>([...clinTracks, ...devTracks, ...heatTracks].map((t) => [t.label, t]));
  const trackCmp = (t: Track, sign: number) => (x: number, y: number): number => {
    const a = (t.cells as number[])[x], b = (t.cells as number[])[y];
    if (a === b) return 0;
    if (a === -1) return 1;
    if (b === -1) return -1;
    return sign * (a - b);
  };
  const byId = (x: number, y: number): number => allPids[x] < allPids[y] ? -1 : allPids[x] > allPids[y] ? 1 : 0;
  const cmps: ((x: number, y: number) => number)[] = sort.map((s) => {
    const sign = s.dir === "desc" ? -1 : 1;
    if (s.track === "genomic") return (x: number, y: number) => sign * genomicCmp(x, y);
    if (s.track === "id") return (x: number, y: number) => sign * byId(x, y);
    const t = sortableTracks.get(s.track);
    if (!t) throw new Error("sort: '" + s.track + "' is not a track in this oncoprint — sortable: genomic, id" +
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
      return allPids[x] < allPids[y] ? -1 : 1;
    });
    for (const i of idxs) order.push(i); // not push(...idxs): spreads over ~100k args overflow the stack
    groupRanges.push({ name: g.name, start: cursor, count: idxs.length });
    cursor += idxs.length;
  }
  const remap = (arr: number[] | Int32Array): number[] => order.map((i) => (arr as number[])[i]);
  const columns = order.map((i) => allPids[i]);

  // ---- track meta (panel-aware frequencies) -----------------------------
  const tracks: Track[] = [];
  for (const g of genes) {
    const cells = remap(geneCells.get(g)!);
    const profiled = cells.filter((c) => c !== NOT_PROFILED).length;
    const altered = cells.filter((c) => c > 0).length;
    const driverAltered = cells.filter((c) => c > 0 && (c & BITS.DRIVER)).length;
    tracks.push({
      kind: "gene", label: g, cells,
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

  return {
    study: multi ? studies.join(" + ") : studies[0], studies, unit: "patient",
    groups: groupRanges,
    columns,
    tracks: tracks.map((t) => ({ ...t, cells: Array.from(t.cells as number[]) })),
    conventions: { cna: "high-level only (±2)", notProfiled: "distinct cell state", frequencyDenominator: "profiled",
      annotation: input.annotationSource, lineGap,
      sort: sort.map((s) => (s.dir === "desc" ? "-" : "") + s.track) },
    display: input.display ?? { showUnaltered: true, whitespace: true, gaps: "none", clinicalLegends: "all" },
    stats: { nColumns: columns.length, ms: Date.now() - t0 }
  };
}
