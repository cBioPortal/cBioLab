// Federation: an analysis document fulfilled by several *instances* of differing
// trust level.
//
// Two modes, one interface:
//   - patient-level  — the engine may see member ids. All views work.
//   - aggregate-only — the instance answers with counts only, never ids. Compare
//                      and survival work (their inputs decompose into sums);
//                      oncoprint cannot, because its columns ARE patients.
//
// The distinction is enforced STRUCTURALLY, not by a flag: AggregateResolver has
// no method that returns a patient id, so no code path — buggy or otherwise —
// can leak one. Adding such a method is a type error at every call site that
// expects the aggregate contract.
//
// PROTOTYPE NOTE: both resolvers presently talk to the same ClickHouse
// connection; the aggregate-only instance *declines* to expose patient-level
// data rather than being unable to reach it. That is a faithful test of the
// engine (merge math, capability negotiation, honest degradation) and a stub
// for the transport — a real deployment swaps in a second connection
// (data-level federation) or an MCP client to a remote Cohort Lab
// (document-level federation) behind the same interface.
import { chQuery, DB } from "./ch.ts";
import { sq } from "./compiler.ts";
import { compileCohortDef } from "./cohort2.ts";
import { genomicEventsSql, coverageSql } from "./oncoprint.ts";
import type { CohortDef, CompileCtx, ChRow } from "./types.ts";

export type InstanceMode = "patient-level" | "aggregate-only";

export interface Instance {
  id: string;
  mode: InstanceMode;
  /** human label for captions */
  label: string;
}

/** per (cohort, gene) alteration tallies — the compare view's atom */
export interface GeneCounts { gene: string; profiled: number; altered: number; driver: number }
/** (months, event) multiset — pools exactly across instances, carries no ids */
export interface SurvivalCount { months: number; event: number; n: number }

const LOCAL: Instance = { id: "local", mode: "patient-level", label: "this instance" };

/**
 * Which instance owns a study. Prototype: studies listed in
 * AGGREGATE_ONLY_STUDIES belong to a simulated aggregate-only peer.
 */
export function instanceForStudy(study: string): Instance {
  const agg = (process.env.AGGREGATE_ONLY_STUDIES || "")
    .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  if (agg.includes(study)) {
    return { id: "peer", mode: "aggregate-only", label: "peer instance (aggregate-only)" };
  }
  return LOCAL;
}

// ---------------------------------------------------------------------------
// SQL builders shared by both resolvers. The aggregate resolver needs these
// pushed into ClickHouse (it may not pull rows back and tally in JS); the
// patient-level resolver benefits from the same pushdown.
// ---------------------------------------------------------------------------

/** high-level CNA only, matching the oncoprint/compare convention (±2) */
const ALTERED_COND = "(g.variant_type != 'cna' OR abs(g.cna_alteration) >= 2)";

function driverJoin(pin: string): string {
  return (
    "  LEFT JOIN oncokb_annotation.variant_annotation ann\n" +
    "    ON ann.oncokb_version = " + sq(pin) + " AND ann.is_driver\n" +
    "   AND ann.hugo_gene_symbol = g.hugo_gene_symbol\n" +
    "   AND ((g.variant_type = 'mutation' AND ann.alteration_type = 'MUTATION' AND ann.alteration = g.mutation_variant)\n" +
    "     OR (g.variant_type = 'cna' AND ann.alteration_type = 'CNA' AND ann.alteration = if(g.cna_alteration >= 2, 'AMPLIFICATION', 'DELETION'))\n" +
    "     OR (g.variant_type = 'structural_variant' AND ann.alteration_type = 'SV' AND ann.alteration = 'Fusion'))\n"
  );
}

/**
 * Per-gene (profiled, altered, driver) counts for one cohort in one study,
 * computed entirely in the database. Returns counts only — no ids.
 */
export function geneCountsSql(cohortSql: string, genes: string[], study: string, pin: string | null): string {
  const pid = "replaceOne(g.patient_unique_id, " + sq(study + "_") + ", '')";
  const covPid = "replaceOne(sd.patient_unique_id, " + sq(study + "_") + ", '')";
  const geneList = genes.map(sq).join(",");
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "altered AS (\n" +
    "  SELECT g.hugo_gene_symbol AS gene, " + pid + " AS pid,\n" +
    (pin ? "         max(ann.is_driver) AS is_driver\n" : "         0 AS is_driver\n") +
    "  FROM " + DB + ".genomic_event_derived g\n" +
    (pin ? driverJoin(pin) : "") +
    "  WHERE g.cancer_study_identifier = " + sq(study) + "\n" +
    "    AND g.hugo_gene_symbol IN (" + geneList + ") AND " + ALTERED_COND + "\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY gene, pid\n" +
    "),\n" +
    "covered AS (\n" +
    "  SELECT DISTINCT pg.gene AS gene, " + covPid + " AS pid\n" +
    "  FROM " + DB + ".sample_to_gene_panel_derived sp\n" +
    "  JOIN " + DB + ".gene_panel_to_gene_derived pg ON pg.gene_panel_id = sp.gene_panel_id AND pg.gene IN (" + geneList + ")\n" +
    "  JOIN " + DB + ".sample_derived sd ON sd.sample_unique_id = sp.sample_unique_id\n" +
    "  WHERE sp.cancer_study_identifier = " + sq(study) + " AND sp.alteration_type = 'MUTATION_EXTENDED'\n" +
    "    AND " + covPid + " IN (SELECT pid FROM cohort)\n" +
    ")\n" +
    "SELECT gene,\n" +
    "       uniqExact(pid) AS profiled,\n" +
    "       uniqExactIf(pid, is_alt) AS altered,\n" +
    "       uniqExactIf(pid, is_drv) AS driver\n" +
    "FROM (\n" +
    "  SELECT gene, pid, 1 AS is_alt, is_driver > 0 AS is_drv FROM altered\n" +
    "  UNION ALL\n" +
    "  SELECT gene, pid, 0 AS is_alt, 0 AS is_drv FROM covered\n" +
    ")\n" +
    "GROUP BY gene"
  );
}

/**
 * (months, event, n) triples for one cohort in one study. Aggregate — pools
 * exactly with other instances' triples to give a correct pooled KM curve.
 */
export function survivalCountsSql(cohortSql: string, study: string): string {
  const pid = "replaceOne(patient_unique_id, " + sq(study + "_") + ", '')";
  return (
    "WITH cohort AS (" + cohortSql + "),\n" +
    "os AS (\n" +
    "  SELECT " + pid + " AS pid,\n" +
    "         anyIf(attribute_value, attribute_name='OS_MONTHS') AS months,\n" +
    "         anyIf(attribute_value, attribute_name='OS_STATUS') AS status\n" +
    "  FROM " + DB + ".clinical_data_derived\n" +
    "  WHERE cancer_study_identifier = " + sq(study) + " AND type='patient'\n" +
    "    AND attribute_name IN ('OS_MONTHS','OS_STATUS')\n" +
    "    AND " + pid + " IN (SELECT pid FROM cohort)\n" +
    "  GROUP BY pid\n" +
    ")\n" +
    "SELECT toFloat64OrNull(months) AS m, if(status LIKE '1%', 1, 0) AS ev, count() AS n\n" +
    "FROM os WHERE toFloat64OrNull(months) IS NOT NULL\n" +
    "GROUP BY m, ev ORDER BY m"
  );
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/** What every participant can answer, whatever its trust level. */
export interface AggregateCapable {
  readonly instance: Instance;
  readonly study: string;
  /** cohort size — a count, not a roster */
  count(def: CohortDef | null | undefined): Promise<number>;
  geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]>;
  survivalCounts(def: CohortDef | null | undefined): Promise<SurvivalCount[]>;
  /** the SQL this participant would run, for provenance */
  cohortSql(def: CohortDef | null | undefined): string;
}

/** Additionally available when the instance permits patient-level access. */
export interface PatientLevelCapable extends AggregateCapable {
  readonly instance: Instance & { mode: "patient-level" };
  members(def: CohortDef | null | undefined): Promise<string[]>;
}

export type Resolver = AggregateCapable | PatientLevelCapable;

export function isPatientLevel(r: Resolver): r is PatientLevelCapable {
  return r.instance.mode === "patient-level";
}

// NOTE: no TS parameter properties / enums / namespaces anywhere in this repo —
// Node runs the scripts and MCP server through strip-only type removal, which
// rejects any TypeScript syntax that would emit code.
abstract class BaseResolver implements AggregateCapable {
  abstract readonly instance: Instance;
  readonly study: string;
  protected readonly ctx: Partial<CompileCtx>;
  constructor(study: string, ctx: Partial<CompileCtx>) {
    this.study = study;
    this.ctx = ctx;
  }

  cohortSql(def: CohortDef | null | undefined): string {
    return compileCohortDef(def, { ...this.ctx, study: this.study });
  }
  async count(def: CohortDef | null | undefined): Promise<number> {
    const r = await chQuery<ChRow>("SELECT count() AS n FROM (" + this.cohortSql(def) + ")");
    return Number(r.data[0].n);
  }
  async geneCounts(def: CohortDef | null | undefined, genes: string[]): Promise<GeneCounts[]> {
    if (!genes.length) return [];
    const r = await chQuery<ChRow>(geneCountsSql(this.cohortSql(def), genes, this.study, this.ctx.oncokbPin ?? null));
    return r.data.map((x) => ({
      gene: x.gene, profiled: Number(x.profiled), altered: Number(x.altered), driver: Number(x.driver)
    }));
  }
  async survivalCounts(def: CohortDef | null | undefined): Promise<SurvivalCount[]> {
    const r = await chQuery<ChRow>(survivalCountsSql(this.cohortSql(def), this.study));
    return r.data.map((x) => ({ months: Number(x.m), event: Number(x.ev), n: Number(x.n) }));
  }
}

/** Full access: may return member ids, so every view is answerable. */
export class PatientLevelResolver extends BaseResolver implements PatientLevelCapable {
  readonly instance: Instance & { mode: "patient-level" };
  constructor(study: string, ctx: Partial<CompileCtx>, instance: Instance) {
    super(study, ctx);
    this.instance = { ...instance, mode: "patient-level" };
  }
  async members(def: CohortDef | null | undefined): Promise<string[]> {
    const r = await chQuery<ChRow>("SELECT pid FROM (" + this.cohortSql(def) + ")");
    return r.data.map((x) => x.pid);
  }
}

/**
 * Aggregate-only participant. Note what is NOT here: there is no members(),
 * no row fetch, no id-returning method of any kind. Everything it can answer
 * is a count computed inside the database.
 */
export class AggregateResolver extends BaseResolver {
  readonly instance: Instance;
  constructor(study: string, ctx: Partial<CompileCtx>, instance: Instance) {
    super(study, ctx);
    this.instance = instance;
  }
}

export function resolverFor(study: string, ctx: Partial<CompileCtx>): Resolver {
  const inst = instanceForStudy(study);
  return inst.mode === "patient-level"
    ? new PatientLevelResolver(study, ctx, inst)
    : new AggregateResolver(study, ctx, inst);
}

/** Expand pooled (months, event, n) triples into KM input records. */
export function expandSurvivalCounts(counts: SurvivalCount[]): { t: number; event: number }[] {
  const out: { t: number; event: number }[] = [];
  for (const c of counts) for (let i = 0; i < c.n; i++) out.push({ t: c.months, event: c.event });
  return out;
}
