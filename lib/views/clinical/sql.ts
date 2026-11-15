// The clinical view's own SQL: what its runner (run.ts) asks each participant's database for
// beyond the attributes' counts and moments.
import { sq } from "../../compiler.ts";
import { clinicalMetaTable } from "../../custom-data.ts";
import { aggregateSql, type AggregateSql } from "../../sql-kinds.ts";

/** Every clinical attribute the study declares, with its display name: metadata, no patient rows. */
export function clinicalAttributeListSql(study: string, db: string): AggregateSql {
  return aggregateSql(
    "SELECT cam.attr_id AS a, any(cam.display_name) AS label\n" +
    "FROM " + clinicalMetaTable(db) + " cam\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) + "\n" +
    "GROUP BY a ORDER BY a");
}
