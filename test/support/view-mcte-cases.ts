// The view statements that may hold materialized WITH subqueries, as a case table shared by
// test/view-materialized-cte.test.ts (the text) and test/view-materialized-fixture.test.ts (the rows).
// Each case builds its statement plain (`materialized` left out), with `false` and with `true`, and
// names the CTE definitions the materialized form turns into `name AS MATERIALIZED (`.
import { acquiredCountsSql, acquiredFunnelSql, type AcquiredSides } from "../../lib/views/acquired/sql.ts";
import { cancerTypesSql, type CancertypesOql } from "../../lib/views/cancertypes/sql.ts";
import { txEndpointCountsSql, type TxEndpointOpts } from "../../lib/federation-views.ts";
import { instabilityScoresSql, type InstabilityOpts } from "../../lib/views/instability/sql.ts";
import { MUTATION_DEFAULT_COLUMNS, mutationRowSource } from "../../lib/mutation-table.ts";
import { countsSql, pageSql, valuesSql, type RowSource } from "../../lib/table-query.ts";

export const SETTING = "\nSETTINGS enable_materialized_cte = 1";

/** where the statements run: a study, its database, the cohort's subquery and the values its data holds */
export interface CaseCtx {
  study: string; db: string; cohortSql: string;
  /** genes the study has alterations in */
  genes: string[];
  /** an annotation pin for the driver cases */
  pin: string;
  /** a treatment-anchor subtype the timeline has, and the event type naming its samples */
  subtype: string; sampleEvent: string;
  /** the study's profiles, for the OQL cases */
  profiles: string[];
}

export interface MaterializedCase {
  name: string;
  /** the CTEs `true` materializes */
  names: string[];
  /** the statement with `materialized` left out, false or true */
  build: (m?: boolean) => string;
  /** on the fixture, the plain statement returns rows (when its data populates it) */
  populated?: boolean;
  /** on the fixture, a column some returned row holds a positive count in */
  positive?: string;
}

export function materializedCases(x: CaseCtx): MaterializedCase[] {
  const { study, db, cohortSql: c } = x;
  const sides = (o: Partial<AcquiredSides> = {}): AcquiredSides => ({
    anchor: { eventType: "Treatment", key: "SUBTYPE", value: x.subtype }, sampleEvents: [x.sampleEvent], sampleKey: "SAMPLE_ID",
    preWindowDays: null, minGapDays: 30, ...o,
  });
  const ACQ_COUNTS = ["cohort", "anch", "pick", "ps", "alt"], ACQ_FUNNEL = ["cohort", "anch", "tl"];
  const CT = ["samp", "sg", "u"], TX = ["cohort", "anch"];
  /** `f(...a)`, or `f(...a, m)` when `m` is given */
  const call = (f: (...a: any[]) => string, ...a: unknown[]) => (m?: boolean) => m === undefined ? f(...a) : f(...a, m);
  const oql = (lines: string[]): CancertypesOql => ({ lines, profiles: x.profiles });
  const tx = (o: TxEndpointOpts) => call(txEndpointCountsSql, c, study, db, o);
  const inst = (o: InstabilityOpts) => call(instabilityScoresSql, c, study, db, o);
  const cases: MaterializedCase[] = [
    { name: "acquiredCountsSql: genes, any", names: ACQ_COUNTS, populated: true,
      build: call(acquiredCountsSql, c, study, db, x.genes, sides(), null, "any") },
    { name: "acquiredCountsSql: scan, any, pre-window", names: ACQ_COUNTS, populated: true,
      build: call(acquiredCountsSql, c, study, db, null, sides({ preWindowDays: 365 }), null, "any") },
    { name: "acquiredCountsSql: genes, driver", names: ACQ_COUNTS, populated: true,
      build: call(acquiredCountsSql, c, study, db, x.genes, sides({ anchor: { eventType: "Treatment" } }), x.pin, "driver") },
    { name: "acquiredCountsSql: scan, driver", names: ACQ_COUNTS,
      build: call(acquiredCountsSql, c, study, db, null, sides(), x.pin, "driver") },
    { name: "acquiredFunnelSql: anchor with key", names: ACQ_FUNNEL, populated: true, positive: "paired",
      build: call(acquiredFunnelSql, c, study, db, sides()) },
    { name: "acquiredFunnelSql: any treatment, pre-window", names: ACQ_FUNNEL, populated: true, positive: "paired",
      build: call(acquiredFunnelSql, c, study, db, sides({ anchor: { eventType: "Treatment" }, preWindowDays: 60, minGapDays: 0 })) },
  ];
  for (const unit of ["sample", "patient"]) {
    cases.push(
      { name: "cancerTypesSql: " + unit + ", CANCER_TYPE, any", names: CT, populated: true,
        build: call(cancerTypesSql, c, study, db, x.genes, "CANCER_TYPE", null, "any", unit, undefined) },
      { name: "cancerTypesSql: " + unit + ", by study, driver", names: CT, populated: true,
        build: call(cancerTypesSql, c, study, db, x.genes, null, x.pin, "driver", unit, undefined) },
      { name: "cancerTypesSql: " + unit + ", SEX, OQL", names: CT, populated: true,
        build: call(cancerTypesSql, c, study, db, x.genes.slice(0, 2), "SEX", null, "any", unit,
          oql([x.genes[0] + ": MUT", x.genes[1] + ": AMP HOMDEL"])) },
      { name: "cancerTypesSql: " + unit + ", CANCER_TYPE_DETAILED, OQL", names: CT, populated: true,
        build: call(cancerTypesSql, c, study, db, x.genes.slice(0, 1), "CANCER_TYPE_DETAILED", null, "any", unit,
          oql([x.genes[0]])) },
    );
  }
  const lines = { gap: 90 };
  cases.push(
    { name: "txEndpointCountsSql: os", names: TX, populated: true,
      build: tx({ endpoint: "os", anchor: { eventType: "Treatment", key: "SUBTYPE", value: x.subtype }, lines }) },
    { name: "txEndpointCountsSql: ttnt", names: TX, populated: true,
      build: tx({ endpoint: "ttnt", anchor: { eventType: "Treatment" }, lines: { gap: 90, classes: "all" } }) },
    { name: "txEndpointCountsSql: ttnt, last occurrence", names: TX, populated: true,
      build: tx({ endpoint: "ttnt", anchor: { eventType: "Treatment", occurrence: "LAST" }, lines: { gap: 60, classes: "all" } }) },
    { name: "txEndpointCountsSql: tot", names: TX, populated: true,
      build: tx({ endpoint: "tot", anchor: { eventType: "Treatment", key: "SUBTYPE", value: x.subtype }, lines: { gap: 60, classes: "all" }, ongoingDays: 30 }) },
    { name: "txEndpointCountsSql: rwpfs", names: TX, populated: true,
      build: tx({ endpoint: "rwpfs", anchor: { eventType: "Treatment" }, lines,
        progression: { eventType: "Diagnosis", key: "PROGRESSION", values: ["Y", "Yes"] } }) },
    { name: "txEndpointCountsSql: rwpfs, probability floor", names: TX, populated: true,
      build: tx({ endpoint: "rwpfs", anchor: { eventType: "Treatment" }, lines,
        progression: { eventType: "Diagnosis", key: "PROGRESSION", values: ["Y"], probabilityKey: "NLP_PROGRESSION_PROBABILITY", minProbability: 0.8 } }) },
    { name: "instabilityScoresSql: autosomes", names: ["arms"], build: inst({ threshold: 0.2, armShare: 0.5, includeX: false }) },
    { name: "instabilityScoresSql: with X", names: ["arms"], build: inst({ threshold: 0.3, armShare: 0.8, includeX: true }) },
  );
  // the mutations table's row statements (lib/table-query.ts over mutationRowSource): its mutation and fusion rows
  const NO_PINS = { hg19: null, hg38: null };
  const rowSource = (gene: string, m?: boolean): RowSource => {
    const parts = [{ cohort: "c", study, cohortSql: c }];
    return m === undefined ? mutationRowSource(parts, db, gene, null, NO_PINS) : mutationRowSource(parts, db, gene, null, NO_PINS, undefined, undefined, [], m);
  };
  const MUT = ["m0", "v0"], D = MUTATION_DEFAULT_COLUMNS;
  for (const gene of x.genes) {
    cases.push(
      { name: "mutationRowSource countsSql: " + gene, names: MUT, populated: true, positive: "all",
        build: (m) => String(countsSql(rowSource(gene, m), {}, D)) },
      { name: "mutationRowSource pageSql: " + gene, names: MUT, populated: true,
        build: (m) => String(pageSql(rowSource(gene, m), { sort: { column: "copyNumber", desc: true } }, D, 1000, 0)) },
      { name: "mutationRowSource valuesSql cancerType: " + gene, names: MUT, populated: true,
        build: (m) => String(valuesSql(rowSource(gene, m), {}, D, "cancerType")) },
      { name: "mutationRowSource valuesSql vaf: " + gene, names: MUT, populated: true,
        build: (m) => String(valuesSql(rowSource(gene, m), {}, D, "vaf")) },
    );
  }
  return cases;
}
