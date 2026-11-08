"use client";
// The diffexpr view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
// The card lays the view out as cBioPortal's group-comparison expression tabs do (mRNA, Protein,
// DNA Methylation): the volcano (two groups) and the picked gene's values per group side by side,
// then every listed gene in a table. The picked gene is the view's (`gene`, which re-runs nothing); the
// volcano's drag selection and the table's filters are this browser's (invariant 9).
import { useMemo, useState } from "react";
import { Checkbox } from "../../_ui/checkbox";
import { Button } from "../../_ui/button";
import { PickVolcano, GroupFilter } from "../pick-volcano.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { Badge, type Col, PortalTable } from "../portal-bodies.tsx";
import { DrawAtWidth, ViewFigure } from "../figure.tsx";
import { useSidePlot } from "../side-plot.ts";
import type { DrawnResultOf, ViewResultOf } from "../../../lib/types";
import type { ProfileInfo } from "../../../lib/profile-catalog.ts";
import { diffexprVolcanoSvg, diffexprGseaSvg } from "../../../lib/views/diffexpr/figure.ts";
import { portalP } from "../../../lib/chart/format.ts";
import { seriesStyle } from "../../../lib/chart/style";

type DeGene = NonNullable<ViewResultOf<"diffexpr">["diffexpr"]>["points"][number];
type De = NonNullable<ViewResultOf<"diffexpr">["diffexpr"]>;

/** the portal's two-decimal log ratio, past ±10 written as a bound */
const ratio = (x: number) => x < -10 ? "<-10" : x > 10 ? ">10" : x.toFixed(2);
const methylation = (d: De) => d.profileKind === "METHYLATION" || /methylation/i.test(d.profileType);

function DiffexprBody({ v, docJson, pickedGene, setPicked }: {
  v: DrawnResultOf<"diffexpr">; docJson?: () => string; pickedGene: string | null; setPicked: (gene: string) => void;
}) {
  const d = v.diffexpr;
  const [A, B] = d.groups;
  const two = d.groups.length === 2;
  const meth = methylation(d), word = meth ? "methylation" : "expression";
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const shown = useMemo(() => new Set(d.groups.filter((g) => !hidden.has(g))), [d, hidden]);
  const picked = pickedGene ? d.points.find((g) => g.gene === pickedGene) || null : null;
  const boxGene = picked?.gene || pickedGene;
  // the group with the highest mean; with two, the side of the difference (a tie goes to the second, as the portal's)
  const higherIn = (g: DeGene) => two ? ((g.effect ?? 0) > 0 ? A : B) : d.groups[g.mean.indexOf(Math.max(...g.mean))];
  const rows = useMemo(() => d.points.filter((g) => shown.has(higherIn(g)) && (!selected || selected.has(g.gene))), [d, shown, selected]);   // eslint-disable-line react-hooks/exhaustive-deps
  const plot = useSidePlot(docJson, d.groups, boxGene ? { kind: "plot", unit: "sample", x: { source: "cohort" },
    y: { source: "profile", profile: d.profileType, gene: boxGene, ...(d.log2 ? { log: true } : {}) } } : null);
  const color = (g: string) => seriesStyle(Math.max(0, d.groups.indexOf(g))).color;
  // the portal's column tips, word for word
  const scale = meth ? "" : "log2 ";
  const cols: Col<DeGene>[] = [
    { key: "gene", label: "Gene", value: (g) => g.gene, render: (g) => <strong>{g.gene}</strong>, title: "Gene" },
    { key: "cytoband", label: "Cytoband", value: (g) => g.cytoband || null, title: "Cytoband" },
    ...d.groups.map((name, i): Col<DeGene> => ({ key: "m" + i, label: "μ in " + name, num: true, title: "Mean " + scale + word + " of the listed gene in " + name,
      value: (g) => g.mean[i], render: (g) => g.mean[i].toFixed(2) })),
    ...d.groups.map((name, i): Col<DeGene> => ({ key: "s" + i, label: "σ in " + name, num: true, title: "Standard deviation of " + scale + word + " of the listed gene in " + name,
      value: (g) => g.sd[i], render: (g) => g.sd[i].toFixed(2) })),
    ...(two ? [{ key: "lr", label: "Log2 Ratio", num: true, value: (g: DeGene) => g.effect ?? null, render: (g: DeGene) => ratio(g.effect ?? 0),
      title: "Log2 of ratio of " + (meth ? "" : "(unlogged) ") + "mean in " + A + " to " + (meth ? "" : "(unlogged) ") + "mean in " + B }] : []),
    { key: "p", label: "p-Value", num: true, value: (g) => g.p, render: (g) => portalP(g.p),
      title: two ? "Derived from Welch's two-sided t-test" : "Derived from one-way ANOVA" },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => <span style={{ fontWeight: g.q < 0.05 ? 700 : 400 }}>{portalP(g.q)}</span>, title: "Derived from Benjamini-Hochberg procedure" },
    { key: "in", label: "Higher " + word + " in", value: (g) => higherIn(g), render: (g) => <Badge text={higherIn(g)} color={g.q < 0.05 ? color(higherIn(g)) : null} />,
      title: two ? "Log ratio > 0: Enriched in " + A + "\nLog ratio <= 0: Enriched in " + B + "\nq-Value < 0.05: Significant association"
        : "The group with the highest " + word + " frequency" },
  ];
  const gsea = d.gsea && d.gsea.sets.length ? (width: number) => diffexprGseaSvg(v, { width }) : null;
  return (
    <div className="pb" data-test="diffexpr-body">
      <div className="pb-row">
        {two && <div className="pb-plot">
          <PickVolcano draw={(width) => diffexprVolcanoSvg(v, { width }, { selected, picked: pickedGene })} deps={[v, selected, pickedGene]}
            onPick={setPicked} onSelect={setSelected} />
        </div>}
        <div className="pb-plot" data-test="diffexpr-box">
          {!boxGene && <div className={two ? "pb-placeholder" : "pb-hint"}>Click on gene in the table to render this plot.</div>}
          {picked && <p className="meta">{picked.gene} · p-Value: {portalP(picked.p)} · q-Value: {portalP(picked.q)}</p>}
          {!picked && boxGene && <p className="meta">{boxGene} · not among the {d.points.length.toLocaleString()} genes listed</p>}
          {!plot && boxGene && <div className="loading-block"><span className="spinner" /> drawing {boxGene} per group…</div>}
          {plot?.error && <p className="note">{plot.error}</p>}
          {plot?.view && <ViewFigure v={plot.view} min={320} />}
        </div>
      </div>
      {gsea && <DrawAtWidth draw={gsea} deps={[v]} />}
      <h3 className="mt-4 text-lg font-semibold">{d.profileName || d.profileType}</h3>
      {selected && <p className="meta">{selected.size.toLocaleString()} gene{selected.size === 1 ? "" : "s"} selected on the volcano · <Button type="button" variant="link" size="inline" onClick={() => setSelected(null)}>show every gene</Button></p>}
      <PortalTable wide rows={rows} cols={cols} initialSort={{ key: "q" }} pageSize={20} search={(g) => g.gene + " " + (g.cytoband || "") + " " + higherIn(g)}
        selected={picked} onSelect={(g) => setPicked(g.gene)} filters={[{ label: "Significant only", test: (g) => g.q < 0.05 }]}
        bar={<GroupFilter groups={d.groups} shown={shown} onShown={(s) => setHidden(new Set(d.groups.filter((g) => !s.has(g))))} prefix={"High " + word + " in"}
          tip={"list the genes with the higher mean " + word + " in these groups"} />}
        note={d.tested > d.points.length ? "the " + d.points.length.toLocaleString() + " most significant of " + d.tested.toLocaleString() + " genes tested" : undefined} />
    </div>
  );
}

/** the profiles a data-set picker offers: the current profile's kind first, as the portal lists them, then (in the lab) every other */
function dataSets(c: KindCardCtx, current: string): { profile: string; label: string }[] {
  const catalog: ProfileInfo[] = c.catalog || [];
  const kind = catalog.find((p) => p.profile === current)?.type;
  // mRNA and protein leave out z-scores but merged_median_zscores, as the portal's filterAndSortProfiles; RNA-seq first
  const listed = (p: ProfileInfo) => p.profile === current || !(p.type === "MRNA_EXPRESSION" || p.type === "PROTEIN_LEVEL") ||
    /merged_median_zscores/i.test(p.profile) || !/zscores/i.test(p.profile);
  const same = catalog.filter((p) => kind && p.type === kind && listed(p))
    .sort((a, b) => Number(/rna_seq/i.test(b.profile)) - Number(/rna_seq/i.test(a.profile)) || (a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : 0));
  const out = same.map((p) => ({ profile: p.profile, label: p.name || p.profile }));
  if (!out.some((o) => o.profile === current)) out.unshift({ profile: current, label: current || "choose…" });
  for (const p of c.profiles) if (!out.some((o) => o.profile === p)) out.push({ profile: p, label: (catalog.find((x) => x.profile === p)?.name || p) + (kind ? " (another kind)" : "") });
  return out;
}

/** the diffexpr view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const options = dataSets(c, spec.profileType || "");
  const locked = c.locked || [];
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data set</span>
        <label className="tbfield" data-tip={"the molecular profile the cohorts are compared on (" + (spec.profileType || "none") + ")"}>
          <OptionSelect value={spec.profileType || ""} disabled={busy} ariaLabel="data set" onValueChange={(v) => patch({ profileType: v, log2: undefined })}>
            {options.map((o) => <option key={o.profile} value={o.profile}>{o.label}</option>)}
          </OptionSelect>
        </label>
        {!locked.includes("log2") && <label className="chk" data-tip="compare log2(v + 1) instead of the stored value; on by default for a non-z-score RNA-seq profile">
          <Checkbox checked={c.v.diffexpr ? !!c.v.diffexpr.log2 : spec.log2 === true} disabled={busy}
            onCheckedChange={(on) => patch({ log2: (on === true) })} /> log2
        </label>}
        {!locked.includes("geneSets") && (!c.v.diffexpr || c.v.diffexpr.groups.length === 2) && <label className="chk" data-tip="preranked GSEA against the 50 MSigDB Hallmark sets; untick to draw the volcano alone">
          <Checkbox checked={!(Array.isArray(spec.geneSets) && spec.geneSets.length === 0)} disabled={busy}
            onCheckedChange={(on) => patch({ geneSets: (on === true) ? undefined : [] })} /> enrichment
        </label>}
      </div>
    </div>
  );
}

export const diffexprUi: KindUi<"diffexpr"> = {
  kind: "diffexpr",
  label: "Differential expression + GSEA",
  category: "expression",
  title: "Differential expression",
  maxCohorts: 10,
  minCohorts: 2,
  why: (k) => !k.profiles.length ? "this study has no molecular profile to compare expression on" : null,
  defaults: (known) => {
    const profile = known.profiles.find((p) => /zscore/i.test(p) && /mrna|rna_seq/i.test(p))
      || known.profiles.find((p) => /mrna|rna_seq/i.test(p)) || known.profiles[0] || "";
    return { kind: "diffexpr", profileType: profile };
  },
  sub: (spec, v) => (v.diffexpr?.profileName || spec.profileType || "no profile") + (v.diffexpr ? (v.diffexpr.log2 ? ", log2(v+1)" : "") +
    (v.diffexpr.groups.length === 2 ? " · volcano, box plot and table" + (v.diffexpr.gsea ? ", GSEA" : "") : " · " + v.diffexpr.test + ", box plot and table") : ""),
  Controls,
  // a new result (another profile, other cohorts) starts with nothing selected; the picked gene stays
  body: (c) => c.v.diffexpr && c.v.diffexpr.tested
    ? <DiffexprBody key={JSON.stringify([c.v.diffexpr.profileType, c.v.diffexpr.groups, c.v.diffexpr.log2, c.v.diffexpr.tested])} v={c.v} docJson={c.docJson}
        pickedGene={typeof c.spec.gene === "string" ? c.spec.gene : null} setPicked={(gene) => c.patch({ gene })} /> : null,
};
