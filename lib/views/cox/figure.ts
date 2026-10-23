// The cox view's figure.
import { type Panel, forestSvg } from "../../figures/forest.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { SvgOpts } from "../../svg-kit.ts";

/** Cox: hazard ratios; with stratifyByCohort, one panel per cohort that fit */
export function coxSvg(v: DrawnResultOf<"cox">, o: SvgOpts): string {
  const byCohort = v.cox?.byCohort;
  const panels: Panel[] = byCohort
    ? byCohort.filter((c) => c.coefficients.length).map((c) => ({
        heading: c.cohort + " — n = " + c.n.toLocaleString("en-US") + ", " + c.events.toLocaleString("en-US") + " events",
        coefs: c.coefficients.map((cf) => ({ ...cf, ratio: cf.hr })) }))
    : [{ heading: null, coefs: (v.cox?.coefficients || []).map((cf) => ({ ...cf, ratio: cf.hr })) }];
  return forestSvg(panels, Math.max(520, o.width || 760), o.theme, "HR", v.caveat || "", "Cox regression — hazard ratios");
}
