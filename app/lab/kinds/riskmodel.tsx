"use client";
// The riskmodel view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import { Choice, OptionSelect } from "../../_ui/choice.tsx";
import { DraftInput } from "./parts.tsx";
import { GearMenu } from "../../_ui/gear-menu";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { PickMenu } from "../view-chrome.tsx";
import { RISK_LABEL_ABOVE } from "../../../lib/views/riskmodel/figure.ts";
import { RiskGroupsButton } from "../risk-groups-dialog.tsx";
import { RiskTable1Button } from "../risk-table1-dialog.tsx";
import { Settings2 } from "lucide-react";

/** the risk model's covariate menus, open or shut, by view (a viewport state, not the document's) */
const RISK_MENUS = new Map<string, boolean>();

/** the runs the model settings offer (OncoCast recommends 50 or more) */
const RISK_RUN_STEPS = [5, 10, 20, 50];

const RISK_PENALTIES: [string, string][] = [["1", "lasso"], ["0.5", "elastic net"], ["0.1", "mostly ridge"]];

/**
 * The risk model's fitting settings, set once and rarely changed, behind the view's settings menu
 * (the sequence and course views' idiom) so the toolbar keeps to what a reader works with.
 */
function RiskModelSettings({ vi, spec, busy, patch }: { vi: number; spec: any; busy: boolean; patch: (p: Record<string, unknown>) => void }) {
  const alpha = String(spec.alpha ?? 0.5), runs = String(spec.runs ?? 10);
  const penalties = RISK_PENALTIES.some(([v]) => v === alpha) ? RISK_PENALTIES : [[alpha, "alpha " + alpha] as [string, string], ...RISK_PENALTIES];
  const runSteps = RISK_RUN_STEPS.map(String);
  return (
    <GearMenu menuId={"risk-settings:" + vi} menuStore={RISK_MENUS} wide className="risksettingsbtn" contentClassName="gap-1.5 px-2.5 py-2" title="risk model options"
      label={<><Settings2 />settings</>}>
      <div className="setrow" data-tip="the lasso share of the penalty: lasso keeps fewer genes, ridge keeps all of them shrunk">
        <span className="meta">penalty</span>
        <Choice className="flex-1" value={alpha} disabled={busy} onChange={(v) => patch({ alpha: Number(v) })} options={penalties} />
      </div>
      <div className="setrow" data-tip="random two-thirds / one-third splits; each patient's score is the mean over the runs that held them out (OncoCast recommends 50 or more)">
        <span className="meta">runs</span>
        <Choice className="flex-1" value={runs} disabled={busy} onChange={(v) => patch({ runs: Number(v) })}
          options={(runSteps.includes(runs) ? runSteps : [runs, ...runSteps]).map((r) => [r, r] as const)} />
      </div>
      <label className="chk" data-tip="train only on the discovery half of the engine's fixed split, and report the groups, table and C-index on the validation half, which the model never saw">
        <Checkbox checked={!!spec.validate} disabled={busy} onCheckedChange={(on) => patch({ validate: (on === true) || undefined })} /> validate on held-out half
      </label>
      <div className="setrow" data-tip="another cohort of this analysis to score with the fitted model, cut at the training thresholds, with its C-index and curves (empty for none)">
        <span className="meta">validate on</span>
        <DraftInput value={spec.validateOn || ""} disabled={busy} width="10rem" placeholder="cohort name"
          onCommit={(t) => patch({ validateOn: t.trim() || undefined })} />
      </div>
    </GearMenu>
  );
}

/** the volcano's label thresholds the card offers */
const RISK_LABEL_STEPS = [0.1, 0.25, 0.5, 0.75, 0.9, 1];

/** the riskmodel view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const labelAbove = Number(spec.labelAbove ?? RISK_LABEL_ABOVE);
  return (
    <div className="viewtb riskmodel-tb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="mutations counted as a gene's feature">
          genes <OptionSelect value={spec.measure || "any"} disabled={busy} onValueChange={(v) => patch({ measure: v })}>
            <option value="any">any mutation</option><option value="driver">OncoKB drivers</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="a separate baseline hazard per value — use CANCER_TYPE on a cohort of several cancers, or a gene that marks a type carries its prognosis">
          stratify by <OptionSelect value={spec.strata || ""} disabled={busy} onValueChange={(v) => patch({ strata: v || undefined })}>
            <option value="">nothing</option>
            {!cats.includes(spec.strata) && spec.strata && <option value={spec.strata}>{spec.strata}</option>}
            {cats.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <PickMenu label="covariates" title="clinical attributes always kept in the model, never penalised (at most 6): numbers as they are, categories against their commonest value. Prefer an age at diagnosis to an age at last contact, which makes longer survivors look older"
          options={c.attrs.filter((a) => a.attribute !== spec.strata).map((a) => ({ value: a.attribute, label: a.attribute, hint: a.kind === "num" ? "number" : "category" }))}
          chosen={spec.covariates || []} max={6} busy={busy} menuId={"risk-cov:" + c.vi} menuStore={RISK_MENUS}
          onChange={(next) => patch({ covariates: next.length ? next : undefined })} />
        <label className="tbfield" data-tip="start each patient's clock at a timeline event instead of the study's day 0; they then enter the risk set at day 0 (delayed entry)">
          clock from <OptionSelect value={spec.anchor?.eventType || ""} disabled={busy}
            onValueChange={(v) => patch({ anchor: v ? { ...(spec.anchor || {}), eventType: v } : undefined })}>
            <option value="">study's day 0</option>
            {spec.anchor?.eventType && !c.events.some((x) => x.label === spec.anchor.eventType) && <option value={spec.anchor.eventType}>{spec.anchor.eventType}</option>}
            {c.events.map((x) => <option key={x.label} value={x.label}>first {x.label}</option>)}
          </OptionSelect>
        </label>
        {spec.anchor?.eventType && <>
          <label className="tbfield" data-tip="only anchor events with this attribute (e.g. SUBTYPE); empty for any">
            where <DraftInput value={spec.anchor.key || ""} disabled={busy} width="6rem" placeholder="attribute"
              onCommit={(t) => patch({ anchor: { eventType: spec.anchor.eventType, ...(t.trim() ? { key: t.trim(), value: spec.anchor.value || "" } : {}) } })} />
          </label>
          <label className="tbfield" data-tip="the value that attribute must take (e.g. Immuno)">
            = <DraftInput value={spec.anchor.value || ""} disabled={busy} width="6rem" placeholder="value"
              onCommit={(t) => patch({ anchor: { ...spec.anchor, value: t } })} />
          </label>
        </>}
      </div>
      <div className="tbz"><span className="tbl">model</span>
        <RiskModelSettings vi={c.vi} spec={spec} busy={busy} patch={patch} />
        <RiskGroupsButton spec={spec} m={c.v?.riskmodel} busy={busy} onApply={patch} />
        <RiskTable1Button vi={c.vi} spec={spec} m={c.v?.riskmodel} busy={busy} attrs={c.attrs} docJson={c.docJson} onPatch={patch} />
      </div>
      <div className="tbz"><span className="tbl">view</span>
        <label className="tbfield" data-tip="the volcano names the genes the model kept in at least this share of its runs; the rest are drawn unnamed">
          label genes kept in ≥ <OptionSelect value={String(labelAbove)} disabled={busy} onValueChange={(v) => patch({ labelAbove: Number(v) === RISK_LABEL_ABOVE ? undefined : Number(v) })}>
            {!RISK_LABEL_STEPS.includes(labelAbove) && <option value={labelAbove}>{Math.round(labelAbove * 100)}%</option>}
            {RISK_LABEL_STEPS.map((t) => <option key={t} value={t}>{Math.round(t * 100)}%</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const riskmodelUi: KindUi<"riskmodel"> = {
  kind: "riskmodel",
  label: "Risk model (elastic-net Cox, OncoCast-style)",
  category: "outcomes",
  title: "Risk model",
  maxCohorts: 1,
  sub: (spec) => (spec.endpoint || "OS") + (spec.anchor?.eventType ? " from first " + spec.anchor.eventType + (spec.anchor.key ? " [" + spec.anchor.key + "=" + spec.anchor.value + "]" : "") : "") +
    " on " + (spec.measure === "driver" ? "driver mutations" : "mutated genes") +
    (spec.covariates?.length ? " + " + spec.covariates.length + " covariate" + (spec.covariates.length === 1 ? "" : "s") : "") +
    (spec.strata ? ", stratified by " + spec.strata : "") + " · " + (spec.runs ?? 10) + " held-out splits" + (spec.validate ? ", validated on the held-out half" : "") +
    (spec.validateOn ? ", scored on “" + spec.validateOn + "”" : ""),
  Controls,
  figureView: (spec, v) => v.riskmodel ? { ...v, riskmodel: { ...v.riskmodel, labelAbove: Number(spec.labelAbove ?? RISK_LABEL_ABOVE) } } : v,
};
