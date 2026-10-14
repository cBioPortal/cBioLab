// Sequence view: what follows what, as lines of therapy — flows between the labels of each
// patient's successive lines.
import { lineClassesParam } from "../cohort2.ts";
import { lineGapOf, DEFAULT_LINE_GAP } from "../treatment-lines.ts";
import type { ViewResult, SequenceView, SequenceResult, SequencePanel, SequenceNodeKind } from "../types.ts";
import { SEQUENCE_ROW_LIMIT, type SequenceOpts } from "../federation.ts";
import { canonicalEventName } from "../event-names.ts";
import { sequenceMethod } from "../method.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "./run.ts";
import { overLimit } from "./shared.ts";

export async function runSequence(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, participationFor } = c;
  const sv = view as SequenceView;
  const labelKey = String(sv.labelKey || "SUBTYPE");
  const eventType = String(sv.eventType || "treatment");
  const lineGap = lineGapOf({ gap: sv.lineGap ?? DEFAULT_LINE_GAP });
  const maxSteps = Math.max(2, Math.min(6, Math.floor(Number(sv.maxSteps) || 3)));
  const topN = Math.max(2, Math.min(14, Math.floor(Number(sv.topN) || 8)));
  // Two panels at most: a third Sankey shrinks every ribbon past reading.
  { const e = overLimit("a sequence view", 2, vNames.length); if (e) return untimed({ kind: "sequence", cohorts: vNames, error: e.replace("at most 2", "at most 2 cohorts") }); }
  let lineClasses: "systemic" | "all" | string[] | undefined;
  try { if (sv.lineClasses != null) lineClasses = lineClassesParam(sv.lineClasses); }
  catch (e) { return untimed({ kind: "sequence", cohorts: vNames, error: (e as Error).message }); }
  const panelNames = vNames;
  const allStudies = [...new Set(panelNames.flatMap((n) => cohorts[n].studies))];
  const opts: SequenceOpts = { eventType, labelKey, exclude: (sv.exclude || []).map(String), lineGap, maxSteps,
    ...(lineClasses ? { lineClasses } : {}) };

  // What ELSE could label a line here, and how granular is each? Fetched
  // alongside the data so the UI can offer the choice, and so a bad key can
  // be diagnosed rather than just returning nothing.
  // a study whose query fails fails the view: an empty answer would read as "no therapy lines"
  const [perStudyByCohort, keyRows] = await Promise.all([
    Promise.all(panelNames.map((n) => Promise.all(cohorts[n].studies.map((st) =>
      resolvers[st].treatmentSequence(doc.cohorts[n], opts))))),
    Promise.all(allStudies.map((st) =>
      resolvers[st].sequenceKeys(doc.cohorts[panelNames[0]], eventType))).then((r) => r.flat())
  ]);
  // step-0 rows count the records set aside before lines were built; every other row is a flow
  const setAside = perStudyByCohort.flatMap((rows, ci) => rows.flat().filter((f) => f.step === 0)
    .map((f) => ({ cohort: panelNames[ci], cls: f.from, reason: f.to, records: f.n })));
  const rawByCohort = perStudyByCohort.map((rows) => rows.flat().filter((f) => f.step > 0));
  const keyOptions = [...new Map(keyRows.map((k) => [k.key, k])).values()]
    .sort((a, b) => b.patients - a.patients);
  const chosen = keyOptions.find((k) => k.key === canonicalEventName(labelKey));

  if (!rawByCohort.some((r) => r.length)) {
    return untimed({ kind: "sequence", cohorts: panelNames, studies: allStudies,
      error: keyOptions.length
        ? "no therapy lines found: no '" + eventType + "' event here is both a " +
          (lineClasses === "all" ? "treatment record" : "systemic-therapy record (lineClasses)") + " and labelled by '" + labelKey +
          "'. Keys available on those events: " +
          keyOptions.slice(0, 8).map((k) => k.label + " (" + k.patients.toLocaleString() + " patients, " + k.values + " values)").join(", ")
        : "no '" + eventType + "' events with attributes were found for this cohort, so there are no lines to sequence.",
      ...(keyOptions.length ? { sequence: { labelKey, lineGap, steps: maxSteps, foldedLabels: 0, truncated: false, keyOptions, panels: [] } } : {}) });
  }
  // A key with one value cannot separate anything. Say so rather than
  // drawing one enormous box: in MSK-CHORD, TREATMENT_TYPE is exactly this.
  if (chosen && chosen.values <= 1) {
    return untimed({ kind: "sequence", cohorts: panelNames, studies: allStudies,
      sequence: { labelKey, lineGap, steps: maxSteps, foldedLabels: 0, truncated: false, keyOptions, panels: [] },
      error: "'" + labelKey + "' takes only one value in this cohort (" + chosen.label +
        "), so every line would carry the same label and the diagram would say nothing. Try: " +
        keyOptions.filter((k) => k.values > 1).slice(0, 5)
          .map((k) => k.label + " (" + k.values + " values)").join(", ") });
  }
  const truncated = perStudyByCohort.some((rows) => rows.some((r) => r.filter((f) => f.step > 0).length >= SEQUENCE_ROW_LIMIT));

  // Merge per cohort, then rank labels ACROSS ALL PANELS so a regimen keeps
  // one identity and one colour in both — the comparison is the point.
  const mergedPer = rawByCohort.map((raw) => {
    const m = new Map<string, number>();
    for (const f of raw) {
      const k = f.step + "\u0000" + f.from + "\u0000" + f.to + "\u0000" + f.fate;
      m.set(k, (m.get(k) || 0) + f.n);
    }
    return m;
  });
  // a label's weight is what leaves it, or what arrives at a label nothing leaves (one seen only
  // in the last column) — the same rule that sizes the nodes — so every label is ranked and counted
  const outW = new Map<string, number>(), inW = new Map<string, number>();
  for (const m of mergedPer) for (const [k, n] of m) {
    const [, from, to, fate] = k.split("\u0000");
    outW.set(from, (outW.get(from) || 0) + n);
    if (fate === "0" && to) inW.set(to, (inW.get(to) || 0) + n);
  }
  const weight = new Map<string, number>(outW);
  for (const [l, n] of inW) if (!weight.has(l)) weight.set(l, n);
  // ties broken by name, so which label is kept never depends on the order rows arrived in
  const keep = new Set([...weight.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, topN).map(([l]) => l));
  const foldedLabels = [...weight.keys()].filter((l) => !keep.has(l)).length;
  const fold = (l: string) => keep.has(l) ? l : "other";
  const kindOf = (fate: number): SequenceNodeKind =>
    fate === 0 ? "regimen" : fate === 1 ? "stopped" : "censored";
  const nodeKey = (column: number, kind: SequenceNodeKind, label: string) =>
    column + "\u0000" + kind + "\u0000" + label;

  const panels: SequencePanel[] = panelNames.map((cohortName, pi) => {
    const flowMap = new Map<string, number>();
    for (const [k, n] of mergedPer[pi]) {
      const [step, from, to, fate] = k.split("\u0000");
      const kind = kindOf(Number(fate));
      const target = kind === "regimen" ? fold(to) : "";
      const key = step + "\u0000" + fold(from) + "\u0000" + target + "\u0000" + kind;
      flowMap.set(key, (flowMap.get(key) || 0) + n);
    }
    const flows = [...flowMap.entries()].map(([k, n]) => {
      const [step, from, to, kind] = k.split("\u0000");
      return { column: Number(step), from, to, n, kind: kind as SequenceNodeKind };
    }).sort((a, b) => a.column - b.column || b.n - a.n);

    // A node is as big as what leaves it; a terminal is as big as what
    // arrives. Both terminals get real nodes, so nobody leaves the diagram.
    const outSum = new Map<string, number>(), inSum = new Map<string, number>();
    for (const f of flows) {
      const src = nodeKey(f.column, "regimen", f.from);
      const dst = nodeKey(f.column + 1, f.kind, f.to);
      outSum.set(src, (outSum.get(src) || 0) + f.n);
      inSum.set(dst, (inSum.get(dst) || 0) + f.n);
    }
    const nodes = [...new Set([...outSum.keys(), ...inSum.keys()])].map((k) => {
      const [column, kind, label] = k.split("\u0000");
      return { column: Number(column), label, kind: kind as SequenceNodeKind,
               n: outSum.get(k) ?? inSum.get(k) ?? 0 };
    }).filter((x) => x.n > 0).sort((a, b) => a.column - b.column || b.n - a.n);

    const started = flows.filter((f) => f.column === 1).reduce((n, f) => n + f.n, 0);
    const censored = flows.filter((f) => f.kind === "censored").reduce((n, f) => n + f.n, 0);
    return { cohort: cohortName, nodes, flows, started, censored };
  });

  const p0 = panels[0];
  const censPct = p0.started ? Math.round((1000 * p0.censored) / p0.started) / 10 : 0;
  const otherN = p0.nodes.filter((n) => n.column === 1 && n.label === "other").reduce((t, n) => t + n.n, 0);
  const otherPct = p0.started ? Math.round((1000 * otherN) / p0.started) / 10 : 0;
  const sequence: SequenceResult = { labelKey, lineGap, steps: maxSteps, foldedLabels, truncated, keyOptions, panels };
  const seqResult: ViewResult = { kind: "sequence", cohorts: panelNames, studies: allStudies, sequence,
    method: sequenceMethod({ eventType, labelKey, lineGap, maxSteps, topN, classes: lineClasses || "systemic",
      exclude: (sv.exclude || []).map(String), truncated, rowLimit: SEQUENCE_ROW_LIMIT, foldedLabels,
      perSite: panelNames.flatMap((n) => [...cohorts[n].studies].sort().map((st) => ({ cohort: n, study: st, cohortPatients: cohorts[n].perStudy[st]?.count || 0 }))),
      setAside,
      flows: mergedPer.flatMap((m, pi) => [...m.entries()].map(([k, n]) => {
        const [step, from, to, fate] = k.split("\u0000");
        return { cohort: panelNames[pi], step: Number(step), from, to, fate: Number(fate), n };
      }).sort((x, y) => x.step - y.step || y.n - x.n || (x.from + "\u0000" + x.to < y.from + "\u0000" + y.to ? -1 : 1))),
      results: panels.map((pn) => ({ cohort: pn.cohort, started: pn.started, censored: pn.censored,
        nodes: pn.nodes.map((nd) => ({ column: nd.column, kind: nd.kind, label: nd.label, n: nd.n })) })),
    }),
    participation: participationFor(allStudies, false),
    caveat:
      "Therapies are grouped into LINES before being sequenced, by the definition every line count here shares: " +
      (lineClasses === "all" ? "every " + eventType + " record"
        : Array.isArray(lineClasses) ? eventType + " records whose class (SUBTYPE, else TREATMENT_TYPE) is one of " + lineClasses.join(", ")
        : "systemic-therapy " + eventType + " records (class, from SUBTYPE or else TREATMENT_TYPE, on the systemic list: chemotherapy, immunotherapy, targeted, hormone, biologic, investigational and their spellings; radiation, surgery, bone and ancillary treatment are not lines)") +
      ". A record starting more than " + lineGap +
      " days after every earlier one has stopped begins a new line; anything closer is the same line, and a line is labelled by its whole combination" +
      " (sorted, so 'A + B' and 'B + A' are one regimen). That grouping is the point \u2014 a patient" +
      " here has a median of 6 treatment records and 4 distinct agents, and combination therapy is" +
      " several records describing ONE decision, not several lines." +
      " Lines are labelled by " + labelKey + "." +
      " ENDING A PATH IS SPLIT IN TWO, because the difference matters more than anything else here:" +
      " 'no further line' means the study kept watching for at least " + lineGap + " days (one line gap," +
      " the same rule that defines a line) and saw no further therapy; 'record ends here' means it did not," +
      " so nothing can be concluded about that patient. " + censPct + "% of paths end censored \u2014 reading" +
      " those as patients who finished treatment would be a claim about the record-keeping dressed up as" +
      " one about the patient. Neither terminal is an outcome measure." +
      (sv.exclude && sv.exclude.length
        ? " Excluded from every line, by this document rather than by the engine: " + sv.exclude.join(", ") + "."
        : "") +
      (foldedLabels ? " " + foldedLabels + " less common regimen" + (foldedLabels === 1 ? "" : "s") +
        " folded into 'other', which is " + otherPct + "% of first-line patients in the first panel \u2014" +
        " combination regimens have a genuinely long tail, so 'other' is real diversity rather than a" +
        " rounding bucket. Raise topN to split it further." : "") +
      (truncated ? " A study's answer hit the " + SEQUENCE_ROW_LIMIT + "-flow cap, so its rarest flows are missing." : "") +
      (allStudies.length > 1 ? " Regimen vocabularies are NOT harmonized across studies beyond case." : "") +
      (panels.length > 1
        ? " Both panels share one scale and one colour per regimen, so their heights are directly comparable." : "") +
      " " + panels.map((x) => x.cohort + ": " + x.started.toLocaleString() + " with a first line").join("; ") + "." };
  return seqResult;
}
