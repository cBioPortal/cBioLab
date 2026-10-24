// The txendpoints view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { txMedianText, txendpointsSvg } from "./figure.ts";

export const txendpointsKind: ViewKindDef<"txendpoints"> = {
  kind: "txendpoints",
  figure: (v, o) => v.txendpoints.curves.some((c) => c.n) ? txendpointsSvg(v, o) : null,
  title: (v) => "Treatment endpoints" + (v.txendpoints ? " — " + v.txendpoints.endpointLabel + " from " + v.txendpoints.anchoredTo : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const t = v.txendpoints;
    out.push(`Treatment endpoint: ${t.endpointLabel} from ${t.anchoredTo} (Kaplan-Meier):\n` +
      t.curves.map((c) => `  ${c.cohort}: n=${c.n.toLocaleString()}, ${c.events} events, ${txMedianText(c)}; ` +
        `${c.anchored} of ${c.cohortPatients} anchored; left out ${c.excluded.noAnchor} without the anchor, ${c.excluded.noFollowup} without follow-up` +
        (t.endpoint === "tot" ? `, ${c.excluded.noStop} without a stop date` : "")).join("\n") +
      (t.logrank ? `\n  log-rank chi2=${t.logrank.chi2.toFixed(2)} (${t.logrank.df} df), p=${pFmt(t.logrank.p)}` : t.noTest ? `\n  ${t.noTest}` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Starts each patient's clock on the day a treatment began — for example their first immunotherapy — and follows them to an outcome that real-world studies use in place of a trial's: when they moved on to their next treatment (time to next treatment), when they stopped this one (time on treatment), or when their cancer was recorded as growing (real-world progression-free survival). Death counts as the outcome too, and patients still followed without it are counted up to their last visit. Each group's curve shows the share not yet there at each month, with the number still followed below. The groups were not randomised to the treatment, so a gap between curves is a clue, not proof that a gene or a group changes how well the treatment works."
  },
  need: "local",
  preview: "no method record or golden test of the endpoint derivation (lines, stops, progression) or the median intervals yet",
  isNew: true,
};
