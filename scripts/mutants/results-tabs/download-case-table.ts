// Planted bugs: the Download tab's case table (Study ID, Altered 1 / 0, 20 rows a page)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "download-cases-altered-as-text",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/tables.ts",
    effect: "The case table's Altered column reads \"altered\" / \"unaltered\", where the portal writes 1 / 0.",
    find: "if (c.id === \"altered\") return \"multiIf(status = 'altered', '1', status = 'unaltered', '0', 'NP')\";",
    replace: "if (c.id === \"altered\") return t === \"matrix\" ? \"multiIf(status = 'altered', '1', status = 'unaltered', '0', 'NP')\" : \"status\";" },
  { id: "download-cases-unprofiled-as-0",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/run.ts",
    effect: "A sample not profiled for every queried gene reads 0 (unaltered) in the case table, where it is NP.",
    find: "return x.status === \"altered\" ? \"1\" : x.status === \"unaltered\" ? \"0\" : \"NP\";",
    replace: "return x.status === \"altered\" ? \"1\" : \"0\";" },
  { id: "download-cases-page-25",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/run.ts",
    effect: "The case table shows 25 rows a page, where the portal shows 20.",
    find: "const pageSize = (n: unknown) => n == null ? 20 : Math.floor(Number(n));",
    replace: "const pageSize = (n: unknown) => n == null ? 25 : Math.floor(Number(n));" },
];
