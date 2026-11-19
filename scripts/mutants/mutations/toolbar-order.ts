// Planted bugs: the portal tables' toolbar order, Copy · Download · Columns · search (MUT-TB-2). How they are planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {};

export const mutants: Mutant[] = [
  { id: "toolbar-portal-order-lost", layer: "counts", guard: "unit", file: "app/_table/DataTable.tsx",
    effect: "The Mutations table's toolbar reads search, Columns, Copy, Download, where the portal's reads Copy, Download, Columns, search.",
    find: "{portalOrder ? <>{downloads}{columnsButton}{searchBox}</> :", replace: "{false ? <>{downloads}{columnsButton}{searchBox}</> :" },
  { id: "toolbar-portal-order-everywhere", layer: "counts", guard: "unit", file: "app/_table/DataTable.tsx",
    effect: "Every table takes the portal tables' order, the CSV tables' toolbars reordered too.",
    find: "const portalOrder = downloadFormat === \"table-tsv\" && !ownDownload;", replace: "const portalOrder = true;" },
];
