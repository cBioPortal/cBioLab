"use client";
// The diffexpr view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the diffexpr view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the molecular profile both cohorts are compared on">
          profile <OptionSelect value={spec.profileType || ""} disabled={busy} onValueChange={(v) => patch({ profileType: v, log2: undefined })}>
            {!c.profiles.includes(spec.profileType) && <option value={spec.profileType || ""}>{spec.profileType || "choose…"}</option>}
            {c.profiles.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </OptionSelect>
        </label>
        <label className="chk" title="compare log2(v + 1) instead of the stored value; on by default for a non-z-score RNA-seq profile">
          <Checkbox checked={c.v.diffexpr ? !!c.v.diffexpr.log2 : spec.log2 === true} disabled={busy}
            onCheckedChange={(on) => patch({ log2: (on === true) })} /> log2
        </label>
        <label className="chk" title="preranked GSEA against the 50 MSigDB Hallmark sets; untick to draw the volcano alone">
          <Checkbox checked={!(Array.isArray(spec.geneSets) && spec.geneSets.length === 0)} disabled={busy}
            onCheckedChange={(on) => patch({ geneSets: (on === true) ? undefined : [] })} /> enrichment
        </label>
      </div>
    </div>
  );
}

export const diffexprUi: KindUi<"diffexpr"> = {
  kind: "diffexpr",
  label: "Differential expression + GSEA",
  title: "Differential expression",
  maxCohorts: 2,
  minCohorts: 2,
  why: (k) => !k.profiles.length ? "this study has no molecular profile to compare expression on" : null,
  defaults: (known) => {
    const profile = known.profiles.find((p) => /zscore/i.test(p) && /mrna|rna_seq/i.test(p))
      || known.profiles.find((p) => /mrna|rna_seq/i.test(p)) || known.profiles[0] || "";
    return { kind: "diffexpr", profileType: profile };
  },
  sub: (spec, v) => (spec.profileType || "no profile") + (v.diffexpr ? (v.diffexpr.log2 ? ", log2(v+1)" : "") + " · volcano and GSEA" : ""),
  Controls,
};
