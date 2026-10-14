// A time axis (months or weeks) with ticks at the steps a reader counts in; shared by every
// time-course figure (incidence, risk model, labs, clinical course).
import { linear, type Scale } from "./scale.ts";
import { textWidth } from "./text.ts";
import { fmtNum } from "./format.ts";
import { FS } from "./style.ts";

const STEPS = { months: [1, 3, 6, 12, 24, 36, 60, 120, 240], weeks: [1, 2, 4, 8, 12, 26, 52, 104, 208] } as const;

/**
 * A time scale over [from, to] (months or weeks) onto [r0, r1], ticked at whole multiples of a
 * step a reader counts in. The step is the survival axis's rule (a year, or two past five years;
 * 12 or 26 weeks) or, for a short span, the step that gives about six ticks — then the next
 * longer one while the labels (or anything else `minGap` px wide drawn at each tick, such as a
 * risk table's counts) would not fit between ticks. `step` forces one.
 */
export function timeScale(from: number, to: number, r0: number, r1: number,
  o: { unit?: "months" | "weeks"; step?: number; minGap?: number } = {}): Scale {
  const unit = o.unit || "months";
  if (!(to > from)) to = from + 1;
  const s = linear(from, to, r0, r1, { nice: false });
  const span = to - from, px = Math.abs(r1 - r0);
  const steps: readonly number[] = STEPS[unit];
  let step = o.step || 0;
  if (!step) {
    step = unit === "months" ? (span > 72 ? 24 : span > 24 ? 12 : 0) : (span > 104 ? 26 : span > 24 ? 12 : 0);
    if (!step) step = steps.find((k) => span / k <= 6) || steps[steps.length - 1];
    const widest = Math.max(o.minGap || 0, textWidth(fmtNum(-Math.max(Math.abs(from), Math.abs(to))), FS.small));
    for (let i = steps.indexOf(step); i >= 0 && i < steps.length - 1 && px * step / span < widest + 8; i++) step = steps[i + 1];
  }
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step - 1e-9) * step; t <= to + 1e-9; t += step) ticks.push(t + 0);
  return Object.assign(s, { ticks, fmt: (t: number) => fmtNum(t) });
}

/** the axis title for time measured from an anchor: "Months from Treatment (FIRST)" */
export const timeTitle = (unit: "Months" | "Weeks", from?: string | null): string => unit + (from ? " from " + from : "");
