// Faceted study explorer: what exists, in what numbers — optionally conditioned on a
// draft cohort so every count narrows as clauses are added (study-view-style feedback).
// Everything returned is designed to be clickable into a DSL clause.
import { chQuery, DB, PRIMARY, type ChConn } from "./ch.ts";
import { sq } from "./compiler.ts";
import { compileCohortDef } from "./cohort2.ts";

import type { ExploreResult, ClinicalFacet, CohortDef, ChRow, StudyBreakdownRow, GeneTableRow, NumericBin } from "./types.ts";

/**
 * cBioPortal's linear bin intervals (LinearDataBinner). The binner picks the
 * smallest interval that divides the range into at most ~20 bins.
 */
const BIN_INTERVALS = [0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5,
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const BIN_INTERVALS_DISCRETE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const TARGET_BINS = 20;
/** how many numeric attributes get a histogram (each costs two grouped queries per study) */
const NUM_HISTOGRAM_LIMIT = 14;
/** values returned per categorical facet (a pie shows a few; a ranked list more) */
const FACET_VALUE_LIMIT = 20;

/**
 * Bin edges for a numeric attribute, reproducing the portal's algorithm:
 * IQR-based outlier bounds clamped to the data range, a "nice" interval, and
 * edges anchored to multiples of it. Returns the interior edges; anything
 * below the first or above the last becomes a "<=" / ">" outlier bar.
 */
export function numericBinEdges(
  dataMin: number, dataMax: number, q1: number, q3: number, allIntegers: boolean
): { edges: number[]; interval: number } {
  if (!(dataMax > dataMin)) return { edges: [], interval: 0 };
  const iqr = q3 - q1;
  const lowerOutlier = Math.max(dataMin, q1 - 1.5 * iqr);
  const upperOutlier = Math.min(dataMax, q3 + 1.5 * iqr);
  const min = Math.max(dataMin, lowerOutlier), max = Math.min(dataMax, upperOutlier);
  const list = allIntegers ? BIN_INTERVALS_DISCRETE : BIN_INTERVALS;
  const interval = list.find((i) => (max - min) / i <= TARGET_BINS) ?? list[list.length - 1];
  let start = min + interval - (min % interval);
  if (start - interval > lowerOutlier) start -= interval;
  const end = (max + interval < upperOutlier) ? max : max - interval;
  const edges: number[] = [];
  // guard against pathological ranges producing thousands of bars
  for (let d = start; d <= end && edges.length <= TARGET_BINS + 4; d += interval) {
    edges.push(Math.round(d * 1e6) / 1e6);
  }
  return { edges, interval };
}

/** display cap per gene table; totals report the full count behind it */
const GENE_TABLE_LIMIT = 500;
import { isClinicalLeaf } from "./types.ts";


/** Stats row from the classification query, for one numeric attribute. */
interface NumStats { a: string; mn: string; mx: string; q1: string; q3: string; allints: unknown }

/**
 * Attach histograms to numeric facets. Edges are either computed per attribute
 * (single study) or supplied by the caller (federated, so every participant
 * bins identically and the counts can simply be summed).
 */
async function attachHistograms(opts: {
  facets: Extract<ClinicalFacet, { kind: "num" }>[];
  stats: ChRow[];
  db: string; conn: ChConn; study: string; cond: string;
  cohort: { patients: number; samples: number };
  edgesByAttr?: Record<string, { edges: number[]; interval: number }>;
}): Promise<void> {
  const { facets, stats, db, conn, study, cond, cohort, edgesByAttr } = opts;
  await Promise.all(facets.map(async (f) => {
    let spec = edgesByAttr?.[f.attribute];
    if (!spec) {
      const src = stats.find((r) => r.a === f.attribute) as unknown as NumStats | undefined;
      if (!src) return;
      spec = numericBinEdges(Number(src.mn), Number(src.mx), Number(src.q1), Number(src.q3),
        String(src.allints) === "1");
    }
    const { edges, interval } = spec;
    if (edges.length < 2) return;
    const lastEdge = edges[edges.length - 1] + interval;
    const unit = f.per === "sample" ? "sample_unique_id" : "patient_unique_id";
    const source =
      "(SELECT toFloat64OrNull(attribute_value) AS v, " + unit + " AS id\n" +
      " FROM " + db + ".clinical_data_derived\n" +
      " WHERE cancer_study_identifier = " + sq(study) + " AND attribute_name = " + sq(f.attribute) +
      "   AND type = " + sq(f.per) + " AND attribute_value != ''" + cond + ")";
    // portal bins are (start, end]: a value on an edge belongs to the lower bar
    const [rows, outliers] = await Promise.all([
      chQuery<ChRow>(
        "SELECT toInt32(ceil((v - " + edges[0] + ") / " + interval + ")) - 1 AS b, uniqExact(id) AS n\n" +
        "FROM " + source + "\n" +
        "WHERE v IS NOT NULL AND v > " + edges[0] + " AND v <= " + lastEdge + "\n" +
        "GROUP BY b ORDER BY b", conn),
      chQuery<ChRow>(
        "SELECT uniqExactIf(id, v <= " + edges[0] + ") AS lo, uniqExactIf(id, v > " + lastEdge + ") AS hi\n" +
        "FROM " + source, conn)
    ]);
    const byBin = new Map<number, number>(rows.data.map((x) => [Number(x.b), Number(x.n)]));
    const counted = rows.data.reduce((n, x) => n + Number(x.n), 0);
    const lo = Number(outliers.data[0]?.lo || 0), hi = Number(outliers.data[0]?.hi || 0);
    const bins: NumericBin[] = [];
    if (lo) bins.push({ special: "<=", end: edges[0], count: lo });
    edges.forEach((e, i) => bins.push({ start: e, end: Math.round((e + interval) * 1e6) / 1e6, count: byBin.get(i) || 0 }));
    if (hi) bins.push({ special: ">", start: lastEdge, count: hi });
    const cohortSize = f.per === "sample" ? cohort.samples : cohort.patients;
    f.naCount = Math.max(0, cohortSize - (counted + lo + hi));
    f.bins = bins;
  }));
}

export async function buildExplore({ study, draft, oncokbPin, profiles, gaProfiles, conn = PRIMARY, geneSearch, skipBins, binEdges }: { study: string; draft?: CohortDef | null; oncokbPin?: string | null; profiles?: string[]; gaProfiles?: string[]; conn?: ChConn; geneSearch?: string; skipBins?: boolean; binEdges?: Record<string, { edges: number[]; interval: number }> }): Promise<ExploreResult> {
  const db = conn.db;
  const t0 = Date.now();
  let cond = "", sampleCond = "", panelSampleCond = "", draftCount = null, dsql = null;
  if (draft && Array.isArray(draft.all) && draft.all.length) {
    dsql = compileCohortDef(draft, { oncokbPin, profiles, gaProfiles, study, db });
    cond = "\n  AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (" + dsql + "))";
    sampleCond = cond; // sample_derived / genomic_event_derived both carry patient_unique_id
    // sample_to_gene_panel_derived has no patient column, so map through sample_derived
    panelSampleCond = "\n  AND sample_unique_id IN (SELECT sample_unique_id FROM " + db + ".sample_derived" +
      " WHERE cancer_study_identifier = " + sq(study) +
      " AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (" + dsql + ")))";
    const c = await chQuery("SELECT uniqExact(pid) AS n FROM (" + dsql + ")", conn);
    draftCount = Number(c.data[0].n);
  }
  // how many patients this study contributes under the current draft (or in total)
  const studyN = draftCount ?? Number((await chQuery<ChRow>(
    "SELECT uniqExact(patient_unique_id) AS n FROM " + db + ".sample_derived WHERE cancer_study_identifier = " + sq(study), conn
  )).data[0].n);
  const studyBreakdown: StudyBreakdownRow[] = [
    { study, n: studyN, instance: conn.id, instanceLabel: conn.label }
  ];
  // both units, as the portal's study-view header reports them: facets are
  // counted in their natural unit, so the header anchors what each one means
  const totalsRow = (await chQuery<ChRow>(
    "SELECT uniqExact(patient_unique_id) AS pts, uniqExact(sample_unique_id) AS smp\n" +
    "FROM " + db + ".sample_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + sampleCond, conn)).data[0];
  const totals = { patients: Number(totalsRow.pts), samples: Number(totalsRow.smp) };

  // ---- attribute metadata: the portal's own declarations -----------------
  // datatype here is DECLARED, not sniffed from values, which is what the study
  // view uses to decide pie-vs-histogram. priority drives chart ordering, and
  // priority 0 means "available but hidden by default" in the portal.
  const metaRows = await chQuery<ChRow>(
    "SELECT cam.attr_id AS a, cam.datatype AS datatype, cam.display_name AS display_name,\n" +
    "       cam.description AS description, cam.priority AS priority, cam.patient_attribute AS patient_attribute\n" +
    "FROM " + db + ".clinical_attribute_meta cam\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = cam.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study), conn).catch(() => ({ data: [] as ChRow[] }));
  const meta = new Map(metaRows.data.map((r) => [r.a, r]));

  // ---- clinical attributes: classify categorical vs numeric --------------
  const cls = await chQuery(
    "SELECT type, attribute_name AS a, uniqExact(attribute_value) AS nv,\n" +
    "  countIf(toFloat64OrNull(attribute_value) IS NOT NULL) / count() AS numratio,\n" +
    "  uniqExact(if(type = 'sample', sample_unique_id, patient_unique_id)) AS np,\n" +
    "  min(toFloat64OrNull(attribute_value)) AS mn, max(toFloat64OrNull(attribute_value)) AS mx,\n" +
    "  quantileExact(0.5)(toFloat64OrNull(attribute_value)) AS md,\n" +
    "  quantileExact(0.25)(toFloat64OrNull(attribute_value)) AS q1,\n" +
    "  quantileExact(0.75)(toFloat64OrNull(attribute_value)) AS q3,\n" +
    "  countIf(toFloat64OrNull(attribute_value) IS NULL) AS na,\n" +
    "  countIf(toFloat64OrNull(attribute_value) = round(toFloat64OrNull(attribute_value))) = countIf(toFloat64OrNull(attribute_value) IS NOT NULL) AS allints\n" +
    "FROM " + db + ".clinical_data_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_value != ''" + cond + "\n" +
    "GROUP BY type, a ORDER BY np DESC LIMIT 250", conn);
  // Declared datatype wins; the old value-sniffing survives only as a fallback
  // for attributes with no metadata row, so nothing is silently discarded.
  const declaredNumeric = (r: ChRow): boolean => {
    const m = meta.get(r.a);
    if (m) return String(m.datatype).toUpperCase() === "NUMBER";
    return Number(r.numratio) >= 0.9 && Number(r.nv) > 10;
  };
  const numAttrs = cls.data.filter(declaredNumeric);
  const catAttrs = cls.data.filter((r) => !declaredNumeric(r));

  let catValues: ChRow[] = [];
  if (catAttrs.length) {
    const v = await chQuery(
      "SELECT type, attribute_name AS a, attribute_value AS v,\n" +
      "       uniqExact(if(type = 'sample', sample_unique_id, patient_unique_id)) AS n\n" +
      "FROM " + db + ".clinical_data_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_value != ''\n" +
      "  AND attribute_name IN (" + catAttrs.map(r => sq(r.a)).join(",") + ")" + cond + "\n" +
      "GROUP BY type, a, v ORDER BY n DESC LIMIT " + FACET_VALUE_LIMIT + " BY type, a", conn);
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
      const rsql = compileCohortDef(rest, { oncokbPin, profiles, gaProfiles, study, db });
      subCond = "\n  AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (" + rsql + "))";
    }
    const v = await chQuery(
      "SELECT attribute_value AS v, uniqExact(if(type = 'sample', sample_unique_id, patient_unique_id)) AS n\n" +
      "FROM " + db + ".clinical_data_derived\n" +
      "WHERE cancer_study_identifier = " + sq(study) + " AND attribute_value != ''\n" +
      "  AND type = " + sq(per) + " AND attribute_name = " + sq(attr) + subCond + "\n" +
      "GROUP BY v ORDER BY n DESC LIMIT " + FACET_VALUE_LIMIT, conn);
    disjValues.set(key, v.data.map(x => ({ v: x.v, n: Number(x.n) })));
  }

  const clinical: ClinicalFacet[] = [
    ...catAttrs.map((r): ClinicalFacet => ({
      attribute: r.a, per: r.type as "patient" | "sample", kind: "cat", patients: Number(r.np),
      distinct: Number(r.nv),
      values: disjValues.get(r.type + "|" + r.a) ||
        catValues.filter((x) => x.a === r.a && x.type === r.type).map((x) => ({ v: x.v, n: Number(x.n) })),
      disjunctive: disjValues.has(r.type + "|" + r.a) || undefined
    })),
    ...numAttrs.map((r): ClinicalFacet => ({
      attribute: r.a, per: r.type as "patient" | "sample", kind: "num", patients: Number(r.np),
      min: Number(r.mn), max: Number(r.mx), median: Number(r.md), naCount: Number(r.na)
    }))
  ].map((f) => {
    const m = meta.get(f.attribute);
    return m ? {
      ...f,
      displayName: m.display_name || undefined,
      description: m.description || undefined,
      priority: Number(m.priority) || 0
    } : f;
  }).sort((x, y) => {
    // portal ordering: declared priority first, then coverage
    const pd = (y.priority ?? 0) - (x.priority ?? 0);
    return pd !== 0 ? pd : y.patients - x.patients;
  });

  // ---- numeric histograms (cBioPortal study-view bins) --------------------
  if (!skipBins) {
    const numFacets = clinical.filter((c): c is Extract<ClinicalFacet, { kind: "num" }> => c.kind === "num").slice(0, NUM_HISTOGRAM_LIMIT);
    await attachHistograms({
      facets: numFacets, stats: numAttrs, db, conn, study, cond,
      cohort: totals, edgesByAttr: binEdges
    });
  }

  // ---- timeline event types ----------------------------------------------
  const ev = await chQuery(
    "SELECT ce.event_type AS t, uniqExact(ce.patient_id) AS n\n" +
    "FROM " + db + ".clinical_event ce\n" +
    "JOIN " + db + ".patient p ON p.internal_id = ce.patient_id\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = p.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier = " + sq(study) +
    (dsql ? "\n  AND p.stable_id IN (SELECT pid FROM (" + dsql + "))" : "") + "\n" +
    "GROUP BY t ORDER BY n DESC", conn);

  // ---- gene tables: Mutated / CNA / SV, cBioPortal study-view semantics ----
  // Counts are SAMPLES. The denominator is samples profiled for THAT gene in the
  // relevant alteration type, computed the way the portal does it:
  //   profiled(gene) = panel-profiled(gene)  +  whole-exome sample count
  // The WES panel is excluded from the join on purpose: it enumerates ~45k genes,
  // so joining it multiplies every WES sample by that many rows (47.8M for one
  // TCGA study). The portal splits it into a scalar for exactly this reason.
  const geneTable = async (
    variantType: "mutation" | "cna" | "structural_variant",
    alterationType: "MUTATION_EXTENDED" | "COPY_NUMBER_ALTERATION" | "STRUCTURAL_VARIANT"
  ): Promise<{ rows: GeneTableRow[]; total: number }> => {
    const isCna = variantType === "cna";
    const where =
      "WHERE cancer_study_identifier = " + sq(study) + "\n" +
      "  AND variant_type = " + sq(variantType) +
      // the portal excludes uncalled mutations: they exist only to show read support
      (variantType === "mutation" ? "\n  AND mutation_status != 'UNCALLED'" : "") +
      (geneSearch ? "\n  AND positionCaseInsensitive(hugo_gene_symbol, " + sq(geneSearch) + ") > 0" : "") +
      sampleCond;

    const [altered, panelProfiled, wes, distinct] = await Promise.all([
      chQuery<ChRow>(
        "SELECT hugo_gene_symbol AS g," + (isCna ? " cna_alteration AS cna, any(cna_cytoband) AS cytoband," : "") + "\n" +
        "       uniqExact(sample_unique_id) AS altered, count() AS events\n" +
        "FROM " + db + ".genomic_event_derived\n" + where + "\n" +
        "GROUP BY g" + (isCna ? ", cna" : "") + "\n" +
        "ORDER BY altered DESC, g ASC LIMIT " + GENE_TABLE_LIMIT, conn),
      // Aggregate samples PER PANEL first, then join panels to their genes. The
      // naive sample-level join costs 13s on a 290k-sample study; collapsing to
      // ~100 panel rows first gives the identical answer in ~250ms.
      chQuery<ChRow>(
        "WITH pc AS (\n" +
        "  SELECT gene_panel_id, count() AS n\n" +
        "  FROM " + db + ".sample_to_gene_panel_derived\n" +
        "  WHERE cancer_study_identifier = " + sq(study) + "\n" +
        "    AND alteration_type = " + sq(alterationType) + " AND gene_panel_id != 'WES'" +
        panelSampleCond + "\n" +
        "  GROUP BY gene_panel_id\n" +
        ")\n" +
        "SELECT gptg.gene AS g, sum(pc.n) AS n\n" +
        "FROM " + db + ".gene_panel_to_gene_derived gptg\n" +
        "INNER JOIN pc ON pc.gene_panel_id = gptg.gene_panel_id\n" +
        "WHERE gptg.gene_panel_id IN (SELECT gene_panel_id FROM pc)\n" +
        "GROUP BY g", conn),
      chQuery<ChRow>(
        "SELECT count() AS n\n" +
        "FROM " + db + ".sample_to_gene_panel_derived\n" +
        "WHERE cancer_study_identifier = " + sq(study) + "\n" +
        "  AND alteration_type = " + sq(alterationType) + " AND gene_panel_id = 'WES'" +
        panelSampleCond, conn),
      chQuery<ChRow>(
        "SELECT uniqExact(hugo_gene_symbol) AS n FROM " + db + ".genomic_event_derived\n" + where, conn)
    ]);

    const panelMap = new Map<string, number>(panelProfiled.data.map((r) => [r.g, Number(r.n)]));
    const wesN = Number(wes.data[0]?.n || 0);
    const rows = altered.data.map((r): GeneTableRow => {
      const profiled = (panelMap.get(r.g) || 0) + wesN;
      const alt = Number(r.altered);
      return {
        gene: r.g, altered: alt, events: Number(r.events), profiled,
        freqPct: profiled ? Math.round(1000 * alt / profiled) / 10 : null,
        ...(isCna ? { cna: Number(r.cna), cytoband: r.cytoband } : {})
      };
    });
    return { rows, total: Number(distinct.data[0]?.n || 0) };
  };

  const [mut, cna, sv] = await Promise.all([
    geneTable("mutation", "MUTATION_EXTENDED"),
    geneTable("cna", "COPY_NUMBER_ALTERATION"),
    geneTable("structural_variant", "STRUCTURAL_VARIANT")
  ]);
  const mutatedGenes = mut.rows, cnaGenes = cna.rows, svGenes = sv.rows;
  const geneTotals = { mutated: mut.total, cna: cna.total, sv: sv.total };

  // legacy combined list (patients), retained for existing consumers
  const genes = await chQuery(
    "SELECT hugo_gene_symbol AS g, uniqExact(patient_unique_id) AS n\n" +
    "FROM " + db + ".genomic_event_derived\n" +
    "WHERE cancer_study_identifier = " + sq(study) + "\n" +
    "  AND (variant_type != 'cna' OR abs(cna_alteration) >= 2)" + cond + "\n" +
    "GROUP BY g ORDER BY n DESC LIMIT 15", conn);

  // ---- molecular data types (portal: molecular-profile sample counts) -----
  // Samples with data of each type. The three that our DSL can filter on
  // (mutation / CNA / SV) become `profiled` clauses when clicked.
  const dt = await chQuery<ChRow>(
    "SELECT replaceOne(gp.stable_id, concat(sd.cancer_study_identifier, '_'), '') AS profile,\n" +
    "       any(gp.name) AS label, gp.genetic_alteration_type AS atype, uniqExact(sp.sample_id) AS n\n" +
    "FROM " + db + ".sample_profile sp\n" +
    "JOIN " + db + ".sample_derived sd ON sp.sample_id = sd.internal_id\n" +
    "JOIN " + db + ".genetic_profile gp ON sp.genetic_profile_id = gp.genetic_profile_id\n" +
    "WHERE sd.cancer_study_identifier = " + sq(study) +
    (dsql ? "\n  AND replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (" + dsql + "))" : "") + "\n" +
    "GROUP BY gp.stable_id, sd.cancer_study_identifier, atype ORDER BY n DESC", conn);
  const dataTypes = dt.data.map((r) => ({
    profile: r.profile, label: r.label, alterationType: r.atype, n: Number(r.n)
  }));

  // ---- case lists (draft-conditioned, like every other facet) ------------
  const lists = await chQuery(
    "SELECT sl.stable_id AS id, any(sl.name) AS name, uniqExact(p.stable_id) AS n\n" +
    "FROM " + db + ".sample_list sl\n" +
    "JOIN " + db + ".sample_list_list sll ON sll.list_id = sl.list_id\n" +
    "JOIN " + db + ".sample s ON s.internal_id = sll.sample_id\n" +
    "JOIN " + db + ".patient p ON p.internal_id = s.patient_id\n" +
    "WHERE sl.stable_id LIKE " + sq(study + "_%") +
    (dsql ? "\n  AND p.stable_id IN (SELECT pid FROM (" + dsql + "))" : "") + "\n" +
    "GROUP BY id ORDER BY n DESC LIMIT 10", conn);

  return {
    study, draftCount, studyBreakdown,
    clinical,
    events: ev.data.map((r) => ({ type: r.t, n: Number(r.n) })),
    genes: genes.data.map((r) => ({ gene: r.g, n: Number(r.n) })),
    caseLists: lists.data.map((r) => ({ id: r.id.replace(study + "_", ""), name: r.name, n: Number(r.n) })),
    mutatedGenes, cnaGenes, svGenes, geneTotals, totals, dataTypes,
    numStats: numAttrs.map((r) => ({ attribute: r.a, per: r.type as "patient" | "sample", min: Number(r.mn), max: Number(r.mx), q1: Number(r.q1), q3: Number(r.q3), allInts: String(r.allints) === "1", n: Number(r.np) })),
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
export async function buildExploreFederated({ studies, draft, oncokbPin, profilesByStudy, connByStudy, geneSearch }: { studies: string[]; draft?: CohortDef | null; oncokbPin?: string | null; profilesByStudy: Map<string, { profiles: string[]; gaProfiles: string[] }>; connByStudy?: Map<string, ChConn>; geneSearch?: string }): Promise<ExploreResult> {
  // Pass 1: facets per study, WITHOUT histograms — each study's own quartiles
  // would give it different bin edges, and bars over different ranges cannot be
  // summed. Skip the work rather than compute bins we would throw away.
  const parts = await Promise.all(studies.map(s =>
    buildExplore({ study: s, draft, oncokbPin, geneSearch, skipBins: true,
      conn: connByStudy?.get(s) || PRIMARY, ...(profilesByStudy.get(s) || {}) })));

  // Pass 2: derive ONE set of edges per attribute from the pooled statistics,
  // then have every study bin against those, so the bars line up and add.
  const merged = mergeExplore(parts, !!draft);
  const edgesByAttr = sharedBinEdges(parts);
  if (Object.keys(edgesByAttr).length) {
    const numFacets = merged.clinical.filter(
      (c): c is Extract<ClinicalFacet, { kind: "num" }> => c.kind === "num" && !!edgesByAttr[c.attribute]).slice(0, NUM_HISTOGRAM_LIMIT);
    // one per-study histogram set, summed into the merged facets
    const perStudy = await Promise.all(studies.map(async (st) => {
      const conn = connByStudy?.get(st) || PRIMARY;
      const facets = numFacets.map((f) => ({ ...f, bins: undefined, naCount: 0 })) as typeof numFacets;
      const part = parts[studies.indexOf(st)];
      await attachHistograms({
        facets, stats: [], db: conn.db, conn, study: st,
        cond: draft ? draftCondFor(st, conn.db, draft, { oncokbPin, ...(profilesByStudy.get(st) || {}) }) : "",
        cohort: part.totals || { patients: 0, samples: 0 }, edgesByAttr
      });
      return facets;
    }));
    for (const f of numFacets) {
      const contributions = perStudy.map((set) => set.find((x) => x.attribute === f.attribute)).filter(Boolean) as typeof numFacets;
      const withBins = contributions.filter((c) => c.bins && c.bins.length);
      if (!withBins.length) continue;
      const template = withBins[0].bins!;
      f.bins = template.map((b, i) => ({ ...b, count: withBins.reduce((n, c) => n + (c.bins![i]?.count || 0), 0) }));
      f.naCount = withBins.reduce((n, c) => n + (c.naCount || 0), 0);
    }
  }
  return merged;
}

/** The draft predicate a given study would apply — needed for pass-2 binning. */
function draftCondFor(study: string, db: string, draft: CohortDef, ctx: { oncokbPin?: string | null; profiles?: string[]; gaProfiles?: string[] }): string {
  const dsql = compileCohortDef(draft, { ...ctx, study, db });
  return "\n  AND replaceOne(patient_unique_id, " + sq(study + "_") + ", '') IN (SELECT pid FROM (" + dsql + "))";
}

/**
 * One set of bin edges per numeric attribute, from the pooled statistics.
 * min/max pool exactly; quartiles do not decompose, so they are approximated by
 * a size-weighted mean — the same approximation already used for the median,
 * and it only shifts where the outlier bars fall, never a count.
 */
function sharedBinEdges(parts: ExploreResult[]): Record<string, { edges: number[]; interval: number }> {
  const byAttr = new Map<string, NonNullable<ExploreResult["numStats"]>>();
  for (const p of parts) for (const st of p.numStats || []) {
    if (!byAttr.has(st.attribute)) byAttr.set(st.attribute, []);
    byAttr.get(st.attribute)!.push(st);
  }
  const out: Record<string, { edges: number[]; interval: number }> = {};
  for (const [attr, list] of byAttr) {
    const n = list.reduce((a, x) => a + x.n, 0) || 1;
    const spec = numericBinEdges(
      Math.min(...list.map((x) => x.min)),
      Math.max(...list.map((x) => x.max)),
      list.reduce((a, x) => a + x.q1 * x.n, 0) / n,
      list.reduce((a, x) => a + x.q3 * x.n, 0) / n,
      list.every((x) => x.allInts)
    );
    if (spec.edges.length >= 2) out[attr] = spec;
  }
  return out;
}

/**
 * Merge faceted catalogs from several participants. Every input is already
 * aggregate, and the merge is pure arithmetic — which is exactly why it does
 * not matter whether a part was computed over a local connection or fetched
 * from a remote peer over MCP.
 */
export function mergeExplore(parts: ExploreResult[], hasDraft?: boolean): ExploreResult {
  const t0 = Date.now();
  if (parts.length === 1) return parts[0];
  const draft = hasDraft ?? parts.some((p) => p.draftCount != null);
  const studies = parts.flatMap((p) => p.studies || [p.study]);

  const clin = new Map<string, ClinicalFacet[]>(); // per|attribute -> list of items
  for (const p of parts) for (const a of p.clinical) {
    const k = a.per + "|" + a.attribute;
    if (!clin.has(k)) clin.set(k, []);
    clin.get(k)!.push(a);
  }
  const clinical: ClinicalFacet[] = [...clin.values()].map((items): ClinicalFacet => {
    const kind = items.slice().sort((x, y) => y.patients - x.patients)[0].kind;
    const same = items.filter((i) => i.kind === kind);
    const nums = same.filter((i): i is Extract<ClinicalFacet, { kind: "num" }> => i.kind === "num");
    const cats = same.filter((i): i is Extract<ClinicalFacet, { kind: "cat" }> => i.kind === "cat");
    const patients = same.reduce((s: number, i) => s + i.patients, 0);
    const withMeta = same.find((i) => i.displayName || i.priority != null) || same[0];
    const base = {
      attribute: same[0].attribute, per: same[0].per, patients,
      displayName: withMeta.displayName, description: withMeta.description,
      priority: withMeta.priority, distinct: Math.max(...same.map((i) => i.distinct ?? 0)) || undefined
    };
    if (kind === "num") {
      return { ...base, kind: "num" as const,
        min: Math.min(...nums.map((i) => i.min)), max: Math.max(...nums.map((i) => i.max)),
        median: Math.round(10 * nums.reduce((s: number, i) => s + i.median * i.patients, 0) / patients) / 10 };
    }
    const vals = new Map<string, number>();
    for (const i of cats) for (const v of i.values) vals.set(v.v, (vals.get(v.v) || 0) + v.n);
    // preserve the disjunctive marker: if any participant re-queried this
    // attribute without its own clauses, the merged totals are on that basis
    const disjunctive = cats.some((i) => i.disjunctive) || undefined;
    return { ...base, kind: "cat" as const, ...(disjunctive ? { disjunctive } : {}), values: [...vals.entries()].map(([v, n]) => ({ v, n })).sort((x, y) => y.n - x.n).slice(0, FACET_VALUE_LIMIT) };
  }).sort((x, y) => {
    const pd = (y.priority ?? 0) - (x.priority ?? 0);
    return pd !== 0 ? pd : y.patients - x.patients;
  });

  const sumBy = (arrs: any[][], key: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of arrs.flat()) m.set(r[key], (m.get(r[key]) || 0) + r.n);
    return m;
  };
  const evm = sumBy(parts.map(p => p.events), "type");
  const gm = sumBy(parts.map(p => p.genes), "gene");
  // gene tables: sum altered/events/profiled per (gene, cna) across participants
  const mergeGeneTable = (pick: (p: ExploreResult) => GeneTableRow[] | undefined): GeneTableRow[] => {
    const m = new Map<string, GeneTableRow>();
    for (const p of parts) for (const r of pick(p) || []) {
      const k = r.gene + "|" + (r.cna ?? "");
      const cur = m.get(k);
      if (!cur) { m.set(k, { ...r }); continue; }
      cur.altered += r.altered; cur.events += r.events; cur.profiled += r.profiled;
      cur.cytoband = cur.cytoband || r.cytoband;
    }
    return [...m.values()]
      .map((r) => ({ ...r, freqPct: r.profiled ? Math.round(1000 * r.altered / r.profiled) / 10 : null }))
      .sort((a, b) => b.altered - a.altered)
      .slice(0, GENE_TABLE_LIMIT);
  };

  const lm = new Map<string, { id: string; name: string; n: number }>();
  for (const p of parts) for (const l of p.caseLists) {
    const cur = lm.get(l.id) || { id: l.id, name: l.name, n: 0 };
    cur.n += l.n; lm.set(l.id, cur);
  }
  return {
    study: studies.join(" + "),
    studies,
    draftCount: draft ? parts.reduce((s, p) => s + (p.draftCount || 0), 0) : null,
    studyBreakdown: parts.flatMap((p) => p.studyBreakdown || []).sort((a, b) => b.n - a.n),
    clinical,
    events: [...evm.entries()].map(([type, n]) => ({ type, n })).sort((x, y) => y.n - x.n),
    genes: [...gm.entries()].map(([gene, n]) => ({ gene, n })).sort((x, y) => y.n - x.n).slice(0, 15),
    caseLists: [...lm.values()].sort((x, y) => y.n - x.n).slice(0, 10),
    mutatedGenes: mergeGeneTable((p) => p.mutatedGenes),
    cnaGenes: mergeGeneTable((p) => p.cnaGenes),
    svGenes: mergeGeneTable((p) => p.svGenes),
    geneTotals: {
      mutated: Math.max(...parts.map((p) => p.geneTotals?.mutated || 0)),
      cna: Math.max(...parts.map((p) => p.geneTotals?.cna || 0)),
      sv: Math.max(...parts.map((p) => p.geneTotals?.sv || 0))
    },
    totals: {
      patients: parts.reduce((n, p) => n + (p.totals?.patients || 0), 0),
      samples: parts.reduce((n, p) => n + (p.totals?.samples || 0), 0)
    },
    dataTypes: (() => {
      const m = new Map<string, { profile: string; label: string; alterationType: string; n: number }>();
      for (const p of parts) for (const d of p.dataTypes || []) {
        const cur = m.get(d.profile);
        if (cur) cur.n += d.n; else m.set(d.profile, { ...d });
      }
      return [...m.values()].sort((a, b) => b.n - a.n);
    })(),
    profiles: [...new Set(parts.flatMap((p) => p.profiles))],
    gaProfiles: [...new Set(parts.flatMap((p) => p.gaProfiles))],
    stats: { ms: Date.now() - t0, perStudy: Object.fromEntries(parts.map((p, i) => [studies[i], p.draftCount])) }
  };
}
