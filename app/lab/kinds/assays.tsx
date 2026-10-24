"use client";
// The assays view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Badge, type Col, PortalTable } from "../portal-bodies.tsx";
import { DrawAtWidth } from "../figure.tsx";
import type { DrawnResultOf, ViewResultOf } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { assayEntitySvg } from "../../../lib/views/assays/figure.ts";
import { fmtNum } from "../../../lib/chart/format";
import { pDigits } from "../../../lib/chart/format.ts";
import { seriesStyle } from "../../../lib/chart/style";
import { useState } from "react";

// ---- Generic assays: one row per entity, and the picked entity per group --------------------

type AsRow = NonNullable<ViewResultOf<"assays">["assays"]>["rows"][number];

function AssaysBody({ v }: { v: DrawnResultOf<"assays"> }) {
  const r = v.assays;
  const [sel, setSel] = useState<AsRow | null>(null);
  const picked = sel && r.rows.includes(sel) ? sel : r.rows[0] || null;
  const color = (g: string) => seriesStyle(Math.max(0, r.groups.indexOf(g))).color;
  const numeric = r.datatype === "numeric";
  const cols: Col<AsRow>[] = [
    { key: "name", label: "Entity", value: (e) => e.name, render: (e) => <strong title={e.entity}>{e.name}</strong> },
    ...r.groups.flatMap((name, i): Col<AsRow>[] => numeric
      ? [{ key: "m" + i, label: name + " mean", num: true, value: (e) => e.cells[i].mean ?? null, render: (e) => e.cells[i].mean == null ? "—" : fmtNum(e.cells[i].mean!) },
         { key: "s" + i, label: name + " SD", num: true, value: (e) => e.cells[i].sd ?? null, render: (e) => e.cells[i].sd == null ? "—" : fmtNum(e.cells[i].sd!) }]
      : [{ key: "n" + i, label: name + " n", num: true, value: (e) => e.cells[i].n }]),
    { key: "p", label: "p-Value", num: true, value: (e) => e.p, render: (e) => pDigits(e.p) },
    { key: "q", label: "q-Value", num: true, value: (e) => e.q, render: (e) => <strong>{pDigits(e.q)}</strong> },
    { key: "in", label: "Higher in", value: (e) => e.higherIn, render: (e) => <Badge text={e.higherIn + (e.value ? " · " + e.value : "")} color={e.q < 0.05 ? color(e.higherIn) : null} /> },
  ];
  return (
    <div className="pb">
      <p className="meta">{r.profileName} · {r.test} · {r.tested.toLocaleString()} entities tested · {r.significant.toLocaleString()} at q &lt; 0.05</p>
      <div className="pb-row">
        <div>
          <PortalTable rows={r.rows} cols={cols} initialSort={{ key: "q" }} search={(e) => e.name + " " + e.entity} selected={picked} onSelect={setSel}
            filters={[{ label: "Significant only", test: (e) => e.q < 0.05 }]}
            note={r.tested > r.rows.length ? "the " + r.rows.length + " most significant of " + r.tested.toLocaleString() : undefined} />
        </div>
        {picked && <div className="pb-plot"><DrawAtWidth min={320} draw={(width) => assayEntitySvg(r, picked, { width })} deps={[r, picked]} /></div>}
      </div>
    </div>
  );
}

/** the assays view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the generic-assay profile whose every entity is compared">
          profile <OptionSelect value={spec.profileType || ""} disabled={busy} onValueChange={(v) => patch({ profileType: v })}>
            {!c.assays.includes(spec.profileType) && <option value={spec.profileType || ""}>{spec.profileType || "choose…"}</option>}
            {c.assays.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="an entity with fewer values than this in any cohort is counted but not tested">
          test with ≥ <OptionSelect value={String(spec.minN ?? 3)} disabled={busy} onValueChange={(v) => patch({ minN: Number(v) === 3 ? undefined : Number(v) })}>
            {[2, 3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect> per cohort
        </label>
      </div>
    </div>
  );
}

export const assaysUi: KindUi<"assays"> = {
  kind: "assays",
  label: "Generic assays (signatures, arm-level CNA, …)",
  title: "Generic assays",
  maxCohorts: 6,
  minCohorts: 2,
  why: (k) => !k.assays.length ? "this study has no generic-assay profiles (mutational signatures, arm-level copy number, …)" : null,
  defaults: (known) => {
    const profile = known.assays.find((p) => /signature/i.test(p) && /contribution/i.test(p)) || known.assays.find((p) => !/methylation/i.test(p)) || known.assays[0] || "";
    return { kind: "assays", profileType: profile };
  },
  sub: (spec, v) => (v.assays ? v.assays.profileName + " · " + v.assays.test : spec.profileType || "no profile chosen") + ", per " + (v.assays ? v.assays.unit.replace(/s$/, "") : "sample"),
  Controls,
  body: (c) => c.v.assays ? <AssaysBody v={c.v} /> : null,
};
