// The analysis page's WebMCP tools: read the document and its results, and edit the analysis.
//
// Every edit goes the same way: build the new document, have the engine run it WITHOUT
// touching the page, and commit it to the page only if the engine accepted it. A rejected
// edit returns the engine's reason and leaves the page exactly as it was — the loud-rejection
// rule, applied to an agent. The page supplies a bridge that is refreshed on every render, so
// a tool always reads the current document even while the user is editing it too.
import { exposeTools, type AgentTool, type Json } from "../../lib/webmcp.ts";
import { analysisText } from "../../lib/result-text.ts";
import { AGENT_GRAMMAR, EXAMPLES, type DslExample } from "../../lib/dsl-reference.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, ExploreResult, PartitionDef } from "../../lib/types.ts";
import { withoutPartition, editSplits, splitKey } from "../../lib/partition-arms.ts";
import { api } from "./api.ts";
import { useEffect, useRef, useState } from "react";
import { cohortHash } from "../../lib/cohort-hash.ts";

export interface LabBridge {
  doc: AnalysisDoc;
  result: AnalysisResult | null;
  busy: boolean;
  error: string | null;
  tab: string;
  study: string;
  savedAs: string | null;
  /** run a document on the server without changing the page; throws with the engine's reason */
  validate: (d: AnalysisDoc) => Promise<AnalysisResult>;
  /** have the server write a split's arms from the data (POST /api/partition) */
  proposePartition: (req: { doc: AnalysisDoc; cohort: string; attribute?: string; gene?: string; oql?: string[]; name?: string; maxArms?: number; minCount?: number })
    => Promise<{ name: string; def: PartitionDef; note?: string }>;
  /** put an already-validated document and its result on the page */
  commit: (d: AnalysisDoc, r: AnalysisResult) => void;
  goTab: (t: string) => void;
  runExample: (ex: DslExample) => void;
  save: (name: string) => Promise<void>;
  link: (d: AnalysisDoc) => string;
  // Explore: the draft cohort built by clicking facets, over the ticked studies
  exploreStudies: string[];
  draft: CohortDef | null;
  explore: ExploreResult | null;
  exploreBusy: boolean;
  setExploreStudies: (ids: string[]) => void;
  addClause: (clause: unknown) => void;
  removeDraftClause: (i: number) => void;
  clearDraft: () => void;
  analyzeDraft: () => void;
  saveDraft: (name: string) => Promise<{ count: number }>;
  // saved cohorts and analyses
  savedCohorts: Record<string, { id: string; def: CohortDef; savedAt: string; lastEval?: { count: number; text?: string } | null }>;
  savedAnalyses: Record<string, { doc: AnalysisDoc; savedAt: string }>;
  openSaved: (name: string) => void;
}

const TABS = ["explore", "cohorts", "saved", "analysis", "examples"];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const cap = (s: string, n = 20000) => s.length <= n ? s : s.slice(0, n) + `\n… [${(s.length - n).toLocaleString()} more characters not shown]`;

function cohortLines(r: AnalysisResult): string {
  return Object.entries(r.cohorts).map(([n, c]) => `- ${n}: ${c.count.toLocaleString()} patients — ${c.text}`).join("\n");
}

// Module-level, not per mount: the page can remount (a Suspense boundary re-suspending) while
// its document survives in the URL, and the assistant's undo history must survive with it.
const undo: AnalysisDoc[] = [];

/** Resolve once the page is showing `d` — so the next tool call reads it, not the document before it. */
async function settled(get: () => LabBridge, d: AnalysisDoc, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (get().doc !== d && JSON.stringify(get().doc) !== JSON.stringify(d)) {
    if (Date.now() - t0 > ms) throw new Error("the page did not show the edit within 8 s — call analysis_get_document to see its state");
    await new Promise((res) => setTimeout(res, 30));
  }
}

/** Resolve once Explore has fetched the facets for the current draft (its fetch is debounced). */
async function exploreSettled(get: () => LabBridge, ms = 90000): Promise<void> {
  const t0 = Date.now();
  await new Promise((res) => setTimeout(res, 450));
  while (get().exploreBusy) {
    if (Date.now() - t0 > ms) throw new Error("Explore is still counting after 90 s — call explore_get_state again shortly");
    await new Promise((res) => setTimeout(res, 100));
  }
}

function exploreState(b: LabBridge) {
  const e = b.explore;
  return {
    selectedStudies: b.exploreStudies,
    draftCohort: b.draft || { all: [] },
    draftFilters: (b.draft?.all || []).map((c, i) => ({ index: i, clause: c })),
    draftPatients: e?.draftCount ?? e?.totals?.patients ?? null,
    totals: e?.totals ?? null,
    counting: b.exploreBusy
  };
}

/** The facets as a reader would scan them: top values, not every bin. */
function facetSummary(e: ExploreResult | null, section: string, limit: number) {
  if (!e) return "Explore has not counted anything yet — select studies with explore_select_studies.";
  const want = (k: string) => section === "all" || section === k;
  const out: Record<string, unknown> = {};
  if (want("clinical")) out.clinical = e.clinical.slice(0, limit).map((f: any) => f.kind === "cat"
    ? { attribute: f.attribute, per: f.per, values: f.values.slice(0, 8) }
    : { attribute: f.attribute, per: f.per, numeric: { min: f.min, median: f.median, max: f.max } });
  if (want("genes")) out.genes = {
    note: "samples altered / samples profiled for THAT gene (panel-aware)",
    mutated: (e.mutatedGenes || []).slice(0, limit).map((g) => ({ gene: g.gene, altered: g.altered, profiled: g.profiled, pct: g.freqPct })),
    cna: (e.cnaGenes || []).slice(0, Math.min(limit, 10)).map((g) => ({ gene: g.gene, type: g.cna === 2 ? "amplification" : g.cna === -2 ? "deep deletion" : g.cna, altered: g.altered, profiled: g.profiled, pct: g.freqPct }))
  };
  if (want("events")) out.timelineEvents = e.events.slice(0, limit);
  if (want("derived")) out.derived = (e.derived || []).map((d) => ({ metric: d.metric, label: d.label, buckets: d.buckets }));
  if (want("caseLists")) out.caseLists = e.caseLists.slice(0, limit);
  return out;
}

/** Numbers that are legal but almost always a mistake, said out loud rather than left to be noticed. */
function warnings(r: AnalysisResult): string {
  const out: string[] = [];
  // a split's not-evaluable and remainder children may honestly be empty; an empty ARM is
  // worth a word, because an earlier, broader arm takes every patient it matches
  const childRole = new Map(Object.values(r.splits || {}).flatMap((p) => p.children.map((c) => [c.name, c.role] as const)));
  const emptyArms = Object.entries(r.cohorts).filter(([n, c]) => c.count === 0 && childRole.get(n) === "arm").map(([n]) => n);
  if (emptyArms.length)
    out.push(`WARNING: split arm${emptyArms.length === 1 ? "" : "s"} ${emptyArms.map((n) => `"${n}"`).join(", ")} ${emptyArms.length === 1 ? "is" : "are"} empty — arms are tested in order, so an earlier, broader arm may take every patient it matches; move it earlier (analysis_set_split) or check its condition.`);
  for (const [name, p] of Object.entries(r.splits || {}))
    if (!p.conserved) out.push(`WARNING: split "${name}"'s children add up to ${p.sum.toLocaleString()}, not "${p.of}"'s ${p.parentCount.toLocaleString()} — do not compare them until this is explained.`);
  const empty = Object.entries(r.cohorts).filter(([n, c]) => c.count === 0 && !childRole.has(n)).map(([n]) => n);
  if (empty.length)
    out.push(`WARNING: ${empty.map((n) => `"${n}"`).join(", ")} match${empty.length === 1 ? "es" : ""} 0 patients — check its attributes, values and event names against study_vocabulary before drawing any conclusion.`);
  const unprofiled = [...new Set(r.views.flatMap((v) => (v.rows || []).filter((row) => row.cells.every((c) => !c.profiled)).map((row) => row.gene)))];
  if (unprofiled.length)
    out.push(`WARNING: ${unprofiled.join(", ")} ${unprofiled.length === 1 ? "is" : "are"} profiled in 0 patients of every cohort — an unknown gene symbol, or one no panel here covers.`);
  return out.length ? out.join("\n") + "\n\n" : "";
}

export function installLabTools(get: () => LabBridge): { webmcp: boolean; cleanup: () => void } {

  /**
   * The one path every edit takes. `touched` names the views the edit changed (by their
   * index in the NEW document): an error in one of those rejects the edit, while an error
   * in a view the edit did not touch is reported but does not block it.
   */
  async function edit(label: string, next: AnalysisDoc, touched: number[] | "all" = "all"): Promise<string> {
    const b = get();
    const before = b.doc;
    let r: AnalysisResult;
    try { r = await b.validate(next); }
    catch (e) { throw new Error(`${label}: REJECTED by the engine, page unchanged — ${String((e as Error)?.message || e)}`); }
    const errs = r.views.map((v, i) => ({ i, v })).filter(({ i, v }) => v.error && (touched === "all" || touched.includes(i)));
    if (errs.length)
      throw new Error(`${label}: REJECTED, page unchanged — ` + errs.map(({ i, v }) => `view ${i} (${v.kind}): ${v.error}`).join("; "));
    b.commit(next, r);
    undo.push(before);
    await settled(get, next);
    // the last line analysisText writes for a one-view document is that view's description
    const viewText = (i: number) => analysisText({ ...next, views: [next.views![i]] }, { ...r, views: [r.views[i]] }).slice(-1)[0];
    const shown = touched === "all" ? analysisText(next, r).slice(1).join("\n\n")
      : "Cohorts:\n" + cohortLines(r) + (touched.length ? "\n\n" + touched.map(viewText).join("\n\n") : "");
    return `${label}: applied. The page now shows it (undo with analysis_undo).\n\n${warnings(r)}${shown}`;
  }

  const views = () => [...(get().doc.views || [])];
  const needIndex = (i: unknown): number => {
    const n = Number(i);
    if (!Number.isInteger(n) || n < 0 || n >= views().length) throw new Error(`no view ${i}: the document has ${views().length} (indices 0-${views().length - 1})`);
    return n;
  };

  /** the views at `into` with `names` appended to their cohort lists; an index that is not a view is refused */
  const withCohortIn = (vs: NonNullable<AnalysisDoc["views"]>, into: unknown, names: string[]) => {
    const idx = Array.isArray(into) ? into.map(needIndex) : [];
    return vs.map((v: any, i: number) => !idx.includes(i) ? v
      : { ...v, cohorts: [...(Array.isArray(v.cohorts) ? v.cohorts : []).filter((c: string) => !names.includes(c)), ...names] });
  };

  const tools: AgentTool[] = [
    // ---- read --------------------------------------------------------------------------
    { name: "analysis_get_document", description: "The Analysis document on the page now (study, cohorts, views, title, notes, params), plus which tab is open, whether a run is in progress, and whether it is saved.",
      inputSchema: { type: "object", properties: {} },
      run: async () => { const b = get(); return { document: b.doc, tab: b.tab, running: b.busy, error: b.error, savedAs: b.savedAs, link: b.link(b.doc) }; } },
    { name: "analysis_get_results", description: "The results on the page as text: every cohort's size and definition, and every view's numbers with the engine's caveats and the author's notes (surface the caveats to the user).",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const b = get();
        if (!b.result) return b.busy ? "A run is in progress — call again in a moment." : "Nothing has been run yet: the document has no cohorts, or has not been run.";
        return (b.busy ? "(A run is in progress; these are the previous results.)\n\n" : "") + analysisText(b.doc, b.result).join("\n\n");
      } },
    { name: "analysis_get_view", description: "One view's full structured result as JSON (capped at 20,000 characters), by its index in the document.",
      inputSchema: { type: "object", required: ["index"], properties: { index: { type: "integer" } } },
      run: async ({ index }) => { const i = needIndex(index); const r = get().result; return r?.views[i] ? cap(JSON.stringify(r.views[i], null, 2)) : `view ${i} has no result yet`; } },
    { name: "analysis_get_provenance", description: "How every number was computed: each cohort's plain-language readback, size and the SQL it compiled to, and each view's aggregate queries.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const r = get().result;
        if (!r) return "Nothing has been run yet.";
        return cap(JSON.stringify({ oncokbPin: r.oncokbPin, cohorts: r.cohorts,
          views: r.views.map((v, i) => ({ index: i, kind: v.kind, queries: v.queries })) }, null, 2), 40000);
      } },
    { name: "dsl_reference", description: "The Analysis document grammar: cohort clauses (OQL, clinical, timeline events, derived, split, …) and every view kind. Read this before writing cohorts or views.",
      inputSchema: { type: "object", properties: {} },
      run: async () => AGENT_GRAMMAR },
    { name: "study_vocabulary", description: "A study's real vocabulary: clinical attributes and values, timeline event types and attributes. Use only names that appear here. Defaults to the document's study.",
      inputSchema: { type: "object", properties: { study: { type: "string" } } },
      run: async ({ study }) => (await api.catalog(study || get().doc.study || get().study)).json() },
    { name: "list_studies", description: "The studies this instance can analyse: id, name, patient and sample counts, and which data they carry.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const j = await (await api.studies()).json();
        return (j.studies || j).map((s: any) => ({ id: s.id, name: s.name, cancerType: s.cancerType, patients: s.patients, samples: s.samples, timelinePatients: s.timelinePatients }));
      } },
    { name: "list_examples", description: "The worked example analyses in the gallery: title and what each demonstrates. Load one with analysis_load_example.",
      inputSchema: { type: "object", properties: {} },
      run: async () => EXAMPLES.map((e) => ({ title: e.title, demonstrates: e.demonstrates, tags: e.tags })) },

    // ---- edit --------------------------------------------------------------------------
    { name: "analysis_set_document", description: "Replace the whole Analysis document. The engine runs it first; if it rejects the document (or any view errors), the page is left unchanged and the reason is returned.",
      inputSchema: { type: "object", required: ["document"], properties: { document: { type: "object", description: "{dsl?, study, cohorts: {name: cohortDef (may carry splits)}, views: [...], title?, notes?, params?}" } } },
      run: async ({ document }) => edit("set document", clone(document)) },
    { name: "analysis_set_cohort", description: "Add a cohort to the analysis, or replace the definition of an existing one, by name. A view draws only the cohorts its own `cohorts` list names, so a new cohort is drawn nowhere until it is added to a view: pass `views` (indices) to append it to those views' lists. Replacing a definition re-runs every view that draws it.",
      inputSchema: { type: "object", required: ["name", "definition"], properties: { name: { type: "string" }, definition: { type: "object", description: "cohortDef: {all: [clause, ...], extends?, study?, studies?}" },
        views: { type: "array", items: { type: "integer" }, description: "indices of the views to draw it in (appended to each view's `cohorts`)" } } },
      run: async ({ name, definition, views: into }) => {
        const d = clone(get().doc);
        const existed = !!d.cohorts?.[name];
        d.cohorts = { ...(d.cohorts || {}), [name]: definition as CohortDef };
        d.views = withCohortIn(d.views || [], into, [name]);
        return edit(`${existed ? "replace" : "add"} cohort "${name}"` + (into?.length ? ` in view${into.length === 1 ? "" : "s"} ${into.join(", ")}` : ""), d);
      } },
    { name: "analysis_remove_cohort", description: "Remove a cohort by name. Every view that drew it loses it from its `cohorts`; a view left with none stays, empty, until a cohort is added to it.",
      inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      run: async ({ name }) => {
        const d = clone(get().doc);
        if (!d.cohorts?.[name]) throw new Error(`no cohort "${name}"; have ${Object.keys(d.cohorts || {}).join(", ") || "none"}`);
        delete d.cohorts[name];
        d.views = (d.views || []).map((v: any) => Array.isArray(v.cohorts) ? { ...v, cohorts: v.cohorts.filter((c: string) => c !== name) } : v);
        return edit(`remove cohort "${name}"`, d);
      } },
    { name: "analysis_split_cohort", description: "Split a cohort: child cohorts that are disjoint and together exactly the cohort, for comparing them, stored on the cohort as one of its `splits`. Split by a categorical attribute (one arm per value held by at least minCount patients, most frequent first, at most maxArms-1 arms; the rest go to Other), a numeric attribute (at its median within the cohort), a gene (mutated / wild-type), or a list of OQL queries (one arm each, first match wins). Patients not profiled for a gene, or with no value recorded, get their own child instead of being counted as wild-type or Other. Name a cohort, or an arm (\"<cohort> / <split> / <arm>\") to split it further. Each child is the cohort \"<cohort> / <split> / <arm>\"; every view showing the split cohort then shows its arms instead. Edit it afterwards with analysis_set_split.",
      inputSchema: { type: "object", required: ["cohort"], properties: {
        cohort: { type: "string" }, attribute: { type: "string" }, gene: { type: "string" },
        oql: { type: "array", items: { type: "string" } }, name: { type: "string", description: "the split's name; default the attribute or gene" },
        maxArms: { type: "integer" }, minCount: { type: "integer" } } },
      run: async (args) => {
        const b = get();
        const { name, def, note } = await b.proposePartition({ ...(args as object), doc: b.doc } as never);
        const d = editSplits(clone(get().doc), (f) => ({ ...f, partitions: { ...f.partitions, [splitKey(def.of, name)]: { ...def, split: name } } }));
        return (note ? note + "\n\n" : "") + await edit(`split "${def.of}" by "${name}"`, d);
      } },
    { name: "analysis_set_split", description: "Add or replace a split of a cohort (or of an arm, \"<cohort> / <split> / <arm>\"), by name: {cohort, name, arms: [{name, where: clause}], other?: name of the remainder}. Arms are tested in order and the first match wins, so a patient is in exactly one arm; reorder arms to change which wins. The engine adds a \"Not profiled …\" / \"No … recorded\" child for patients an arm cannot be decided for, and an Other child for the rest. Each child is the cohort \"<cohort> / <split> / <arm>\". Replacing a split keeps the splits nested under arms whose names are unchanged; those under an arm that is gone go with it.",
      inputSchema: { type: "object", required: ["cohort", "name", "arms"], properties: {
        cohort: { type: "string" }, name: { type: "string" },
        arms: { type: "array", items: { type: "object", required: ["name", "where"], properties: { name: { type: "string" }, where: { type: "object" } } } },
        other: { type: "string" }, notes: { type: "string" } } },
      run: async ({ cohort, name, arms, other, notes }) => {
        const key = splitKey(cohort, name);
        let existed = false;
        const d = editSplits(clone(get().doc), (f) => {
          existed = !!f.partitions[key];
          return { ...f, partitions: { ...f.partitions, [key]: { of: cohort, split: name, arms, ...(other ? { other } : {}), ...(notes ? { notes } : {}) } as PartitionDef } };
        });
        return edit(`${existed ? "replace" : "add"} split "${name}" of "${cohort}"`, d);
      } },
    { name: "analysis_remove_split", description: "Remove a split of a cohort (or of an arm) by name, with any split nested under its arms. A view that showed the split shows the cohort it divided; references to its arms are dropped.",
      inputSchema: { type: "object", required: ["cohort", "name"], properties: { cohort: { type: "string" }, name: { type: "string" } } },
      run: async ({ cohort, name }) => {
        let removed: string[] = [];
        const d = editSplits(clone(get().doc), (f) => { const r = withoutPartition(f, splitKey(cohort, name)); removed = r.removed; return r.doc; });
        return edit(`remove split${removed.length > 1 ? "s" : ""} ${removed.map((n) => `"${n}"`).join(", ")}`, d);
      } },
    { name: "analysis_add_view", description: "Add a view (compare, survival, clinical, oncoprint, cox, plot, …; grammar in dsl_reference). Give it a `cohorts` list naming the analysis's cohorts it draws; without one it is added empty, and the page shows it waiting for a cohort. It goes at the top of the page unless a position is given. Rejected, page unchanged, if the engine cannot run it.",
      inputSchema: { type: "object", required: ["view"], properties: { view: { type: "object" }, position: { type: "integer", description: "index to insert at; default 0 (top)" } } },
      run: async ({ view, position }) => {
        const vs = views();
        const at = position == null ? 0 : Math.max(0, Math.min(vs.length, Number(position)));
        vs.splice(at, 0, clone(view));
        return edit(`add ${view?.kind || "?"} view at ${at}`, { ...clone(get().doc), views: vs }, [at]);
      } },
    { name: "analysis_update_view", description: "Change a view's settings by merging `patch` into it (a key set to null is removed). Rejected, page unchanged, if the engine cannot run the result.",
      inputSchema: { type: "object", required: ["index", "patch"], properties: { index: { type: "integer" }, patch: { type: "object" } } },
      run: async ({ index, patch }) => {
        const i = needIndex(index);
        const vs = views();
        const nv: any = { ...clone(vs[i]), ...clone(patch) };
        for (const [k, x] of Object.entries(patch || {})) if (x === null) delete nv[k];
        vs[i] = nv;
        return edit(`update view ${i} (${nv.kind})`, { ...clone(get().doc), views: vs }, [i]);
      } },
    { name: "analysis_remove_view", description: "Remove a view by its index.",
      inputSchema: { type: "object", required: ["index"], properties: { index: { type: "integer" } } },
      run: async ({ index }) => {
        const i = needIndex(index);
        const vs = views(); const [gone] = vs.splice(i, 1);
        return edit(`remove view ${i} (${(gone as any).kind})`, { ...clone(get().doc), views: vs }, []);
      } },
    { name: "analysis_move_view", description: "Move a view from one position to another.",
      inputSchema: { type: "object", required: ["from", "to"], properties: { from: { type: "integer" }, to: { type: "integer" } } },
      run: async ({ from, to }) => {
        const i = needIndex(from); const j = needIndex(to);
        const vs = views(); const [v] = vs.splice(i, 1); vs.splice(j, 0, v);
        return edit(`move view ${i} to ${j}`, { ...clone(get().doc), views: vs }, []);
      } },
    { name: "analysis_set_details", description: "Set the document's study, title, notes, or template parameters (only the keys given change). Changing the study re-runs everything against it.",
      inputSchema: { type: "object", properties: { study: { type: "string" }, title: { type: "string" }, notes: { type: "string" }, params: { type: "object" } } },
      run: async (a) => {
        const d: any = clone(get().doc);
        for (const k of ["study", "title", "notes", "params"]) if (a[k] !== undefined) d[k] = clone(a[k]);
        return edit("set " + ["study", "title", "notes", "params"].filter((k) => a[k] !== undefined).join(", "), d);
      } },
    { name: "analysis_undo", description: "Undo the last edit made through these tools (the page's own buttons are not in this history).",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const prev = undo.pop();
        if (!prev) return "Nothing to undo: no edits have been made through these tools.";
        const b = get();
        let r: AnalysisResult;
        try { r = await b.validate(prev); }
        catch (e) { undo.push(prev); throw new Error("undo: the previous document no longer runs — " + String((e as Error)?.message || e)); }
        b.commit(prev, r);
        await settled(get, prev);
        return `Undone. The page is back to the previous document (${undo.length} more step${undo.length === 1 ? "" : "s"} available).\n\nCohorts:\n` + cohortLines(r);
      } },
    { name: "analysis_load_example", description: "Replace the page's analysis with one of the gallery examples, by its title (see list_examples), and run it.",
      inputSchema: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
      run: async ({ title }) => {
        const ex = EXAMPLES.find((e) => e.title === title) || EXAMPLES.find((e) => e.title.toLowerCase().includes(String(title).toLowerCase()));
        if (!ex) throw new Error(`no example titled "${title}" — see list_examples`);
        undo.push(get().doc);
        get().runExample(ex);
        return `Loaded "${ex.title}" and started running it. Call analysis_get_results in a few seconds.`;
      } },
    { name: "analysis_share_link", description: "A link that opens exactly this analysis for anyone, live.",
      inputSchema: { type: "object", properties: {} },
      run: async () => get().link(get().doc) },
    { name: "analysis_save", description: "Save the analysis to the shared workspace list under a name (overwrites a saved analysis of the same name). Ask the user before calling.",
      inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      run: async ({ name }) => {
        const n = String(name || "").trim();
        if (!n) throw new Error("a saved analysis needs a name");
        await get().save(n);
        return `Saved as "${n}".`;
      } },

    // ---- Explore: studies, facets and the draft cohort ----------------------------------
    { name: "explore_get_state", description: "Explore's current state: the studies ticked, the draft cohort built from facet filters (each with its index), and how many patients it holds.",
      inputSchema: { type: "object", properties: {} },
      run: async () => exploreState(get()) },
    { name: "explore_get_facets", description: "What the selected studies contain, counted against the current draft: clinical attributes with their top values (those named custom:<dataset>/<COLUMN> are uploaded custom data, stored on the server, readable once logged in), the most-altered genes (panel-aware), timeline event types, derived-metric buckets and case lists.",
      inputSchema: { type: "object", properties: { section: { type: "string", enum: ["all", "clinical", "genes", "events", "derived", "caseLists"] }, limit: { type: "integer", description: "rows per list, default 25" } } },
      run: async ({ section, limit }) => facetSummary(get().explore, section || "all", Math.max(1, Math.min(200, Number(limit) || 25))) },
    { name: "explore_select_studies", description: "Tick exactly these studies in Explore (ids from list_studies); the facets and the draft recount over them.",
      inputSchema: { type: "object", required: ["studies"], properties: { studies: { type: "array", items: { type: "string" } } } },
      run: async ({ studies }) => {
        if (!Array.isArray(studies) || !studies.length) throw new Error("give at least one study id (see list_studies)");
        get().goTab("explore");
        get().setExploreStudies(studies.map(String));
        await exploreSettled(get);
        return exploreState(get());
      } },
    { name: "explore_add_filter", description: "Add a clause to the draft cohort, exactly as clicking a facet does (a second value of the same clinical attribute widens it to an OR list). The clause uses the cohort grammar in dsl_reference, e.g. {kind:'clinical', attribute:'CANCER_TYPE', op:'=', value:'Breast Cancer', per:'sample'}.",
      inputSchema: { type: "object", required: ["clause"], properties: { clause: { type: "object" } } },
      run: async ({ clause }) => {
        if (!get().exploreStudies.length) throw new Error("select studies first (explore_select_studies)");
        get().goTab("explore");
        get().addClause(clone(clause));
        await exploreSettled(get);
        const st = exploreState(get());
        return { ...st, ...(st.draftPatients === 0 ? { warning: "the draft now matches 0 patients — check the clause against explore_get_facets" } : {}) };
      } },
    { name: "explore_remove_filter", description: "Remove one clause from the draft cohort by its index (see explore_get_state).",
      inputSchema: { type: "object", required: ["index"], properties: { index: { type: "integer" } } },
      run: async ({ index }) => {
        const n = (get().draft?.all || []).length;
        if (!Number.isInteger(index) || index < 0 || index >= n) throw new Error(`no filter ${index}: the draft has ${n}`);
        get().removeDraftClause(index);
        await exploreSettled(get);
        return exploreState(get());
      } },
    { name: "explore_clear_filters", description: "Remove every clause from the draft cohort (the studies stay selected).",
      inputSchema: { type: "object", properties: {} },
      run: async () => { get().clearDraft(); await exploreSettled(get); return exploreState(get()); } },
    { name: "explore_analyze", description: "Start a fresh analysis of the draft cohort with the default views, replacing the analysis on the page (analysis_undo can bring it back).",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        if (!get().exploreStudies.length) throw new Error("select studies first (explore_select_studies)");
        undo.push(get().doc);
        get().analyzeDraft();
        return "Started an analysis of the draft cohort. Call analysis_get_results in a few seconds.";
      } },
    { name: "cohorts_save_draft", description: "Save the draft cohort under a name in the shared saved-cohorts list. Ask the user before calling.",
      inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      run: async ({ name }) => {
        const n = String(name || "").trim();
        if (!n) throw new Error("a saved cohort needs a name");
        const r = await get().saveDraft(n);
        return `Saved cohort "${n}" (${r.count.toLocaleString()} patients).`;
      } },

    // ---- saved cohorts and analyses -----------------------------------------------------
    { name: "cohorts_list_saved", description: "The saved cohorts (definitions and last known size) and saved analyses (names and when saved).",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const b = get();
        return {
          cohorts: Object.entries(b.savedCohorts).map(([name, c]) => ({ name, savedAt: c.savedAt, patients: c.lastEval?.count ?? null, definition: c.def })),
          analyses: Object.entries(b.savedAnalyses).map(([name, w]) => ({ name, savedAt: w.savedAt, study: w.doc.study, cohorts: Object.keys(w.doc.cohorts || {}), views: (w.doc.views || []).map((v) => v.kind) }))
        };
      } },
    { name: "cohorts_add_saved_to_analysis", description: "Put saved cohorts into the current analysis by name (a cohort of the same name is replaced). A view draws only the cohorts it names: pass `views` (indices) to add them to those views. Validated by the engine like every edit.",
      inputSchema: { type: "object", required: ["names"], properties: { names: { type: "array", items: { type: "string" } },
        views: { type: "array", items: { type: "integer" }, description: "indices of the views to draw them in (appended to each view's `cohorts`)" } } },
      run: async ({ names, views: into }) => {
        const b = get();
        const missing = (names || []).filter((n: string) => !b.savedCohorts[n]);
        if (missing.length) throw new Error(`no saved cohort ${missing.map((n: string) => `"${n}"`).join(", ")}; have ${Object.keys(b.savedCohorts).join(", ") || "none"}`);
        const d = clone(b.doc);
        d.cohorts = { ...(d.cohorts || {}) };
        // each copy records its source and what it was, so the page can offer the saved cohort's later edits
        for (const n of names) d.cohorts[n] = { ...clone(b.savedCohorts[n].def),
          from: { saved: b.savedCohorts[n].id, name: n, hash: cohortHash(b.savedCohorts[n].def), savedAt: b.savedCohorts[n].savedAt } };
        d.views = withCohortIn(d.views || [], into, names);
        return edit(`add saved cohort${names.length === 1 ? "" : "s"} ${names.map((n: string) => `"${n}"`).join(", ")}`, d);
      } },
    { name: "analysis_open_saved", description: "Open a saved analysis by name, replacing the one on the page (analysis_undo can bring it back).",
      inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      run: async ({ name }) => {
        const b = get();
        if (!b.savedAnalyses[name]) throw new Error(`no saved analysis "${name}"; have ${Object.keys(b.savedAnalyses).join(", ") || "none"}`);
        undo.push(b.doc);
        b.openSaved(name);
        return `Opened "${name}" and started running it. Call analysis_get_results in a few seconds.`;
      } },
    { name: "open_tab", description: `Show one of the page's tabs: ${TABS.join(", ")}.`,
      inputSchema: { type: "object", required: ["tab"], properties: { tab: { type: "string", enum: TABS } } },
      run: async ({ tab }) => { if (!TABS.includes(tab)) throw new Error(`tab is one of ${TABS.join(", ")}`); get().goTab(tab); return `showing ${tab}`; } }
  ];

  const byName = (n: string) => (args: Json = {}) => tools.find((t) => t.name === n)!.run(args);
  return exposeTools("analysis", tools, {
    getDocument: byName("analysis_get_document"),
    getResults: byName("analysis_get_results"),
    getView: (index: number) => byName("analysis_get_view")({ index }),
    getProvenance: byName("analysis_get_provenance"),
    dslReference: byName("dsl_reference"),
    studyVocabulary: (study?: string) => byName("study_vocabulary")({ study }),
    listStudies: byName("list_studies"),
    listExamples: byName("list_examples"),
    setDocument: (document: Json) => byName("analysis_set_document")({ document }),
    setCohort: (name: string, definition: Json) => byName("analysis_set_cohort")({ name, definition }),
    removeCohort: (name: string) => byName("analysis_remove_cohort")({ name }),
    splitCohort: (args: Json) => byName("analysis_split_cohort")(args),
    setSplit: (cohort: string, name: string, def: Json) => byName("analysis_set_split")({ ...(def as object), cohort, name }),
    removeSplit: (cohort: string, name: string) => byName("analysis_remove_split")({ cohort, name }),
    addView: (view: Json, position?: number) => byName("analysis_add_view")({ view, position }),
    updateView: (index: number, patch: Json) => byName("analysis_update_view")({ index, patch }),
    removeView: (index: number) => byName("analysis_remove_view")({ index }),
    moveView: (from: number, to: number) => byName("analysis_move_view")({ from, to }),
    setDetails: (details: Json) => byName("analysis_set_details")(details),
    undo: byName("analysis_undo"),
    loadExample: (title: string) => byName("analysis_load_example")({ title }),
    shareLink: byName("analysis_share_link"),
    save: (name: string) => byName("analysis_save")({ name }),
    openTab: (tab: string) => byName("open_tab")({ tab }),
    exploreState: byName("explore_get_state"),
    exploreFacets: (section?: string, limit?: number) => byName("explore_get_facets")({ section, limit }),
    selectStudies: (studies: string[]) => byName("explore_select_studies")({ studies }),
    addFilter: (clause: Json) => byName("explore_add_filter")({ clause }),
    removeFilter: (index: number) => byName("explore_remove_filter")({ index }),
    clearFilters: byName("explore_clear_filters"),
    analyzeDraft: byName("explore_analyze"),
    saveDraft: (name: string) => byName("cohorts_save_draft")({ name }),
    listSaved: byName("cohorts_list_saved"),
    addSavedToAnalysis: (names: string[]) => byName("cohorts_add_saved_to_analysis")({ names }),
    openSaved: (name: string) => byName("analysis_open_saved")({ name })
  });
}

export const LAB_TOOL_NAMES = [
  ["analysis_get_document", "getDocument()"], ["analysis_get_results", "getResults()"], ["analysis_get_view", "getView(i)"],
  ["analysis_get_provenance", "getProvenance()"], ["dsl_reference", "dslReference()"], ["study_vocabulary", "studyVocabulary(study?)"],
  ["list_studies", "listStudies()"], ["list_examples", "listExamples()"], ["analysis_set_document", "setDocument(doc)"],
  ["analysis_set_cohort", "setCohort(name, def)"], ["analysis_remove_cohort", "removeCohort(name)"],
  ["analysis_split_cohort", "splitCohort({cohort, attribute|gene|oql})"], ["analysis_set_split", "setSplit(cohort, name, {arms, other?})"],
  ["analysis_remove_split", "removeSplit(cohort, name)"], ["analysis_add_view", "addView(view, position?)"],
  ["analysis_update_view", "updateView(i, patch)"], ["analysis_remove_view", "removeView(i)"], ["analysis_move_view", "moveView(from, to)"],
  ["analysis_set_details", "setDetails({study, title, notes, params})"], ["analysis_undo", "undo()"], ["analysis_load_example", "loadExample(title)"],
  ["analysis_share_link", "shareLink()"], ["analysis_save", "save(name)"], ["open_tab", "openTab(tab)"],
  ["explore_get_state", "exploreState()"], ["explore_get_facets", "exploreFacets(section?, limit?)"],
  ["explore_select_studies", "selectStudies([ids])"], ["explore_add_filter", "addFilter(clause)"],
  ["explore_remove_filter", "removeFilter(i)"], ["explore_clear_filters", "clearFilters()"],
  ["explore_analyze", "analyzeDraft()"], ["cohorts_save_draft", "saveDraft(name)"],
  ["cohorts_list_saved", "listSaved()"], ["cohorts_add_saved_to_analysis", "addSavedToAnalysis([names])"],
  ["analysis_open_saved", "openSaved(name)"]
] as const;

/**
 * Install the page's tools once and keep what they see current: `bridge` is rebuilt every render,
 * so a tool always reads the document as it is now. Says whether WebMCP (the browser's assistant
 * API) took them; null until the tools are installed.
 */
export function useLabTools(bridge: LabBridge): boolean | null {
  const ref = useRef<LabBridge | null>(null);
  ref.current = bridge;
  const [webmcp, setWebmcp] = useState<boolean | null>(null);
  useEffect(() => {
    const t = installLabTools(() => ref.current!);
    setWebmcp(t.webmcp);
    return t.cleanup;
  }, []);
  return webmcp;
}
