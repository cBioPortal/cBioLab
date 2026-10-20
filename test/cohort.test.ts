// Cohort-definition semantics that are easy to regress and expensive to get wrong.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compileCohortDef, describeCohortDef, SPLIT_SALT } from "../lib/cohort2.ts";

const ctx = { study: "s1", db: "db" };

describe("a cohort with no clauses is every patient in the study", () => {
  test("{all: []} compiles to exactly what an absent definition compiles to", () => {
    assert.equal(compileCohortDef({ all: [] }, ctx), compileCohortDef(null, ctx),
      "the two spellings of 'no filter' must not diverge");
  });
  test("...and reads back as such, so it cannot pass for a filter that did nothing", () => {
    assert.equal(describeCohortDef({ all: [] }), "all patients in the study");
    assert.equal(describeCohortDef(null), "all patients in the study");
  });
  test("the study base really is unfiltered SQL over that study", () => {
    const sql = compileCohortDef({ all: [] }, ctx);
    assert.match(sql, /FROM db\.sample_derived/);
    assert.match(sql, /cancer_study_identifier = 's1'/);
  });
  test("a filtered cohort still differs from the base", () => {
    assert.notEqual(compileCohortDef({ all: [{ kind: "oql", q: "TP53: MUT" }] }, ctx),
      compileCohortDef({ all: [] }, ctx));
  });
});

describe("clause-count bounds are still enforced", () => {
  test("more than 8 clauses is refused", () => {
    const nine = Array.from({ length: 9 }, () => ({ kind: "oql" as const, q: "TP53: MUT" }));
    assert.throws(() => compileCohortDef({ all: nine }, ctx), /0-8 clauses/);
  });
  test("a non-array clause list is refused", () => {
    assert.throws(() => compileCohortDef({ all: "nope" } as never, ctx), /0-8 clauses/);
  });
});

describe("profiled: a gene list is its genes' clauses AND-ed, in one clause", () => {
  // one gene's clause SQL, without the parentheses a compiled cohort puts around each clause
  const one = (gene: string) => compileCohortDef({ all: [{ kind: "profiled", type: "MUTATION", gene }] }, ctx).slice(1, -1);
  test("genes:[A,B] compiles to exactly A's clause INTERSECT B's", () => {
    const list = compileCohortDef({ all: [{ kind: "profiled", type: "MUTATION", genes: ["kras", "NRAS", "KRAS"] }] }, ctx);
    assert.equal(list, "((" + one("KRAS") + ")\n  INTERSECT DISTINCT\n(" + one("NRAS") + "))", "upper-cased and deduplicated, each gene its own panel check");
  });
  test("it reads back naming every gene", () => {
    assert.match(describeCohortDef({ all: [{ kind: "profiled", type: "CNA", genes: ["KRAS", "NRAS"] }] }), /profiled for KRAS, NRAS CNA/);
  });
  test("refused: both gene and genes, an empty list, more than 32 genes, a bad symbol", () => {
    assert.throws(() => compileCohortDef({ all: [{ kind: "profiled", type: "MUTATION", gene: "KRAS", genes: ["NRAS"] }] }, ctx), /`gene` or `genes`, not both/);
    assert.throws(() => compileCohortDef({ all: [{ kind: "profiled", type: "MUTATION", genes: [] }] }, ctx), /at least one gene/);
    const many = Array.from({ length: 33 }, (_, i) => "G" + i);
    assert.throws(() => compileCohortDef({ all: [{ kind: "profiled", type: "MUTATION", genes: many }] }, ctx), /at most 32 genes; this names 33/);
    assert.throws(() => compileCohortDef({ all: [{ kind: "profiled", type: "MUTATION", genes: ["KRAS", "bad gene!"] }] }, ctx), /invalid gene symbol/);
  });
});

describe("not: over an any: group (De Morgan's in one clause)", () => {
  const group = { any: [{ kind: "oql" as const, q: "MLH1: MUT" }, { kind: "oql" as const, q: "MSH2: MUT" }] };

  test("compiles as the study base EXCEPT the union of the group's leaves", () => {
    const sql = compileCohortDef({ all: [{ not: group }] }, ctx);
    assert.match(sql, /EXCEPT DISTINCT/);
    assert.match(sql, /MLH1/);
    assert.match(sql, /MSH2/);
    assert.match(sql, /UNION DISTINCT/); // the group itself still unions its own leaves
  });
  test("is exactly the same population as negating each leaf and ANDing them (De Morgan's)", () => {
    const oneClause = compileCohortDef({ all: [{ not: group }] }, ctx);
    const twoClauses = compileCohortDef({
      all: [{ not: { kind: "oql", q: "MLH1: MUT" } }, { not: { kind: "oql", q: "MSH2: MUT" } }]
    }, ctx);
    // not the same SQL text (a real difference: one EXCEPT vs two), but describeCohortDef's
    // readback is how an analyst actually checks this, and it should read as equivalent logic
    assert.equal(describeCohortDef({ all: [{ not: group }] }), "NOT (OQL[MLH1: MUT] OR OQL[MSH2: MUT])");
    assert.equal(describeCohortDef({
      all: [{ not: { kind: "oql", q: "MLH1: MUT" } }, { not: { kind: "oql", q: "MSH2: MUT" } }]
    }), "NOT OQL[MLH1: MUT] AND NOT OQL[MSH2: MUT]");
    assert.ok(oneClause && twoClauses); // both compile without throwing
  });
  test("a bare leaf under not still describes as before (no regression)", () => {
    assert.equal(describeCohortDef({ all: [{ not: { kind: "oql", q: "TP53: MUT" } }] }), "NOT OQL[TP53: MUT]");
  });
});

describe("OQL entry limit", () => {
  test("up to 30 gene entries are accepted (was 10)", () => {
    const genes = Array.from({ length: 30 }, (_, i) => "GENE" + i);
    assert.doesNotThrow(() => compileCohortDef({ all: [{ kind: "oql", q: genes.join(";") }] }, ctx));
  });
  test("more than 30 is still refused, loudly", () => {
    const genes = Array.from({ length: 31 }, (_, i) => "GENE" + i);
    assert.throws(() => compileCohortDef({ all: [{ kind: "oql", q: genes.join(";") }] }, ctx), /1-30 gene entries/);
  });
});

describe("derived buckets OR into one scan", () => {
  const ctx = { study: "x", db: "db" };
  const leaf = (range: Record<string, number>) => ({ kind: "derived" as const, metric: "followupMonths" as const, range });

  test("buckets of one metric compile to a single pass with OR'd ranges", () => {
    // The generic `any` path unions the leaves, and each derived leaf recomputes
    // the metric over the whole study — four buckets meant four scans, and
    // Explore went 4.7s -> 13.3s as buckets were ticked.
    const sql = compileCohortDef({ all: [{ any: [leaf({ lt: 6 }), leaf({ gte: 6, lt: 12 }), leaf({ gte: 12 })] }] }, ctx);
    assert.equal((sql.match(/clinical_event/g) || []).length, 1, "the metric must be computed once, not per bucket");
    assert.equal(/UNION DISTINCT/.test(sql), false);
    assert.match(sql, /\(v < 6\) OR \(v >= 6 AND v < 12\) OR \(v >= 12\)/);
  });

  test("a single bucket still compiles as before", () => {
    const sql = compileCohortDef({ all: [leaf({ gte: 24 })] }, ctx);
    assert.match(sql, /v >= 24/);
    assert.equal(/ OR /.test(sql), false);
  });

  test("different metrics in one group keep the union — they cannot share a scan", () => {
    const sql = compileCohortDef({ all: [{ any: [
      leaf({ gte: 24 }), { kind: "derived" as const, metric: "alteredGenes" as const, range: { gte: 6 } }] }] } as any, ctx);
    assert.match(sql, /UNION DISTINCT/);
  });

  test("a mixed group is untouched by the shortcut", () => {
    const sql = compileCohortDef({ all: [{ any: [
      leaf({ gte: 24 }), { kind: "clinical" as const, attribute: "SEX", op: "=" as const, value: "Female" }] }] } as any, ctx);
    assert.match(sql, /UNION DISTINCT/);
  });

  test("validation still applies inside a group", () => {
    assert.throws(() => compileCohortDef({ all: [{ any: [leaf({ gte: 1 }), { kind: "derived", metric: "bogus", range: { gte: 1 } }] }] } as any, ctx),
      /metric must be one of/);
    assert.throws(() => compileCohortDef({ all: [{ any: [leaf({ gte: 1 }), { kind: "derived", metric: "followupMonths" }] }] } as any, ctx),
      /needs a range/);
  });
});

describe("proteinPosition: an N-/C-terminal split without a clinical attribute for it", () => {
  test("compiles against mutation_derived's proteinPosStart, keyed by bare patientId", () => {
    const sql = compileCohortDef({ all: [{ kind: "proteinPosition", gene: "APC", range: { lt: 1400 } }] }, ctx);
    assert.match(sql, /FROM db\.mutation_derived/);
    assert.match(sql, /`GENE\.hugoGeneSymbol` = 'APC'/);
    assert.match(sql, /proteinPosStart < 1400/);
    assert.match(sql, /SELECT DISTINCT patientId AS pid/); // bare — no PID()/study-prefix stripping, unlike patient_unique_id tables
  });
  test("range can combine both ends", () => {
    const sql = compileCohortDef({ all: [{ kind: "proteinPosition", gene: "APC", range: { gte: 1400, lt: 1600 } }] }, ctx);
    assert.match(sql, /proteinPosStart >= 1400/);
    assert.match(sql, /proteinPosStart < 1600/);
  });
  test("a bad gene symbol is refused", () => {
    assert.throws(() => compileCohortDef({ all: [{ kind: "proteinPosition", gene: "not a gene!", range: { lt: 1400 } }] }, ctx),
      /bad gene/);
  });
  test("an empty range is refused rather than matching everyone", () => {
    assert.throws(() => compileCohortDef({ all: [{ kind: "proteinPosition", gene: "APC", range: {} }] }, ctx),
      /needs range/);
  });
  test("composes with an oql leaf to also require a mutation type (AND, not a new taxonomy)", () => {
    const sql = compileCohortDef({ all: [
      { kind: "oql", q: "APC: TRUNC" },
      { kind: "proteinPosition", gene: "APC", range: { lt: 1400 } }
    ] }, ctx);
    assert.match(sql, /INTERSECT DISTINCT/); // how `all` ANDs its clauses together
  });
  test("reads back in plain language", () => {
    assert.equal(describeCohortDef({ all: [{ kind: "proteinPosition", gene: "APC", range: { lt: 1400 } }] }),
      'APC protein position {"lt":1400}');
  });
});

describe("split: a fixed, engine-owned held-out partition", () => {
  test("the salt is pinned — changing it reshuffles every reported discovery/validation result", () => {
    assert.equal(SPLIT_SALT, "cohort-lab-split-v1");
  });
  test("the two halves differ only in their bucket", () => {
    const d = compileCohortDef({ all: [{ kind: "split", part: "discovery" }] }, ctx);
    const v = compileCohortDef({ all: [{ kind: "split", part: "validation" }] }, ctx);
    assert.match(d, /% 2 = 0\)$/);
    assert.match(v, /% 2 = 1\)$/);
    assert.equal(d.replace(/% 2 = 0\)$/, ""), v.replace(/% 2 = 1\)$/, ""));
  });
  test("the hash is salted per study, inside the database", () => {
    const sql = compileCohortDef({ all: [{ kind: "split", part: "discovery" }] }, ctx);
    assert.match(sql, /cityHash64\(concat\('cohort-lab-split-v1:s1:', /);
  });
  test("anything but the two named parts is refused, never passed into SQL", () => {
    for (const part of ["test", "0", "discovery' OR 1=1 --", ""])
      assert.throws(() => compileCohortDef({ all: [{ kind: "split", part } as any] }, ctx), /part must be/);
  });
  test("reads back as the held-out half it is", () => {
    assert.match(describeCohortDef({ all: [{ kind: "split", part: "validation" }] }), /validation half/);
  });
});

// Study ids nest: brca_tcga_pub and brca_tcga_pan_can_atlas_2018 both start with "brca_tcga_", and
// TCGA patient ids are shared across them. A leaf of one study must not read another's rows.
describe("leaves read only their own study, not siblings named after it", () => {
  const ctx = { study: "brca_tcga", db: "db", gaProfiles: ["phosphoprotein_quantification"] };
  test("genericAssay: the study's own profile by its exact id, no prefix match", () => {
    const sql = compileCohortDef({ all: [{ kind: "genericAssay", profileType: "phosphoprotein_quantification", entity: "AKT1", range: { gt: 1 } } as any] }, ctx);
    assert.match(sql, /profile_stable_id = 'brca_tcga_phosphoprotein_quantification'/);
    assert.doesNotMatch(sql, /LIKE 'brca_tcga_%'/);
  });
  test("caseList: constrained to the study, shorthand or full id", () => {
    for (const id of ["all", "brca_tcga_all", "brca_tcga_pub_all"]) {
      const sql = compileCohortDef({ all: [{ kind: "caseList", id } as any] }, ctx);
      assert.match(sql, /cs\.cancer_study_identifier = 'brca_tcga'/, id);
    }
    assert.match(compileCohortDef({ all: [{ kind: "caseList", id: "brca_tcgaall" } as any] }, ctx), /sl\.stable_id = 'brca_tcga_brca_tcgaall'/);
  });
});
