"use client";
// The rmst view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";

/** the rmst view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const lms = Array.isArray(spec.landmarkMonths) ? spec.landmarkMonths.join(", ") : "0";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">restrict</span>
        <label className="tbfield" title="months up to which the area under each curve is taken; empty for the largest time every cohort has 10 at risk">
          τ <DraftInput value={spec.tau != null ? String(spec.tau) : ""} disabled={busy} width="4rem" placeholder="auto"
            onCommit={(t) => patch({ tau: t.trim() && Number.isFinite(Number(t)) ? Number(t) : undefined })} />
        </label>
        <label className="tbfield" title="landmarks in months, comma-separated: each keeps the patients still followed then and restarts the clock">
          landmarks <DraftInput value={lms} disabled={busy} width="6rem" placeholder="0, 6, 12"
            onCommit={(t) => { const xs = t.split(/[ ,]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x)); patch({ landmarkMonths: xs.length ? xs : [0] }); }} />
        </label>
      </div>
    </div>
  );
}

export const rmstUi: KindUi<"rmst"> = {
  kind: "rmst",
  label: "Restricted mean OS time (RMST, landmarks)",
  title: "Restricted mean OS time",
  maxCohorts: 6,
  why: (k) => k.attrs.some((a) => /_MONTHS$/i.test(a.attribute)) ? null : "this study has no <X>_MONTHS outcome column",
  sub: (spec) => {
    const lm = Array.isArray(spec.landmarkMonths) && spec.landmarkMonths.some((x: number) => x > 0) ? " · landmarks " + spec.landmarkMonths.join(", ") + " mo" : "";
    return "area under the KM curve to " + (spec.tau != null ? "τ = " + spec.tau + " months" : "τ where every cohort has 10 at risk") + " · " + (spec.anchor?.eventType ? "OS from first " + spec.anchor.eventType + (spec.anchor.key ? " [" + spec.anchor.key + "=" + spec.anchor.value + "]" : "") : (spec.endpoint || "OS")) + lm;
  },
  Controls,
};
