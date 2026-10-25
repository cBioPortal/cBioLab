// The composition view's SQL: what its runner (run.ts) asks each participant's database for.
// composition: parts of a whole per case (lib/composition.ts builds the vectors)
import type { CompositionSource } from "../../composition.ts";
import { casesCte } from "../../composition.ts";
import { sq } from "../../compiler.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/**
 * Over the cohort's cases that have every part: n, and per part (arrays in part order) Σp and Σp²
 * of the values compared; Σh and Σh² of each case's Shannon entropy; and how many cases were left
 * out — with only some of the parts, or with a part below zero or none above. One row of sums: the
 * vectors are built and summed inside the database.
 */
export function compositionMomentsSql(cohortSql: string, study: string, db: string, s: CompositionSource): AggregateSql {
  const k = s.parts.length;
  return aggregateSql(casesCte(s, study, db, cohortSql) +
    "SELECT count() AS n, sumForEach(ps) AS sx, sumForEach(arrayMap(x -> x * x, ps)) AS sxx, sum(h) AS hx, sum(h * h) AS hxx,\n" +
    "       (SELECT countIf(k < " + k + ") FROM raw) AS incomplete,\n" +
    "       (SELECT countIf(k = " + k + " AND NOT (lo >= 0 AND tot > 0)) FROM raw) AS invalid\n" +
    "FROM cases");
}

/** A generic-assay profile's entities, in id order. Metadata: an entity is a cell type or a
 *  signature, never a case. */
export function compositionEntitiesSql(study: string, db: string, profileType: string): AggregateSql {
  return aggregateSql("WITH entities AS (\n" +
    "  SELECT DISTINCT entity_stable_id AS entity FROM " + db + ".generic_assay_data_derived\n" +
    "  WHERE profile_type = " + sq(profileType) + " AND profile_stable_id = " + sq(study + "_" + profileType) + "\n" +
    ")\nSELECT entity FROM entities ORDER BY entity");
}
