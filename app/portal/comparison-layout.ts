// The Comparison page's document, as cBioPortal lays its group comparison out: one tab per portal
// tab, each drawing the compared groups. Pure: the page builds it, and so can a test.
import type { AnalysisDoc, View } from "../../lib/types.ts";
import { arrange, type PageLayout } from "./page-doc.ts";
import { expressionProfile, proteinProfile, methylationProfile, probeMethylation, assayComparisonProfiles, type StudyKnown } from "./study-known.ts";

const CLINICAL_SHOWN = 8;

/** the page's tabs; before the study's profiles and attributes are known (`known` null), those that need neither */
export function comparisonLayout(linked: AnalysisDoc, study: string, known: StudyKnown | null, drivers: boolean): PageLayout {
  const names = Object.keys(linked.cohorts || {});
  const catalog = known?.profileCatalog || [];
  // the portal's expression tabs, each a diffexpr view on one profile, which compares exactly two
  // cohorts; protein and methylation open as the portal shows them, without gene-set enrichment
  const expression = !known ? [] : [
    { title: "mRNA", profile: expressionProfile(catalog), none: "no mRNA profile", extra: {} },
    { title: "Protein", profile: proteinProfile(catalog), none: "no protein profile", extra: { geneSets: [] } },
    { title: "DNA methylation", profile: methylationProfile(catalog), extra: { geneSets: [] },
      none: probeMethylation(catalog) ? "this study's methylation is per probe, a generic assay, which this page does not compare" : "no methylation profile" },
  ];
  const twoGroups = names.length === 2;
  const assays = known ? assayComparisonProfiles(catalog) : [];
  const clinical = known?.clinical || [];
  const v = (title: string, view: Record<string, unknown>) => ({ title, view: view as unknown as View });
  const measure = drivers ? "driver" : "any";
  const left = !known ? [] : [!clinical.length && "Clinical (no attributes)",
    ...expression.filter((e) => !e.profile || !twoGroups).map((e) => e.title + " (" + (!e.profile ? e.none
      : "compares exactly two groups, and " + names.length + (names.length === 1 ? " is" : " are") + " compared" +
        (names.length > 2 ? "; cBioPortal tests more than two with ANOVA, which this page does not yet" : "")) + ")"),
    !assays.length && "Generic Assays (no generic-assay profile)"].filter(Boolean) as string[];
  return arrange({ study, cohorts: linked.cohorts }, [
    { title: "Overlap", views: [v("Overlap", { kind: "overlap" })] },
    { title: "Survival", views: [v("Survival", { kind: "survival" })] },
    ...(clinical.length ? [{ title: "Clinical", views: [v("Clinical", { kind: "clinical", attributes: clinical.slice(0, CLINICAL_SHOWN) })] }] : []),
    { title: "Genomic Alterations", views: [v("Mutations", { kind: "enrichment", alteration: "mutation", measure }), v("Copy-number alterations", { kind: "enrichment", alteration: "cna", measure }),
      v("Structural variants", { kind: "enrichment", alteration: "sv", measure })] },
    ...(twoGroups ? expression.filter((e) => e.profile).map((e) => ({ title: e.title, views: [v(e.title, { kind: "diffexpr", profileType: e.profile, ...e.extra })] })) : []),
    ...assays.map((a) => ({ title: a.label, views: [v(a.label, { kind: "assays", profileType: a.profile })] })),
    { title: "Clinical Data", views: [v("Clinical data", { kind: "table" })] }
  ], left, { partial: !known });
}
