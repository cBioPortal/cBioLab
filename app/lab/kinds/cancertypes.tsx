"use client";
// The cancertypes view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DrawAtWidth } from "../figure.tsx";
import type { DrawnResultOf } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { SEG_TAB, SEG_TABS } from "../../_ui/toolbar.ts";
import { Tabs, TabsList, TabsTrigger } from "../../_ui/tabs";
import { cancertypesPanelSvg, categoryLabel } from "../../../lib/views/cancertypes/figure.ts";
import { frame, palette } from "../../../lib/svg-kit";
import { cancertypesTsv } from "../../../lib/views/cancertypes/tsv.ts";
import { savePdf, savePng, standaloneSvg } from "../chart-files.ts";
import { saveText } from "../../../lib/study-view-download.ts";
import { Button } from "../../_ui/button";
import { TB } from "../../_ui/toolbar.ts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../_ui/dropdown-menu";
import { CloudDownload } from "lucide-react";
import { useState } from "react";
import { DraftInput } from "./parts.tsx";
import { Checkbox } from "../../_ui/checkbox";

/** a threshold box as the portal's reads it: everything but digits and "." dropped; nothing readable, null */
function thresholdOf(text: string): number | null {
  const n = parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

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

/**
 * One chart's download menu, the portal's: SVG, PNG, PDF and its Data file, all named cancer_types_summary
 * (with the cohort's name beside it when the view draws several), as the chart is drawn: its gene tab,
 * filters and order.
 */
function Downloads({ r, panel, gene }: { r: DrawnResultOf<"cancertypes">["cancertypes"]; panel: number; gene: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const base = "cancer_types_summary" + (r.panels.length > 1 ? "_" + r.panels[panel].cohort.replace(/[^\w.-]+/g, "_") : "");
  const svg = () => {
    const c = cancertypesPanelSvg(r, panel, { width: 860, gene, title: r.panels.length > 1 || gene !== null, theme: "light" });
    return standaloneSvg(frame(c.width, c.height, c.body, palette("light").bg, false, "Cancer types summary"));
  };
  const image = (fmt: "svg" | "png" | "pdf") => {
    setFailed(null);
    const s = svg(), file = base + "." + fmt;
    if (fmt === "svg") saveText(file, s);
    else (fmt === "png" ? savePng(file, s) : savePdf(file, s)).catch((e) => setFailed("Could not make the " + fmt.toUpperCase() + ": " + String((e as Error)?.message || e)));
  };
  return (
    <div className="flex items-center justify-end gap-2">
      {failed && <span className="meta" role="alert">{failed}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className={TB} aria-label="download the cancer types summary" data-tip="download this chart as drawn, or its numbers (Data)">
            <CloudDownload />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => image("svg")}>SVG</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => image("png")}>PNG</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => image("pdf")}>PDF</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => saveText(base + ".tsv", cancertypesTsv(r, panel, gene))}>Data</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

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
      {r.panels.map((_, i) => <div key={i}>
        <Downloads r={r} panel={i} gene={gene === ALL ? null : gene} />
        <DrawAtWidth draw={draw(i)} deps={[r, gene]} />
      </div>)}
    </div>
  );
}


/** the cancertypes view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const by: string = spec.groupBy || "";
  // what the portal's default chose for the last result, named beside it (the next run may choose again)
  const chosen: string | undefined = !by ? c.v?.cancertypes?.groupBy : undefined;
  const freq = spec.show !== "count";
  const units = spec.unit === "sample" ? "samples" : "patients", Units = spec.unit === "sample" ? "Samples" : "Patients";
  // a commit that leaves the document as it was still resets the boxes to what is applied
  const [commits, setCommits] = useState(0);
  const commit = (p: Record<string, unknown>) => { setCommits((n) => n + 1); patch(p); };
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="the portal's category type: the study, the cancer type or the detailed cancer type — or any other sample attribute. Until one is chosen, the portal's default: the study for several studies, the detailed cancer type for a study of one cancer type, else the cancer type">
          category <OptionSelect value={by} disabled={busy} onValueChange={(v) => patch({ groupBy: v || undefined, minSamples: undefined, minAltered: undefined })}>
            <option value="">{"portal default" + (chosen ? " (" + categoryLabel(chosen) + ")" : "")}</option>
            <option value="study">Cancer Study</option>
            <option value="CANCER_TYPE">Cancer Type</option>
            <option value="CANCER_TYPE_DETAILED">Cancer Type Detailed</option>
            {by && !cats.includes(by) && !["study", "CANCER_TYPE", "CANCER_TYPE_DETAILED"].includes(by) && <option value={by}>{by}</option>}
            {cats.filter((a) => a !== "CANCER_TYPE" && a !== "CANCER_TYPE_DETAILED").map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="count patients (as the portal does by default — a patient counts in each group one of their samples is in) or samples">
          count by <OptionSelect value={spec.unit === "sample" ? "sample" : "patient"} disabled={busy}
            onValueChange={(v) => patch({ unit: v === "sample" ? "sample" : undefined, minSamples: undefined, minAltered: undefined })}>
            <option value="patient">patients</option><option value="sample">samples</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="count every alteration, or only OncoKB drivers">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any alteration</option><option value="driver">drivers</option>
          </OptionSelect>
        </label>
      </div>
      <div className="tbz"><span className="tbl">filter</span>
        <label className="tbfield" data-tip={"the portal's Min. # Total: a category is shown only with at least this many profiled " + units + "; empty, the portal's default: 10, or 0 when no category of the chart has more than 10. Applies on Enter"}>
          Min. # Total {Units}
          {/* unset, each panel and gene tab works out its own default, so the box names none */}
          <DraftInput key={"total" + commits} value={spec.minSamples == null ? "" : String(spec.minSamples)} placeholder="default" disabled={busy} width="4.5rem" title={"Min. # Total " + Units}
            onCommit={(t) => { const n = thresholdOf(t); commit({ minSamples: n === null ? undefined : Math.ceil(n) }); }} />
        </label>
        <label className="tbfield" data-tip={(freq ? "the portal's Min. % Altered: a category is shown only with at least this share of its profiled " : "the portal's Min. # Altered: a category is shown only with at least this many altered ") + units + ". Applies on Enter"}>
          {freq ? "Min. % Altered " : "Min. # Altered "}{Units}
          <DraftInput key={"altered" + commits} value={String(spec.minAltered ?? 0) + (freq ? "%" : "")} disabled={busy} width="4.5rem" title={(freq ? "Min. % Altered " : "Min. # Altered ") + Units}
            onCommit={(t) => { const n = thresholdOf(t); commit({ minAltered: n ? n : undefined }); }} />
        </label>
      </div>
      <div className="tbz"><span className="tbl">view</span>
        <label className="tbfield" data-tip="the y axis: each group's altered share, or its altered count">
          y-axis <OptionSelect value={freq ? "frequency" : "count"} disabled={busy} onValueChange={(v) => patch({ show: v === "count" ? "count" : undefined, minAltered: undefined })}>
            <option value="frequency">Alteration Frequency</option><option value="count">Absolute Counts</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="the portal's Sort X-Axis By: highest bar first, or the categories alphabetically (a study by its id)">
          sort x-axis by <OptionSelect value={spec.sort === "alphabetical" ? "alphabetical" : "value"} disabled={busy} onValueChange={(v) => patch({ sort: v === "alphabetical" ? "alphabetical" : undefined })}>
            <option value="value">Y-Axis Values</option><option value="alphabetical">Alphabetically</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="the portal's Show Genomic Alteration Types: each bar split by kind of alteration, or drawn whole without a legend">
          <Checkbox checked={spec.alterationTypes !== false} disabled={busy} onCheckedChange={(on) => patch({ alterationTypes: on === true ? undefined : false })} />
          Show Genomic Alteration Types
        </label>
      </div>
    </div>
  );
}

export const cancertypesUi: KindUi<"cancertypes"> = {
  kind: "cancertypes",
  label: "Cancer types summary",
  category: "overview",
  title: "Cancer types summary",
  genes: true,
  maxCohorts: 2,
  defaults: (known) => ({ kind: "cancertypes", genes: known.genes.length ? known.genes.slice(0, 5) : ["TP53", "KRAS"] }),
  sub: (spec) => "by " + (spec.groupBy || "the portal's default category") + (spec.measure === "driver" ? ", drivers" : ", any alteration") + ", % of profiled " + (spec.unit === "sample" ? "samples" : "patients"),
  Controls,
  body: (c) => c.v.cancertypes ? <CancertypesBody v={c.v} /> : null,
};
