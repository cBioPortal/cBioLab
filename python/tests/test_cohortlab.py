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
        self.assertEqual(int(tp53.cells[col("P01")]), BITS["MISSENSE"] | BITS["DRIVER"] | BITS["MUT_DRIVER"])
        self.assertEqual(int(tp53.cells[col("P02")]), BITS["TRUNCATING"] | BITS["DRIVER"] | BITS["MUT_DRIVER"])
        self.assertEqual(int(kras.cells[col("P03")]), BITS["AMP"] | BITS["DRIVER"])
        self.assertEqual(int(kras.cells[col("P08")]), 0, "GAIN is below the high-level threshold")
        self.assertEqual(int(egfr.cells[col("P05")]), NOT_PROFILED, "P05's panel does not cover EGFR")
        self.assertEqual(int(egfr.cells[col("P04")]), BITS["MISSENSE"] | BITS["SV"] | BITS["DRIVER"] | BITS["MUT_DRIVER"], "the fusion is a VUS beside a driver missense")
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

    def test_reads_what_node_writes(self):
        self.assertTrue(shutil.which("node"), "node is required to check conformance against the TypeScript implementation")
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

    def test_same_contract_as_typescript(self):
        self.assertTrue(shutil.which("node"), "node is required to check conformance against the TypeScript implementation")
        cases = [
            dict(group_by="CANCER_TYPE", sort="STAGE"),
            dict(sort="-AGE,CANCER_TYPE"),
            dict(genes="EGFR,TP53"),
            # merged rows: the label the members imply, an explicit one, and a gene drawn both ways
            dict(genes="[TP53 MDM2] KRAS"),
            dict(genes='["TP53 pathway" TP53 MDM2] TP53 KRAS'),
            dict(genes="[TP53 MDM2] KRAS", display='{"hideVUS": true}'),
            dict(display='{"showUnaltered": false, "gaps": "pct", "style": {"palette": {"unaltered": "#f0f0f0"}}, "colors": {"CANCER_TYPE": {"Lung": "#123456"}}}'),
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
                                           genes=case.get("genes") or None,
                                           group_by=case.get("group_by"), sort=case.get("sort"),
                                           display=json.loads(case["display"]) if case.get("display") else None).to_json()
                py.pop("stats", None)
                self.assertEqual(json.dumps(py, sort_keys=True), json.dumps(ts, sort_keys=True))


class LevelOfDetailConformance(unittest.TestCase):
    """Bucket codes must match lib/oncoprint-lod.ts at several widths, including the 400k-style case."""

    def test_bucket_codes_match_typescript(self):
        self.assertTrue(shutil.which("node"), "node is required to check conformance against the TypeScript implementation")
        from cohortlab.render import bucket_codes
        op = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"), os.path.join(FIX, "coverage.tsv"), group_by="CANCER_TYPE")
        with tempfile.TemporaryDirectory() as d:
            cpath = os.path.join(d, "c.json")
            op.to_json(cpath)
            for buckets in (1, 2, 3, 5, 12, 50):
                with self.subTest(buckets=buckets):
                    r = subprocess.run(["node", os.path.join(ROOT, "scripts", "oncoprint-cli.ts"), "--contract", cpath, "--lod", str(buckets)],
                                       check=True, cwd=ROOT, capture_output=True, text=True)
                    self.assertEqual(json.loads(r.stdout), bucket_codes(op.contract, buckets))


class ExceptionRows(unittest.TestCase):
    """The rows that point at exceptions keep them at low zoom (mirrors test/oncoprint-style.test.ts)."""

    def test_profiled_and_bar_buckets(self):
        from cohortlab.contract import Track
        from cohortlab.render import aggregate, bucket_edges
        prof = Track("clinical", "Profiled for mutations", np.array([0, 0, 0, -1, 0, 0], dtype=np.int32), {"categories": ["Yes"], "profiledFor": "MUTATION_EXTENDED"})
        self.assertEqual(aggregate(prof, prof.cells, bucket_edges(6, 2)).tolist(), [0, -1])
        bar = Track("clinical", "# Samples per Patient", np.array([128, 128, 255, 128, -1, -1], dtype=np.int32), {"numeric": True, "peak": True})
        self.assertEqual(aggregate(bar, bar.cells, bucket_edges(6, 3)).tolist(), [128, 255, -1])


class StyleOverrides(unittest.TestCase):
    """resolve_style mirrors lib/oncoprint-style.ts, and an override reaches the drawn pixels."""

    def test_merge_and_rejections(self):
        from cohortlab import STYLE, resolve_style
        self.assertIs(resolve_style(None), STYLE)
        S = resolve_style({"palette": {"unaltered": "#f0f0f0"}, "glyph": {"sv": {"vus": "#123456"}}})
        self.assertEqual(S["palette"]["unaltered"], "#f0f0f0")
        self.assertEqual(S["glyph"]["sv"]["vus"], "#123456")
        self.assertEqual(S["palette"]["paper"], STYLE["palette"]["paper"])
        self.assertEqual(STYLE["palette"]["unaltered"], "#bebebe", "the defaults are not mutated")
        for bad, msg in [({"palete": {}}, "not a style key"), ({"palette": {"unaltered": "red"}}, "#rrggbb"),
                         ({"bits": {"AMP": 1}}, "read-only"), ({"geometry": {"rowH": "tall"}}, "must be a number"),
                         ({"glyph": {"mutation": {"priority": [{"bit": "MISSENSE"}, {}, {}, {}, {}, {}]}}}, "read-only"),
                         ({"glyph": {"vusStyle": "fade"}}, "not a style key"),
                         ({"glyph": {"notProfiled": {"fill": "#bebebe", "stripe": {"color": "#bebebe"}}}}, "indistinguishable")]:
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(ValueError, msg):
                    resolve_style(bad)

    def test_display_validation_matches_typescript(self):
        from cohortlab import normalize_display
        self.assertEqual(normalize_display(None), {"showUnaltered": True, "whitespace": True, "gaps": "none", "clinicalLegends": "all", "colorByType": True, "hideVUS": False, "annotate": "oncokb", "whiteBackground": False})
        with self.assertRaisesRegex(ValueError, "unknown option 'showUnalterd'"):
            normalize_display({"showUnalterd": True})
        with self.assertRaisesRegex(ValueError, "is not one of none, gaps, pct, pct-left"):
            normalize_display({"gaps": "yes"})
        with self.assertRaisesRegex(ValueError, "#rrggbb"):
            normalize_display({"colors": {"TYPE": {"x": "red"}}})

    def test_override_reaches_the_pixels(self):
        from cohortlab.render import raster
        opts = dict(group_by="CANCER_TYPE", sort="STAGE")
        plain = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"), os.path.join(FIX, "coverage.tsv"), **opts)
        themed = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"), os.path.join(FIX, "coverage.tsv"),
                                       display={"style": {"palette": {"unaltered": "#f0f0f0"}}, "colors": {"CANCER_TYPE": {"Lung": "#123456"}}}, **opts)
        a, _ = raster(plain.contract, width=600)
        b, _ = raster(themed.contract, width=600)
        self.assertTrue((a == np.array([190, 190, 190])).all(axis=2).any(), "the default unaltered grey is drawn")
        grey = lambda img: int((img == np.array([190, 190, 190])).all(axis=2).sum())  # noqa: E731
        # the not-profiled line is the same grey, so the override shows as the grey shrinking to that line
        self.assertLess(grey(b), grey(a) // 4, "and is gone from unaltered cells once overridden")
        self.assertTrue((b == np.array([240, 240, 240])).all(axis=2).any(), "which draw the override instead")
        self.assertTrue((b == np.array([240, 240, 240])).all(axis=2).any())
        self.assertTrue((b == np.array([0x12, 0x34, 0x56])).all(axis=2).any(), "the per-track colour is drawn")


class Raster(unittest.TestCase):
    def test_golden_raster(self):
        """The fixture's raster is pinned; set UPDATE_GOLDEN=1 to accept an intentional style change."""
        from cohortlab.render import raster
        op = Oncoprint.from_tables(os.path.join(FIX, "events.tsv"), os.path.join(FIX, "clinical.tsv"), os.path.join(FIX, "coverage.tsv"), group_by="CANCER_TYPE", sort="STAGE")
        img, _ = raster(op.contract, width=600, gutter=0)
        golden = os.path.join(FIX, "golden-raster.npz")
        if os.environ.get("UPDATE_GOLDEN") or not os.path.exists(golden):
            np.savez_compressed(golden, img=img)
        want = np.load(golden)["img"]
        self.assertEqual(img.shape, want.shape)
        diff = int((img != want).any(axis=2).sum())
        self.assertEqual(diff, 0, f"{diff} pixels differ from the golden raster")

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


class GeneTracks(unittest.TestCase):
    """The port of lib/gene-tracks.ts: what a row is, and the portal's bracket text."""

    def test_rows_and_symbols(self):
        from cohortlab.gene_tracks import gene_symbols, normalize_gene_tracks, parse_gene_list, to_gene_list
        tracks, symbols = normalize_gene_tracks([{"genes": ["tp53", "MDM2"]}, "TP53", "kras"])
        self.assertEqual([t.label for t in tracks], ["TP53 / MDM2", "TP53", "KRAS"])
        self.assertEqual(symbols, ["TP53", "MDM2", "KRAS"], "first appearance: the mask bit order")
        self.assertEqual(gene_symbols([{"label": "P", "genes": ["TP53"]}, "KRAS"]), ["TP53", "KRAS"])
        again, _ = normalize_gene_tracks(to_gene_list(tracks))
        self.assertEqual(again, tracks, "normalizing the canonical form is a no-op")
        self.assertEqual(parse_gene_list('TP53 ["P" MDM2, MDM4]'), ["TP53", {"label": "P", "genes": ["MDM2", "MDM4"]}])

    def test_refusals_match_the_typescript(self):
        from cohortlab.gene_tracks import normalize_gene_tracks, parse_gene_list
        for bad in ("[TP53", "TP53]", "[[TP53]]", "[]", "TP53: MUT"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_gene_list(bad)
        with self.assertRaises(ValueError):
            normalize_gene_tracks([{"genes": ["!!"]}])
        with self.assertRaises(ValueError):
            normalize_gene_tracks([{"label": "X", "genes": ["TP53"]}, {"label": "X", "genes": ["KRAS"]}])
