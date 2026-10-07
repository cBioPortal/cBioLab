import { chQueryRows, STUDY } from "../../../../lib/ch";
import { patientLevelConn } from "../../../../lib/federation";
import { sq } from "../../../../lib/compiler";

export const maxDuration = 30;

/**
 * The patients a set of sample columns belongs to.
 *
 * A cohort in this document language selects PATIENTS. When a reader drags a selection across
 * a sample-mode oncoprint they have picked samples, and turning that into a cohort means
 * naming the patients those samples came from — a mapping only the database holds, so it is
 * resolved here rather than guessed from the shape of an id.
 */
export async function POST(req: Request) {
  try {
    const { study, samples } = await req.json();
    if (!Array.isArray(samples) || !samples.length) throw new Error("samples must be a non-empty array of sample ids");
    if (samples.length > 50000) throw new Error("selection is larger than the 50,000-id ceiling on an explicit patient list");
    const s = String(study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
    const conn = await patientLevelConn(s, "a selection's patients are a list of patients");
    const ids = samples.map(String).filter((x) => /^[A-Za-z0-9._-]{1,80}$/.test(x));
    if (!ids.length) throw new Error("no valid sample ids in the selection");
    const prefix = s + "_";
    const r = await chQueryRows(
      "SELECT DISTINCT replaceOne(patient_unique_id, " + sq(prefix) + ", '') AS pid\n" +
      "FROM " + conn.db + ".sample_derived\n" +
      "WHERE cancer_study_identifier = " + sq(s) + "\n" +
      "  AND replaceOne(sample_unique_id, " + sq(prefix) + ", '') IN (" + ids.map(sq).join(",") + ")\n" +
      "ORDER BY pid", conn);
    return Response.json({ patients: r.rows.map((x) => x[0] as string) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
