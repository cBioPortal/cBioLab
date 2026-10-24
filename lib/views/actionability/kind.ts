// The actionability view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { actionabilitySvg } from "./figure.ts";

export const actionabilityKind: ViewKindDef<"actionability"> = {
  kind: "actionability",
  figure: (v, o) => v.actionability.panels.some((pn) => pn.sequenced) ? actionabilitySvg(v, o) : null,
  title: (v) => "Clinical actionability" + (v.actionability ? " — OncoKB " + v.actionability.pin + (v.actionability.groupBy ? " by " + v.actionability.groupBy : "") : ""),
  text: (v, { out, caveatOf, noteOf }) => {
    const a = v.actionability, pct = (k: number, d: number) => d ? (100 * k / d).toFixed(1) + "%" : "–";
    const line = (label: string, g: { sequenced: number; levels: number[]; resistance: number[] }) =>
      `  ${label} (${g.sequenced.toLocaleString()} sequenced): ` + a.levels.map((l, i) => `${l} ${g.levels[i]} (${pct(g.levels[i], g.sequenced)})`).join(", ") +
      `; resistance R1 ${g.resistance[0]}, R2 ${g.resistance[1]}`;
    out.push(`Clinical actionability (highest OncoKB level per patient, ${a.pin}, any cancer type${a.groupBy ? `, by ${a.groupBy}` : ""}):\n` +
      a.panels.map((pn) => [line(pn.cohort, pn), ...(pn.groups || []).map((g) => line("  " + g.label, g)),
        ...(pn.concordance ? [`    ${a.pairBy!.a.join("/")} vs ${a.pairBy!.b.join("/")} highest level, ${pn.concordance.pairs} patients with both: ${pn.concordance.discordant} discordant (${pct(pn.concordance.discordant, pn.concordance.pairs)}); rows ${a.pairBy!.a.join("/")}, columns ${a.pairBy!.b.join("/")} (1, 2, 3A, 3B, 4, none): ` +
          pn.concordance.table.map((r) => "[" + r.join(", ") + "]").join(" ")] : [])].join("\n")).join("\n") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "For each patient, finds the strongest evidence OncoKB lists for a drug that targets one of their tumour's genetic changes — Level 1 means an FDA-approved drug for that change, down to Level 4 for early biological evidence — and shows what share of patients reach each level, overall or per cancer type. The levels here are the best OncoKB gives the change in ANY cancer, so a change that is only actionable in another cancer still counts: read the bars as an upper bound. The table below compares, for patients sequenced twice, the level found in their primary tumour against their metastasis."
  },
  need: "local",
  preview: "no method record of the per-patient highest-level counts yet",
  isNew: true,
};
