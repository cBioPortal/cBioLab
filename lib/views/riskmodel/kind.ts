// The riskmodel view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { riskSpan, riskmodelSvg } from "./figure.ts";
import { fmtCI95, fmtEstimateCI, fmtMonths, fmtNum, fmtRatio } from "../../chart/format.ts";

export const riskmodelKind: ViewKindDef<"riskmodel"> = {
  kind: "riskmodel",
  figure: (v, o) => v.riskmodel ? riskmodelSvg(v, o) : null,
  title: (v) => "Risk model" + (v.riskmodel ? " — elastic-net Cox, " + v.riskmodel.runs + " runs" : ""),
  text: (v, { out, pFmt, caveatOf, noteOf, methodOf }) => {
    const m = v.riskmodel;
    const pc = (x: number | null) => x == null ? "n/a" : Math.round(x * 100) + "%";
    out.push(`Risk model (elastic-net Cox, ${m.runs} held-out splits, alpha ${m.alpha}, seed ${m.seed}; ${m.n.toLocaleString()} patients, ${m.events.toLocaleString()} events, ` +
      `${m.candidates} candidate genes${m.strata ? ", stratified by " + m.strata : ""}${m.anchoredTo ? ", clock from " + m.anchoredTo : ""}):\n` +
      `  held-out C-index ${fmtNum(m.cIndex.median)} (IQR ${fmtNum(m.cIndex.q1)}–${fmtNum(m.cIndex.q3)})` +
      (m.validation ? `; trained on the discovery half only (${m.validation.discovery} patients), C-index on the validation half ${fmtNum(m.validation.cIndex)} (${m.validation.validation} patients)` : "") + "\n" +
      (m.covariates.length ? "  adjusted for: " + m.covariates.map((c) => `${c.name} HR ${fmtRatio(c.hr)}`).join(", ") + "\n" : "") +
      `  risk score on OncoCast's 0–10 scale (0 and 10 the lowest and highest held-out score${m.validation ? " in the discovery half" : ""}; raw ${fmtNum(m.scale.min)} to ${fmtNum(m.scale.max)})\n` +
      `  risk groups (${m.reportedOn}${m.cutsChosen ? `; cut at the view's chosen quantiles ${m.cutsChosen.join(", ")}` : ", equal quantiles"}):\n` +
      m.groups.map((g) => `    ${g.name} (score ${riskSpan(m, g)}): n=${g.curve.n}, ${g.curve.events} events, median ${g.curve.median == null ? "not reached" : fmtMonths(g.curve.median)}, ` +
        `12-month ${pc(g.at12)}, 36-month ${pc(g.at36)}` + (g.hr != null ? `, HR vs lowest ${fmtRatio(g.hr)} (${fmtCI95(g.ciLow!, g.ciHigh!)}, ${pFmt(g.p!)})` : "")).join("\n") +
      (m.logrank ? `\n  log-rank p=${pFmt(m.logrank.p)}` : "") +
      (m.refit ? `\n  risk score alone: HR ${fmtRatio(m.refit.hr)} per SD (${fmtCI95(m.refit.ciLow, m.refit.ciHigh)}, ${pFmt(m.refit.p)})` : "") +
      "\n  genes kept most often: " + m.features.slice(0, 15).map((f) => `${f.gene} ${Math.round(f.selected * 100)}% HR ${fmtRatio(f.hr)}`).join(", ") +
      (m.neverHeldOut ? `\n  ${m.neverHeldOut} patients were never held out, so have no score` : "") +
      (m.external ? `\n  external validation on ${m.external.cohort} (${m.external.study}; ${m.external.n} patients scored, ${m.external.notCovered} not covered by the model's genes): ` +
        `C-index ${fmtNum(m.external.cIndex)} (95% bootstrap CI ${fmtNum(m.external.cIndexLo)}–${fmtNum(m.external.cIndexHi)})` +
        (m.external.logrank ? `, log-rank p=${pFmt(m.external.logrank.p)}` : "") + "\n" +
        m.external.groups.map((g) => `    ${g.name}: n=${g.curve.n}, ${g.curve.events} events, median ${g.curve.median == null ? "not reached" : fmtMonths(g.curve.median)}` +
          (g.hr != null ? `, HR vs lowest ${fmtEstimateCI(g.hr, g.ciLow!, g.ciHigh!)}` : "")).join("\n") : "") +
      caveatOf(v) + methodOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "A model that predicts survival from which genes are mutated in each patient, in the style of the OncoCast package. It is trained many times, each time on two thirds of the patients and tested on the other third, so every patient's risk score comes from a model that never saw them. Patients are then split into low, intermediate and high risk, and their survival curves are drawn. The list shows the genes the model relied on most, with a hazard ratio above 1 meaning higher risk. Tick \"validate\" to train on one half of the patients and grade the model on the other half, which it never saw, or name another group of patients under \"validate on\" to grade it there — for example patients from a different study — with the same risk-group boundaries."
  },
  need: "patients",
  isNew: true,
};
