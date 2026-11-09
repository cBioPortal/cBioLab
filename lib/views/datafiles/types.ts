// The datafiles view's spec and result, added to lib/types.ts's maps by the declaration at the end.
import type { TableRows } from "../../types.ts";
import type { TableQuery } from "../../table-query.ts";

/**
 * cBioPortal's Results-page Download tab: for one cohort and a gene query (OQL, one entry per line),
 * the files a reader can take away — each queried gene's mutations, structural variants and values
 * in every molecular profile the studies hold, the altered and unaltered sample lists, the sample
 * matrix — with the gene alteration frequencies and the table of each sample's alterations. Every
 * file and the case table name samples, so only a patient-level participant contributes them; the
 * top-level query (columns/search/filters/sort) is the case table's.
 */
export interface DatafilesView extends TableQuery {
  note?: string;
  kind: "datafiles"; cohorts?: string[];
  /** the gene query, one OQL entry per line as the Results page holds it: "TP53", "KRAS: MUT AMP" */
  oql: string[];
  /** the profile the lines' EXP / PROT alterations read (an id without the study prefix), as an `oql` cohort clause's `exp` / `prot` */
  exp?: string;
  prot?: string;
  /** as an `oql` clause's: a study without the exp / prot profile has no EXP / PROT alterations */
  ifHeld?: boolean;
  /** rows per page of the case table (default 25, at most 1000) */
  rows?: number;
}

/** One downloadable file: a table of the view, downloaded whole as CSV through POST /api/table with `table: id`. */
export interface DataFile {
  id: string;
  /** what the portal calls it */
  name: string;
  /** what each row and column holds */
  description: string;
  /** what it is: a gene-by-sample matrix (the query's OQL not in effect), a sample list, or the sample matrix */
  group: "data" | "list";
  /** rows the file holds (one per sample of the cohort, or of the list) */
  rows: number;
  /** the studies whose samples it holds, where that is fewer than the view's: a profile only some studies have */
  studies?: string[];
}

/** One query line's frequency in the cohort's samples: altered ÷ profiled for that line's gene and data types. */
export interface LineFrequency {
  line: string; gene: string;
  /** samples the line alters that were profiled for it */
  altered: number;
  /** samples profiled for the gene in any data type the line reads */
  profiled: number;
  /** altered ÷ profiled × 100, null when nothing was profiled */
  percent: number | null;
  /** samples the line alters that their panels say were not profiled for it (left out of `altered`) */
  offPanel: number;
}

export interface DatafilesResult extends TableRows<string | number | null> {
  /** the query's lines and their genes, in order; each is a column of the case table and the sample matrix */
  lines: { line: string; gene: string; column: string }[];
  /** the samples of the cohort, as the query sorts them: altered by some line, unaltered (profiled for every gene and data type the query reads), or neither */
  counts: { samples: number; altered: number; unaltered: number; unprofiled: number };
  frequency: LineFrequency[];
  files: DataFile[];
  /** a file's table, on a request that names it (RunOpts.table) */
  tables: Partial<Record<string, TableRows<string | number | null>>>;
  /** lines whose expression or protein condition cannot be checked for profiling: every sample counts as profiled for them */
  unchecked: string[];
  oncokbPin: string | null;
}

declare module "../../types.ts" {
  interface ViewSpecs { datafiles: DatafilesView }
  interface ViewResultFields {
    datafiles: {
      datafiles?: DatafilesResult;
    };
  }
  interface ViewResultMain { datafiles: "datafiles" }
}
