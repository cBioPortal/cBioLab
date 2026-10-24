// What a statement's rows may hold, in its type (invariant 10, docs/DATA-BOUNDARY.md). Every
// participant may run an AggregateSql — rows of counts, sums and other values over many patients —
// but only a patient-level one may run a PatientSql, whose rows name patients or samples; a
// CohortSql is a cohort's patients as a subquery (column `pid`), a building block that is never run
// on its own. The three are strings to the database and distinct to the compiler: a cohort's
// subquery handed to an aggregate runner, or a patient-row builder handed to an aggregate view,
// does not compile. Browser-safe.

declare const rows: unique symbol;
/** A statement whose rows are aggregates over many patients, never one patient's id. */
export type AggregateSql = string & { readonly [rows]: "aggregate" };
/** A statement whose rows name patients or samples: run only by a patient-level participant. */
export type PatientSql = string & { readonly [rows]: "patient" };
/** A cohort's patients as a subquery (column pid): aggregated or joined, never returned. */
export type CohortSql = string & { readonly [rows]: "cohort" };

/** `sql`, declared to return only aggregates — what its builder promises, swept by test/boundary.test.ts */
export const aggregateSql = (sql: string): AggregateSql => sql as AggregateSql;
/** `sql`, declared to return rows that name patients or samples */
export const patientSql = (sql: string): PatientSql => sql as PatientSql;
/** a compiled cohort, as a subquery */
export const cohortSubquery = (sql: string): CohortSql => sql as CohortSql;
