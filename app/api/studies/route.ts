import { chQuery, connections, type ChConn } from "../../../lib/ch.ts";
import { isRestrictedStudy } from "../../../lib/federation.ts";

type StudyRow = {
  id: string; name: string; cancerType: string;
  patients: number; samples: number; timelinePatients: number;
  caps: Record<string, boolean>; oncokb: boolean;
  /** which instance holds it — federation-aware catalog */
  instance: string; instanceLabel: string;
};

let cache: StudyRow[] | null = null;

/** Catalog one instance. Failures are isolated: an unreachable peer contributes nothing. */
async function studiesFor(conn: ChConn): Promise<StudyRow[]> {
  const db = conn.db;
  const q = <T = Record<string, string>>(sql: string) => chQuery<T>(sql, conn);

  const r = await q(
    "SELECT sd.cancer_study_identifier AS id, any(cs.name) AS name, any(cs.type_of_cancer_id) AS toc,\n" +
    "       uniqExact(sd.patient_unique_id) AS patients, uniqExact(sd.sample_unique_id) AS samples\n" +
    "FROM " + db + ".sample_derived sd\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_identifier = sd.cancer_study_identifier\n" +
    "GROUP BY id ORDER BY patients DESC");

  const ev = await q(
    "SELECT cs.cancer_study_identifier AS id, uniqExact(ce.patient_id) AS event_patients\n" +
    "FROM " + db + ".clinical_event ce\n" +
    "JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "GROUP BY id");
  const evMap = new Map<string, number>(ev.data.map((x) => [x.id, Number(x.event_patients)]));

  const gp = await q<{ id: string; types: string[] }>(
    "SELECT cs.cancer_study_identifier AS id, groupUniqArray(gp.genetic_alteration_type) AS types\n" +
    "FROM " + db + ".genetic_profile gp\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "GROUP BY id");
  const gpMap = new Map<string, Set<string>>(gp.data.map((x) => [x.id, new Set(x.types)]));

  const toc = await q("SELECT type_of_cancer_id AS id, name FROM " + db + ".type_of_cancer");
  const tocMap = new Map<string, string>(toc.data.map((x) => [x.id, x.name]));

  // OncoKB coverage is a property of the annotation store, not of this instance
  let oncokb = new Set<string>();
  try {
    const ok = await q("SELECT DISTINCT study FROM oncokb_annotation.sync_run WHERE annotated_new > 0 OR already_stored > 0");
    oncokb = new Set(ok.data.map((x) => x.study));
  } catch { /* store not granted here */ }

  return r.data.filter((x) => !isRestrictedStudy(x.id, x.name)).map((x): StudyRow => {
    const types = gpMap.get(x.id) || new Set<string>();
    return {
      id: x.id, name: x.name,
      cancerType: tocMap.get(x.toc) || x.toc,
      patients: Number(x.patients), samples: Number(x.samples),
      timelinePatients: evMap.get(x.id) || 0,
      caps: {
        mut: types.has("MUTATION_EXTENDED"), cna: types.has("COPY_NUMBER_ALTERATION"),
        sv: types.has("STRUCTURAL_VARIANT"), mrna: types.has("MRNA_EXPRESSION"),
        protein: types.has("PROTEIN_LEVEL"), ga: types.has("GENERIC_ASSAY")
      },
      oncokb: oncokb.has(x.id),
      instance: conn.id, instanceLabel: conn.label
    };
  });
}

export async function GET() {
  try {
    if (!cache) {
      const per = await Promise.all(connections().map((c) =>
        studiesFor(c).catch(() => [] as StudyRow[])));   // one bad peer must not empty the catalog
      const seen = new Set<string>();
      const merged: StudyRow[] = [];
      for (const rows of per) for (const row of rows) {
        if (seen.has(row.id)) continue;                  // first instance wins a collision
        seen.add(row.id);
        merged.push(row);
      }
      merged.sort((a, b) => b.patients - a.patients);
      cache = merged;
    }
    return Response.json({ studies: cache });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
