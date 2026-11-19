// Planted bugs: the mutation table's Copy button (MUT-TB-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "copy-refusal-silent", layer: "counts", guard: "unit", file: "app/_table/copy-text.ts",
    effect: "A browser that refuses the copy still reads as copied, so the reader pastes nothing.",
    find: "if (!ok) throw new Error(\"the browser refused to copy\");", replace: "" },
  { id: "copy-textarea-left", layer: "counts", guard: "unit", file: "app/_table/copy-text.ts",
    effect: "Each copy on a plain-http address leaves a hidden textarea of the whole table in the page.",
    find: "  area.remove();\n", replace: "" },
  { id: "copy-cut-short-as-whole", layer: "counts", guard: "unit", file: "lib/table-tsv.ts",
    effect: "A table download cut short (its # DOWNLOAD INCOMPLETE line) is copied as if it were the whole table.",
    find: "const line = text.split(/\\r?\\n/).find((l) => l.startsWith(INCOMPLETE_MARK));", replace: "const line = undefined as string | undefined;" },
  { id: "copy-no-fallback-on-refusal", layer: "counts", guard: "unit", file: "app/_table/copy-text.ts",
    effect: "A secure page whose Clipboard API refuses gives up instead of trying the textarea copy.",
    find: "      await navigator.clipboard.writeText(text);\n      return;\n    } catch {", replace: "      await navigator.clipboard.writeText(text);\n      return;\n    } finally {" },
  { id: "copy-key-ignores-rows", layer: "counts", guard: "unit", file: "lib/table-tsv.ts",
    effect: "A fetched copy survives a change to a study's rows, so Copy Ready! pastes the old table.",
    find: "t.lists.map((l) => [l.cohort, l.study, l.total, l.all]), t.total, t.all]", replace: "t.total]" },
  { id: "copy-key-ignores-sort", layer: "counts", guard: "unit", file: "lib/table-tsv.ts",
    effect: "A fetched copy survives a sort, so Copy Ready! pastes the rows in the old order.",
    find: "return JSON.stringify([t.query, t.columns", replace: "return JSON.stringify([null, t.columns" },
];
