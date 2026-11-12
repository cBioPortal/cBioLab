// The multistate view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { MS_TRANSITIONS, msRateText, multistateSvg } from "./figure.ts";
import { fmtCI95, fmtRatio, fmtShare } from "../../chart/format.ts";

export const multistateKind: ViewKindDef<"multistate"> = {
  kind: "multistate",
  figure: (v, o) => v.multistate.cohorts.some((c) => c.n) ? multistateSvg(v, o) : null,
  title: () => "Multistate model — progression and death",
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const m = v.multistate;
    out.push(`Multistate (illness-death) model, months from ${m.origin}:\n` +
      m.cohorts.map((c) => `  ${c.cohort}: n=${c.n.toLocaleString()} (${c.prevalent.toLocaleString()} progressed by day 0); ` +
        c.rates.map((r) => `${MS_TRANSITIONS[r.key]} ${r.events} events, ${msRateText(r)} per 100 person-months`).join("; ") +
        `\n    in each state (not progressed / progressed / dead): ` +
        c.atHorizon.map((h) => `${h.months} mo ` + (h.p0 == null ? "n/a" : `${fmtShare(h.p0, 0)} / ${fmtShare(h.p1!, 0)} / ${fmtShare(h.p2!, 0)}`)).join(", ")).join("\n") +
      m.cox.map((x) => `\n  ${MS_TRANSITIONS[x.key]}: ` + (x.noFit ? `no hazard ratio (${x.noFit})` :
        x.rows.map((r) => `${r.cohort} vs ${m.reference} HR ${fmtRatio(r.hr)} (${fmtCI95(r.lo, r.hi)}, ${pFmt(r.p)})`).join("; "))).join("") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Follows each patient through three states — alive without progression, alive after their cancer was first recorded as growing, and dead — from the start of their record (in MSK-CHORD, their first tumour sequencing). The coloured bands show, month by month, what share of each group is in each state; the lines below show how fast patients move along each of the three paths (progressing, dying without progressing, dying after progressing), and the table gives each path's rate and how much faster or slower each group moves along it than the first. Splitting death into 'after progression' and 'without it' shows where a group's worse survival comes from. Progression is read from radiology reports by a model, so it is only seen in patients who were scanned; the groups were not randomised, so a difference is a clue, not proof."
  },
  need: "local",
  preview: "no method record or golden test of the Aalen–Johansen occupation, Nelson–Aalen hazards or the delayed-entry Cox fits yet (no interval on the occupation)",
  isNew: true,
};
