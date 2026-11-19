// Planted bugs: the Patient mutation table's mRNA Expr. column (PAT-MT-5, PAT-STM-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "mrna-rank-ties-lowest", layer: "statistics", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "mRNA Expr. ranks ties at the lowest (values below the sample's), where the portal's NaturalRanking ranks them at the highest.",
    find: "countIf(mv.z <= me.z)",
    replace: "countIf(mv.z < me.z)" },
  { id: "mrna-profile-last-match", layer: "statistics", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "mRNA Expr. ranks in the last rna_seq…_zscores profile (coadread: median_all_sample_ref_normal_Zscores), not the first, as the portal picks it.",
    find: "return ids.length ? ids[0].slice(study.length + 1) : null;",
    replace: "return ids.length ? ids[ids.length - 1].slice(study.length + 1) : null;" },
  { id: "mrna-shown-with-several-samples", layer: "counts", guard: "unit", file: "lib/patient-alterations.ts",
    effect: "mRNA Expr. is a default column with several samples in view, where the portal leaves it out.",
    find: "!(t === \"mutations\" && c === \"mrna\" && !(inView === 1 && mrna))",
    replace: "!(t === \"mutations\" && c === \"mrna\" && !mrna)" },
  { id: "mrna-dot-colours-swapped", layer: "counts", guard: "unit", file: "lib/views/alterations/mrna-cell.ts",
    effect: "The mRNA Expr. dot is red when low and blue when high, the portal's colours swapped.",
    find: "fill: percentile < b.lowBelow ? b.low : percentile > b.highAbove ? b.high : b.mid,",
    replace: "fill: percentile < b.lowBelow ? b.high : percentile > b.highAbove ? b.low : b.mid," },
  { id: "mrna-ranked-several-samples", layer: "counts", guard: "unit", file: "lib/views/alterations/run.ts",
    effect: "The table ranks mRNA with two samples in view, where the portal has no mRNA Expr. column.",
    find: "if (inView.length !== 1 || peerOf(ctx.resolvers[pt.study])) return null;",
    replace: "if (!inView.length || peerOf(ctx.resolvers[pt.study])) return null;" },
];
