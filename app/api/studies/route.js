import { chQuery, DB } from "../../../lib/ch.js";

let cache = null;

export async function GET() {
  try {
    if (!cache) {
      const r = await chQuery(
        "SELECT sd.cancer_study_identifier AS id, any(cs.name) AS name,\n" +
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
      const evMap = new Map(ev.data.map(x => [x.id, Number(x.event_patients)]));
      cache = r.data.map(x => ({
        id: x.id, name: x.name,
        patients: Number(x.patients), samples: Number(x.samples),
        timelinePatients: evMap.get(x.id) || 0
      }));
    }
    return Response.json({ studies: cache });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
