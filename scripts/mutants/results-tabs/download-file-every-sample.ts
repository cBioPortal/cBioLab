// Planted bugs: the Download tab's gene-by-sample files list every queried sample (NP for a study without the profile).
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "download-file-holders-only", layer: "counts", guard: "unit", file: "lib/views/datafiles/run.ts",
    effect: "A study without a mutation profile drops out of mutations.txt, where the portal lists its samples as NP.",
    find: "const r = await runRows(ctx, \"datafiles:\" + id, file && !everySample(file.matrix) ? file.studies : holders, tq, defs, shown, n,",
    replace: "const r = await runRows(ctx, \"datafiles:\" + id, file ? file.studies : holders, tq, defs, shown, n," },
  { id: "download-file-np-reads-data", layer: "counts", guard: "unit", file: "lib/views/datafiles/tables.ts",
    effect: "A study without the file's profile is read as if it had one, so its samples read WT or NA rather than NP.",
    find: "    if (!holds(p)) {",
    replace: "    if (false) {" },
  { id: "download-file-rows-holders-only", layer: "counts", guard: "unit", file: "lib/views/datafiles/run.ts",
    effect: "A file's row count leaves out the samples of a study without its profile.",
    find: "rows: (every ? holders : f.studies).reduce(",
    replace: "rows: f.studies.reduce(" },
  { id: "download-file-np-in-other-profiles", layer: "counts", guard: "unit", file: "lib/views/datafiles/tables.ts",
    effect: "A non-selected profile's file (<profile name>.txt) lists every queried sample with NP for a study without it, where the portal's lists only its holders' samples and never writes NP.",
    find: "export const everySample = (f: MatrixFile): boolean => f.kind !== \"profile\";",
    replace: "export const everySample = (f: MatrixFile): boolean => true || f.kind !== \"profile\";" },
  { id: "download-cna-one-profile-id", layer: "counts", guard: "unit", file: "lib/views/datafiles/tables.ts",
    effect: "cna.txt reads one study's copy-number profile id in every study, so a study whose discrete profile has another id reads NA throughout.",
    find: "const profile = f.kind === \"cna\" ? f.profiles[study] : f.profile;",
    replace: "const profile = f.kind === \"cna\" ? Object.values(f.profiles)[0] : f.profile;" },
];
