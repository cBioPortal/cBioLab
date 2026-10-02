// Custom data in the browser: where uploads live, how a pasted table becomes a dataset, and how
// datasets reach the engine.
//
// Uploads are kept in this browser's IndexedDB and nowhere else (see lib/custom-data.ts for why
// the server holds none). They travel as `customData` beside the body of each POST to the
// engine's routes, attached here by one fetch wrapper so every caller — including the shared
// OncoprintFigure — sends them without knowing they exist:
//
//   /api/explore            every dataset with rows in the studies being explored
//   /api/analysis, /api/oncoprint, /api/custom-data/members
//                           only datasets the document or spec actually names, so an analysis
//                           that uses none stays on the shared result cache
import { CUSTOM_PREFIX, LIMITS, type CustomColumn, type CustomDataset, type CustomLevel } from "../../lib/custom-data-names.ts";

export interface StoredDataset extends CustomDataset {
  createdAt: string;
  /** what the upload looked like, for the list: rows read, rows matched, and what was left out */
  source: { rowsIn: number; unmatched: number; duplicates: number; multiStudy: number; studies: string[] };
}

// ---------------------------------------------------------------------------
// Store: IndexedDB, mirrored in memory so the fetch wrapper can attach synchronously
// ---------------------------------------------------------------------------

const DB_NAME = "cohort-lab-custom-data", STORE = "datasets";
let mem: StoredDataset[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = f(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(req.result); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}

/** Load once per page. A browser without IndexedDB (private mode in some) keeps uploads in memory only. */
export function loadCustomData(): Promise<void> {
  loaded ??= (async () => {
    try { mem = ((await tx("readonly", (s) => s.getAll())) as StoredDataset[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
    catch { mem = []; }
    emit();
  })();
  return loaded;
}
export function customDatasets(): StoredDataset[] { return mem; }
export function onCustomDataChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
function emit() { for (const f of listeners) f(); }

export async function saveCustomDataset(d: StoredDataset): Promise<void> {
  mem = [...mem.filter((x) => x.id !== d.id), d];
  emit();
  try { await tx("readwrite", (s) => s.put(d)); } catch { /* kept in memory for this page */ }
}
export async function deleteCustomDataset(id: string): Promise<void> {
  mem = mem.filter((x) => x.id !== id);
  emit();
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* already gone from memory */ }
}

export function datasetStudies(d: CustomDataset): string[] { return [...new Set(d.rows.map((r) => r.study))]; }

/** The ids of every custom dataset a document, spec or draft names. */
export function referencedDatasets(x: unknown): string[] {
  const text = typeof x === "string" ? x : JSON.stringify(x ?? null);
  if (!text.includes(CUSTOM_PREFIX)) return [];
  return [...new Set([...text.matchAll(/"custom:([a-z0-9][a-z0-9-]{0,39})\//g)].map((m) => m[1]))];
}

// ---------------------------------------------------------------------------
// The fetch wrapper
// ---------------------------------------------------------------------------

const strip = (d: StoredDataset): CustomDataset => ({ id: d.id, name: d.name, level: d.level, columns: d.columns, rows: d.rows });

function attach(path: string, body: string): string | null {
  if (!mem.length) return null;
  let picked: StoredDataset[];
  if (path === "/api/explore") {
    const j = JSON.parse(body) as { studies?: string[]; study?: string };
    const studies = new Set([...(j.studies || []), ...(j.study ? [j.study] : [])]);
    picked = mem.filter((d) => d.rows.some((r) => studies.has(r.study)));
  } else {
    const ids = new Set(referencedDatasets(body));
    picked = mem.filter((d) => ids.has(d.id));
  }
  if (!picked.length) return null;
  return JSON.stringify({ ...JSON.parse(body), customData: picked.map(strip) });
}

let installed = false;
/** Wrap window.fetch so engine requests carry the datasets they need. Idempotent. */
export function installCustomDataFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      if (init && (init.method || "GET").toUpperCase() === "POST" && typeof init.body === "string") {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = new URL(href, window.location.href).pathname;
        if (path === "/api/explore" || path === "/api/analysis" || path === "/api/oncoprint" || path === "/api/custom-data/members") {
          // the page's first requests go out on mount, before IndexedDB has answered; a shared
          // ?doc= link that names a dataset must not race it
          await loadCustomData();
          const body = attach(path, init.body);
          if (body) init = { ...init, body };
        }
      }
    } catch { /* a body that is not JSON goes out as it was */ }
    return orig(input, init);
  };
}

// ---------------------------------------------------------------------------
// Parsing an upload
// ---------------------------------------------------------------------------

export interface ParsedUpload {
  level: CustomLevel;
  idColumn: string;
  columns: (CustomColumn & { header: string; distinct: number; filled: number; looksLikeDate: boolean })[];
  /** [case id, values...] per data row */
  rows: string[][];
  warnings: string[];
}

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * A pasted or uploaded table: a header row, then one row per case. Tab-separated, or
 * comma-separated when the header has no tab. The id column is the first one named like
 * PATIENT_ID / SAMPLE_ID (else the first column), and its name decides the level.
 */
export function parseUpload(text: string): ParsedUpload {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) throw new Error("paste a header row and at least one row of data");
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  const header = split(lines[0]);
  if (header.length < 2) throw new Error("the header needs an id column and at least one value column (tab- or comma-separated)");
  let idIdx = header.findIndex((h) => /^(patient|sample|case)([ _]?id)?$/i.test(h));
  if (idIdx < 0) idIdx = 0;
  const level: CustomLevel = /sample/i.test(header[idIdx]) ? "sample" : "patient";
  const warnings: string[] = [];
  const used = new Set<string>();
  const valueIdx = header.map((_, i) => i).filter((i) => i !== idIdx);
  if (valueIdx.length > LIMITS.columns) throw new Error("an upload takes at most " + LIMITS.columns + " value columns; this one has " + valueIdx.length);
  const names = valueIdx.map((i) => {
    let n = header[i].toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "COL" + i;
    const base = n;
    for (let k = 2; used.has(n); k++) n = base + "_" + k;
    used.add(n);
    if (n !== header[i]) warnings.push("column “" + header[i] + "” is named " + n);
    return n;
  });
  const rows = lines.slice(1).map((l) => { const c = split(l); return [c[idIdx] ?? "", ...valueIdx.map((i) => c[i] ?? "")]; });
  const columns = valueIdx.map((_, k) => {
    const vals = rows.map((r) => r[k + 1]).filter((v) => v !== "" && !/^(NA|N\/A|NAN|NULL)$/i.test(v));
    const numeric = vals.length > 0 && vals.every((v) => NUMBER_RE.test(v));
    return {
      name: names[k], header: header[valueIdx[k]], datatype: numeric ? "NUMBER" as const : "STRING" as const,
      distinct: new Set(vals).size, filled: vals.length, looksLikeDate: vals.length > 0 && vals.every((v) => DATE_RE.test(v))
    };
  });
  for (const r of rows) for (let k = 1; k < r.length; k++) if (/^(NA|N\/A|NAN|NULL)$/i.test(r[k])) r[k] = "";
  return { level, idColumn: header[idIdx], columns, rows, warnings };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "custom";
}
export function uniqueSlug(name: string): string {
  const base = slugify(name);
  let id = base;
  for (let k = 2; mem.some((d) => d.id === id); k++) id = (base.slice(0, 36) + "-" + k).replace(/^-+/, "");
  return id;
}

export interface ResolveResponse { matches: { study: string; patient: string; sample?: string }[][]; unmatched: number; multiStudy: number; refused: { study: string; reason: string }[] }

/** The parsed upload, matched to the studies, as a dataset ready to save. */
export function buildDataset(name: string, parsed: ParsedUpload, resolved: ResolveResponse, studies: string[],
  datatypes: Record<string, "STRING" | "NUMBER">): StoredDataset {
  const seen = new Set<string>();
  let duplicates = 0;
  const rows: CustomDataset["rows"] = [];
  parsed.rows.forEach((r, i) => {
    for (const m of resolved.matches[i] || []) {
      const key = m.study + "\t" + (parsed.level === "sample" ? m.sample : m.patient);
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key);
      rows.push({ ...m, values: r.slice(1) });
    }
  });
  const columns = parsed.columns.map((c) => ({ name: c.name, datatype: datatypes[c.name] ?? c.datatype }));
  return {
    id: uniqueSlug(name), name: name.trim() || "Custom data", level: parsed.level, columns, rows,
    createdAt: new Date().toISOString(),
    source: { rowsIn: parsed.rows.length, unmatched: resolved.unmatched, duplicates, multiStudy: resolved.multiStudy, studies }
  };
}

/** A dataset as the TSV it could be re-imported from (study-qualified ids). */
export function datasetToTsv(d: CustomDataset): string {
  const idHead = d.level === "sample" ? "SAMPLE_ID" : "PATIENT_ID";
  const lines = [[idHead, ...d.columns.map((c) => c.name)].join("\t")];
  for (const r of d.rows) lines.push([r.study + ":" + (d.level === "sample" ? r.sample : r.patient), ...r.values].join("\t"));
  return lines.join("\n") + "\n";
}


// ---------------------------------------------------------------------------
// Save as feature: a selection frozen into a yes/no attribute
// ---------------------------------------------------------------------------

/** The column a feature's name becomes, e.g. "TP53 picks" -> TP53_PICKS. */
export function featureColumn(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "FEATURE";
}

/**
 * A frozen feature: `Yes` for every case selected, `No` for every other case it was chosen
 * from, so it splits and filters like any two-valued attribute. Frozen means the membership
 * is the one on screen when it was saved; it does not follow later data.
 */
export function buildFeature(name: string, level: CustomLevel,
  cases: { study: string; patient: string; sample?: string; selected: boolean }[], studies: string[]): StoredDataset {
  const col = featureColumn(name);
  const seen = new Set<string>();
  const rows: CustomDataset["rows"] = [];
  for (const c of cases) {
    const key = c.study + "\t" + (level === "sample" ? c.sample : c.patient);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ study: c.study, patient: c.patient, ...(level === "sample" ? { sample: c.sample } : {}), values: [c.selected ? "Yes" : "No"] });
  }
  return {
    id: uniqueSlug(name), name: name.trim() || "Feature", level, columns: [{ name: col, datatype: "STRING" }], rows,
    createdAt: new Date().toISOString(),
    source: { rowsIn: rows.length, unmatched: 0, duplicates: 0, multiStudy: 0, studies }
  };
}

/** Freeze a cohort definition's current membership (Explore's filter) into a feature. */
export async function featureFromCohort(name: string, def: unknown, studies: string[]): Promise<StoredDataset> {
  const res = await fetch("/api/custom-data/members", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ def, studies }) });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  const cases = (j.studies as { study: string; members: string[]; others: string[] }[]).flatMap((s) => [
    ...s.members.map((patient) => ({ study: s.study, patient, selected: true })),
    ...s.others.map((patient) => ({ study: s.study, patient, selected: false }))
  ]);
  return buildFeature(name, "patient", cases, studies);
}

/**
 * Freeze an oncoprint drag selection into a feature: the selected columns are `Yes`, the rest
 * of the figure's columns `No`. Columns are matched back to cases (and a sample to its patient)
 * the same way an upload is.
 */
export async function featureFromColumns(name: string, unit: string, selected: string[], all: string[], studies: string[]): Promise<StoredDataset> {
  const level: CustomLevel = unit === "sample" ? "sample" : "patient";
  const picked = new Set(selected);
  // a pooled figure keys its columns "<study>_<id>" (lib/oncoprint.ts); a study id may itself
  // hold underscores, so the longest study that prefixes the column wins
  const qualified = (id: string) => {
    if (studies.length < 2) return id;
    const s = studies.filter((st) => id.startsWith(st + "_")).sort((a, b) => b.length - a.length)[0];
    return s ? s + ":" + id.slice(s.length + 1) : id;
  };
  const res = await fetch("/api/custom-data/resolve", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies, level, ids: all.map(qualified) }) });
  const j = await res.json() as ResolveResponse & { error?: string };
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  if (j.unmatched) throw new Error(j.unmatched.toLocaleString() + " of the figure's columns could not be matched to a " + level + "; nothing was saved");
  const cases = all.flatMap((id, i) => j.matches[i].map((m) => ({ ...m, selected: picked.has(id) })));
  return buildFeature(name, level, cases, studies);
}
