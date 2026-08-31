// Faceted study explorer: what exists, in what numbers — optionally conditioned on a
// draft cohort so every count narrows as clauses are added (study-view-style feedback).
// Everything returned is designed to be clickable into a DSL clause.
import { chQuery, DB } from "./ch.ts";
import { sq } from "./compiler.ts";
import { compileCohortDef } from "./cohort2.ts";

import type { ExploreResult, ClinicalFacet, CohortDef, ChRow } from "./types.ts";
import { isClinicalLeaf } from "./types.ts";

export async function buildExplore({ study, draft, oncokbPin, profiles, gaProfiles }: { study: string; draft?: CohortDef | null; oncokbPin?: string | null; profiles?: string[]; gaProfiles?: string[] }): Promise<ExploreResult> {
  const t0 = Date.now();
  let cond = "", draftCount = null, dsql = null;
  if (draft && Array.isArray(draft.all) && draft.all.length) {
    dsql = compileCohortDef(draft, { oncokbPin, profiles, gaProfiles, study });
    cond = "\n  AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (" + dsql + "))";
    const c = await chQuery("SELECT uniqExact(pid) AS n FROM (" + dsql + ")");
    draftCount = Number(c.data[0].n);
  }

  // ---- clinical attributes: classify categorical vs numeric --------------
  const cls = await chQuery(
    "SELECT type, attribute_name AS a, uniqExact(attribute_value) AS nv,\n" +
    "  countIf(toFloat64OrNull(attribute_value) IS NOT NULL) / count() AS numratio,\n" +
    "  uniqExact(patient_unique_id) AS np,\n" +
    "  min(toFloat64OrNull(attribute_value)) AS mn, max(toFloat64OrNull(attribute_value)) AS mx,\n" +
    "  quantile(0.5)(toFloat64OrNull(attribute_value)) AS md\n" +
    "FROM " + DB + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_value != ''" + cond + "\n" +
    "GROUP BY type, a ORDER BY np DESC LIMIT 44");
  const catAttrs = cls.data.filter(r => Number(r.nv) <= 30 && Number(r.numratio) < 0.9);
  const numAttrs = cls.data.filter(r => Number(r.numratio) >= 0.9 && Number(r.nv) > 10);

  let catValues: ChRow[] = [];
  if (catAttrs.length) {
    const v = await chQuery(
      "SELECT type, attribute_name AS a, attribute_value AS v, uniqExact(patient_unique_id) AS n\n" +
      "FROM " + DB + ".clinical_data_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_value != ''\n" +
      "  AND attribute_name IN (" + catAttrs.map(r => sq(r.a)).join(",") + ")" + cond + "\n" +
      "GROUP BY type, a, v ORDER BY n DESC LIMIT 6 BY type, a");
    catValues = v.data;
  }
  // Disjunctive faceting: attributes already constrained in the draft get their value
  // lists conditioned on the draft MINUS their own clauses — otherwise a selected
  // attribute collapses to its chosen value and can never be OR-extended.
  const draftedAttrs = new Set<string>();
  if (draft && Array.isArray(draft.all)) {
    for (const c of draft.all) {
      if (isClinicalLeaf(c)) draftedAttrs.add((c.per === "sample" ? "sample|" : "patient|") + c.attribute);
    }
  }
  const disjValues = new Map<string, { v: string; n: number }[]>(); // "per|attr" -> [{v,n}]
  for (const key of draftedAttrs) {
    const [per, attr] = [key.split("|")[0], key.split("|").slice(1).join("|")];
    const rest: CohortDef = { ...draft!, all: (draft!.all || []).filter((c) => !(isClinicalLeaf(c) && c.attribute === attr && (c.per === "sample" ? "sample" : "patient") === per)) };
    let subCond = "";
    if (rest.all!.length) {
      const rsql = compileCohortDef(rest, { oncokbPin, profiles, gaProfiles, study });
      subCond = "\n  AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (" + rsql + "))";
    }
    const v = await chQuery(
      "SELECT attribute_value AS v, uniqExact(patient_unique_id) AS n\n" +
      "FROM " + DB + ".clinical_data_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_value != ''\n" +
      "  AND type = " + sq(per) + " AND attribute_name = " + sq(attr) + subCond + "\n" +
      "GROUP BY v ORDER BY n DESC LIMIT 6");
    disjValues.set(key, v.data.map(x => ({ v: x.v, n: Number(x.n) })));
  }

  const clinical: ClinicalFacet[] = [
    ...catAttrs.map((r): ClinicalFacet => ({
      attribute: r.a, per: r.type as "patient" | "sample", kind: "cat", patients: Number(r.np),
      values: disjValues.get(r.type + "|" + r.a) ||
        catValues.filter((x) => x.a === r.a && x.type === r.type).map((x) => ({ v: x.v, n: Number(x.n) })),
      disjunctive: disjValues.has(r.type + "|" + r.a) || undefined
    })),
    ...numAttrs.map((r): ClinicalFacet => ({
      attribute: r.a, per: r.type as "patient" | "sample", kind: "num", patients: Number(r.np),
      min: Number(r.mn), max: Number(r.mx), median: Number(r.md)
    }))
  ].sort((x, y) => y.patients - x.patients).slice(0, 30);

  // ---- timeline event types ----------------------------------------------
  const ev = await chQuery(
    "SELECT ce.event_type AS t, uniqExact(ce.patient_id) AS n\n" +
    "FROM " + DB + ".clinical_event ce\n" +
    "JOIN " + DB + ".patient p ON p.internal_id = ce.patient_id\n" +
    "JOIN " + DB + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) +
    (dsql ? "\n  AND p.stable_id IN (SELECT pid FROM (" + dsql + "))" : "") + "\n" +
    "GROUP BY t ORDER BY n DESC");

  // ---- top altered genes --------------------------------------------------
  const genes = await chQuery(
    "SELECT hugo_gene_symbol AS g, uniqExact(patient_unique_id) AS n\n" +
    "FROM " + DB + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "  AND (variant_type != 'cna' OR abs(cna_alteration) >= 2)" + cond + "\n" +
    "GROUP BY g ORDER BY n DESC LIMIT 15");

  // ---- case lists (sizes are study-wide, not draft-conditioned) ----------
  const lists = await chQuery(
    "SELECT sl.stable_id AS id, any(sl.name) AS name, uniqExact(p.stable_id) AS n\n" +
    "FROM " + DB + ".sample_list sl\n" +
    "JOIN " + DB + ".sample_list_list sll ON sll.list_id = sl.list_id\n" +
    "JOIN " + DB + ".sample s ON s.internal_id = sll.sample_id\n" +
    "JOIN " + DB + ".patient p ON p.internal_id = s.patient_id\n" +
    "WHERE sl.stable_id LIKE " + sq(study + "_%") + "\n" +
    "GROUP BY id ORDER BY n DESC LIMIT 10");

  return {
    study, draftCount,
    clinical,
    events: ev.data.map((r) => ({ type: r.t, n: Number(r.n) })),
    genes: genes.data.map((r) => ({ gene: r.g, n: Number(r.n) })),
    caseLists: lists.data.map((r) => ({ id: r.id.replace(study + "_", ""), name: r.name, n: Number(r.n) })),
    profiles: profiles || [], gaProfiles: gaProfiles || [],
    stats: { ms: Date.now() - t0 }
  };
}

// ---- federated explore: several studies at once ---------------------------
// Runs buildExplore per study and merges by name — counts are summed with the
// project-wide policy: patient overlap across studies is NOT deduplicated and
// clinical vocabularies are NOT harmonized (merging by attribute name is the
// whole harmonization). Numeric medians are patient-weighted approximations;
// min/max are exact. An attribute classified differently across studies takes
// the kind of the study with the most patients for it.
export async function buildExploreFederated({ studies, draft, oncokbPin, profilesByStudy }: { studies: string[]; draft?: CohortDef | null; oncokbPin?: string | null; profilesByStudy: Map<string, { profiles: string[]; gaProfiles: string[] }> }): Promise<ExploreResult> {
  const t0 = Date.now();
  const parts = await Promise.all(studies.map(s =>
    buildExplore({ study: s, draft, oncokbPin, ...(profilesByStudy.get(s) || {}) })));
  if (parts.length === 1) return parts[0];

  const clin = new Map<string, ClinicalFacet[]>(); // per|attribute -> list of items
  for (const p of parts) for (const a of p.clinical) {
    const k = a.per + "|" + a.attribute;
    if (!clin.has(k)) clin.set(k, []);
    clin.get(k)!.push(a);
  }
  const clinical: ClinicalFacet[] = [...clin.values()].map((items) => {
    const kind = items.slice().sort((x, y) => y.patients - x.patients)[0].kind;
    const same = items.filter((i) => i.kind === kind);
    const patients = same.reduce((s: number, i) => s + i.patients, 0);
    const base = { attribute: same[0].attribute, per: same[0].per, kind, patients };
    if (kind === "num") {
      return { ...base,
        min: Math.min(...same.map((i) => i.min!)), max: Math.max(...same.map((i) => i.max!)),
        median: Math.round(10 * same.reduce((s: number, i) => s + i.median! * i.patients, 0) / patients) / 10 };
    }
    const vals = new Map<string, number>();
    for (const i of same) for (const v of i.values!) vals.set(v.v, (vals.get(v.v) || 0) + v.n);
    return { ...base, values: [...vals.entries()].map(([v, n]) => ({ v, n })).sort((x, y) => y.n - x.n).slice(0, 8) };
  }).sort((x, y) => y.patients - x.patients);

  const sumBy = (arrs: any[][], key: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of arrs.flat()) m.set(r[key], (m.get(r[key]) || 0) + r.n);
    return m;
  };
  const evm = sumBy(parts.map(p => p.events), "type");
  const gm = sumBy(parts.map(p => p.genes), "gene");
  const lm = new Map<string, { id: string; name: string; n: number }>();
  for (const p of parts) for (const l of p.caseLists) {
    const cur = lm.get(l.id) || { id: l.id, name: l.name, n: 0 };
    cur.n += l.n; lm.set(l.id, cur);
  }
  return {
    study: studies.join(" + "),
    studies,
    draftCount: draft ? parts.reduce((s, p) => s + (p.draftCount || 0), 0) : null,
    clinical,
    events: [...evm.entries()].map(([type, n]) => ({ type, n })).sort((x, y) => y.n - x.n),
    genes: [...gm.entries()].map(([gene, n]) => ({ gene, n })).sort((x, y) => y.n - x.n).slice(0, 15),
    caseLists: [...lm.values()].sort((x, y) => y.n - x.n).slice(0, 10),
    profiles: [...new Set(parts.flatMap((p) => p.profiles))],
    gaProfiles: [...new Set(parts.flatMap((p) => p.gaProfiles))],
    stats: { ms: Date.now() - t0, perStudy: Object.fromEntries(parts.map((p, i) => [studies[i], p.draftCount])) }
  };
}
