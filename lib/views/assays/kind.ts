// The assays view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { assaysSvg } from "./figure.ts";
import type { AssaysEntity } from "./types.ts";

export const assaysKind: ViewKindDef<"assays"> = {
  kind: "assays",
  figure: (v, o) => v.assays && v.assays.tested > 0 ? assaysSvg(v, o) : null,
  title: (v) => "Generic assays" + (v.assays ? " — " + v.assays.profileName : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const as = v.assays;
    const cell = (c: AssaysEntity["cells"][number]) => as.datatype === "numeric"
      ? `${c.cohort} mean ${c.mean == null ? "—" : c.mean.toPrecision(3)} (n=${c.n})`
      : `${c.cohort} ` + Object.entries(c.values || {}).map(([k, n]) => `${k} ${c.n ? (100 * n / c.n).toFixed(1) : "—"}%`).join(", ") + ` (n=${c.n})`;
    out.push(`Generic-assay comparison, ${as.profileName} (${as.profileType}; ${as.datatype}, per ${as.unit.replace(/s$/, "")}; ${as.test}, BH q over ${as.tested.toLocaleString()} entities; ${as.significant} at q<0.05):\n` +
      as.rows.slice(0, 40).map((g) => `  ${g.name}: ` + g.cells.map(cell).join(" | ") +
        (g.diff != null ? `, difference ${g.diff.toPrecision(3)}` : "") + `, q=${pFmt(g.q)}, higher in ${g.higherIn}${g.value ? " (" + g.value + ")" : ""}`).join("\n") +
      (as.rows.length > 40 ? `\n  … ${as.tested - 40} more entities tested` : "") + caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Compares two or more groups on every measurement in one kind of extra lab data the study recorded — such as which mutational signatures (like sun damage or smoking) shaped each tumour, or which chromosome arms were gained or lost. The measurements at the top differ most clearly between the groups; each one shows its average, or its mix of results, in every group, so a difference that is clear but small reads as small."
  },
  need: "local",
};
