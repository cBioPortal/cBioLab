// A Study View chart's per-case files (Full Data, Data) and the header's "Download clinical data",
// as cBioPortal writes them. The rows are the clinical `table` view's, read through POST /api/table
// with a `format`, so they come only from a study that may list its patients
// (docs/DATA-BOUNDARY.md). The rules, case by case: docs/legacy-spec/parity/download-cases.md (PC).
// Browser-safe; no I/O.
import type { AnalysisDoc, CohortDef } from "./types.ts";
import type { TableView } from "./views/table/types.ts";
import type { TableQuery } from "./table-query.ts";
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
  | { kind: "clinical" }
  /** the Clinical Data tab's download: its columns, its search and sort, and how many studies it spans */
  | { kind: "tab"; columns: string[]; query: TableQuery; studies: number };

/** the name the selection's cohort goes by in the file's document */
export const CASE_FILE_COHORT = "Selection";

/**
 * How /api/table writes a file: its study column's header, and attribute headers by name or by id.
 * `table`: the Clinical Data tab's table layout (clinical-tab-cases.md CT11, CT12): the study
 * column third and only when `studyColumn`, a missing value empty, every line ending in CRLF.
 */
export interface CaseFileFormat { study: "Study ID" | "Cancer Study"; header: "names" | "ids"; table?: { studyColumn: boolean } }

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
  } else if (file.kind === "tab") {
    Object.assign(view, { unit: "sample", columns: file.columns,
      ...(file.query.search ? { search: file.query.search } : {}), ...(file.query.sort ? { sort: file.query.sort } : {}) });
  } else {
    view.unit = "sample";
  }
  return { dsl: DOC_VERSION, study, cohorts: { [CASE_FILE_COHORT]: def }, views: [view] };
}

/** how the route writes `file` */
export function caseFileFormat(file: CaseFile): CaseFileFormat {
  if (file.kind === "tab") return { study: "Cancer Study", header: "names", table: { studyColumn: file.studies > 1 } };
  return { study: file.kind === "density" ? "Cancer Study" : "Study ID", header: file.kind === "survival" ? "ids" : "names" };
}

/** the table's own columns, written by their names whatever the format */
const ID_COLUMNS = new Set(["patient", "sample"]);

/**
 * The file's header line, no line ending: the study column's header, then each column's (the id
 * columns by their names, Patient ID and Sample ID; an attribute by its name or id, as `format` says).
 */
export function caseFileHeader(columns: { id: string; name: string }[], format: CaseFileFormat): string {
  if (format.table) return inTable(columns.map((c) => c.name), format.study, format.table.studyColumn).join("\t");
  return [format.study, ...columns.map((c) => format.header === "ids" && !ID_COLUMNS.has(c.id) ? c.id : c.name)].join("\t");
}

/** a value as a file's field: a tab or line break as a space, a missing value as NA */
const field = (v: string) => v === "" ? "NA" : v.replace(/[\t\r\n]/g, " ");

/** what goes before each row's line and after every line, the header's included */
export function caseFileBreaks(format: CaseFileFormat): { before: string; after: string } {
  return format.table ? { before: "", after: "\r\n" } : { before: "\n", after: "" };
}

/**
 * How many attributes a file of every attribute leaves out of `of` (download-cases PC15): only a
 * file that asks for no columns of its own lists every attribute, so only it is short when the
 * table holds fewer; null when nothing is left out.
 */
export function caseFileColumnsCut(t: { query: { columns?: string[] }; attributesOf?: number }, held: number): { held: number; of: number } | null {
  return !t.query.columns?.length && t.attributesOf != null && t.attributesOf > held ? { held, of: t.attributesOf } : null;
}

/** the line breaks a whole file of `rows` rows holds, header included: what the download checks it received */
export function caseFileLineBreaks(rows: number, format: CaseFileFormat): number {
  return format.table ? rows + 1 : rows;
}

/** the table layout's fields: the study, when it has a column, third, after Patient ID and Sample ID */
const inTable = (fields: string[], study: string, studyColumn: boolean) => studyColumn ? [...fields.slice(0, 2), study, ...fields.slice(2)] : fields;

/** one row's line, no line ending: its study, then its values, a missing value as NA (`format.table`: as CT12 says) */
export function caseFileLine(study: string, values: string[], format?: CaseFileFormat): string {
  if (format?.table) return inTable(values, study, format.table.studyColumn).map((v) => v.replace(/[\t\r\n]/g, " ")).join("\t");
  return [study, ...values].map(field).join("\t");
}

/** the file's name: from the chart's name for a chart's file, from the studies for clinical data */
export function caseFileName(file: CaseFile, chartName: string, studies: string[]): string {
  if (file.kind === "clinical" || file.kind === "tab") return (studies.length === 1 ? studies[0] : "combined_study") + "_clinical_data.tsv";
  return chartFileName(chartName, file.kind === "full" ? "full" : "data");
}
