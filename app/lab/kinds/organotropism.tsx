"use client";
// The organotropism view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the organotropism view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const genes: string[] = Array.isArray(spec.genes) ? spec.genes : [];
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const strat = spec.stratifyBy === null ? "" : spec.stratifyBy || "CANCER_TYPE";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="where the metastatic sites come from: per-organ DMETS_DX_ flags, tumour sites on the timeline, or the biopsy site of metastasis samples">
          sites <OptionSelect value={spec.source || "auto"} disabled={busy} onValueChange={(v) => patch({ source: v === "auto" ? undefined : v })}>
            <option value="auto">auto</option><option value="flags">per-organ flags</option><option value="timeline">timeline</option><option value="sample">biopsy site</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="genes, comma-separated (at most 20); empty for the most altered">
          genes <DraftInput value={genes.join(", ")} disabled={busy} width="14rem" placeholder={"top " + (spec.top ?? 12) + " altered"}
            onCommit={(t) => { const l = t.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean); patch({ genes: l.length ? l : undefined }); }} />
        </label>
        <label className="tbfield" data-tip="count every alteration, or only OncoKB drivers">
          count <OptionSelect value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onValueChange={(v) => patch({ measure: v === "any" ? "any" : undefined })}>
            <option value="driver">drivers</option><option value="any">any</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="the covariate the 2×2 tables are stratified by (Cochran–Mantel–Haenszel)">
          within <OptionSelect value={strat} disabled={busy} onValueChange={(v) => patch({ stratifyBy: v === "" ? null : v === "CANCER_TYPE" ? undefined : v })}>
            <option value="">no strata</option>
            {!cats.includes("CANCER_TYPE") && <option value="CANCER_TYPE">CANCER_TYPE</option>}
            {strat && !cats.includes(strat) && strat !== "CANCER_TYPE" && <option value={strat}>{strat}</option>}
            {cats.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const organotropismUi: KindUi<"organotropism"> = {
  kind: "organotropism",
  label: "Metastatic organotropism (genes × metastatic sites, within cancer types)",
  category: "evolution",
  title: "Metastatic organotropism",
  maxCohorts: 1,
  cohortInHeader: true,
  why: (k) => k.attrs.some((a) => /^DMETS_DX_|^METASTATIC_SITE$/i.test(a.attribute)) || k.events.some((e) => /diagnosis/i.test(e.canonical)) ? null
      : "this study records no metastatic sites (per-organ DMETS_DX_ flags, METASTATIC_SITE, or tumour sites on a Diagnosis timeline)",
  sub: (spec) => (spec.measure === "any" ? "" : "driver ") + (spec.alteration || "mutation") + "s in " +
    (spec.genes?.length ? spec.genes.length + " genes" : "the " + (spec.top ?? 12) + " most altered genes") + " × metastatic sites from " + (spec.source && spec.source !== "auto" ? spec.source : "the study's site source") +
    (spec.stratifyBy === null ? ", unstratified" : ", within " + (spec.stratifyBy || "CANCER_TYPE")),
  Controls,
};
