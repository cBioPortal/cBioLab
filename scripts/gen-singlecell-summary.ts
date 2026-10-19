// Single-cell cell metadata summarised per patient and per sample, as custom datasets for a study —
// the command line of the review page (/singlecell), running the same code (lib/singlecell/,
// lib/singlecell-server.ts), so a config reviewed there builds here to the same numbers.
//
//   node --env-file=.env.local scripts/gen-singlecell-summary.ts propose <cell-explorer slug> <study> > config.json
//   node --env-file=.env.local scripts/gen-singlecell-summary.ts build <config.json> [--ts lib/x.ts --export NAME] [--out DIR]
//
// propose drafts a config: donor_id as the patient, the sample column and its crosswalk (the one that
// matches most), candidate labels and scores. A person reviews it — on /singlecell, or by hand.
// build writes the datasets: TSV per dataset into --out, and/or a bundled module with --ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { openObs, type ObsColumn } from "../lib/singlecell/zarr.ts";
import {
  judgeColumns, variesWithin, summariseSource, toDatasets, datasetTsv, validateConfig, sourceColumns, colName,
  DEFAULT_MIN_CELLS, DEFAULT_MIN_SCORE_CELLS, type SingleCellConfig, type SourceSummary
} from "../lib/singlecell/summary.ts";
import { cellExplorerCatalog, crosswalk } from "../lib/singlecell-server.ts";

const distinct = (c: ObsColumn) => [...new Set(c.kind === "label" ? c.values.filter((v): v is string => v != null) : [])];

async function propose(slug: string, study: string): Promise<SingleCellConfig & Record<string, unknown>> {
  const d = (await cellExplorerCatalog()).find((x) => x.slug === slug);
  if (!d) throw new Error("Cell Explorer has no dataset " + slug);
  const obs = await openObs(d.url);
  const donor = await obs.read("donor_id");
  const pw = await crosswalk(study, "patient", distinct(donor));
  // the sample: a categorical column with more values than donors whose values the study's samples (or an attribute of them) match most
  let sample: { obs: string; attribute: string | null; matched: number; values: number } | null = null;
  for (const c of d.columns) {
    if (c.dtype !== "categorical" || c.name === "donor_id" || !c.cardinality || c.cardinality <= pw.values || c.cardinality > 5000) continue;
    if (/_ontology_term_id$|^observation_joinid$/.test(c.name)) continue;
    const sw = await crosswalk(study, "sample", distinct(await obs.read(c.name)));
    if (sw.matched && (!sample || sw.matched > sample.matched)) sample = { obs: c.name, attribute: sw.attribute, matched: sw.matched, values: sw.values };
  }
  const judged = judgeColumns(d.columns, { patient: "donor_id", sample: sample?.obs ?? null });
  const unit = await obs.read(sample ? sample.obs : "donor_id");
  const labels: string[] = [];
  for (const j of judged.filter((x) => x.role === "label")) if (variesWithin(await obs.read(j.name), unit)) labels.push(j.name);
  return {
    study, id: colName(slug).toLowerCase().replace(/_/g, "-").slice(0, 30).replace(/-+$/, "") + "-sc", name: d.name, cellExplorer: slug,
    patient: { obs: "donor_id", attribute: pw.attribute },
    _patientMatched: pw.matched + " of " + pw.values + " donors are patients of " + study + " (" + pw.studyCases + " patients)",
    sample: sample ? { obs: sample.obs, attribute: sample.attribute } : null,
    _sampleMatched: sample ? sample.matched + " of " + sample.values + " values are samples of " + study : "no column matched the study's samples",
    sources: [{ zarr: d.url, prefix: "SC", labels, scores: judged.filter((x) => x.role === "score").map((x) => x.name), where: {} }],
    minCells: DEFAULT_MIN_CELLS, minScoreCells: DEFAULT_MIN_SCORE_CELLS,
  };
}

/** Run a config: read every source's columns, match its values to the study, summarise. */
export async function buildConfig(cfg: SingleCellConfig, log: (s: string) => void = () => {}) {
  validateConfig(cfg);
  const parts: SourceSummary[] = [];
  const patientOf = new Map<string, string>();
  for (const src of cfg.sources) {
    const urls = Array.isArray(src.zarr) ? src.zarr : [src.zarr];
    const names = sourceColumns(cfg, src);
    const stores = await Promise.all(urls.map(openObs));
    const read = await Promise.all(stores.map((s) => Promise.all(names.map((n) => s.read(n)))));
    const cols = new Map<string, ObsColumn>(names.map((n, k) => {
      const pieces = read.map((r) => r[k]);
      if (pieces.every((p) => p.kind === "number")) {
        const len = pieces.reduce((a, p) => a + p.values.length, 0), out = new Float64Array(len);
        let o = 0; for (const p of pieces) { out.set(p.values as Float64Array, o); o += p.values.length; }
        return [n, { kind: "number", values: out }];
      }
      return [n, { kind: "label", values: pieces.flatMap((p) => p.kind === "label" ? p.values : Array.from(p.values, (x) => Number.isFinite(x) ? String(x) : null)) }];
    }));
    const pw = await crosswalk(cfg.study, "patient", distinct(cols.get(cfg.patient.obs)!), cfg.patient.attribute);
    const sw = cfg.sample ? await crosswalk(cfg.study, "sample", distinct(cols.get(cfg.sample.obs)!), cfg.sample.attribute) : null;
    if (sw) for (const [p, s] of Object.values(sw.map)) patientOf.set(s, p);
    const part = summariseSource(cfg, src, cols, (v) => pw.map[v]?.[0], sw ? (v) => sw.map[v]?.[1] : null);
    log(src.prefix + ": " + part.cells.read + " cells read, " + part.cells.kept + " kept, " + part.cells.patient + " matched a patient, " + part.cells.sample + " a sample");
    parts.push(part);
  }
  return toDatasets(cfg, parts, (s) => patientOf.get(s)!);
}

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  const flag = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  if (cmd === "propose" && a1 && a2) { console.log(JSON.stringify(await propose(a1, a2), null, 1)); return; }
  if (cmd !== "build" || !a1) throw new Error("usage: propose <slug> <study> | build <config.json> [--ts file --export NAME] [--out dir]");
  const cfg = JSON.parse(readFileSync(a1, "utf8")) as SingleCellConfig;
  const lines: string[] = [];
  const ds = await buildConfig(cfg, (s) => { lines.push(s); console.error(s); });
  const out = flag("--out");
  if (out) { mkdirSync(out, { recursive: true }); for (const d of ds) writeFileSync(join(out, d.id + ".tsv"), datasetTsv(d)); }
  const ts = flag("--ts"), name = flag("--export");
  if (ts) {
    if (!name) throw new Error("--ts needs --export NAME");
    const body = ds.map((d) => "  " + JSON.stringify({ id: d.id, name: d.name, level: d.level, columns: d.columns }).slice(0, -1) + ', "rows": [\n' +
      d.rows.map((r) => "    " + JSON.stringify(r)).join(",\n") + "\n  ] }").join(",\n");
    writeFileSync(ts, "// GENERATED by scripts/gen-singlecell-summary.ts from " + basename(a1) + " — do not edit.\n" +
      lines.map((l) => "// " + l + "\n").join("") + 'import type { CustomDataset } from "./custom-data-names.ts";\n\n' +
      "export const " + name + ": CustomDataset[] = [\n" + body + "\n];\n");
  }
  for (const d of ds) console.error(d.id + ": " + d.level + ", " + d.rows.length + " rows, " + d.columns.length + " columns");
}

await main();
