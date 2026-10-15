// Single-cell cell metadata summarised per patient and per sample, as custom datasets for a study:
// the share of each label's values among a case's cells, and the mean of each per-cell score.
//
// Browser-safe and pure: the review page (app/singlecell/) and the CLI
// (scripts/gen-singlecell-summary.ts) run this one implementation, so what a data owner previews is
// what the file the CLI writes holds. Reading the columns is lib/singlecell/zarr.ts; matching ids to
// the study is the server's (lib/singlecell-server.ts).
import type { CustomDataset } from "../custom-data-names.ts";
import type { ObsColumn } from "./zarr.ts";

/** One dataset's part of a summary. A config may hold several (a dataset split into files). */
export interface SingleCellSource {
  /** the zarr store(s); several files with the same columns are read as one */
  zarr: string | string[];
  /** starts every column this source writes (EPI → EPI_Cell_Type_STM) */
  prefix: string;
  /** categorical columns whose values become shares */
  labels: string[];
  /** numeric columns averaged */
  scores: string[];
  /** keep only cells whose column takes one of these values (tumour samples, one compartment) */
  where: Record<string, string[]>;
  /** why this source exists, for the reviewer who reads the config later */
  _note?: string;
}

export interface SingleCellConfig {
  study: string;
  /** the custom datasets are `<id>-p` and `<id>-s` */
  id: string;
  name: string;
  /** the Cell Explorer dataset the config was drafted from */
  cellExplorer?: string;
  /** the obs column naming the patient, and the patient attribute its values match (null: the patient id itself) */
  patient: { obs: string; attribute: string | null };
  /** the obs column naming the sample, and the sample attribute its values match (null: the sample id itself) */
  sample: { obs: string; attribute: string | null } | null;
  sources: SingleCellSource[];
  /** a share needs this many cells in its denominator, else it is left blank */
  minCells: number;
  /** a mean needs this many cells with a value */
  minScoreCells: number;
}

export const DEFAULT_MIN_CELLS = 50;
export const DEFAULT_MIN_SCORE_CELLS = 20;
/** past this many values a label is a cell id or a barcode, not a label to summarise */
export const MAX_LABEL_VALUES = 40;

/** CELLxGENE schema columns: required metadata, never a label or score worth summarising */
const STANDARD = /(_ontology_term_id$|^observation_joinid$|^is_primary_data$|^suspension_type$|^tissue_type$|^assay$|^organism$|^sex$|^self_reported_ethnicity$|^development_stage$|^disease$|^donor_id$|^_index$)/;
const SCORE_NAME = /score|module|pathway|signature|program/i;
const QC_NAME = /count|percent|pct|n_genes|nfeature|ncount|doublet|mito|ribo|^total|log1p/i;

/** an obs column name as a custom-data column name: letters, digits and underscores */
export function colName(s: string): string {
  return (String(s).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)) || "x";
}

/** What the catalog (or a read) says about a column, enough to judge it. */
/** `dtype` as the catalog spells it: "categorical", "numeric", or another it does not judge */
export interface ColumnInfo { name: string; dtype: string; cardinality: number | null }

export type ColumnRole = "label" | "score" | "skip";
export interface ColumnJudgement {
  name: string; role: ColumnRole;
  /** why: a reason a reviewer can check, worded for them */
  why: string;
  /** a judgement that needs the column read (does it vary within a sample?) */
  needsRead?: boolean;
}

/**
 * A first judgement of each column from its name, type and number of values — before any read.
 * Labels still have to vary within a sample (a column that never does describes the sample, not
 * the cell); `varies` decides that once the column and the sample column are read.
 */
export function judgeColumns(cols: ColumnInfo[], keys: { patient: string; sample: string | null }): ColumnJudgement[] {
  return cols.map((c): ColumnJudgement => {
    const name = c.name;
    if (name === keys.patient) return { name, role: "skip", why: "names the patient" };
    if (name === keys.sample) return { name, role: "skip", why: "names the sample" };
    if (STANDARD.test(name)) return { name, role: "skip", why: "a CELLxGENE schema column (ontology ids, assay, donor metadata)" };
    if (c.dtype === "numeric") {
      if (QC_NAME.test(name)) return { name, role: "skip", why: "looks like a quality-control measure (counts, mitochondrial share)" };
      if (SCORE_NAME.test(name)) return { name, role: "score", why: "a numeric score: its mean is taken per case" };
      return { name, role: "skip", why: "numeric, but its name does not say it is a score — keep it if it is one" };
    }
    if (c.cardinality == null) return { name, role: "skip", why: "its number of values is not known" };
    if (c.cardinality < 2) return { name, role: "skip", why: "one value for every cell" };
    if (c.cardinality > MAX_LABEL_VALUES) return { name, role: "skip", why: c.cardinality.toLocaleString("en-US") + " values: more like an id than a label" };
    return { name, role: "label", why: c.cardinality + " values: its shares are taken per case", needsRead: true };
  });
}

/** true when some sample's cells take more than one of the column's values */
export function variesWithin(col: ObsColumn, unit: ObsColumn): boolean {
  if (col.kind !== "label" || unit.kind !== "label") return true;
  const seen = new Map<string, string | null>();
  for (let i = 0; i < col.values.length; i++) {
    const u = unit.values[i];
    if (u == null) continue;
    const v = col.values[i];
    if (!seen.has(u)) seen.set(u, v);
    else if (seen.get(u) !== v) return true;
  }
  return false;
}

/** 4 significant digits, trailing zeros dropped, exponent form below 1e-4 and from 1e4 (the "%.4g" style); whole numbers as they are. */
export function fmtValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  if (v === 0) return "0";
  const [mant, exp] = v.toExponential(3).split("e");
  const e = Number(exp);
  if (e < -4 || e >= 4) {
    const m = mant.includes(".") ? mant.replace(/0+$/, "").replace(/\.$/, "") : mant;
    return m + "e" + (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
  }
  const s = v.toFixed(Math.max(0, 3 - e));
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** The columns one source needs read, by name. */
export function sourceColumns(cfg: SingleCellConfig, src: SingleCellSource): string[] {
  return [...new Set([cfg.patient.obs, ...(cfg.sample ? [cfg.sample.obs] : []), ...src.labels, ...src.scores, ...Object.keys(src.where)])];
}

/** Per case, the numbers one source contributes: column name → value. */
export type CaseTable = Map<string, Map<string, number | null>>;

export interface SourceSummary {
  prefix: string;
  /** patient id → its numbers; sample id → its numbers */
  patients: CaseTable; samples: CaseTable;
  /** every column this source wrote at each level, in order */
  columns: { patient: string[]; sample: string[] };
  /** cells read, kept by `where`, and matched to a patient / a sample */
  cells: { read: number; kept: number; patient: number; sample: number };
}

/**
 * One source's summary over its columns, read already (several files' columns concatenated).
 * `toPatient` / `toSample` map an obs value to the study's id, or undefined when it is not one.
 */
export function summariseSource(cfg: SingleCellConfig, src: SingleCellSource, cols: Map<string, ObsColumn>,
  toPatient: (v: string) => string | undefined, toSample: ((v: string) => string | undefined) | null): SourceSummary {
  const get = (n: string): ObsColumn => {
    const c = cols.get(n);
    if (!c) throw new Error("column " + JSON.stringify(n) + " was not read");
    return c;
  };
  const pcol = get(cfg.patient.obs);
  const n = pcol.values.length;
  const keep = new Uint8Array(n).fill(1);
  for (const [w, vals] of Object.entries(src.where)) {
    const c = get(w), ok = new Set(vals);
    for (let i = 0; i < n; i++) if (!keep[i] || !ok.has(String(c.values[i]))) keep[i] = 0;
  }
  const label = (c: ObsColumn, i: number) => (c.kind === "label" ? c.values[i] : String(c.values[i]));
  const pkey = new Array<string | undefined>(n), skey = new Array<string | undefined>(n);
  const scol = cfg.sample && toSample ? get(cfg.sample.obs) : null;
  let kept = 0, pm = 0, sm = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    kept++;
    const pv = label(pcol, i); pkey[i] = pv == null ? undefined : toPatient(pv);
    if (pkey[i]) pm++;
    if (scol) { const sv = label(scol, i); skey[i] = sv == null ? undefined : toSample!(sv); if (skey[i]) sm++; }
  }
  const pre = src.prefix;
  // per level, the columns in order: the cell count, each label's values (those its matched cells take) sorted, then each score
  const valuesOf = (keys: (string | undefined)[]) => src.labels.map((l) => {
    const c = get(l), set = new Set<string>();
    for (let i = 0; i < n; i++) if (keep[i] && keys[i]) { const v = label(c, i); if (v != null) set.add(v); }
    return [...set].sort();
  });
  const columnsOf = (vals: string[][]) => [pre + "_N_CELLS",
    ...src.labels.flatMap((l, li) => vals[li].map((v) => pre + "_" + colName(l) + "_" + colName(v))),
    ...src.scores.map((s) => pre + "_SCORE_" + colName(s))];
  const tally = (keys: (string | undefined)[]): CaseTable => {
    const labelValues = valuesOf(keys);
    const count = new Map<string, number>();
    for (let i = 0; i < n; i++) if (keep[i] && keys[i]) count.set(keys[i]!, (count.get(keys[i]!) || 0) + 1);
    const out: CaseTable = new Map();
    for (const [k, c] of count) out.set(k, new Map([[pre + "_N_CELLS", c]]));
    src.labels.forEach((l, li) => {
      const c = get(l), per = new Map<string, Map<string, number>>();
      for (let i = 0; i < n; i++) {
        if (!keep[i] || !keys[i]) continue;
        const v = label(c, i);
        if (v == null) continue;
        const m = per.get(keys[i]!) || new Map<string, number>();
        m.set(v, (m.get(v) || 0) + 1); per.set(keys[i]!, m);
      }
      for (const [k, total] of count) {
        const m = per.get(k);
        for (const v of labelValues[li])
          out.get(k)!.set(pre + "_" + colName(l) + "_" + colName(v), total >= cfg.minCells ? (m?.get(v) || 0) / total : null);
      }
    });
    for (const s of src.scores) {
      const c = get(s), sum = new Map<string, number>(), cnt = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        if (!keep[i] || !keys[i]) continue;
        const v = c.kind === "number" ? c.values[i] : Number(c.values[i]);
        if (!Number.isFinite(v)) continue;
        sum.set(keys[i]!, (sum.get(keys[i]!) || 0) + v); cnt.set(keys[i]!, (cnt.get(keys[i]!) || 0) + 1);
      }
      for (const k of count.keys()) {
        const m = cnt.get(k) || 0;
        out.get(k)!.set(pre + "_SCORE_" + colName(s), m >= cfg.minScoreCells ? sum.get(k)! / m : null);
      }
    }
    return out;
  };
  return { prefix: pre, patients: tally(pkey), samples: scol ? tally(skey) : new Map(),
    columns: { patient: columnsOf(valuesOf(pkey)), sample: scol ? columnsOf(valuesOf(skey)) : [] },
    cells: { read: n, kept, patient: pm, sample: sm } };
}

/**
 * The custom datasets: one per level (and a second, third … past 64 columns), every source's
 * columns side by side, a column no case has a value in left out, rows in id order.
 * `patientOfSample` names each sample's patient.
 */
export function toDatasets(cfg: SingleCellConfig, parts: SourceSummary[], patientOfSample: (sample: string) => string): CustomDataset[] {
  const out: CustomDataset[] = [];
  for (const level of ["patient", "sample"] as const) {
    const tables = parts.map((p) => (level === "patient" ? p.patients : p.samples));
    const ids = [...new Set(tables.flatMap((t) => [...t.keys()]))].sort();
    if (!ids.length) continue;
    const columns = parts.flatMap((p, i) => p.columns[level].filter((c) => ids.some((id) => tables[i].get(id)?.get(c) != null)).map((c) => ({ c, i })));
    for (let k = 0; k * 64 < columns.length; k++) {
      const chunk = columns.slice(k * 64, k * 64 + 64);
      out.push({
        id: (cfg.id + "-" + level[0] + (k ? String(k + 1) : "")).slice(0, 40),
        name: cfg.name + " — per " + level + (k ? " (" + (k + 1) + ")" : ""),
        level,
        columns: chunk.map(({ c }) => ({ name: c, datatype: "NUMBER" as const })),
        rows: ids.map((id) => ({
          study: cfg.study,
          patient: level === "sample" ? patientOfSample(id) : id,
          ...(level === "sample" ? { sample: id } : {}),
          values: chunk.map(({ c, i }) => fmtValue(tables[i].get(id)?.get(c) ?? null)),
        })),
      });
    }
  }
  return out;
}

/** A dataset as a TSV a reader uploads in Explore → Custom data. */
export function datasetTsv(d: CustomDataset): string {
  const head = [d.level === "sample" ? "SAMPLE_ID" : "PATIENT_ID", ...d.columns.map((c) => c.name)];
  return [head.join("\t"), ...d.rows.map((r) => [r.sample ?? r.patient, ...r.values].join("\t"))].join("\n") + "\n";
}

/** Checks a config before anything is read; throws naming what is wrong. */
export function validateConfig(cfg: SingleCellConfig): void {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(cfg.study || "")) throw new Error("study names a cBioPortal study");
  if (!/^[a-z0-9][a-z0-9-]{0,35}$/.test(cfg.id || "")) throw new Error("id is lowercase letters, digits and dashes (at most 36), e.g. hta11-sc");
  if (!cfg.patient?.obs) throw new Error("patient.obs names the column holding the patient");
  if (!cfg.sources?.length) throw new Error("a config needs at least one source");
  const prefixes = cfg.sources.map((s) => s.prefix);
  if (new Set(prefixes).size < prefixes.length) throw new Error("two sources share the prefix " + prefixes.find((p, i) => prefixes.indexOf(p) !== i));
  for (const s of cfg.sources) {
    if (!/^[A-Z][A-Z0-9_]{0,11}$/.test(s.prefix)) throw new Error("a prefix is 1–12 capitals, digits or underscores, starting with a capital: " + JSON.stringify(s.prefix));
    if (!s.labels.length && !s.scores.length) throw new Error("source " + s.prefix + " keeps no label and no score");
  }
  if (!(cfg.minCells >= 1) || !(cfg.minScoreCells >= 1)) throw new Error("minCells and minScoreCells are at least 1");
}
