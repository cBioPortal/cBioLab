// Planted bugs: the Mutational Signatures spectrum download and unpaged table (PTB-MS-5, PTB-MS-7). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "signatures-download-drops-reference", layer: "counts", guard: "unit", file: "lib/views/signatures/figure.ts",
    effect: "The Mutational Signatures download leaves out the chosen signature's reference profile that the page draws under the spectrum, unlike the portal's mutationalBarChart file.",
    find: "const sc = spectrumChart(s, W, 8, p, true);",
    replace: "const sc = spectrumChart({ ...s, reference: null }, W, 8, p, true);" },
];
