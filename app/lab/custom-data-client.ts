// Custom data in the browser: how a pasted table becomes a dataset, how it is saved, and how
// datasets reach the engine.
//
// Uploads live on the server only (lib/custom-store.ts), behind the deployment's access code
// (lib/custom-access.ts); this browser keeps nothing. Requests name them by reference
// (`customRefs`: { as, dataset, version }) and the server reads the rows itself. The one
// exception is the gallery's demo data (`customData` on a lib/dsl-reference.ts example): public
// data bundled with the code, sent as rows so the example runs anywhere, code or no code.
//
// One fetch wrapper attaches both, so every caller — including the shared OncoprintFigure —
// sends them without knowing they exist:
//
//   /api/explore            every server dataset with rows in the studies being explored
//   /api/analysis, /api/oncoprint, /api/custom-data/members
//                           only datasets the document or spec names, so an analysis that uses
//                           none stays on the shared result cache. A name the document pins
//                           (`uploads`, see bindUploads) resolves to that version.
import { CUSTOM_PREFIX, LIMITS, type CustomColumn, type CustomDataset, type CustomLevel } from "../../lib/custom-data-names.ts";
import type { DatasetMeta } from "../../lib/custom-store.ts";
import { EXAMPLES } from "../../lib/dsl-reference.ts";

/** A dataset with the record of how its upload matched, as saved and as read back. */
export interface StoredDataset extends CustomDataset {
  createdAt: string;
  /** what the upload looked like: rows read, rows matched, and what was left out */
  source: { rowsIn: number; unmatched: number; duplicates: number; multiStudy: number; studies: string[] };
}

const listeners = new Set<() => void>();
export function onCustomDataChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
function emit() { for (const f of listeners) f(); }

/** The gallery's bundled demo datasets: code, not uploads, so they need no server and no code. */
const BUILTIN: CustomDataset[] = EXAMPLES.flatMap((e) => e.customData || []);
export function builtinDataset(id: string): CustomDataset | undefined { return BUILTIN.find((d) => d.id === id); }

export function datasetStudies(d: CustomDataset): string[] { return [...new Set(d.rows.map((r) => r.study))]; }

/** The ids of every custom dataset a document, spec or draft names. */
export function referencedDatasets(x: unknown): string[] {
  const text = typeof x === "string" ? x : JSON.stringify(x ?? null);
  if (!text.includes(CUSTOM_PREFIX)) return [];
  return [...new Set([...text.matchAll(/"custom:([a-z0-9][a-z0-9-]{0,39})\//g)].map((m) => m[1]))];
}

// ---------------------------------------------------------------------------
// The server's datasets
// ---------------------------------------------------------------------------

/** A document's pin: the name it uses -> a stored dataset at one version. */
export interface UploadBinding { as: string; dataset: string; version: number }
export interface ServerState { enabled: boolean; unlocked: boolean; datasets: DatasetMeta[]; error?: string }

let server: ServerState = { enabled: false, unlocked: false, datasets: [] };
export function serverState(): ServerState { return server; }

/** Ask the server what it holds; quietly "not enabled" where it has no such store. */
export async function loadServerData(): Promise<void> {
  try {
    const st = await (await fetch("/api/custom-data/server")).json() as { enabled: boolean; unlocked: boolean };
    let datasets: DatasetMeta[] = [];
    if (st.unlocked) {
      const j = await (await fetch("/api/custom-data/datasets")).json();
      if (j.error) throw new Error(j.error);
      datasets = j.datasets;
    }
    server = { enabled: !!st.enabled, unlocked: !!st.unlocked, datasets };
  } catch (e) { server = { ...server, error: String((e as Error)?.message || e) }; }
  emit();
}

let loaded: Promise<void> | null = null;
/** Once per page, before the first engine request (the fetch wrapper waits on it). */
export function loadCustomData(): Promise<void> {
  loaded ??= (async () => {
    // uploads were once kept in this browser too; nothing reads that store any more
    try { indexedDB.deleteDatabase("cohort-lab-custom-data"); } catch { /* no IndexedDB here */ }
    await loadServerData();
  })();
  return loaded;
}

export async function unlockServer(code: string): Promise<void> {
  const res = await fetch("/api/custom-data/server", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || res.statusText);
  await loadServerData();
}
export async function lockServer(): Promise<void> {
  await fetch("/api/custom-data/server", { method: "DELETE" });
  await loadServerData();
}

/** Changes whenever what this browser can attach changes. */
export function customDataKey(): string {
  return server.datasets.map((d) => d.slug + "@" + d.latestVersion).join(",");
}

export function serverBySlug(slug: string): DatasetMeta | undefined {
  return server.datasets.find((d) => d.slug === slug);
}

async function gzip(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

const strip = (d: CustomDataset): CustomDataset => ({ id: d.id, name: d.name, level: d.level, columns: d.columns, rows: d.rows });

/** Save a dataset to the server: a new one, or the next version of one (`versionOf`, its id). */
export async function saveToServer(d: StoredDataset, versionOf?: string): Promise<DatasetMeta> {
  if (!server.unlocked) throw new Error("custom data is stored on the server: enter this deployment's access code under Explore → Custom data first");
  const res = await fetch("/api/custom-data/datasets", { method: "POST", headers: { "Content-Type": "application/gzip" },
    body: await gzip(JSON.stringify({ dataset: strip(d), source: d.source, versionOf })) });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  await loadServerData();
  return j.dataset as DatasetMeta;
}

export async function deleteServerDataset(id: string): Promise<void> {
  const res = await fetch("/api/custom-data/datasets/" + id, { method: "DELETE" });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  await loadServerData();
}

const versionCache = new Map<string, StoredDataset & { server: DatasetMeta; version: number }>();
/** One stored version with its rows, for inspecting or exporting (a logged read). */
export async function fetchServerVersion(id: string, version: number): Promise<StoredDataset & { server: DatasetMeta; version: number }> {
  const key = id + "@" + version;
  const hit = versionCache.get(key);
  if (hit) return hit;
  const res = await fetch("/api/custom-data/datasets/" + id + "?version=" + version);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  const meta = JSON.parse(decodeURIComponent(res.headers.get("X-Custom-Dataset") || "{}")) as DatasetMeta & { version: number };
  const rows = JSON.parse(await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).text());
  const v = meta.versions.find((x) => x.version === version)!;
  const out = { id: meta.slug, name: meta.name, level: meta.level, columns: v.columns, rows, createdAt: v.createdAt, source: v.source, server: meta, version };
  versionCache.set(key, out);
  return out;
}

/** The pins of the document on the page, for requests that carry a spec rather than the document. */
let activeBindings: UploadBinding[] = [];
export function setActiveBindings(b: UploadBinding[] | undefined): void { activeBindings = Array.isArray(b) ? b : []; }

/**
 * Pin every server dataset a document names: a name with no pin that the server holds gets
 * `{ as, dataset, version: latest }`; pins the document no longer uses are dropped. Returns the
 * same object when nothing changes.
 */
export function bindUploads<D extends { uploads?: UploadBinding[] }>(doc: D): D {
  const names = referencedDatasets({ ...doc, uploads: undefined });
  const kept = (doc.uploads || []).filter((b) => names.includes(b.as));
  const added: UploadBinding[] = [];
  for (const as of names) {
    if (kept.some((b) => b.as === as) || builtinDataset(as)) continue;
    const s = serverBySlug(as);
    if (s) added.push({ as, dataset: s.id, version: s.latestVersion });
  }
  if (!added.length && kept.length === (doc.uploads || []).length) return doc;
  const uploads = [...kept, ...added];
  const next = { ...doc } as D;
  if (uploads.length) next.uploads = uploads; else delete next.uploads;
  return next;
}

/** Names a document uses that cannot be resolved here, and why. */
export function unresolvedUploads(doc: { uploads?: UploadBinding[] }): { as: string; why: "locked" | "missing" | "deleted" | "unavailable" }[] {
  const out: { as: string; why: "locked" | "missing" | "deleted" | "unavailable" }[] = [];
  for (const as of referencedDatasets({ ...doc, uploads: undefined })) {
    if (builtinDataset(as)) continue;
    const pin = (doc.uploads || []).find((b) => b.as === as);
    if (!server.enabled) out.push({ as, why: "unavailable" });
    else if (!server.unlocked) out.push({ as, why: "locked" });
    else if (pin ? !server.datasets.some((d) => d.id === pin.dataset) : !serverBySlug(as)) out.push({ as, why: pin ? "deleted" : "missing" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The fetch wrapper
// ---------------------------------------------------------------------------

function attach(path: string, body: string): string | null {
  const j = JSON.parse(body) as { studies?: string[]; study?: string; uploads?: UploadBinding[] };
  const rows: CustomDataset[] = [], refs: UploadBinding[] = [];
  const named = referencedDatasets({ ...j, uploads: undefined });
  for (const as of named) { const b = builtinDataset(as); if (b) rows.push(b); }
  if (path === "/api/explore") {
    const studies = new Set([...(j.studies || []), ...(j.study ? [j.study] : [])]);
    for (const s of server.datasets) {
      const v = s.versions.find((x) => x.version === s.latestVersion);
      if (v && v.studies.some((st) => studies.has(st))) refs.push({ as: s.slug, dataset: s.id, version: s.latestVersion });
    }
  } else {
    const pins = Array.isArray(j.uploads) ? j.uploads : activeBindings;
    for (const as of named) {
      if (builtinDataset(as)) continue;
      const pin = pins.find((b) => b.as === as), s = serverBySlug(as);
      if (pin) refs.push(pin);
      else if (s) refs.push({ as, dataset: s.id, version: s.latestVersion });
    }
  }
  if (!rows.length && !refs.length) return null;
  return JSON.stringify({ ...j, ...(rows.length ? { customData: rows.map(strip) } : {}), ...(refs.length ? { customRefs: refs } : {}) });
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
          // the page's first requests go out on mount, before the server has said what it holds;
          // a shared ?doc= link that names a dataset must not race it
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
/** A name no server dataset uses yet, so a feature never lands as a new version of something else. */
export function uniqueSlug(name: string): string {
  const base = slugify(name);
  let id = base;
  for (let k = 2; serverBySlug(id) || builtinDataset(id); k++) id = (base.slice(0, 36) + "-" + k).replace(/^-+/, "");
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
    id: slugify(name), name: name.trim() || "Custom data", level: parsed.level, columns, rows,
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
