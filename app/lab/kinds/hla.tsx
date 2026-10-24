"use client";
// The hla view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the hla view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const nums = c.attrs.filter((a) => a.kind === "num").map((a) => a.attribute);
  const cov = (spec.covariates || [])[0] || "";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="how many fields of the allele name must match for a locus to count as homozygous">
          resolution <OptionSelect value={String(spec.resolution ?? 2)} disabled={busy} onValueChange={(v) => patch({ resolution: v === "full" ? "full" : v === "1" ? 1 : undefined })}>
            <option value="1">1 field (A*02)</option><option value="2">2 fields (A*02:01)</option><option value="full">full</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="a numeric attribute the adjusted hazard ratio adds (e.g. tumour mutational burden)">
          adjust for <OptionSelect value={cov} disabled={busy} onValueChange={(v) => patch({ covariates: v ? [v] : undefined })}>
            <option value="">(unadjusted)</option>
            {cov && !nums.includes(cov) && <option value={cov}>{cov}</option>}
            {nums.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const hlaUi: KindUi<"hla"> = {
  kind: "hla",
  label: "HLA class I genotype (homozygosity, HLA LOH and OS)",
  title: "HLA class I genotype",
  maxCohorts: 3,
  why: (k) => k.attrs.some((a) => /^hla[-_]?[abc]/i.test(a.attribute)) ? null : "this study records no HLA class I alleles",
  defaults: (known) => {
    const tmb = known.attrs.find((a) => a.attribute === "TMB_NONSYNONYMOUS" || a.attribute === "TMB_SCORE");
    return tmb ? { kind: "hla", covariates: [tmb.attribute] } : { kind: "hla" };
  },
  sub: (spec) => "alleles at " + (spec.resolution === 1 ? "1 field" : spec.resolution === "full" ? "full resolution" : "2 fields") + " · " + (spec.endpoint || "OS") +
    " by homozygosity and by HLA LOH" + (spec.covariates && spec.covariates.length ? " · adjusted for " + spec.covariates.join(", ") : ""),
  Controls,
};
