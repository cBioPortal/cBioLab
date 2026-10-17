// The server half of the single-cell review (app/singlecell/, lib/singlecell/): Cell Explorer's
// catalog, which its site serves only to browsers on its own origin, and the two questions only a
// study can answer — which of a dataset's donor (or sample) values are its patients (or samples), and
// what cell counts it already holds.
//
// Both answers name the study's patients and samples, so both come only from a patient-level
// instance (patientLevelConn), as the clinical table and the custom-data id matching do.
import { chQueryRows, registerChExternal, withChContext } from "./ch.ts";
import { sq } from "./compiler.ts";
import { clinicalTable, tsvField } from "./custom-data.ts";
import { patientLevelConn } from "./federation.ts";
import { CELL_EXPLORER_BASE } from "./cell-explorer.ts";

/** the most values one crosswalk request matches: a dataset's samples, with room */
export const CROSSWALK_MAX_VALUES = 50_000;
const CATALOG_TTL_MS = 3_600_000;

export interface CatalogColumn { name: string; dtype: string; cardinality: number | null; values: string[] | null }
export interface CatalogDataset {
  slug: string; name: string; description: string | null; url: string;
  collection: { slug: string; name: string; citation: string | null; url: string | null } | null;
  cells: number | null; genes: number | null; columns: CatalogColumn[];
}

let catalog: { at: number; data: CatalogDataset[] } | null = null;

/** Cell Explorer's datasets, read on the server (its API answers its own site only) and kept an hour. */
export async function cellExplorerCatalog(): Promise<CatalogDataset[]> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.data;
  const r = await fetch(CELL_EXPLORER_BASE + "/api/datasets", { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error("Cell Explorer's catalog did not answer (" + r.status + ")");
  const j = await r.json() as { datasets?: Record<string, any>[] };
  const data = (j.datasets || []).filter((d) => d.url).map((d): CatalogDataset => ({
    slug: String(d.slug), name: String(d.name), description: d.description ?? null, url: String(d.url),
    collection: d.collection ? { slug: String(d.collection.slug), name: String(d.collection.name),
      citation: d.collection.publication_citation ?? null, url: d.collection.publication_url ?? d.collection.source_url ?? null } : null,
    cells: d.metadata?.n_obs ?? null, genes: d.metadata?.n_vars ?? null,
    columns: (d.metadata?.obs_columns || []).map((c: Record<string, any>) => ({ name: String(c.name), dtype: String(c.dtype),
      cardinality: c.cardinality ?? null, values: Array.isArray(c.values) ? c.values.map(String) : null })),
  }));
  catalog = { at: Date.now(), data };
  return data;
}

export interface CrosswalkCandidate { attribute: string | null; matched: number }
export interface Crosswalk {
  study: string; level: "patient" | "sample";
  /** the mapping used: the study's own ids (null), or this attribute's values */
  attribute: string | null;
  values: number; matched: number;
  /** every mapping that matched any value, best first — the ids themselves included */
  candidates: CrosswalkCandidate[];
  /** value → [patient] or [patient, sample] */
  map: Record<string, string[]>;
  /** values an attribute names more than one case with: the first is kept, and they are counted */
  ambiguous: number;
  /** the values no case matched (the first 200) */
  unmatched: string[];
  /** how many patients or samples the study has */
  studyCases: number;
}

/**
 * Which of a dataset's values (donor ids, sample names) are the study's patients or samples: through
 * the ids themselves or a clinical attribute's values — the one asked for, or else the one that
 * matches most.
 */
export async function crosswalk(study: string, level: "patient" | "sample", values: string[], attribute?: string | null): Promise<Crosswalk> {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(study)) throw new Error("study names a cBioPortal study");
  const conn = await patientLevelConn(study, "matching a dataset's donors to a study names its patients");
  const vals = [...new Set(values.map(String).filter((v) => v && v.length <= 200 && !/[\t\n\r\\]/.test(v)))];
  if (vals.length > CROSSWALK_MAX_VALUES) throw new Error("a crosswalk matches at most " + CROSSWALK_MAX_VALUES.toLocaleString("en-US") + " values; this has " + vals.length.toLocaleString("en-US"));
  const pid = (col: string) => "replaceOne(" + col + ", " + sq(study + "_") + ", '')";
  const run = (sql: string) => withChContext({}, async () => {
    registerChExternal({ name: "_vals", structure: "v String", data: vals.map(tsvField).join("\n") + "\n" });
    return (await chQueryRows(sql, conn)).rows as string[][];
  });
  const idCol = level === "patient" ? "patient_stable_id" : "sample_stable_id";
  const [direct, byAttr, total] = await Promise.all([
    run("SELECT " + idCol + " AS v, any(patient_stable_id) AS p, any(sample_stable_id) AS s FROM " + conn.db + ".sample_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + " AND " + idCol + " IN (SELECT v FROM _vals) GROUP BY v"),
    run("SELECT attribute_name, uniqExact(attribute_value) AS n FROM " + clinicalTable(conn.db, "all") + "\n" +
      "WHERE cancer_study_identifier = " + sq(study) + " AND type = " + sq(level) + " AND attribute_value IN (SELECT v FROM _vals)\n" +
      "GROUP BY attribute_name ORDER BY n DESC, attribute_name LIMIT 10"),
    chQueryRows("SELECT uniqExact(" + idCol + ") FROM " + conn.db + ".sample_derived WHERE cancer_study_identifier = " + sq(study), conn),
  ]);
  const candidates: CrosswalkCandidate[] = [{ attribute: null, matched: direct.length }, ...byAttr.map(([a, n]) => ({ attribute: a, matched: Number(n) }))]
    .filter((c) => c.matched > 0).sort((a, b) => b.matched - a.matched || (a.attribute === null ? -1 : 1));
  const chosen = attribute !== undefined ? attribute : (candidates[0]?.attribute ?? null);
  if (chosen != null && !/^[A-Za-z0-9_]{1,64}$/.test(chosen)) throw new Error("attribute names a clinical attribute");
  const map: Record<string, string[]> = {};
  let ambiguous = 0;
  if (chosen == null) {
    for (const [v, p, s] of direct) map[v] = level === "patient" ? [p] : [p, s];
  } else {
    const rows = await run("SELECT attribute_value, " + pid("patient_unique_id") + ", " + pid("sample_unique_id") + " FROM " + clinicalTable(conn.db, [chosen]) + "\n" +
      "WHERE cancer_study_identifier = " + sq(study) + " AND type = " + sq(level) + " AND attribute_name = " + sq(chosen) + "\n" +
      "  AND attribute_value IN (SELECT v FROM _vals) ORDER BY attribute_value, patient_unique_id, sample_unique_id");
    for (const [v, p, s] of rows) {
      if (map[v]) { if (map[v][map[v].length - 1] !== (level === "patient" ? p : s)) ambiguous++; continue; }
      map[v] = level === "patient" ? [p] : [p, s];
    }
  }
  const unmatched = vals.filter((v) => !map[v]);
  return { study, level, attribute: chosen, values: vals.length, matched: vals.length - unmatched.length, candidates, map, ambiguous,
    unmatched: unmatched.slice(0, 200), studyCases: Number(total.rows[0]?.[0] || 0) };
}

export interface ReferenceCounts {
  /** a generic-assay profile of cell counts the study holds, per sample and entity */
  profiles: { profileType: string; name: string; counts: Record<string, Record<string, number>> }[];
}

/** The study's own cell counts (generic-assay profiles whose name says counts), to check a summary against. */
export async function referenceCounts(study: string): Promise<ReferenceCounts> {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(study)) throw new Error("study names a cBioPortal study");
  const conn = await patientLevelConn(study, "a study's per-sample cell counts name its samples");
  const profs = (await chQueryRows("SELECT replaceOne(stable_id, " + sq(study + "_") + ", ''), name FROM " + conn.db + ".genetic_profile\n" +
    "WHERE stable_id LIKE " + sq(study + "_%") + " AND genetic_alteration_type = 'GENERIC_ASSAY' AND positionCaseInsensitive(stable_id, 'count') > 0 AND positionCaseInsensitive(stable_id, 'relative') = 0", conn)).rows as string[][];
  const profiles: ReferenceCounts["profiles"] = [];
  for (const [pt, name] of profs.slice(0, 4)) {
    const rows = (await chQueryRows("SELECT replaceOne(sample_unique_id, " + sq(study + "_") + ", ''), entity_stable_id, toFloat64OrNull(value)\n" +
      "FROM " + conn.db + ".generic_assay_data_derived WHERE profile_type = " + sq(pt) + " AND profile_stable_id = " + sq(study + "_" + pt), conn)).rows as [string, string, number | null][];
    const counts: Record<string, Record<string, number>> = {};
    for (const [s, e, v] of rows) if (v != null && Number.isFinite(Number(v))) (counts[s] ||= {})[e] = Number(v);
    profiles.push({ profileType: pt, name: String(name || pt), counts });
  }
  return { profiles };
}
