// View kinds cBioPortal has no counterpart for. The Examples tab and the add-view buttons mark
// them NEW. A kind the portal draws in some form (its Comparison, Plots, Mutations, Pathways or
// patient-view tabs) is left out, even where this one goes further. Each kind's descriptor says
// (`isNew`, lib/views/<kind>/kind.ts). Browser-safe.
import { kindOf } from "./views/kinds.ts";

export const isNewKind = (kind: unknown): boolean => kindOf(kind)?.isNew === true;

/** the mark's hover text */
export const NEW_TITLE = "not in cBioPortal";
