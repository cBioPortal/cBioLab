"use client";
// The genome view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the genome view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="bin width along the genome; a bin takes the value of the segment over its midpoint, so a narrower bin catches a narrower event">
          bins <OptionSelect value={String(spec.binMb ?? 2)} disabled={busy} onValueChange={(v) => patch({ binMb: Number(v) })}>
            {[1, 2, 5, 10, 20].map((b) => <option key={b} value={b}>{b} Mb</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="the |log2 segment mean| at or past which a bin counts as gained or lost">
          threshold <OptionSelect value={String(spec.threshold ?? 0.2)} disabled={busy} onValueChange={(v) => patch({ threshold: Number(v) })}>
            {[0.1, 0.2, 0.3, 0.5, 1].map((t) => <option key={t} value={t}>±{t}</option>)}
          </OptionSelect>
        </label>
        <label className="chk" title="chromosome X's log ratio mostly records sex against the reference, so it is off by default">
          <Checkbox checked={spec.includeX === true} disabled={busy} onCheckedChange={(on) => patch({ includeX: (on === true) || undefined })} /> chrX
        </label>
      </div>
    </div>
  );
}

export const genomeUi: KindUi<"genome"> = {
  kind: "genome",
  label: "Genome-wide copy number",
  category: "copynumber",
  title: "Genome-wide copy number",
  maxCohorts: 4,
  sub: (_spec, v) => v.genome ? v.genome.build + ", " + v.genome.binMb + " Mb bins, from segments" : "from copy-number segments",
  Controls,
};
