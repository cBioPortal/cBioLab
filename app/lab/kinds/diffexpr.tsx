"use client";
// The diffexpr view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
// The card lays the view out as cBioPortal's group-comparison expression tabs do (mRNA, Protein,
// DNA Methylation): the volcano and the picked gene's values per group side by side, then every
// listed gene in a table. The picked gene is the view's (`gene`, which re-runs nothing); the
// volcano's drag selection and the table's filters are this browser's (invariant 9).
import { useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "../../_ui/checkbox";
import { Button } from "../../_ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "../../_ui/dropdown-menu";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { Badge, type Col, PortalTable } from "../portal-bodies.tsx";
import { DrawAtWidth, ViewFigure } from "../figure.tsx";
import { useSidePlot } from "../side-plot.ts";
import type { DrawnResultOf, ViewResultOf } from "../../../lib/types";
import type { ProfileInfo } from "../../../lib/profile-catalog.ts";
import { diffexprVolcanoSvg, diffexprGseaSvg } from "../../../lib/views/diffexpr/figure.ts";
import { pDigits } from "../../../lib/chart/format.ts";
import { seriesStyle } from "../../../lib/chart/style";
import { TB } from "../../_ui/toolbar.ts";
import { cn } from "../../../lib/cn";

type DeGene = NonNullable<ViewResultOf<"diffexpr">["diffexpr"]>["points"][number];
type De = NonNullable<ViewResultOf<"diffexpr">["diffexpr"]>;

/** the portal's two-decimal ratio, past ±10 written as a bound */
const ratio = (x: number) => x < -10 ? "<-10" : x > 10 ? ">10" : x.toFixed(2);
const methylation = (d: De) => d.profileKind === "METHYLATION" || /methylation/i.test(d.profileType);
/** values on a log2 scale, whose difference of means is a log2 ratio: logged here, or stored so (protein levels, LOG2-VALUE profiles) */
const logScale = (d: De) => d.log2 || d.profileKind === "PROTEIN_LEVEL" || /log2/i.test(d.profileType);

/**
 * The volcano, its points picked by click and selected by dragging a box over them, as the
 * portal's: a click on a gene draws its box plot, a drag lists only the genes inside it in the
 * table, and a click off the points clears that.
 */
function Volcano({ v, picked, selected, onPick, onSelect }: {
  v: DrawnResultOf<"diffexpr">; picked: string | null; selected: Set<string> | null;
  onPick: (gene: string) => void; onSelect: (genes: Set<string> | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const at = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = at(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => { if (drag) { const p = at(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } };
  const up = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4) {
      // a click: on a point picks its gene, off the points clears the selection
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof SVGCircleElement && el.dataset.key) as SVGCircleElement | undefined;
      if (under) onPick(under.dataset.key!);
      else onSelect(null);
      return;
    }
    const r = box.current!.getBoundingClientRect();
    const [lx, hx] = [Math.min(d.x0, d.x1) + r.left, Math.max(d.x0, d.x1) + r.left];
    const [ly, hy] = [Math.min(d.y0, d.y1) + r.top, Math.max(d.y0, d.y1) + r.top];
    const inside = new Set<string>();
    box.current!.querySelectorAll<SVGCircleElement>("circle[data-key]").forEach((c) => {
      const b = c.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      if (cx >= lx && cx <= hx && cy >= ly && cy <= hy) inside.add(c.dataset.key!);
    });
    onSelect(inside.size ? inside : null);
  };
  return (
    <div ref={box} className="relative cursor-crosshair select-none touch-none" data-test="diffexpr-volcano"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <DrawAtWidth min={320} draw={(width) => diffexprVolcanoSvg(v, { width }, { selected, picked })} deps={[v, selected, picked]} />
      {drag && <div className="pointer-events-none absolute border border-[var(--accent)] bg-[var(--accent-soft)] opacity-60"
        style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />}
    </div>
  );
}

/** the groups whose higher genes the table lists, as the portal's "High expression in ..." */
function GroupFilter({ groups, shown, onShown, word }: { groups: string[]; shown: Set<string>; onShown: (s: Set<string>) => void; word: string }) {
  const label = shown.size === groups.length ? "High " + word + " in: all groups" : shown.size ? "High " + word + " in: " + [...shown].join(", ") : "High " + word + " in ...";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn(TB, "gap-1 font-normal")} data-tip={"list the genes with the higher mean " + word + " in these groups"}>
          {label}<ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {groups.map((g) => (
          // stays open, so both can be ticked in one go
          <DropdownMenuCheckboxItem key={g} checked={shown.has(g)} onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => { const n = new Set(shown); if (n.has(g)) n.delete(g); else n.add(g); onShown(n); }}>{g}</DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DiffexprBody({ v, docJson, pickedGene, setPicked }: {
  v: DrawnResultOf<"diffexpr">; docJson?: () => string; pickedGene: string | null; setPicked: (gene: string) => void;
}) {
  const d = v.diffexpr;
  const [A, B] = d.groups;
  const meth = methylation(d), word = meth ? "methylation" : "expression";
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const shown = useMemo(() => new Set(d.groups.filter((g) => !hidden.has(g))), [d, hidden]);
  const picked = pickedGene ? d.points.find((g) => g.gene === pickedGene) || null : null;
  const boxGene = picked?.gene || pickedGene;
  const higherIn = (g: DeGene) => g.effect > 0 ? A : B;
  const rows = useMemo(() => d.points.filter((g) => shown.has(higherIn(g)) && (!selected || selected.has(g.gene))), [d, shown, selected]);   // eslint-disable-line react-hooks/exhaustive-deps
  const plot = useSidePlot(docJson, d.groups, boxGene ? { kind: "plot", unit: "sample", x: { source: "cohort" },
    y: { source: "profile", profile: d.profileType, gene: boxGene, ...(d.log2 ? { log: true } : {}) } } : null);
  const color = (g: string) => seriesStyle(Math.max(0, d.groups.indexOf(g))).color;
  const scale = d.log2 ? "log2(v + 1) " : "";
  const what = meth ? "methylation (beta value)" : d.profileKind === "PROTEIN_LEVEL" ? "protein level" : "expression";
  const lr = logScale(d);
  const cols: Col<DeGene>[] = [
    { key: "gene", label: "Gene", value: (g) => g.gene, render: (g) => <strong>{g.gene}</strong>, title: "Gene" },
    { key: "cytoband", label: "Cytoband", value: (g) => g.cytoband || null, title: "Cytoband" },
    ...d.groups.map((name, i): Col<DeGene> => ({ key: "m" + i, label: "μ in " + name, num: true, title: "Mean " + scale + what + " of the listed gene in " + name,
      value: (g) => i ? g.meanB : g.meanA, render: (g) => (i ? g.meanB : g.meanA).toFixed(2) })),
    ...d.groups.map((name, i): Col<DeGene> => ({ key: "s" + i, label: "σ in " + name, num: true, title: "Standard deviation of " + scale + what + " of the listed gene in " + name,
      value: (g) => i ? g.sdB : g.sdA, render: (g) => (i ? g.sdB : g.sdA).toFixed(2) })),
    { key: "lr", label: lr ? "Log2 Ratio" : "Mean Difference", num: true, value: (g) => g.effect, render: (g) => ratio(g.effect),
      title: "Mean in " + A + " minus mean in " + B + (lr ? ", on log2 values: the log2 of the ratio of their (unlogged) means" : " (cBioPortal labels this Log2 Ratio; on " + d.profileType + "'s values it is a plain difference)") },
    { key: "p", label: "p-Value", num: true, value: (g) => g.p, render: (g) => pDigits(g.p), title: "Derived from Welch's two-sided t-test" },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => <span style={{ fontWeight: g.q < 0.05 ? 700 : 400 }}>{pDigits(g.q)}</span>, title: "Derived from Benjamini-Hochberg procedure" },
    { key: "in", label: "Higher " + word + " in", value: (g) => higherIn(g), render: (g) => <Badge text={higherIn(g)} color={g.q < 0.05 ? color(higherIn(g)) : null} />,
      title: (lr ? "Log ratio" : "Difference") + " > 0: enriched in " + A + "; ≤ 0: enriched in " + B + "; q-Value < 0.05: significant association" },
  ];
  const gsea = d.gsea && d.gsea.sets.length ? (width: number) => diffexprGseaSvg(v, { width }) : null;
  return (
    <div className="pb" data-test="diffexpr-body">
      <div className="pb-row">
        <div className="pb-plot">
          <Volcano v={v} picked={pickedGene} selected={selected} onPick={setPicked} onSelect={setSelected} />
        </div>
        <div className="pb-plot" data-test="diffexpr-box">
          {!boxGene && <div className="pb-placeholder">Click on a gene in the table or on the volcano to draw its values per group.</div>}
          {picked && <p className="meta">{picked.gene} · p-Value: {pDigits(picked.p)} · q-Value: {pDigits(picked.q)}</p>}
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
        bar={<GroupFilter groups={d.groups} shown={shown} onShown={(s) => setHidden(new Set(d.groups.filter((g) => !s.has(g))))} word={word} />}
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
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data set</span>
        <label className="tbfield" data-tip={"the molecular profile both cohorts are compared on (" + (spec.profileType || "none") + ")"}>
          <OptionSelect value={spec.profileType || ""} disabled={busy} ariaLabel="data set" onValueChange={(v) => patch({ profileType: v, log2: undefined })}>
            {options.map((o) => <option key={o.profile} value={o.profile}>{o.label}</option>)}
          </OptionSelect>
        </label>
        <label className="chk" data-tip="compare log2(v + 1) instead of the stored value; on by default for a non-z-score RNA-seq profile">
          <Checkbox checked={c.v.diffexpr ? !!c.v.diffexpr.log2 : spec.log2 === true} disabled={busy}
            onCheckedChange={(on) => patch({ log2: (on === true) })} /> log2
        </label>
        <label className="chk" data-tip="preranked GSEA against the 50 MSigDB Hallmark sets; untick to draw the volcano alone">
          <Checkbox checked={!(Array.isArray(spec.geneSets) && spec.geneSets.length === 0)} disabled={busy}
            onCheckedChange={(on) => patch({ geneSets: (on === true) ? undefined : [] })} /> enrichment
        </label>
      </div>
    </div>
  );
}

export const diffexprUi: KindUi<"diffexpr"> = {
  kind: "diffexpr",
  label: "Differential expression + GSEA",
  category: "expression",
  title: "Differential expression",
  maxCohorts: 2,
  minCohorts: 2,
  why: (k) => !k.profiles.length ? "this study has no molecular profile to compare expression on" : null,
  defaults: (known) => {
    const profile = known.profiles.find((p) => /zscore/i.test(p) && /mrna|rna_seq/i.test(p))
      || known.profiles.find((p) => /mrna|rna_seq/i.test(p)) || known.profiles[0] || "";
    return { kind: "diffexpr", profileType: profile };
  },
  sub: (spec, v) => (v.diffexpr?.profileName || spec.profileType || "no profile") + (v.diffexpr ? (v.diffexpr.log2 ? ", log2(v+1)" : "") + " · volcano, box plot and table" + (v.diffexpr.gsea ? ", GSEA" : "") : ""),
  Controls,
  // a new result (another profile, other cohorts) starts with nothing selected; the picked gene stays
  body: (c) => c.v.diffexpr && c.v.diffexpr.tested
    ? <DiffexprBody key={JSON.stringify([c.v.diffexpr.profileType, c.v.diffexpr.groups, c.v.diffexpr.log2, c.v.diffexpr.tested])} v={c.v} docJson={c.docJson}
        pickedGene={typeof c.spec.gene === "string" ? c.spec.gene : null} setPicked={(gene) => c.patch({ gene })} /> : null,
};
