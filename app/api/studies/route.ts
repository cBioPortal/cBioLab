import { chQuery, DB } from "../../../lib/ch.ts";

type StudyRow = { id: string; name: string; cancerType: string; patients: number; samples: number; timelinePatients: number; caps: Record<string, boolean>; oncokb: boolean };
let cache: StudyRow[] | null = null;

export async function GET() {
  try {
    if (!cache) {
      const r = await chQuery(
        "SELECT sd.cancer_study_identifier AS id, any(cs.name) AS name, any(cs.type_of_cancer_id) AS toc,\n" +
        "       uniqExact(sd.patient_unique_id) AS patients, uniqExact(sd.sample_unique_id) AS samples\n" +
        "FROM " + DB + ".sample_derived sd\n" +
        "JOIN " + DB + ".cancer_study cs ON cs.cancer_study_identifier = sd.cancer_study_identifier\n" +
        "GROUP BY id ORDER BY patients DESC");
      const ev = await chQuery(
        "SELECT cs.cancer_study_identifier AS id, uniqExact(ce.patient_id) AS event_patients\n" +
        "FROM " + DB + ".clinical_event ce\n" +
        "JOIN " + DB + ".patient p ON p.internal_id = ce.patient_id\n" +
        "JOIN " + DB + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
        "GROUP BY id");
      const evMap = new Map<string, number>(ev.data.map((x) => [x.id, Number(x.event_patients)]));
      // molecular capabilities from genetic_profile (cheap: ~2.5k rows total)
      const gp = await chQuery(
        "SELECT cs.cancer_study_identifier AS id, groupUniqArray(gp.genetic_alteration_type) AS types\n" +
        "FROM " + DB + ".genetic_profile gp\n" +
        "JOIN " + DB + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
        "GROUP BY id");
      const gpMap = new Map<string, Set<string>>(gp.data.map((x) => [x.id, new Set(x.types as unknown as string[])]));
      const toc = await chQuery("SELECT type_of_cancer_id AS id, name FROM " + DB + ".type_of_cancer");
      const tocMap = new Map<string, string>(toc.data.map((x) => [x.id, x.name]));
      // studies whose variants are synced into the OncoKB annotation store
      let oncokb = new Set<string>();
      try {
        const ok = await chQuery("SELECT DISTINCT study FROM oncokb_annotation.sync_run WHERE annotated_new > 0 OR already_stored > 0");
        oncokb = new Set(ok.data.map((x) => x.study));
      } catch {}
      cache = r.data.map((x): StudyRow => {
        const types = gpMap.get(x.id) || new Set();
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
          oncokb: oncokb.has(x.id)
        };
      });
    }
    return Response.json({ studies: cache });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
