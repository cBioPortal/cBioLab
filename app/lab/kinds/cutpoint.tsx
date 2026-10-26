"use client";
// The cutpoint view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { EntityField, searchEntities } from "../entity-field.tsx";
import { profileUse } from "../../../lib/profile-catalog.ts";

/** the cutpoint view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const nums = c.attrs.filter((a) => a.kind === "num").map((a) => a.attribute);
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const attr = spec.attribute || "TMB_NONSYNONYMOUS";
  // a numeric generic assay can be the marker too: its entity is then found by search
  const assays = (c.catalog || []).filter((p) => profileUse(p) === "assayNumber" && p.study);
  const assay = spec.assay ? assays.find((p) => p.profile === spec.assay.profileType) : undefined;
  const marker = spec.assay ? "assay:" + spec.assay.profileType : attr;
  const choose = (v: string) => {
    const p = v.startsWith("assay:") ? assays.find((x) => "assay:" + x.profile === v) : undefined;
    if (!p) return patch({ attribute: v, assay: undefined });
    searchEntities(p.study || "", p.profile, "").then((r) => r.entities[0] &&
      patch({ attribute: undefined, assay: { profileType: p.profile, entity: r.entities[0].entity } }), () => {});
  };
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the numeric marker whose cut-point is searched: a clinical attribute, or one entity of a generic assay">
          marker <OptionSelect value={marker} disabled={busy} onValueChange={choose}>
            {!spec.assay && !nums.includes(attr) && <option value={attr}>{attr}</option>}
            {spec.assay && !assay && <option value={marker}>{spec.assay.profileType}</option>}
            {nums.map((a) => <option key={a} value={a}>{a}</option>)}
            {assays.map((p) => <option key={p.profile} value={"assay:" + p.profile}>{p.name} (generic assay)</option>)}
          </OptionSelect>
        </label>
        {spec.assay && <span className="tbfield" title="the entity of the generic assay whose value is the marker">
          entity <EntityField study={assay?.study || ""} profile={spec.assay.profileType} value={String(spec.assay.entity || "")} busy={busy}
            side="marker" className="w-44" onPick={(e) => patch({ assay: { profileType: spec.assay.profileType, entity: e } })} />
        </span>}
        <label className="tbfield" title="a cut-point per value of this attribute (its largest values), as a table">
          per <OptionSelect value={spec.stratifyBy || ""} disabled={busy} onValueChange={(v) => patch({ stratifyBy: v || undefined })}>
            <option value="">(no strata)</option>
            {spec.stratifyBy && !cats.includes(spec.stratifyBy) && <option value={spec.stratifyBy}>{spec.stratifyBy}</option>}
            {cats.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="seeded permutations of the marker for the corrected p">
          permutations <OptionSelect value={String(spec.permutations ?? 1000)} disabled={busy} onValueChange={(v) => patch({ permutations: Number(v) })}>
            {[200, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const cutpointUi: KindUi<"cutpoint"> = {
  kind: "cutpoint",
  label: "Biomarker cut-point (best split of a number for OS)",
  category: "outcomes",
  title: "Cut-point",
  maxCohorts: 1,
  why: (k) => k.attrs.some((a) => a.kind === "num") ? null : "this study has no numeric clinical attribute to find a cut-point of",
  defaults: (known) => {
    const num = known.attrs.find((a) => a.attribute === "TMB_NONSYNONYMOUS") || known.attrs.find((a) => a.kind === "num");
    return { kind: "cutpoint", attribute: num ? num.attribute : "TMB_NONSYNONYMOUS" };
  },
  sub: (spec) => (spec.assay ? spec.assay.entity : spec.attribute || "TMB_NONSYNONYMOUS") + " on " + (spec.endpoint || "OS") + " · best log-rank cut, " + (spec.permutations ?? 1000) + " permutations" +
    (spec.stratifyBy ? " · per " + spec.stratifyBy : ""),
  Controls,
};
