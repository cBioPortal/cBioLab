"use client";
// The mutations view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { AnnotationBadge } from "../portal-bodies.tsx";
import { DataTable, specQuery } from "../../_table/DataTable.tsx";
import { portalDuplicatesNote } from "../../../lib/chart/format.ts";
import { DraftInput } from "./parts.tsx";
import { sampleHref } from "../../portal/cohort-navigation.ts";
import { useStemHover } from "../../_lollipop/stem-hover.ts";
import { rowAtStem } from "../../../lib/lollipop.ts";
import { clinicalCellText, mutationTableUnit, vafEmptyTip } from "../../../lib/mutation-cell-text.ts";
import type { DrawnResultOf, TableQuery } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { variantTypeColor, variantTypeTip, copyNumberColor, copyNumberTip,
  validationStatusCell, exonCell, VALIDATION_STATUS_STYLE } from "../../../lib/mutation-type.ts";
import { ClinvarCell, DbsnpCell, FunctionalImpactCell, MutationStatusCell, MutationTypeCell, FunctionalImpactHead, GnomadCell, HgvscCell, HgvsgCell, ProteinChangeCell, SignalCell, useCellTips } from "../mutation-cells.tsx";

// ---- Mutations: one gene's mutation table, on the shared table (app/_table/DataTable.tsx) ---------

function MutationsBody({ v, spec, vi, updating, docJson, onQuery }: { v: DrawnResultOf<"mutations">; spec: Record<string, unknown>; vi: number; updating: boolean; docJson?: () => string;
  onQuery: (q: TableQuery) => void }) {
  const t = v.mutations;
  const tips = useCellTips();
  // the row's mutation status, which its Protein Change cell tags as germline
  const statusAt = t.columns.findIndex((c) => c.id === "status");
  // the lollipop's stem under the pointer: its codon's rows are highlighted, as on the portal's table
  const hover = useStemHover();
  const posAt = t.columns.findIndex((c) => c.id === "proteinPos");
  // the clinical attributes' columns (MUT-COL-36), drawn as the portal's ClinicalAttributeColumnFormatter
  const attributes = new Set(t.columns.filter((c) => c.attribute).map((c) => c.id));
  return (
    <div className="pb">
      {tips.node}
      <DataTable t={t} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit={mutationTableUnit(t)} countNote={portalDuplicatesNote(t.duplicates, "mutation", "mutations")} {...(t.kept ? { kept: t.kept } : {})} onQuery={onQuery}
        pager="showMore"
        downloadFormat="table-tsv"
        num={(id, x) => id === "vafNormal" ? String(x) : x.toLocaleString()}
        hot={hover && posAt >= 0 ? (r) => rowAtStem(hover, t.gene, r.values[posAt]) : undefined}
        colHead={(id) => id === "functionalImpact" ? <FunctionalImpactHead show={tips.show} /> : null}
        cell={(id, x, r) => attributes.has(id) ? <ClinicalCell value={x} />
          : id === "annotation" && x ? <AnnotationBadge text={String(x)} />
          : id === "hgvsg" ? <HgvsgCell hgvsg={String(x ?? "")} detail={r.detail} show={tips.show} />
          : id === "hgvsc" ? <HgvscCell hgvsc={String(x ?? "")} detail={r.detail} />
          : id === "clinvar" ? <ClinvarCell detail={r.detail} show={tips.show} />
          : id === "signal" ? <SignalCell value={String(x ?? "")} detail={r.detail} show={tips.show} />
          : id === "gnomad" ? <GnomadCell detail={r.detail} show={tips.show} />
          : id === "dbsnp" ? <DbsnpCell rsid={String(x ?? "")} detail={r.detail} />
          : id === "functionalImpact" ? <FunctionalImpactCell detail={r.detail} show={tips.show} />
          : id === "mutationType" ? <MutationTypeCell raw={x == null ? "" : String(x)} />
          : id === "proteinChange" ? <ProteinChangeCell change={String(x ?? "")} status={statusAt >= 0 ? String(r.values[statusAt] ?? "") : ""} />
          : id === "status" ? <MutationStatusCell raw={String(x ?? "")} />
          : id === "variantType" && x ? <span className="font-semibold" style={{ color: variantTypeColor(String(x)) }} data-tip={variantTypeTip(String(x)) ?? undefined}>{String(x)}</span>
          : id === "copyNumber" ? <CopyNumberCell label={String(x ?? "")} />
          // the portal's TableCellStatusIndicator NA: no text, its tooltip (TumorAlleleFreqColumnFormatter renderFunction)
          : id === "vaf" && vafEmptyTip(x) ? <span className="text-[var(--muted)]" data-tip={vafEmptyTip(x)!}>{"\u00a0"}</span>
          : id === "validationStatus" && x ? <ValidationStatus raw={String(x)} />
          : id === "exon" ? <span>{exonCell(String(x ?? ""))}</span>
          // as on the portal's table, a sample id opens that sample's page, in a new tab so the table keeps its place
          : id === "sample" ? (r.study && x ? <a className="mono" href={sampleHref(r.study, String(x))} target="_blank" rel="noreferrer"
            data-tip={"open sample " + x + "'s page"}>{x}</a> : <span className="mono">{x}</span>) : undefined} />
    </div>
  );
}

const CN_VALUE: Record<string, number> = { Amp: 2, Gain: 1, Diploid: 0, ShallowDel: -1, DeepDel: -2 };
/** Copy # as the portal draws it: the call's label in its colour, Diploid plain and small, none as an empty cell with a tooltip */
function CopyNumberCell({ label }: { label: string }) {
  const n = label in CN_VALUE ? CN_VALUE[label] : null;
  if (n == null) return <span className="text-[var(--muted)]" data-tip={copyNumberTip(null) ?? undefined}>{"\u00a0"}</span>;
  return <span className={n === 0 ? "text-xs" : "font-semibold"} style={{ color: copyNumberColor(n) }} data-tip={copyNumberTip(n) ?? undefined}>{label}</span>;
}

/** A clinical attribute's value, cut at 30 characters with the whole value as its tip; none an empty cell with the portal's "not available" tip */
function ClinicalCell({ value }: { value: unknown }) {
  const c = clinicalCellText(value);
  return c.text ? <span data-tip={c.tip ?? undefined}>{c.text}</span> : <span className="text-[var(--muted)]" data-tip={c.tip ?? undefined}>{"\u00a0"}</span>;
}

/** Validation Status as the portal draws it: V, W or U on its badge, any other text small and grey */
function ValidationStatus({ raw }: { raw: string }) {
  const c = validationStatusCell(raw);
  const style = VALIDATION_STATUS_STYLE[c.className];
  return c.className === "other" ? <span className="text-xs" style={style}>{c.text}</span>
    : <span className="font-semibold text-xs px-[5px]" style={style} data-tip={c.tip ?? undefined}>{c.text}</span>;
}

/** the mutations view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (c.locked || []).includes("gene") ? null : (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        {!(c.locked || []).includes("gene") && <label className="tbfield" data-tip="the gene whose mutations are listed">
          gene <DraftInput value={spec.gene || ""} disabled={busy} width="6rem" placeholder="KRAS" onCommit={(t) => patch({ gene: t.trim().toUpperCase() })} />
        </label>}

      </div>
    </div>
  );
}

export const mutationsUi: KindUi<"mutations"> = {
  kind: "mutations",
  label: "Mutation table (one gene)",
  category: "alterations",
  title: "Mutations",
  maxCohorts: 6,
  defaults: (known) => ({ kind: "mutations", gene: known.genes[0] || "TP53" }),
  sub: (spec, v) => (spec.gene || "no gene") + " · every mutation call" + (v.mutations ? " · " + v.mutations.total.toLocaleString() + " rows" : ""),
  Controls,
  body: (c) => c.v.mutations ? <MutationsBody v={c.v} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} onQuery={(q) => c.patch({ ...q })} /> : null,
  drawsOwnWaiting: true,
};
