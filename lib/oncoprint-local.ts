// Local tables -> assembler input. The Oncoprinter-style formats a CLI or a notebook
// hands us, turned into the rows `assembleContract` expects. Pure, no I/O: callers
// read the files.
//
//   events    patient  gene  alteration  type      type = MISSENSE | INFRAME | TRUNC | SPLICE | PROMOTER | OTHER
//                                                       | FUSION | AMP | GAIN | HETLOSS | HOMDEL, with an optional
//                                                       _DRIVER suffix (and a tolerated _GERMLINE suffix)
//   clinical  patient  ATTR1  ATTR2 ...             attribute names may carry Oncoprinter's (number)/(string) suffix
//   coverage  patient  genes                        comma-separated genes the patient's panel covers
import { normalizeDisplay, type AssembleInput, type EventRow, type SortKey } from "./oncoprint-assemble.ts";
import { geneSymbols, type GeneTrackSpec } from "./gene-tracks.ts";
import type { DisplaySpec } from "./types.ts";
import { CLINICAL_MISSING_VALUES } from "./event-names.ts";

export type Table = Record<string, string>[];

export function parseTsv(text: string): Table {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length && !l.startsWith("#"));
  if (!lines.length) return [];
  const header = lines[0].split("\t").map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split("\t");
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
}

const idColumn = (row: Record<string, string>): string => {
  for (const k of Object.keys(row)) if (/^(patient|sample|case)(_?id)?$/i.test(k)) return k;
  return Object.keys(row)[0];
};

type LocalEvent = EventRow & { driver: boolean };

const TYPE_MAP: Record<string, Partial<LocalEvent>> = {
  MISSENSE: { vt: "mutation", mt: "Missense_Mutation" },
  INFRAME: { vt: "mutation", mt: "In_Frame_Del" },
  TRUNC: { vt: "mutation", mt: "Nonsense_Mutation" },
  SPLICE: { vt: "mutation", mt: "Splice_Site" },
  PROMOTER: { vt: "mutation", mt: "Other" },
  OTHER: { vt: "mutation", mt: "Other" },
  FUSION: { vt: "structural_variant" },
  AMP: { vt: "cna", cna: 2 }, GAIN: { vt: "cna", cna: 1 }, HETLOSS: { vt: "cna", cna: -1 }, HOMDEL: { vt: "cna", cna: -2 }
};

export function eventsFromTable(rows: Table): LocalEvent[] {
  const out: LocalEvent[] = [];
  for (const r of rows) {
    const pid = r[idColumn(r)];
    const gene = String(r.gene ?? r.Gene ?? r.GENE ?? "").toUpperCase().trim();
    let type = String(r.type ?? r.Type ?? r.TYPE ?? "").toUpperCase().trim();
    if (!pid || !gene || !type) continue;
    let driver = /^(1|true|yes|driver)$/i.test(String(r.driver ?? r.Driver ?? ""));
    if (type.endsWith("_DRIVER")) { driver = true; type = type.slice(0, -7); }
    if (type.endsWith("_GERMLINE")) type = type.slice(0, -9);
    if (type.endsWith("_DRIVER")) { driver = true; type = type.slice(0, -7); }
    const m = TYPE_MAP[type];
    if (!m) throw new Error("events: unknown type '" + type + "' for " + pid + "/" + gene + " (accepted: " + Object.keys(TYPE_MAP).join(", ") + ", optional _DRIVER suffix)");
    out.push({ pid, gene, vt: m.vt!, mt: m.mt, cna: m.cna, mv: r.alteration ?? r.Alteration, driver });
  }
  return out;
}

export function clinicalFromTable(rows: Table): { attr: string; values: Map<string, string> }[] {
  if (!rows.length) return [];
  const id = idColumn(rows[0]);
  const attrs = Object.keys(rows[0]).filter((k) => k !== id);
  return attrs.map((raw) => {
    const attr = raw.replace(/\((number|string|lognumber)\)\s*$/i, "").trim();
    const values = new Map<string, string>();
    for (const r of rows) { const v = r[raw]; if (v != null && !CLINICAL_MISSING_VALUES.includes(v.trim().toLowerCase())) values.set(r[id], v); }
    return { attr, values };
  });
}

export function coverageFromTable(rows: Table): { pid: string; genes: string[] }[] {
  if (!rows.length) return [];
  const id = idColumn(rows[0]);
  const byPid = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byPid.get(r[id]) ?? new Set<string>();
    const g = r.genes ?? r.gene ?? r.Genes ?? r.Gene ?? "";
    for (const x of String(g).split(/[,;\s]+/)) if (x) set.add(x.toUpperCase());
    byPid.set(r[id], set);
  }
  return [...byPid.entries()].map(([pid, genes]) => ({ pid, genes: [...genes] }));
}

export function parseSort(spec: string | string[] | undefined): SortKey[] {
  const list = (Array.isArray(spec) ? spec : String(spec || "").split(",")).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return [{ track: "genomic", dir: "asc" }];
  return list.map((s) => s.startsWith("-") ? { track: s.slice(1), dir: "desc" as const } : { track: s, dir: "asc" as const });
}

export interface LocalOptions {
  events: Table;
  clinical?: Table;
  coverage?: Table;
  /** the rows: a gene symbol, or {label?, genes} for a merged row. Default: the genes in the
   * events, first appearance order, one row each. */
  genes?: GeneTrackSpec[];
  /** a clinical attribute whose values become column groups, in first-appearance order */
  groupBy?: string;
  /** explicit column ids and order; default: union of the tables, first appearance */
  patients?: string[];
  sort?: string | string[];
  study?: string;
  annotationSource?: string;
  /** viewing options; validated and defaulted like any other spec */
  display?: DisplaySpec;
  /** what a column is; local tables decide for themselves what their rows are keyed by */
  unit?: "patient" | "sample";
}

/** Everything `assembleContract` needs, from local tables. Without a coverage table every column is covered for every gene. */
export function localInput(o: LocalOptions): AssembleInput {
  const events = eventsFromTable(o.events);
  const clinical = clinicalFromTable(o.clinical || []);
  const geneList: GeneTrackSpec[] = o.genes && o.genes.length ? o.genes : [...new Set(events.map((e) => e.gene))];
  const genes = geneSymbols(geneList);   // the flat symbols: what "covered for every gene" means below
  let patients: string[];
  if (o.patients && o.patients.length) patients = o.patients;
  else {
    const seen = new Set<string>();
    patients = [];
    const add = (p: string) => { if (p && !seen.has(p)) { seen.add(p); patients.push(p); } };
    for (const e of events) add(e.pid);
    if (o.clinical) { const id = o.clinical.length ? idColumn(o.clinical[0]) : ""; for (const r of o.clinical) add(r[id]); }
    if (o.coverage) { const id = o.coverage.length ? idColumn(o.coverage[0]) : ""; for (const r of o.coverage) add(r[id]); }
  }
  const coverage = o.coverage && o.coverage.length ? coverageFromTable(o.coverage) : patients.map((pid) => ({ pid, genes }));
  let groups: { name: string; pids: string[] }[];
  if (o.groupBy) {
    const attr = clinical.find((c) => c.attr === o.groupBy);
    if (!attr) throw new Error("groupBy: '" + o.groupBy + "' is not a clinical attribute (have: " + clinical.map((c) => c.attr).join(", ") + ")");
    const byVal = new Map<string, string[]>();
    for (const p of patients) { const v = attr.values.get(p) ?? "(none)"; (byVal.get(v) ?? byVal.set(v, []).get(v)!).push(p); }
    groups = [...byVal.entries()].map(([name, pids]) => ({ name, pids }));
  } else groups = [{ name: "all", pids: patients }];
  return {
    genes: geneList, groups, studies: [o.study || "local"], events, coverage,
    isDriver: (r) => !!(r as LocalEvent).driver, annotationSource: o.annotationSource || "driver flags from the input",
    clinical, heatmap: [], derived: [], sort: parseSort(o.sort), lineGap: 90, display: normalizeDisplay(o.display), unit: o.unit
  };
}
