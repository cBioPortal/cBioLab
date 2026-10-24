"use client";
// The germline view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the germline view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const genes: string[] = Array.isArray(spec.genes) ? spec.genes : [];
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="genes, comma-separated (at most 60); empty for every gene with enough carriers">
          genes <DraftInput value={genes.join(", ")} disabled={busy} width="14rem" placeholder={"≥ " + (spec.minCarriers ?? 3) + " carriers"}
            onCommit={(t) => { const l = t.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean); patch({ genes: l.length ? l : undefined }); }} />
        </label>
        <label className="tbfield" title="the fewest carriers a gene needs to be listed when no genes are named">
          min carriers <OptionSelect value={String(spec.minCarriers ?? 3)} disabled={busy} onValueChange={(v) => patch({ minCarriers: Number(v) === 3 ? undefined : Number(v) })}>
            {[1, 2, 3, 5, 10, 20].map((k) => <option key={k} value={k}>{k}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="draw overall survival for one gene's carriers against non-carriers; empty for none">
          OS by <DraftInput value={spec.survival?.gene || ""} disabled={busy} width="6rem" placeholder="gene"
            onCommit={(t) => patch({ survival: t.trim() ? { gene: t.trim().toUpperCase() } : undefined })} />
        </label>
      </div>
    </div>
  );
}

export const germlineUi: KindUi<"germline"> = {
  kind: "germline",
  label: "Germline carriers (and their somatic second hits)",
  category: "clinical",
  title: "Germline carriers",
  maxCohorts: 4,
  sub: (spec) => "germline carriers per patient sequenced, " + (spec.genes?.length ? spec.genes.length + " genes" : "every gene with ≥" + (spec.minCarriers ?? 3) + " carriers") +
    " · somatic second hit vs non-carriers" + (spec.survival?.gene ? " · OS by " + spec.survival.gene + " carrier status" : ""),
  Controls,
};
