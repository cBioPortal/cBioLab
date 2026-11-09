// "Open in cBioPortal" for the Comparison page, a parity aid. cBioPortal's comparison page reads its
// groups from a session saved to its session service, so the link is made by saving one: the page's
// cohorts as their samples, as the portal's own "Compare" buttons save them
// (ComparisonGroupClient.addComparisonSession, getGroupParameters), then
// /comparison/<tab>?comparisonId=<id>. Pure and browser-safe; app/api/legacy-comparison saves the
// session, server-side, so no sample id reaches the browser.
//
// Self-contained so it can be deleted when parity checking ends: this file, its test, that route,
// app/portal/legacy-comparison-button.tsx, and the one line in app/portal/PortalTabs.tsx that draws it;
// then the Comparison page's check in test/e2e/portal.cjs goes back to a disabled button saying why
// (lib/legacy-link.ts still says it), and docs/PORTAL-PARITY.md loses its sentence about sessions.
import type { PortalHold } from "./legacy-link.ts";

/** the Comparison page's tabs by their title here → cBioPortal's tab path (GroupComparisonTabs.ts) */
export const COMPARISON_TABS: Record<string, string> = {
  "Overlap": "overlap", "Survival": "survival", "Clinical": "clinical", "Genomic Alterations": "alterations",
  "Mutations": "mutations", "mRNA": "mrna", "Protein": "protein", "DNA methylation": "dna_methylation", "Pathways": "pathways",
};

/** the most groups a session is saved with, and the most samples in all */
export const SESSION_MAX_GROUPS = 20;
export const SESSION_MAX_SAMPLES = 100_000;

export interface SessionGroup { name: string; description: string; studies: { id: string; samples: string[] }[]; origin: string[] }
export interface ComparisonSession { groups: SessionGroup[]; origin: string[]; groupNameOrder: string[] }

/** the session the portal saves for these groups of one study's samples, in this order */
export function comparisonSession(study: string, groups: { name: string; samples: string[] }[]): ComparisonSession {
  if (!groups.length) throw new Error("no groups to compare");
  if (groups.length > SESSION_MAX_GROUPS) throw new Error(groups.length + " groups, and a session is saved with at most " + SESSION_MAX_GROUPS);
  const total = groups.reduce((n, g) => n + g.samples.length, 0);
  if (total > SESSION_MAX_SAMPLES) throw new Error(total + " samples in the groups, and a session is saved with at most " + SESSION_MAX_SAMPLES);
  const empty = groups.find((g) => !g.samples.length);
  if (empty) throw new Error("group “" + empty.name + "” has no samples in " + study);
  return {
    groups: groups.map((g) => ({ name: g.name, description: "", studies: [{ id: study, samples: [...new Set(g.samples)] }], origin: [study] })),
    origin: [study],
    groupNameOrder: groups.map((g) => g.name),
  };
}

/** the saved session's page on the portal, on the tab like this page's open one when it has one */
export function comparisonHref(portal: string, id: string, tab?: string): string {
  const path = tab && COMPARISON_TABS[tab];
  return portal.replace(/\/+$/, "") + "/comparison" + (path ? "/" + path : "") + "?comparisonId=" + encodeURIComponent(id);
}

/** what the button does here, or why it cannot: `null` while the study list loads */
export function legacyComparisonState(study: string, cohorts: string[], tab: string | undefined, held: Record<string, PortalHold | undefined> | null): { ok: boolean; tip: string } | null {
  if (!held) return null;
  const h = held[study];
  if (!h) return { ok: false, tip: "waiting for the study list, which says whether cBioPortal holds this study" };
  if ("why" in h) return { ok: false, tip: h.why };
  if (!cohorts.length) return { ok: false, tip: "no groups to compare" };
  const site = h.portal.replace(/^https?:\/\//, "");
  const where = tab && COMPARISON_TABS[tab] ? "on its " + tab + " tab" : "on its first tab" + (tab ? " — cBioPortal has no tab like “" + tab + "”" : "");
  return { ok: true, tip: "save these " + cohorts.length + " groups to " + site + "'s session service (their sample ids, which it already holds) and open the comparison there, " + where };
}
