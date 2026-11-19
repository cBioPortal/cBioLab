// Planted bugs: the Patient tables' Samples cell marking a sample whose panel leaves out the row's gene (PAT-GP-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "not-profiled-wes-counted-off-panel", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "A whole-exome sample is marked not profiled for every gene, where the portal counts WES as covering all of them (PAT-GP-1).",
    find: "vs.su NOT IN (SELECT su FROM pan WHERE panel = 'WES') AND (gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np",
    replace: "(gg.gene, vs.su) NOT IN (SELECT gene, su FROM cov))) AS np" },
  { id: "not-profiled-only-when-filtering", layer: "counts", guard: "unit", file: "lib/views/alterations/run.ts",
    effect: "The Samples cell marks no unprofiled sample unless the gene filter or the inAll column asks for coverage.",
    find: "inAll: asksInAll(tqq) || (inView > 1 && t !== \"sv\") }",
    replace: "inAll: asksInAll(tqq) }" },
  { id: "not-profiled-dropped-from-detail", layer: "counts", guard: "unit", file: "lib/views/alterations/run.ts",
    effect: "A row's unprofiled samples never reach the page, so no grey pill is drawn.",
    find: "...(notProfiled ? { notProfiled } : {}) };",
    replace: "};" },
];
