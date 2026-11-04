"use client";
// The mutexpr view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** a profile the view reads: mRNA or protein expression, by the study's own description where the page has it */
function expressionProfiles(c: KindCardCtx): string[] {
  const cat = (c.catalog || []).filter((p) => (p.type === "MRNA_EXPRESSION" || p.type === "PROTEIN_LEVEL") &&
    ["CONTINUOUS", "Z-SCORE", "LOG2-VALUE", "LOG-VALUE"].includes(p.datatype.toUpperCase())).map((p) => p.profile);
  const list = cat.length ? cat : c.profiles.filter((p) => /mrna|rna_seq|tpm|fpkm|protein|rppa/i.test(p));
  return [...new Set(list)];
}
const isZ = (c: KindCardCtx, profile: string) => {
  const info = (c.catalog || []).find((p) => p.profile === profile);
  return info ? info.datatype.toUpperCase() === "Z-SCORE" : /zscore/i.test(profile);
};
const geneOf = (t: string) => t.trim().toUpperCase();

/** the mutexpr view's settings rows */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const profiles = expressionProfiles(c);
  const z = isZ(c, spec.profileType || "");
  const scale = c.v.mutexpr?.scale ?? spec.scale ?? (z ? "zscore" : "log2");
  const strata: string[] = Array.isArray(spec.stratify) ? spec.stratify : [];
  const toggle = (s: string, on: boolean) => {
    const next = ["cancerType", "fusion"].filter((x) => x === s ? on : strata.includes(x));
    patch({ stratify: next.length ? next : undefined, ...(s === "fusion" && !on ? { fusionGene: undefined } : {}) });
  };
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">groups</span>
        <label className="tbfield" data-tip="the gene whose mutations make the groups">
          mutated <DraftInput value={spec.gene || ""} disabled={busy} width="5.5rem" placeholder="gene" title="mutated gene"
            onCommit={(t) => patch({ gene: geneOf(t) })} />
        </label>
        <label className="tbfield" data-tip="one group per protein change (R175H), or per codon (R175H and R175C together as R175)">
          by <OptionSelect value={spec.resolution || "protein"} disabled={busy} onValueChange={(v) => patch({ resolution: v === "protein" ? undefined : v })}>
            <option value="protein">protein change</option>
            <option value="codon">codon</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="a group or stratum with fewer samples is withheld; a change with fewer is pooled into “Other”">
          min samples <OptionSelect value={String(spec.minCount ?? 5)} disabled={busy} onValueChange={(v) => patch({ minCount: Number(v) === 5 ? undefined : Number(v) })}>
            {[1, 3, 5, 10, 20, 50].map((k) => <option key={k} value={k}>{k}</option>)}
          </OptionSelect>
        </label>
      </div>
      <div className="tbz"><span className="tbl">expression</span>
        <label className="tbfield" data-tip="the gene whose expression is plotted; empty for the mutated gene itself">
          gene <DraftInput value={spec.expressionGene || ""} disabled={busy} width="5.5rem" placeholder={spec.gene || "same"} title="expression gene"
            onCommit={(t) => patch({ expressionGene: geneOf(t) && geneOf(t) !== spec.gene ? geneOf(t) : undefined })} />
        </label>
        <label className="tbfield" data-tip="the expression profile read">
          profile <OptionSelect value={spec.profileType || ""} disabled={busy} onValueChange={(v) => patch({ profileType: v, scale: undefined })}>
            {!profiles.includes(spec.profileType) && <option value={spec.profileType || ""}>{spec.profileType || "choose…"}</option>}
            {profiles.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip={z ? "a z-score profile is read as stored" : "the profile as stored (TPM, RSEM, FPKM…), or log2(v + 1)"}>
          scale <OptionSelect value={scale} disabled={busy || z} onValueChange={(v) => patch({ scale: v === "log2" ? undefined : v })}>
            {z ? <option value="zscore">z-score</option> : <>
              <option value="log2">log2(v + 1)</option>
              <option value="linear">as stored</option>
            </>}
          </OptionSelect>
        </label>
      </div>
      <div className="tbz"><span className="tbl">within</span>
        <label className="chk" data-tip="form the groups within each CANCER_TYPE">
          <Checkbox checked={strata.includes("cancerType")} disabled={busy} onCheckedChange={(on) => toggle("cancerType", on === true)} /> cancer type
        </label>
        <label className="chk" data-tip="form the groups within: has a fusion (structural variant) of the fusion gene, has none, or not profiled for one">
          <Checkbox checked={strata.includes("fusion")} disabled={busy} onCheckedChange={(on) => toggle("fusion", on === true)} /> fusion
        </label>
        {strata.includes("fusion") && <label className="tbfield" data-tip="the gene whose fusions split the samples; empty for the mutated gene">
          of <DraftInput value={spec.fusionGene || ""} disabled={busy} width="5.5rem" placeholder={spec.gene || "gene"} title="fusion gene"
            onCommit={(t) => patch({ fusionGene: geneOf(t) && geneOf(t) !== spec.gene ? geneOf(t) : undefined })} />
        </label>}
      </div>
    </div>
  );
}

export const mutexprUi: KindUi<"mutexpr"> = {
  kind: "mutexpr",
  label: "Expression by mutation (protein change or codon)",
  category: "expression",
  title: "Expression by mutation",
  maxCohorts: 1,
  why: (k) => !k.profiles.some((p) => /mrna|rna_seq|tpm|fpkm|protein|rppa/i.test(p)) ? "this study has no expression profile" : null,
  defaults: (known) => {
    const profile = known.profiles.find((p) => /^rna_seq_v2_mrna$|^mrna_seq_tpm$/.test(p))
      || known.profiles.find((p) => /mrna|rna_seq|tpm/i.test(p) && !/zscore/i.test(p))
      || known.profiles.find((p) => /mrna|rna_seq|tpm/i.test(p)) || "";
    return { kind: "mutexpr", gene: known.genes[0] || "TP53", profileType: profile };
  },
  sub: (spec, v) => {
    const m = v.mutexpr;
    return (m ? m.valueLabel : (spec.expressionGene || spec.gene || "?") + " expression") +
      " · by " + (spec.gene || "?") + " " + ((spec.resolution || "protein") === "codon" ? "codon" : "protein change") +
      (Array.isArray(spec.stratify) && spec.stratify.length ? " · within " + spec.stratify.map((s: string) => s === "cancerType" ? "cancer type" : "fusion status").join(" × ") : "") +
      " · min " + (spec.minCount ?? 5);
  },
  Controls,
};
