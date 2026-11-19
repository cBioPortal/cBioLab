// Planted bugs: the Patient page's cohort pager stepping through a #navCaseIds link in the link's order (PAT-URL-4). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "nav-listed-order-ignored", layer: "cohorts", guard: "unit", file: "lib/clinical-table.ts",
    effect: "A #navCaseIds link's patients are stepped through by patient id (P01, P04, P05), not in the link's order (P05, P01, P04).",
    find: "defaultOrder: (listed?.length ? listedOrder(listed) + \", \" : \"\") + \"patient, sample\",",
    replace: "defaultOrder: \"patient, sample\"," },
  { id: "nav-listed-unnamed-first", layer: "cohorts", guard: "unit", file: "lib/clinical-table.ts",
    effect: "Patients the link does not name come before those it does.",
    find: "return \"if(\" + at + \" = 0, \" + (listed.length + 1) + \", \" + at + \")\";",
    replace: "return at;" },
  { id: "nav-listed-lost-on-step", layer: "cohorts", guard: "unit", file: "app/portal/cohort-navigation.ts",
    effect: "The link's order is lost on the next patient's page, which steps by patient id.",
    find: "const order = { search: nav.order.search, filters: nav.order.filters, sort: nav.order.sort, ...(nav.listed ? { listed: true } : {}) };",
    replace: "const order = { search: nav.order.search, filters: nav.order.filters, sort: nav.order.sort };" },
];
