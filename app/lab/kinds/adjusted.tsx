"use client";
// The adjusted view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the adjusted view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const covs: string[] = Array.isArray(spec.covariates) ? spec.covariates : [];
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="clinical attributes to adjust for, comma-separated (e.g. MSI_TYPE, TMB_NONSYNONYMOUS, CANCER_TYPE)">
          adjust for <DraftInput value={covs.join(", ")} disabled={busy} width="14rem" placeholder="none"
            onCommit={(t) => { const l = t.split(",").map((x) => x.trim()).filter(Boolean); patch({ covariates: l.length ? l : undefined }); }} />
        </label>
        <label className="tbfield" title="count every called mutation, or only OncoKB drivers">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any</option><option value="driver">drivers</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="test the genes mutated in at least this share of the patients profiled for them (at most 200 genes)">
          genes mutated in ≥ <OptionSelect value={String(spec.minShare ?? 0.05)} disabled={busy} onValueChange={(v) => patch({ minShare: v === "0.05" ? undefined : Number(v) })}>
            {[...new Set([0.02, 0.03, 0.05, 0.1, 0.2, spec.minShare ?? 0.05])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{(100 * n).toFixed(0)}%</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const adjustedUi: KindUi<"adjusted"> = {
  kind: "adjusted",
  label: "Adjusted enrichment (every gene, logistic on covariates)",
  category: "alterations",
  title: "Adjusted enrichment",
  maxCohorts: 2,
  minCohorts: 2,
  sub: (spec) => "mutations in every gene mutated in ≥" + (100 * (spec.minShare ?? 0.05)).toFixed(0) + "% · adjusted for " + (spec.covariates?.length ? spec.covariates.join(", ") : "nothing"),
  Controls,
};
