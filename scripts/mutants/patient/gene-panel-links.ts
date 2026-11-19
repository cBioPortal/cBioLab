// Planted bugs: the Patient page's "Gene Panel" values as links to the gene panel window (PAT-GP-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "gene-panel-link-whole-text", layer: "counts", guard: "unit", file: "lib/gene-panel-list.ts",
    effect: "\"TESTPANEL2 (mut)\" opens a panel named \"TESTPANEL2 (mut)\", where the portal opens TESTPANEL2.",
    find: "text === \"WXS\" ? null : text.split(\" \")[0] }));",
    replace: "text === \"WXS\" ? null : text }));" },
  { id: "gene-panel-na-linked", layer: "counts", guard: "unit", file: "lib/gene-panel-list.ts",
    effect: "An N/A gene panel value is a link to a panel that does not exist.",
    find: "panel: text.includes(\"N/A\") || text === \"WXS\" ? null",
    replace: "panel: text === \"WXS\" ? null" },
];
