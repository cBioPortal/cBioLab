// Planted bugs: several ranges of one chart's filter as one pill (STV-FB-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "range-pill-per-range", layer: "cohorts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "Several ranges of one chart's filter are a pill each again, where the portal writes one, from the first range's start to the last's end.",
    find: "return ivs.length > 1 && ivs.every((iv): iv is Interval => iv != null) ? ivs : null;", replace: "return null;" },
  { id: "range-pill-first-range-only", layer: "cohorts", guard: "unit", file: "lib/study-view-pills.ts",
    effect: "The one pill of several ranges reads the first range in the draft's order, not the lowest start to the highest end (Age (70, 75] and (50, 55] read 70 < x ≤ 75).",
    find: "const lo = lows.length === ends.length ? Math.min(...lows.map((e) => e.lo!)) : undefined;", replace: "const lo = lows.length === ends.length ? lows[0].lo : undefined;" },
];
