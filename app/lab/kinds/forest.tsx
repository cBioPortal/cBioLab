"use client";
// The forest view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the forest view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const e = spec.exposure || { source: "alteration", gene: "" };
  const isGene = e.source === "alteration";
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const strata = spec.strata || "CANCER_TYPE";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">exposure</span>
        <label className="tbfield" title="a gene's mutation (patients not profiled for it are left out), or a clinical attribute">
          is <OptionSelect value={isGene ? "gene" : "attribute"} disabled={busy}
            onValueChange={(v) => patch(v === "gene" ? { exposure: { source: "alteration", gene: "TP53" }, threshold: undefined, exposed: undefined } : { exposure: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" }, threshold: 10, exposed: undefined })}>
            <option value="gene">gene mutated</option><option value="attribute">attribute</option>
          </OptionSelect>
        </label>
        {isGene
          ? <span className="tbfield"><DraftInput value={e.gene || (e.genes || []).join(",")} disabled={busy} width="6rem" title="the gene whose mutation is the exposure"
              onCommit={(t) => patch({ exposure: { source: "alteration", gene: t.trim().toUpperCase() } })} /></span>
          : <>
              <span className="tbfield"><DraftInput value={e.attribute || ""} disabled={busy} width="9rem" title="the clinical attribute"
                onCommit={(t) => patch({ exposure: { source: "clinical", attribute: t.trim() } })} /></span>
              <label className="tbfield" title="a numeric attribute: patients at or above this are the exposed">
                ≥ <DraftInput value={spec.threshold != null ? String(spec.threshold) : ""} disabled={busy} width="4rem" placeholder="number"
                  onCommit={(t) => patch(t.trim() ? { threshold: Number(t), exposed: undefined } : { threshold: undefined })} />
              </label>
              <label className="tbfield" title="a categorical attribute: the level counted as exposed">
                or = <DraftInput value={spec.exposed || ""} disabled={busy} width="6rem" placeholder="level"
                  onCommit={(t) => patch(t.trim() ? { exposed: t.trim(), threshold: undefined } : { exposed: undefined })} />
              </label>
            </>}
      </div>
      <div className="tbz"><span className="tbl">rows</span>
        <label className="tbfield" title="what one row is: a cancer type (or any categorical attribute), a study, or one of the view's cohorts">
          per <OptionSelect value={strata} disabled={busy} onValueChange={(v) => patch({ strata: v === "CANCER_TYPE" ? undefined : v })}>
            <option value="CANCER_TYPE">cancer type</option>
            <option value="CANCER_TYPE_DETAILED">detailed cancer type</option>
            <option value="study">study</option><option value="cohort">cohort</option>
            {!cats.includes(strata) && !["study", "cohort", "CANCER_TYPE", "CANCER_TYPE_DETAILED"].includes(strata) && <option value={strata}>{strata}</option>}
            {cats.filter((a) => a !== "CANCER_TYPE" && a !== "CANCER_TYPE_DETAILED").map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="a stratum with fewer patients than this (or fewer than minEvents deaths) is pooled into Other, or left out">
          min <OptionSelect value={String(spec.minPatients ?? 30)} disabled={busy} onValueChange={(v) => patch({ minPatients: v === "30" ? undefined : Number(v) })}>
            {[...new Set([10, 30, 50, 100, 200, spec.minPatients ?? 30])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} patients</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="the small strata: pooled into one Other row (each keeping its own baseline hazard), or left out and listed">
          small <OptionSelect value={spec.small === "drop" ? "drop" : "pool"} disabled={busy} onValueChange={(v) => patch({ small: v === "drop" ? "drop" : undefined })}>
            <option value="pool">pooled as Other</option><option value="drop">left out</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const forestUi: KindUi<"forest"> = {
  kind: "forest",
  label: "Pan-cancer forest (one exposure's HR per cancer type, random-effects pooled)",
  category: "outcomes",
  title: "Forest plot",
  maxCohorts: 6,
  defaults: (known) => ({ kind: "forest", exposure: { source: "alteration", gene: known.genes[0] || "TP53" } }),
  sub: (spec) => {
    const e = spec.exposure || {};
    const what = e.source === "alteration" ? (e.oql || (e.genes || [e.gene]).join(" or ") + " mutated") : e.attribute ? e.attribute + (spec.threshold != null ? " ≥ " + spec.threshold : spec.exposed ? " = " + spec.exposed : "") : "no exposure chosen";
    return what + " · " + (spec.endpoint || "OS") + " hazard ratio per " + (spec.strata || "CANCER_TYPE") + ", random-effects pooled";
  },
  Controls,
};
