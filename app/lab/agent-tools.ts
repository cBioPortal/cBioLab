// The analysis page's WebMCP tools: read the document and its results, and edit the analysis.
//
// Every edit goes the same way: build the new document, have the engine run it WITHOUT
// touching the page, and commit it to the page only if the engine accepted it. A rejected
// edit returns the engine's reason and leaves the page exactly as it was — the loud-rejection
// rule, applied to an agent. The page supplies a bridge that is refreshed on every render, so
// a tool always reads the current document even while the user is editing it too.
import { exposeTools, type AgentTool, type Json } from "../../lib/webmcp.ts";
import { analysisText } from "../../lib/result-text.ts";
import { CHAT_GRAMMAR, EXAMPLES, type DslExample } from "../../lib/dsl-reference.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef } from "../../lib/types.ts";

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
  /** put an already-validated document and its result on the page */
  commit: (d: AnalysisDoc, r: AnalysisResult) => void;
  goTab: (t: string) => void;
  runExample: (ex: DslExample) => void;
  save: (name: string) => Promise<void>;
  link: (d: AnalysisDoc) => string;
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

/** Numbers that are legal but almost always a mistake, said out loud rather than left to be noticed. */
function warnings(r: AnalysisResult): string {
  const out: string[] = [];
  const empty = Object.entries(r.cohorts).filter(([, c]) => c.count === 0).map(([n]) => n);
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
      run: async () => CHAT_GRAMMAR },
    { name: "study_vocabulary", description: "A study's real vocabulary: clinical attributes and values, timeline event types and attributes. Use only names that appear here. Defaults to the document's study.",
      inputSchema: { type: "object", properties: { study: { type: "string" } } },
      run: async ({ study }) => (await fetch(`/api/catalog?study=${encodeURIComponent(study || get().doc.study || get().study)}`)).json() },
    { name: "list_studies", description: "The studies this instance can analyse: id, name, patient and sample counts, and which data they carry.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const j = await (await fetch("/api/studies")).json();
        return (j.studies || j).map((s: any) => ({ id: s.id, name: s.name, cancerType: s.cancerType, patients: s.patients, samples: s.samples, timelinePatients: s.timelinePatients }));
      } },
    { name: "list_examples", description: "The worked example analyses in the gallery: title and what each demonstrates. Load one with analysis_load_example.",
      inputSchema: { type: "object", properties: {} },
      run: async () => EXAMPLES.map((e) => ({ title: e.title, demonstrates: e.demonstrates, tags: e.tags })) },

    // ---- edit --------------------------------------------------------------------------
    { name: "analysis_set_document", description: "Replace the whole Analysis document. The engine runs it first; if it rejects the document (or any view errors), the page is left unchanged and the reason is returned.",
      inputSchema: { type: "object", required: ["document"], properties: { document: { type: "object", description: "{study, cohorts: {name: cohortDef}, views: [...], title?, notes?, params?}" } } },
      run: async ({ document }) => edit("set document", clone(document)) },
    { name: "analysis_set_cohort", description: "Add a cohort, or replace the definition of an existing one, by name. Every view is re-run, since a cohort feeds all of them.",
      inputSchema: { type: "object", required: ["name", "definition"], properties: { name: { type: "string" }, definition: { type: "object", description: "cohortDef: {all: [clause, ...], extends?, study?, studies?}" } } },
      run: async ({ name, definition }) => {
        const d = clone(get().doc);
        const existed = !!d.cohorts?.[name];
        d.cohorts = { ...(d.cohorts || {}), [name]: definition as CohortDef };
        return edit(`${existed ? "replace" : "add"} cohort "${name}"`, d);
      } },
    { name: "analysis_remove_cohort", description: "Remove a cohort by name. Views that listed it in their own `cohorts` lose it from that list.",
      inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      run: async ({ name }) => {
        const d = clone(get().doc);
        if (!d.cohorts?.[name]) throw new Error(`no cohort "${name}"; have ${Object.keys(d.cohorts || {}).join(", ") || "none"}`);
        delete d.cohorts[name];
        d.views = (d.views || []).map((v: any) => Array.isArray(v.cohorts) ? { ...v, cohorts: v.cohorts.filter((c: string) => c !== name) } : v);
        return edit(`remove cohort "${name}"`, d);
      } },
    { name: "analysis_add_view", description: "Add a view (compare, survival, clinical, oncoprint, cox, plot, …; grammar in dsl_reference). It goes at the top of the page unless a position is given. Rejected, page unchanged, if the engine cannot run it.",
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
    addView: (view: Json, position?: number) => byName("analysis_add_view")({ view, position }),
    updateView: (index: number, patch: Json) => byName("analysis_update_view")({ index, patch }),
    removeView: (index: number) => byName("analysis_remove_view")({ index }),
    moveView: (from: number, to: number) => byName("analysis_move_view")({ from, to }),
    setDetails: (details: Json) => byName("analysis_set_details")(details),
    undo: byName("analysis_undo"),
    loadExample: (title: string) => byName("analysis_load_example")({ title }),
    shareLink: byName("analysis_share_link"),
    save: (name: string) => byName("analysis_save")({ name }),
    openTab: (tab: string) => byName("open_tab")({ tab })
  });
}

export const LAB_TOOL_NAMES = [
  ["analysis_get_document", "getDocument()"], ["analysis_get_results", "getResults()"], ["analysis_get_view", "getView(i)"],
  ["analysis_get_provenance", "getProvenance()"], ["dsl_reference", "dslReference()"], ["study_vocabulary", "studyVocabulary(study?)"],
  ["list_studies", "listStudies()"], ["list_examples", "listExamples()"], ["analysis_set_document", "setDocument(doc)"],
  ["analysis_set_cohort", "setCohort(name, def)"], ["analysis_remove_cohort", "removeCohort(name)"], ["analysis_add_view", "addView(view, position?)"],
  ["analysis_update_view", "updateView(i, patch)"], ["analysis_remove_view", "removeView(i)"], ["analysis_move_view", "moveView(from, to)"],
  ["analysis_set_details", "setDetails({study, title, notes, params})"], ["analysis_undo", "undo()"], ["analysis_load_example", "loadExample(title)"],
  ["analysis_share_link", "shareLink()"], ["analysis_save", "save(name)"], ["open_tab", "openTab(tab)"]
] as const;
