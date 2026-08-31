// OncoprintSpec -> render contract engine.
// Spec (v1 subset): { cohort: {dsl}|null, genes: [..], clinical: [..],
//   derivedEvents: [{label, expression}], layout: {groupBy: {kind:'cohorts', groups:[{name,dsl}]}|null},
//   conventions: {lineGap} }
// Contract: sorted columns, typed cells (bitmask for gene tracks, NOT_PROFILED = -1),
//   panel-aware track frequencies, group ranges. The renderer does zero data logic.
import { chQuery, DB, STUDY } from "./ch.js";
import { compileCohort, sq } from "./compiler.js";
import { heatmapTrackLabel } from "./profile-names.js";

// Internal-only: analysis.js passes an evaluated cohort's SQL as a subquery via this
// Symbol key. JSON.parse cannot produce Symbol keys, so client specs can never inject
// SQL through this path — and pid lists never get inlined as giant IN-lists (which
// exceeded max_query_size at ~48k patients).
export const PIDS_SQL = Symbol("pidsSql");
import { buildAnnotationIndex } from "./annotation.js";

// gene-track cell bitmask
export const BITS = {
  MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16,
  SV: 32, AMP: 64, HOMDEL: 128,
  DRIVER: 256   // any alteration in the cell is annotated (putative) driver
};
const NOT_PROFILED = -1;

function mutClassBit(mt) {
  if (!mt) return BITS.OTHER_MUT;
  const t = mt.toLowerCase();
  if (t.startsWith("missense")) return BITS.MISSENSE;
  if (t.startsWith("nonsense") || t.startsWith("frame_shift") || t.startsWith("nonstop")) return BITS.TRUNCATING;
  if (t.startsWith("in_frame")) return BITS.INFRAME;
  if (t.startsWith("splice")) return BITS.SPLICE;
  return BITS.OTHER_MUT;
}

const GENE_RE = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

export function cohortPatientsSql(dsl, study = STUDY) {
  if (dsl && typeof dsl[PIDS_SQL] === "string") return dsl[PIDS_SQL];
  // SQL for a cohort's stable_ids (null dsl = every patient with a sample).
  // dsl.patients = explicit patient list (e.g. imported from a portal custom case
  // list / session); membership is intersected with the study so unknown ids drop out.
  if (dsl && Array.isArray(dsl.patients)) {
    const ids = dsl.patients.map(String).filter(p => /^[A-Za-z0-9._-]{1,64}$/.test(p)).slice(0, 50000);
    if (!ids.length) throw new Error("patient list is empty or invalid");
    return "SELECT DISTINCT replaceOne(patient_unique_id, " + sq(study + "_") + ", '') AS pid\n" +
      "FROM " + DB + ".sample_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + "\n" +
      "  AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (" + ids.map(sq).join(",") + ")\n" +
      "ORDER BY pid";
  }
  if (!dsl) {
    return "SELECT DISTINCT replaceOne(patient_unique_id, " + sq(study + "_") + ", '') AS pid\n" +
      "FROM " + DB + ".sample_derived WHERE cancer_study_identifier = " + sq(study) + " ORDER BY pid";
  }
  const { patientsSql } = compileCohort({
    db: DB, study, a: dsl.a, b: dsl.b, rel: dsl.rel,
    priorGuard: !!dsl.priorGuard, lineGap: dsl.lineGap, patientsLimit: 100000
  });
  return patientsSql;
}

async function cohortPatients(dsl, study) {
  const r = await chQuery(cohortPatientsSql(dsl, study));
  return r.data.map(x => x.pid);
}

export function genomicEventsSql(genes, study = STUDY) {
  const puidPrefix = study + "_";
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt,\n" +
    "       mutation_variant AS mv, cna_alteration AS cna\n" +
    "FROM " + DB + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")";
}

export function coverageSql(genes, study = STUDY) {
  const puidPrefix = study + "_";
  return "SELECT DISTINCT replaceOne(sd.patient_unique_id, " + sq(puidPrefix) + ", '') AS pid, pg.gene AS gene\n" +
    "FROM " + DB + ".sample_to_gene_panel_derived sp\n" +
    "JOIN " + DB + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + genes.map(sq).join(",") + ")\n" +
    "JOIN " + DB + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'";
}

export function clinicalSql(attrs, study = STUDY) {
  const puidPrefix = study + "_";
  // patient-level rows win; sample-level attributes (e.g. CANCER_TYPE in MSK studies)
  // fall back to one of the patient's sample values via argMax
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       attribute_name AS k, argMax(attribute_value, type = 'patient') AS v\n" +
    "FROM " + DB + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "  AND attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''\n" +
    "GROUP BY pid, k";
}

// per-study molecular-profile inventory (validation for heatmap tracks)
const _profCache = new Map();
async function studyProfileTypes(study) {
  if (_profCache.has(study)) return _profCache.get(study);
  const r = await chQuery("SELECT DISTINCT profile_type FROM " + DB + ".genetic_alteration_derived WHERE cancer_study_identifier = " + sq(study));
  const set = new Set(r.data.map(x => x.profile_type));
  _profCache.set(study, set);
  return set;
}

// synthetic "VAF" heatmap profile: variant allele fraction from mutation allele
// counts (the portal's "Variant Allele Frequency in Selected Mutations Profile").
// Patient-level value = max across the patient's mutations in the gene.
const _vafCache = new Map();
async function vafAvailable(study) {
  if (_vafCache.has(study)) return _vafCache.get(study);
  const r = await chQuery("SELECT 1 FROM " + DB + ".mutation_derived WHERE studyId = " + sq(study) + " AND tumorAltCount > 0 LIMIT 1");
  const ok = r.data.length > 0;
  _vafCache.set(study, ok);
  return ok;
}
export function vafSql(genes, study = STUDY) {
  return "SELECT patientId AS pid, `GENE.hugoGeneSymbol` AS gene,\n" +
    "       max(tumorAltCount / (tumorAltCount + tumorRefCount)) AS v\n" +
    "FROM " + DB + ".mutation_derived\n" +
    "WHERE studyId = " + sq(study) + " AND `GENE.hugoGeneSymbol` IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND tumorAltCount > 0 AND tumorRefCount >= 0\n" +
    "GROUP BY pid, gene";
}

// patient-level continuous values for heatmap tracks (columns are patients, so
// multi-sample patients get the mean across their samples — stated in the label)
export function heatmapSql(profileType, genes, study = STUDY) {
  return "SELECT replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '') AS pid,\n" +
    "       ga.hugo_gene_symbol AS gene, avg(toFloat64OrNull(ga.alteration_value)) AS v\n" +
    "FROM " + DB + ".genetic_alteration_derived ga\n" +
    "JOIN " + DB + ".sample_derived sd ON sd.sample_unique_id = ga.sample_unique_id\n" +
    "WHERE ga.cancer_study_identifier = " + sq(study) + " AND ga.profile_type = " + sq(profileType) + "\n" +
    "  AND ga.hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")\n" +
    "  AND toFloat64OrNull(ga.alteration_value) IS NOT NULL\n" +
    "GROUP BY pid, gene";
}

export function normalizeSpec(spec) {
  const genes = (spec.genes || []).map(g => String(g).toUpperCase().trim())
    .filter(g => GENE_RE.test(g)).slice(0, 12);
  if (!genes.length) throw new Error("at least one valid gene symbol required");
  const clinical = (spec.clinical || []).map(String).slice(0, 8);
  const derivedEvents = (spec.derivedEvents || []).slice(0, 3);
  const lineGap = spec.conventions && spec.conventions.lineGap ? Number(spec.conventions.lineGap) : 90;
  // sort: ordered track keys — "genomic" (staircase), a clinical/derived/heatmap
  // track label, or "-label" for descending. Default is the genomic staircase.
  const sort = (Array.isArray(spec.sort) && spec.sort.length ? spec.sort : ["genomic"]).slice(0, 4).map(s => {
    if (typeof s === "string") return s.startsWith("-") ? { track: s.slice(1), dir: "desc" } : { track: s, dir: "asc" };
    return { track: String(s && s.track || ""), dir: s && s.dir === "desc" ? "desc" : "asc" };
  });
  // heatmap: continuous per-gene molecular-profile tracks (portal-style).
  // [{profileType, genes?}] — genes default to the spec's gene tracks.
  const heatmap = (Array.isArray(spec.heatmap) ? spec.heatmap : []).slice(0, 4).map(h => ({
    profileType: String(h && h.profileType || ""),
    genes: (Array.isArray(h && h.genes) && h.genes.length ? h.genes : genes)
      .map(g => String(g).toUpperCase().trim()).filter(g => GENE_RE.test(g)).slice(0, 12)
  })).filter(h => h.profileType);
  return { genes, clinical, derivedEvents, lineGap, sort, heatmap };
}

// Provenance: the exact SQL a spec compiles to, without executing anything.
export function specToQueries(spec) {
  const study = (spec.study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  const { genes, clinical, derivedEvents, lineGap } = normalizeSpec(spec);
  const queries = [];
  const gb = spec.layout && spec.layout.groupBy;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    for (const g of gb.groups.slice(0, 4))
      queries.push({ label: "column group \u201c" + (g.name || "group") + "\u201d \u2014 cohort patients", sql: cohortPatientsSql({ ...g.dsl, lineGap }, study) });
  } else {
    const listN = spec.cohort && spec.cohort.dsl && Array.isArray(spec.cohort.dsl.patients) ? spec.cohort.dsl.patients.length : 0;
    queries.push({ label: listN ? "explicit patient list (" + listN + " ids, intersected with the study)" : (spec.cohort ? "cohort patients" : "all study patients"),
      sql: cohortPatientsSql(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null, study) });
  }
  queries.push({ label: "genomic events (mutations, CNA, SV) for the gene tracks", sql: genomicEventsSql(genes, study) });
  queries.push({ label: "panel coverage \u2014 the NOT_PROFILED cell source and frequency denominators", sql: coverageSql(genes, study) });
  if (clinical.length) queries.push({ label: "clinical attribute tracks", sql: clinicalSql(clinical, study) });
  for (const de of derivedEvents)
    queries.push({ label: "derived-event track \u201c" + (de.label || "derived event") + "\u201d \u2014 cohort-DSL patients", sql: cohortPatientsSql({ ...de.expression, lineGap }, study) });
  return { genes, clinical, lineGap, queries };
}

export async function buildContract(spec) {
  const t0 = Date.now();
  const study = (spec.study || STUDY).replace(/[^A-Za-z0-9._-]/g, "");
  // Federation: spec.studies = [..] makes this a multi-study contract. Columns are
  // then keyed by qualified ids ("<study>_<pid>") so id collisions across studies
  // stay distinct columns (overlap is deliberately NOT deduplicated), and every
  // per-study fetch below loops the study list. Single-study behavior is unchanged.
  const studies = (Array.isArray(spec.studies) && spec.studies.length ? spec.studies : [study])
    .map(s => String(s).replace(/[^A-Za-z0-9._-]/g, ""));
  const multi = studies.length > 1;
  const qual = (s, pid) => multi ? s + "_" + pid : pid;
  const { genes, clinical, derivedEvents, lineGap, sort, heatmap } = normalizeSpec(spec);
  if (multi && derivedEvents.length) throw new Error("derived-event tracks are single-study; drop them or the extra studies");

  // ---- columns: groups of patients --------------------------------------
  let groups; // [{name, pids: [columnId]}] — a patient lands in its first matching group
  const studyOf = new Map(); // columnId -> study (avoids prefix-ambiguity parsing)
  const gb = spec.layout && spec.layout.groupBy;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    groups = [];
    const seen = new Set();
    for (const g of gb.groups.slice(0, 4)) {
      const v = g.dsl && g.dsl[PIDS_SQL];
      const raw = [];
      if (v && typeof v === "object") {
        // federated group: {study: sql} map from analysis.js — fetch per study in
        // parallel, merge in study order (deterministic column order)
        const fetched = await Promise.all(studies.filter(s => typeof v[s] === "string").map(async (s) =>
          ({ s, r: await chQuery("SELECT pid FROM (\n" + v[s] + "\n)") })));
        for (const { s, r } of fetched)
          for (const x of r.data) { const id = qual(s, x.pid); raw.push(id); studyOf.set(id, s); }
      } else {
        for (const p of await cohortPatients({ ...g.dsl, lineGap }, studies[0])) {
          const id = qual(studies[0], p); raw.push(id); studyOf.set(id, studies[0]);
        }
      }
      const pids = raw.filter(p => !seen.has(p));
      pids.forEach(p => seen.add(p));
      groups.push({ name: g.name || "group " + (groups.length + 1), pids });
    }
  } else {
    if (multi) throw new Error("multi-study oncoprint requires cohort groups");
    const pids = await cohortPatients(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null, study);
    for (const p of pids) studyOf.set(p, study);
    groups = [{ name: "cohort", pids }];
  }
  const allPids = groups.flatMap(g => g.pids);
  if (!allPids.length) throw new Error("cohort is empty");
  const pidIndex = new Map(allPids.map((p, i) => [p, i])); // provisional index

  // ---- genomic events for the gene set (whole study; intersect in JS) ---
  const ev = { data: [] }, cov = { data: [] };
  const evFetched = await Promise.all(studies.map(s =>
    Promise.all([chQuery(genomicEventsSql(genes, s)), chQuery(coverageSql(genes, s))]).then(([e, c]) => ({ s, e, c }))));
  for (const { s, e, c } of evFetched) {
    for (const r of e.data) ev.data.push(multi ? { ...r, pid: qual(s, r.pid) } : r);
    // panel coverage per (patient, gene) — the NOT_PROFILED source
    for (const r of c.data) cov.data.push(multi ? { ...r, pid: qual(s, r.pid) } : r);
  }
  const annotation = await buildAnnotationIndex(ev.data, genes, multi ? studies : study);

  // ---- assemble gene-track cell maps ------------------------------------
  const geneCells = new Map(genes.map(g => [g, new Int32Array(allPids.length).fill(0)]));
  for (const g of genes) {
    const cells = geneCells.get(g);
    cells.fill(NOT_PROFILED);
  }
  for (const r of cov.data) {
    const i = pidIndex.get(r.pid);
    if (i === undefined) continue;
    const cells = geneCells.get(r.gene);
    if (cells && cells[i] === NOT_PROFILED) cells[i] = 0;
  }
  for (const r of ev.data) {
    const i = pidIndex.get(r.pid);
    if (i === undefined) continue;
    const cells = geneCells.get(r.gene);
    if (!cells) continue;
    let bit = 0;
    if (r.vt === "mutation") bit = mutClassBit(r.mt);
    else if (r.vt === "structural_variant") bit = BITS.SV;
    else if (r.vt === "cna") bit = Number(r.cna) >= 2 ? BITS.AMP : (Number(r.cna) <= -2 ? BITS.HOMDEL : 0);
    if (!bit) continue;
    if (annotation.isDriver(r)) bit |= BITS.DRIVER;
    cells[i] = (cells[i] === NOT_PROFILED ? 0 : cells[i]) | bit; // an observed event implies profiled
  }

  // ---- clinical tracks ---------------------------------------------------
  const clinTracks = [];
  if (multi) {
    // synthetic per-column provenance track; also the honest caveat that clinical
    // vocabularies below it are merged by attribute name, not harmonized
    const catIdx = new Map(studies.map((s, i) => [s, i]));
    const cells = new Int32Array(allPids.length).fill(-1);
    allPids.forEach((p, i) => { const s = studyOf.get(p); if (s != null) cells[i] = catIdx.get(s); });
    clinTracks.push({ kind: "clinical", label: "Study", categories: studies.slice(), cells });
  }
  if (clinical.length) {
    const cd = { data: [] };
    const cdFetched = await Promise.all(studies.map(async (s) => ({ s, r: await chQuery(clinicalSql(clinical, s)) })));
    for (const { s, r } of cdFetched)
      for (const x of r.data) cd.data.push(multi ? { ...x, pid: qual(s, x.pid) } : x);
    for (const attr of clinical) {
      const valByPid = new Map();
      for (const r of cd.data) if (r.k === attr) valByPid.set(r.pid, r.v);
      // numeric attribute (≥90% of present values parse, >10 distinct) -> continuous
      // heat track: cells are the value scaled to 0..255 over the cohort's min..max
      const present = allPids.map(p => valByPid.get(p)).filter(v => v != null);
      if (!present.length) { // unknown attribute or none of these patients have it — say so
        clinTracks.push({ kind: "clinical", label: attr + " (no data)", categories: [], cells: new Int32Array(allPids.length).fill(-1) });
        continue;
      }
      const nums = present.map(Number).filter(Number.isFinite);
      if (present.length && nums.length >= 0.9 * present.length && new Set(nums).size > 10) {
        const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
        const cells = new Int32Array(allPids.length).fill(-1);
        allPids.forEach((p, i) => {
          const x = Number(valByPid.get(p));
          if (Number.isFinite(x)) cells[i] = Math.round(255 * (x - min) / span);
        });
        clinTracks.push({ kind: "clinical", numeric: true, label: attr, min, max, cells });
        continue;
      }
      const counts = new Map();
      for (const p of allPids) { const v = valByPid.get(p); if (v != null) counts.set(v, (counts.get(v) || 0) + 1); }
      const categories = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(e => e[0]);
      const catIdx = new Map(categories.map((c, i) => [c, i]));
      const cells = new Int32Array(allPids.length).fill(-1);
      allPids.forEach((p, i) => {
        const v = valByPid.get(p);
        if (v != null) cells[i] = catIdx.has(v) ? catIdx.get(v) : categories.length; // last = Other
      });
      const hasOther = [...counts.keys()].some(v => !catIdx.has(v));
      clinTracks.push({ kind: "clinical", label: attr, categories: hasOther ? [...categories, "Other"] : categories, cells });
    }
  }

  // ---- heatmap tracks (continuous molecular-profile values per gene) ----
  // Portal-style: z-score profiles get a fixed diverging ramp (±3, center 0)
  // so colors are comparable across oncoprints; other profiles that span zero
  // get a symmetric diverging ramp; positive-only data gets a sequential ramp.
  const heatTracks = [];
  for (const h of heatmap) {
    const isVaf = /^vaf$/i.test(h.profileType);
    const avail = await Promise.all(studies.map(async (s) =>
      (isVaf ? await vafAvailable(s) : (await studyProfileTypes(s)).has(h.profileType)) ? s : null));
    const okStudies = avail.filter(Boolean);
    if (!okStudies.length)
      throw new Error(isVaf
        ? "heatmap: 'VAF' needs mutation allele counts, which " + studies.join("/") + " did not load"
        : "heatmap: profile '" + h.profileType + "' not in " + studies.join("/") +
          " (available: " + ([...(await studyProfileTypes(studies[0]))].join(", ") || "none") + ", VAF)");
    const valByKey = new Map(); // columnId|gene -> value
    const hFetched = await Promise.all(okStudies.map(async (s) =>
      ({ s, r: await chQuery(isVaf ? vafSql(h.genes, s) : heatmapSql(h.profileType, h.genes, s)) })));
    for (const { s, r } of hFetched)
      for (const row of r.data) valByKey.set(qual(s, row.pid) + "|" + row.gene, Number(row.v));
    const isZ = /zscore/i.test(h.profileType);
    for (const gene of h.genes) {
      const label = heatmapTrackLabel(gene, h.profileType);
      const vals = [];
      for (const p of allPids) { const v = valByKey.get(p + "|" + gene); if (v !== undefined) vals.push(v); }
      if (!vals.length) {
        heatTracks.push({ kind: "clinical", label: label + " (no data)", categories: [], cells: new Int32Array(allPids.length).fill(-1) });
        continue;
      }
      let min, max, center;
      if (isVaf) { min = 0; max = 1; center = null; }
      else if (isZ) { min = -3; max = 3; center = 0; }
      else {
        const dMin = Math.min(...vals), dMax = Math.max(...vals);
        if (dMin < 0 && dMax > 0) { const m = Math.max(-dMin, dMax); min = -m; max = m; center = 0; }
        else { min = dMin; max = dMax; center = null; }
      }
      const span = max - min || 1;
      const cells = new Int32Array(allPids.length).fill(-1);
      allPids.forEach((p, i) => {
        const v = valByKey.get(p + "|" + gene);
        if (v !== undefined) cells[i] = Math.round(255 * (Math.max(min, Math.min(max, v)) - min) / span);
      });
      heatTracks.push({ kind: "heatmap", numeric: true, label, gene, profileType: h.profileType,
        note: isVaf ? "allele fraction, max across a patient's mutations in the gene" : "mean across a patient's samples",
        min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100,
        center: center == null ? null : Math.round(255 * (0 - min) / span), cells });
    }
  }

  // ---- derived-event tracks (cohort-DSL expressions as phenotypes) ------
  const devTracks = [];
  for (const de of derivedEvents) {
    const pids = new Set(await cohortPatients({ ...de.expression, lineGap }, study));
    const cells = new Int32Array(allPids.length);
    allPids.forEach((p, i) => { cells[i] = pids.has(p) ? 1 : 0; });
    devTracks.push({ kind: "derivedEvent", label: String(de.label || "derived event").slice(0, 60), cells });
  }

  // ---- column sort within groups ----------------------------------------
  // Default is the genomic staircase: cells ranked by alteration type (CNA > SV >
  // truncating > in-frame > splice > missense > other), driver above VUS within
  // each type. spec.sort can put clinical/derived tracks first ("-" = descending,
  // missing values always last); the staircase and patient id remain the final
  // tiebreakers so every sort is total and deterministic.
  const cellRank = (c) => {
    if (c <= 0) return 0;
    const t = c & BITS.AMP ? 8 : c & BITS.HOMDEL ? 7 : c & BITS.SV ? 6 : c & BITS.TRUNCATING ? 5 :
      c & BITS.INFRAME ? 4 : c & BITS.SPLICE ? 3 : c & BITS.MISSENSE ? 2 : 1;
    return t * 2 + (c & BITS.DRIVER ? 1 : 0);
  };
  const genomicCmp = (x, y) => {
    for (const gene of genes) {
      const cells = geneCells.get(gene);
      const rx = cellRank(cells[x]), ry = cellRank(cells[y]);
      if (rx !== ry) return ry - rx;
    }
    return 0;
  };
  const sortableTracks = new Map([...clinTracks, ...devTracks, ...heatTracks].map(t => [t.label, t]));
  const trackCmp = (t, sign) => (x, y) => {
    const a = t.cells[x], b = t.cells[y];
    if (a === b) return 0;
    if (a === -1) return 1;
    if (b === -1) return -1;
    return sign * (a - b);
  };
  const cmps = sort.map(s => {
    const sign = s.dir === "desc" ? -1 : 1;
    if (s.track === "genomic") return (x, y) => sign * genomicCmp(x, y);
    const t = sortableTracks.get(s.track);
    if (!t) throw new Error("sort: '" + s.track + "' is not a track in this oncoprint — sortable: genomic" +
      (sortableTracks.size ? ", " + [...sortableTracks.keys()].join(", ") : "") +
      " (clinical sort keys must also be listed in clinical)");
    return trackCmp(t, sign);
  });
  cmps.push(genomicCmp);
  const order = [];
  let cursor = 0;
  const groupRanges = [];
  for (const g of groups) {
    const idxs = g.pids.map(p => pidIndex.get(p));
    idxs.sort((x, y) => {
      for (const c of cmps) { const r = c(x, y); if (r) return r; }
      return allPids[x] < allPids[y] ? -1 : 1;
    });
    order.push(...idxs);
    groupRanges.push({ name: g.name, start: cursor, count: idxs.length });
    cursor += idxs.length;
  }
  const remap = arr => order.map(i => arr[i]);
  const columns = order.map(i => allPids[i]);

  // ---- track meta (panel-aware frequencies) -----------------------------
  const tracks = [];
  for (const g of genes) {
    const cells = remap(geneCells.get(g));
    const profiled = cells.filter(c => c !== NOT_PROFILED).length;
    const altered = cells.filter(c => c > 0).length;
    const driverAltered = cells.filter(c => c > 0 && (c & BITS.DRIVER)).length;
    tracks.push({
      kind: "gene", label: g, cells,
      altered, profiled, driverAltered,
      freqPct: profiled ? Math.round(1000 * altered / profiled) / 10 : null,
      driverPct: profiled ? Math.round(1000 * driverAltered / profiled) / 10 : null
    });
  }
  for (const t of devTracks) {
    const cells = remap(t.cells);
    tracks.push({ ...t, cells, altered: cells.filter(c => c === 1).length, profiled: cells.length,
      freqPct: Math.round(1000 * cells.filter(c => c === 1).length / cells.length) / 10 });
  }
  for (const t of heatTracks) tracks.push({ ...t, cells: remap(t.cells) });
  for (const t of clinTracks) tracks.push({ ...t, cells: remap(t.cells) });

  return {
    study: multi ? studies.join(" + ") : study, studies, unit: "patient",
    groups: groupRanges,
    columns,
    tracks: tracks.map(t => ({ ...t, cells: Array.from(t.cells) })),
    conventions: { cna: "high-level only (±2)", notProfiled: "distinct cell state", frequencyDenominator: "profiled",
      annotation: annotation.source, lineGap,
      sort: sort.map(s => (s.dir === "desc" ? "-" : "") + s.track) },
    stats: { nColumns: columns.length, ms: Date.now() - t0 }
  };
}
