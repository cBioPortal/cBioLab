"use client";
// The cancertypes view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DrawAtWidth } from "../figure.tsx";
import type { DrawnResultOf } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { SEG_TAB, SEG_TABS } from "../../_ui/toolbar.ts";
import { Tabs, TabsList, TabsTrigger } from "../../_ui/tabs";
import { cancertypesPanelSvg } from "../../../lib/views/cancertypes/figure.ts";
import { frame, palette } from "../../../lib/svg-kit";
import { useState } from "react";

/** Tabs over a body, the portal's gene / group selectors. */
function Pills({ items, on, set }: { items: string[]; on: string; set: (x: string) => void }) {
  return (
    <Tabs value={on} onValueChange={set} className="my-2">
      <TabsList className={SEG_TABS}>
        {items.map((x) => <TabsTrigger key={x} value={x} className={SEG_TAB}>{x}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}

// ---- Cancer Types Summary: "All Queried Genes" and one tab per gene, a bar chart per cohort ----

function CancertypesBody({ v }: { v: DrawnResultOf<"cancertypes"> }) {
  const r = v.cancertypes;
  const ALL = "All Queried Genes";
  const [gene, setGene] = useState(ALL);
  // each cohort's chart laid out for the card's width; one with more groups than fit grows and scrolls
  const draw = (i: number) => (width: number) => {
    const c = cancertypesPanelSvg(r, i, { width, gene: gene === ALL ? null : gene, title: r.panels.length > 1 || gene !== ALL });
    return frame(c.width, c.height, c.body, palette("auto").bg, c.grown, "Cancer types summary — " + r.panels[i].cohort);
  };
  return (
    <div className="pb">
      {r.genes.length > 1 && <Pills items={[ALL, ...r.genes]} on={gene} set={setGene} />}
      {r.panels.map((_, i) => <DrawAtWidth key={i} draw={draw(i)} deps={[r, gene]} />)}
    </div>
  );
}

/** the cancertypes view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const by = spec.groupBy || "CANCER_TYPE";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the portal's category type: the study, the cancer type or the detailed cancer type — or any other sample attribute">
          category <OptionSelect value={by} disabled={busy} onValueChange={(v) => patch({ groupBy: v === "CANCER_TYPE" ? undefined : v })}>
            <option value="study">Cancer Study</option>
            <option value="CANCER_TYPE">Cancer Type</option>
            <option value="CANCER_TYPE_DETAILED">Cancer Type Detailed</option>
            {!cats.includes(by) && !["study", "CANCER_TYPE", "CANCER_TYPE_DETAILED"].includes(by) && <option value={by}>{by}</option>}
            {cats.filter((a) => a !== "CANCER_TYPE" && a !== "CANCER_TYPE_DETAILED").map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="count patients (as the portal does by default — a patient counts in each group one of their samples is in) or samples">
          count by <OptionSelect value={spec.unit === "sample" ? "sample" : "patient"} disabled={busy} onValueChange={(v) => patch({ unit: v === "sample" ? "sample" : undefined })}>
            <option value="patient">patients</option><option value="sample">samples</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="count every alteration, or only OncoKB drivers">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any alteration</option><option value="driver">drivers</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="groups with fewer profiled patients (or samples) than this are pooled into one bar, never dropped">
          min group <OptionSelect value={String(spec.minSamples ?? 10)} disabled={busy} onValueChange={(v) => patch({ minSamples: Number(v) })}>
            {[...new Set([1, 10, 50, 100, 200, 500, spec.minSamples ?? 10])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
      </div>
      <div className="tbz"><span className="tbl">view</span>
        <label className="tbfield" title="the y axis: each group's altered share, or its altered count">
          y-axis <OptionSelect value={spec.show === "count" ? "count" : "frequency"} disabled={busy} onValueChange={(v) => patch({ show: v === "count" ? "count" : undefined })}>
            <option value="frequency">Alteration Frequency</option><option value="count">Absolute Counts</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const cancertypesUi: KindUi<"cancertypes"> = {
  kind: "cancertypes",
  label: "Cancer types summary",
  title: "Cancer types summary",
  genes: true,
  maxCohorts: 2,
  defaults: (known) => ({ kind: "cancertypes", genes: known.genes.length ? known.genes.slice(0, 5) : ["TP53", "KRAS"] }),
  sub: (spec) => "by " + (spec.groupBy || "CANCER_TYPE") + (spec.measure === "driver" ? ", drivers" : ", any alteration") + ", % of profiled samples",
  Controls,
  body: (c) => c.v.cancertypes ? <CancertypesBody v={c.v} /> : null,
};
