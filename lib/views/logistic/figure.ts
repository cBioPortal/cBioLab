// The logistic view's figure.
import { type Panel, forestSvg } from "../../figures/forest.ts";
import type { DrawnResultOf } from "../../types.ts";
import type { SvgOpts } from "../../svg-kit.ts";

/** logistic: odds ratios, one panel */
export function logisticSvg(v: DrawnResultOf<"logistic">, o: SvgOpts): string {
  const panels: Panel[] = [{ heading: null, coefs: (v.logistic?.coefficients || []).map((cf) => ({ ...cf, ratio: cf.or })) }];
  return forestSvg(panels, Math.max(520, o.width || 760), o.theme, "OR", v.caveat || "", "Logistic regression — odds ratios");
}
