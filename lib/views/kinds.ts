// Every view kind's descriptor (lib/views/<kind>/kind.ts), by kind: what the pages, the figures, the
// results text, the help and the federation rules read about a kind. A new kind is one entry here,
// one in lib/views/index.ts (its runner), one in lib/views/docs.ts (its DSL reference) and one in
// app/lab/kinds/index.ts (its page file). Browser-safe.
import type { ViewKind, ViewResult } from "../types.ts";
import type { SvgOpts } from "../svg-kit.ts";
import type { ViewHelp } from "../view-help.ts";
import type { Need } from "../view-coverage.ts";
import type { TextContext, ViewKindDef } from "./kind-def.ts";
import { acquiredKind } from "./acquired/kind.ts";
import { actionabilityKind } from "./actionability/kind.ts";
import { adjustedKind } from "./adjusted/kind.ts";
import { alterationsKind } from "./alterations/kind.ts";
import { assaysKind } from "./assays/kind.ts";
import { attritionKind } from "./attrition/kind.ts";
import { cancertypesKind } from "./cancertypes/kind.ts";
import { clinicalKind } from "./clinical/kind.ts";
import { clonalityKind } from "./clonality/kind.ts";
import { coexpressionKind } from "./coexpression/kind.ts";
import { compareKind } from "./compare/kind.ts";
import { compositionKind } from "./composition/kind.ts";
import { cooccurrenceKind } from "./cooccurrence/kind.ts";
import { correlatesKind } from "./correlates/kind.ts";
import { courseKind } from "./course/kind.ts";
import { coxKind } from "./cox/kind.ts";
import { ctdnaKind } from "./ctdna/kind.ts";
import { cutpointKind } from "./cutpoint/kind.ts";
import { diffexprKind } from "./diffexpr/kind.ts";
import { drivernegativeKind } from "./drivernegative/kind.ts";
import { enrichmentKind } from "./enrichment/kind.ts";
import { exclusivityKind } from "./exclusivity/kind.ts";
import { forestKind } from "./forest/kind.ts";
import { genomeKind } from "./genome/kind.ts";
import { germlineKind } from "./germline/kind.ts";
import { hlaKind } from "./hla/kind.ts";
import { hotspotsKind } from "./hotspots/kind.ts";
import { incidenceKind } from "./incidence/kind.ts";
import { instabilityKind } from "./instability/kind.ts";
import { labsKind } from "./labs/kind.ts";
import { logisticKind } from "./logistic/kind.ts";
import { molsubtypeKind } from "./molsubtype/kind.ts";
import { multistateKind } from "./multistate/kind.ts";
import { mutationsKind } from "./mutations/kind.ts";
import { oncoprintKind } from "./oncoprint/kind.ts";
import { organotropismKind } from "./organotropism/kind.ts";
import { overlapKind } from "./overlap/kind.ts";
import { pairedKind } from "./paired/kind.ts";
import { pathwaysKind } from "./pathways/kind.ts";
import { plotKind } from "./plot/kind.ts";
import { predictiveKind } from "./predictive/kind.ts";
import { riskmodelKind } from "./riskmodel/kind.ts";
import { rmstKind } from "./rmst/kind.ts";
import { sequenceKind } from "./sequence/kind.ts";
import { survivalKind } from "./survival/kind.ts";
import { tableKind } from "./table/kind.ts";
import { timelineKind } from "./timeline/kind.ts";
import { txendpointsKind } from "./txendpoints/kind.ts";

/** one entry per kind: a kind in the View union without one is a type error here */
export const KINDS: { [K in ViewKind]: ViewKindDef<K> } = {
  acquired: acquiredKind,
  actionability: actionabilityKind,
  adjusted: adjustedKind,
  alterations: alterationsKind,
  assays: assaysKind,
  attrition: attritionKind,
  cancertypes: cancertypesKind,
  clinical: clinicalKind,
  clonality: clonalityKind,
  coexpression: coexpressionKind,
  compare: compareKind,
  composition: compositionKind,
  cooccurrence: cooccurrenceKind,
  correlates: correlatesKind,
  course: courseKind,
  cox: coxKind,
  ctdna: ctdnaKind,
  cutpoint: cutpointKind,
  diffexpr: diffexprKind,
  drivernegative: drivernegativeKind,
  enrichment: enrichmentKind,
  exclusivity: exclusivityKind,
  forest: forestKind,
  genome: genomeKind,
  germline: germlineKind,
  hla: hlaKind,
  hotspots: hotspotsKind,
  incidence: incidenceKind,
  instability: instabilityKind,
  labs: labsKind,
  logistic: logisticKind,
  molsubtype: molsubtypeKind,
  multistate: multistateKind,
  mutations: mutationsKind,
  oncoprint: oncoprintKind,
  organotropism: organotropismKind,
  overlap: overlapKind,
  paired: pairedKind,
  pathways: pathwaysKind,
  plot: plotKind,
  predictive: predictiveKind,
  riskmodel: riskmodelKind,
  rmst: rmstKind,
  sequence: sequenceKind,
  survival: survivalKind,
  table: tableKind,
  timeline: timelineKind,
  txendpoints: txendpointsKind,
};

/** A descriptor as code that holds a result of any kind calls it: each entry takes only its own kind's result, which its key guarantees. */
export interface AnyKindDef {
  kind: ViewKind;
  figure?: (v: ViewResult, o: SvgOpts) => string | null;
  title?: (v: ViewResult) => string;
  text?: (v: ViewResult, t: TextContext) => void | false;
  help: ViewHelp; need?: Need; preview?: string; isNew?: boolean;
}

/** the descriptor for a view kind, or undefined for a kind the document language does not have */
export function kindOf(kind: unknown): AnyKindDef | undefined {
  const k = String(kind);
  return Object.hasOwn(KINDS, k) ? KINDS[k as ViewKind] as unknown as AnyKindDef : undefined;
}
