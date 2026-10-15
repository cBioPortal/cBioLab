"use client";
// The Saved and Examples tabs' state and actions: the example cohorts and the reader's saved ones
// ticked to analyse together, each example's previewed count, the gallery's tag filter, running
// a documented example, and its shareable ?doc= link. The state is kept by the page's hook, not
// by the tabs, so it survives switching tabs.
import { useState } from "react";
import type { AnalysisDoc, TemplateDoc, CohortDef } from "../../lib/types.ts";
import type { DslExample } from "../../lib/dsl-reference.ts";
import { DOC_VERSION } from "../../lib/doc-version.ts";
import { LINE_TYPE } from "../../lib/treatment-lines.ts";

import type { DocStore } from "./doc-store.ts";
import type { SavedCohort, Shared } from "./use-saved.ts";

const IMMUNO_EVENT: any = { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } };

interface Example { name: string; desc: string; def: CohortDef }
/** The Saved tab's example cohorts: definitions to preview, save or analyse, one per kind of clause. */
/** A document as a ?doc= value: base64url of its UTF-8 JSON, as the page reads it back. */
export function docParam(d: AnalysisDoc | TemplateDoc): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const EXAMPLES: Example[] = [
  { name: "Immuno-treated", desc: "any immunotherapy on the timeline",
    def: { all: [IMMUNO_EVENT] } },
  { name: "STK11-driver", desc: "OQL: STK11 with an OncoKB driver call",
    def: { all: [{ kind: "oql", q: "STK11: DRIVER" }] } },
  { name: "OQL: KRAS G12C or STK11 driver", desc: "portal OQL syntax as a clause",
    def: { all: [{ kind: "oql", q: "KRAS: MUT=G12C; STK11: DRIVER" }] } },
  { name: "Never smokers", desc: "clinical attribute predicate",
    def: { all: [{ kind: "clinical", attribute: "SMOKING_PREDICTIONS_3_CLASSES", op: "=", value: "Never" }] } },
  { name: "Progressed ≤180d post-immuno", desc: "temporal relation on the timeline",
    def: { all: [{ kind: "event", a: IMMUNO_EVENT.a, b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "BEFORE", minDays: 0, maxDays: 180 } }] } },
  { name: "True 1L immuno (naïve)", desc: "first immuno, prior-treatment guard on",
    def: { all: [{ kind: "event", a: { ...IMMUNO_EVENT.a, occurrence: "FIRST" }, rel: { type: "NONE" }, priorGuard: true }] } },
  { name: "Reached 2nd line", desc: "derived treatment-line event",
    def: { all: [{ kind: "event", a: { eventType: LINE_TYPE, attrs: [{ key: "LINE_NO", value: "2" }] }, rel: { type: "NONE" } }] } },
  { name: "STK11-driver in IMPACT-50k", desc: "study override: runs in IMPACT-50k regardless of the picker",
    def: { study: "msk_impact_50k_2026", all: [{ kind: "oql", q: "STK11: DRIVER" }] } },
  { name: "TP53-mut across CHORD + MET", desc: "two-study union (overlap not deduplicated)",
    def: { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] } },
  { name: "EGFR-driver pan-MSK", desc: "union across three MSK studies",
    def: { studies: ["msk_chord_2024", "msk_met_2021", "msk_impact_50k_2026"], all: [{ kind: "oql", q: "EGFR: DRIVER" }] } },
  { name: "ERBB2 over-expressed (TCGA BRCA)", desc: "study override: OQL EXP>2 in TCGA BRCA, where mRNA exists",
    def: { study: "brca_tcga_pan_can_atlas_2018", all: [{ kind: "oql", q: "ERBB2: EXP>2" }] } }
];

/** What useLibrary needs from the analysis page. */
export interface LibraryPage {
  docs: DocStore;
  evalDef: (name: string, def: CohortDef) => Promise<{ count: number; text: string; }>;
  goTab: (t: "explore" | "cohorts" | "analysis" | "examples") => void;
  persist: (name: string, def: CohortDef, lastEval: SavedCohort["lastEval"]) => Promise<unknown>;
  saved: Record<string, SavedCohort>;
  /** cohorts others shared with the reader, ticked as "shared:<id>" */
  sharedSaved: Shared<SavedCohort>[];
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setStudy: React.Dispatch<React.SetStateAction<string>>;
  study: string;
}

export function useLibrary(page: LibraryPage) {
  const { docs, evalDef, goTab, persist, saved, sharedSaved, setError, setStudy, study } = page;
  /** The "Saved" tab's own sub-tabs (Cohorts / Analyses) — these used to be
   *  two separate top-level tabs ("Cohorts" and "Saved") with a cross-link
   *  between them ("manage on the Saved tab"); one tab, two sub-tabs instead. */
  const [cohortsSubTab, setCohortsSubTab] = useState<"cohorts" | "analyses">("cohorts");
  const [exTag, setExTag] = useState<string>("all");     // Examples tab filter
  const [picked, setPicked] = useState<string[]>([]);        // Cohorts tab: keys "ex:<name>" / "saved:<name>" / "shared:<id>"
  const [exEvals, setExEvals] = useState<Record<string, { count?: number; error?: string; busy?: boolean } | null>>({});

  /**
   * Cohorts tab: analyse the ticked cohorts together. Like Explore's Analyze it
   * REPLACES the document — the selection is the analysis, not an addition to
   * whatever was there before.
   */
  const analyzePicked = () => {
    const chosen: [string, CohortDef][] = [];
    for (const key of picked) {
      const rest = key.slice(key.indexOf(":") + 1);
      const other = key.startsWith("shared:") ? sharedSaved.find((x) => x.id === rest) : undefined;
      let name = other ? other.name : rest;
      const def = key.startsWith("ex:") ? (EXAMPLES.find((e) => e.name === name) || {}).def
        : other ? other.item.def
        : (saved[name] || {}).def;
      // someone else's cohort may share a name with one already chosen: say whose it is
      if (other && chosen.some(([n]) => n === name)) name += " (" + (other.owner.name || other.owner.email) + ")";
      if (def) chosen.push([name, def]);
    }
    if (!chosen.length) return;
    // refused rather than cut to the first sixteen: the reader ticked these, so analysing some
    // of them without saying which would answer a different question than the one asked
    if (chosen.length > 16) {
      setError("an analysis takes at most 16 cohorts; " + chosen.length + " are ticked — untick " + (chosen.length - 16) + " and analyse again");
      return;
    }
    const nd: AnalysisDoc = { dsl: DOC_VERSION, study, cohorts: Object.fromEntries(chosen), views: [] };
    docs.replace(nd);
    setError(null);
    goTab("analysis");
  };
  const togglePick = (key: string) =>
    setPicked((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]);

  /** Load a documented example into the Analysis tab and run it. */
  const runDocExample = (ex: DslExample) => {
    const d = JSON.parse(JSON.stringify(ex.doc)) as AnalysisDoc;   // never hand the shared object to the editor
    docs.replace(d);
    setStudy(d.study || study);
    setError(null);
    goTab("analysis");
  };

  // Accepts the authored form: this only serialises, and a template is exactly
  // what you want to share when the point is that it can be re-pointed.
  const docLink = (d: AnalysisDoc | TemplateDoc): string => location.origin + location.pathname + "?doc=" + docParam(d);

  const previewExample = async (ex: any) => {
    setExEvals(s => ({ ...s, [ex.name]: { busy: true } }));
    try { const ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); }
    catch (e) { setExEvals(s => ({ ...s, [ex.name]: { error: String((e as Error)?.message || e) } })); }
  };

  const saveExample = async (ex: any) => {
    let ev: { count?: number; error?: string; busy?: boolean } | null = exEvals[ex.name] && exEvals[ex.name]!.count != null ? exEvals[ex.name] : null;
    if (!ev) { try { ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); } catch { ev = null; } }
    const lastEval = ev && ev.count != null ? { count: ev.count } : null;
    try { await persist(ex.name, ex.def, lastEval); } catch { /* the Examples tab has no error banner of its own */ }
  };

  return { cohortsSubTab, setCohortsSubTab, exTag, setExTag, picked, setPicked, exEvals, setExEvals, analyzePicked, togglePick, runDocExample, docLink, previewExample, saveExample };
}
