// Custom data: annotations a researcher uploads (a curated "metastasis site", an AI-extracted
// field), used exactly like the study's own clinical attributes.
//
// An uploaded column is addressed as `custom:<dataset>/<COLUMN>`. Uploads are stored on the
// server (lib/custom-store.ts) and named by a request as `customRefs`; the request boundary
// (lib/custom-data-server.ts) reads them, or takes rows sent inline (the gallery's bundled demo
// data, tests, scripts), and for the length of that request merges them into the clinical
// tables at query time:
//
//   clinicalTable(db, attrs) = db.clinical_data_derived    UNION ALL  _custom_clinical[_<subset>]
//                              (recorded values only, either way)
//   clinicalMetaTable(db)    = db.clinical_attribute_meta  UNION ALL  _custom_meta
//
// `_custom_clinical` / `_custom_meta` are ClickHouse external tables, uploaded by lib/ch.ts with
// any statement that names them and with no other. So every reader of the clinical tables —
// cohort leaves, Explore facets, oncoprint tracks, split arms, compare, survival, plots — sees an
// uploaded column as one more attribute, and nothing is ever written to ClickHouse.
//
// With no custom data in the request, clinicalMetaTable returns the plain table name and
// clinicalTable the study's own rows with a recorded value.
//
// Patient-data boundary (docs/DATA-BOUNDARY.md): the rows are patient-level. They are merged
// only into databases of patient-level connections (`allowedConns`, decided at the request
// boundary by lib/custom-data-server.ts), and lib/ch.ts refuses to upload them anywhere else.
//
// Pure apart from the AsyncLocalStorage: no I/O, safe to import from lib/ch.ts.
import { AsyncLocalStorage } from "node:async_hooks";
import { clinicalRecordedSql } from "./event-names.ts";

import {
  CUSTOM_PREFIX, CUSTOM_REF_RE, LIMITS, customAttr, isCustomAttr,
  type CustomColumn, type CustomRow, type CustomDataset, type CustomDatatype, type CustomLevel
} from "./custom-data-names.ts";
export * from "./custom-data-names.ts";

const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COLUMN_RE = /^[A-Za-z0-9_]{1,64}$/;
const STUDY_RE = /^[A-Za-z0-9._-]{1,100}$/;
const CASE_ID_RE = /^[^\t\n\r\\]{1,100}$/;

/**
 * The request's `customData`, checked. Throws a specific error rather than dropping anything:
 * a dataset silently cut short would answer a different question than the one asked.
 */
export function validateCustomData(input: unknown): CustomDataset[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("customData must be an array of datasets");
  if (input.length > LIMITS.datasets)
    throw new Error("a request carries at most " + LIMITS.datasets + " custom datasets; this one has " + input.length);
  const seen = new Set<string>();
  let cells = 0;
  const out = input.map((raw, i): CustomDataset => {
    const d = raw as Partial<CustomDataset>;
    const where = "customData[" + i + "]";
    if (!d || typeof d !== "object") throw new Error(where + " is not a dataset");
    const id = String(d.id ?? "");
    if (!DATASET_ID_RE.test(id)) throw new Error(where + ".id must be lowercase letters, digits and dashes (at most 40), got " + JSON.stringify(id));
    if (seen.has(id)) throw new Error("custom dataset '" + id + "' appears twice");
    seen.add(id);
    const level = d.level === "sample" ? "sample" : d.level === "patient" ? "patient" : null;
    if (!level) throw new Error("custom dataset '" + id + "': level must be 'patient' or 'sample'");
    if (!Array.isArray(d.columns) || !d.columns.length) throw new Error("custom dataset '" + id + "' has no columns");
    if (d.columns.length > LIMITS.columns)
      throw new Error("custom dataset '" + id + "' has " + d.columns.length + " columns; the limit is " + LIMITS.columns);
    const colNames = new Set<string>();
    const columns = d.columns.map((c): CustomColumn => {
      const name = String(c?.name ?? "");
      if (!COLUMN_RE.test(name)) throw new Error("custom dataset '" + id + "': column " + JSON.stringify(name) + " must be letters, digits and underscores");
      if (colNames.has(name)) throw new Error("custom dataset '" + id + "': column '" + name + "' appears twice");
      colNames.add(name);
      if (c.datatype !== "STRING" && c.datatype !== "NUMBER") throw new Error("custom dataset '" + id + "': column '" + name + "' datatype must be STRING or NUMBER");
      return { name, datatype: c.datatype };
    });
    if (!Array.isArray(d.rows)) throw new Error("custom dataset '" + id + "' has no rows");
    cells += d.rows.length * columns.length;
    if (cells > LIMITS.cells)
      throw new Error("custom data in one request is limited to " + LIMITS.cells.toLocaleString("en-US") + " values (rows × columns); this request has more");
    const rows = d.rows.map((r, j): CustomRow => {
      const at = "custom dataset '" + id + "' row " + (j + 1);
      const study = String(r?.study ?? ""), patient = String(r?.patient ?? "");
      if (!STUDY_RE.test(study)) throw new Error(at + ": invalid study " + JSON.stringify(study));
      if (!CASE_ID_RE.test(patient)) throw new Error(at + ": invalid patient id");
      let sample: string | undefined;
      if (level === "sample") {
        sample = String(r.sample ?? "");
        if (!CASE_ID_RE.test(sample)) throw new Error(at + ": a sample-level dataset needs a sample id on every row");
      }
      if (!Array.isArray(r.values) || r.values.length !== columns.length)
        throw new Error(at + ": expected " + columns.length + " values, got " + (Array.isArray(r.values) ? r.values.length : "none"));
      const values = r.values.map((v) => {
        const s = v == null ? "" : String(v).trim();
        if (s.length > LIMITS.valueLength) throw new Error(at + ": a value is longer than " + LIMITS.valueLength + " characters");
        return s;
      });
      return sample ? { study, patient, sample, values } : { study, patient, values };
    });
    const name = String(d.name ?? id).slice(0, LIMITS.nameLength) || id;
    return { id, name, level, columns, rows };
  });
  return out;
}

// ---------------------------------------------------------------------------
// The request's custom data
// ---------------------------------------------------------------------------

export interface CustomCtx {
  datasets: CustomDataset[];
  /** connection ids entitled to receive the rows (patient-level instances only) */
  allowedConns: Set<string>;
  /** database names on those connections: the only ones whose clinical tables are merged */
  allowedDbs: Set<string>;
  /** the encoded external tables, built once per request on first use */
  enc?: { clinical: string; meta: string };
  /** per-statement subsets of the clinical rows: external table name -> the custom attributes it holds */
  subsets?: Map<string, Set<string>>;
  encSubsets?: Map<string, string>;
}
const store = new AsyncLocalStorage<CustomCtx>();

/** Run `fn` with these datasets merged into the clinical tables of the allowed databases. */
export function withCustomData<T>(ctx: Omit<CustomCtx, "enc" | "subsets" | "encSubsets">, fn: () => Promise<T>): Promise<T> {
  if (!ctx.datasets.length) return fn();
  return store.run({ ...ctx }, fn);
}
export function activeCustomData(): CustomCtx | null {
  const s = store.getStore();
  return s && s.datasets.length ? s : null;
}
/**
 * True when results of this request depend on uploaded data. Such a result is the uploader's
 * alone: it must never be written to the shared result cache (lib/next-cache.ts), where any other
 * reader asking the same question would be served it.
 */
export function hasCustomData(): boolean {
  return !!activeCustomData();
}

export const CUSTOM_CLINICAL_TABLE = "_custom_clinical";
export const CUSTOM_META_TABLE = "_custom_meta";
export const CUSTOM_CLINICAL_STRUCTURE =
  "cancer_study_identifier String, type String, attribute_name String, attribute_value String, patient_unique_id String, sample_unique_id String";
export const CUSTOM_META_STRUCTURE =
  "cancer_study_identifier String, attr_id String, display_name String, description String, datatype String, patient_attribute Int32, priority String";

/** Custom attributes sort ahead of the study's own: the reader uploaded them to look at them. */
export const CUSTOM_PRIORITY = "5000";

/**
 * The clinical data table's rows with a recorded value (clinicalRecordedSql: no empty, "NA", "N/A"
 * or "NaN" spelling, as cBioPortal's study view reads them), with the request's custom rows merged
 * in when there are any. Every reader of clinical values goes through here, so a missing value is
 * never a value: no facet bar, no group, no match for `= X` or `!= X`, and `not` keeps its sample.
 *
 * `attrs` is what the statement reads: the attribute names it filters on, or "all" for one that
 * reads every attribute. Only those custom columns are shipped with it, and a statement about
 * the study's own attributes alone gets the plain table and no upload. Measured on a 10k-patient
 * x 50-column upload: shipping everything with every Explore query took a page from 0.7s to 20s.
 */
export function clinicalTable(db: string, attrs: readonly string[] | "all"): string {
  const s = activeCustomData();
  const own = "SELECT internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type\n" +
    "   FROM " + db + ".clinical_data_derived WHERE " + clinicalRecordedSql("attribute_value");
  if (!s || !s.allowedDbs.has(db)) return "(" + own + ")";
  let table = CUSTOM_CLINICAL_TABLE;
  if (attrs !== "all") {
    const custom = [...new Set(attrs.filter(isCustomAttr))].sort();
    if (!custom.length) return "(" + own + ")";
    table = CUSTOM_CLINICAL_TABLE + "_" + fnv1a(custom.join("\n"));
    (s.subsets ??= new Map()).set(table, new Set(custom));
  }
  return "(" + own + "\n" +
    " UNION ALL\n" +
    " SELECT toInt32(0) AS internal_id, sample_unique_id, patient_unique_id, attribute_name, attribute_value, cancer_study_identifier, type\n" +
    "   FROM " + table + " WHERE " + clinicalRecordedSql("attribute_value") + ")";
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** The attribute metadata table, with the request's custom columns merged in. */
export function clinicalMetaTable(db: string): string {
  const s = activeCustomData();
  if (!s || !s.allowedDbs.has(db)) return db + ".clinical_attribute_meta";
  return "(SELECT attr_id, display_name, description, datatype, patient_attribute, priority, cancer_study_id\n" +
    "   FROM " + db + ".clinical_attribute_meta\n" +
    " UNION ALL\n" +
    " SELECT m.attr_id, m.display_name, m.description, m.datatype, m.patient_attribute, m.priority, cs.cancer_study_id\n" +
    "   FROM " + CUSTOM_META_TABLE + " m JOIN " + db + ".cancer_study cs ON cs.cancer_study_identifier = m.cancer_study_identifier)";
}

/** ClickHouse TSV escaping: the only characters with meaning inside a field. */
export function tsvField(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/** Both external tables as TSV. One row per non-empty value, keyed exactly like the study's own. */
export function encodeCustomData(datasets: CustomDataset[], only?: Set<string>): { clinical: string; meta: string } {
  const clinical: string[] = [], meta: string[] = [];
  for (const d of datasets) {
    const cols = d.columns.map((c, i) => ({ attr: customAttr(d.id, c.name), i }))
      .filter((c) => !only || only.has(c.attr));
    if (!cols.length) continue;
    const studies = new Set<string>();
    for (const r of d.rows) {
      studies.add(r.study);
      const pid = r.study + "_" + r.patient, sid = d.level === "sample" ? r.study + "_" + r.sample : "";
      for (const c of cols) {
        const v = r.values[c.i];
        if (v === "" || v == null) continue;
        clinical.push([r.study, d.level, c.attr, v, pid, sid].map(tsvField).join("\t"));
      }
    }
    for (const study of studies) {
      for (const c of d.columns) {
        meta.push([study, customAttr(d.id, c.name), c.name, "Custom data: " + d.name, c.datatype,
          d.level === "patient" ? "1" : "0", CUSTOM_PRIORITY].map(tsvField).join("\t"));
      }
    }
  }
  return {
    clinical: clinical.length ? clinical.join("\n") + "\n" : "",
    meta: meta.length ? meta.join("\n") + "\n" : ""
  };
}

/** The external tables a statement names, for lib/ch.ts. Refuses a connection not entitled to them. */
export function customExternalsFor(query: string, connId: string): { name: string; structure: string; data: string }[] {
  const s = activeCustomData();
  if (!s || !query.includes("_custom_")) return [];
  const names = (t: string) => new RegExp("(^|[^A-Za-z0-9_])" + t + "([^A-Za-z0-9_]|$)").test(query);
  const wanted: string[] = [];
  if (names(CUSTOM_CLINICAL_TABLE)) wanted.push(CUSTOM_CLINICAL_TABLE);
  for (const t of s.subsets?.keys() ?? []) if (names(t)) wanted.push(t);
  const wantMeta = names(CUSTOM_META_TABLE);
  if (!wanted.length && !wantMeta) return [];
  if (!s.allowedConns.has(connId))
    throw new Error("custom data is patient-level and cannot be sent to instance '" + connId + "'");
  const out: { name: string; structure: string; data: string }[] = [];
  for (const t of wanted) {
    let data: string;
    if (t === CUSTOM_CLINICAL_TABLE) data = (s.enc ??= encodeCustomData(s.datasets)).clinical;
    else {
      s.encSubsets ??= new Map();
      data = s.encSubsets.get(t) ?? encodeCustomData(s.datasets, s.subsets!.get(t)).clinical;
      s.encSubsets.set(t, data);
    }
    out.push({ name: t, structure: CUSTOM_CLINICAL_STRUCTURE, data });
  }
  if (wantMeta) out.push({ name: CUSTOM_META_TABLE, structure: CUSTOM_META_STRUCTURE, data: (s.enc ??= encodeCustomData(s.datasets)).meta });
  return out;
}

/** Every custom attribute name the request's datasets define for a study. */
export function customAttributesFor(study: string): { attribute: string; datatype: CustomDatatype; per: CustomLevel; dataset: string; column: string }[] {
  const s = activeCustomData();
  if (!s) return [];
  const out: { attribute: string; datatype: CustomDatatype; per: CustomLevel; dataset: string; column: string }[] = [];
  for (const d of s.datasets) {
    if (!d.rows.some((r) => r.study === study)) continue;
    for (const c of d.columns) out.push({ attribute: customAttr(d.id, c.name), datatype: c.datatype, per: d.level, dataset: d.id, column: c.name });
  }
  return out;
}

/**
 * Refuse a document, spec or draft that names a custom attribute this request does not carry.
 * Without it such an attribute is simply absent from the clinical table, and a cohort on it
 * matches nobody: a shared analysis opened by someone without the upload would show empty
 * results instead of saying why.
 */
export function assertCustomDataPresent(x: unknown): void {
  const text = JSON.stringify(x ?? null);
  if (!text.includes(CUSTOM_PREFIX)) return;
  const have = new Map<string, Set<string>>();
  for (const d of activeCustomData()?.datasets ?? []) have.set(d.id, new Set(d.columns.map((c) => c.name)));
  const missing = new Set<string>(), unknownCols: string[] = [];
  for (const m of text.matchAll(CUSTOM_REF_RE)) if (!have.has(m[1])) missing.add(m[1]);
  for (const m of text.matchAll(/"custom:([a-z0-9][a-z0-9-]{0,39})\/([A-Za-z0-9_]{1,64})"/g)) {
    const cols = have.get(m[1]);
    if (cols && !cols.has(m[2])) unknownCols.push("custom:" + m[1] + "/" + m[2]);
  }
  if (missing.size)
    throw new Error("this analysis uses custom data that was not sent with it: " + [...missing].map((m) => "'" + m + "'").join(", ") +
      ". It is stored on the server: log in, or check it was not deleted.");
  if (unknownCols.length)
    throw new Error("custom data has no column " + [...new Set(unknownCols)].join(", ") + "; its columns are " +
      [...have.entries()].map(([id, cols]) => [...cols].map((c) => "custom:" + id + "/" + c).join(", ")).join("; "));
}
