// Planted bugs: the clinical violin table (STS-VI-1…7). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "violin-quartile-inclusive", layer: "counts", guard: "unit", file: "lib/study-view-violin.ts",
    effect: "Quartiles at position p(n − 1) + 1 instead of the portal's p(n + 1): coadread Colon Adenocarcinoma's Q1 reads 58.75 where the portal's is 58.25.",
    find: "const pos = p * (total + 1);", replace: "const pos = p * (total - 1) + 1;" },
  { id: "violin-whiskers-ignore-fences", layer: "counts", guard: "unit", file: "lib/study-view-violin.ts",
    effect: "Whiskers always reach the data's ends, even when a value lies past a 1.5 × IQR fence, where the portal stops them at the fence.",
    find: "whiskerLower: suspected ? suspectLo : min, whiskerUpper: suspected ? suspectHi : max", replace: "whiskerLower: min, whiskerUpper: max" },
  { id: "violin-drawn-with-own-filter", layer: "cohorts", guard: "unit", file: "lib/explore.ts",
    effect: "The curve and box are drawn under the numeric attribute's own filter, so a range picked on Diagnosis Age squeezes every violin into it; the portal draws them without it.",
    find: "draftWithout(o.draft, (c) => clinicalClauseAttr(c) === numeric)", replace: "o.draft" },
  { id: "violin-remove-keeps-filters", layer: "cohorts", guard: "unit", file: "lib/study-view-violin.ts",
    effect: "Remove chart on a violin table leaves its category filter, so the selection stays narrowed by a chart no longer on the page.",
    find: "clear: [pair.categorical, pair.numeric].sort() };", replace: "clear: [] };" },
];
