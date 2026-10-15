// The document's version: older documents are upgraded where they enter, newer ones refused; and
// splits are stored on the cohorts they divide, worked on in a flat form and written back.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { upgradeDocument, DOC_VERSION } from "../lib/doc-version.ts";
import { flattenSplits, unflattenSplits, editSplits, withoutPartition, renamePartitionChild } from "../lib/partition-arms.ts";
import type { Clause } from "../lib/types.ts";

const nsclc: Clause = { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] };
const g12c: Clause = { kind: "oql", q: "KRAS: G12C" };
const mut: Clause = { kind: "oql", q: "KRAS: MUT" };
const female: Clause = { kind: "clinical", attribute: "SEX", values: ["Female"] };

describe("upgradeDocument", () => {
  test("a current document is returned as it is", () => {
    const d = { dsl: DOC_VERSION, cohorts: { A: { all: [] } } };
    const r = upgradeDocument(d);
    assert.equal(r.doc, d);
    assert.equal(r.upgrade, null);
  });

  test("an unversioned document already in the current shape is stamped, not reported", () => {
    const r = upgradeDocument({ cohorts: { A: { all: [] } } });
    assert.equal((r.doc as any).dsl, DOC_VERSION);
    assert.equal(r.upgrade, null);
  });

  test("2.2 partitions move onto their cohorts; children and views are renamed", () => {
    const old = {
      dsl: "2.2",
      cohorts: { NSCLC: { all: [nsclc] } },
      partitions: {
        "KRAS allele": { of: "NSCLC", other: "wild-type", arms: [{ name: "G12C", where: g12c }, { name: "other KRAS", where: mut }] },
        "G12C by sex": { of: "KRAS allele / G12C", arms: [{ name: "F", where: female }] },
        "rest by sex": { of: "KRAS allele / wild-type", arms: [{ name: "F", where: female }] }
      },
      views: [{ kind: "survival", cohorts: ["KRAS allele"] }, { kind: "compare", cohorts: ["KRAS allele / G12C", "G12C by sex / F"] }]
    };
    const { doc, upgrade } = upgradeDocument(old) as any;
    assert.equal(doc.dsl, DOC_VERSION);
    assert.equal(doc.partitions, undefined);
    assert.equal(upgrade.from, "2.2");
    assert.match(upgrade.changes[0], /moved 3 splits/);
    const split = doc.cohorts.NSCLC.splits["KRAS allele"];
    assert.deepEqual(split.arms.map((a: any) => a.name), ["G12C", "other KRAS"]);
    assert.deepEqual(Object.keys(split.arms[0].splits), ["G12C by sex"]);
    assert.deepEqual(Object.keys(split.otherSplits), ["rest by sex"]);
    // both views drew leaves under the old "a split replaces what it splits" rule; 2.4 lists them
    assert.deepEqual(doc.views.map((v: any) => v.cohorts), [
      ["NSCLC / KRAS allele / G12C / G12C by sex / F", "NSCLC / KRAS allele / G12C / G12C by sex / Other",
       "NSCLC / KRAS allele / other KRAS",
       "NSCLC / KRAS allele / wild-type / rest by sex / F", "NSCLC / KRAS allele / wild-type / rest by sex / Other"],
      ["NSCLC / KRAS allele / G12C / G12C by sex / F", "NSCLC / KRAS allele / G12C / G12C by sex / Other"]
    ]);
    assert.match(upgrade.changes[1], /2 views that drew a split cohort's arms now list them/);
    // view 1 drew groups of three splits (the nested ones included), which 2.4 refuses — said, not
    // hidden; view 2 draws only the nested "G12C by sex" split's groups, which is fine
    assert.match(upgrade.changes[2], /^view 1 drew whole cohorts beside a split's groups, or the groups of several splits/);
    // nothing the old document said is lost: the flat form is the same splits, re-addressed
    const flat = flattenSplits(doc.cohorts);
    assert.deepEqual(Object.keys(flat).sort(), [
      "NSCLC / KRAS allele", "NSCLC / KRAS allele / G12C / G12C by sex", "NSCLC / KRAS allele / wild-type / rest by sex"
    ]);
  });

  test("2.3 → 2.4: a view that drew a split cohort's arms keeps drawing them, by name", () => {
    const d23 = { dsl: "2.3",
      cohorts: { EGFR: { all: [] }, KRAS: { all: [], splits: { allele: { arms: [{ name: "G12C", where: g12c }] } } } },
      views: [{ kind: "survival" }, { kind: "compare", cohorts: ["KRAS"] }, { kind: "clinical", cohorts: ["EGFR"] }, { kind: "cox", cohorts: ["KRAS / allele"] }] };
    const { doc, upgrade } = upgradeDocument(d23) as any;
    assert.equal(doc.dsl, DOC_VERSION);
    assert.deepEqual(doc.views.map((v: any) => v.cohorts), [
      ["EGFR", "KRAS / allele / G12C", "KRAS / allele / Other"],   // default list: KRAS was drawn as its arms
      ["KRAS / allele / G12C", "KRAS / allele / Other"],
      ["EGFR"],                                                     // unchanged: nothing split
      ["KRAS / allele"]                                             // unchanged: a split's name means the same
    ]);
    assert.equal(upgrade.changes[0], "2 views that drew a split cohort's arms now list them by name, since a cohort's name now means the whole cohort");
    // view 1 drew EGFR whole beside KRAS's arms, which a 2.4 view does not — the note names it
    assert.match(upgrade.changes[1], /^view 1 drew whole cohorts beside a split's groups/);
  });

  test("a 2.3 document without splits upgrades with nothing to report", () => {
    const { doc, upgrade } = upgradeDocument({ dsl: "2.3", cohorts: { A: { all: [] } }, views: [{ kind: "survival", cohorts: ["A"] }] }) as any;
    assert.equal(doc.dsl, DOC_VERSION);
    assert.deepEqual(upgrade.changes, []);
    assert.deepEqual(doc.views, [{ kind: "survival", cohorts: ["A"] }]);
  });

  test("2.4 → 2.5: a view with no cohorts, or an empty list, is given every authored cohort by name", () => {
    const d24 = { dsl: "2.4", cohorts: { A: { all: [] }, B: { all: [] } },
      views: [{ kind: "survival" }, { kind: "compare", cohorts: [] }, { kind: "clinical", cohorts: ["B"] },
        { kind: "survival", splitBy: { cohort: "A", attribute: "SEX" } }] };
    const { doc, upgrade } = upgradeDocument(d24) as any;
    assert.equal(doc.dsl, DOC_VERSION);
    assert.deepEqual(doc.views.map((v: any) => v.cohorts), [["A", "B"], ["A", "B"], ["B"], undefined]);
    assert.deepEqual(upgrade.changes, ["2 views that showed every cohort by default now list them by name, since a view now draws only the cohorts it names"]);
  });

  test("a 2.5 view with no cohorts stays empty", () => {
    const d = { dsl: "2.5", cohorts: { A: { all: [] } }, views: [{ kind: "survival" }] };
    const r = upgradeDocument(d) as any;
    assert.equal(r.doc.views[0].cohorts, undefined);
    assert.deepEqual(r.upgrade?.changes ?? [], []);
  });

  test("a document for a newer version is refused, naming both versions", () => {
    assert.throws(() => upgradeDocument({ dsl: "9.0", cohorts: {} }), /written for DSL 9\.0; this server reads up to/);
    assert.throws(() => upgradeDocument({ dsl: "two", cohorts: {} }), /not a version/);
  });

  test("an upgraded document is current: upgrading again changes nothing", () => {
    const once = upgradeDocument({ cohorts: { A: { all: [] } }, partitions: { P: { of: "A", arms: [{ name: "x", where: g12c }] } } }).doc;
    const twice = upgradeDocument(once);
    assert.equal(twice.doc, once);
    assert.equal(twice.upgrade, null);
  });
});

describe("splits stored on cohorts", () => {
  const cohorts = () => ({
    NSCLC: { all: [nsclc], splits: { "KRAS allele": { other: "wild-type", arms: [
      { name: "G12C", where: g12c, splits: { sex: { arms: [{ name: "F", where: female }] } } },
      { name: "other KRAS", where: mut }
    ] } } }
  });

  test("flatten and unflatten are inverses", () => {
    const c = cohorts();
    assert.deepEqual(unflattenSplits(c, flattenSplits(c)), c);
  });

  test("the flat form knows each split's owner and name", () => {
    const flat = flattenSplits(cohorts());
    assert.equal(flat["NSCLC / KRAS allele / G12C / sex"].of, "NSCLC / KRAS allele / G12C");
    assert.equal(flat["NSCLC / KRAS allele / G12C / sex"].split, "sex");
    assert.equal((flat["NSCLC / KRAS allele"].arms[0] as any).splits, undefined);
  });

  test("removing an arm takes the split nested under it", () => {
    const doc = { cohorts: cohorts(), views: [] };
    const out = editSplits(doc, (f) => ({ ...f, partitions: { ...f.partitions,
      "NSCLC / KRAS allele": { ...f.partitions["NSCLC / KRAS allele"], arms: f.partitions["NSCLC / KRAS allele"].arms.slice(1) } } }));
    assert.deepEqual(Object.keys(flattenSplits(out.cohorts)), ["NSCLC / KRAS allele"]);
  });

  test("removing a split takes everything under it; views go back to the cohort", () => {
    const doc = { cohorts: cohorts(), views: [{ kind: "survival", cohorts: ["NSCLC / KRAS allele"] }] };
    const out = editSplits(doc, (f) => withoutPartition(f, "NSCLC / KRAS allele").doc);
    assert.equal(out.cohorts.NSCLC.splits, undefined);
    assert.deepEqual((out.views[0] as any).cohorts, ["NSCLC"]);
  });

  test("renaming an arm carries the split under it, and views naming anything beneath", () => {
    const doc = { cohorts: cohorts(), views: [{ kind: "survival", cohorts: ["NSCLC / KRAS allele / G12C / sex / F"] }] };
    const out = editSplits(doc, (f) => renamePartitionChild(f, "NSCLC / KRAS allele", "G12C", "KRAS G12C"));
    assert.deepEqual(Object.keys(out.cohorts.NSCLC.splits!["KRAS allele"].arms[0].splits!), ["sex"]);
    assert.deepEqual((out.views[0] as any).cohorts, ["NSCLC / KRAS allele / KRAS G12C / sex / F"]);
  });

  test("a split of something that is neither a cohort nor an arm is refused by name", () => {
    assert.throws(() => unflattenSplits({ A: { all: [] } }, { "B / s": { of: "B", split: "s", arms: [] } }), /not a cohort or an arm/);
  });
});

describe("2.5 → 2.6", () => {
  test("an oncoprint sorting by the study track sorts by its new name", () => {
    const { doc, upgrade } = upgradeDocument({ dsl: "2.5", cohorts: {}, views: [
      { kind: "oncoprint", sort: ["-Study", "CANCER_TYPE"] }, { kind: "oncoprint", sort: [{ track: "Study", dir: "desc" }] },
      { kind: "survival", sort: ["Study"] }] }) as any;
    assert.deepEqual(doc.views[0].sort, ["-Study of origin", "CANCER_TYPE"]);
    assert.deepEqual(doc.views[1].sort, [{ track: "Study of origin", dir: "desc" }]);
    assert.deepEqual(doc.views[2].sort, ["Study"], "only oncoprints have a study track");
    assert.match(upgrade.changes.join(" "), /2 oncoprint views .*Study of origin/);
  });
});
