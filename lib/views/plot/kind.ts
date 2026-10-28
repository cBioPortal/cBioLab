// The plot view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { plotSvg } from "./figure.ts";

export const plotKind: ViewKindDef<"plot"> = {
  kind: "plot",
  figure: (v, o) => v.plot ? plotSvg(v, o) || null : null,
  text: (v, { out, pFmt, caveatOf, noteOf, plotUnit }) => {
    const pd = v.plot;
    if (!pd) { out.push("Plot: no data"); }
    else if (pd.shape === "scatter") {
      const st = pd.stats;
      out.push(`Plot (scatter): ${pd.x.label} vs ${pd.y.label} — ${pd.n.toLocaleString()} ${plotUnit(v)}` +
        (pd.grid ? `, binned onto a ${pd.grid[0]}x${pd.grid[1]} grid (the payload is bins, never points)` : "") + "." +
        (st ? `\n  Pearson r=${st.pearson != null ? st.pearson.toFixed(3) : "—"}` +
              (st.pPearson != null ? ` p=${pFmt(st.pPearson)}` : "") +
              `; Spearman rho=${st.spearman != null ? st.spearman.toFixed(3) : "—"}` +
              (st.pSpearman != null ? ` p=${pFmt(st.pSpearman)}` : "") +
              (st.slope != null ? `; least-squares slope ${st.slope.toFixed(3)}` : "") : "") +
        caveatOf(v) + noteOf(v));
    } else if (pd.shape === "box") {
      out.push(`Plot (box): ${pd.y.label} by ${pd.x.label} — ${pd.n.toLocaleString()} ${plotUnit(v)}.\n` +
        (pd.groups || []).slice(0, 12).map((g) =>
          `  ${g.g}: median ${g.median.toFixed(2)} (IQR ${g.q1.toFixed(2)}–${g.q3.toFixed(2)}, ` +
          `whiskers ${g.loWhisker.toFixed(2)}–${g.hiWhisker.toFixed(2)}, n=${g.n.toLocaleString()})`).join("\n") +
        // WHICH overlay was drawn is a disclosure, not decoration: points
        // mean the reader is seeing cases, a density means they are not.
        (pd.overlay === "points" ? `\n  Values are drawn as individual points.`
          : pd.overlay === "violin" ? `\n  Values are drawn as a DENSITY, not points — either above the point cap or from a participant that discloses no cases.`
          : "") +
        // a cohort layer drawn as boxes is a second set of quartiles the figure shows and the note does not
        (pd.layers || []).filter((h) => h.groups && h.groups.length).map((h) => `\n  Point layer “${h.name}”:\n` +
          h.groups!.slice(0, 12).map((g) => `    ${g.g}: median ${g.median.toFixed(2)} (IQR ${g.q1.toFixed(2)}–${g.q3.toFixed(2)}, n=${g.n.toLocaleString()})`).join("\n")).join("") +
        caveatOf(v) + noteOf(v));
    } else {
      out.push(`Plot (table): ${pd.x.label} vs ${pd.y.label} — ${pd.n.toLocaleString()} ${plotUnit(v)}.\n` +
        (pd.cells || []).slice(0, 24).map((c) => `  ${c.cx} x ${c.cy}: ${c.n.toLocaleString()}`).join("\n") +
        caveatOf(v) + noteOf(v));
    }
  },
  help: {
    title: "What is this?",
    text: "Plots two measurements against each other for the same patients or samples — for example, a gene's activity level against a patient's age — so you can see whether they tend to rise and fall together, split into distinct clusters, or show no relationship at all."
  },
  // no need: counts from every participant, a peer included (the federation `plot` op); its cases only from one
  // that may show them, else its density alone, said in the caption (./run.ts)
};
