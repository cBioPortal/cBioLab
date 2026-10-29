// Every view kind's page-side description (app/lab/kinds/<kind>.tsx), in the add menu's order: what the
// analysis page and the portal tabs read about a kind. A new kind is one file there and one entry here,
// beside its descriptor in lib/views/kinds.ts, its runner in lib/views/index.ts and its DSL reference in
// lib/views/docs.ts.
import type { ViewKind } from "../../../lib/types.ts";
import type { KindUi } from "./kind-ui.ts";
import { acquiredUi } from "./acquired.tsx";
import { actionabilityUi } from "./actionability.tsx";
import { adjustedUi } from "./adjusted.tsx";
import { alterationsUi } from "./alterations.tsx";
import { assaysUi } from "./assays.tsx";
import { attritionUi } from "./attrition.tsx";
import { cancertypesUi } from "./cancertypes.tsx";
import { clinicalUi } from "./clinical.tsx";
import { clonalityUi } from "./clonality.tsx";
import { coexpressionUi } from "./coexpression.tsx";
import { compareUi } from "./compare.tsx";
import { compositionUi } from "./composition.tsx";
import { cooccurrenceUi } from "./cooccurrence.tsx";
import { correlatesUi } from "./correlates.tsx";
import { courseUi } from "./course.tsx";
import { coxUi } from "./cox.tsx";
import { ctdnaUi } from "./ctdna.tsx";
import { cutpointUi } from "./cutpoint.tsx";
import { diffexprUi } from "./diffexpr.tsx";
import { drivernegativeUi } from "./drivernegative.tsx";
import { enrichmentUi } from "./enrichment.tsx";
import { exclusivityUi } from "./exclusivity.tsx";
import { forestUi } from "./forest.tsx";
import { genomeUi } from "./genome.tsx";
import { germlineUi } from "./germline.tsx";
import { hlaUi } from "./hla.tsx";
import { hotspotsUi } from "./hotspots.tsx";
import { incidenceUi } from "./incidence.tsx";
import { instabilityUi } from "./instability.tsx";
import { labsUi } from "./labs.tsx";
import { logisticUi } from "./logistic.tsx";
import { molsubtypeUi } from "./molsubtype.tsx";
import { multistateUi } from "./multistate.tsx";
import { mutationsUi } from "./mutations.tsx";
import { oncoprintUi } from "./oncoprint.tsx";
import { organotropismUi } from "./organotropism.tsx";
import { overlapUi } from "./overlap.tsx";
import { pairedUi } from "./paired.tsx";
import { pathwaysUi } from "./pathways.tsx";
import { plotUi } from "./plot.tsx";
import { predictiveUi } from "./predictive.tsx";
import { riskmodelUi } from "./riskmodel.tsx";
import { rmstUi } from "./rmst.tsx";
import { sequenceUi } from "./sequence.tsx";
import { survivalUi } from "./survival.tsx";
import { tableUi } from "./table.tsx";
import { timelineUi } from "./timeline.tsx";
import { txendpointsUi } from "./txendpoints.tsx";

export const KIND_UI: { [K in ViewKind]: KindUi<K> } = {
  compare: compareUi,
  survival: survivalUi,
  cox: coxUi,
  logistic: logisticUi,
  oncoprint: oncoprintUi,
  hotspots: hotspotsUi,
  plot: plotUi,
  cooccurrence: cooccurrenceUi,
  clinical: clinicalUi,
  coexpression: coexpressionUi,
  course: courseUi,
  sequence: sequenceUi,
  attrition: attritionUi,
  genome: genomeUi,
  pathways: pathwaysUi,
  enrichment: enrichmentUi,
  assays: assaysUi,
  composition: compositionUi,
  table: tableUi,
  mutations: mutationsUi,
  timeline: timelineUi,
  alterations: alterationsUi,
  correlates: correlatesUi,
  overlap: overlapUi,
  cancertypes: cancertypesUi,
  labs: labsUi,
  incidence: incidenceUi,
  hla: hlaUi,
  cutpoint: cutpointUi,
  predictive: predictiveUi,
  rmst: rmstUi,
  multistate: multistateUi,
  txendpoints: txendpointsUi,
  clonality: clonalityUi,
  paired: pairedUi,
  acquired: acquiredUi,
  instability: instabilityUi,
  exclusivity: exclusivityUi,
  ctdna: ctdnaUi,
  riskmodel: riskmodelUi,
  drivernegative: drivernegativeUi,
  organotropism: organotropismUi,
  germline: germlineUi,
  molsubtype: molsubtypeUi,
  actionability: actionabilityUi,
  adjusted: adjustedUi,
  forest: forestUi,
  diffexpr: diffexprUi,
};

/** a kind's page-side description, whatever kind it is */
export type AnyKindUi = KindUi<ViewKind>;

/** the description of a kind known only at run time, or undefined for one the page does not know */
export const kindUi = (kind: unknown): AnyKindUi | undefined =>
  Object.prototype.hasOwnProperty.call(KIND_UI, String(kind)) ? (KIND_UI as Record<string, AnyKindUi>)[String(kind)] : undefined;
