// Annotation backend for driver/VUS classification.
//
// Interface: buildAnnotationIndex(eventRows) -> { isDriver(row): boolean, source: string }
//
// Current backend: MOCK — deterministic rule-based placeholder so the whole
// integration (DRIVER bit, faded VUS cells, dual frequencies, version surfacing)
// is wired end-to-end before the real store exists. The real backend swaps this
// module's internals for a lookup against oncokb_annotation.variant_annotation
// (see cBioPortal/oncokb-annotation-pipeline), pinned to an oncokb_version.
// The mock version string is deliberately loud about not being OncoKB.

export const ANNOTATION_SOURCE = "MOCK-2026.08 (rule-based placeholder — NOT OncoKB)";

const TSG = new Set(["TP53", "STK11", "KEAP1", "ARID1A", "PTEN", "RB1", "APC", "CDKN2A",
  "NF1", "BRCA1", "BRCA2", "SMAD4", "ATM", "MSH2", "MSH6", "MLH1", "VHL", "SMARCA4", "MSH3"]);
const ONCOGENE_AMP = new Set(["EGFR", "ERBB2", "KRAS", "MYC", "MDM2", "CDK4", "CCND1", "MET", "BRAF", "PIK3CA", "FGFR1"]);
const FUSION_GENES = new Set(["ALK", "RET", "ROS1", "NTRK1", "NTRK2", "NTRK3", "FGFR2", "FGFR3", "BRAF", "EGFR"]);
const TRUNCATING = /^(nonsense|frame_shift|splice|nonstop)/i;
const HOTSPOT_MIN_RECURRENCE = 5; // recurrence within the queried set as a hotspot proxy

export function buildAnnotationIndex(eventRows) {
  // recurrence per (gene, protein change) — eventRows carry `mv` (mutation_variant)
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
      if (v >= 2 && ONCOGENE_AMP.has(r.gene)) return true;
      if (v <= -2 && TSG.has(r.gene)) return true;
      return false;
    }
    if (r.vt === "structural_variant") return FUSION_GENES.has(r.gene);
    return false;
  };
  return { isDriver, source: ANNOTATION_SOURCE };
}
