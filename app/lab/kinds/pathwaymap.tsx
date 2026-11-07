"use client";
// The pathwaymap view on the analysis page (and the portal's Pathways tab): its entry in the add menu, the view a new
// one starts from, and its card — the pathway diagram beside the ranked list of pathways that chooses it. The
// pathway, the ranking and the PanCanAtlas filter are the document's, applied here from the one result (dataPart
// leaves them out of the re-run key), so choosing re-runs nothing.
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { Checkbox } from "../../_ui/checkbox";
import { ViewFigure } from "../figure.tsx";
import { arrangeFor } from "../../../lib/views/pathwaymap/rank.ts";
import { pathwayNamed } from "../../../lib/views/pathwaymap/library.ts";
import { fmtNum } from "../../../lib/chart/format.ts";
import { cn } from "../../../lib/cn";

/** the result as the spec asks to draw it: its ranking settings and pathway applied, or the reason they cannot be */
function arranged(spec: any, v: any): any {
  if (!v?.pathwaymap) return v;
  // the counts came back even when the run's own settings were refused, so settings the document has since fixed draw
  try { return { ...v, error: undefined, pathwaymap: { ...v.pathwaymap, ...arrangeFor(v.pathwaymap, spec) } }; }
  catch (e) { return { ...v, error: (e as Error).message }; }
}

/** the ranking settings: applied in the browser, so they sit in the toolbar's view zone */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const pancanOnly = spec.pancanOnly !== false;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">view</span>
        <label className="tbfield" data-tip="rank pathways by how many query genes they hold, or by that number as a share of their gene nodes (PathwayMapper's two rankings)">
          rank by <OptionSelect value={spec.rank === "percent" ? "percent" : "count"} disabled={busy} onValueChange={(x) => patch({ rank: x === "percent" ? "percent" : undefined })}>
            <option value="count">match count</option><option value="percent">match %</option>
          </OptionSelect>
        </label>
        <label className="chk" data-tip="count each matched gene by its altered % rather than as one (PathwayMapper's “Consider alteration frequency”)">
          <Checkbox checked={spec.byFrequency === true} disabled={busy} onCheckedChange={(on) => patch({ byFrequency: on === true ? true : undefined })} /> weight by altered %
        </label>
        <label className="chk" data-tip="list only the ten TCGA PanCanAtlas pathways (Sanchez-Vega et al. 2018), as the portal does by default; untick for all 55 of PathwayMapper's library">
          <Checkbox checked={pancanOnly} disabled={busy} onCheckedChange={(on) => {
            const only = on === true;
            // a pathway the narrower list leaves out goes back to the ranking's first, as PathwayMapper does
            const drop = only && spec.pathway != null && !pathwayNamed(String(spec.pathway))?.pancan;
            patch({ pancanOnly: only ? undefined : false, ...(drop ? { pathway: undefined } : {}) });
          }} /> PanCanAtlas pathways only
        </label>
      </div>
    </div>
  );
}

/** the ranked pathways, one radio each: the one checked is drawn */
function Ranking({ c, view }: { c: KindCardCtx; view: any }) {
  const pm = view.pathwaymap;
  const pick = (name: string) => c.patch({ pathway: name });
  return (
    <div className="max-h-[560px] overflow-y-auto">
      <table className="vtable">
        <thead><tr>
          <th className="l">pathway</th>
          <th className="r" data-tip={pm.settings.byFrequency ? "the matched genes' altered %, summed" + (pm.settings.rank === "percent" ? ", × matched ÷ gene nodes" : "") : pm.settings.rank === "percent" ? "query genes held, as a % of its gene nodes" : "query genes held"}>score</th>
          <th className="l">genes matched</th>
        </tr></thead>
        <tbody>{pm.ranked.map((r: any) => {
          const on = r.name === pm.pathway;
          return (
            <tr key={r.name} className={cn("ruled", on && "bg-accent")}>
              <td>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name={"pathway-" + c.vi} checked={on} onChange={() => pick(r.name)} />
                  <span className={on ? "bold" : undefined}>{r.name}</span>
                </label>
              </td>
              <td className="r tnum">{fmtNum(r.score)}</td>
              <td className="font-mono text-sm">{r.matched.join(" ") || <span className="text-muted-foreground">none</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function body(c: KindCardCtx) {
  const view = arranged(c.spec, c.v);
  if (!view?.pathwaymap) return null;
  if (view.error) return <p className="note">{view.error}</p>;
  return (
    <div data-tw className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[3_1_560px]"><ViewFigure v={view} /></div>
      <div className="min-w-0 flex-[1_1_300px]"><Ranking c={c} view={view} /></div>
    </div>
  );
}

export const pathwaymapUi: KindUi<"pathwaymap"> = {
  kind: "pathwaymap",
  label: "Pathway diagram (PathwayMapper)",
  category: "alterations",
  title: "Pathways",
  genes: true,
  maxCohorts: 4,
  defaults: (k) => ({ kind: "pathwaymap", genes: k.genes.slice(0, 10) }),
  sub: (spec) => (spec.pancanOnly === false ? "PathwayMapper's 55 pathways" : "TCGA PanCanAtlas pathways") + ", ranked by " + (spec.rank === "percent" ? "match %" : "match count") + (spec.byFrequency ? " × altered %" : ""),
  Controls,
  body,
  figureView: arranged,
};
