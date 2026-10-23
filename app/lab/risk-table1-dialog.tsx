"use client";
// The risk model's Table 1: each risk group's clinical and genomic makeup, side by side, opened from
// the card's toolbar. Computed on the server with the model (lib/views/riskmodel/table1.ts) — the
// dialog sends the view with its draft `describe` and shows the counts that come back; no patient
// reaches the browser. The draft is the dialog's own (attributes and genes added or dropped re-run
// only this request, never the page), and is ephemeral until "Add to document" writes it into the
// view, so a table someone keeps is reproducible from the link.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisDoc } from "../../lib/types.ts";
import { fmtInt, fmtNum, fmtPct, pDigits } from "../../lib/svg-kit.ts";
import { TABLE1_MAX_ATTRIBUTES, TABLE1_MAX_GENES } from "../../lib/views/riskmodel/table1.ts";
import { api } from "./api.ts";
import { viewRequest } from "./use-analysis.ts";
import { PickMenu } from "./view-chrome.tsx";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { RemoveBadge } from "../_ui/remove-badge";
import { ErrorAlert } from "../_ui/error-alert";
import { TB, FIELD } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import type { RiskTable1, RiskTable1Row, RiskmodelResult } from "../../lib/views/riskmodel/types.ts";

type Describe = { attributes?: string[]; genes?: string[] };
/** a categorical row shows this many values; the rest are pooled into one disclosed "other" line */
const LEVELS_SHOWN = 8;
/** the dialog's attribute menu, open or shut (a viewport state, not the document's) */
const TABLE1_MENUS = new Map<string, boolean>();

const sameDescribe = (a: Describe | undefined, b: Describe | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The toolbar's button opening Table 1, every risk group side by side (it sits beside the groups button). */
export function RiskTable1Button({ vi, spec, m, busy, attrs, docJson, onPatch }: {
  vi: number; spec: { describe?: Describe }; m: RiskmodelResult | undefined; busy: boolean;
  attrs: { attribute: string; kind: string }[]; docJson?: () => string;
  onPatch: (p: { describe?: Describe }) => void;
}) {
  const [open, setOpen] = useState(false);
  const why = !m ? "waiting for the model: Table 1 describes its risk groups" : !docJson ? "no document to run Table 1 from" : null;
  return <>
    <Button variant="outline" size="sm" className={TB + " risktable1btn"} disabled={busy || !!why}
      title={why ?? "who is in each risk group: clinical values and mutation rates, the groups side by side"} onClick={() => setOpen(true)}>
      table 1
    </Button>
    {spec.describe && <span className="text-sm text-muted-foreground" title="this view's document names Table 1's rows, so a link reproduces it">· in the document</span>}
    {open && m && docJson && <RiskTable1Dialog vi={vi} saved={spec.describe} m={m} attrs={attrs} docJson={docJson}
      onPatch={onPatch} onClose={() => setOpen(false)} />}
  </>;
}

/** Table 1 for a draft `describe`: the view's own result when the draft is what the document holds, else this view run once more with it. */
function useTable1(vi: number, docJson: () => string, draft: Describe, saved: Describe | undefined, m: RiskmodelResult) {
  const fromResult = sameDescribe(draft, saved) && m.table1 ? m.table1 : null;
  const body = useMemo(() => {
    if (fromResult) return null;
    const doc = JSON.parse(docJson()) as AnalysisDoc;
    const one = viewRequest(doc, vi) as unknown as { views: Record<string, unknown>[] };
    return { ...one, views: [{ ...one.views[0], describe: draft }] };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the request is decided by the draft and the document as it stands
  }, [JSON.stringify(draft), fromResult, vi]);
  const q = useQuery<RiskTable1, Error>({
    queryKey: ["risk-table1", JSON.stringify(body)],
    enabled: body != null,
    queryFn: async ({ signal }) => {
      const res = await api.analysis(body as never, { query: "?oncoprint=spec", signal });
      const j = await res.json();
      const v = j.views?.[0];
      if (j.error || v?.error) throw new Error(j.error || v.error);
      if (!v?.riskmodel?.table1) throw new Error("the view returned no Table 1");
      return v.riskmodel.table1 as RiskTable1;
    },
  });
  return fromResult ? { table: fromResult, loading: false, error: null, retry: () => {} }
    : { table: q.data ?? null, loading: q.isFetching, error: q.error ? q.error.message : null, retry: () => { void q.refetch(); } };
}

function RiskTable1Dialog({ vi, saved, m, attrs, docJson, onPatch, onClose }: {
  vi: number; saved: Describe | undefined; m: RiskmodelResult; attrs: { attribute: string; kind: string }[]; docJson: () => string;
  onPatch: (p: { describe?: Describe }) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Describe>(saved ?? {});
  // a group's column, marked by clicking its header (a reading aid, kept in the dialog alone)
  const [focus, setFocus] = useState<number | null>(null);
  const [gene, setGene] = useState("");
  const [note, setNote] = useState("");
  const { table, loading, error, retry } = useTable1(vi, docJson, draft, saved, m);
  // what the table shows: the draft's lists, or the defaults the last answer resolved them to
  const attributes = draft.attributes ?? table?.describe.attributes ?? [];
  const genes = draft.genes ?? table?.describe.genes ?? [];
  const listsKnown = (draft.attributes && draft.genes) || table != null;
  const addGenes = () => {
    const asked = gene.split(/[\s,]+/).map((g) => g.trim()).filter(Boolean);
    if (!asked.length) return;
    const bad = asked.find((g) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(g));
    if (bad) { setNote("“" + bad + "” is not a gene symbol"); return; }
    const next = [...genes, ...asked.filter((g) => !genes.some((x) => x.toUpperCase() === g.toUpperCase()))];
    if (next.length > TABLE1_MAX_GENES) { setNote("Table 1 takes at most " + TABLE1_MAX_GENES + " genes; this would make " + next.length); return; }
    setNote(""); setGene(""); setDraft({ ...draft, attributes, genes: next });
  };
  const inDoc = saved != null && table != null && sameDescribe(saved, table.describe);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-tw className="risktable1dialog gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-base">Table 1: who is in each risk group</DialogTitle>
          <DialogDescription className="text-sm">
            The patients of each group ({m.reportedOn === "validation half" ? "the validation half" : "held-out scores"}), their clinical values and mutation rates, tested across the groups.
            Rows marked <i>in the model</i> or <i>outcome</i> differ between groups by construction, so they get no q-value.
          </DialogDescription>
        </DialogHeader>
        <div className="viewtb risktable1-tb">
          <div className="tbz"><span className="tbl">rows</span>
            <PickMenu label="attributes" title={"clinical attributes Table 1 describes (at most " + TABLE1_MAX_ATTRIBUTES + ")"} menuId={"risk-t1:" + vi} menuStore={TABLE1_MENUS}
              options={attrs.map((a) => ({ value: a.attribute, label: a.attribute, hint: a.kind === "num" ? "number" : "category" }))}
              chosen={attributes} max={TABLE1_MAX_ATTRIBUTES} busy={!listsKnown} loading={!attrs.length}
              onChange={(next) => { setNote(""); setDraft({ ...draft, genes, attributes: next }); }} />
            <Input aria-label="add genes" placeholder="add genes, e.g. KEAP1 TP53" className={FIELD + " w-48"} value={gene} disabled={!listsKnown}
              onChange={(e) => setGene(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGenes(); } }} />
            <Button type="button" variant="outline" size="sm" className={TB} disabled={!gene.trim() || !listsKnown} onClick={addGenes}>add</Button>
            <Button type="button" variant="outline" size="sm" className={TB} disabled={!draft.attributes && !draft.genes}
              title="the study's leading attributes and the genes the model kept most often" onClick={() => { setNote(""); setDraft({}); }}>defaults</Button>
          </div>
        </div>
        {genes.length > 0 && <div className="flex flex-wrap items-center gap-1.5" aria-label="genes">
          {genes.map((g) => <RemoveBadge key={g} label={g} onClick={() => setDraft({ ...draft, attributes, genes: genes.filter((x) => x !== g) })} />)}
        </div>}
        {note && <p className="text-sm text-destructive" role="alert">{note}</p>}
        <div className="relative min-h-40">
          {error && !loading ? <ErrorAlert><span>Table 1 could not be computed: {error} </span>
            <Button variant="link" size="inline" onClick={retry}>retry</Button></ErrorAlert>
            : table ? <Table1Grid t={table} focus={focus} onFocus={(gi) => setFocus(focus === gi ? null : gi)} /> : null}
          {loading && <div className="risktable1-wait absolute inset-0 flex flex-col gap-2 bg-card pt-2" role="status">
            <span className="waiting"><span className="spinner" /> {table ? "updating Table 1…" : "computing Table 1…"}</span>
            <div className="skeleton min-h-24 flex-1" />
          </div>}
        </div>
        {table && <Table1Notes t={table} />}
        <DialogFooter className="items-center">
          {saved && <Button type="button" variant="ghost" className="mr-auto risktable1remove" title="Table 1 stays a dialog of this page, not part of the document"
            onClick={() => onPatch({ describe: undefined })}>Remove from document</Button>}
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button type="button" className="risktable1add" disabled={!table || loading || inDoc}
            title={inDoc ? "the document names these rows" : "write these rows into the view, so the link and the figure's caption carry Table 1"}
            onClick={() => table && onPatch({ describe: table.describe })}>{inDoc ? "In the document" : saved ? "Update document" : "Add to document"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ROLE_TITLE: Record<string, string> = {
  "in the model": "the score is built from this, so the groups differ in it by construction — not a finding; no q-value",
  outcome: "the groups are cut to differ in survival, so they differ in this by construction — not a finding; no q-value",
  stratum: "the model's stratum: each value has its own baseline hazard, and the score has no term for it, so a difference here is a real description",
};

function Table1Grid({ t, focus, onFocus }: { t: RiskTable1; focus: number | null; onFocus: (gi: number) => void }) {
  const col = (gi: number) => cn("px-2 py-1 text-right tabular-nums", gi === focus && "bg-accent/60");
  const share = (n: number, of: number) => of ? fmtPct(100 * n / of) : "–";
  const stat = (r: Exclude<RiskTable1Row, { kind: "skipped" }>) => <>
    <td className="px-2 py-1 text-right tabular-nums">{r.p == null ? <span className="text-muted-foreground" title={r.untested}>not tested</span> : pDigits(r.p)}</td>
    <td className="px-2 py-1 text-right font-semibold tabular-nums">{r.q == null ? "—" : pDigits(r.q)}</td>
    <td className="px-2 py-1 text-sm text-muted-foreground">{r.role && <i title={ROLE_TITLE[r.role]}>{r.role}</i>}
      {r.kind !== "num" && r.minExpected != null && r.minExpected < 5 && <span title="the smallest expected count is under 5, where χ² is a poor approximation"> sparse</span>}</td>
  </>;
  const lines: React.ReactNode[] = [];
  for (const r of t.rows) {
    if (r.kind === "skipped") {
      lines.push(<tr key={"s:" + r.name} className="border-t border-border"><th scope="row" className="px-2 py-1 text-left font-semibold">{r.name}</th>
        <td colSpan={t.groups.length + 3} className="px-2 py-1 text-sm text-muted-foreground">set aside: {r.skipped}</td></tr>);
      continue;
    }
    if (r.kind === "gene") {
      lines.push(<tr key={"g:" + r.name} className="border-t border-border">
        <th scope="row" className="px-2 py-1 text-left font-semibold" title={"patients with " + r.name + " mutated (" + (t.measure === "driver" ? "OncoKB drivers" : "any mutation") + ") over those whose panels cover it"}>{r.name} <span className="font-normal text-muted-foreground">mutated</span></th>
        {r.perGroup.map((c, gi) => <td key={gi} className={col(gi)} title={c.notProfiled ? fmtInt(c.notProfiled) + " not profiled: their panels do not cover " + r.name : undefined}>
          {fmtInt(c.altered)}/{fmtInt(c.profiled)} ({share(c.altered, c.profiled)}){c.notProfiled > 0 && <span className="text-muted-foreground"> · {fmtInt(c.notProfiled)} n.p.</span>}</td>)}
        {stat(r)}</tr>);
      continue;
    }
    if (r.kind === "num") {
      lines.push(<tr key={"n:" + r.name} className="border-t border-border">
        <th scope="row" className="px-2 py-1 text-left font-semibold">{r.name} <span className="font-normal text-muted-foreground">median [IQR]</span></th>
        {r.perGroup.map((c, gi) => <td key={gi} className={col(gi)} title={fmtInt(c.n) + " with a value" + (c.missing ? ", " + fmtInt(c.missing) + " without" : "")}>
          {c.median == null ? "–" : fmtNum(c.median) + " [" + fmtNum(c.q1!) + "–" + fmtNum(c.q3!) + "]"}</td>)}
        {stat(r)}</tr>);
      continue;
    }
    const recorded = t.groups.map((_, gi) => r.levels.reduce((s, l) => s + l.counts[gi], 0));
    const shown = r.levels.length > LEVELS_SHOWN + 1 ? r.levels.slice(0, LEVELS_SHOWN) : r.levels;
    const rest = r.levels.slice(shown.length);
    lines.push(<tr key={"c:" + r.name} className="border-t border-border">
      <th scope="row" className="px-2 pt-1 text-left font-semibold" colSpan={t.groups.length + 1}>{r.name}
        {r.multiValued > 0 && <span className="font-normal text-muted-foreground" title="counted under their first sample's value"> · {fmtInt(r.multiValued)} with samples that differ</span>}</th>
      {stat(r)}</tr>);
    const level = (key: string, label: React.ReactNode, counts: number[]) => <tr key={key}>
      <td className="py-0.5 pr-2 pl-5 text-sm">{label}</td>
      {counts.map((n, gi) => <td key={gi} className={col(gi)}>{fmtInt(n)} ({share(n, recorded[gi])})</td>)}<td colSpan={3} /></tr>;
    shown.forEach((l) => lines.push(level("c:" + r.name + ":" + l.value, l.value, l.counts)));
    if (rest.length) lines.push(level("c:" + r.name + ":other", <i>other ({rest.length} values)</i>, t.groups.map((_, gi) => rest.reduce((s, l) => s + l.counts[gi], 0))));
    if (r.missing.some((x) => x > 0)) lines.push(<tr key={"c:" + r.name + ":missing"}><td className="py-0.5 pr-2 pl-5 text-sm text-muted-foreground">not recorded</td>
      {r.missing.map((n, gi) => <td key={gi} className={cn(col(gi), "text-muted-foreground")}>{fmtInt(n)}</td>)}<td colSpan={3} /></tr>);
  }
  return <div className="max-h-[60vh] overflow-auto">
    <table className="risktable1 w-full border-collapse text-sm">
      <thead className="sticky top-0 bg-card">
        <tr>
          <th scope="col" className="px-2 py-1 text-left">Row</th>
          {t.groups.map((g, gi) => <th key={g.name} scope="col" className={cn("px-2 py-1 text-right", gi === focus && "bg-accent/60")}>
            <Button variant="link" size="inline" className="font-semibold text-foreground" title={gi === focus ? "unmark this group's column" : "mark this group's column"} onClick={() => onFocus(gi)}>{g.name}</Button>
            <div className="font-normal text-muted-foreground">{fmtInt(g.n)} patients</div></th>)}
          <th scope="col" className="px-2 py-1 text-right">p</th>
          <th scope="col" className="px-2 py-1 text-right">q</th>
          <th scope="col" className="px-2 py-1"><span className="sr-only">note</span></th>
        </tr>
      </thead>
      <tbody>{lines}</tbody>
    </table>
  </div>;
}

function Table1Notes({ t }: { t: RiskTable1 }) {
  return <div className="flex flex-col gap-1 text-sm text-muted-foreground">
    <p>A category's share is of the patients with a value; a gene's, of the patients whose mutation panels cover it (n.p.: not profiled, never counted as unmutated); mutations counted as the model does ({t.measure === "driver" ? "OncoKB drivers" : "any mutation"}).
      χ² for categories and genes, Kruskal–Wallis for numbers; q-values Benjamini–Hochberg over the {t.tested} open rows.
      {t.defaults.attributes && " Attributes: the model's stratum and covariates, then the study's leading attributes that describe these patients."}
      {t.defaults.genes && " Genes: those the model kept most often."}</p>
    {t.omitted.length > 0 && <p>Left out of the default attributes: {t.omitted.map((o) => o.name + " (" + o.why + ")").join("; ")}.</p>}
  </div>;
}
