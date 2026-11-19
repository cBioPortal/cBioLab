// Planted bugs: a table download writes the rows its sizing run read and pages on after them (app/api/table, lib/table-stream.ts). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "download-first-rows-twice", layer: "counts", guard: "unit", file: "lib/table-stream.ts",
    effect: "A download writes its first chunk of rows twice: once from the run that sized it, once more from the first page.",
    find: "for (let offset = from; offset < total; offset += chunk) {", replace: "for (let offset = 0; offset < total; offset += chunk) {" },
  { id: "download-first-rows-dropped", layer: "counts", guard: "unit", file: "lib/table-stream.ts",
    effect: "A download skips the rows its sizing run read, so the file starts at the second chunk (or holds only its header).",
    find: "        if (from) controller.enqueue(enc.encode(write.rows(have!)));\n", replace: "" },
  { id: "download-later-rows-skipped", layer: "counts", guard: "unit", file: "lib/table-stream.ts",
    effect: "A download past one chunk stops after its first chunk, the rest of the table missing with no cut line.",
    find: "for (let offset = from; offset < total; offset += chunk) {", replace: "for (let offset = from; offset < (from ? from : total); offset += chunk) {" },
];
