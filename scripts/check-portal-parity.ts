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
 *      structural variants): samples altered (the portal's "#"), samples altered on a panel that
 *      covers the gene (the frequency's numerator: an off-panel call is left out of it), and samples
 *      profiled, the panel-aware denominator.
 *   3. Clinical counts — every value of the leading categorical attributes.
 *   4. Filtered cohorts — patients with a mutation in the study's most-mutated gene, with its
 *      most-altered copy-number gene amplified or deleted, and with one clinical value, compiled by
 *      lib/cohort2.ts and filtered by cBioPortal's study view.
 *   5. OQL position ranges (MUT_(a-b), (a-), (-b), (a-b*)) on that gene: cBioPortal applies them in
 *      the browser, so its mutations are fetched from the API and its own rule, ported from
 *      cbioportal-frontend, decides which patients match.
 *   6. OQL mutation classes (TRUNC, MISSENSE, NONSENSE, FRAMESHIFT, INFRAME, SPLICE, NONSTART,
 *      NONSTOP, PROMOTER) on that gene and on TERT (promoter mutations), the same way: the
 *      portal's mutations, its own classes.
 *   7. A selection of several studies profiled differently — panel (IMPACT341), several panels in
 *      one study (IMPACT341/410/468) and whole-exome — through the multi-study path: every row of
 *      the three gene tables, which is where per-study denominators, pooling and off-panel calls
 *      meet.
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
import { buildExplore, buildExploreFederated } from "../lib/explore.ts";
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

interface PortalGene { hugoGeneSymbol: string; numberOfAlteredCases: number; numberOfAlteredCasesOnPanel: number; numberOfProfiledCases: number; alteration?: number }
/** altered / altered on a covering panel / profiled, as both sides are compared */
const oursGene = (r: GeneTableRow) => `${r.altered}/${r.alteredOnPanel ?? r.altered}/${r.profiled}`;
const portalGene = (p: PortalGene) => `${p.numberOfAlteredCases}/${p.numberOfAlteredCasesOnPanel}/${p.numberOfProfiledCases}`;
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
      record({ study, group: label, what, ours: oursGene(r), portal: p ? portalGene(p) : "absent",
        agree: !!p && oursGene(r) === portalGene(p) });
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

  // 5. OQL position ranges. The portal applies its RANGE modifier in the browser, so there is no
  // endpoint to ask; its mutations come from its API and its own rule is applied here, ported from
  // cbioportal-frontend (AccessorsForOqlFilter.mut_position, oqlfilter.ts RANGE). Ranges come from
  // the gene's own position quartiles, so every study exercises both bounds and both readings.
  if (topGene && mutProfiles.length) {
    const muts = await portalMutations(mutProfiles[0], study, topGene);
    const starts = muts.map(portalPosition).filter((p): p is [number, number] => !!p).map((p) => p[0]).sort((a, b) => a - b);
    if (starts.length) {
      const q1 = starts[Math.floor(starts.length / 4)], q3 = starts[Math.floor(starts.length * 3 / 4)];
      const ranges: { text: string; lo?: number; hi?: number; contained: boolean }[] = [
        { text: `(-${q1})`, hi: q1, contained: false },
        { text: `(${q1}-${q3})`, lo: q1, hi: q3, contained: false },
        { text: `(${q1}-${q3}*)`, lo: q1, hi: q3, contained: true },
        { text: `(${q3}-)`, lo: q3, contained: false },
      ];
      for (const r of ranges) {
        const q = `${topGene}: MUT_${r.text}`;
        const pn = new Set(muts.filter((m) => inPortalRange(m, r)).map((m) => m.patientId)).size;
        const ours = await oursCount(study, { all: [{ kind: "oql", q }] }, profiles);
        record({ study, group: "cohort", what: `patients matching OQL "${q}" (cBioPortal's mutations, its RANGE rule)`,
          ours: String(ours), portal: String(pn), agree: ours === pn });
      }
    }
    // 6. OQL mutation classes, on the same mutations: the portal's class of each, and TRUNC as
    // every class but missense and in-frame (oqlfilter.ts). TERT as well, for its promoter mutations.
    for (const g of topGene === "TERT" ? [topGene] : [topGene, "TERT"]) {
      const gm = g === topGene ? muts : await portalMutations(mutProfiles[0], study, g);
      for (const kw of ["TRUNC", "MISSENSE", "NONSENSE", "FRAMESHIFT", "INFRAME", "SPLICE", "NONSTART", "NONSTOP", "PROMOTER"]) {
        const want = kw.toLowerCase();
        const pn = new Set(gm.filter((m) => {
          const c = portalClass(m);
          return want === "trunc" ? c !== "missense" && c !== "inframe" : c === want;
        }).map((m) => m.patientId)).size;
        const q = `${g}: ${kw}`;
        const ours = await oursCount(study, { all: [{ kind: "oql", q }] }, profiles);
        record({ study, group: "cohort", what: `patients matching OQL "${q}" (cBioPortal's mutations, its classes)`,
          ours: String(ours), portal: String(pn), agree: ours === pn });
      }
    }
  }
}

async function portalMutations(profile: string, study: string, symbol: string): Promise<PortalMutation[]> {
  const [gene] = await api<{ entrezGeneId: number }[]>("/genes/fetch?geneIdType=HUGO_GENE_SYMBOL", [symbol]);
  return api<PortalMutation[]>(`/molecular-profiles/${profile}/mutations/fetch`, { sampleListId: study + "_all", entrezGeneIds: [gene.entrezGeneId] });
}

interface PortalMutation { patientId: string; proteinPosStart?: number; proteinPosEnd?: number; mutationType?: string; proteinChange?: string }

/** cbioportal-frontend AccessorsForOqlFilter getMutationSubType + getSimplifiedMutationType; null (Fusion) as "none". */
function portalClass(m: PortalMutation): string {
  const t = (m.mutationType || "").toLowerCase();
  if (t === "fusion") return "none";
  if ((m.proteinChange || "").toLowerCase() === "promoter") return "promoter";
  const classes: Record<string, string[]> = {
    missense: ["missense_mutation", "missense", "missense_variant"],
    frameshift: ["frame_shift_ins", "frame_shift_del", "frameshift", "frameshift_deletion", "frameshift_insertion", "de_novo_start_outofframe", "frameshift_variant"],
    nonsense: ["nonsense_mutation", "nonsense", "stopgain_snv"],
    splice: ["splice_site", "splice", "splice site", "splicing", "splice_site_snp", "splice_site_del", "splice_site_indel", "splice_region"],
    nonstart: ["translation_start_site", "start_codon_snp", "start_codon_del"],
    nonstop: ["nonstop_mutation"],
    fusion: ["fusion"],
    inframe: ["in_frame_del", "in_frame_ins", "in_frame_deletion", "in_frame_insertion", "indel", "nonframeshift_deletion", "nonframeshift", "nonframeshift insertion", "nonframeshift_insertion"],
  };
  for (const [c, types] of Object.entries(classes)) if (types.includes(t)) return c;
  return "other";
}

/** cbioportal-frontend AccessorsForOqlFilter.mut_position: no position unless start <= end, neither -1. */
function portalPosition(m: PortalMutation): [number, number] | null {
  const s = m.proteinPosStart, e = m.proteinPosEnd;
  return s == null || e == null || isNaN(s) || isNaN(e) || s === -1 || e === -1 || s > e ? null : [s, e];
}

/** cbioportal-frontend oqlfilter.ts, case 'RANGE': overlap, or containment with `*`. */
function inPortalRange(m: PortalMutation, r: { lo?: number; hi?: number; contained: boolean }): boolean {
  const p = portalPosition(m);
  if (!p) return false;
  const lo = r.lo ?? Number.NEGATIVE_INFINITY, hi = r.hi ?? Number.POSITIVE_INFINITY;
  return r.contained ? lo <= p[0] && hi >= p[1] : lo <= p[1] && p[0] <= hi;
}

// 7. studies profiled differently, together
const MIXED = ["utuc_mskcc_2015", "msk_impact_2017", "blca_tcga_pan_can_atlas_2018"];
{
  const study = MIXED.join(" + ");
  const profilesByStudy = new Map();
  for (const s of MIXED) profilesByStudy.set(s, await studyProfiles(s));
  const ex = await buildExploreFederated({ studies: MIXED, profilesByStudy });
  const tables: [string, GeneTableRow[] | undefined, string][] = [
    ["mutations", ex.mutatedGenes, "/mutated-genes/fetch"],
    ["copy number", ex.cnaGenes, "/cna-genes/fetch"],
    ["structural variants", ex.svGenes, "/structuralvariant-genes/fetch"],
  ];
  for (const [label, rows, path] of tables) {
    const portal = await api<PortalGene[]>(path, { studyIds: MIXED });
    const byKey = new Map(portal.map((g) => [g.hugoGeneSymbol + "|" + (g.alteration ?? ""), g]));
    const what = (r: GeneTableRow) => r.gene + (r.cna === 2 ? " amplified" : r.cna === -2 ? " deleted" : "");
    const agrees = (r: GeneTableRow) => { const p = byKey.get(r.gene + "|" + (r.cna ?? "")); return !!p && oursGene(r) === portalGene(p); };
    // named: the leading genes, and the rows where off-panel calls separate "#" from the frequency
    const offPanel = (rows || []).filter((r) => (r.alteredOnPanel ?? r.altered) !== r.altered);
    for (const r of [...(rows || []).slice(0, TOP_GENES), ...offPanel.slice(0, 10)]) {
      const p = byKey.get(r.gene + "|" + (r.cna ?? ""));
      record({ study, group: label, what: what(r) + ((r.alteredOnPanel ?? r.altered) !== r.altered ? " (off-panel calls)" : ""),
        ours: oursGene(r), portal: p ? portalGene(p) : "absent", agree: agrees(r) });
    }
    // and every row the table holds
    const wrong = (rows || []).filter((r) => !agrees(r));
    record({ study, group: label, what: `every row of the table (${(rows || []).length}, ${offPanel.length} with off-panel calls)`,
      ours: wrong.length ? wrong.length + " differ: " + wrong.slice(0, 5).map((r) => what(r) + " " + oursGene(r)).join(", ") : "all agree",
      portal: wrong.length ? wrong.slice(0, 5).map((r) => { const p = byKey.get(r.gene + "|" + (r.cna ?? "")); return p ? portalGene(p) : "absent"; }).join(", ") : "all agree",
      agree: !!rows?.length && !wrong.length });
  }
}

const failed = checks.filter((c) => !c.agree).length;
if (process.env.RECORD) mkdirSync(new URL(".", OUT), { recursive: true });
if (process.env.RECORD) writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(),
  commit: (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } })(),
  reference: "https://www.cbioportal.org (public API)",
  studies: [...STUDIES, MIXED.join(" + ")],
  total: checks.length, agree: checks.length - failed,
  checks,
}, null, 1) + "\n");
console.log(failed ? `\n${failed} of ${checks.length} comparisons DISAGREE` : `\nall ${checks.length} comparisons agree with cBioPortal`);
process.exit(failed ? 1 : 0);
