// Planted bugs: the OncoKB cancer-gene list read at the pin (lib/annotation-store.ts). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  "oncokb-cancer-gene": ["node", "--env-file=.env.local", "scripts/check-oncokb-cancer-gene.ts"],
};

export const mutants: Mutant[] = [
  { id: "cancer-gene-read-reads-curated", layer: "counts", guard: "oncokb-cancer-gene", file: "lib/annotation-store.ts",
    effect: "The cancer-gene read returns only the genes OncoKB curates, leaving out listed genes it does not.",
    find: "\" AND cancer_gene\";", replace: "\" AND oncokb_annotated\";" },
  { id: "cancer-gene-partial-read-as-complete", layer: "counts", guard: "oncokb-cancer-gene", file: "lib/annotation-store.ts",
    effect: "A cancer gene list whose sync left genes unstored reads as complete, so a gene not yet stored reads as no cancer gene.",
    find: "count() > 0 AND argMax(note, (finished_at, run_id)) = 'complete'", replace: "count() > 0" },
];
