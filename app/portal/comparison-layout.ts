// The Comparison page's document, as cBioPortal lays its group comparison out: one tab per portal
// tab, each drawing the compared groups. Pure: the page builds it, and so can a test.
import type { AnalysisDoc, View } from "../../lib/types.ts";
import { arrange, type PageLayout } from "./page-doc.ts";
import { mrnaComparisonProfile, proteinProfile, methylationProfile, probeMethylation, assayComparisonProfiles, type StudyKnown } from "./study-known.ts";

/** the most groups an expression tab compares (the diffexpr view's limit) */
const EXPRESSION_MAX_GROUPS = 10;

/** the portal's priorities for the usual survival endpoints (Survival.tsx); others follow, by name */
const SURVIVAL_PRIORITY = ["OS", "DFS", "PFS", "DSS"];

/**
 * The endpoint the Survival tab opens on: the study's <X>_MONTHS / <X>_STATUS pairs, the first by the
 * portal's priority; null when it has none, and the tab is not shown (CMP-SV-1, CMP-PG-4).
 */
export function survivalDefault(attributes: string[]): string | null {
  const ids = new Set(attributes);
  const pairs = [...ids].map((a) => /^(.+)_MONTHS$/.exec(a)?.[1]).filter((x): x is string => !!x && ids.has(x + "_STATUS")).sort();
  return SURVIVAL_PRIORITY.find((e) => pairs.includes(e)) || pairs[0] || null;
}

/** the page's tabs; before the study's profiles and attributes are known (`known` null), those that need neither */
export function comparisonLayout(linked: AnalysisDoc, study: string, known: StudyKnown | null, drivers: boolean): PageLayout {
  const names = Object.keys(linked.cohorts || {});
  const catalog = known?.profileCatalog || [];
  // the portal's expression tabs, each a diffexpr view on one profile: a t-test for two groups, an
  // ANOVA for more; without gene-set enrichment, which the portal's tabs do not have
  const expression = !known ? [] : [
    { title: "mRNA", profile: mrnaComparisonProfile(catalog), none: "no mRNA profile", extra: { geneSets: [] } },
    { title: "Protein", profile: proteinProfile(catalog), none: "no protein profile", extra: { geneSets: [] } },
    { title: "DNA methylation", profile: methylationProfile(catalog), extra: { geneSets: [] },
      // per-probe methylation has its own tab, Methylation, as the portal's
      none: probeMethylation(catalog) ? null : "no methylation profile" },
  ];
  const groupsOk = names.length >= 2 && names.length <= EXPRESSION_MAX_GROUPS;
  // the portal's Mutations tab: shown when a study has a mutation profile, drawing exactly two groups
  const mutationProfile = catalog.some((p) => p.type === "MUTATION_EXTENDED");
  const mutationsOk = mutationProfile && names.length === 2;
  const assays = known ? assayComparisonProfiles(catalog) : [];
  const clinical = known?.clinical || [];
  const endpoint = survivalDefault(clinical);
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const measure = drivers ? "driver" : "any";
  const left = !known ? [] : [!clinical.length && "Clinical (no attributes)", !endpoint && "Survival (no survival data)",
    !mutationProfile ? "Mutations (no mutation profile)" : !mutationsOk && "Mutations (compares exactly 2 groups, and " + names.length + (names.length === 1 ? " is" : " are") + " compared)",
    ...expression.filter((e) => (!e.profile && e.none) || (e.profile && !groupsOk)).map((e) => e.title + " (" + (!e.profile ? e.none
      : "compares 2 to " + EXPRESSION_MAX_GROUPS + " groups, and " + names.length + (names.length === 1 ? " is" : " are") + " compared") + ")"),
    !assays.length && "Generic Assays (no generic-assay profile)"].filter(Boolean) as string[];
  return arrange({ study, cohorts: linked.cohorts }, [
    { title: "Overlap", views: [v("Overlap", { kind: "overlap" })] },
    // the survival-type table beside the curves, which start on the portal's first endpoint; groups
    // that share patients (the page's Include mode) are drawn as their overlaps, and the test given at
    // any group size, as the portal does both. Before the study's attributes are known the tab is
    // offered on OS, and once known only with survival data
    ...(!known || endpoint ? [{ title: "Survival", views: [v("Survival", { kind: "survival", types: true, partitions: true, testAnySize: true,
      ...(endpoint && endpoint !== "OS" ? { endpoint } : {}) })] }] : []),
    // every attribute, as the portal's tab tests them
    ...(clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", allAttributes: true, rankTests: true })] }] : []),
    // one table over every alteration type, under the portal's type tree, listing every gene tested
    { title: "Genomic Alterations", views: [v("Genomic Alterations", { kind: "enrichment", alteration: "any", minAltered: 1, measure })] },
    ...(mutationsOk ? [{ title: "Mutations", views: [v("Mutations", { kind: "mutcompare" })] }] : []),
    ...(groupsOk ? expression.filter((e) => e.profile).map((e) => ({ title: e.title, views: [v(e.title, { kind: "diffexpr", profileType: e.profile, ...e.extra })],
      // the portal's tab offers the data set alone
      locks: ["log2", "geneSets"] })) : []),
    // the portal's generic-assay tab offers the data set alone
    ...assays.map((a) => ({ title: a.label, views: [v(a.label, { kind: "assays", profileType: a.profile })], locks: ["minN"] })),
    { title: "Clinical Data", views: [v("Clinical data", { kind: "table" })] }
  ], left, { partial: !known });
}
