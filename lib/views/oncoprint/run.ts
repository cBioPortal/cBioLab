// Oncoprint view: genes by patients, built from patient-level participants only (its columns
// ARE patients) — the rest are named as left out.
import { buildContract, PIDS_SQL, type PidsCarrier } from "../../oncoprint.ts";
import { geneSymbols } from "../../gene-tracks.ts";
import { varianceFromMoments } from "../../stats.ts";
import { contractToSvg } from "../../oncoprint-svg.ts";
import type { ViewResult } from "../../types.ts";
import { isPatientLevel } from "../../federation.ts";
import { untimed, type Untimed, type ViewRun, type DocView } from "../run.ts";
import { overLimit } from "../shared.ts";
import type { OncoprintView, ZReference } from "./types.ts";

export async function runOncoprint(view: DocView, c: ViewRun): Promise<ViewResult | Untimed> {
  const { doc, cohorts, resolvers, vNames, vStudies, participationFor } = c;
  // Oncoprint columns ARE patients, so an instance that will not disclose
  // member ids cannot contribute columns. Render what is permitted and say
  // exactly what was left out — never silently narrow the cohort.
  const okStudies = vStudies.filter((st) => isPatientLevel(resolvers[st]));
  const withheld = vStudies.filter((st) => !isPatientLevel(resolvers[st]));
  const withheldPts = vNames.reduce((n, cn) =>
    n + withheld.reduce((m, st) => m + (cohorts[cn].perStudy[st]?.count || 0), 0), 0);
  const shownPts = vNames.reduce((n, cn) =>
    n + okStudies.reduce((m, st) => m + (cohorts[cn].perStudy[st]?.count || 0), 0), 0);
  if (!okStudies.length) {
    return untimed({ kind: "oncoprint", cohorts: vNames, studies: vStudies,
      participation: participationFor(vStudies, true),
      error: "no participating instance permits patient-level access, and an oncoprint's columns are patients — " +
        withheld.join(", ") + " answer with aggregates only. Compare and survival still cover all " +
        (shownPts + withheldPts).toLocaleString() + " patients." });
  }
  const multi = okStudies.length > 1;
  const genes = (view as OncoprintView).genes || [];
  { const e = overLimit("an oncoprint view", 12, genes.length) || overLimit("an oncoprint view", 3, ((view as OncoprintView).derivedCohorts || []).length);
    if (e) return untimed({ kind: "oncoprint", error: e.replace("at most 12", "at most 12 gene rows").replace("at most 3", "at most 3 derived-cohort rows") }); }
  // Federated z-score reference: a heatmap track marked reference:"federation"
  // is scored against a distribution pooled from EVERY participating study,
  // including the aggregate-only ones that contribute no columns. Each of
  // those returns three totals per gene — n, sum, sum of squares — so a site
  // that will not disclose a patient still shapes what the drawn columns mean.
  const heatSpecs = (view as OncoprintView).heatmap || [];
  const zReference: Record<string, ZReference> = {};
  for (const h of heatSpecs) {
    if (h.reference !== "federation" || /^vaf$/i.test(h.profileType)) continue;
    const hGenes = h.genes && h.genes.length ? geneSymbols(h.genes) : geneSymbols(genes);
    if (!hGenes.length) continue;
    const per = await Promise.all(vStudies.map(async (st) => ({
      // a failed study fails the view: a reference silently missing a study would shift every z-score
      st, m: await resolvers[st].profileMoments(null, hGenes, h.profileType)
    })));
    for (const gene of hGenes) {
      let n = 0, sum = 0, sumsq = 0; const contributing: string[] = [];
      for (const { st, m } of per) {
        const g = m.find((x) => x.gene === gene);
        if (!g || !g.n) continue;
        n += g.n; sum += g.sum; sumsq += g.sumsq; contributing.push(st);
      }
      if (n < 3) continue;                       // too little to define a reference
      const sd = Math.sqrt(varianceFromMoments(n, sum, sumsq));
      if (!(sd > 0)) continue;                   // a constant reference cannot z-score anything
      zReference[h.profileType + "|" + gene] = { mean: sum / n, sd, n, studies: contributing };
    }
  }
  // federated: each group carries a {study: sql} map; each cohort contributes
  // only the studies it was actually evaluated in
  // The spec is built here either way: this is where the permitted studies, the
  // federated z-reference and the cohort definitions are known.
  const oncoSpec = {
    study: okStudies[0],
    studies: okStudies,
    genes,
    clinical: (view as OncoprintView).clinical || [],
    heatmap: (view as OncoprintView).heatmap || [],
    sort: (view as OncoprintView).sort,
    display: (view as OncoprintView).display,
    unit: (view as OncoprintView).unit,
    overlays: (view as OncoprintView).overlays,
    ...(Object.keys(zReference).length ? { zReference } : {}),
    // document cohorts the view asked to draw as binary rows; the engine refuses them
    // across studies and in sample mode, which are exactly the cases where "is this
    // patient in that cohort" has no single answer per column
    derivedEvents: ((view as OncoprintView).derivedCohorts || [])
      .filter((n) => doc.cohorts[n])
      .map((n) => ({ label: n, expression: doc.cohorts[n] })),
    conventions: { lineGap: 90 }
  };
  const note = (multi
    ? "cross-study oncoprint" + (okStudies.length <= 2 ? " (" + okStudies.join(", ") + ")" : " across " + okStudies.length + " studies") +
      ": duplicate patients across studies appear as separate columns; clinical tracks merge attribute values by name without harmonization; the \u201cStudy of origin\u201d track shows each column's origin"
    : "") +
    (withheld.length
      ? (multi ? " — " : "") + "columns cover " + shownPts.toLocaleString() + " of " +
        (shownPts + withheldPts).toLocaleString() + " patients: " + withheld.join(", ") +
        " answer with aggregates only, so their patients cannot be drawn as columns (compare and survival above include them)"
      : "");
  const oncoShared = { kind: "oncoprint" as const, cohorts: vNames,
    participation: participationFor(vStudies, true),
    ...(multi || withheld.length ? { studies: okStudies, note } : {}) };

  if (c.oncoprint === "spec") {
    // The web app draws the figure itself from the binary contract, so the run
    // returns what to ask for rather than a picture: the cohort DEFINITIONS travel
    // (compiled SQL never leaves the server), and the client posts this to
    // /api/oncoprint. Nothing is queried for this view here.
    return { ...oncoShared, spec: { ...oncoSpec,
      layout: { groupBy: { kind: "cohorts" as const, groups: vNames.map((n) => ({ name: n, dsl: doc.cohorts[n] })) } } } };
  } else {
    const oncoLog: { label: string; sql: string; ms?: number; study?: string }[] = [];
    const contract = await buildContract({ ...oncoSpec,
      layout: { groupBy: { kind: "cohorts" as const, groups: vNames.map((n) => ({ name: n, dsl: {
        [PIDS_SQL]: multi
          ? Object.fromEntries(okStudies.filter((s) => cohorts[n].perStudy[s]).map((s) => [s, cohorts[n].perStudy[s].sql]))
          : cohorts[n].perStudy[okStudies[0]].sql
      } as PidsCarrier })) } }
    }, { log: oncoLog });
    const tRender = Date.now();
    const oncoSvg = contractToSvg(contract, 1200);
    const oncoRenderMs = Date.now() - tRender;
    return { ...oncoShared, svg: oncoSvg,
      renderMs: oncoRenderMs,
      queries: oncoLog.map((q) => ({ study: q.study || okStudies[0], label: q.label, sql: q.sql, ...(q.ms != null ? { ms: q.ms } : {}) })),
      genes: contract.tracks.filter((t) => t.kind === "gene").map((t) => ({ gene: t.label, driverPct: t.driverPct ?? null, anyPct: t.freqPct ?? null })),
      nColumns: contract.stats.nColumns, annotation: contract.conventions.annotation };
  }
}
