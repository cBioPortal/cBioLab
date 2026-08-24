// OncoprintSpec -> render contract engine.
// Spec (v1 subset): { cohort: {dsl}|null, genes: [..], clinical: [..],
//   derivedEvents: [{label, expression}], layout: {groupBy: {kind:'cohorts', groups:[{name,dsl}]}|null},
//   conventions: {lineGap} }
// Contract: sorted columns, typed cells (bitmask for gene tracks, NOT_PROFILED = -1),
//   panel-aware track frequencies, group ranges. The renderer does zero data logic.
import { chQuery, DB, STUDY } from "./ch.js";
import { compileCohort, sq } from "./compiler.js";
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

export function cohortPatientsSql(dsl) {
  // SQL for a cohort's stable_ids (null dsl = every patient with a sample).
  // dsl.patients = explicit patient list (e.g. imported from a portal custom case
  // list / session); membership is intersected with the study so unknown ids drop out.
  if (dsl && Array.isArray(dsl.patients)) {
    const ids = dsl.patients.map(String).filter(p => /^[A-Za-z0-9._-]{1,64}$/.test(p)).slice(0, 50000);
    if (!ids.length) throw new Error("patient list is empty or invalid");
    return "SELECT DISTINCT replaceOne(patient_unique_id, " + sq(STUDY + "_") + ", '') AS pid\n" +
      "FROM " + DB + ".sample_derived\n" +
      "WHERE cancer_study_identifier = " + sq(STUDY) + "\n" +
      "  AND replaceOne(patient_unique_id, " + sq(STUDY + "_") + ", '') IN (" + ids.map(sq).join(",") + ")\n" +
      "ORDER BY pid";
  }
  if (!dsl) {
    return "SELECT DISTINCT replaceOne(patient_unique_id, " + sq(STUDY + "_") + ", '') AS pid\n" +
      "FROM " + DB + ".sample_derived WHERE cancer_study_identifier = " + sq(STUDY) + " ORDER BY pid";
  }
  const { patientsSql } = compileCohort({
    db: DB, study: STUDY, a: dsl.a, b: dsl.b, rel: dsl.rel,
    priorGuard: !!dsl.priorGuard, lineGap: dsl.lineGap, patientsLimit: 100000
  });
  return patientsSql;
}

async function cohortPatients(dsl) {
  const r = await chQuery(cohortPatientsSql(dsl));
  return r.data.map(x => x.pid);
}

export function genomicEventsSql(genes) {
  const puidPrefix = STUDY + "_";
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       hugo_gene_symbol AS gene, variant_type AS vt, mutation_type AS mt,\n" +
    "       mutation_variant AS mv, cna_alteration AS cna\n" +
    "FROM " + DB + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(STUDY) + " AND hugo_gene_symbol IN (" + genes.map(sq).join(",") + ")";
}

export function coverageSql(genes) {
  const puidPrefix = STUDY + "_";
  return "SELECT DISTINCT replaceOne(sd.patient_unique_id, " + sq(puidPrefix) + ", '') AS pid, pg.gene AS gene\n" +
    "FROM " + DB + ".sample_to_gene_panel_derived sp\n" +
    "JOIN " + DB + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + genes.map(sq).join(",") + ")\n" +
    "JOIN " + DB + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "WHERE sp.cancer_study_identifier = " + sq(STUDY) + " AND sp.alteration_type = 'MUTATION_EXTENDED'";
}

export function clinicalSql(attrs) {
  const puidPrefix = STUDY + "_";
  return "SELECT replaceOne(patient_unique_id, " + sq(puidPrefix) + ", '') AS pid,\n" +
    "       attribute_name AS k, attribute_value AS v\n" +
    "FROM " + DB + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(STUDY) + " AND type = 'patient'\n" +
    "  AND attribute_name IN (" + attrs.map(sq).join(",") + ") AND attribute_value != ''";
}

export function normalizeSpec(spec) {
  const genes = (spec.genes || []).map(g => String(g).toUpperCase().trim())
    .filter(g => GENE_RE.test(g)).slice(0, 12);
  if (!genes.length) throw new Error("at least one valid gene symbol required");
  const clinical = (spec.clinical || []).map(String).slice(0, 3);
  const derivedEvents = (spec.derivedEvents || []).slice(0, 3);
  const lineGap = spec.conventions && spec.conventions.lineGap ? Number(spec.conventions.lineGap) : 90;
  return { genes, clinical, derivedEvents, lineGap };
}

// Provenance: the exact SQL a spec compiles to, without executing anything.
export function specToQueries(spec) {
  const { genes, clinical, derivedEvents, lineGap } = normalizeSpec(spec);
  const queries = [];
  const gb = spec.layout && spec.layout.groupBy;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    for (const g of gb.groups.slice(0, 4))
      queries.push({ label: "column group \u201c" + (g.name || "group") + "\u201d \u2014 cohort patients", sql: cohortPatientsSql({ ...g.dsl, lineGap }) });
  } else {
    const listN = spec.cohort && spec.cohort.dsl && Array.isArray(spec.cohort.dsl.patients) ? spec.cohort.dsl.patients.length : 0;
    queries.push({ label: listN ? "explicit patient list (" + listN + " ids, intersected with the study)" : (spec.cohort ? "cohort patients" : "all study patients"),
      sql: cohortPatientsSql(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null) });
  }
  queries.push({ label: "genomic events (mutations, CNA, SV) for the gene tracks", sql: genomicEventsSql(genes) });
  queries.push({ label: "panel coverage \u2014 the NOT_PROFILED cell source and frequency denominators", sql: coverageSql(genes) });
  if (clinical.length) queries.push({ label: "clinical attribute tracks", sql: clinicalSql(clinical) });
  for (const de of derivedEvents)
    queries.push({ label: "derived-event track \u201c" + (de.label || "derived event") + "\u201d \u2014 cohort-DSL patients", sql: cohortPatientsSql({ ...de.expression, lineGap }) });
  return { genes, clinical, lineGap, queries };
}

export async function buildContract(spec) {
  const t0 = Date.now();
  const { genes, clinical, derivedEvents, lineGap } = normalizeSpec(spec);

  // ---- columns: groups of patients --------------------------------------
  let groups; // [{name, pids: [stableId]}] — a patient lands in its first matching group
  const gb = spec.layout && spec.layout.groupBy;
  if (gb && gb.kind === "cohorts" && Array.isArray(gb.groups) && gb.groups.length) {
    groups = [];
    const seen = new Set();
    for (const g of gb.groups.slice(0, 4)) {
      const pids = (await cohortPatients({ ...g.dsl, lineGap })).filter(p => !seen.has(p));
      pids.forEach(p => seen.add(p));
      groups.push({ name: g.name || "group " + (groups.length + 1), pids });
    }
  } else {
    const pids = await cohortPatients(spec.cohort ? { ...spec.cohort.dsl, lineGap } : null);
    groups = [{ name: "cohort", pids }];
  }
  const allPids = groups.flatMap(g => g.pids);
  if (!allPids.length) throw new Error("cohort is empty");
  const puidPrefix = STUDY + "_";
  const pidIndex = new Map(allPids.map((p, i) => [p, i])); // provisional index

  // ---- genomic events for the gene set (whole study; intersect in JS) ---
  const ev = await chQuery(genomicEventsSql(genes));
  const annotation = await buildAnnotationIndex(ev.data, genes);

  // ---- panel coverage per (patient, gene) — the NOT_PROFILED source -----
  const cov = await chQuery(coverageSql(genes));

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
  if (clinical.length) {
    const cd = await chQuery(clinicalSql(clinical));
    for (const attr of clinical) {
      const valByPid = new Map();
      for (const r of cd.data) if (r.k === attr) valByPid.set(r.pid, r.v);
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

  // ---- derived-event tracks (cohort-DSL expressions as phenotypes) ------
  const devTracks = [];
  for (const de of derivedEvents) {
    const pids = new Set(await cohortPatients({ ...de.expression, lineGap }));
    const cells = new Int32Array(allPids.length);
    allPids.forEach((p, i) => { cells[i] = pids.has(p) ? 1 : 0; });
    devTracks.push({ kind: "derivedEvent", label: String(de.label || "derived event").slice(0, 60), cells });
  }

  // ---- staircase sort within groups -------------------------------------
  const order = [];
  let cursor = 0;
  const groupRanges = [];
  for (const g of groups) {
    const idxs = g.pids.map(p => pidIndex.get(p));
    idxs.sort((x, y) => {
      for (const gene of genes) {
        const ax = geneCells.get(gene)[x] > 0 ? 1 : 0;
        const ay = geneCells.get(gene)[y] > 0 ? 1 : 0;
        if (ax !== ay) return ay - ax;
      }
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
  for (const t of clinTracks) tracks.push({ ...t, cells: remap(t.cells) });

  return {
    study: STUDY, unit: "patient",
    groups: groupRanges,
    columns,
    tracks: tracks.map(t => ({ ...t, cells: Array.from(t.cells) })),
    conventions: { cna: "high-level only (±2)", notProfiled: "distinct cell state", frequencyDenominator: "profiled",
      annotation: annotation.source, lineGap },
    stats: { nColumns: columns.length, ms: Date.now() - t0 }
  };
}
