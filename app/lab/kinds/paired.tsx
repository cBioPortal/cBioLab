"use client";
// The paired view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput, PAIRED_DEFAULT_GENES } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the paired view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const pb = spec.pairBy || { attribute: "SAMPLE_TYPE", a: "Primary", b: "Metastasis" };
  const csv = (x: any) => (Array.isArray(x) ? x : [x]).filter((y: any) => y != null && y !== "").join(", ");
  const parse = (t: string) => { const xs = t.split(",").map((y) => y.trim()).filter(Boolean); return xs.length === 1 ? xs[0] : xs; };
  const setBy = (k: "attribute" | "a" | "b", t: string) => patch({ pairBy: { ...pb, [k]: k === "attribute" ? t.trim() : parse(t) } });
  const scanning = !(spec.genes && spec.genes.length);
  const perStudy = pb.studies ? Object.keys(pb.studies).length : 0;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        {perStudy ? (
          <span className="meta" data-tip={Object.entries(pb.studies).map(([st, sp]: [string, any]) => st + ": " + sp.attribute + " " + csv(sp.a) + " vs " + csv(sp.b)).join("\n")}>
            sides set per study in the document ({perStudy} {perStudy === 1 ? "study" : "studies"})
          </span>
        ) : <>
          <label className="tbfield" data-tip="a SAMPLE-level attribute that says which kind each sample is">
            pair by <DraftInput value={pb.attribute} disabled={busy} width="9rem" onCommit={(t) => setBy("attribute", t)} />
          </label>
          <span className="tbfield">
            <DraftInput value={csv(pb.a)} disabled={busy} title="the value(s) of that attribute on the first side; comma-separated for several" onCommit={(t) => setBy("a", t)} />
          </span>
          <label className="tbfield" data-tip="the value(s) on the second side">
            vs <DraftInput value={csv(pb.b)} disabled={busy} onCommit={(t) => setBy("b", t)} />
          </label>
        </>}
        <label className="tbfield" data-tip="test the genes you chose, or scan every gene altered in a paired patient and draw the most one-sided">
          genes <OptionSelect value={scanning ? "scan" : "chosen"} disabled={busy}
            onValueChange={(v) => patch(v === "scan" ? { genes: undefined } : { genes: PAIRED_DEFAULT_GENES, top: undefined })}>
            <option value="chosen">chosen</option><option value="scan">scan all</option>
          </OptionSelect>
        </label>
        {scanning && (
          <label className="tbfield" data-tip="how many of the most one-sided genes to draw; q is still taken across every gene tested">
            drawn <OptionSelect value={String(spec.top ?? 20)} disabled={busy} onValueChange={(v) => patch({ top: Number(v) === 20 ? undefined : Number(v) })}>
              {[...new Set([10, 20, 30, 40, Number(spec.top ?? 20)])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n}</option>)}
            </OptionSelect>
          </label>
        )}
        <label className="tbfield" data-tip="count only OncoKB drivers, or every alteration">
          count <OptionSelect value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onValueChange={(v) => patch({ measure: v === "any" ? "any" : undefined })}>
            <option value="driver">drivers</option><option value="any">any alteration</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const pairedUi: KindUi<"paired"> = {
  kind: "paired",
  label: "Paired samples (primary vs metastasis, before vs after)",
  category: "evolution",
  title: "Paired samples",
  genes: true,
  maxCohorts: 3,
  defaults: (known) => ({ kind: "paired", genes: known.genes.length ? known.genes.slice(0, 8) : PAIRED_DEFAULT_GENES }),
  sub: (spec, v) => {
    const pb = spec.pairBy || { attribute: "SAMPLE_TYPE", a: "Primary", b: "Metastasis" };
    const j = (x: any) => Array.isArray(x) ? x.join("/") : String(x ?? "");
    const sides = v.paired ? v.paired.labels.a + " vs " + v.paired.labels.b
      : pb.studies ? "sides set per study" : pb.attribute + ": " + j(pb.a) + " vs " + j(pb.b);
    return sides + (spec.measure === "any" ? ", any alteration" : ", drivers") + (spec.genes && spec.genes.length ? "" : ", every gene scanned");
  },
  Controls,
};
