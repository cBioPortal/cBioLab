"use client";
// The assays view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
// A numeric profile's card is laid out as cBioPortal's generic-assay comparison tab.
import { Badge, type Col, PortalTable } from "../portal-bodies.tsx";
import { DrawAtWidth, ViewFigure } from "../figure.tsx";
import { PickVolcano, GroupFilter } from "../pick-volcano.tsx";
import { useSidePlot } from "../side-plot.ts";
import { Button } from "../../_ui/button";
import type { DrawnResultOf, ViewResultOf } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { assayEntitySvg, assaysVolcanoSvg, entityLabel } from "../../../lib/views/assays/figure.ts";
import { pDigits, portalP } from "../../../lib/chart/format.ts";
import { seriesStyle } from "../../../lib/chart/style";
import { useMemo, useState } from "react";

// ---- Generic assays: one row per entity, and the picked entity per group --------------------

type AsRow = NonNullable<ViewResultOf<"assays">["assays"]>["rows"][number];
type As = NonNullable<ViewResultOf<"assays">["assays"]>;

/** what the portal titles a generic assay's entity column: its own word for methylation, else the type's display name */
const ASSAY_TITLE: Record<string, string> = { METHYLATION: "Gene / Probe", TREATMENT_RESPONSE: "Treatment Response", MUTATIONAL_SIGNATURE: "Mutational Signature",
  ARMLEVEL_CNA: "Arm-level CNA", LOH_HLA: "HLA LOH" };
const entityTitle = (r: As) => ASSAY_TITLE[r.assayType] || (r.assayType || "Entity").split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
/** the portal's two-decimal log ratio, past ±10 written as a bound */
const ratio = (x: number) => x < -10 ? "<-10" : x > 10 ? ">10" : x.toFixed(2);

/**
 * A numeric profile laid out as cBioPortal's generic-assay comparison tab: the volcano (two
 * groups) and the picked entity's values per group side by side, then the entity table with the
 * "High in ..." filter and "Significant only", the portal's columns and tips word for word. The
 * picked entity is the view's (`entity`, which re-runs nothing); the volcano's drag selection and
 * the table's filters are this browser's.
 */
function NumericBody({ v, docJson, pickedEntity, setPicked }: {
  v: DrawnResultOf<"assays">; docJson?: () => string; pickedEntity: string | null; setPicked: (entity: string) => void;
}) {
  const r = v.assays;
  const [A, B] = r.groups;
  const two = r.groups.length === 2 && !!r.grid;
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const shown = useMemo(() => new Set(r.groups.filter((g) => !hidden.has(g))), [r, hidden]);
  const picked = pickedEntity ? r.rows.find((e) => e.entity === pickedEntity) || null : null;
  const boxEntity = picked?.entity || pickedEntity;
  const rows = useMemo(() => r.rows.filter((e) => shown.has(e.higherIn) && (!selected || selected.has(e.entity))), [r, shown, selected]);
  const plot = useSidePlot(docJson, r.groups, boxEntity ? { kind: "plot", unit: r.unit === "patients" ? "patient" : "sample", x: { source: "cohort" },
    y: { source: "profile", profile: r.profileType, entity: boxEntity } } : null);
  const color = (g: string) => seriesStyle(Math.max(0, r.groups.indexOf(g))).color;
  const cols: Col<AsRow>[] = [
    { key: "name", label: entityTitle(r), value: (e) => e.name, render: (e) => <strong>{entityLabel(e)}</strong>, title: entityTitle(r) },
    ...r.groups.map((name, i): Col<AsRow> => ({ key: "m" + i, label: "μ in " + name, num: true, title: "Mean of the listed entity in " + name,
      value: (e) => e.cells[i].mean ?? null, render: (e) => e.cells[i].mean == null ? "NA" : e.cells[i].mean!.toFixed(2) })),
    ...r.groups.map((name, i): Col<AsRow> => ({ key: "s" + i, label: "σ in " + name, num: true, title: "Standard deviation of the listed entity in " + name,
      value: (e) => e.cells[i].sd ?? null, render: (e) => e.cells[i].sd == null ? "NA" : e.cells[i].sd!.toFixed(2) })),
    ...(two ? [{ key: "lr", label: "Log Ratio", num: true, value: (e: AsRow) => e.diff ?? null, render: (e: AsRow) => ratio(e.diff ?? 0),
      title: "Log2 of ratio of mean in " + A + " to mean in " + B }] : []),
    { key: "p", label: "p-Value", num: true, value: (e) => e.p, render: (e) => portalP(e.p),
      title: two ? "Derived from Welch's two-sided t-test" : "Derived from one-way ANOVA" },
    { key: "q", label: "q-Value", num: true, value: (e) => e.q, render: (e) => <span style={{ fontWeight: e.q < 0.05 ? 700 : 400 }}>{portalP(e.q)}</span>, title: "Derived from Benjamini-Hochberg procedure" },
    { key: "in", label: "Higher in", value: (e) => e.higherIn, render: (e) => <Badge text={e.higherIn} color={e.q < 0.05 ? color(e.higherIn) : null} />,
      title: two ? "Log ratio > 0: Enriched in " + A + "\nLog ratio <= 0: Enriched in " + B + "\nq-Value < 0.05: Significant association" : "The group with the highest frequency" },
  ];
  return (
    <div className="pb" data-test="assays-body">
      <div className="pb-row">
        {two && <div className="pb-plot">
          <PickVolcano draw={(width) => assaysVolcanoSvg(r, { width }, { selected, picked: pickedEntity }) || ""} deps={[r, selected, pickedEntity]}
            onPick={setPicked} onSelect={setSelected} />
        </div>}
        <div className="pb-plot" data-test="assays-box">
          {!boxEntity && <div className={two ? "pb-placeholder" : "pb-hint"}>Click on an entity in the table to render this plot.</div>}
          {picked && <p className="meta">{entityLabel(picked)} · p-Value: {portalP(picked.p)} · q-Value: {portalP(picked.q)}</p>}
          {!picked && boxEntity && <p className="meta">{boxEntity} · not among the {r.rows.length.toLocaleString()} entities listed</p>}
          {!plot && boxEntity && <div className="loading-block"><span className="spinner" /> drawing {boxEntity} per group…</div>}
          {plot?.error && <p className="note">{plot.error}</p>}
          {plot?.view && <ViewFigure v={plot.view} min={320} />}
        </div>
      </div>
      <h3 className="mt-4 text-lg font-semibold">{r.profileName}</h3>
      {selected && <p className="meta">{selected.size.toLocaleString()} {selected.size === 1 ? "entity" : "entities"} selected on the volcano · <Button type="button" variant="link" size="inline" onClick={() => setSelected(null)}>show every entity</Button></p>}
      <PortalTable wide rows={rows} cols={cols} initialSort={{ key: "q" }} pageSize={20} search={(e) => e.name + " " + e.entity}
        selected={picked} onSelect={(e) => setPicked(e.entity)} filters={[{ label: "Significant only", test: (e) => e.q < 0.05 }]}
        bar={<GroupFilter groups={r.groups} shown={shown} onShown={(s) => setHidden(new Set(r.groups.filter((g) => !s.has(g))))} prefix="High in" tip="list the entities with the higher mean in these groups" />}
        note={r.tested > r.rows.length ? "the " + r.rows.length.toLocaleString() + " most significant of " + r.tested.toLocaleString() + " entities tested" : undefined} />
    </div>
  );
}

/** a categorical profile: one row per entity, and the picked entity's mix of values per group */
function CategoricalBody({ v }: { v: DrawnResultOf<"assays"> }) {
  const r = v.assays;
  const [sel, setSel] = useState<AsRow | null>(null);
  const picked = sel && r.rows.includes(sel) ? sel : r.rows[0] || null;
  const color = (g: string) => seriesStyle(Math.max(0, r.groups.indexOf(g))).color;
  const cols: Col<AsRow>[] = [
    { key: "name", label: "Entity", value: (e) => e.name, render: (e) => <strong data-tip={e.entity}>{e.name}</strong> },
    ...r.groups.map((name, i): Col<AsRow> => ({ key: "n" + i, label: name + " n", num: true, value: (e) => e.cells[i].n })),
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

/** the profiles a data-set picker offers, by name: the current one's assay type first (the portal's tab lists only those), then (in the lab) every other */
function assayOptions(c: KindCardCtx, current: string): { profile: string; label: string }[] {
  const catalog = c.catalog || [];
  const info = (p: string) => catalog.find((x) => x.profile === p);
  const type = info(current)?.assayType;
  const same = catalog.filter((p) => p.type === "GENERIC_ASSAY" && type && p.assayType === type).sort((a, b) => (a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : 0));
  const out = same.map((p) => ({ profile: p.profile, label: p.name || p.profile }));
  if (!out.some((o) => o.profile === current)) out.unshift({ profile: current, label: info(current)?.name || current || "choose…" });
  for (const p of c.assays) if (!out.some((o) => o.profile === p)) out.push({ profile: p, label: (info(p)?.name || p) + (type ? " (another kind)" : "") });
  return out;
}

/** the assays view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const locked = c.locked || [];
  const options = assayOptions(c, spec.profileType || "");
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data set</span>
        <label className="tbfield" data-tip={"the generic-assay profile whose every entity is compared (" + (spec.profileType || "none") + ")"}>
          <OptionSelect value={spec.profileType || ""} disabled={busy} ariaLabel="data set" onValueChange={(v) => patch({ profileType: v, entity: undefined })}>
            {options.map((o) => <option key={o.profile} value={o.profile}>{o.label}</option>)}
          </OptionSelect>
        </label>
        {!locked.includes("minN") && <label className="tbfield" data-tip="an entity with fewer values than this in any cohort is counted but not tested">
          test with ≥ <OptionSelect value={String(spec.minN ?? 3)} disabled={busy} onValueChange={(v) => patch({ minN: Number(v) === 3 ? undefined : Number(v) })}>
            {[2, 3, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect> per cohort
        </label>}
      </div>
    </div>
  );
}

export const assaysUi: KindUi<"assays"> = {
  kind: "assays",
  label: "Generic assays (signatures, arm-level CNA, …)",
  category: "expression",
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
  // a new result (another profile, other cohorts) starts with nothing selected; the picked entity stays
  body: (c) => !c.v.assays ? null : c.v.assays.datatype === "numeric"
    ? <NumericBody key={JSON.stringify([c.v.assays.profileType, c.v.assays.groups, c.v.assays.tested])} v={c.v} docJson={c.docJson}
        pickedEntity={typeof c.spec.entity === "string" ? c.spec.entity : null} setPicked={(entity) => c.patch({ entity })} />
    : <CategoricalBody v={c.v} />,
};
