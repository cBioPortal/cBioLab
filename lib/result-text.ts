// The text description of an analysis result: every view kind, with the engine's caveats and
// the author's notes, the way a model should read it. One renderer for every agent-facing
// surface — the MCP run_analysis tool, the analysis page's WebMCP tools — so they cannot
// describe the same result differently. Pure and browser-safe.
import { isDrawn, type AnalysisDoc, type AnalysisResult, type ViewResult, type AssaysEntity, type CorrelatesGene } from "./types.ts";
import { lollipopSummaryText } from "./lollipop-svg.ts";
import { riskSpan } from "./figures/riskmodel.ts";
import { txMedianText } from "./figures/txendpoints.ts";

/** a timeline's events listed in text (MCP); the figure draws every one */
const TIMELINE_TEXT_EVENTS = 400;

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
      (p.conserved ? `\n  The children add up to the parent (${p.sum.toLocaleString()}).`
        : `\n  WARNING (tell the user): the children add up to ${p.sum.toLocaleString()}, not the parent's ${p.parentCount.toLocaleString()}.`) +
      (p.unchecked.length ? `\n  CAVEAT (tell the user): whether a patient can be tested for ${p.unchecked.join(", ")} is not checked, so the remainder may hold patients with no data for it.` : ""));
  }
  for (const v of r.views) {
    if (!isDrawn(v)) {
      out.push(v.empty ? `View ${v.kind}: EMPTY — it names no cohorts yet, so nothing was computed; give it a \`cohorts\` list` : `View ${v.kind}: ERROR — ${v.error}`);
      continue;
    }
    if (v.kind === "compare") {
      const rows = v.rows.slice(0, 20).map((row) =>
        `  ${row.gene}: ` + row.cells.map((c) => `${c.cohort} ${c.driverPct}%/${c.anyPct}%`).join(" | ") +
        (row.pAny != null ? `  p=${row.pAny < 1e-4 ? row.pAny.toExponential(1) : row.pAny.toFixed(4)}` : ""));
      out.push(`Compare (driver%/any%, panel-aware denominators; annotation ${v.annotation}):\n` + rows.join("\n") +
        noteOf(v));
    } else if (v.kind === "survival") {
      out.push(`Survival (KM, ${v.endpoint || "OS"}${v.anchoredTo ? " from " + v.anchoredTo : ""}):\n` + v.curves.map((c) =>
        `  ${c.cohort}: median ${c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n=${c.n}, ${c.events} events${c.missing ? ", " + c.missing + " missing OS" : ""}${c.unobserved ? ", " + c.unobserved + " with no follow-up after entry left out" : ""})`).join("\n") +
        (v.logrank ? `\n  log-rank p=${pFmt(v.logrank.p)}${v.logrank.strata > 1 ? " (stratified by study)" : ""}`
          : v.logrankK ? `\n  k-group log-rank p=${pFmt(v.logrankK.p)}` : "") +
        "\nCAVEAT (tell the user): " + v.caveat);
    } else if (v.kind === "cox") {
      // stratifyByCohort: no pooled coefficients — one independent fit per cohort instead.
      out.push(v.cox.byCohort
        ? `Cox regression (${v.endpoint || "OS"}, stratified by cohort):\n` +
          v.cox.byCohort.map((c) => c.error
            ? `  ${c.cohort}: ERROR — ${c.error}`
            : `  ${c.cohort} (n=${c.n.toLocaleString()}, ${c.events.toLocaleString()} events):\n` +
              c.coefficients.map((cf) =>
                `    ${cf.label}${cf.reference ? " vs " + cf.reference : ""}: HR ${cf.hr.toFixed(2)} ` +
                `(95% CI ${cf.ciLow.toFixed(2)}-${cf.ciHigh.toFixed(2)}) p=${pFmt(cf.p)}`).join("\n")
          ).join("\n") + caveatOf(v)
        : `Cox regression (${v.endpoint || "OS"}, n=${v.cox.n.toLocaleString()}, ${v.cox.events.toLocaleString()} events):\n` +
          v.cox.coefficients.map((c) =>
            `  ${c.label}${c.reference ? " vs " + c.reference : ""}: HR ${c.hr.toFixed(2)} ` +
            `(95% CI ${c.ciLow.toFixed(2)}-${c.ciHigh.toFixed(2)}) p=${pFmt(c.p)}`).join("\n") +
          caveatOf(v));
    } else if (v.kind === "forest") {
      const f = v.forest, hr = (x: { hr: number; ciLow: number; ciHigh: number; p: number }) =>
        `HR ${x.hr.toFixed(2)} (95% CI ${x.ciLow.toFixed(2)}-${x.ciHigh.toFixed(2)}) p=${pFmt(x.p)}`;
      out.push(`Forest plot: ${f.endpoint} hazard ratio for ${f.exposedLabel} by ${f.strata}` + (f.covariates.length ? `, adjusted for ${f.covariates.join(", ")}` : "") +
        ` (n=${f.n.toLocaleString()}, ${f.events.toLocaleString()} events):\n` +
        f.rows.map((r) => `  ${r.label} (n=${r.n.toLocaleString()}, ${r.events} events, ${r.exposed} exposed): ${hr(r)}${f.random ? `, weight ${(100 * r.weight).toFixed(1)}%` : ""}`).join("\n") +
        (f.random && f.fixed ? `\n  pooled, random effects (DerSimonian–Laird): ${hr(f.random)}\n  pooled, fixed effect: ${hr(f.fixed)}` +
          `\n  heterogeneity: tau²=${f.tau2.toFixed(3)}, I²=${(100 * f.i2).toFixed(0)}%, Q=${f.q.toFixed(1)} on ${f.qDf} df, p=${pFmt(f.qP)}` : "") +
        (f.left.length ? `\n  not estimated: ` + f.left.map((l) => `${l.label} (${l.reason})`).join("; ") : "") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "adjusted") {
      const a = v.adjusted, pct = (x: number, n: number) => n ? (100 * x / n).toFixed(1) + "%" : "–";
      out.push(`Adjusted enrichment: ${a.groups[0]} vs ${a.groups[1]}, mutation${a.measure === "driver" ? " (OncoKB drivers)" : ""} per gene by logistic regression` +
        (a.covariates.length ? ` adjusted for ${a.covariates.join(", ")}` : " (no covariates)") + `; ${a.rows.length} genes fit, ${a.significant} at q<0.05:\n` +
        a.rows.slice(0, 30).map((g) => `  ${g.gene}: ${a.groups[0]} ${g.altered[0]}/${g.profiled[0]} (${pct(g.altered[0], g.profiled[0])}), ${a.groups[1]} ${g.altered[1]}/${g.profiled[1]} (${pct(g.altered[1], g.profiled[1])}); ` +
          `raw OR ${g.rawOr == null ? "undefined" : g.rawOr.toFixed(2)} (Fisher p=${pFmt(g.fisherP)}); adjusted OR ${g.or.toFixed(2)} (95% CI ${g.ciLow.toFixed(2)}-${g.ciHigh.toFixed(2)}) p=${pFmt(g.p)} q=${pFmt(g.q)}`).join("\n") +
        (a.rows.length > 30 ? `\n  … ${a.rows.length - 30} more genes fit` : "") +
        (a.failed.length ? `\n  not fit: ` + a.failed.map((f) => `${f.gene} (${f.reason})`).join("; ") : "") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "logistic") {
      out.push(`Logistic regression (n=${v.logistic.n.toLocaleString()}, ${v.logistic.events.toLocaleString()} with the outcome):\n` +
        v.logistic.coefficients.map((c) =>
          `  ${c.label}${c.reference ? " vs " + c.reference : ""}: OR ${c.or.toFixed(2)} ` +
          `(95% CI ${c.ciLow.toFixed(2)}-${c.ciHigh.toFixed(2)}) p=${pFmt(c.p)}`).join("\n") +
        caveatOf(v));
    } else if (v.kind === "cooccurrence") {
      out.push("Co-occurrence (2x2 per pair, among patients profiled for BOTH genes):\n" +
        (v.pairs || []).slice(0, 20).map((x) =>
          `  ${x.a}/${x.b}: both ${x.both.toLocaleString()}, ${x.a} only ${x.onlyA.toLocaleString()}, ` +
          `${x.b} only ${x.onlyB.toLocaleString()}, neither ${x.neither.toLocaleString()} (of ${x.profiled.toLocaleString()} profiled)` +
          (x.log2Odds != null ? `  log2OR=${x.log2Odds.toFixed(2)} ${x.log2Odds > 0 ? "(co-occur)" : "(mutually exclusive)"}` : "") +
          `  p=${pFmt(x.p)} q=${pFmt(x.q)}` +
          (x.pStratified != null ? `  stratified p=${pFmt(x.pStratified)}` : "")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "clinical") {
      out.push("Clinical comparison across cohorts:\n" +
        (v.clinical || []).slice(0, 20).map((row) => {
          const cells = row.cells.map((c) => row.kind === "num"
            ? `${c.cohort} mean ${c.mean != null ? c.mean.toFixed(2) : "—"}` +
              (c.sd != null ? ` sd ${c.sd.toFixed(2)}` : "") + ` (n=${c.n.toLocaleString()})`
            : `${c.cohort} ` + (c.top && c.top.length
                ? c.top.slice(0, 3).map((t) => `${t.v} ${c.n ? Math.round(1000 * t.n / c.n) / 10 : 0}%`).join(", ")
                : "—")).join(" | ");
          return `  ${row.attribute} [${row.per}, ${row.kind}]: ${cells}` +
            (row.p != null ? `  ${row.test || "test"} p=${pFmt(row.p)} q=${pFmt(row.q!)}` : "") +
            (row.skipped ? `  SKIPPED: ${row.skipped}` : "");
        }).join("\n") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "coexpression") {
      out.push("Co-expression (Pearson r, computed from six per-site sums so the pooled value is exact):\n" +
        (v.coexpression || []).slice(0, 20).map((x) =>
          `  ${x.a}/${x.b}: r=${x.r != null ? x.r.toFixed(3) : "—"} (n=${x.n.toLocaleString()}) p=${pFmt(x.p)} q=${pFmt(x.q)}` +
          (x.rMeta != null ? `  meta-r=${x.rMeta.toFixed(3)} across ${x.sites} sites` : "")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "hotspots") {
      out.push("Mutations by protein position (commonest changes; share of patients mutated in THAT gene):\n" +
        (v.hotspots || []).map((g) =>
          `  ${g.gene}: ${g.mutated.toLocaleString()} mutated, ${g.mutations.toLocaleString()} mutations on ${g.positions.length.toLocaleString()} codons — ` +
          (g.topChanges.slice(0, 6).map((x) => `${x.change} ${x.n.toLocaleString()} (${x.pct}%)`).join(", ") || "no change above the floor") +
          (g.unpositioned ? `  [${g.unpositioned.toLocaleString()} with no protein position, not drawn]` : "") +
          (g.withheld ? `  [${g.withheld.toLocaleString()} below the suppression floor]` : "")).join("\n") +
        "\n  " + lollipopSummaryText(v.hotspots || [], v.hide || []) +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "course") {
      const axis = v.courseAxis;
      out.push(`Clinical course (${axis ? axis.binMonths + "-month bins, " + axis.from + " to +" + axis.to + "mo" : "binned"} ` +
        `relative to the anchor; DENOMINATOR IS THE PATIENTS STILL OBSERVABLE IN EACH BIN, not the cohort):\n` +
        (v.course || []).map((s2) => {
          const pts = s2.points.filter((q) => q.pct != null && q.atRisk > 0);
          const at = (t: number) => { const q = pts.find((z) => z.t === t); return q ? `${q.pct}% (n=${q.atRisk.toLocaleString()})` : "—"; };
          return `  ${s2.cohort} / ${s2.eventType} [${s2.isInterval ? "a state patients are IN" : "an event that HAPPENED"}]: ` +
            `0mo ${at(0)}, 12mo ${at(12)}, 24mo ${at(24)}, 60mo ${at(60)}`;
        }).join("\n") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "sequence") {
      const sq2 = v.sequence;
      out.push(`Treatment sequence (lines of therapy by ${sq2 ? sq2.labelKey : "?"}, ` +
        `${sq2 ? sq2.lineGap : 90}-day line gap):\n` +
        (sq2?.panels || []).map((pn) => {
          const first = pn.nodes.filter((n) => n.column === 1 && n.kind === "regimen")
            .sort((a, b) => b.n - a.n).slice(0, 5)
            .map((n) => `${n.label} ${n.n.toLocaleString()}`).join(", ");
          const stopped = pn.nodes.filter((n) => n.kind === "stopped").reduce((t, n) => t + n.n, 0);
          const cens = pn.censored;
          return `  ${pn.cohort}: ${pn.started.toLocaleString()} with a first line — ${first}\n` +
            `    of all paths, ${stopped.toLocaleString()} were WATCHED and began no further line; ` +
            `${cens.toLocaleString()} (${pn.started ? Math.round(100 * cens / pn.started) : 0}%) end because the RECORD stops — nothing can be concluded about those`;
        }).join("\n") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "plot") {
      const pd = v.plot;
      if (!pd) { out.push("Plot: no data"); }
      else if (pd.shape === "scatter") {
        const st = pd.stats;
        out.push(`Plot (scatter): ${pd.x.label} vs ${pd.y.label} — ${pd.n.toLocaleString()} ${plotUnit(v)}` +
          (pd.grid ? `, binned onto a ${pd.grid[0]}x${pd.grid[1]} grid (the payload is bins, never points)` : "") + "." +
          (st ? `\n  Pearson r=${st.pearson != null ? st.pearson.toFixed(3) : "—"}` +
                (st.pPearson != null ? ` p=${pFmt(st.pPearson)}` : "") +
                `; Spearman rho=${st.spearman != null ? st.spearman.toFixed(3) : "—"}` +
                (st.pSpearman != null ? ` p=${pFmt(st.pSpearman)}` : "") +
                (st.slope != null ? `; least-squares slope ${st.slope.toFixed(3)}` : "") : "") +
          caveatOf(v) + noteOf(v));
      } else if (pd.shape === "box") {
        out.push(`Plot (box): ${pd.y.label} by ${pd.x.label} — ${pd.n.toLocaleString()} ${plotUnit(v)}.\n` +
          (pd.groups || []).slice(0, 12).map((g) =>
            `  ${g.g}: median ${g.median.toFixed(2)} (IQR ${g.q1.toFixed(2)}–${g.q3.toFixed(2)}, ` +
            `whiskers ${g.loWhisker.toFixed(2)}–${g.hiWhisker.toFixed(2)}, n=${g.n.toLocaleString()})`).join("\n") +
          // WHICH overlay was drawn is a disclosure, not decoration: points
          // mean the reader is seeing cases, a density means they are not.
          (pd.overlay === "points" ? `\n  Values are drawn as individual points.`
            : pd.overlay === "violin" ? `\n  Values are drawn as a DENSITY, not points — either above the point cap or from a participant that discloses no cases.`
            : "") +
          // a cohort layer drawn as boxes is a second set of quartiles the figure shows and the note does not
          (pd.layers || []).filter((h) => h.groups && h.groups.length).map((h) => `\n  Point layer “${h.name}”:\n` +
            h.groups!.slice(0, 12).map((g) => `    ${g.g}: median ${g.median.toFixed(2)} (IQR ${g.q1.toFixed(2)}–${g.q3.toFixed(2)}, n=${g.n.toLocaleString()})`).join("\n")).join("") +
          caveatOf(v) + noteOf(v));
      } else {
        out.push(`Plot (table): ${pd.x.label} vs ${pd.y.label} — ${pd.n.toLocaleString()} ${plotUnit(v)}.\n` +
          (pd.cells || []).slice(0, 24).map((c) => `  ${c.cx} x ${c.cy}: ${c.n.toLocaleString()}`).join("\n") +
          caveatOf(v) + noteOf(v));
      }
    } else if (v.kind === "oncoprint" && !v.svg && v.spec) {
      // the web page draws its oncoprints itself, so its results carry the spec, not the figure
      const sp = v.spec as { genes?: unknown[] };
      out.push(`Oncoprint of ${(sp.genes || []).length} gene track(s) across ${(v.cohorts || []).join(", ")} — drawn in the page from its spec; ` +
        `per-gene frequencies are in the figure's header, not in this summary.` + noteOf(v));
    } else if (v.kind === "oncoprint" && v.svg) {
      out.push(`Oncoprint: ${v.nColumns!.toLocaleString()} patients — ` +
        v.genes!.map((g) => `${g.gene} ${g.driverPct}%/${g.anyPct}%`).join(", ") +
        ` — annotation ${v.annotation}.` + noteOf(v));
    } else if (v.kind === "genome") {
      const g = v.genome;
      // per chromosome, the highest gained and lost share of each cohort — enough to name the
      // regions without reciting every bin
      const perChrom = (s: typeof g.series[number]) => {
        const best = new Map<string, { gain: number; loss: number }>();
        g.bins.forEach((b, i) => {
          if (!s.profiled[i]) return;
          const cur = best.get(b.chrom) || { gain: 0, loss: 0 };
          cur.gain = Math.max(cur.gain, 100 * s.gain[i] / s.profiled[i]);
          cur.loss = Math.max(cur.loss, 100 * s.loss[i] / s.profiled[i]);
          best.set(b.chrom, cur);
        });
        return [...best].map(([c, x]) => `chr${c} +${x.gain.toFixed(0)}/−${x.loss.toFixed(0)}`).join(", ");
      };
      out.push(`Genome-wide copy number (${g.build}, ${g.binMb} Mb bins, |log2| ≥ ${g.threshold}; peak % gained/lost per chromosome):\n` +
        g.series.map((s) => `  ${s.cohort} (${s.segmented.toLocaleString()} segmented samples): ${perChrom(s)}`).join("\n") +
        (g.test ? `\n  bins differing at q<0.05: ${g.test.significantGain} for gains, ${g.test.significantLoss} for losses, of ${g.bins.length}` : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "pathways") {
      const pw = v.pathways;
      out.push(`Oncogenic signalling pathways (% of patients with ≥1 member ${pw.measure === "driver" ? "driver" : "altered"}; union-of-panels denominator):\n` +
        pw.rows.map((r) => `  ${r.name} (${r.profiledGenes}/${r.genes} genes profiled): ` +
          r.cells.map((c) => `${c.cohort} ${c.pct == null ? "not profiled" : c.pct + "%"}`).join(" | ") +
          (r.q != null ? ` q=${pFmt(r.q)}` : "") +
          (r.top.length ? `; top: ` + r.top.map((t) => `${t.gene} ${t.cells.map((c) => c.pct == null ? "–" : c.pct + "%").join("/")}`).join(", ") : "") +
          (r.otherAltered ? `, +${r.otherAltered} more altered` : "")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "diffexpr") {
      const d = v.diffexpr;
      const top = (sign: 1 | -1) => d.points.filter((g) => g.q < 0.05 && Math.sign(g.effect) === sign).slice(0, 12)
        .map((g) => `${g.gene} ${g.effect > 0 ? "+" : ""}${g.effect.toFixed(2)} (q=${pFmt(g.q)})`).join(", ");
      out.push(`Differential expression, ${d.groups[0]} vs ${d.groups[1]} on ${d.profileType}${d.log2 ? " (log2)" : ""}: ` +
        `${d.tested.toLocaleString()} genes tested, ${d.up.toLocaleString()} higher in ${d.groups[0]} and ${d.down.toLocaleString()} higher in ${d.groups[1]} at q<0.05 (${d.effectLabel}).\n` +
        `  most significant, higher in ${d.groups[0]}: ${top(1) || "none"}\n` +
        `  most significant, higher in ${d.groups[1]}: ${top(-1) || "none"}` +
        (d.gsea ? `\n  GSEA (${d.gsea.ranking}; ${d.gsea.permutations} gene-set permutations):\n` +
          d.gsea.sets.slice(0, 12).map((x) => `    ${x.name}: NES ${x.nes.toFixed(2)}, q=${pFmt(x.q)}, ${x.size} genes, leading edge ${x.leadingEdge.slice(0, 8).join(" ")}${x.leadingEdge.length > 8 ? " …" : ""}`).join("\n") : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "paired") {
      const pr = v.paired, aL = pr.labels.a, bL = pr.labels.b;
      const sides = pr.perStudy ? Object.entries(pr.perStudy).map(([st, sp]) => `${st}: ${sp.attribute} ${sp.a.join("/")} vs ${sp.b.join("/")}`).join("; ")
        : `${pr.pairBy.attribute} ${pr.pairBy.a.join("/")} vs ${pr.pairBy.b.join("/")}`;
      out.push(`Paired samples, ${aL} vs ${bL} (${sides}; ${pr.measure === "driver" ? "drivers" : "any alteration"}; profiled on both sides):\n` +
        pr.panels.map((pn) => `  ${pn.cohort} (${pn.patients.toLocaleString()} patients with both` +
          (pn.tested != null ? `; scanned ${pn.tested.toLocaleString()} genes with a discordant patient, the ${pn.genes.length} most one-sided listed` : "") + `):\n` +
          pn.genes.map((g) => `    ${g.gene}: both ${g.both}, ${aL}-only ${g.aOnly}, ${bL}-only ${g.bOnly} of ${g.pairs} pairs` +
            (g.concordance != null ? `, ${Math.round(100 * g.concordance)}% concordant` : "") +
            (g.aOnly + g.bOnly ? `, McNemar q=${pFmt(g.q)}` : "")).join("\n")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "acquired") {
      const ar = v.acquired;
      out.push(`Acquired under therapy: last sample on or before the first ${ar.anchoredTo} against the first at least ${ar.minGapDays} days after (${ar.measure === "driver" ? "OncoKB oncogenic" : "any alteration"}; both samples' panels cover the gene):\n` +
        ar.panels.map((pn) => `  ${pn.cohort} (${pn.anchored.toLocaleString()} started, ${pn.withPre.toLocaleString()} with a sample before, ${pn.withPost.toLocaleString()} after, ${pn.patients.toLocaleString()} with both` +
          (pn.gapDays ? `; samples a median ${pn.gapDays.median} days apart` : "") +
          (pn.tested != null ? `; ${pn.tested.toLocaleString()} genes tested, the ${pn.genes.length} smallest p listed` : "") + `):\n` +
          pn.genes.map((g) => `    ${g.gene}: acquired ${g.acquired}, lost ${g.lost}, shared ${g.shared}, neither ${g.neither} of ${g.pairs} pairs` +
            (g.acquired + g.lost ? `, McNemar p=${pFmt(g.p)} q=${pFmt(g.q)}` : "")).join("\n")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "ctdna") {
      const cr = v.ctdna, pc = (x: number | null) => x == null ? "—" : (100 * x).toFixed(0) + "%";
      out.push(`ctDNA vs tissue (plasma ${cr.attribute} = ${cr.plasma.join("/")}${cr.plasmaPanels.length ? " or panel " + cr.plasmaPanels.join("/") : ""}, tissue ${cr.tissue.join("/")}; ` +
        `${cr.measure === "driver" ? "OncoKB oncogenic" : "any alteration"}${cr.withinDays != null ? `; samples within ${cr.withinDays} days` : ""}; both panels cover the gene):\n` +
        cr.panels.map((pn) => `  ${pn.cohort} (${pn.patients.toLocaleString()} patients with both; ctDNA detected in ${pn.detected.toLocaleString()} of ${pn.plasmaPatients.toLocaleString()} with plasma, ` +
          `${pc(pn.plasmaPatients ? pn.detected / pn.plasmaPatients : null)} [95% CI ${pc(pn.detectedLow)}–${pc(pn.detectedHigh)}]):\n` +
          pn.genes.map((g) => `    ${g.gene}: both ${g.both}, tissue-only ${g.tissueOnly}, plasma-only ${g.plasmaOnly}, neither ${g.neither} of ${g.pairs}; ` +
            `PPA ${pc(g.ppa)}${g.ppa != null ? ` [${pc(g.ppaLow)}–${pc(g.ppaHigh)}]` : ""}, concordance ${pc(g.concordance)}`).join("\n") +
          (pn.survival ? `\n    OS: ` + pn.survival.curves.map((c) => `${c.label} n=${c.n}, ${c.events} deaths, median ${c.median == null ? "not reached" : c.median.toFixed(1) + "mo"}`).join("; ") +
            (pn.survival.logrank ? `; log-rank p=${pFmt(pn.survival.logrank.p)}` : "") : pn.survivalWhy ? `\n    OS by ctDNA not drawn: ${pn.survivalWhy}` : "")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "exclusivity") {
      const ex = v.exclusivity;
      out.push(`Mutual exclusivity (DISCOVER background over ${ex.samples.toLocaleString()} samples and ${ex.matrixGenes} genes${ex.stratifyBy ? `, within ${ex.strata.length} ${ex.stratifyBy} strata` : ""}; ` +
        `${ex.measure === "driver" ? "OncoKB oncogenic" : "any alteration"}; fit ${ex.converged ? "converged" : "NOT converged"} in ${ex.iterations} rounds) in ${ex.cohort}:\n` +
        ex.pairs.map((x) => `  ${x.a}/${x.b}: both ${x.both} of ${x.profiled} profiled, ${x.expected} expected; DISCOVER exclusivity q=${pFmt(x.qExclusive)}, co-occurrence q=${pFmt(x.qCooccur)}` +
          `${x.exact ? "" : " (normal approx.)"}; Fisher q=${pFmt(x.fisherQ)}${x.log2Odds != null ? `, log2 OR ${x.log2Odds.toFixed(2)}` : ""}`).join("\n") +
        (ex.unassessable.length ? `\n  not assessable: ${ex.unassessable.join(", ")}` : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "instability") {
      const ir = v.instability, f = (s: { median: number | null; q1: number | null; q3: number | null }) => s.median == null ? "—" : `${s.median} [${s.q1}–${s.q3}]`;
      out.push(`Genomic instability (hg19 segments, threshold ±${ir.threshold}, arm called past ${Math.round(ir.armShare * 100)}% of its length; ${ir.arms.length} arms):\n` +
        ir.panels.map((pn) => `  ${pn.cohort}: ${pn.score.reduce((s, x) => s + x, 0).toLocaleString()} samples scored; aneuploidy score median [IQR] ${f(pn.scoreSpread)}, FGA ${f(pn.fgaSpread)}%\n` +
          `    most often gained: ${[...pn.arms].filter((a) => a.measured).sort((a, b) => b.gain / b.measured - a.gain / a.measured).slice(0, 5).map((a) => `${a.arm} ${Math.round(100 * a.gain / a.measured)}%`).join(", ")}\n` +
          `    most often lost: ${[...pn.arms].filter((a) => a.measured).sort((a, b) => b.loss / b.measured - a.loss / a.measured).slice(0, 5).map((a) => `${a.arm} ${Math.round(100 * a.loss / a.measured)}%`).join(", ")}`).join("\n") +
        (ir.test ? `\n  ${ir.test.name}: aneuploidy score p=${pFmt(ir.test.scoreP)}, FGA p=${pFmt(ir.test.fgaP)}` : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "clonality") {
      const cr = v.clonality;
      out.push(`Clonality (FACETS; ${cr.measure === "driver" ? "driver mutation calls" : "all mutation calls"}${cr.qc ? ", QC-passing samples" : ""}):\n` +
        cr.panels.map((pn) => `  ${pn.cohort}: WGD ${pn.wgd.yes + pn.wgd.no ? (100 * pn.wgd.yes / (pn.wgd.yes + pn.wgd.no)).toFixed(1) + "%" : "—"} of ${(pn.wgd.yes + pn.wgd.no).toLocaleString()} samples\n` +
          pn.genes.map((g) => `    ${g.gene}: ${g.calls} calls, ${g.clonal + g.subclonal ? Math.round(100 * g.clonal / (g.clonal + g.subclonal)) + "% clonal" : "—"}` +
            ` (${g.clonal} clonal, ${g.subclonal} subclonal, ${g.indeterminate} indeterminate), LOH ${g.lohKnown ? Math.round(100 * g.loh / g.lohKnown) + "%" : "—"}` +
            (g.q != null ? `, q=${pFmt(g.q)}` : "")).join("\n")).join("\n") +
        (cr.wgdP != null ? `\n  WGD difference: Fisher p=${pFmt(cr.wgdP)}` : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "incidence") {
      const inc = v.incidence;
      out.push(`Cumulative incidence of ${inc.eventLabel}${inc.anchoredTo ? " from " + inc.anchoredTo : ""}, death competing (Aalen-Johansen):\n` +
        inc.curves.map((c) => `  ${c.cohort}: n=${c.n.toLocaleString()}, ${c.events} events, ${c.competing} died first, ${c.censored} censored; ` +
          `not at risk: ${c.excluded.prior} already had it, ${c.excluded.unobserved} before observation, ${c.excluded.noAnchor} no anchor, ${c.excluded.noFollowup} no follow-up`).join("\n") + "\n" +
        inc.horizons.map((h) => `  at ${h.months} months: ` + h.cells.map((c) => `${c.cohort} ${(100 * c.f1).toFixed(1)}% (95% CI ${(100 * c.lo).toFixed(1)}-${(100 * c.hi).toFixed(1)}; 1-KM would say ${(100 * c.naive).toFixed(1)}%)`).join(" | ")).join("\n") +
        (inc.gray ? `\n  Gray's test: statistic ${inc.gray.statistic.toFixed(2)}, permutation p=${pFmt(inc.gray.p)} (${inc.gray.permutations} shuffles)` : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "riskmodel" && v.riskmodel) {
      const m = v.riskmodel;
      const pc = (x: number | null) => x == null ? "n/a" : Math.round(x * 100) + "%";
      out.push(`Risk model (elastic-net Cox, ${m.runs} held-out splits, alpha ${m.alpha}, seed ${m.seed}; ${m.n.toLocaleString()} patients, ${m.events.toLocaleString()} events, ` +
        `${m.candidates} candidate genes${m.strata ? ", stratified by " + m.strata : ""}${m.anchoredTo ? ", clock from " + m.anchoredTo : ""}):\n` +
        `  held-out C-index ${m.cIndex.median.toFixed(3)} (IQR ${m.cIndex.q1.toFixed(3)}–${m.cIndex.q3.toFixed(3)})` +
        (m.validation ? `; trained on the discovery half only (${m.validation.discovery} patients), C-index on the validation half ${m.validation.cIndex.toFixed(3)} (${m.validation.validation} patients)` : "") + "\n" +
        (m.covariates.length ? "  adjusted for: " + m.covariates.map((c) => `${c.name} HR ${c.hr.toFixed(3)}`).join(", ") + "\n" : "") +
        `  risk score on OncoCast's 0–10 scale (0 and 10 the lowest and highest held-out score${m.validation ? " in the discovery half" : ""}; raw ${m.scale.min.toFixed(3)} to ${m.scale.max.toFixed(3)})\n` +
        `  risk groups (${m.reportedOn}${m.cutsChosen ? `; cut at the view's chosen quantiles ${m.cutsChosen.join(", ")}` : ", equal quantiles"}):\n` +
        m.groups.map((g) => `    ${g.name} (score ${riskSpan(m, g)}): n=${g.curve.n}, ${g.curve.events} events, median ${g.curve.median == null ? "not reached" : g.curve.median.toFixed(1) + "mo"}, ` +
          `12-month ${pc(g.at12)}, 36-month ${pc(g.at36)}` + (g.hr != null ? `, HR vs lowest ${g.hr.toFixed(2)} (95% CI ${g.ciLow!.toFixed(2)}–${g.ciHigh!.toFixed(2)}, ${pFmt(g.p!)})` : "")).join("\n") +
        (m.logrank ? `\n  log-rank p=${pFmt(m.logrank.p)}` : "") +
        (m.refit ? `\n  risk score alone: HR ${m.refit.hr.toFixed(2)} per SD (95% CI ${m.refit.ciLow.toFixed(2)}–${m.refit.ciHigh.toFixed(2)}, ${pFmt(m.refit.p)})` : "") +
        "\n  genes kept most often: " + m.features.slice(0, 15).map((f) => `${f.gene} ${Math.round(f.selected * 100)}% HR ${f.hr.toFixed(2)}`).join(", ") +
        (m.neverHeldOut ? `\n  ${m.neverHeldOut} patients were never held out, so have no score` : "") +
        caveatOf(v) + methodOf(v) + noteOf(v));
    } else if (v.kind === "cutpoint") {
      const m = v.cutpoint;
      const side = (s: { n: number; events: number; median: number | null }) => `n=${s.n}, ${s.events} events, median ${s.median == null ? "not reached" : s.median.toFixed(1) + "mo"}`;
      out.push(`Cut-point of ${m.attribute} on ${m.endpoint} (maximally selected log-rank, ${m.candidates.length} candidate cuts between the 10th and 90th percentiles; ${m.n.toLocaleString()} patients, ${m.events.toLocaleString()} events):\n` +
        `  best cut ${m.attribute} > ${m.cut}: high ${side(m.high)}; low ${side(m.low)}` + (m.hr ? `; HR ${m.hr.hr.toFixed(2)} (95% CI ${m.hr.ciLow.toFixed(2)}-${m.hr.ciHigh.toFixed(2)})` : "") + "\n" +
        `  corrected p=${pFmt(m.permP)} (${m.permutations} permutations, seed ${m.seed}); naive log-rank p=${pFmt(m.naiveP)}, which ignores the search` +
        (m.strata ? "\n  per " + m.strata.attribute + ":\n" + m.strata.rows.map((s) => `    ${s.stratum}: n=${s.n}, cut ${s.cut}, high ${s.high.n}, ` +
          (s.hr ? `HR ${s.hr.hr.toFixed(2)}, ` : "") + `corrected p=${pFmt(s.permP)}, naive p=${pFmt(s.naiveP)}`).join("\n") : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "predictive") {
      const m = v.predictive;
      const eff = (e: { hr: number; ciLow: number; ciHigh: number; p: number } | null) => e ? `HR ${e.hr.toFixed(2)} (95% CI ${e.ciLow.toFixed(2)}-${e.ciHigh.toFixed(2)}, ${pFmt(e.p)})` : "n/a";
      out.push(`Predictive biomarkers: gene x ${m.exposure} on ${m.endpoint} (Cox per gene; ${m.n.toLocaleString()} patients, ${m.exposed.toLocaleString()} exposed, ${m.events.toLocaleString()} events` +
        (m.covariates.length ? `; adjusted for ${m.covariates.join(", ")}` : "") + `):\n` +
        m.genes.map((g) => `  ${g.gene}: mutated ${g.mutatedExposed}/${g.exposed} exposed, ${g.mutatedUnexposed}/${g.unexposed} unexposed; ` +
          (g.interaction ? `among exposed ${eff(g.inExposed)}; among unexposed ${eff(g.inUnexposed)}; interaction ${eff(g.interaction)}, q=${pFmt(g.q!)}` : `not fitted: ${g.skipped}`)).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "txendpoints") {
      const t = v.txendpoints;
      out.push(`Treatment endpoint: ${t.endpointLabel} from ${t.anchoredTo} (Kaplan-Meier):\n` +
        t.curves.map((c) => `  ${c.cohort}: n=${c.n.toLocaleString()}, ${c.events} events, ${txMedianText(c)}; ` +
          `${c.anchored} of ${c.cohortPatients} anchored; left out ${c.excluded.noAnchor} without the anchor, ${c.excluded.noFollowup} without follow-up` +
          (t.endpoint === "tot" ? `, ${c.excluded.noStop} without a stop date` : "")).join("\n") +
        (t.logrank ? `\n  log-rank chi2=${t.logrank.chi2.toFixed(2)} (${t.logrank.df} df), p=${pFmt(t.logrank.p)}` : t.noTest ? `\n  ${t.noTest}` : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "labs") {
      const lb = v.labs;
      out.push(`Lab course: ${lb.test} % change from baseline, weeks from ${lb.anchoredTo}:\n` +
        lb.panels.map((pn) => `  ${pn.cohort}: ${pn.anchored.toLocaleString()} started, ${pn.baseline.toLocaleString()} with a baseline, ${pn.evaluable.toLocaleString()} measured after; ` +
          `${pn.evaluable ? (100 * pn.responders / pn.evaluable).toFixed(1) : "—"}% fell ≥${lb.responseDrop}% (${pn.responders}/${pn.evaluable})\n` +
          `    median [IQR] by week: ` + pn.course.filter((c) => c.n >= 5).map((c) => `${c.week}w ${c.median}% [${c.q1}, ${c.q3}]`).join(", ")).join("\n") +
        (lb.responseP != null ? `\n  response rates differ: Fisher p=${pFmt(lb.responseP)}` : "") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "enrichment") {
      const en = v.enrichment;
      out.push(`Alteration enrichment (${en.alteration}${en.measure === "driver" ? ", drivers only" : ""}; ${en.test}, BH q over ${en.tested.toLocaleString()} genes; ${en.significant} at q<0.05):\n` +
        en.rows.slice(0, 40).map((g) => `  ${g.gene}: ` + g.cells.map((c) => `${c.cohort} ${c.pct == null ? "—" : c.pct + "%"} (${c.altered}/${c.profiled})`).join(" | ") +
          (g.log2Ratio != null && g.log2Ratio !== undefined ? `, log2 ratio ${g.log2Ratio.toFixed(2)}` : "") + `, q=${pFmt(g.q)}, enriched in ${g.enrichedIn}`).join("\n") +
        (en.rows.length > 40 ? `\n  … ${en.tested - 40} more genes tested` : "") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "assays") {
      const as = v.assays;
      const cell = (c: AssaysEntity["cells"][number]) => as.datatype === "numeric"
        ? `${c.cohort} mean ${c.mean == null ? "—" : c.mean.toPrecision(3)} (n=${c.n})`
        : `${c.cohort} ` + Object.entries(c.values || {}).map(([k, n]) => `${k} ${c.n ? (100 * n / c.n).toFixed(1) : "—"}%`).join(", ") + ` (n=${c.n})`;
      out.push(`Generic-assay comparison, ${as.profileName} (${as.profileType}; ${as.datatype}, per ${as.unit.replace(/s$/, "")}; ${as.test}, BH q over ${as.tested.toLocaleString()} entities; ${as.significant} at q<0.05):\n` +
        as.rows.slice(0, 40).map((g) => `  ${g.name}: ` + g.cells.map(cell).join(" | ") +
          (g.diff != null ? `, difference ${g.diff.toPrecision(3)}` : "") + `, q=${pFmt(g.q)}, higher in ${g.higherIn}${g.value ? " (" + g.value + ")" : ""}`).join("\n") +
        (as.rows.length > 40 ? `\n  … ${as.tested - 40} more entities tested` : "") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "composition" && v.composition) {
      const cm = v.composition;
      const fmt = (x: number) => cm.normalize ? (100 * x).toFixed(1) + "%" : x.toPrecision(3);
      out.push(`Composition of ${cm.sourceName} (${cm.parts.length} parts${cm.normalize ? ", shares of each " + cm.unit.replace(/s$/, "") + "'s total" : ""}; ` +
        `each cohort against the others by Welch's t, BH q over ${cm.tested} comparisons; ${cm.significant} at q<0.05):\n` +
        cm.groups.map((g) => `  ${g.cohort} (n=${g.n}${g.entropy ? ", entropy " + g.entropy.mean.toFixed(2) : ""}): ` +
          cm.parts.map((pt) => { const c = cm.cells.find((x) => x.cohort === g.cohort && x.part === pt.id)!;
            return `${pt.name} ${fmt(c.mean)}` + (c.q != null ? ` (log2 ${c.log2!.toFixed(2)}, q=${pFmt(c.q)})` : ""); }).join(", ")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "correlates") {
      const co = v.correlates;
      const line = (g: CorrelatesGene) => `  ${g.gene}: ρ ${g.rho} (q=${pFmt(g.q)}), r ${g.r}, n=${g.n}`;
      out.push(`Genes co-expressed with ${co.gene} (${co.profileType}${co.otherProfile !== co.profileType ? " against " + co.otherProfile : ""}) in ${co.cohort}; ` +
        `Spearman ρ${co.rhoFrom === "meta" ? " combined across studies by Fisher z" : ""}, BH q over ${co.tested.toLocaleString()} genes; ${co.significant.toLocaleString()} at q<0.05:\n` +
        ` most positively correlated:\n` + co.positive.map(line).join("\n") +
        `\n most negatively correlated:\n` + co.negative.map(line).join("\n") + caveatOf(v) + noteOf(v));
    } else if (v.kind === "mutations" || v.kind === "table") {
      const t = (v.kind === "mutations" ? v.mutations : v.table)!;
      const title = v.kind === "mutations" ? `${v.mutations.gene} mutations` : `Clinical data table (one row per ${v.table.unit})`;
      out.push(`${title}: ${t.total < t.all ? `${t.total.toLocaleString()} of ${t.all.toLocaleString()} rows kept by the query` : `${t.total.toLocaleString()} rows`}; ` +
        tableText(t) + caveatOf(v) + noteOf(v));
    } else if (v.kind === "timeline" && v.timeline) {
      const t = v.timeline, pt = t.patient;
      const head = `Patient timeline — patients to choose from: ${t.total < t.all ? `${t.total.toLocaleString()} of ${t.all.toLocaleString()} kept by the query` : `${t.total.toLocaleString()}`}; ` + tableText(t);
      if (!pt) out.push(head + "\n  no patient drawn: the list is empty" + caveatOf(v) + noteOf(v));
      else {
        const shown = pt.events.slice(0, TIMELINE_TEXT_EVENTS);
        const line = (e: (typeof pt.events)[number]) => `  day ${e.start}${e.end != null && e.end > e.start ? `–${e.end}` : ""}: ${e.type}` +
          (e.attrs.length ? " — " + e.attrs.filter(([k]) => !/^STYLE_/i.test(k)).map(([k, x]) => `${k}=${x}`).join(", ") : "");
        out.push(head + `\n${pt.patient} (${pt.study}${pt.source.remote ? ", from " + pt.source.label + " over MCP" : ""}): ${pt.events.length} events, days from diagnosis; ` +
          `samples: ${pt.samples.map((x) => x.id + (x.type ? " (" + x.type + ")" : "")).join(", ") || "none"}\n` +
          shown.map(line).join("\n") +
          (pt.events.length > shown.length ? `\n  … ${pt.events.length - shown.length} later events not listed here (the figure draws all of them)` : "") +
          caveatOf(v) + noteOf(v));
      }
    } else if (v.kind === "alterations" && v.alterations) {
      const a = v.alterations, pt = a.patient;
      const head = `Patient alterations — patients to choose from: ${a.total < a.all ? `${a.total.toLocaleString()} of ${a.all.toLocaleString()} kept by the query` : `${a.total.toLocaleString()}`}; ` + tableText(a);
      if (!pt) out.push(head + "\n  no patient listed: the list is empty" + caveatOf(v) + noteOf(v));
      else {
        const names: Record<string, string> = { mutations: "Mutations", cna: "Copy Number Alterations", sv: "Structural Variants" };
        out.push(head + `\n${pt.id} (${pt.study}); samples: ${pt.samples.map((x) => x.id + (x.type ? " (" + x.type + ")" : "")).join(", ") || "none"}` +
          Object.entries(a.tables).map(([k, t]) => `\n${names[k] || k}: ${t!.total < t!.all ? `${t!.total.toLocaleString()} of ${t!.all.toLocaleString()} rows kept by the query` : `${t!.total.toLocaleString()} rows`}; ` + tableText(t!)).join("") +
          caveatOf(v) + noteOf(v));
      }
    } else if (v.kind === "overlap") {
      const ov = v.overlap;
      out.push(`Cohort overlap (patients in exactly these cohorts and no other):\n` +
        `  cohort sizes: ` + ov.sets.map((x) => `${x.name} ${x.size.toLocaleString()}`).join(", ") + `\n` +
        ov.intersections.map((x) => `  ${x.members.join(" ∩ ")}${x.members.length < ov.sets.length ? " only" : ""}: ${x.n.toLocaleString()}`).join("\n") +
        `\n  ${ov.union.toLocaleString()} patients in at least one cohort` + caveatOf(v) + noteOf(v));
    } else if (v.kind === "cancertypes") {
      const ct = v.cancertypes;
      const line = (g: { label: string; altered: number; profiled: number; mutation: number; amp: number; homdel: number; sv: number; multiple: number }) =>
        `    ${g.label}: ${(100 * g.altered / (g.profiled || 1)).toFixed(1)}% (${g.altered}/${g.profiled}; mutation ${g.mutation}, amp ${g.amp}, deep del ${g.homdel}, SV ${g.sv}, multiple ${g.multiple})`;
      out.push(`Cancer types summary: ${ct.genes.join(", ")} by ${ct.groupBy} (${ct.measure === "driver" ? "drivers" : "any alteration"}; samples profiled for at least one gene):\n` +
        ct.panels.map((pn) => `  ${pn.cohort}: ${pn.altered.toLocaleString()} of ${pn.profiled.toLocaleString()} profiled samples altered\n` +
          [...pn.groups, ...(pn.pooled ? [pn.pooled] : [])].map(line).join("\n")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else if (v.kind === "attrition") {
      out.push("Cohort attrition (patients left after each clause, in order):\n" + v.attrition.map((pn) =>
        `  ${pn.cohort}: study base ${pn.base.toLocaleString()}\n` +
        pn.steps.map((st) => `    → ${st.label}: ${st.n.toLocaleString()} (−${st.excluded.toLocaleString()})`).join("\n")).join("\n") +
        caveatOf(v) + noteOf(v));
    } else {
      // A view kind with no branch above used to append nothing at all: the
      // numbers were computed and the model was simply never told. Saying so
      // is worse than a proper description but far better than silence.
      out.push(`View "${v.kind}" ran but this tool has no text rendering for it yet — ` +
        `open the interactive editor link below to see it.`);
    }
    if (v.method) out[out.length - 1] += methodOf(v);
  }
  return out;
}

/** A table view's first rows, shown columns only, tab-separated — the web app's view pages and downloads every row. */
function tableText(t: { columns: { id: string }[]; shown: string[]; rows: { cohort: string; values: unknown[] }[]; total: number }): string {
  const idx = t.shown.map((id) => t.columns.findIndex((c) => c.id === id)).filter((i) => i >= 0);
  const shown = t.rows.slice(0, 50);
  return `the first ${shown.length}, tab-separated (the web app's view pages and downloads every row, with every column):\n` +
    [["cohort", ...idx.map((i) => t.columns[i].id)], ...shown.map((r) => [r.cohort, ...idx.map((i) => r.values[i])])]
      .map((xs) => "  " + xs.map((x) => String(x ?? "").replace(/[\t\n]+/g, " ")).join("\t")).join("\n") +
    (t.total > shown.length ? `\n  … ${(t.total - shown.length).toLocaleString()} more rows` : "");
}
