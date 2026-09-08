"""Unit tests plus the conformance check against the TypeScript assembler.

Run from the repo root:  python/.venv/bin/python -m unittest discover -s python/tests -v
The conformance test shells out to node (scripts/oncoprint-cli.ts) and requires it on PATH.
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

import numpy as np  # noqa: E402

from cohortlab import BITS, NOT_PROFILED, Oncoprint, read_opb1, write_opb1  # noqa: E402

FIX = os.path.join(ROOT, "test", "fixtures", "oncoprint")


class LocalTables(unittest.TestCase):
    def setUp(self):
        self.op = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"), os.path.join(FIX, "coverage.tsv"),
                                        group_by="CANCER_TYPE", sort="STAGE")

    def test_cells_and_coverage(self):
        c = self.op.contract
        col = c.columns.index
        tp53, kras, egfr = c.track("TP53"), c.track("KRAS"), c.track("EGFR")
        self.assertEqual(int(tp53.cells[col("P01")]), BITS["MISSENSE"] | BITS["DRIVER"])
        self.assertEqual(int(tp53.cells[col("P02")]), BITS["TRUNCATING"] | BITS["DRIVER"])
        self.assertEqual(int(kras.cells[col("P03")]), BITS["AMP"] | BITS["DRIVER"])
        self.assertEqual(int(kras.cells[col("P08")]), 0, "GAIN is below the high-level threshold")
        self.assertEqual(int(egfr.cells[col("P05")]), NOT_PROFILED, "P05's panel does not cover EGFR")
        self.assertEqual(int(egfr.cells[col("P04")]), BITS["MISSENSE"] | BITS["SV"] | BITS["DRIVER"])
        self.assertEqual(int(kras.cells[col("P12")]), NOT_PROFILED, "P12 has no coverage row and no event")

    def test_groups_and_frequencies(self):
        c = self.op.contract
        self.assertEqual([g["name"] for g in c.groups], ["Lung", "Colon", "Breast"])
        self.assertEqual(c.track("TP53").meta["freqPct"], 45.5)
        self.assertEqual(c.track("TP53").meta["profiled"], 11)
        freq = {r["gene"]: r for r in self.op.frequencies()}
        self.assertEqual(freq["KRAS"]["Colon"], 66.7, "P03 amp + P05 missense of P03/P05/P08 profiled; P12 has no coverage")

    def test_sort_by_stage_missing_last(self):
        c = self.op.contract
        colon = c.groups[1]
        ids = c.columns[colon["start"]: colon["start"] + colon["count"]]
        self.assertEqual(ids[-1], "P12", "P12 has no STAGE and sorts last in its group")

    def test_tsv_and_json_roundtrip(self):
        text = self.op.to_tsv()
        self.assertTrue(text.startswith("track_name\ttrack_type\t"))
        self.assertIn("Missense Mutation (putative driver)", text)
        again = Oncoprint(type(self.op.contract).from_json(self.op.to_json()))
        self.assertEqual(again.to_tsv(), text)


class Binary(unittest.TestCase):
    def test_opb1_roundtrip(self):
        op = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"))
        data = write_opb1(op.contract)
        self.assertEqual(data[:4], b"OPB1")
        back = read_opb1(data)
        self.assertEqual(back.columns, op.contract.columns)
        for a, b in zip(back.tracks, op.contract.tracks):
            self.assertEqual(a.label, b.label)
            self.assertTrue(np.array_equal(a.cells, b.cells))
            self.assertEqual(a.meta.get("freqPct"), b.meta.get("freqPct"))

    @unittest.skipUnless(shutil.which("node"), "node not on PATH")
    def test_reads_what_node_writes(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "fx.opb1")
            subprocess.run(["node", os.path.join(ROOT, "scripts", "oncoprint-cli.ts"), "--events", os.path.join(FIX, "events.tsv"),
                            "--clinical", os.path.join(FIX, "clinical.tsv"), "--out", out, "--quiet"], check=True, cwd=ROOT)
            op = Oncoprint.from_file(out)
            self.assertEqual(op.contract.n, 12)
            self.assertEqual(op.contract.track("TP53").meta["freqPct"], Oncoprint.from_tables(
                os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv")).contract.track("TP53").meta["freqPct"])


class Conformance(unittest.TestCase):
    """The Python assembler must produce the same contract as lib/oncoprint-assemble.ts."""

    @unittest.skipUnless(shutil.which("node"), "node not on PATH")
    def test_same_contract_as_typescript(self):
        cases = [
            dict(group_by="CANCER_TYPE", sort="STAGE"),
            dict(sort="-AGE,CANCER_TYPE"),
            dict(genes="EGFR,TP53"),
            dict(),
        ]
        for case in cases:
            with tempfile.TemporaryDirectory() as d, self.subTest(case=case):
                out = os.path.join(d, "ts.json")
                cmd = ["node", os.path.join(ROOT, "scripts", "oncoprint-cli.ts"), "--events", os.path.join(FIX, "events.tsv"),
                       "--clinical", os.path.join(FIX, "clinical.tsv"), "--coverage", os.path.join(FIX, "coverage.tsv"), "--out", out, "--quiet"]
                for k, v in case.items():
                    cmd.append("--" + k.replace("_", "-") + "=" + v)   # --sort=-AGE: a leading dash needs the = form
                subprocess.run(cmd, check=True, cwd=ROOT)
                with open(out, encoding="utf-8") as f:
                    ts = json.load(f)
                ts.pop("stats", None)
                py = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"), os.path.join(FIX, "coverage.tsv"),
                                           genes=case.get("genes", "").split(",") if case.get("genes") else None,
                                           group_by=case.get("group_by"), sort=case.get("sort")).to_json()
                py.pop("stats", None)
                self.assertEqual(json.dumps(py, sort_keys=True), json.dumps(ts, sort_keys=True))


class Raster(unittest.TestCase):
    def test_level_of_detail_raster_is_bounded_by_pixels(self):
        from cohortlab.render import raster
        op = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"))
        c = op.contract
        # blow the fixture up to 300k columns by tiling, then rasterise to 1200 px
        big = type(c)(c.study, c.studies, [{"name": "all", "start": 0, "count": 12 * 25000}], c.columns * 25000,
                      [type(t)(t.kind, t.label, np.tile(t.cells, 25000), t.meta) for t in c.tracks], c.conventions, c.stats)
        img, extents = raster(big, width=1200, gutter=100)
        self.assertEqual(img.shape[1], 1200)
        self.assertEqual(extents[0]["count"], 300000)
        self.assertTrue((img[:, 100:, :] != 255).any(), "something was drawn in the plot area")


if __name__ == "__main__":
    unittest.main()
