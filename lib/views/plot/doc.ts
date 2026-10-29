// The `plot` view in the DSL reference: its row of the Views table, its entry in the agent grammar.
// lib/dsl-reference.ts assembles these from lib/views/docs.ts.
import type { KindDoc } from "../kind-doc.ts";
import { POINTS_CAP } from "../../plot-layers.ts";

/** the plot's points cap as the docs print it */
const POINTS_CAP_TEXT = POINTS_CAP.toLocaleString("en-US");

export const plotDoc: KindDoc = {
  reference: `\`x:axis, y:axis, unit?:"sample"\\|"patient", bins?:[240,160], allPoints?:true, points?:[layer(max 4)], colorBy?:axis, ringBy?:axis, cohorts:[names]\` | two axes over the same cases, aggregated **inside the database**: a scatter comes back as counts per grid cell, a box as quartiles per group, two categoricals as a contingency table. The payload is a few kilobytes whatever the cohort's size. A point is a sample, as on cBioPortal's Plots tab; \`unit:"patient"\` makes it a patient, combining a patient's samples: a numeric value is their mean, a category their common value or "Multiple" where they differ, an alteration counts if any sample has it, and the caption says how many patients had more than one sample. Every case is a point up to ${POINTS_CAP_TEXT} (\`allPoints: false\` turns that off), from a participant that may show cases; \`points\` lists up to four subsets drawn in colour over it — \`{rule:"outliers",n?}\` (the default), \`{rule:"extremes",axis,n}\`, \`{rule:"trend",n}\`, \`{cohort}\` — see **Points** below`,
  grammar: `{"kind":"plot","x":<axis>,"y":<axis>,"unit":"sample|patient","cohorts":[names?],
 "colorBy":<axis>?,"ringBy":<axis>?,"allPoints":true,"bins":[240,160],
 "points":[<layer>?(max 4)]}
  // <layer> = {"rule":"outliers"} | {"rule":"extremes","axis":"x|y","n":50?} | {"rule":"trend","n":50?} | {"cohort":C}
  //   default [{"rule":"outliers"}]; [] draws none; the first layer draws a case two share
  // <axis> = {"source":"clinical","attribute":A,"log":?}
  //        | {"source":"profile","profile":P,"gene":G,"by":"mutationType|mutated"?,"log":?}
  //            // P is one of the study's profiles; what it is (mutations, SVs, discrete or
  //            // continuous copy number, mRNA, protein) comes from the study's own description
  //        | {"source":"alteration","gene":G,"by":"mutated|mutationType|cna|sv"?}  // what a profile axis resolves to
  //        | {"source":"alteration","genes":[G,...(2-20)],"by":"mutated"?}  // any-of-N as one category; only "mutated"
  //        | {"source":"alteration","oql":"KRAS: G12C, STK11: MUT","by":"any|statement"?}
  //            // any: Altered / Unaltered / Not profiled; statement: one group per statement (max 6)
  // two numeric axes -> scatter (binned; every case a point up to ${POINTS_CAP_TEXT}, else sparse-cell outliers); one categorical -> box;
  // two categorical -> a contingency table`,
};
