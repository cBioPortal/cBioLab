// The Comparison page's document, as cBioPortal lays its group comparison out: one tab per portal
// tab, each drawing the compared groups. Pure: the page builds it, and so can a test.
import type { AnalysisDoc, View } from "../../lib/types.ts";
import { arrange, type PageLayout } from "./page-doc.ts";
import { mrnaComparisonProfile, proteinProfile, methylationProfile, probeMethylation, assayComparisonProfiles, type StudyKnown } from "./study-known.ts";

const CLINICAL_SHOWN = 8;
/** the most groups an expression tab compares (the diffexpr view's limit) */
const EXPRESSION_MAX_GROUPS = 10;

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
  const assays = known ? assayComparisonProfiles(catalog) : [];
  const clinical = known?.clinical || [];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const measure = drivers ? "driver" : "any";
  const left = !known ? [] : [!clinical.length && "Clinical (no attributes)",
    ...expression.filter((e) => (!e.profile && e.none) || (e.profile && !groupsOk)).map((e) => e.title + " (" + (!e.profile ? e.none
      : "compares 2 to " + EXPRESSION_MAX_GROUPS + " groups, and " + names.length + (names.length === 1 ? " is" : " are") + " compared") + ")"),
    !assays.length && "Generic Assays (no generic-assay profile)"].filter(Boolean) as string[];
  return arrange({ study, cohorts: linked.cohorts }, [
    { title: "Overlap", views: [v("Overlap", { kind: "overlap" })] },
    { title: "Survival", views: [v("Survival", { kind: "survival" })] },
    ...(clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: clinical.slice(0, CLINICAL_SHOWN) })] }] : []),
    { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation", measure }), v("Copy-number alterations", { kind: "enrichment", alteration: "cna", measure }),
      v("Structural variants", { kind: "enrichment", alteration: "sv", measure })] },
    ...(groupsOk ? expression.filter((e) => e.profile).map((e) => ({ title: e.title, views: [v(e.title, { kind: "diffexpr", profileType: e.profile, ...e.extra })],
      // the portal's tab offers the data set alone
      locks: ["log2", "geneSets"] })) : []),
    // the portal's generic-assay tab offers the data set alone
    ...assays.map((a) => ({ title: a.label, views: [v(a.label, { kind: "assays", profileType: a.profile })], locks: ["minN"] })),
    { title: "Clinical Data", views: [v("Clinical data", { kind: "table" })] }
  ], left, { partial: !known });
}
