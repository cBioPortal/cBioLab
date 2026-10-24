// The incidence view as every page and agent sees it: its figure, title, results text, help and marks.
import type { ViewKindDef } from "../kind-def.ts";
import { incidenceSvg } from "./figure.ts";

export const incidenceKind: ViewKindDef<"incidence"> = {
  kind: "incidence",
  figure: (v, o) => v.incidence && v.incidence.curves.some((c) => c.n) ? incidenceSvg(v, o) : null,
  title: (v) => "Cumulative incidence" + (v.incidence ? " — " + v.incidence.eventLabel + (v.incidence.anchoredTo ? " from " + v.incidence.anchoredTo : "") : ""),
  text: (v, { out, pFmt, caveatOf, noteOf }) => {
    const inc = v.incidence;
    out.push(`Cumulative incidence of ${inc.eventLabel}${inc.anchoredTo ? " from " + inc.anchoredTo : ""}, death competing (Aalen-Johansen):\n` +
      inc.curves.map((c) => `  ${c.cohort}: n=${c.n.toLocaleString()}, ${c.events} events, ${c.competing} died first, ${c.censored} censored; ` +
        `not at risk: ${c.excluded.prior} already had it, ${c.excluded.unobserved} before observation, ${c.excluded.noAnchor} no anchor, ${c.excluded.noFollowup} no follow-up`).join("\n") + "\n" +
      inc.horizons.map((h) => `  at ${h.months} months: ` + h.cells.map((c) => `${c.cohort} ${(100 * c.f1).toFixed(1)}% (95% CI ${(100 * c.lo).toFixed(1)}-${(100 * c.hi).toFixed(1)}; 1-KM would say ${(100 * c.naive).toFixed(1)}%)`).join(" | ")).join("\n") +
      (inc.gray ? `\n  Gray's test: statistic ${inc.gray.statistic.toFixed(2)}, permutation p=${pFmt(inc.gray.p)} (${inc.gray.permutations} shuffles)` : "") +
      caveatOf(v) + noteOf(v));
  },
  help: {
    title: "What is this?",
    text: "Shows what share of patients have experienced a particular event — such as the cancer spreading to the brain — by each point in time. It counts patients who died before the event as never having it, rather than pretending they might still, which is why its numbers can be noticeably lower, and more honest, than a simple survival-style curve would suggest."
  },
  need: "local",
  isNew: true,
};
