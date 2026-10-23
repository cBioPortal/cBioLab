// The riskmodel view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { riskSpan, riskmodelSvg } from "./figure.ts";

export const riskmodelKind: ViewKindDef<"riskmodel"> = {
  kind: "riskmodel",
  figure: (v, o) => v.riskmodel ? riskmodelSvg(v, o) : null,
  title: (v) => "Risk model" + (v.riskmodel ? " — elastic-net Cox, " + v.riskmodel.runs + " runs" : ""),
  text: (v, { out, pFmt, caveatOf, noteOf, methodOf }) => {
    const m = v.riskmodel;
    const pc = (x: number | null) => x == null ? "n/a" : Math.round(x * 100) + "%";
    out.push(`Risk model (elastic-net Cox, ${m.runs} held-out splits, alpha ${m.alpha}, seed ${m.seed}; ${m.n.toLocaleString()} patients, ${m.events.toLocaleString()} events, ` +
      `${m.candidates} candidate genes${m.strata ? ", stratified by " + m.strata : ""}${m.anchoredTo ? ", clock from " + m.anchoredTo : ""}):\n` +
      `  held-out C-index ${m.cIndex.median.toFixed(3)} (IQR ${m.cIndex.q1.toFixed(3)}–${m.cIndex.q3.toFixed(3)})` +
      (m.validation ? `; trained on the discovery half only (${m.validation.discovery} patients), C-index on the validation half ${m.validation.cIndex.toFixed(3)} (${m.validation.validation} patients)` : "") + "\n" +
      (m.covariates.length ? "  adjusted for: " + m.covariates.map((c) => `${c.name} HR ${c.hr.toFixed(3)}`).join(", ") + "\n" : "") +
      `  risk score on OncoCast's 0–10 scale (0 and 10 the lowest and highest held-out score${m.validation ? " in the discovery half" : ""}; raw ${m.scale.min.toFixed(3)} to ${m.scale.max.toFixed(3)})\n` +
      `  risk groups (${m.reportedOn}${m.cutsChosen ? `; cut at the view's chosen quantiles ${m.cutsChosen.join(", ")}` : ", equal quantiles"}):\n` +
      m.groups.map((g) => `    ${g.name} (score ${riskSpan(m, g)}): n=${g.curve.n}, ${g.curve.events} events, median ${g.curve.median == null ? "not reached" : g.curve.median.toFixed(1) + "mo"}, ` +
        `12-month ${pc(g.at12)}, 36-month ${pc(g.at36)}` + (g.hr != null ? `, HR vs lowest ${g.hr.toFixed(2)} (95% CI ${g.ciLow!.toFixed(2)}–${g.ciHigh!.toFixed(2)}, ${pFmt(g.p!)})` : "")).join("\n") +
      (m.logrank ? `\n  log-rank p=${pFmt(m.logrank.p)}` : "") +
      (m.refit ? `\n  risk score alone: HR ${m.refit.hr.toFixed(2)} per SD (95% CI ${m.refit.ciLow.toFixed(2)}–${m.refit.ciHigh.toFixed(2)}, ${pFmt(m.refit.p)})` : "") +
      "\n  genes kept most often: " + m.features.slice(0, 15).map((f) => `${f.gene} ${Math.round(f.selected * 100)}% HR ${f.hr.toFixed(2)}`).join(", ") +
      (m.neverHeldOut ? `\n  ${m.neverHeldOut} patients were never held out, so have no score` : "") +
      (m.external ? `\n  external validation on ${m.external.cohort} (${m.external.study}; ${m.external.n} patients scored, ${m.external.notCovered} not covered by the model's genes): ` +
        `C-index ${m.external.cIndex.toFixed(3)} (95% bootstrap CI ${m.external.cIndexLo.toFixed(3)}–${m.external.cIndexHi.toFixed(3)})` +
        (m.external.logrank ? `, log-rank p=${pFmt(m.external.logrank.p)}` : "") + "\n" +
        m.external.groups.map((g) => `    ${g.name}: n=${g.curve.n}, ${g.curve.events} events, median ${g.curve.median == null ? "not reached" : g.curve.median.toFixed(1) + "mo"}` +
          (g.hr != null ? `, HR vs lowest ${g.hr.toFixed(2)} (95% CI ${g.ciLow!.toFixed(2)}–${g.ciHigh!.toFixed(2)})` : "")).join("\n") : "") +
      caveatOf(v) + methodOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "A model that predicts survival from which genes are mutated in each patient, in the style of the OncoCast package. It is trained many times, each time on two thirds of the patients and tested on the other third, so every patient's risk score comes from a model that never saw them. Patients are then split into low, intermediate and high risk, and their survival curves are drawn. The list shows the genes the model relied on most, with a hazard ratio above 1 meaning higher risk. Tick \"validate\" to train on one half of the patients and grade the model on the other half, which it never saw, or name another group of patients under \"validate on\" to grade it there — for example patients from a different study — with the same risk-group boundaries."
  },
  need: "patients",
  isNew: true,
};
