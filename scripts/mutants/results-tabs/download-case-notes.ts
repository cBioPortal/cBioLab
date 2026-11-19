// Planted bugs: the Download tab's case table, each call's germline and driver note (RDL-3.4)
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "download-case-no-driver-note",
    layer: "counts",
    guard: "results-oql",
    file: "lib/oql.ts",
    effect: "A putative driver in the case table reads \"E545K\", where the portal writes \"E545K (driver)\".",
    find: "if(g.variant_type IN ('mutation', 'cna') AND \" + drv + \", ' (driver)', '')",
    replace: "if(0, ' (driver)', '')" },
  { id: "download-case-hotspots-ignored",
    layer: "counts",
    guard: "results-oql",
    file: "lib/oql.ts",
    effect: "A Cancer Hotspots driver (PIK3CA H1047R) gets no (driver) note though the page's settings count hotspots.",
    find: "settings.hotspots && hotspotPins ? hotspotKeysSql(db, [study], genes, hotspotPins) : null",
    replace: "null" },
  { id: "download-case-germline-exact",
    layer: "counts",
    guard: "results-oql",
    file: "lib/oql.ts",
    effect: "A mutation whose status is Germline_LOH reads without [germline], where the portal's GERMLINE_REGEXP marks any status holding it.",
    find: "return \"concat(if(\" + germlineCondSql(\"g\") + \", ' [germline]', '')",
    replace: "return \"concat(if(lower(g.mutation_status) = 'germline', ' [germline]', '')" },
  { id: "download-case-notes-everywhere",
    layer: "counts",
    guard: "unit",
    file: "lib/views/datafiles/tables.ts",
    effect: "The altered and unaltered lists and the sample matrix run the driver annotation for notes nobody reads.",
    find: "statusRows(parts, plan, t === \"cases\")",
    replace: "statusRows(parts, plan, true)" },
];
