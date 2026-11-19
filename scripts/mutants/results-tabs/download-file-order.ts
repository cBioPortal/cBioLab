// Planted bugs: the Download tab's data-file rows in the portal's order (RDL-1.1…1.9)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "download-order-cna-after-sv",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/run.ts",
    effect: "Copy-number Alterations is listed after Mutations and Structural Variants, where the portal lists it first.",
    find: "if (Object.keys(cnaOf).length) out.unshift({ id: \"cna\"",
    replace: "if (Object.keys(cnaOf).length) out.push({ id: \"cna\"" },
  { id: "download-order-chosen-profile-in-place",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/run.ts",
    effect: "The mRNA profile the query selected stays among the other profiles, where the portal lists it right after Structural Variants.",
    find: "[...chosen.flatMap((c) => listed.filter((x) => x.profile === c)), ...listed.filter((x) => !isChosen(x))]",
    replace: "listed" },
  { id: "download-order-lists-last",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/run.ts",
    effect: "The altered / unaltered lists and the sample matrix come after every profile, where the portal lists them before the profiles not selected.",
    find: "    ...offered.filter((f) => !f.selected).map(file(perStudy)),\n  ];",
    replace: "  ];" },
];
