/**
 * Differential check against cBioPortal itself: the same counts, computed by this engine and by
 * www.cbioportal.org's public API, for a fixed set of studies.
 *
 * cBioPortal is an independent implementation (Java/MySQL-era code, written and reviewed by other
 * people over a decade), so agreement here is evidence that does not rest on trusting this code.
 * Compared, per study:
 *
 *   1. Cohort size — patients and samples.
 *   2. The gene tables — for the top genes by alteration frequency (mutations, copy-number,
 *      structural variants): samples altered AND samples profiled, the panel-aware denominator.
 *   3. Clinical counts — every value of the leading categorical attributes.
 *   4. Filtered cohorts — patients with a mutation in the study's most-mutated gene, with its
 *      most-altered copy-number gene amplified or deleted, and with one clinical value, compiled by
 *      lib/cohort2.ts and filtered by cBioPortal's study view.
 *
 * Every comparison must agree EXACTLY; a count is a count. Differences are reported, never
 * tolerated, so a disagreement caused by the two databases holding different releases of a
 * study shows up as a failure to look at, not as slack.
 *
 * Run: npm run check:portal
 * With RECORD=1 (npm run verify) it writes docs/verification/portal-parity.json, which /verification reads
 * (or REPORT_DIR/portal-parity.json when REPORT_DIR is set, as in CI).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildExplore } from "../lib/explore.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { chQuery, DB, PRIMARY } from "../lib/ch.ts";
import { oncokbPin } from "../lib/annotation.ts";
import type { CohortDef, GeneTableRow, ClinicalFacet } from "../lib/types.ts";

type CatFacet = Extract<ClinicalFacet, { kind: "cat" }>;

const API = "https://www.cbioportal.org/api";
const STUDIES = [
  "brca_tcga",              // whole-exome, discrete + linear CNA profiles
  "nsclc_ctdx_msk_2022",    // 8 CNA panels: the denominator varies by gene
  "msk_ch_2020",            // mostly whole-exome, some panel
  "crc_apc_impact_2020",    // targeted panel
  "luad_tcga_pan_can_atlas_2018",
  "blca_mskcc_solit_2014",   // its log2 CNA profile is tagged WES: both engines count each sample twice (see /verification)
];
const TOP_GENES = 15;
const CLINICAL_ATTRS = 4;
/** the report's folder: docs/verification/ (what the page shows), or REPORT_DIR (what CI uploads) */
const OUT = new URL("portal-parity.json", process.env.REPORT_DIR ? pathToFileURL(process.env.REPORT_DIR + "/") : new URL("../docs/verification/", import.meta.url));

interface Check { study: string; group: string; what: string; ours: string; portal: string; agree: boolean }
const checks: Check[] = [];
const record = (c: Check) => {
  checks.push(c);
  console.log(`${c.agree ? "PASS" : "FAIL"} ${c.study} ${c.group}: ${c.what}  ours ${c.ours} / cBioPortal ${c.portal}`);
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (r.ok) return await r.json() as T;
    if (attempt >= 2) throw new Error(`cBioPortal ${path}: HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
}

interface PortalGene { hugoGeneSymbol: string; numberOfAlteredCases: number; numberOfProfiledCases: number; alteration?: number }
interface PortalCount { attributeId: string; counts: { value: string; count: number }[] }
interface PortalSample { sampleId: string; patientId: string }

async function oursCount(study: string, def: CohortDef, profiles: { profiles: string[]; gaProfiles: string[] }): Promise<number> {
  const sql = compileCohortDef(def, { study, db: DB, oncokbPin: await oncokbPin(), ...profiles });
  return Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + sql + ")", PRIMARY)).data[0].n);
}

for (const study of STUDIES) {
  const profiles = await studyProfiles(study);
  const ex = await buildExplore({ study, ...profiles });

  // 1. cohort size
  const portalSamples = await api<PortalSample[]>("/filtered-samples/fetch", { studyIds: [study] });
  const portalPatients = new Set(portalSamples.map((s) => s.patientId)).size;
  record({ study, group: "size", what: "patients", ours: String(ex.totals?.patients), portal: String(portalPatients),
    agree: ex.totals?.patients === portalPatients });
  record({ study, group: "size", what: "samples", ours: String(ex.totals?.samples), portal: String(portalSamples.length),
    agree: ex.totals?.samples === portalSamples.length });

  // 2. gene tables
  const tables: [string, GeneTableRow[] | undefined, string][] = [
    ["mutations", ex.mutatedGenes, "/mutated-genes/fetch"],
    ["copy number", ex.cnaGenes, "/cna-genes/fetch"],
    ["structural variants", ex.svGenes, "/structuralvariant-genes/fetch"],
  ];
  for (const [label, rows, path] of tables) {
    if (!rows?.length) continue;
    const portal = await api<PortalGene[]>(path, { studyIds: [study] });
    const byKey = new Map(portal.map((g) => [g.hugoGeneSymbol + "|" + (g.alteration ?? ""), g]));
    for (const r of rows.slice(0, TOP_GENES)) {
      const p = byKey.get(r.gene + "|" + (r.cna ?? ""));
      const what = r.gene + (r.cna === 2 ? " amplified" : r.cna === -2 ? " deleted" : "");
      record({ study, group: label, what, ours: `${r.altered}/${r.profiled}`,
        portal: p ? `${p.numberOfAlteredCases}/${p.numberOfProfiledCases}` : "absent",
        agree: !!p && p.numberOfAlteredCases === r.altered && p.numberOfProfiledCases === r.profiled });
    }
  }

  // 3. clinical counts
  const cats = ex.clinical.filter((c): c is CatFacet => c.kind === "cat" && (c.values?.length || 0) > 1).slice(0, CLINICAL_ATTRS);
  if (cats.length) {
    const portal = await api<PortalCount[]>("/clinical-data-counts/fetch",
      { attributes: cats.map((c) => ({ attributeId: c.attribute })), studyViewFilter: { studyIds: [study] } });
    for (const c of cats) {
      const pc = new Map((portal.find((p) => p.attributeId === c.attribute)?.counts || [])
        .filter((v) => v.value !== "NA").map((v) => [v.value, v.count]));
      for (const v of c.values!.slice(0, 6)) {
        const pn = pc.get(v.v);
        record({ study, group: "clinical", what: `${c.attribute} = ${v.v}`, ours: String(v.n), portal: String(pn ?? "absent"),
          agree: pn === v.n });
      }
    }
  }

  // 4. filtered cohorts: lib/cohort2.ts against cBioPortal's study-view filter
  const molecular = await api<{ molecularProfileId: string; molecularAlterationType: string; datatype: string }[]>(`/studies/${study}/molecular-profiles`);
  const mutProfiles = molecular.filter((p) => p.molecularAlterationType === "MUTATION_EXTENDED").map((p) => p.molecularProfileId);
  const topGene = ex.mutatedGenes?.[0]?.gene;
  if (topGene && mutProfiles.length) {
    const portal = await api<PortalSample[]>("/filtered-samples/fetch", { studyIds: [study], geneFilters: [{
      molecularProfileIds: mutProfiles,
      geneQueries: [[{ hugoGeneSymbol: topGene, entrezGeneId: 0, alterations: [], includeDriver: true, includeVUS: true,
        includeUnknownOncogenicity: true, tiersBooleanMap: {}, includeUnknownTier: true, includeGermline: true,
        includeSomatic: true, includeUnknownStatus: true }]],
    }] });
    const ours = await oursCount(study, { all: [{ kind: "oql", q: topGene + ": MUT" }] }, profiles);
    const pn = new Set(portal.map((s) => s.patientId)).size;
    record({ study, group: "cohort", what: `patients with a ${topGene} mutation (OQL "${topGene}: MUT")`,
      ours: String(ours), portal: String(pn), agree: ours === pn });
  }
  const cnaProfiles = molecular.filter((p) => p.molecularAlterationType === "COPY_NUMBER_ALTERATION" && p.datatype === "DISCRETE")
    .map((p) => p.molecularProfileId);
  const topCna = ex.cnaGenes?.[0];
  if (topCna && cnaProfiles.length) {
    const token = topCna.cna === 2 ? "AMP" : "HOMDEL";
    const portal = await api<PortalSample[]>("/filtered-samples/fetch", { studyIds: [study], geneFilters: [{
      molecularProfileIds: cnaProfiles, geneQueries: [[{ hugoGeneSymbol: topCna.gene, entrezGeneId: 0, alterations: [token] }]],
    }] });
    const ours = await oursCount(study, { all: [{ kind: "oql", q: `${topCna.gene}: ${token}` }] }, profiles);
    const pn = new Set(portal.map((s) => s.patientId)).size;
    record({ study, group: "cohort", what: `patients with ${topCna.gene} ${token === "AMP" ? "amplified" : "deeply deleted"} (OQL "${topCna.gene}: ${token}")`,
      ours: String(ours), portal: String(pn), agree: ours === pn });
  }
  const pc = cats.find((c) => c.per === "patient") || cats[0];
  if (pc) {
    const value = pc.values![pc.values!.length > 1 ? 1 : 0].v;
    const portal = await api<PortalSample[]>("/filtered-samples/fetch",
      { studyIds: [study], clinicalDataFilters: [{ attributeId: pc.attribute, values: [{ value }] }] });
    const ours = await oursCount(study, { all: [{ kind: "clinical", per: pc.per, attribute: pc.attribute, op: "=", value }] }, profiles);
    const pn = new Set(portal.map((s) => s.patientId)).size;
    record({ study, group: "cohort", what: `patients with ${pc.attribute} = ${value}`, ours: String(ours), portal: String(pn), agree: ours === pn });
  }
}

const failed = checks.filter((c) => !c.agree).length;
if (process.env.RECORD) mkdirSync(new URL(".", OUT), { recursive: true });
if (process.env.RECORD) writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(),
  commit: (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } })(),
  reference: "https://www.cbioportal.org (public API)",
  studies: STUDIES,
  total: checks.length, agree: checks.length - failed,
  checks,
}, null, 1) + "\n");
console.log(failed ? `\n${failed} of ${checks.length} comparisons DISAGREE` : `\nall ${checks.length} comparisons agree with cBioPortal`);
process.exit(failed ? 1 : 0);
