// Benchmark of the schema modes (lib/importer/lab-schema.ts) at a realistic number of studies:
// the same queries timed on cBioPortal's tables, on the labv_ views over the lab_ tables, and on
// the lab_ tables read directly, with and without FINAL (what reading only each row's latest
// version costs).
//
//   node scripts/bench-schema.ts load --studies acc_tcga,msk_impact_2017 [--copies 4] [--from 1]
//       imports each datahub study, then each again under <id>_copy<n> (the same files, renamed),
//       printing how long each import took; with --from N > 1 the study itself and copies below N
//       are taken as loaded already (a later stage, or a resumed run). cBioPortal's derived tables
//       are rebuilt once, after the last import (--no-derive: not at all, for a load followed by
//       another),
//       into the database `npm run local` runs (or the one CLICKHOUSE_* names); it must be in
//       `both` mode (`npm run import -- --schema both`) for the three to be compared
//   node scripts/bench-schema.ts run [--runs 5] [--gene TP53]
//       times every query, reporting the median wall time and the rows and bytes ClickHouse read
//
// Copies are what make 1,000 studies out of datahub's ~550: the question is how each layout
// behaves as the number of studies grows, and a copy costs the database what a new study costs.
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const dataDir = process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab");
if (!process.env.CLICKHOUSE_URL) { try { process.loadEnvFile(path.join(dataDir, "local.env")); } catch { /* not running */ } }
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const importer = path.join(repo, "scripts", "import-study.ts");
const run = (label: string, ...a: string[]) => {
  const t0 = performance.now();
  execFileSync(process.execPath, [importer, ...a], { stdio: "inherit", env: { ...process.env, CBIOLAB_LOCAL: "1" } });
  console.log(`bench: imported ${label} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
};

/** A study folder under a new id: meta files and case lists rewritten, data files linked. */
async function copyStudy(src: string, from: string, to: string): Promise<string> {
  const dest = path.join(dataDir, "bench", to);
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.join(dest, "case_lists"), { recursive: true });
  const rewrite = (t: string) => t.replaceAll(from, to);
  for (const f of await readdir(src)) {
    if (f === "case_lists") continue;
    if (/^meta_.*\.txt$/.test(f)) await writeFile(path.join(dest, f), rewrite(await readFile(path.join(src, f), "utf8")));
    else await symlink(path.join(src, f), path.join(dest, f));
  }
  for (const f of await readdir(path.join(src, "case_lists")).catch(() => []))
    await writeFile(path.join(dest, "case_lists", f), rewrite(await readFile(path.join(src, "case_lists", f), "utf8")));
  return dest;
}

async function load(): Promise<void> {
  const studies = opt("--studies", "").split(",").filter((s) => /^[A-Za-z0-9_.-]+$/.test(s));
  const copies = Number(opt("--copies", "0")), from = Math.max(1, Number(opt("--from", "1")));
  if (!studies.length) throw new Error("--studies a,b,c");
  for (const s of studies) {
    if (from === 1) run(s, "datahub:" + s, "--no-derive");
    const src = path.join(dataDir, "studies", s, s);
    for (let i = from; i <= copies; i++) run(`${s}_copy${i}`, await copyStudy(src, s, `${s}_copy${i}`), "--no-derive");
  }
  if (!args.includes("--no-derive")) run("derived tables", "--derive");
}

/** name → SQL per layout: cBioPortal's tables, the labv_ views, the lab_ tables. `{gene}` is filled in. */
const QUERIES: Record<string, { legacy: string; views: string; lab: string }> = {
  "altered samples per study, one gene (mutation + CNA)": {
    legacy: "SELECT cancer_study_identifier, uniqExact(sample_unique_id) FROM genomic_event_derived WHERE hugo_gene_symbol = {gene} AND variant_type IN ('mutation', 'cna') GROUP BY 1",
    views: "SELECT cancer_study_identifier, uniqExact(sample_unique_id) FROM labv_genomic_event_derived WHERE hugo_gene_symbol = {gene} AND variant_type IN ('mutation', 'cna') GROUP BY 1",
    lab: `SELECT study_id, uniqExact(sample_id) FROM (
      SELECT study_id, sample_id FROM lab_mutation FINAL WHERE hugo_gene_symbol = {gene}
      UNION ALL SELECT study_id, sample_id FROM lab_cna_event FINAL WHERE hugo_gene_symbol = {gene})
      GROUP BY study_id`
  },
  "samples profiled per study for one gene": {
    legacy: `SELECT s.cancer_study_identifier, uniqExact(s.sample_unique_id) FROM sample_to_gene_panel_derived s
      JOIN gene_panel_to_gene_derived g ON g.gene_panel_id = s.gene_panel_id WHERE g.gene = {gene} AND s.alteration_type = 'MUTATION_EXTENDED' GROUP BY 1`,
    views: `SELECT s.cancer_study_identifier, uniqExact(s.sample_unique_id) FROM labv_sample_to_gene_panel_derived s
      JOIN labv_gene_panel_to_gene_derived g ON g.gene_panel_id = s.gene_panel_id WHERE g.gene = {gene} AND s.alteration_type = 'MUTATION_EXTENDED' GROUP BY 1`,
    lab: `SELECT sp.study_id, uniqExact(sp.sample_id) FROM lab_sample_profile AS sp FINAL
      LEFT JOIN gene_panel gp ON gp.stable_id = sp.panel_id
      WHERE sp.alteration_type = 'MUTATION_EXTENDED' AND (sp.panel_id = '' OR gp.internal_id IN (
        SELECT l.internal_id FROM gene_panel_list l JOIN gene g ON g.entrez_gene_id = l.gene_id WHERE g.hugo_gene_symbol = {gene}))
      GROUP BY 1`
  },
  "clinical attribute value counts, every study": {
    legacy: "SELECT attribute_name, attribute_value, count() FROM clinical_data_derived WHERE attribute_name IN ('SEX', 'CANCER_TYPE', 'SAMPLE_TYPE') GROUP BY 1, 2",
    views: "SELECT attribute_name, attribute_value, count() FROM labv_clinical_data_derived WHERE attribute_name IN ('SEX', 'CANCER_TYPE', 'SAMPLE_TYPE') GROUP BY 1, 2",
    lab: "SELECT attr_id, value, count() FROM lab_clinical FINAL WHERE attr_id IN ('SEX', 'CANCER_TYPE', 'SAMPLE_TYPE') GROUP BY 1, 2"
  },
  "samples per study": {
    legacy: "SELECT cancer_study_identifier, count() FROM sample_derived GROUP BY 1",
    views: "SELECT cancer_study_identifier, count() FROM labv_sample_derived GROUP BY 1",
    lab: "SELECT study_id, count() FROM lab_sample FINAL GROUP BY 1"
  },
  "one gene's protein changes, every study": {
    legacy: "SELECT proteinChange, count() FROM mutation_derived WHERE entrezGeneId = (SELECT entrez_gene_id FROM gene WHERE hugo_gene_symbol = {gene}) GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
    views: "SELECT proteinChange, count() FROM labv_mutation_derived WHERE entrezGeneId = (SELECT entrez_gene_id FROM gene WHERE hugo_gene_symbol = {gene}) GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
    lab: "SELECT protein_change, count() FROM lab_mutation FINAL WHERE hugo_gene_symbol = {gene} GROUP BY 1 ORDER BY 2 DESC LIMIT 20"
  },
  "one gene's expression values, one study": {
    legacy: "SELECT count(), avg(toFloat64OrNull(alteration_value)) FROM genetic_alteration_derived WHERE hugo_gene_symbol = {gene} AND cancer_study_identifier = {study}",
    views: "SELECT count(), avg(toFloat64OrNull(alteration_value)) FROM labv_genetic_alteration_derived WHERE hugo_gene_symbol = {gene} AND cancer_study_identifier = {study}",
    lab: "SELECT count(), avg(toFloat64OrNull(value)) FROM lab_profile_value FINAL WHERE hugo_gene_symbol = {gene} AND study_id = {study} AND value NOT IN ('', 'NA')"
  }
};

async function bench(): Promise<void> {
  const { chWrite } = await import("../lib/ch.ts");
  const conn = { id: "bench", url: process.env.CLICKHOUSE_URL || "", user: process.env.CLICKHOUSE_USER || "", password: process.env.CLICKHOUSE_PASSWORD || "",
    db: (process.env.CLICKHOUSE_DB || "cbioportal").replace(/[^A-Za-z0-9_]/g, ""), label: "bench" };
  const runs = Number(opt("--runs", "5"));
  const lit = (s: string) => "'" + s.replace(/[^A-Za-z0-9_.-]/g, "") + "'";
  const gene = lit(opt("--gene", "TP53")), study = lit(opt("--study", "msk_impact_2017"));
  const studies = (await chWrite("SELECT count() FROM lab_study FINAL", conn)).trim();
  console.log(`database ${conn.db}: ${studies} studies in lab_study; median of ${runs} runs, query cache off\n`);
  const layouts = ["legacy", "views", "lab", "lab, no FINAL"] as const;
  console.log("query".padEnd(54) + layouts.map((k) => k.padStart(24)).join(""));
  for (const [name, q] of Object.entries(QUERIES)) {
    const cells: string[] = [];
    for (const layout of layouts) {
      const sql = (layout === "lab, no FINAL" ? q.lab.replaceAll(" FINAL", "") : q[layout]).replaceAll("{gene}", gene).replaceAll("{study}", study);
      const times: number[] = [];
      let read = { rows: 0, bytes: 0 };
      try {
        for (let i = 0; i < runs; i++) {
          const t0 = performance.now();
          const res = await fetch(conn.url.replace(/\/+$/, "") + "/?" + new URLSearchParams({ database: conn.db, use_query_cache: "0", send_progress_in_http_headers: "0" }), {
            method: "POST", body: sql + " FORMAT Null",
            headers: { Authorization: "Basic " + Buffer.from(conn.user + ":" + conn.password).toString("base64") }
          });
          await res.text();
          if (!res.ok) throw new Error("HTTP " + res.status);
          times.push(performance.now() - t0);
          const summary = JSON.parse(res.headers.get("x-clickhouse-summary") || "{}") as { read_rows?: string; read_bytes?: string };
          read = { rows: Number(summary.read_rows ?? 0), bytes: Number(summary.read_bytes ?? 0) };
        }
        times.sort((a, b) => a - b);
        cells.push(`${Math.round(times[Math.floor(times.length / 2)])} ms ${(read.rows / 1e6).toFixed(1)}M rows`.padStart(24));
      } catch (e) {
        cells.push(("error: " + (e as Error).message).slice(0, 22).padStart(24));
      }
    }
    console.log(name.slice(0, 53).padEnd(54) + cells.join(""));
  }
}

const cmd = args[0];
if (cmd === "load") await load();
else if (cmd === "run") await bench();
else { console.error("usage: node scripts/bench-schema.ts load --studies a,b [--copies N] | run [--runs N] [--gene G] [--study S]"); process.exit(2); }
