// Planted bugs: Add chart's gene tab, one chart per gene and profile (STV-AC-5). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-tab-remove-drops-gene", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "Removing a gene's mutation chart also removes its copy-number chart, because the gene stops being counted while one status chart is still shown.",
    find: "const genes = kinds.length ? (s.genes.includes(gene)", replace: "const genes = on ? (s.genes.includes(gene)" },
  { id: "gene-tab-any-cna-profile", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "The gene tab offers a continuous copy-number profile (linear CNA) as the copy-number chart's, whose levels the chart does not read.",
    find: "d.alterationType === \"COPY_NUMBER_ALTERATION\" && PROFILE_KINDS.cna.includes(d.profile)", replace: "d.alterationType === \"COPY_NUMBER_ALTERATION\"" },
  { id: "gene-tab-cna-first-study-only", layer: "counts", guard: "unit", file: "lib/study-view-add-chart.ts",
    effect: "Over two studies holding discrete copy number under different ids (gistic, cna), the option counts the larger study's samples only (300 where the selection's are 592).",
    find: "fmtInt(held.reduce((n, d) => n + d.n, 0))", replace: "fmtInt(top.n)" },
];
