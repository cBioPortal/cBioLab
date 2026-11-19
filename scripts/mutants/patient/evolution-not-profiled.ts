// Planted bugs: the Genomic Evolution "Sample(s) … not profiled for mutations" alert (PTB-GE-3). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "evolution-alert-names-profiled", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "The Genomic Evolution alert names the samples sequenced for mutations as not profiled, and says nothing of the one that was not.",
    find: "samples.filter((s) => !s.panel)",
    replace: "samples.filter((s) => !!s.panel)" },
  { id: "evolution-alert-first-sample-only", layer: "counts", guard: "unit", file: "lib/views/evolution/figure.ts",
    effect: "The Genomic Evolution alert names only the patient's first sample outside the mutation profile, the others going unmentioned.",
    find: "samples.filter((s) => !s.panel)",
    replace: "samples.filter((s) => !s.panel).slice(0, 1)" },
];
