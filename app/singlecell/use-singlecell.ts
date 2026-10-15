"use client";
// The single-cell review page's state and actions: a config being drafted for one study from one or
// more Cell Explorer datasets, what the reads and the server have said about it, and the preview.
//
// Columns are read in the browser (lib/singlecell/zarr.ts, from the public bucket); ids are matched
// to the study on the server (lib/singlecell-server.ts); the summary is lib/singlecell/summary.ts —
// the same code the CLI runs, so what is previewed is what the CLI writes.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lab/api.ts";
import { openObs, type ObsColumn, type ObsStore } from "../../lib/singlecell/zarr.ts";
import {
  judgeColumns, variesWithin, summariseSource, toDatasets, validateConfig, sourceColumns, colName,
  DEFAULT_MIN_CELLS, DEFAULT_MIN_SCORE_CELLS, type ColumnJudgement, type SingleCellConfig, type SingleCellSource, type SourceSummary
} from "../../lib/singlecell/summary.ts";
import type { CatalogDataset, Crosswalk, ReferenceCounts } from "../../lib/singlecell-server.ts";
import type { CustomDataset } from "../../lib/custom-data-names.ts";

/** a categorical column with more values than donors and at most this many is tried as the sample column */
const SAMPLE_CANDIDATE_MAX = 5000;

async function ask<T>(body: Parameters<typeof api.singlecell>[0]): Promise<T> {
  const j = await (await api.singlecell(body)).json();
  if (j.error) throw new Error(j.error);
  return j as T;
}

const distinct = (c: ObsColumn) => [...new Set(c.kind === "label" ? c.values.filter((v): v is string => v != null) : [])];

/** what the page knows about one source's dataset */
export interface SourceState {
  entry: CatalogDataset | null;
  /** each column's first judgement, and, for a label, whether it varies within a sample (null: not read yet) */
  judged: (ColumnJudgement & { varies?: boolean | null })[];
  patient: Crosswalk | null;
  sample: Crosswalk | null;
  /** columns tried as the sample column, with how many of their values matched */
  sampleTried: { obs: string; values: number; matched: number; attribute: string | null }[];
}

export interface Preview {
  datasets: CustomDataset[];
  /** each source's exact numbers, before they are formatted into the datasets */
  parts: SourceSummary[];
  cells: { prefix: string; read: number; kept: number; patient: number; sample: number }[];
  /** blank values a minimum left, of all values */
  blanks: number; values: number;
}

export interface ReferenceCheck {
  profile: string; source: string; label: string;
  /** label values that name one of the profile's entities */
  matchedValues: string[]; unmatchedValues: string[];
  pairs: number; equal: number; maxDiff: number; samples: number;
}

export function useSingleCell() {
  const [catalog, setCatalog] = useState<CatalogDataset[] | null>(null);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<SingleCellConfig | null>(null);
  const [sources, setSources] = useState<SourceState[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reference, setReference] = useState<{ checks: ReferenceCheck[]; profiles: string[] } | null>(null);
  const stores = useRef(new Map<string, Promise<ObsStore>>());

  useEffect(() => {
    ask<{ datasets: CatalogDataset[] }>({ mode: "catalog" }).then((r) => setCatalog(r.datasets)).catch((e) => setCatalogErr(String(e.message || e)));
  }, []);

  const store = useCallback((url: string) => {
    let s = stores.current.get(url);
    if (!s) { s = openObs(url); stores.current.set(url, s); s.catch(() => stores.current.delete(url)); }
    return s;
  }, []);
  /** a column of a source, its files read and joined */
  const readColumn = useCallback(async (src: SingleCellSource, name: string): Promise<ObsColumn> => {
    const urls = Array.isArray(src.zarr) ? src.zarr : [src.zarr];
    const parts = await Promise.all(urls.map(async (u) => (await store(u)).read(name)));
    if (parts.length === 1) return parts[0];
    if (parts.every((p) => p.kind === "number")) {
      const out = new Float64Array(parts.reduce((a, p) => a + p.values.length, 0));
      let o = 0; for (const p of parts) { out.set(p.values as Float64Array, o); o += p.values.length; }
      return { kind: "number", values: out };
    }
    return { kind: "label", values: parts.flatMap((p) => p.kind === "label" ? p.values : Array.from(p.values, (x) => Number.isFinite(x) ? String(x) : null)) };
  }, [store]);

  const entryFor = useCallback((src: SingleCellSource) => {
    const u = Array.isArray(src.zarr) ? src.zarr[0] : src.zarr;
    return catalog?.find((d) => d.url === u) || null;
  }, [catalog]);

  const run = useCallback(async (what: string, f: () => Promise<void>) => {
    setBusy(what); setError(null);
    try { await f(); } catch (e) { setError(String((e as Error)?.message || e)); } finally { setBusy(null); }
  }, []);

  /** match a source's patient and sample columns to the study, with the mappings the config names */
  const matchIds = useCallback(async (c: SingleCellConfig, src: SingleCellSource) => {
    const patient = await ask<Crosswalk>({ mode: "crosswalk", study: c.study, level: "patient", values: distinct(await readColumn(src, c.patient.obs)), attribute: c.patient.attribute });
    const sample = c.sample ? await ask<Crosswalk>({ mode: "crosswalk", study: c.study, level: "sample", values: distinct(await readColumn(src, c.sample.obs)), attribute: c.sample.attribute }) : null;
    return { patient, sample };
  }, [readColumn]);

  /** a source's columns judged: labels read to see whether they vary within a sample */
  const judge = useCallback(async (c: SingleCellConfig, src: SingleCellSource): Promise<SourceState["judged"]> => {
    const entry = entryFor(src);
    if (!entry) return [];
    const judged: SourceState["judged"] = judgeColumns(entry.columns, { patient: c.patient.obs, sample: c.sample?.obs ?? null });
    const unit = await readColumn(src, c.sample?.obs || c.patient.obs);
    await Promise.all(judged.map(async (j) => {
      if (j.role !== "label" && !src.labels.includes(j.name)) return;
      j.varies = variesWithin(await readColumn(src, j.name), unit);
      if (!j.varies && j.role === "label") { j.role = "skip"; j.why = "the same for every cell of a " + (c.sample ? "sample" : "patient") + ": it describes the " + (c.sample ? "sample" : "patient") + ", not the cell"; }
    }));
    return judged;
  }, [entryFor, readColumn]);

  /** Start from a dataset and a study: find who is who, and a first choice of columns. */
  const start = useCallback((slug: string, study: string) => run("reading the dataset and matching it to " + study, async () => {
    const entry = catalog?.find((d) => d.slug === slug);
    if (!entry) throw new Error("Cell Explorer has no dataset " + slug);
    const patientObs = entry.columns.some((c) => c.name === "donor_id") ? "donor_id" : entry.columns.find((c) => c.dtype === "categorical")?.name;
    if (!patientObs) throw new Error(slug + " has no categorical column to name the patient");
    const base: SingleCellSource = { zarr: entry.url, prefix: "SC", labels: [], scores: [], where: {} };
    const draft: SingleCellConfig = {
      study, id: colName(slug).toLowerCase().replace(/_/g, "-").slice(0, 30).replace(/-+$/, "") + "-sc", name: entry.name, cellExplorer: slug,
      patient: { obs: patientObs, attribute: null }, sample: null, sources: [base], minCells: DEFAULT_MIN_CELLS, minScoreCells: DEFAULT_MIN_SCORE_CELLS,
    };
    const donors = distinct(await readColumn(base, patientObs));
    const patient = await ask<Crosswalk>({ mode: "crosswalk", study, level: "patient", values: donors });
    draft.patient.attribute = patient.attribute;
    // the sample column: the one whose values the study's samples (or an attribute of them) match most
    const tried: SourceState["sampleTried"] = [];
    for (const c of entry.columns) {
      if (c.dtype !== "categorical" || c.name === patientObs || !c.cardinality || c.cardinality <= donors.length || c.cardinality > SAMPLE_CANDIDATE_MAX) continue;
      if (/_ontology_term_id$|^observation_joinid$/.test(c.name)) continue;
      const vals = distinct(await readColumn(base, c.name));
      const x = await ask<Crosswalk>({ mode: "crosswalk", study, level: "sample", values: vals });
      tried.push({ obs: c.name, values: x.values, matched: x.matched, attribute: x.attribute });
    }
    tried.sort((a, b) => b.matched - a.matched);
    const best = tried.find((t) => t.matched > 0);
    if (best) draft.sample = { obs: best.obs, attribute: best.attribute };
    const judged = await judge(draft, base);
    base.labels = judged.filter((j) => j.role === "label").map((j) => j.name);
    base.scores = judged.filter((j) => j.role === "score").map((j) => j.name);
    const ids = await matchIds(draft, base);
    setCfg(draft); setSources([{ entry, judged, patient: ids.patient, sample: ids.sample, sampleTried: tried }]);
    setPreview(null); setReference(null);
  }), [catalog, judge, matchIds, readColumn, run]);

  /** Load a config written earlier (by this page, the CLI or by hand) to review it. */
  const load = useCallback((text: string) => run("reading the config's datasets", async () => {
    let c: SingleCellConfig;
    try { c = JSON.parse(text); } catch { throw new Error("that is not a JSON config"); }
    c.minCells ??= DEFAULT_MIN_CELLS; c.minScoreCells ??= DEFAULT_MIN_SCORE_CELLS;
    for (const s of c.sources || []) { s.where ||= {}; s.labels ||= []; s.scores ||= []; }
    validateConfig(c);
    const states = await Promise.all(c.sources.map(async (src) => {
      const ids = await matchIds(c, src);
      return { entry: entryFor(src), judged: await judge(c, src), patient: ids.patient, sample: ids.sample, sampleTried: [] };
    }));
    setCfg(c); setSources(states); setPreview(null); setReference(null);
  }), [entryFor, judge, matchIds, run]);

  /** a change to the config; a change to who is who re-matches the ids and re-judges the columns */
  const edit = useCallback((next: SingleCellConfig, rematch = false) => {
    setCfg(next); setPreview(null); setReference(null);
    if (!rematch) return;
    void run("matching the ids again", async () => {
      const states = await Promise.all(next.sources.map(async (src, i) => {
        const ids = await matchIds(next, src);
        return { entry: entryFor(src), judged: await judge(next, src), patient: ids.patient, sample: ids.sample, sampleTried: sources[i]?.sampleTried || [] };
      }));
      setSources(states);
    });
  }, [entryFor, judge, matchIds, run, sources]);

  /** Add another dataset as a source of the same config (a second file of the same study). */
  const addSource = useCallback((slug: string) => run("reading " + slug, async () => {
    if (!cfg) return;
    const entry = catalog?.find((d) => d.slug === slug);
    if (!entry) throw new Error("Cell Explorer has no dataset " + slug);
    const taken = new Set(cfg.sources.map((s) => s.prefix));
    let prefix = colName(slug.split("-").pop() || "SRC").toUpperCase().replace(/^[^A-Z]+/, "").slice(0, 8) || "SRC";
    for (let k = 2; taken.has(prefix); k++) prefix = prefix.slice(0, 8) + k;
    const src: SingleCellSource = { zarr: entry.url, prefix, labels: [], scores: [], where: {} };
    const missing = [cfg.patient.obs, ...(cfg.sample ? [cfg.sample.obs] : [])].filter((n) => !entry.columns.some((c) => c.name === n));
    if (missing.length) throw new Error(slug + " has no column " + missing.join(" or ") + ", which this config names its patients and samples by");
    const judged = await judge(cfg, src);
    src.labels = judged.filter((j) => j.role === "label").map((j) => j.name);
    src.scores = judged.filter((j) => j.role === "score").map((j) => j.name);
    const ids = await matchIds(cfg, src);
    setCfg({ ...cfg, sources: [...cfg.sources, src] });
    setSources([...sources, { entry, judged, patient: ids.patient, sample: ids.sample, sampleTried: [] }]);
    setPreview(null); setReference(null);
  }), [catalog, cfg, judge, matchIds, run, sources]);

  /** Build the datasets as the CLI would, from the columns read here. */
  const build = useCallback(() => run("summarising the cells", async () => {
    if (!cfg) return;
    validateConfig(cfg);
    const patientOf = new Map<string, string>();
    const parts = await Promise.all(cfg.sources.map(async (src, i) => {
      const names = sourceColumns(cfg, src);
      const cols = new Map(await Promise.all(names.map(async (n) => [n, await readColumn(src, n)] as const)));
      const st = sources[i];
      if (st?.sample) for (const [p, s] of Object.values(st.sample.map)) patientOf.set(s, p);
      return summariseSource(cfg, src, cols, (v) => st?.patient?.map[v]?.[0], st?.sample ? (v) => st.sample!.map[v]?.[1] : null);
    }));
    const datasets = toDatasets(cfg, parts, (s) => patientOf.get(s)!);
    const values = datasets.reduce((a, d) => a + d.rows.length * d.columns.length, 0);
    const blanks = datasets.reduce((a, d) => a + d.rows.reduce((b, r) => b + r.values.filter((v) => v === "").length, 0), 0);
    setPreview({ datasets, parts, values, blanks, cells: parts.map((p) => ({ prefix: p.prefix, ...p.cells })) });
  }), [cfg, readColumn, run, sources]);

  /** Set the summary's sample-level counts beside the study's own cell counts, where label values name its entities. */
  const check = useCallback(() => run("reading the study's own cell counts", async () => {
    if (!cfg || !preview) return;
    const ref = await ask<ReferenceCounts>({ mode: "reference", study: cfg.study });
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const exact = (src: number, sid: string, colname: string) => preview.parts[src]?.samples.get(sid)?.get(colname) ?? null;
    const checks: ReferenceCheck[] = [];
    for (const prof of ref.profiles) {
      const entities = new Map<string, string>();
      for (const per of Object.values(prof.counts)) for (const e of Object.keys(per)) entities.set(norm(e), e);
      for (const [si, src] of cfg.sources.entries()) for (const label of src.labels) {
        const prefix = src.prefix + "_" + colName(label) + "_";
        const cols = (preview.parts[si]?.columns.sample || []).filter((c) => c.startsWith(prefix));
        const vals = cols.map((c) => c.slice(prefix.length));
        const matched = vals.filter((v) => entities.has(norm(v))), unmatched = vals.filter((v) => !entities.has(norm(v)));
        if (!matched.length) continue;
        let pairs = 0, equal = 0, maxDiff = 0;
        const samples = new Set<string>();
        for (const sid of Object.keys(prof.counts)) {
          const n = exact(si, sid, src.prefix + "_N_CELLS");
          if (!n) continue;
          for (const v of matched) {
            const share = exact(si, sid, prefix + v);
            if (share == null) continue;
            const ours = Math.round(share * n), theirs = prof.counts[sid][entities.get(norm(v))!] ?? 0;
            pairs++; samples.add(sid);
            if (Math.abs(ours - theirs) < 0.5) equal++; else maxDiff = Math.max(maxDiff, Math.abs(ours - theirs));
          }
        }
        checks.push({ profile: prof.name, source: src.prefix, label, matchedValues: matched, unmatchedValues: unmatched, pairs, equal, maxDiff, samples: samples.size });
      }
    }
    setReference({ checks, profiles: ref.profiles.map((p) => p.name) });
  }), [cfg, preview, run]);

  return { catalog, catalogErr, cfg, sources, busy, error, setError, preview, reference, start, load, edit, addSource, build, check, readColumn };
}

export type SingleCellState = ReturnType<typeof useSingleCell>;
