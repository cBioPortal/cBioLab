// The molsubtype view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { molsubtypeSvg } from "./figure.ts";

export const molsubtypeKind: ViewKindDef<"molsubtype"> = {
  kind: "molsubtype",
  figure: (v, o) => v.molsubtype.panels.some((pn) => pn.classified) ? molsubtypeSvg(v, o) : null,
  title: (v) => "Molecular subtypes" + (v.molsubtype ? " — " + v.molsubtype.classifier + (v.molsubtype.by ? " by " + v.molsubtype.by : "") : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const m = v.molsubtype, pct = (k: number, n: number) => n ? (100 * k / n).toFixed(1) + "%" : "–";
    const line = (label: string, c: { counts: number[]; classified: number; notClassifiable: number }) =>
      `  ${label} (${c.classified.toLocaleString()} classified, ${c.notClassifiable.toLocaleString()} not classifiable): ` + m.subtypes.map((s, i) => `${s} ${c.counts[i]} (${pct(c.counts[i], c.classified)})`).join(", ");
    out.push(`Molecular subtypes — ${m.classifierLabel}; MSI by ${m.msi}; p53 abnormal = ${m.p53}:\n` +
      m.panels.map((pn) => [line(pn.cohort, pn), ...(pn.groups || []).map((g) => line("  " + g.label, g)),
        ...(pn.byTest ? [`    by ${m.by}: chi-squared ${pn.byTest.chi2.toFixed(1)} (${pn.byTest.df} df), p=${pFmt(pn.byTest.p)}`] : [])].join("\n")).join("\n") +
      (m.cohortTest ? `\n  Between cohorts: chi-squared ${m.cohortTest.chi2.toFixed(1)} (${m.cohortTest.df} df), p=${pFmt(m.cohortTest.p)}` : "") +
      (m.survival || []).map((s) => `\n  OS by subtype, ${s.cohort}: ` + s.curves.map((c) => `${c.subtype} n=${c.n}, ${c.events} deaths, median ${c.median == null ? "not reached" : c.median.toFixed(1) + " mo"}`).join("; ") +
        (s.logrank ? `; log-rank chi-squared ${s.logrank.chi2.toFixed(1)} (${s.logrank.df} df), p=${pFmt(s.logrank.p)}` : s.noTest ? "; " + s.noTest : "")).join("") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Sorts each patient's endometrial cancer into the four molecular groups doctors now use alongside the microscope: POLE-ultramutated (a tumour with a broken DNA-copying enzyme, which does very well), mismatch-repair deficient (a tumour that cannot fix certain DNA errors, read here from its MSI test), p53-abnormal (the group that does worst), and no specific molecular profile. The groups are assigned in that order, as the WHO guideline does. Patients whose test could not tell — no MSI result, or a gene panel that missed POLE or TP53 — are counted as not classifiable rather than guessed. The bars show each group's share, overall and by the attribute you pick; the curves show survival in each group."
  },
  need: "local",
  preview: "no method record or golden test of the per-patient classification, the chi-squared tests or the survival split yet",
  isNew: true,
};
