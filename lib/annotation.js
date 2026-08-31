// Annotation backend for driver/VUS classification.
//
// Interface: buildAnnotationIndex(eventRows, genes) -> { isDriver(row), source }
//
// Primary backend: the version-pinned OncoKB store (oncokb_annotation.variant_annotation,
// populated by cBioPortal/oncokb-annotation-pipeline). Reads go through the app's own
// ClickHouse identity — being "licensed" IS having SELECT on that database, so if the
// grant is revoked (or the store is empty) this degrades to the rule-based MOCK below,
// clearly labeled as such. Pin a specific release with ONCOKB_PIN; default is the
// most recently synced version in the store.
import { chQuery } from "./ch.js";
import { sq } from "./compiler.js";

export const MOCK_SOURCE = "MOCK-2026.08 (rule-based placeholder — NOT OncoKB)";

const TSG = new Set(["TP53", "STK11", "KEAP1", "ARID1A", "PTEN", "RB1", "APC", "CDKN2A",
  "NF1", "BRCA1", "BRCA2", "SMAD4", "ATM", "MSH2", "MSH6", "MLH1", "VHL", "SMARCA4", "MSH3"]);
const ONCOGENE_AMP = new Set(["EGFR", "ERBB2", "KRAS", "MYC", "MDM2", "CDK4", "CCND1", "MET", "BRAF", "PIK3CA", "FGFR1"]);
const FUSION_GENES = new Set(["ALK", "RET", "ROS1", "NTRK1", "NTRK2", "NTRK3", "FGFR2", "FGFR3", "BRAF", "EGFR"]);
const TRUNCATING = /^(nonsense|frame_shift|splice|nonstop)/i;
const HOTSPOT_MIN_RECURRENCE = 5;

function mockIndex(eventRows) {
  const counts = new Map();
  for (const r of eventRows) {
    if (r.vt === "mutation" && r.mv) {
      const k = r.gene + "|" + r.mv;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const isDriver = (r) => {
    if (r.vt === "mutation") {
      if (TSG.has(r.gene) && TRUNCATING.test(r.mt || "")) return true;
      if (r.mv && (counts.get(r.gene + "|" + r.mv) || 0) >= HOTSPOT_MIN_RECURRENCE) return true;
      return false;
    }
    if (r.vt === "cna") {
      const v = Number(r.cna);
      return (v >= 2 && ONCOGENE_AMP.has(r.gene)) || (v <= -2 && TSG.has(r.gene));
    }
    if (r.vt === "structural_variant") return FUSION_GENES.has(r.gene);
    return false;
  };
  return { isDriver, source: MOCK_SOURCE };
}

const ANNOT_DB = "oncokb_annotation";

let _syncedStudies = null;
async function syncedStudies() {
  if (_syncedStudies) return _syncedStudies;
  try {
    const r = await chQuery("SELECT DISTINCT study FROM oncokb_annotation.sync_run WHERE annotated_new > 0 OR already_stored > 0");
    _syncedStudies = r.data.map(x => x.study);
  } catch { _syncedStudies = []; }
  return _syncedStudies;
}

export async function buildAnnotationIndex(eventRows, genes, study) {
  try {
    const pin = process.env.ONCOKB_PIN ||
      (await chQuery(
        `SELECT oncokb_version FROM ${ANNOT_DB}.variant_annotation
         GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1`)).data[0]?.oncokb_version;
    if (!pin) throw new Error("annotation store is empty");
    const rows = await chQuery(
      `SELECT alteration_type AS t, hugo_gene_symbol AS gene, alteration, max(is_driver) AS is_driver
       FROM ${ANNOT_DB}.variant_annotation
       WHERE oncokb_version = ${sq(pin)} AND hugo_gene_symbol IN (${genes.map(sq).join(",")})
       GROUP BY t, gene, alteration`);
    const driverSet = new Set();
    for (const r of rows.data) if (Number(r.is_driver)) driverSet.add(r.t + "|" + r.gene + "|" + r.alteration);
    const isDriver = (r) => {
      if (r.vt === "mutation") return driverSet.has("MUTATION|" + r.gene + "|" + r.mv);
      if (r.vt === "cna") {
        const v = Number(r.cna);
        return driverSet.has("CNA|" + r.gene + "|" + (v >= 2 ? "AMPLIFICATION" : "DELETION"));
      }
      if (r.vt === "structural_variant") return driverSet.has("SV|" + r.gene + "|Fusion");
      return false;
    };
    const synced = await syncedStudies();
    // `study` may be one id or a list (federated views); name unsynced studies
    // when there are few, count them when there are many
    const list = Array.isArray(study) ? study : (study ? [study] : []);
    const unsynced = list.filter(s => !synced.includes(s));
    const partial = synced.length && unsynced.length;
    const where = unsynced.length <= 2 ? unsynced.join(", ")
      : unsynced.length + " of " + list.length + " studies";
    return { isDriver, source: "OncoKB " + pin + " (pinned)" +
      (partial ? " — variants synced from " + synced.join("/") + "; coverage for " + where + " may be partial" : "") };
  } catch (e) {
    // not licensed / store empty / db absent -> degrade loudly to the mock
    return mockIndex(eventRows);
  }
}
