// A Study View chart's per-case files (Full Data, Data) and the header's "Download clinical data",
// as cBioPortal writes them. The rows are the clinical `table` view's, read through POST /api/table
// with a `format`, so they come only from a study that may list its patients
// (docs/DATA-BOUNDARY.md). The rules, case by case: docs/legacy-spec/parity/download-cases.md (PC).
// Browser-safe; no I/O.
import type { AnalysisDoc, CohortDef } from "./types.ts";
import type { TableView } from "./views/table/types.ts";
import { DOC_VERSION } from "./doc-version.ts";
import { chartFileName } from "./study-view-download.ts";

/** which file: a chart's per-case data, or every attribute of the selection */
export type CaseFile =
  /** a clinical pie or list chart's Full Data, or a clinical bar chart's Data */
  | { kind: "full"; attribute: string; per: "patient" | "sample" }
  /** the density chart's Data: x and y as the chart draws them */
  | { kind: "density"; x: string; y: string }
  /** the survival chart's Data: the endpoint's status and months attributes */
  | { kind: "survival"; status: string; months: string }
  /** the header's "Download clinical data": every attribute, one row per selected sample */
  | { kind: "clinical" };

/** the name the selection's cohort goes by in the file's document */
export const CASE_FILE_COHORT = "Selection";

/** how /api/table writes a file: its study column's header, and attribute headers by name or by id */
export interface CaseFileFormat { study: "Study ID" | "Cancer Study"; header: "names" | "ids" }

/** the rows with a value, as the portal lists every recorded value (a numeric column's ">89" included) */
const HAS_VALUE = { present: true } as const;

/**
 * The document whose one view is the file's rows: the clinical `table` view over the selection
 * (`def`, in `study`'s document), with the columns, unit and filters the file needs.
 */
export function caseFileDoc(file: CaseFile, def: CohortDef, study: string): AnalysisDoc {
  const view: TableView = { kind: "table", cohorts: [CASE_FILE_COHORT] };
  if (file.kind === "full") {
    if (file.per === "patient") Object.assign(view, { unit: "patient", columns: ["patient", file.attribute] });
    else Object.assign(view, { unit: "sample", columns: ["patient", "sample", file.attribute] });
    view.filters = { [file.attribute]: HAS_VALUE };
  } else if (file.kind === "density") {
    Object.assign(view, { unit: "sample", columns: ["patient", "sample", file.x, file.y], filters: { [file.x]: HAS_VALUE, [file.y]: HAS_VALUE } });
  } else if (file.kind === "survival") {
    Object.assign(view, { unit: "patient", columns: ["patient", file.status, file.months] });
  } else {
    view.unit = "sample";
  }
  return { dsl: DOC_VERSION, study, cohorts: { [CASE_FILE_COHORT]: def }, views: [view] };
}

/** how the route writes `file` */
export function caseFileFormat(file: CaseFile): CaseFileFormat {
  return { study: file.kind === "density" ? "Cancer Study" : "Study ID", header: file.kind === "survival" ? "ids" : "names" };
}

/** the table's own columns, written by their names whatever the format */
const ID_COLUMNS = new Set(["patient", "sample"]);

/**
 * The file's header line, no line ending: the study column's header, then each column's (the id
 * columns by their names, Patient ID and Sample ID; an attribute by its name or id, as `format` says).
 */
export function caseFileHeader(columns: { id: string; name: string }[], format: CaseFileFormat): string {
  return [format.study, ...columns.map((c) => format.header === "ids" && !ID_COLUMNS.has(c.id) ? c.id : c.name)].join("\t");
}

/** a value as a file's field: a tab or line break as a space, a missing value as NA */
const field = (v: string) => v === "" ? "NA" : v.replace(/[\t\r\n]/g, " ");

/** one row's line, no line ending: its study, then its values, a missing value as NA */
export function caseFileLine(study: string, values: string[]): string {
  return [study, ...values].map(field).join("\t");
}

/** the file's name: from the chart's name for a chart's file, from the studies for clinical data */
export function caseFileName(file: CaseFile, chartName: string, studies: string[]): string {
  if (file.kind === "clinical") return (studies.length === 1 ? studies[0] : "combined_study") + "_clinical_data.tsv";
  return chartFileName(chartName, file.kind === "full" ? "full" : "data");
}
