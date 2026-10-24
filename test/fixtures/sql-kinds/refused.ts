// Statements the compiler must refuse (test/sql-kinds.test.ts runs tsc over this file): each
// expected error below mixes what a statement's rows may hold (lib/sql-kinds.ts), and tsc fails
// the test if any of them compiles — if the types stop telling the kinds apart.
import type { AggregateResolver, PatientLevelResolver } from "../../../lib/federation.ts";
import { aggregateSql } from "../../../lib/sql-kinds.ts";
import { adjustedRowsSql } from "../../../lib/views/adjusted/sql.ts";
import { genomeCoverageSql } from "../../../lib/federation-views.ts";

export function refused(agg: AggregateResolver, pl: PatientLevelResolver) {
  // a cohort's own subquery returns patient ids: it is not an aggregate
  // @ts-expect-error -- CohortSql is not AggregateSql
  void agg.viewAggregate("x", null, (cohort) => cohort);
  // nor is text built from it, until a builder declares what its rows hold
  // @ts-expect-error -- string is not AggregateSql
  void agg.viewAggregate("x", null, (cohort) => "SELECT pid FROM (" + cohort + ")");
  // a patient-row builder cannot be handed to an aggregate view, on any participant
  // @ts-expect-error -- PatientSql is not AggregateSql
  void pl.viewAggregate("x", null, (c, s, d) => adjustedRowsSql(c, s, d, { covariates: [] }));
  // an aggregate-only participant has no way to run rows that name patients
  // @ts-expect-error -- AggregateResolver has no viewRows
  void agg.viewRows("x", null, () => aggregateSql("SELECT 1"));
  // and an aggregate builder is not a patient-row builder either
  // @ts-expect-error -- AggregateSql is not PatientSql
  void pl.viewRows("x", null, genomeCoverageSql);
}

export function accepted(agg: AggregateResolver, pl: PatientLevelResolver) {
  void agg.viewAggregate("x", null, genomeCoverageSql);
  void pl.viewAggregate("x", null, genomeCoverageSql);
}
