// Planted bugs: the SV table's Gene panel column (PAT-GP-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "sv-gene-panel-mutation-panels", layer: "counts", guard: "patient-sv", file: "lib/patient-alterations.ts",
    effect: "The SV table's Gene panel column lists each sample's mutation panel, not its structural-variant panel (fixture FX-P49: PEERFIX_FULL twice, where its SV profile is whole-exome, N/A).",
    find: "missCte(p, patient, db, \"STRUCTURAL_VARIANT\", samples, true)",
    replace: "missCte(p, patient, db, \"MUTATION_EXTENDED\", samples, true)" },
  { id: "sv-gene-panel-site2-gene", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "Whether a sample was profiled is decided by site 2's gene, where the portal takes site 1's (msk_chord_2024 P-0010965's SYS1-NCOA3 would list a panel the portal leaves out of the download).",
    find: "(panels ? \", gene1 AS gene\" : \"\")",
    replace: "(panels ? \", gene2 AS gene\" : \"\")" },
  { id: "sv-gene-panel-never-asked", layer: "counts", guard: "patient-sv", file: "lib/views/alterations/run.ts",
    effect: "The SV table never works out its Gene panel column, so the column is blank on every row.",
    find: "panels: asksPanels(tqq) }",
    replace: "panels: t !== \"sv\" && asksPanels(tqq) }" },
];
