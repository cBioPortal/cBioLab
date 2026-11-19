// Planted bugs: the gap between track groups (ONC-LY-1)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "onc-track-group-no-gap",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-rows.ts",
    effect: "The clinical rows sit straight on the gene rows with no gap, where the portal leaves 10 px between track groups.",
    find: "    if (i > 0 && trackGroupKey(t) !== trackGroupKey(tracks[i - 1])) y += g.trackGroupGap;\n",
    replace: "" },
  { id: "onc-track-group-heatmaps-one",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-rows.ts",
    effect: "Two heatmap profiles share one group, with no gap between them, where the portal gives each profile its own.",
    find: "t.kind === \"heatmap\" ? \"heatmap:\" + (t.profileType ?? \"\") : \"genetic\";",
    replace: "t.kind === \"heatmap\" ? \"heatmap\" : \"genetic\";" },
  { id: "onc-track-group-gap-row-hit",
    layer: "counts",
    guard: "unit",
    file: "lib/oncoprint-rows.ts",
    effect: "A pointer in the gap under a row picks that row, so its label menu and tooltip open from empty space.",
    find: "    else if (y > tops[m] + rowH) lo = m + 1;",
    replace: "    else if (y >= tops[m + 1]) lo = m + 1;" },
];
