"use client";
// The correlates view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CohortDef, DrawnResultOf, View, ViewResult, ViewResultOf } from "../../../lib/types";
import { type Col, PortalTable } from "../portal-bodies.tsx";
import { DraftInput } from "./parts.tsx";
import { profileUse } from "../../../lib/profile-catalog.ts";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { SERIES } from "../../../lib/svg-kit";
import { ViewFigure } from "../figure.tsx";
import { api } from "../api.ts";
import { fmtP } from "../../../lib/chart/format";
import { pDigits } from "../../../lib/chart/format.ts";
import { useEffect, useMemo, useRef, useState } from "react";

// ---- Co-expression: the correlated genes, and the query gene against the one picked ----------

type CoRow = NonNullable<ViewResultOf<"correlates">["correlates"]>["positive"][number];

/**
 * A plot of two values over one cohort, computed when asked: an ordinary plot view sent for the
 * pair, drawn here by the shared renderer. A newer pick supersedes one still in flight.
 */
function usePairPlot(docJson: (() => string) | undefined, cohort: string, view: Record<string, unknown> | null) {
  const [state, setState] = useState<{ key: string; view?: ViewResult; error?: string } | null>(null);
  const want = useRef("");
  const key = JSON.stringify(view);
  useEffect(() => {
    if (!view || !docJson) return;
    want.current = key;
    setState(null);
    let doc: { study?: string; cohorts?: Record<string, CohortDef> };
    try { doc = JSON.parse(docJson()); } catch { setState({ key, error: "no document to plot from" }); return; }
    const def = doc.cohorts && doc.cohorts[cohort];
    if (!def) { setState({ key, error: "cohort “" + cohort + "” is not in the document" }); return; }
    api.analysis({ study: doc.study, cohorts: { [cohort]: def }, views: [{ ...view, cohorts: [cohort] } as View] }, { query: "?oncoprint=spec" })
      .then((r) => r.json())
      .then((j) => { if (want.current !== key) return; const pv = j.views && j.views[0]; setState({ key, ...(j.error || pv?.error ? { error: j.error || pv.error } : { view: pv }) }); })
      .catch((e) => { if (want.current === key) setState({ key, error: String(e) }); });
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return state && state.key === key ? state : null;
}

function CorrelatesBody({ v, docJson }: { v: DrawnResultOf<"correlates">; docJson?: () => string }) {
  const r = v.correlates;
  const [which, setWhich] = useState<"any" | "positive" | "negative">("any");
  const rows = useMemo(() => which === "positive" ? r.positive : which === "negative" ? r.negative : [...r.positive, ...r.negative], [r, which]);
  const [sel, setSel] = useState<CoRow | null>(null);
  const picked = sel && rows.includes(sel) ? sel : [...rows].sort((a, b) => a.q - b.q || Math.abs(b.rho ?? 0) - Math.abs(a.rho ?? 0))[0] || null;
  const plot = usePairPlot(docJson, r.cohort, picked ? { kind: "plot", unit: "patient",
    x: { source: "profile", profile: r.profileType, gene: r.gene }, y: { source: "profile", profile: r.otherProfile, ...(r.otherIsAssay ? { entity: picked.gene } : { gene: picked.gene }) } } : null);
  const cols: Col<CoRow>[] = [
    r.otherIsAssay
      ? { key: "gene", label: "Correlated entity", value: (g) => g.name || g.gene, render: (g) => <strong title={g.gene}>{g.name || g.gene}</strong> }
      : { key: "gene", label: "Correlated Gene", value: (g) => g.gene, render: (g) => <strong>{g.gene}</strong> },
    ...(r.otherIsAssay ? [] : [{ key: "cytoband", label: "Cytoband", value: (g: CoRow) => g.cytoband || null }]),
    { key: "rho", label: "Spearman's Correlation", num: true, value: (g) => g.rho,
      render: (g) => <span style={{ color: (g.rho ?? 0) > 0 ? SERIES[2] : SERIES[4] }}>{g.rho?.toFixed(3)}</span> },
    { key: "p", label: "p-Value", num: true, value: (g) => g.rhoP, render: (g) => pDigits(g.rhoP) },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => <strong>{pDigits(g.q)}</strong> },
  ];
  return (
    <div className="pb">
      <p className="meta">{r.otherIsAssay ? "Entities of" : "Genes on"} <code>{r.otherProfile}</code> correlated with <strong>{r.gene}</strong> on <code>{r.profileType}</code>, over {r.cohort} · {r.tested.toLocaleString()} {r.otherIsAssay ? "entities" : "genes"} tested · {r.significant.toLocaleString()} at q &lt; 0.05</p>
      <div className="pb-row">
        <div>
          <OptionSelect value={which} ariaLabel="which correlations to show" onValueChange={(v) => setWhich(v as typeof which)}>
            <option value="any">Show Any Correlation</option><option value="positive">Show Positive Correlations</option><option value="negative">Show Negative Correlations</option>
          </OptionSelect>
          <PortalTable rows={rows} cols={cols} initialSort={{ key: "q" }} search={(g) => g.gene + " " + (g.cytoband || "")} selected={picked} onSelect={setSel}
            note={"the " + r.positive.length + " most positive and " + r.negative.length + " most negative of " + r.tested.toLocaleString()} />
        </div>
        <div className="pb-plot">
          {picked && <p className="meta">{r.gene} vs {picked.gene} · Spearman {picked.rho?.toFixed(2)} ({fmtP(picked.rhoP)}) · Pearson {picked.r?.toFixed(2)} ({fmtP(picked.p)})</p>}
          {!plot && picked && <div className="loading-block"><span className="spinner" /> drawing {r.gene} vs {picked.gene}…</div>}
          {plot?.error && <p className="note">{plot.error}</p>}
          {plot?.view && <ViewFigure v={plot.view} min={320} />}
        </div>
      </div>
    </div>
  );
}

/** the correlates view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const profs = c.profiles.filter((p) => p !== "cna");
  // a numeric generic assay can be what the gene is correlated against: every entity of it
  const assays = (c.catalog || []).filter((p) => profileUse(p) === "assayNumber");
  const pick = (value: string, set: (v: string) => void, title: string, label: string, withAssays = false) => (
    <label className="tbfield" title={title}>
      {label} <OptionSelect value={value} disabled={busy} onValueChange={(v) => set(v)}>
        {!profs.includes(value) && !(withAssays && assays.some((p) => p.profile === value)) && <option value={value}>{value || "choose…"}</option>}
        {profs.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
        {withAssays && assays.map((p) => <option key={p.profile} value={p.profile}>{p.name} (generic assay)</option>)}
      </OptionSelect>
    </label>
  );
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the gene every other gene is correlated with">
          gene <DraftInput value={spec.gene || ""} disabled={busy} width="6rem" placeholder="ESR1" onCommit={(t) => patch({ gene: t.trim().toUpperCase() })} />
        </label>
        {pick(spec.profileType || "", (v) => patch({ profileType: v }), "the query gene's profile", "on")}
        {pick(spec.otherProfile || spec.profileType || "", (v) => patch({ otherProfile: v === spec.profileType ? undefined : v }), "the profile every other gene is read from, or a generic assay whose every entity is", "against", true)}
        <label className="tbfield" title="genes listed in each direction; every tested gene is in the histogram">
          list <OptionSelect value={String(spec.show ?? 100)} disabled={busy} onValueChange={(v) => patch({ show: Number(v) === 100 ? undefined : Number(v) })}>
            {[25, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect> each way
        </label>
      </div>
    </div>
  );
}

export const correlatesUi: KindUi<"correlates"> = {
  kind: "correlates",
  label: "Co-expression with one gene (genome-wide)",
  category: "expression",
  title: "Co-expression",
  maxCohorts: 1,
  why: (k) => !k.profiles.filter((p) => p !== "cna").length ? "this study has no continuous molecular profile (mRNA, protein, …) to correlate on" : null,
  defaults: (known) => {
    const profs = known.profiles.filter((p) => p !== "cna");
    const profile = profs.find((p) => /mrna|rna_seq/i.test(p) && !/zscore/i.test(p)) || profs.find((p) => /mrna|rna_seq/i.test(p)) || profs[0] || "";
    return { kind: "correlates", gene: known.genes[0] || "TP53", profileType: profile };
  },
  sub: (spec, v) => (spec.gene || "no gene") + " on " + (spec.profileType || "no profile") + (spec.otherProfile && spec.otherProfile !== spec.profileType ? " against " + spec.otherProfile : "") + " · Spearman ρ, every " + (v.correlates?.otherIsAssay ? "entity" : "gene"),
  Controls,
  body: (c) => c.v.correlates ? <CorrelatesBody v={c.v} docJson={c.docJson} /> : null,
};
