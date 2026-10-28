// How the Patient page's header shows a patient's and a sample's clinical attributes, as
// cBioPortal's patient view does (clinicalAttributesUtil.js and clinicalAttributesStyleConsts.ts in
// cbioportal-frontend): null-like values dropped, a few values tidied, a sample's normalized type
// and location derived, then only the configured attributes, in the configured order — primary
// ones plain, the rest in brackets, some coloured by value. Pure.

export type Attrs = Record<string, string>;

/** values the portal treats as missing */
const NULL_VALUES = new Set(["not applicable", "not available", "pending", "discrepancy", "completed", "", "null", "unknown", "na", "n/a",
  "[unkown]", "[not submitted]", "[not evaluated]", "[not applicable]", "[not available]", "[undefined]"]);

const isNumeric = (x: string) => x.trim() !== "" && Number.isFinite(Number(x));

/** The portal's clean: missing values dropped, months and age floored, OS/DFS status without its "1:"/"0:" prefix. */
export function clean(attrs: Attrs): Attrs {
  const out: Attrs = {};
  for (const [k, raw] of Object.entries(attrs)) {
    let v = String(raw ?? "");
    if (NULL_VALUES.has(v.toLowerCase())) continue;
    if ((k === "OS_MONTHS" || k === "DFS_MONTHS" || k === "AGE") && isNumeric(v)) v = String(Math.floor(Number(v)));
    if ((k === "OS_STATUS" || k === "DFS_STATUS") && /^[01]:/.test(v)) v = v.replace(/^[01]:/, "");
    out[k] = v;
  }
  return out;
}

/** The portal's normalized case type: the first of these attributes whose value names one. */
const CASE_TYPE_ATTRS = ["SAMPLE_CLASS", "SAMPLE_TYPE", "TUMOR_TISSUE_SITE", "TUMOR_TYPE", "SAMPLE_TYPE_DETAILED"];
const CASE_TYPES: [string, string][] = [["metasta", "Metastasis"], ["recurr", "Recurrence"], ["progr", "Progressed"], ["xeno", "Xenograft"], ["pdx", "Xenograft"],
  ["organoid", "Organoid"], ["cfdna", "cfDNA"], ["prim", "Primary"], ["ctdna", "ctDNA"], ["plasma", "Plasma"], ["urine", "Urine"], ["exosome", "Exosome"],
  ["total rna", "total RNA"], ["total dna", "total DNA"], ["tissue", "Tissue"]];
function normalizedCaseType(attrs: Attrs): string | null {
  for (const a of CASE_TYPE_ATTRS) {
    const v = attrs[a];
    if (v == null) continue;
    const lower = v.toLowerCase();
    const hit = CASE_TYPES.find(([needle]) => lower.includes(needle));
    if (hit) return hit[1];
  }
  return null;
}

/** The portal's derive: DERIVED_NORMALIZED_CASE_TYPE, and where the sample was taken (DERIVED_SAMPLE_LOCATION). */
export function derive(attrs: Attrs): Attrs {
  const out = { ...attrs };
  const type = normalizedCaseType(attrs);
  if (type == null) return out;
  out.DERIVED_NORMALIZED_CASE_TYPE = type;
  const first = (keys: string[]) => keys.map((k) => attrs[k]).find((v) => v != null) ?? null;
  const loc = type === "Metastasis" ? first(["METASTATIC_SITE", "TUMOR_SITE"]) : type === "Primary" ? first(["PRIMARY_SITE", "TUMOR_SITE"]) : first(["TUMOR_SITE"]);
  if (loc != null) out.DERIVED_SAMPLE_LOCATION = loc;
  return out;
}

export const cleanAndDerive = (attrs: Attrs): Attrs => derive(clean(attrs));

interface ShownAttribute { primary: boolean; order?: number; format?: (v: string) => string; colors?: Record<string, string> }
/** The attributes the header shows, and how: the portal's config object, entry for entry. */
const SHOWN: Record<string, ShownAttribute> = {
  AGE: { primary: true, format: (t) => t + " years old", order: 2 },
  BREAST_CANCER_RECEPTOR_STATUS: { primary: true, order: 6 },
  CANCER_TYPE: { primary: true, order: 3 },
  CANCER_TYPE_DETAILED: { primary: false, order: 4 },
  DERIVED_NORMALIZED_CASE_TYPE: { primary: true, colors: { Primary: "black", Progressed: "orange", Recurrence: "orange", Metastasis: "red" }, order: 1 },
  DERIVED_SAMPLE_LOCATION: { primary: false, order: 2 },
  DFS_STATUS: { primary: true, colors: { _: "#f00", DiseaseFree: "rgb(0, 128, 0)", Yes: "rgb(0, 128, 0)" }, order: 9 },
  DFS_MONTHS: { primary: false, format: (t) => t + " months", order: 10 },
  DRIVER_MUTATIONS: { primary: true, order: 6 },
  ERG_FUSION_ACGH: { primary: true, format: (t) => "ERG-fusion aCGH: " + t, order: 6 },
  ETS_RAF_SPINK1_STATUS: { primary: true, order: 6 },
  GLEASON: { primary: true, format: (t) => "Gleason: " + t },
  GLEASON_SCORE: { primary: true, order: 6 },
  GENDER: { primary: true, order: 1 },
  HISTOLOGY: { primary: true, order: 6 },
  KNOWN_MOLECULAR_CLASSIFIER: { primary: true, order: 5 },
  MOUSE_STRAIN: { primary: true, order: 6 },
  PATIENT_DISPLAY_NAME: { primary: false, order: 0 },
  OS_MONTHS: { primary: false, format: (t) => t + " months", order: 8 },
  OS_STATUS: { primary: true, colors: { DECEASED: "#f00", DEAD: "#f00", LIVING: "rgb(0, 128, 0)", ALIVE: "rgb(0, 128, 0)" }, order: 7 },
  SAMPLE_DISPLAY_NAME: { primary: false, order: 0 },
  SERUM_PSA: { primary: true, format: (t) => "Serum PSA: " + t, order: 6 },
  SEX: { primary: true, order: 1 },
  TMPRSS2_ERG_FUSION_STATUS: { primary: true, format: (t) => "TMPRSS2-ERG Fusion: " + t, order: 6 },
  TUMOR_GRADE: { primary: true, order: 6 },
  TUMOR_STAGE_2009: { primary: true, order: 6 },
};
const DEFAULT_COLOR = "#333333";

/** One attribute as the header writes it: its text (bracketed when secondary), its colour, and what joins it to the next. */
export interface InlineAttribute { key: string; text: string; color: string; lead: string; trail: string }

/**
 * The configured attributes of a cleaned and derived record, in the portal's order, each written as
 * the portal writes it: ", " before the first, ", " after one followed by a primary attribute and a
 * space after one followed by a secondary one.
 */
export function inlineAttributes(attrs: Attrs): InlineAttribute[] {
  const order = (k: string) => SHOWN[k]?.order ?? Number.MAX_VALUE;
  const keys = Object.keys(attrs).filter((k) => k in SHOWN).sort((a, b) => order(a) - order(b));
  return keys.map((key, i) => {
    const c = SHOWN[key], v = attrs[key];
    const body = (c.format || String)(v);
    const next = keys[i + 1];
    const color = c.colors ? c.colors[v] ?? c.colors._ ?? DEFAULT_COLOR : DEFAULT_COLOR;
    return { key, text: c.primary ? body : "(" + body + ")", color, lead: i === 0 ? ", " : "",
      trail: next === undefined ? "" : SHOWN[next].primary ? ", " : " " };
  });
}

/**
 * The portal's sample manager moves CANCER_TYPE and CANCER_TYPE_DETAILED to the patient when every
 * sample has the same value: the attributes moved, and each sample's record without them.
 */
export function liftCommon(samples: Attrs[]): { common: Attrs; samples: Attrs[] } {
  const common: Attrs = {};
  const rest = samples.map((s) => ({ ...s }));
  for (const a of ["CANCER_TYPE", "CANCER_TYPE_DETAILED"]) {
    if (!samples.length || !samples.every((s) => s[a] === samples[0][a])) continue;
    if (samples[0][a] !== undefined) common[a] = samples[0][a];
    for (const s of rest) delete s[a];
  }
  return { common, samples: rest };
}
