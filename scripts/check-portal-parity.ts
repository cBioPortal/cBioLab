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
 *      meet. Once as it is, and once filtered (SEX = Female, the portal's clinical filter): under a
 *      draft the gene tables once fell back to per-study tables, losing from the denominator every
 *      study that profiled a gene outside its own top 500 (SV NFIB read 32/47 for 32/440).
 *   8. Uncalled mutations: glioma_msk_2018, the study that holds them (read support for a
 *      patient's other samples, below the caller's thresholds), against the portal's mutation
 *      profile, which leaves them out. Counted in samples, where they would differ.
 *
 * Every comparison must agree EXACTLY; a count is a count. Differences are reported, never
 * tolerated, so a disagreement caused by the two databases holding different releases of a
 * study shows up as a failure to look at, not as slack.
 *
 * Run: npm run check:portal
 * With RECORD=1 (npm run verify) it writes docs/verification/portal-parity.json, which /verification reads
 * (or REPORT_DIR/portal-parity.json when REPORT_DIR is set, as in CI).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildExplore, buildExploreFederated, buildAssayFacets } from "../lib/explore.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { compileCohortDef, memberSamplesSql } from "../lib/cohort2.ts";
import { resolverFor, hasViewAggregates } from "../lib/federation.ts";
import { survivalLeftOutSql } from "../lib/survival-queries.ts";
import { oqlCasesSql } from "../lib/oql.ts";
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
  "blca_mskcc_solit_2014",   // its log2 CNA profile is tagged WES: the portal's study view counts each sample twice, we once
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

/**
 * PORTAL_CACHE=<dir> keeps each cBioPortal answer there, keyed by its request, and answers a repeat
 * from it. check:mutants sets it: a planted bug changes only this engine's side, so the portal's
 * answers are the same on every run against one, and a request that does change is a new key.
 */
const CACHE = process.env.PORTAL_CACHE;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const cached = CACHE && join(CACHE, createHash("sha256").update(path + "\n" + JSON.stringify(body ?? null)).digest("hex") + ".json");
  if (cached && existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8")) as T;
  const answer = await fetchApi<T>(path, body);
  if (cached) { mkdirSync(CACHE, { recursive: true }); writeFileSync(cached, JSON.stringify(answer)); }
  return answer;
}

async function fetchApi<T>(path: string, body?: unknown): Promise<T> {
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

/**
 * Per gene, the samples the portal's own per-sample panel data says are profiled for an alteration
 * type, each sample once (a sample profiled by no panel is whole-exome: every gene). The portal's
 * study view counts a sample once per profile instead, so a study with two copy-number profiles
 * (a discrete one and a log2 one tagged whole-exome) reads every sample twice; our Explore counts
 * it once, as our views do, and is compared with this.
 */
const profiledOnce = new Map<string, Promise<(gene: string) => number>>();
function portalProfiledOnce(study: string, alterationType: string): Promise<(gene: string) => number> {
  const key = study + "|" + alterationType;
  if (!profiledOnce.has(key)) profiledOnce.set(key, (async () => {
    const ids = (await api<{ molecularProfileId: string; molecularAlterationType: string }[]>("/studies/" + study + "/molecular-profiles"))
      .filter((p) => p.molecularAlterationType === alterationType).map((p) => p.molecularProfileId);
    const rows = await api<{ sampleId: string; genePanelId?: string; profiled: boolean }[]>("/gene-panel-data/fetch", { molecularProfileIds: ids });
    const panels = new Map<string, Set<string> | "all">();
    for (const r of rows.filter((x) => x.profiled)) {
      const cur = panels.get(r.sampleId);
      if (cur === "all") continue;
      if (!r.genePanelId) { panels.set(r.sampleId, "all"); continue; }
      panels.set(r.sampleId, (cur ?? new Set()).add(r.genePanelId));
    }
    const genesOf = new Map<string, Set<string>>();
    for (const id of new Set([...panels.values()].flatMap((v) => v === "all" ? [] : [...v])))
      genesOf.set(id, new Set((await api<{ genes: { hugoGeneSymbol: string }[] }>("/gene-panels/" + id)).genes.map((g) => g.hugoGeneSymbol)));
    return (gene: string) => [...panels.values()].filter((v) => v === "all" || [...v].some((id) => genesOf.get(id)!.has(gene))).length;
  })());
  return profiledOnce.get(key)!;
}

async function oursCount(study: string, def: CohortDef, profiles: { profiles: string[]; gaProfiles: string[] }): Promise<number> {
  const sql = compileCohortDef(def, { study, db: DB, oncokbPin: await oncokbPin(), ...profiles });
  return Number((await chQuery<{ n: string }>("SELECT uniqExact(pid) AS n FROM (" + sql + ")", PRIMARY)).data[0].n);
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
  const tables: [string, GeneTableRow[] | undefined, string, string][] = [
    ["mutations", ex.mutatedGenes, "/mutated-genes/fetch", "MUTATION_EXTENDED"],
    ["copy number", ex.cnaGenes, "/cna-genes/fetch", "COPY_NUMBER_ALTERATION"],
    ["structural variants", ex.svGenes, "/structuralvariant-genes/fetch", "STRUCTURAL_VARIANT"],
  ];
  for (const [label, rows, path, alterationType] of tables) {
    if (!rows?.length) continue;
    const portal = await api<PortalGene[]>(path, { studyIds: [study] });
    const byKey = new Map(portal.map((g) => [g.hugoGeneSymbol + "|" + (g.alteration ?? ""), g]));
    for (const r of rows.slice(0, TOP_GENES)) {
      const p = byKey.get(r.gene + "|" + (r.cna ?? ""));
      let what = r.gene + (r.cna === 2 ? " amplified" : r.cna === -2 ? " deleted" : "");
      let theirs = p ? portalGene(p) : "absent";
      // profiled is the portal's own per-sample panel data, each sample once; where its study view
      // counts a sample on two profiles twice, the row says so
      const once = p && (await portalProfiledOnce(study, alterationType))(r.gene);
      if (p && once !== p.numberOfProfiledCases) {
        what += " (profiled: each sample once; the study view counts " + p.numberOfProfiledCases + ", once per profile)";
        theirs = `${p.numberOfAlteredCases}/${p.numberOfAlteredCasesOnPanel}/${once}`;
      }
      record({ study, group: label, what, ours: oursGene(r), portal: theirs, agree: oursGene(r) === theirs });
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
    const ours = await oursCount(study, { all: [{ kind: "clinical", attribute: pc.attribute, op: "=", value }] }, profiles);
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

interface PortalMutation { patientId: string; sampleId: string; proteinPosStart?: number; proteinPosEnd?: number; mutationType?: string; proteinChange?: string }

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

// 7. studies profiled differently, together — as they are, and filtered
const MIXED = ["utuc_mskcc_2015", "msk_impact_2017", "blca_tcga_pan_can_atlas_2018"];
const MIXED_SELECTIONS: { label: string; draft: CohortDef | null; filter: Record<string, unknown> }[] = [
  { label: "", draft: null, filter: { studyIds: MIXED } },
  { label: " · SEX = Female",
    draft: { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] },
    filter: { studyIds: MIXED, clinicalDataFilters: [{ attributeId: "SEX", values: [{ value: "Female" }] }] } },
];
const mixedProfiles = new Map();
for (const s of MIXED) mixedProfiles.set(s, await studyProfiles(s));
for (const { label: filterLabel, draft, filter } of MIXED_SELECTIONS) {
  const study = MIXED.join(" + ") + filterLabel;
  const ex = await buildExploreFederated({ studies: MIXED, profilesByStudy: mixedProfiles, draft });
  // the selection itself, before its gene tables
  const portalSamples = await api<(PortalSample & { uniquePatientKey: string })[]>("/filtered-samples/fetch", filter);
  const portalPatients = new Set(portalSamples.map((x) => x.uniquePatientKey)).size;
  record({ study, group: "size", what: "patients", ours: String(ex.totals?.patients), portal: String(portalPatients), agree: ex.totals?.patients === portalPatients });
  record({ study, group: "size", what: "samples", ours: String(ex.totals?.samples), portal: String(portalSamples.length), agree: ex.totals?.samples === portalSamples.length });
  const tables: [string, GeneTableRow[] | undefined, string][] = [
    ["mutations", ex.mutatedGenes, "/mutated-genes/fetch"],
    ["copy number", ex.cnaGenes, "/cna-genes/fetch"],
    ["structural variants", ex.svGenes, "/structuralvariant-genes/fetch"],
  ];
  for (const [label, rows, path] of tables) {
    const portal = await api<PortalGene[]>(path, filter);
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

// 9. selections of samples: a sample-level clause selects the samples that match it, not every
// sample of the patients owning one, so a patient's other samples are not in the cohort's sizes or
// gene frequencies. Compared through both paths that count genes: Explore's gene tables and the
// views' per-gene counts (Resolver.geneCounts).
const SAMPLE_SELECTIONS: { study: string; label: string; draft: CohortDef; filter: Record<string, unknown> }[] = [
  { study: "msk_chord_2024", label: "CANCER_TYPE = Non-Small Cell Lung Cancer",
    draft: { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] } as CohortDef,
    filter: { clinicalDataFilters: [{ attributeId: "CANCER_TYPE", values: [{ value: "Non-Small Cell Lung Cancer" }] }] } },
  { study: "msk_impact_2017", label: "SAMPLE_TYPE = Primary",
    draft: { all: [{ kind: "clinical", attribute: "SAMPLE_TYPE", values: ["Primary"] }] } as CohortDef,
    filter: { clinicalDataFilters: [{ attributeId: "SAMPLE_TYPE", values: [{ value: "Primary" }] }] } },
  // a sample clause and a patient clause together: the patient clause keeps every sample of its patients
  { study: "msk_impact_2017", label: "SAMPLE_TYPE = Metastasis · SEX = Female",
    draft: { all: [{ kind: "clinical", attribute: "SAMPLE_TYPE", values: ["Metastasis"] },
      { kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] } as CohortDef,
    filter: { clinicalDataFilters: [{ attributeId: "SAMPLE_TYPE", values: [{ value: "Metastasis" }] },
      { attributeId: "SEX", values: [{ value: "Female" }] }] } },
  // a grade recorded per sample, which changes between a patient's primary and recurrence
  { study: "difg_glass_2019", label: "GRADE = IV",
    draft: { all: [{ kind: "clinical", attribute: "GRADE", values: ["IV"] }] } as CohortDef,
    filter: { clinicalDataFilters: [{ attributeId: "GRADE", values: [{ value: "IV" }] }] } },
  // an alteration is called per sample: the samples carrying it, not their patients' others
  { study: "msk_impact_2017", label: "OQL \"TP53: MUT\"",
    draft: { all: [{ kind: "oql", q: "TP53: MUT" }] } as CohortDef,
    filter: { geneFilters: [{ molecularProfileIds: ["msk_impact_2017_mutations"], geneQueries: [[{ hugoGeneSymbol: "TP53", entrezGeneId: 0,
      alterations: [], includeDriver: true, includeVUS: true, includeUnknownOncogenicity: true, tiersBooleanMap: {}, includeUnknownTier: true,
      includeGermline: true, includeSomatic: true, includeUnknownStatus: true }]] }] } },
];
for (const sel of SAMPLE_SELECTIONS) {
  const study = sel.study + " · " + sel.label;
  const profiles = await studyProfiles(sel.study);
  const filter = { studyIds: [sel.study], ...sel.filter };
  const portalSamples = await api<PortalSample[]>("/filtered-samples/fetch", filter);
  const portalPatients = new Set(portalSamples.map((s) => s.patientId)).size;

  // the cohort as the views see it: its patients, and the samples a sample-unit view draws
  const cohortSql = compileCohortDef(sel.draft, { study: sel.study, db: DB, oncokbPin: await oncokbPin(), ...profiles });
  const oursPatients = Number((await chQuery<{ n: string }>("SELECT uniqExact(pid) AS n FROM (" + cohortSql + ")", PRIMARY)).data[0].n);
  const oursSamples = Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + memberSamplesSql(cohortSql) + ")", PRIMARY)).data[0].n);
  record({ study, group: "selection", what: "patients (the cohort)", ours: String(oursPatients), portal: String(portalPatients), agree: oursPatients === portalPatients });
  record({ study, group: "selection", what: "samples (the cohort)", ours: String(oursSamples), portal: String(portalSamples.length), agree: oursSamples === portalSamples.length });

  // Explore under the same selection
  const ex = await buildExplore({ study: sel.study, draft: sel.draft, ...profiles });
  record({ study, group: "selection", what: "samples (Explore)", ours: String(ex.totals?.samples), portal: String(portalSamples.length), agree: ex.totals?.samples === portalSamples.length });
  const tables: [string, GeneTableRow[] | undefined, string][] = [
    ["mutations", ex.mutatedGenes, "/mutated-genes/fetch"],
    ["copy number", ex.cnaGenes, "/cna-genes/fetch"],
  ];
  const portalTables = new Map<string, PortalGene[]>();
  for (const [label, rows, path] of tables) {
    const portal = await api<PortalGene[]>(path, filter);
    portalTables.set(label, portal);
    const byKey = new Map(portal.map((g) => [g.hugoGeneSymbol + "|" + (g.alteration ?? ""), g]));
    const what = (r: GeneTableRow) => r.gene + (r.cna === 2 ? " amplified" : r.cna === -2 ? " deleted" : "");
    const agrees = (r: GeneTableRow) => { const p = byKey.get(r.gene + "|" + (r.cna ?? "")); return !!p && oursGene(r) === portalGene(p); };
    const wrong = (rows || []).filter((r) => !agrees(r));
    record({ study, group: label + " (Explore)", what: `every row of the table (${(rows || []).length})`,
      ours: wrong.length ? wrong.length + " differ: " + wrong.slice(0, 5).map((r) => what(r) + " " + oursGene(r)).join(", ") : "all agree",
      portal: wrong.length ? wrong.slice(0, 5).map((r) => { const p = byKey.get(r.gene + "|" + (r.cna ?? "")); return p ? portalGene(p) : "absent"; }).join(", ") : "all agree",
      agree: (!!rows?.length || !portal.length) && !wrong.length });
  }

  // the views' per-gene counts, for the portal's leading genes: altered on a covering panel / profiled
  const portalMut = [...portalTables.get("mutations")!].sort((a, b) => b.numberOfAlteredCases - a.numberOfAlteredCases).slice(0, TOP_GENES);
  const resolver = await resolverFor(sel.study, { oncokbPin: await oncokbPin(), ...profiles });
  const counts = new Map((await resolver.geneCounts(sel.draft, portalMut.map((g) => g.hugoGeneSymbol))).map((c) => [c.gene, c]));
  for (const p of portalMut) {
    const c = counts.get(p.hugoGeneSymbol)?.byType.mutation;
    const ours = c ? `${c.altered}/${c.profiled}` : "absent", theirs = `${p.numberOfAlteredCasesOnPanel}/${p.numberOfProfiledCases}`;
    record({ study, group: "mutations (views)", what: p.hugoGeneSymbol, ours, portal: theirs, agree: ours === theirs });
  }
}

// 9b. off-panel calls: a call in a gene its sample's panel does not cover is in neither side of the
// views' frequency, as in the portal's study view. RTEL1-TNFRSF6B is on no msk_chord_2024 panel, so
// every one of its calls is off-panel and nothing is profiled; PTEN in nsclc_ctdx_msk_2022 mixes
// calls on and off its panels.
for (const [st, gene] of [["msk_chord_2024", "RTEL1-TNFRSF6B"], ["nsclc_ctdx_msk_2022", "PTEN"]] as const) {
  const profiles = await studyProfiles(st);
  const p = (await api<PortalGene[]>("/mutated-genes/fetch", { studyIds: [st] })).find((g) => g.hugoGeneSymbol === gene);
  const resolver = await resolverFor(st, { oncokbPin: await oncokbPin(), ...profiles });
  const c = (await resolver.geneCounts(null, [gene])).find((r) => r.gene === gene)?.byType.mutation;
  const ours = `${c?.altered ?? 0}/${c?.profiled ?? 0}`, theirs = p ? `${p.numberOfAlteredCasesOnPanel}/${p.numberOfProfiledCases}` : "absent";
  record({ study: st, group: "mutations (views, off-panel)", what: gene, ours, portal: theirs, agree: ours === theirs });
}

// 10. one clause over studies that record its attribute at different levels: GRADE is a sample
// attribute in pancan_pcawg_2020 and a patient attribute in lihc_tcga, so the same clause selects
// the matching samples in one and every sample of the matching patients in the other.
{
  const studies = ["pancan_pcawg_2020", "lihc_tcga"];
  const draft = { all: [{ kind: "clinical", attribute: "GRADE", values: ["G3"] }] } as CohortDef;
  const filter = { studyIds: studies, clinicalDataFilters: [{ attributeId: "GRADE", values: [{ value: "G3" }] }] };
  const label = studies.join(" + ") + " · GRADE = G3";
  const portalSamples = await api<(PortalSample & { studyId: string })[]>("/filtered-samples/fetch", filter);
  const mixedProfiles = new Map();
  for (const st of studies) {
    const profiles = await studyProfiles(st);
    mixedProfiles.set(st, profiles);
    const cohortSql = compileCohortDef(draft, { study: st, db: DB, oncokbPin: await oncokbPin(), ...profiles });
    const ours = Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + memberSamplesSql(cohortSql) + ")", PRIMARY)).data[0].n);
    const theirs = portalSamples.filter((x) => x.studyId === st).length;
    record({ study: label, group: "selection", what: `samples in ${st}`, ours: String(ours), portal: String(theirs), agree: ours === theirs });
  }
  const ex = await buildExploreFederated({ studies, profilesByStudy: mixedProfiles, draft });
  const portalPatients = new Set(portalSamples.map((x) => x.studyId + ":" + x.patientId)).size;
  record({ study: label, group: "selection", what: "patients (Explore)", ours: String(ex.totals?.patients), portal: String(portalPatients), agree: ex.totals?.patients === portalPatients });
  record({ study: label, group: "selection", what: "samples (Explore)", ours: String(ex.totals?.samples), portal: String(portalSamples.length), agree: ex.totals?.samples === portalSamples.length });
  const portal = await api<PortalGene[]>("/mutated-genes/fetch", filter);
  const byKey = new Map(portal.map((g) => [g.hugoGeneSymbol, g]));
  const wrong = (ex.mutatedGenes || []).filter((r) => { const p = byKey.get(r.gene); return !p || oursGene(r) !== portalGene(p); });
  record({ study: label, group: "mutations (Explore)", what: `every row of the table (${(ex.mutatedGenes || []).length})`,
    ours: wrong.length ? wrong.length + " differ: " + wrong.slice(0, 5).map((r) => r.gene + " " + oursGene(r)).join(", ") : "all agree",
    portal: wrong.length ? wrong.slice(0, 5).map((r) => { const p = byKey.get(r.gene); return p ? portalGene(p) : "absent"; }).join(", ") : "all agree",
    agree: !!ex.mutatedGenes?.length && !wrong.length });
}

// 11. who enters a survival curve: the portal's frontend (getPatientSurvivals) keeps a patient only
// with both a status and a months value, neither a missing marker, months a number of at least 0,
// and reads "1:<label>" as the event. Restated here from the portal's own patient data, not from
// lib/survival-sql.ts. hgsoc_tcga_gdc has one patient with months but no status; aml_ohsu_2022 many.
{
  const NULLS = new Set(["[not applicable]", "[not available]", "[pending]", "[discrepancy]", "[completed]", "[null]", "", "na"]);
  const missing = (v: string | undefined) => v === undefined || NULLS.has(v.trim().toLowerCase());
  for (const st of ["hgsoc_tcga_gdc", "aml_ohsu_2022"]) {
    const rows = await api<{ patientId: string; clinicalAttributeId: string; value: string }[]>(
      "/studies/" + st + "/clinical-data?clinicalDataType=PATIENT&projection=SUMMARY&pageSize=10000000");
    const byPatient = new Map<string, Record<string, string>>();
    for (const r of rows) if (r.clinicalAttributeId === "OS_MONTHS" || r.clinicalAttributeId === "OS_STATUS")
      byPatient.set(r.patientId, { ...byPatient.get(r.patientId), [r.clinicalAttributeId]: r.value });
    // the portal's survival charts draw the patients owning a selected sample; its patient data also holds patients with none
    const withSample = new Set((await api<{ patientId: string }[]>("/studies/" + st + "/samples?pageSize=10000000")).map((x) => x.patientId));
    let n = 0, events = 0, noStatus = 0;
    for (const [p, v] of byPatient) {
      if (!withSample.has(p)) continue;
      if (missing(v.OS_STATUS) && !missing(v.OS_MONTHS) && !Number.isNaN(Number(v.OS_MONTHS)) && Number(v.OS_MONTHS) >= 0) noStatus++;
      if (missing(v.OS_STATUS) || missing(v.OS_MONTHS) || Number.isNaN(Number(v.OS_MONTHS)) || Number(v.OS_MONTHS) < 0) continue;
      n++;
      const parts = v.OS_STATUS.split(":").map((t) => t.trim());
      if (parts.length === 2 && parts[0] === "1") events++;
    }
    const resolver = await resolverFor(st, { oncokbPin: await oncokbPin(), ...(await studyProfiles(st)) });
    const ours = await resolver.survivalCounts(null, "OS");
    const oursN = ours.reduce((a, r) => a + r.n, 0), oursEv = ours.reduce((a, r) => a + r.event * r.n, 0);
    record({ study: st, group: "survival", what: "patients in the OS curve", ours: String(oursN), portal: String(n), agree: oursN === n });
    record({ study: st, group: "survival", what: "deaths in the OS curve", ours: String(oursEv), portal: String(events), agree: oursEv === events });
    // the survival view names the patients the portal leaves out silently: a time but no status
    if (!hasViewAggregates(resolver)) throw new Error(st + ": the primary warehouse's resolver has no view aggregates");
    const lo = await resolver.viewAggregate("survivalLeftOut:OS", null, (cs, s2, d) => survivalLeftOutSql(cs, s2, d, "OS_MONTHS", "OS_STATUS"));
    const oursLo = Number(lo[0]?.no_status || 0);
    record({ study: st, group: "survival", what: "patients left out: a time but no status", ours: String(oursLo), portal: String(noStatus), agree: oursLo === noStatus });
  }
}

// 12. a value spelled as missing ("N/A", "nan", any case) is no value, as in the portal's study view
// (its isAttributeValueNA): filtering an attribute to NA selects the samples that hold one.
// brca_mbcproject_wagle_2017 DX_PERCENT_PR has 64 "N/A" patients; prostate_pcbm_swiss_2019 CGA
// "nan" samples.
for (const [st, attr] of [["brca_mbcproject_wagle_2017", "DX_PERCENT_PR"], ["prostate_pcbm_swiss_2019", "CGA"]] as const) {
  const draft = { all: [{ not: { kind: "clinical", attribute: attr, op: "!=", value: "" } }] } as CohortDef;
  const portalSamples = await api<PortalSample[]>("/filtered-samples/fetch", { studyIds: [st], clinicalDataFilters: [{ attributeId: attr, values: [{ value: "NA" }] }] });
  const cohortSql = compileCohortDef(draft, { study: st, db: DB, oncokbPin: await oncokbPin(), ...(await studyProfiles(st)) });
  const ours = Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + memberSamplesSql(cohortSql) + ")", PRIMARY)).data[0].n);
  record({ study: st, group: "selection (missing spellings)", what: "samples with " + attr + " = NA", ours: String(ours), portal: String(portalSamples.length), agree: ours === portalSamples.length && ours > 0 });
}

// 13. a drafted attribute's chart counts its values without its own clause (the portal's charts
// are disjunctive), in every study of the selection: a study none of whose samples hold the picked
// value still shows its values. TUMOR_TISSUE_SITE = Breast over breast + lung TCGA PanCan keeps
// lung's "Lung"; the portal is asked per study, since its multi-study counts inflate
// (findings: a study added doubles another's counts).
{
  const studies = ["brca_tcga_pan_can_atlas_2018", "luad_tcga_pan_can_atlas_2018"], attr = "TUMOR_TISSUE_SITE";
  const ex = await buildExploreFederated({ studies, profilesByStudy: new Map(), draft: { all: [{ kind: "clinical", attribute: attr, values: ["Breast"] }] } as CohortDef });
  const ours = new Map(((ex.clinical.find((c) => c.attribute === attr && c.kind === "cat") as CatFacet | undefined)?.values || []).map((v) => [v.v, v.n]));
  const theirs = new Map<string, number>();
  for (const st of studies)
    for (const v of (await api<PortalCount[]>("/clinical-data-counts/fetch", { attributes: [{ attributeId: attr }], studyViewFilter: { studyIds: [st] } }))[0]?.counts || [])
      if (v.value !== "NA") theirs.set(v.value, (theirs.get(v.value) || 0) + v.count);
  for (const v of [...theirs.keys()].sort())
    record({ study: studies.join(" + ") + " · " + attr + " = Breast", group: "clinical (drafted attribute)", what: attr + " = " + v,
      ours: String(ours.get(v) ?? "absent"), portal: String(theirs.get(v)), agree: ours.get(v) === theirs.get(v) });
}

// 14. a study's patients are those who own a sample: a patient record with no sample is not
// counted, filtered or not, as on the portal's study view. hgsoc_tcga_gdc has 20 sampleless
// patients, 9 with an OS_STATUS. The NA bar is compared too: the cohort's patients minus those
// with a value.
{
  const st = "hgsoc_tcga_gdc", attr = "OS_STATUS";
  const ex = await buildExplore({ study: st });
  const f = ex.clinical.find((c) => c.attribute === attr && c.kind === "cat") as CatFacet | undefined;
  const ours = new Map((f?.values || []).map((v) => [v.v, v.n]));
  ours.set("NA", (ex.totals?.patients ?? 0) - [...ours.values()].reduce((a, b) => a + b, 0));
  const portal = (await api<PortalCount[]>("/clinical-data-counts/fetch", { attributes: [{ attributeId: attr }], studyViewFilter: { studyIds: [st] } }))[0]?.counts || [];
  for (const v of portal)
    record({ study: st, group: "clinical (patients who own a sample)", what: attr + " = " + v.value, ours: String(ours.get(v.value) ?? "absent"), portal: String(v.count), agree: ours.get(v.value) === v.count });
}

// 15. a generic-assay chart counts samples (patients only for a patient-level profile), as the
// portal's study view does. difg_glass_2019 holds primary and recurrence samples of the same
// patients, so counting patients would read lower; the NA bar is the cohort's samples without a value.
{
  const st = "difg_glass_2019", profileType = "armlevel_cna", entity = "1p_status";
  const [f] = await buildAssayFacets({ studies: [st], profilesByStudy: new Map([[st, { gaProfiles: [profileType] }]]), charts: [{ profileType, entity }] });
  const ours = new Map((f?.values || []).map((v) => [v.v, v.n]));
  ours.set("NA", (f?.total ?? 0) - (f?.measured ?? 0));
  const portal = (await api<{ counts: PortalCount["counts"] }[]>("/generic-assay-data-counts/fetch",
    { genericAssayDataFilters: [{ stableId: entity, profileType }], studyViewFilter: { studyIds: [st] } }))[0]?.counts || [];
  for (const v of portal)
    record({ study: st, group: "generic assay (samples)", what: entity + " = " + v.value, ours: String(ours.get(v.value) ?? "absent"), portal: String(v.count), agree: ours.get(v.value) === v.count });
}

// 16. a sample on several panels of one alteration type is profiled once: nsclc_ctdx_msk_2022 has
// 219 samples with a whole-exome copy-number row beside a panel row, which the portal's study view
// counts twice (EGFR 2,840 profiled in a 2,621-sample study). Compared with the portal's own
// per-sample panel data, each sample once.
{
  const st = "nsclc_ctdx_msk_2022";
  const ex = await buildExplore({ study: st, ...(await studyProfiles(st)) });
  const once = await portalProfiledOnce(st, "COPY_NUMBER_ALTERATION");
  for (const r of (ex.cnaGenes || []).slice(0, 5))
    record({ study: st, group: "copy number (profiled once per sample)", what: r.gene + (r.cna === 2 ? " amplified" : " deleted"),
      ours: String(r.profiled), portal: String(once(r.gene)), agree: r.profiled === once(r.gene) });
}

// 8. uncalled mutations are not alterations
{
  const study = "glioma_msk_2018", { profiles } = await studyProfiles(study);
  for (const g of ["IDH1", "TP53", "PDGFRB"]) {
    const pn = new Set((await portalMutations(study + "_mutations", study, g)).map((m) => m.sampleId)).size;
    const sql = oqlCasesSql(g + ": MUT", { study, db: DB, profiles, unit: "sample" });
    const ours = Number((await chQuery<{ n: string }>("SELECT count() AS n FROM (" + sql + ")", PRIMARY)).data[0].n);
    record({ study, group: "cohort", what: `samples matching OQL "${g}: MUT" (the study's uncalled mutations left out, as the portal does)`,
      ours: String(ours), portal: String(pn), agree: ours === pn });
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
