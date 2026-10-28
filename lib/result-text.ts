// The text description of an analysis result: every view kind (its descriptor's text,
// lib/views/<kind>/kind.ts), with the engine's caveats and the author's notes, the way a model
// should read it. One renderer for every agent-facing
// surface — the MCP run_analysis tool, the analysis page's WebMCP tools — so they cannot
// describe the same result differently. Pure and browser-safe.
import { isDrawn, type AnalysisDoc, type AnalysisResult, type ViewResult } from "./types.ts";
import { kindOf } from "./views/kinds.ts";

export function analysisText(document: AnalysisDoc, r: AnalysisResult): string[] {
  const out: string[] = [];
  // Small shared formatters. The engine attaches caveats and the author
  // attaches notes; BOTH have to reach the model, or it writes about
  // figures whose methodology and intent it cannot see.
  // A plot counts samples by default and patients on request, but the RESULT
  // does not carry which — it is a property of the spec. Look it back up by
  // position, the way lib/analysis.ts does for per-view notes.
  const authored = ((document as { views?: unknown[] }).views || []) as { unit?: string }[];
  const plotUnit = (v: ViewResult) =>
    authored[r.views.indexOf(v)]?.unit === "patient" ? "patients" : "samples";
  const pFmt = (x: number) =>
    x === 0 ? "<1e-300" : x < 1e-4 ? x.toExponential(1) : x.toFixed(4);
  const caveatOf = (v: { caveat?: string }) =>
    v.caveat ? "\n  CAVEAT (tell the user): " + v.caveat : "";
  // What was computed from the rows, step by step, so a model can say how a number was arrived at.
  const methodOf = (v: ViewResult) => !v.method ? "" :
    "\n  METHOD:" + v.method.steps.map((st) =>
      "\n    - " + st.title + (st.scope ? " [" + st.scope + "]" : "") +
      (st.rowsIn != null && st.rowsOut != null ? " (" + st.rowsIn.toLocaleString() + " → " + st.rowsOut.toLocaleString() + " rows)" : "") +
      ": " + st.detail +
      (st.params || []).map(([k, val]) => "\n        " + k + ": " + val).join("")).join("") +
    (v.method.verification ? "\n    " + v.method.verification : "");
  // the AUTHOR's note is `annotationNote`; `note` is the engine's own.
  const noteOf = (v: { annotationNote?: string; note?: string }) =>
    (v.annotationNote ? "\n  NOTE (the author's, tell the user): " + v.annotationNote : "") +
    (v.note ? "\n  " + v.note : "");
  if (r.upgraded)
    out.push(`NOTE (tell the user): this document was written ${r.upgraded.from === "unversioned" ? "before documents carried a version" : "for DSL " + r.upgraded.from} and was upgraded to ${r.upgraded.to} to run` +
      (r.upgraded.changes.length ? ": " + r.upgraded.changes.join("; ") : "") + ". Saving it writes the new version.");
  out.push(`Analysis over ${r.involvedStudies.join(" + ")} — OncoKB pin ${r.oncokbPin || "none"} — ${r.stats.ms}ms.`);
  // where the data came from, when a peer or more than one database answered
  if (r.sources && (r.sources.length > 1 || r.sources.some((x) => x.remote)))
    out.push("Data from: " + r.sources.map((x) => x.label + (x.remote ? " (over MCP at " + (x.url || "?") + (x.reportedName ? ", calls itself " + x.reportedName : "") +
      (x.build ? ", build " + x.build : "") + ")" : " (local)") + " — " +
      x.studies.map((st) => st.study + " imported " + (st.imported || "unknown")).join(", ")).join("; ") + ".");
  // The document's own title and notes are the author's framing of the whole
  // workspace. They were stored and rendered in the app but never reached a
  // model over MCP, so a caller could not read back what it had written.
  const d = document as { title?: string; notes?: string; params?: Record<string, unknown> };
  if (d.title) out.push(`Title: ${d.title}`);
  if (d.notes) out.push(`Notes (the author's): ${d.notes}`);
  if (r.params && Object.keys(r.params).length)
    out.push("Parameters resolved: " + Object.entries(r.params)
      .map(([k, v]) => `$${k} = ${JSON.stringify(v)}`).join("; ") +
      (r.unusedParams?.length ? `  (declared but never referenced: ${r.unusedParams.map((x) => "$" + x).join(", ")})` : ""));
  out.push("Cohorts:\n" + Object.entries(r.cohorts)
    .map(([n, c]) => `- ${n}: ${c.count.toLocaleString()} patients — ${c.text}`).join("\n"));
  for (const [, p] of Object.entries(r.splits || {})) {
    const pct = (n: number) => p.parentCount ? " (" + (100 * n / p.parentCount).toFixed(1) + "%)" : "";
    out.push(`Split "${p.split}" of "${p.of}" (${p.parentCount.toLocaleString()} patients; arms tested in order, first match wins):\n` +
      p.children.map((c) => `  - ${c.label}${c.role === "other" ? " [remainder]" : c.role === "notEvaluable" ? " [not evaluable — not compared]" : ""}: ` +
        `${c.count.toLocaleString()}${pct(c.count)} — cohort "${c.name}"`).join("\n") +
      (p.conserved ? `\n  The children's samples add up to the parent's (${p.sum.toLocaleString()}).`
        : `\n  WARNING (tell the user): the children's samples add up to ${p.sum.toLocaleString()}, not the parent's ${p.parentSamples.toLocaleString()}.`) +
      (p.unchecked.length ? `\n  CAVEAT (tell the user): whether a patient can be tested for ${p.unchecked.join(", ")} is not checked, so the remainder may hold patients with no data for it.` : ""));
  }
  for (const v of r.views) {
    if (!isDrawn(v)) {
      out.push(v.empty ? `View ${v.kind}: EMPTY — it names no cohorts yet, so nothing was computed; give it a \`cohorts\` list` : `View ${v.kind}: ERROR — ${v.error}`);
      continue;
    }
    if (kindOf(v.kind)?.text?.(v, { out, pFmt, caveatOf, noteOf, plotUnit, methodOf }) === false || !kindOf(v.kind)?.text) {
      // A view kind with no text for this result would otherwise append nothing at all: the
      // numbers were computed and the model was simply never told. Saying so is worse than a
      // proper description but far better than silence.
      out.push(`View "${v.kind}" ran but this tool has no text rendering for it yet — ` +
        `open the interactive editor link below to see it.`);
    }
    if (v.method) out[out.length - 1] += methodOf(v);
  }
  return out;
}
