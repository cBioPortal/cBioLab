// The same page on the legacy cBioPortal: a portal page's state (which page, its studies, patient or
// sample, gene query, filters, open tab and sub-tab) as the URL cBioPortal's own frontend reads, or
// the reason there is none. The URL formats are the frontend's (src/routes.tsx, ResultsViewURLWrapper,
// ResultsViewPageHelpers, PatientViewPageTabIds, PatientViewUrlWrapper); a cBioLab tab maps to a
// cBioPortal tab by its title here, in one place, so a page that gains a tab gains its link by a line
// below. Pure and browser-safe: the page builds the link, and /api/studies says which studies the
// portal holds (portalHold).
import type { Clause } from "./types.ts";
import { assayTypeOfGroup } from "./profile-catalog.ts";

/** a page's state, less its open tab */
export type LegacyPage =
  | { page: "results"; studies: string[]; entries: string[]; filters: Clause[] }
  | { page: "patient"; study: string; patient?: string; sample?: string }
  | { page: "comparison"; study: string };

/** where on the page: the open tab, its sub-tab, and the gene a tab's gene chips have chosen */
export interface LegacyWhere { tab?: string; sub?: string; gene?: string }

/** whether the portal holds a study: its address, or why not */
export type PortalHold = { portal: string } | { why: string };

/** the link, or the reason there is none; `tip` says which (and names any tab it could not match) */
export type LegacyLink = { href: string; tip: string } | { href: null; tip: string };

type Tab = { id: string; label: string };
const t = (id: string, label: string): Tab => ({ id, label });

/** the Results page's tabs by their title here (ResultsViewTab) */
export const RESULTS_TABS: Record<string, Tab> = {
  "Oncoprint": t("oncoprint", "OncoPrint"),
  "Cancer Types Summary": t("cancerTypesSummary", "Cancer Types Summary"),
  "Mutual Exclusivity": t("mutualExclusivity", "Mutual Exclusivity"),
  "Plots": t("plots", "Plots"),
  "Mutations": t("mutations", "Mutations"),
  "Structural Variants": t("structuralVariants", "Structural Variants"),
  "Co-expression": t("coexpression", "Co-expression"),
  "Comparison/Survival": t("comparison", "Comparison/Survival"),
  "CN Segments": t("cnSegments", "CN Segments"),
  "Pathways": t("pathways", "Pathways"),
  "Download": t("download", "Download"),
};
/** Comparison/Survival's sub-tabs by their title here (ResultsViewComparisonSubTab); a generic-assay one is `generic_assay_<type>` */
export const COMPARISON_SUBTABS: Record<string, Tab> = {
  "Overlap": t("overlap", "Overlap"),
  "Survival": t("survival", "Survival"),
  "Clinical": t("clinical", "Clinical"),
  "Genomic Alterations": t("alterations", "Genomic Alterations"),
  "mRNA": t("mrna", "mRNA"),
  "Protein": t("protein", "Protein"),
  "DNA methylation": t("dna_methylation", "DNA Methylation"),
};
/** the Patient page's tabs by their title here (PatientViewPageTabs) */
export const PATIENT_TABS: Record<string, Tab> = {
  "Summary": t("summary", "Summary"),
  "Pathways": t("pathways", "Pathways"),
  "Clinical Data": t("clinicalData", "Clinical Data"),
  "Genomic Evolution": t("genomicEvolution", "Genomic Evolution"),
  "Mutational Signatures": t("mutationalSignatures", "Mutational Signatures"),
  "Files & Links": t("filesAndLinks", "Files & Links"),
};
const RESULTS_DEFAULT = RESULTS_TABS["Oncoprint"], PATIENT_DEFAULT = PATIENT_TABS["Summary"], SUB_DEFAULT = COMPARISON_SUBTABS["Overlap"];

/** the longest link this builds; a query whose sample list would pass it is refused, not cut */
export const LEGACY_URL_MAX = 8000;

const enc = encodeURIComponent;
const query = (p: [string, string][]) => p.map(([k, v]) => k + "=" + enc(v)).join("&");
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const no = (tip: string): LegacyLink => ({ href: null, tip });

/**
 * Whether the portal at `portal` holds a study, from the study's row in /api/studies. Only a study
 * this deployment reads from its primary connection is one the portal serves — that connection is
 * the portal's own database (PORTAL_URL names the portal its studies' links open); a second
 * connection's study, a federation peer's, a local import, or a consortium or private study (by the
 * portal's naming, whatever this deployment is entitled to) is not.
 */
export function portalHold(row: { id: string; instance: string; instanceLabel: string }, ctx: { portal: string; primary: string; local: boolean; restricted: boolean }): PortalHold {
  const where = host(ctx.portal);
  if (ctx.local) return { why: row.id + " was imported into this local cBioLab, so " + where + " may not hold it, or not as imported here" };
  if (row.instance === "peer") return { why: row.id + " is held by " + row.instanceLabel + ", a federation peer, not by " + where };
  if (row.instance !== ctx.primary) return { why: row.id + " is in " + row.instanceLabel + ", not in the database " + where + " serves" };
  if (ctx.restricted) return { why: row.id + " is a consortium or private study, which " + where + " does not serve publicly" };
  return { portal: ctx.portal.replace(/\/+$/, "") };
}

/** the samples a Results page's filters keep, as the portal's link says them; or why it cannot */
function cases(studies: string[], filters: Clause[]): { params: [string, string][] } | { why: string } {
  if (!filters.length) return { params: [["case_set_id", studies.length === 1 ? studies[0] + "_all" : "all"]] };
  const cant = (what: string) => ({ why: "this page's filters (" + what + ") are not something cBioPortal's Results link can say, and it would open a different set of samples" });
  if (filters.length > 1) return cant(filters.length + " filters");
  const f = filters[0] as Clause & { kind?: string; id?: string; ids?: string[]; set?: string };
  if (f.kind === "caseList" && studies.length === 1 && f.id) {
    const id = f.id.startsWith(studies[0] + "_") ? f.id : studies[0] + "_" + f.id;
    return { params: [["case_set_id", id]] };
  }
  if (f.kind === "sampleList" && Array.isArray(f.ids) && !f.set && f.ids.every((s) => studies.includes(s.split(":")[0]) && s.includes(":")))
    return { params: [["case_ids", f.ids.join("+")]] };
  return cant(f.kind === "caseList" ? "a case list across several studies" : f.kind === "sampleList" ? "a stored or cross-study sample list" : (f.kind || "a filter") + " filter");
}

/** where the link opens, and the tab asked for when cBioPortal has none like it */
const opens = (asked: string | undefined, used: Tab, known: boolean) =>
  "on its " + used.label + " tab" + (asked && !known ? " — cBioPortal has no tab like “" + asked + "”" : "");

/** The page on the legacy portal, or why there is none. `held` is each study's portalHold. */
export function legacyLink(p: LegacyPage, where: LegacyWhere, held: Record<string, PortalHold | undefined>): LegacyLink {
  const studies = p.page === "results" ? p.studies : [p.study];
  if (p.page === "comparison")
    return no("cBioPortal's Comparison page opens groups saved to its session service, which a link from here cannot create yet");
  const holds = studies.map((s) => held[s]);
  if (holds.some((h) => !h)) return no("waiting for the study list, which says whether cBioPortal holds " + (studies.length === 1 ? "this study" : "these studies"));
  const not = holds.find((h): h is { why: string } => "why" in h!);
  if (not) return no(not.why);
  const base = (holds[0] as { portal: string }).portal.replace(/\/+$/, "");
  const site = host(base);

  if (p.page === "patient") {
    const asked = where.tab;
    const tab = (asked && PATIENT_TABS[asked]) || PATIENT_DEFAULT;
    const id: [string, string] = p.sample ? ["sampleId", p.sample] : ["caseId", p.patient || ""];
    return { href: base + "/patient/" + tab.id + "?" + query([["studyId", p.study], id]),
      tip: "open this " + (p.sample ? "sample" : "patient") + " on cBioPortal (" + site + "), " + opens(asked, tab, !!PATIENT_TABS[asked || ""]) };
  }

  const c = cases(studies, p.filters);
  if ("why" in c) return no(c.why);
  const asked = where.tab;
  const tab = (asked && RESULTS_TABS[asked]) || RESULTS_DEFAULT;
  let path = "/results/" + tab.id, label = tab.label;
  if (tab.id === "comparison") {
    const s = where.sub?.trim();
    const sub = s ? COMPARISON_SUBTABS[s] : SUB_DEFAULT;
    // a sub-tab not in the list is a generic-assay kind's, which the portal names by its type
    path += "/" + (sub ? sub.id : "generic_assay_" + assayTypeOfGroup(s!).toLowerCase());
    label += " › " + (sub ? sub.label : s);
  }
  const params: [string, string][] = [["cancer_study_list", studies.join(",")], ...c.params, ["gene_list", p.entries.join("\n")]];
  if (where.gene && (tab.id === "mutations" || tab.id === "structuralVariants")) params.push(["mutations_gene", where.gene]);
  const href = base + path + "?" + query(params);
  if (href.length > LEGACY_URL_MAX)
    return no("this page's samples make a link of " + href.length.toLocaleString("en-US") + " characters, past the " + LEGACY_URL_MAX.toLocaleString("en-US") + " this button puts in one");
  return { href, tip: "open this query on cBioPortal (" + site + "), " + opens(asked, { ...tab, label }, !!RESULTS_TABS[asked || ""]) };
}
