// Every view kind's part of the DSL reference (lib/views/<kind>/doc.ts), by kind: its row of the
// Views table in docs/dsl.md, its entry in the agent grammar and its own gallery examples.
// lib/dsl-reference.ts assembles them, in this order. A new kind is one entry here, beside its
// lines in lib/views/index.ts, lib/views/kinds.ts and app/lab/kinds/index.ts.
import type { ViewKind } from "../types.ts";
import type { KindDoc } from "./kind-doc.ts";
import { compareDoc } from "./compare/doc.ts";
import { clinicalDoc } from "./clinical/doc.ts";
import { cooccurrenceDoc } from "./cooccurrence/doc.ts";
import { hotspotsDoc } from "./hotspots/doc.ts";
import { coexpressionDoc } from "./coexpression/doc.ts";
import { survivalDoc } from "./survival/doc.ts";
import { coxDoc } from "./cox/doc.ts";
import { logisticDoc } from "./logistic/doc.ts";
import { forestDoc } from "./forest/doc.ts";
import { adjustedDoc } from "./adjusted/doc.ts";
import { courseDoc } from "./course/doc.ts";
import { sequenceDoc } from "./sequence/doc.ts";
import { plotDoc } from "./plot/doc.ts";
import { attritionDoc } from "./attrition/doc.ts";
import { genomeDoc } from "./genome/doc.ts";
import { pathwaysDoc } from "./pathways/doc.ts";
import { diffexprDoc } from "./diffexpr/doc.ts";
import { pairedDoc } from "./paired/doc.ts";
import { acquiredDoc } from "./acquired/doc.ts";
import { ctdnaDoc } from "./ctdna/doc.ts";
import { exclusivityDoc } from "./exclusivity/doc.ts";
import { instabilityDoc } from "./instability/doc.ts";
import { clonalityDoc } from "./clonality/doc.ts";
import { incidenceDoc } from "./incidence/doc.ts";
import { cutpointDoc } from "./cutpoint/doc.ts";
import { hlaDoc } from "./hla/doc.ts";
import { predictiveDoc } from "./predictive/doc.ts";
import { rmstDoc } from "./rmst/doc.ts";
import { multistateDoc } from "./multistate/doc.ts";
import { txendpointsDoc } from "./txendpoints/doc.ts";
import { riskmodelDoc } from "./riskmodel/doc.ts";
import { labsDoc } from "./labs/doc.ts";
import { cancertypesDoc } from "./cancertypes/doc.ts";
import { overlapDoc } from "./overlap/doc.ts";
import { enrichmentDoc } from "./enrichment/doc.ts";
import { actionabilityDoc } from "./actionability/doc.ts";
import { drivernegativeDoc } from "./drivernegative/doc.ts";
import { organotropismDoc } from "./organotropism/doc.ts";
import { molsubtypeDoc } from "./molsubtype/doc.ts";
import { germlineDoc } from "./germline/doc.ts";
import { assaysDoc } from "./assays/doc.ts";
import { compositionDoc } from "./composition/doc.ts";
import { mutationsDoc } from "./mutations/doc.ts";
import { tableDoc } from "./table/doc.ts";
import { timelineDoc } from "./timeline/doc.ts";
import { alterationsDoc } from "./alterations/doc.ts";
import { correlatesDoc } from "./correlates/doc.ts";
import { oncoprintDoc } from "./oncoprint/doc.ts";

export const KIND_DOCS: Record<ViewKind, KindDoc> = {
  compare: compareDoc,
  clinical: clinicalDoc,
  cooccurrence: cooccurrenceDoc,
  hotspots: hotspotsDoc,
  coexpression: coexpressionDoc,
  survival: survivalDoc,
  cox: coxDoc,
  logistic: logisticDoc,
  forest: forestDoc,
  adjusted: adjustedDoc,
  course: courseDoc,
  sequence: sequenceDoc,
  plot: plotDoc,
  attrition: attritionDoc,
  genome: genomeDoc,
  pathways: pathwaysDoc,
  diffexpr: diffexprDoc,
  paired: pairedDoc,
  acquired: acquiredDoc,
  ctdna: ctdnaDoc,
  exclusivity: exclusivityDoc,
  instability: instabilityDoc,
  clonality: clonalityDoc,
  incidence: incidenceDoc,
  cutpoint: cutpointDoc,
  hla: hlaDoc,
  predictive: predictiveDoc,
  rmst: rmstDoc,
  multistate: multistateDoc,
  txendpoints: txendpointsDoc,
  riskmodel: riskmodelDoc,
  labs: labsDoc,
  cancertypes: cancertypesDoc,
  overlap: overlapDoc,
  enrichment: enrichmentDoc,
  actionability: actionabilityDoc,
  drivernegative: drivernegativeDoc,
  organotropism: organotropismDoc,
  molsubtype: molsubtypeDoc,
  germline: germlineDoc,
  assays: assaysDoc,
  composition: compositionDoc,
  mutations: mutationsDoc,
  table: tableDoc,
  timeline: timelineDoc,
  alterations: alterationsDoc,
  correlates: correlatesDoc,
  oncoprint: oncoprintDoc,
};
