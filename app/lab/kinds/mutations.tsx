"use client";
// The mutations view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { AnnotationBadge } from "../portal-bodies.tsx";
import { DataTable, specQuery } from "../../_table/DataTable.tsx";
import { portalDuplicatesNote } from "../../../lib/chart/format.ts";
import { DraftInput } from "./parts.tsx";
import { sampleHref } from "../../portal/cohort-navigation.ts";
import type { DrawnResultOf, TableQuery } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { mutationTypeLabel, mutationTypeColor, mutationTypeTip, variantTypeColor, variantTypeTip, copyNumberColor, copyNumberTip,
  validationStatusCell, exonCell, VALIDATION_STATUS_STYLE } from "../../../lib/mutation-type.ts";
import { ClinvarCell, DbsnpCell, FunctionalImpactCell, FunctionalImpactHead, GnomadCell, HgvscCell, HgvsgCell, SignalCell, useCellTips } from "../mutation-cells.tsx";

// ---- Mutations: one gene's mutation table, on the shared table (app/_table/DataTable.tsx) ---------

function MutationsBody({ v, spec, vi, updating, docJson, onQuery }: { v: DrawnResultOf<"mutations">; spec: Record<string, unknown>; vi: number; updating: boolean; docJson?: () => string;
  onQuery: (q: TableQuery) => void }) {
  const t = v.mutations;
  const tips = useCellTips();
  return (
    <div className="pb">
      {tips.node}
      <DataTable t={t} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit={t.gene + " mutations"} countNote={portalDuplicatesNote(t.duplicates, "mutation", "mutations")} onQuery={onQuery}
        num={(id, x) => id === "vaf" ? x.toFixed(2) : id === "vafNormal" ? String(x) : x.toLocaleString()}
        colHead={(id) => id === "functionalImpact" ? <FunctionalImpactHead show={tips.show} /> : null}
        cell={(id, x, r) => id === "annotation" && x ? <AnnotationBadge text={String(x)} />
          : id === "hgvsg" ? <HgvsgCell hgvsg={String(x ?? "")} detail={r.detail} show={tips.show} />
          : id === "hgvsc" ? <HgvscCell hgvsc={String(x ?? "")} detail={r.detail} />
          : id === "clinvar" ? <ClinvarCell detail={r.detail} show={tips.show} />
          : id === "signal" ? <SignalCell value={String(x ?? "")} detail={r.detail} show={tips.show} />
          : id === "gnomad" ? <GnomadCell detail={r.detail} show={tips.show} />
          : id === "dbsnp" ? <DbsnpCell rsid={String(x ?? "")} detail={r.detail} />
          : id === "functionalImpact" ? <FunctionalImpactCell detail={r.detail} show={tips.show} />
          : id === "mutationType" ? <MutationTypeCell raw={x == null ? "" : String(x)} />
          : id === "variantType" && x ? <span className="font-semibold" style={{ color: variantTypeColor(String(x)) }} data-tip={variantTypeTip(String(x)) ?? undefined}>{String(x)}</span>
          : id === "copyNumber" ? <CopyNumberCell label={String(x ?? "")} />
          : id === "validationStatus" && x ? <ValidationStatus raw={String(x)} />
          : id === "exon" ? <span>{exonCell(String(x ?? ""))}</span>
          // as on the portal's table, a sample id opens that sample's page, in a new tab so the table keeps its place
          : id === "sample" ? (r.study && x ? <a className="mono" href={sampleHref(r.study, String(x))} target="_blank" rel="noreferrer"
            data-tip={"open sample " + x + "'s page"}>{x}</a> : <span className="mono">{x}</span>) : undefined} />
    </div>
  );
}

/** Mutation Type as the portal draws it: the label in its colour, the stored text as tooltip where it differs */
function MutationTypeCell({ raw }: { raw: string }) {
  const label = mutationTypeLabel(raw);
  const bold = ["Missense", "Nonsense", "Splice", "IF del", "Fusion", "Silent"].includes(label) || label === raw;
  return <span className={bold ? "font-semibold" : undefined} style={{ color: mutationTypeColor(raw) }} data-tip={mutationTypeTip(raw) ?? undefined}>{label}</span>;
}

const CN_VALUE: Record<string, number> = { Amp: 2, Gain: 1, Diploid: 0, ShallowDel: -1, DeepDel: -2 };
/** Copy # as the portal draws it: the call's label in its colour, Diploid plain and small, none as an empty cell with a tooltip */
function CopyNumberCell({ label }: { label: string }) {
  const n = label in CN_VALUE ? CN_VALUE[label] : null;
  if (n == null) return <span className="text-[var(--muted)]" data-tip={copyNumberTip(null) ?? undefined}>{"\u00a0"}</span>;
  return <span className={n === 0 ? "text-xs" : "font-semibold"} style={{ color: copyNumberColor(n) }} data-tip={copyNumberTip(n) ?? undefined}>{label}</span>;
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
