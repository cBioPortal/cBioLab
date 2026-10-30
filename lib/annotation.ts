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
import { chQuery, isAbortError} from "./ch.ts";
import type { ChRow } from "./types.ts";
import { sq } from "./compiler.ts";

/**
 * The store's most recent release, or the ONCOKB_PIN override. Cached: it is asked for once
 * per cohort compilation, and the answer changes only when the store is re-synced.
 */
let pinCache: { at: number; pin: string | null } | null = null;
export async function oncokbPin(): Promise<string | null> {
  if (process.env.ONCOKB_PIN) return process.env.ONCOKB_PIN;
  if (pinCache && Date.now() - pinCache.at < 5 * 60_000) return pinCache.pin;
  try {
    const r = await chQuery(
      `SELECT oncokb_version FROM ${ANNOT_DB}.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1`);
    pinCache = { at: Date.now(), pin: (r.data[0] as { oncokb_version?: string })?.oncokb_version || null };
  } catch (e) {
    // A cancelled query is not an answer: caching a null pin here would refuse every
    // `OQL ... DRIVER` clause for the next five minutes because one reader walked away.
    if (isAbortError(e)) throw e;
    pinCache = { at: Date.now(), pin: null };
  }
  return pinCache.pin;
}

export const MOCK_SOURCE = "MOCK-2026.08 (rule-based placeholder — NOT OncoKB)";

const TSG = new Set(["TP53", "STK11", "KEAP1", "ARID1A", "PTEN", "RB1", "APC", "CDKN2A",
  "NF1", "BRCA1", "BRCA2", "SMAD4", "ATM", "MSH2", "MSH6", "MLH1", "VHL", "SMARCA4", "MSH3"]);
const ONCOGENE_AMP = new Set(["EGFR", "ERBB2", "KRAS", "MYC", "MDM2", "CDK4", "CCND1", "MET", "BRAF", "PIK3CA", "FGFR1"]);
const FUSION_GENES = new Set(["ALK", "RET", "ROS1", "NTRK1", "NTRK2", "NTRK3", "FGFR2", "FGFR3", "BRAF", "EGFR"]);
const TRUNCATING = /^(nonsense|frame_shift|splice|nonstop)/i;
const HOTSPOT_MIN_RECURRENCE = 5;

type EvRow = { vt?: string; gene?: string; mv?: string; mt?: string; cna?: string | number };
export interface AnnotationIndex { isDriver: (r: EvRow) => boolean; source: string }

function mockIndex(eventRows: EvRow[]): AnnotationIndex {
  const counts = new Map<string, number>();
  for (const r of eventRows) {
    if (r.vt === "mutation" && r.mv) {
      const k = r.gene + "|" + r.mv;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const isDriver = (r: EvRow): boolean => {
    if (r.vt === "mutation") {
      if (TSG.has(r.gene!) && TRUNCATING.test(r.mt || "")) return true;
      if (r.mv && (counts.get(r.gene + "|" + r.mv) || 0) >= HOTSPOT_MIN_RECURRENCE) return true;
      return false;
    }
    if (r.vt === "cna") {
      const v = Number(r.cna);
      return (v >= 2 && ONCOGENE_AMP.has(r.gene!)) || (v <= -2 && TSG.has(r.gene!));
    }
    if (r.vt === "structural_variant") return FUSION_GENES.has(r.gene!);
    return false;
  };
  return { isDriver, source: MOCK_SOURCE };
}

const ANNOT_DB = "oncokb_annotation";

let _syncedStudies: string[] | null = null;
async function syncedStudies(): Promise<string[]> {
  if (_syncedStudies) return _syncedStudies;
  try {
    const r = await chQuery("SELECT DISTINCT study FROM oncokb_annotation.sync_run WHERE annotated_new > 0 OR already_stored > 0");
    _syncedStudies = (r.data as ChRow[]).map(x => x.study);
  } catch (e) {
    // This cache has no TTL, so swallowing a cancellation here would convince the process
    // that NO study is synced for the rest of its life, silently thinning driver annotation.
    if (isAbortError(e)) throw e;
    _syncedStudies = [];
  }
  return _syncedStudies;
}

export async function buildAnnotationIndex(eventRows: EvRow[], genes: string[], study?: string | string[]): Promise<AnnotationIndex> {
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
    // Nested by gene rather than one set of "type|gene|alteration" keys: isDriver runs once per
    // event — 800k times on a 400k-patient figure — and composing that key allocated a string
    // every time. Two lookups on short strings cost far less than one on a long fresh one.
    const byGene = new Map<string, { mut: Set<string>; amp: boolean; del: boolean; sv: boolean }>();
    const entry = (g: string) => {
      let e = byGene.get(g);
      if (!e) { e = { mut: new Set<string>(), amp: false, del: false, sv: false }; byGene.set(g, e); }
      return e;
    };
    for (const r of rows.data as ChRow[]) {
      if (!Number(r.is_driver)) continue;
      const e = entry(String(r.gene));
      if (r.t === "MUTATION") e.mut.add(String(r.alteration));
      else if (r.t === "CNA") { if (r.alteration === "AMPLIFICATION") e.amp = true; else if (r.alteration === "DELETION") e.del = true; }
      else if (r.t === "SV" && r.alteration === "Fusion") e.sv = true;
    }
    const isDriver = (r: EvRow): boolean => {
      const e = byGene.get(r.gene as string);
      if (!e) return false;
      if (r.vt === "mutation") return e.mut.has(r.mv as string);
      if (r.vt === "cna") return Number(r.cna) >= 2 ? e.amp : e.del;
      if (r.vt === "structural_variant") return e.sv;
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
      (partial ? " — " + where + " not synced; driver coverage may be partial" : "") };
  } catch (e) {
    // A cancelled request must not be answered with mock annotations — it is not a licensing
    // or availability problem, and nobody is waiting for the answer anyway.
    if (isAbortError(e)) throw e;
    // not licensed / store empty / db absent -> degrade loudly to the mock
    return mockIndex(eventRows);
  }
}
