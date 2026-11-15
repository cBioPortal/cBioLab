"""The oncoprint's Tabular download in the Python port (T31 of the tabular case table: T1-T24 the same).

Written from the case table without the implementation in view. Legacy source, cbioportal-frontend
cd8c6df: TD = src/shared/components/oncoprint/tabularDownload.ts (getTabularDownloadData 12-252),
DU = src/shared/components/oncoprint/DataUtils.ts (fillGeneticTrackDatum 161-249). One fixture holds
a case of each kind; the port's rows are checked against the table's values, then against the
TypeScript engine's TSV for the same input (run through node), with and without a column order.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_tabular_portal.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.local import normalize_display  # noqa: E402

GENETIC = ["CNA", "MUTATIONS", "MRNA", "PROTEIN", "STRUCTURAL_VARIANT"]
COLS = ["A", "B", "C", "D", "E", "F", "G", "H"]
GENES = ["TP53", {"genes": ["KRAS", "NRAS"]}]
AGE = {f"N{i:02d}": str(i * 10 + 3) for i in range(12)}


def mut(pid, mt, driver=False, gene="TP53", germ=False):
    return {"pid": pid, "gene": gene, "vt": "mutation", "mt": mt, "driver": driver, "germ": germ}


EVENTS = [
    mut("A", "Missense_Mutation", True),
    mut("B", "Nonsense_Mutation", False), mut("B", "Missense_Mutation", False),  # T8: truncating wins
    mut("C", "Nonsense_Mutation", False), mut("C", "Missense_Mutation", True),   # T7: the driver wins
    mut("D", "Splice_Site", False), mut("E", "Promoter", True), mut("F", "Missense_Mutation", False, germ=True),
    mut("G", "Translation_Start_Site", True),
    {"pid": "A", "gene": "TP53", "vt": "cna", "cna": 2, "driver": True},
    {"pid": "B", "gene": "TP53", "vt": "cna", "cna": -2, "driver": False},
    {"pid": "C", "gene": "KRAS", "vt": "cna", "cna": 2, "driver": False},
    {"pid": "D", "gene": "NRAS", "vt": "structural_variant", "driver": True},
    {"pid": "E", "gene": "TP53", "vt": "structural_variant", "driver": False},
]
CLINICAL = [
    {"attr": "SEX", "name": "Sex", "values": {"A": "Female", "B": "Male"}},
    {"attr": "OS_STATUS", "values": {"A": "1:DECEASED"}},
    {"attr": "AGE", "name": "Diagnosis Age", "values": {**AGE, "A": "61.7", "B": "0.1"}},
    {"attr": "MUTATION_SPECTRUM", "name": "Mutation spectrum", "values": {"A": "1,2,3,4,5,6"}},
]
HEATMAP = [
    {"profileType": "mrna_zscore", "profileKind": "MRNA_EXPRESSION Z-SCORE", "genes": ["TP53"], "isVaf": False,
     "values": {"A|TP53": 1.5, "B|TP53": -0.25}},
    {"profileType": "methylation_hm450", "profileKind": "METHYLATION CONTINUOUS", "genes": ["TP53"], "isVaf": False,
     "values": {"A|TP53": 0.75}},
    {"profileType": "mutational_signature", "profileKind": "GENERIC_ASSAY LIMIT-VALUE", "assay": True, "genes": ["SBS1"],
     "isVaf": False, "values": {"C|SBS1": 0.5}},
    {"profileType": "mrna_zscore_all", "profileKind": "MRNA_EXPRESSION Z-SCORE", "genes": ["KRAS"], "isVaf": False,
     "values": {"D|KRAS": -1.0}},
    {"profileType": "VAF", "genes": ["TP53"], "isVaf": True, "values": {"A|TP53": 0.5}},
]
DERIVED = [{"label": "Treated", "pids": ["B"]}]


def fixture(annotate=True):
    """the input as JSON-able data, shared with the TypeScript run"""
    cols = COLS + sorted(AGE)
    return {"cols": cols, "unprofiled": ["H"], "genes": GENES, "events": EVENTS, "clinical": CLINICAL, "heatmap": HEATMAP,
            "derived": DERIVED, "annotate": annotate}


def py_contract(fx):
    members = [m for g in fx["genes"] for m in ([g] if isinstance(g, str) else g["genes"])]
    annotate = fx["annotate"]
    return assemble_contract(
        genes=fx["genes"], groups=[{"name": "all", "pids": fx["cols"]}], studies=["s"], events=[dict(e) for e in fx["events"]],
        coverage=[{"pid": p, "genes": members} for p in fx["cols"] if p not in fx["unprofiled"]],
        is_driver=lambda r: annotate and bool(r.get("driver")), annotation_source="t",
        clinical=[{**c, "values": dict(c["values"])} for c in fx["clinical"]], heatmap=[dict(h) for h in fx["heatmap"]],
        derived=[{"label": d["label"], "pids": set(d["pids"])} for d in fx["derived"]],
        sort=[{"track": "id", "dir": "asc"}], line_gap=0, display=normalize_display({} if annotate else {"annotate": "none"}))


TS = r"""
import { readFileSync } from "node:fs";
import { assembleContract, normalizeDisplay } from "./lib/oncoprint-assemble.ts";
import { contractToTsv } from "./lib/oncoprint-tabular.ts";
const fx = JSON.parse(readFileSync(process.argv[1], "utf8"));
const members = fx.genes.flatMap((g) => (typeof g === "string" ? [g] : g.genes));
const c = assembleContract({ genes: fx.genes, groups: [{ name: "all", pids: fx.cols }], studies: ["s"], events: fx.events,
  coverage: fx.cols.filter((p) => !fx.unprofiled.includes(p)).map((pid) => ({ pid, genes: members })),
  isDriver: (r) => fx.annotate && !!r.driver, annotationSource: "t",
  clinical: fx.clinical.map((x) => ({ ...x, values: new Map(Object.entries(x.values)) })),
  heatmap: fx.heatmap.map((h) => ({ ...h, values: new Map(Object.entries(h.values)) })),
  derived: fx.derived.map((d) => ({ label: d.label, pids: new Set(d.pids) })),
  sort: [{ track: "id", dir: "asc" }], lineGap: 0, display: normalizeDisplay(fx.annotate ? {} : { annotate: "none" }) });
const order = fx.order ? fx.order.map((p) => c.columns.indexOf(p)) : undefined;
process.stdout.write(JSON.stringify({ columns: c.columns, tsv: contractToTsv(c, order) }));
"""


def ts_run(fx):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fx.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fx, f)
        out = subprocess.run(["node", "--input-type=module", "-e", TS, path], cwd=ROOT, capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise AssertionError("node failed: " + out.stderr[-2000:])
    return json.loads(out.stdout)


def table(tsv):
    assert tsv.endswith("\n"), "the file ends in \\n"
    return [line.split("\t") for line in tsv[:-1].split("\n")]


class TabularPortal(unittest.TestCase):
    def setUp(self):
        self.c = py_contract(fixture())
        self.rows = [list(r) for r in self.c.rows()]
        self.header = self.rows[0]

    def row(self, typ, name):
        hits = [r for r in self.rows[1:] if r[0] == name and r[1] == typ]
        self.assertEqual(len(hits), 1, f"one row {name!r} of {typ!r}; rows: {[(r[0], r[1]) for r in self.rows[1:]]}")
        self.assertEqual(len(hits[0]), len(self.header))
        return dict(zip(self.header[2:], hits[0][2:]))

    def test_t01_header(self):
        self.assertEqual(self.header, ["track_name", "track_type", *self.c.columns])

    def test_t02_groups_in_order(self):
        clinical = ["Sex", "OS_STATUS", "Diagnosis Age"] + [f"Mutation spectrum ({k})" for k in ("C>A", "C>G", "C>T", "T>A", "T>C", "T>G")]
        want = [[n, "CLINICAL"] for n in clinical] + [[g, t] for t in GENETIC for g in ("TP53", "KRAS / NRAS")] + [
            ["TP53", "HEATMAP MRNA_EXPRESSION Z-SCORE"], ["KRAS", "HEATMAP MRNA_EXPRESSION Z-SCORE"],
            ["TP53", "HEATMAP METHYLATION CONTINUOUS"], ["SBS1", "HEATMAP GENERIC_ASSAY LIMIT-VALUE"]]
        got = [r[:2] for r in self.rows[1:]]
        vaf = [r for r in got if r[1] == "HEATMAP MUTATION_EXTENDED VAF"]
        self.assertEqual(len(vaf), 1, "T23: one VAF row")
        self.assertEqual([r for r in got if r[1] != "HEATMAP MUTATION_EXTENDED VAF"], want + [["Treated", "DERIVED"]])
        self.assertEqual(got[-1], ["Treated", "DERIVED"], "T24: DERIVED last")
        self.assertLess(got.index(vaf[0]), got.index(["Treated", "DERIVED"]))

    def test_t03_t14_empty_and_not_profiled(self):
        for t in GENETIC:
            self.assertEqual(self.row(t, "TP53")["H"], "", t + ": not profiled is empty")
        for t in ("MRNA", "PROTEIN"):
            self.assertEqual(set(self.row(t, "TP53").values()), {""}, t)

    def test_t05_t13_mutation_text(self):
        r = self.row("MUTATIONS", "TP53")
        self.assertEqual((r["A"], r["B"], r["C"], r["D"], r["E"], r["F"], r["G"]), (
            "Missense Mutation (putative driver)", "Truncating mutation (putative passenger)", "Missense Mutation (putative driver)",
            "Splice Mutation (putative passenger)", "Promoter Mutation", "Missense Mutation (putative passenger)",
            "Other Mutation (putative driver)"))

    def test_t06_annotation_off(self):
        rows = [list(r) for r in py_contract(fixture(annotate=False)).rows()]
        r = dict(zip(rows[0][2:], next(x for x in rows if x[:2] == ["TP53", "MUTATIONS"])[2:]))
        self.assertEqual((r["A"], r["B"], r["D"], r["E"], r["G"]),
                         ("Missense Mutation", "Truncating mutation", "Splice Mutation", "Promoter Mutation", "Other Mutation"))
        cna = dict(zip(rows[0][2:], next(x for x in rows if x[:2] == ["TP53", "CNA"])[2:]))
        self.assertEqual(cna["A"], "Amplification")

    def test_t10_t12_cna_and_sv(self):
        self.assertEqual((self.row("CNA", "TP53")["A"], self.row("CNA", "TP53")["B"]), ("Amplification (putative driver)", "Deep Deletion"))
        self.assertEqual(self.row("CNA", "KRAS / NRAS")["C"], "Amplification")
        self.assertEqual(self.row("STRUCTURAL_VARIANT", "KRAS / NRAS")["D"], "Structural Variant (putative driver)")
        self.assertEqual(self.row("STRUCTURAL_VARIANT", "TP53")["E"], "Structural Variant")

    def test_t16_t19_clinical(self):
        self.assertEqual((self.row("CLINICAL", "Sex")["A"], self.row("CLINICAL", "Sex")["C"]), ("Female", ""))
        self.assertEqual(self.row("CLINICAL", "OS_STATUS")["A"], "1:DECEASED")
        age = self.row("CLINICAL", "Diagnosis Age")
        self.assertEqual((age["A"], age["B"], age["N04"], age["C"]), ("61.7", "0.1", "43", ""))
        self.assertEqual([self.row("CLINICAL", f"Mutation spectrum ({k})")["A"] for k in ("C>A", "C>G", "C>T", "T>A", "T>C", "T>G")],
                         ["1", "2", "3", "4", "5", "6"])
        self.assertEqual(self.row("CLINICAL", "Mutation spectrum (C>A)")["B"], "")

    def test_t20_t24_heatmap_and_derived(self):
        mrna = self.row("HEATMAP MRNA_EXPRESSION Z-SCORE", "TP53")
        self.assertEqual((mrna["A"], mrna["B"], mrna["C"]), ("1.5", "-0.25", ""))
        self.assertEqual(self.row("HEATMAP MRNA_EXPRESSION Z-SCORE", "KRAS")["D"], "-1")
        self.assertEqual(self.row("HEATMAP METHYLATION CONTINUOUS", "TP53")["A"], "0.75")
        self.assertEqual(self.row("HEATMAP GENERIC_ASSAY LIMIT-VALUE", "SBS1")["C"], "0.5")
        vaf = next(r for r in self.rows if r[1] == "HEATMAP MUTATION_EXTENDED VAF")
        self.assertEqual(dict(zip(self.header[2:], vaf[2:]))["A"], "0.5")
        d = self.row("DERIVED", "Treated")
        self.assertEqual((d["A"], d["B"]), ("no", "yes"))

    def test_t25_t26_order(self):
        cols = list(self.c.columns)
        order = [cols.index(p) for p in ("E", "A", "D")]
        rows = [list(r) for r in self.c.rows(order=order)]
        self.assertEqual(rows[0], ["track_name", "track_type", "E", "A", "D"])
        for r in rows:
            self.assertEqual(len(r), 5)
        self.assertEqual(next(r for r in rows if r[:2] == ["TP53", "MUTATIONS"])[2:],
                         ["Promoter Mutation", "Missense Mutation (putative driver)", "Splice Mutation (putative passenger)"])
        tsv = self.c.to_tsv(order=order)
        self.assertEqual(table(tsv), rows)

    def test_t30_to_tsv_lines(self):
        tsv = self.c.to_tsv()
        self.assertTrue(tsv.endswith("\n") and not tsv.endswith("\n\n"))
        self.assertEqual(table(tsv), self.rows)

    def test_t31_same_as_typescript(self):
        self.assertTrue(shutil.which("node"), "node is required for the conformance check")
        for annotate in (True, False):
            for order in (None, ["E", "A", "D", "H"]):
                with self.subTest(annotate=annotate, order=order):
                    fx = {**fixture(annotate), **({"order": order} if order else {})}
                    ts = ts_run(fx)
                    c = py_contract(fx)
                    self.assertEqual(list(c.columns), ts["columns"])
                    idx = [list(c.columns).index(p) for p in order] if order else None
                    self.assertEqual(c.to_tsv(order=idx), ts["tsv"])


if __name__ == "__main__":
    unittest.main()


class ExpressionText(unittest.TestCase):
    """X17 of the EXP / PROT case table: the MRNA and PROTEIN rows' texts (TD 70-77), as the TypeScript's geneticText."""

    def test_mrna_and_protein_text(self):
        from cohortlab.contract import genetic_text
        from cohortlab.style import BITS
        self.assertEqual(genetic_text(BITS["MRNA_HIGH"], "MRNA", True), "mRNA High")
        self.assertEqual(genetic_text(BITS["MRNA_LOW"], "MRNA", False), "mRNA Low")
        self.assertEqual(genetic_text(BITS["PROT_HIGH"], "PROTEIN", True), "Protein High")
        self.assertEqual(genetic_text(BITS["PROT_LOW"], "PROTEIN", False), "Protein Low")
        self.assertEqual(genetic_text(BITS["AMP"], "MRNA", True), "", "a cell without the bit has no text")
