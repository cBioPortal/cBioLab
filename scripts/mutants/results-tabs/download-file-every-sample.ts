// Planted bugs: the Download tab's gene-by-sample files list every queried sample (NP for a study without the profile).
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "download-file-holders-only", layer: "counts", guard: "unit", file: "lib/views/datafiles/run.ts",
    effect: "A study without a mutation profile drops out of mutations.txt, where the portal lists its samples as NP.",
    find: "const r = await runRows(ctx, \"datafiles:\" + id, holders, tq, defs, shown, n,",
    replace: "const r = await runRows(ctx, \"datafiles:\" + id, file ? file.studies : holders, tq, defs, shown, n," },
  { id: "download-file-np-reads-data", layer: "counts", guard: "unit", file: "lib/views/datafiles/tables.ts",
    effect: "A study without the file's profile is read as if it had one, so its samples read WT or NA rather than NP.",
    find: "    if (!holds(p.study)) {",
    replace: "    if (false) {" },
  { id: "download-file-rows-holders-only", layer: "counts", guard: "unit", file: "lib/views/datafiles/run.ts",
    effect: "A file's row count leaves out the samples of a study without its profile.",
    find: "group: \"data\" as const, portalFile: f.portalFile, rows: holders.reduce(",
    replace: "group: \"data\" as const, portalFile: f.portalFile, rows: f.studies.reduce(" },
];
