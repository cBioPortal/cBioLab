"""Which copy-number call a cell shows when it holds several, in the Python port (C16: C1-C12).

The same rows and expectations as test/oncoprint-cna-calls.test.ts, written from the case table
without the implementation in view. Legacy source, cbioportal-frontend cd8c6df:
DU = src/shared/components/oncoprint/DataUtils.ts fillGeneticTrackDatum (161-243),
selectDisplayValue (126-158). Each copy-number event adds one to a count keyed amp / amp_rec /
homdel / homdel_rec; no _rec key has a render priority, so the key with the most events is the
cell's call, deciding both the glyph and whether the copy number is a driver. Ours on equal
counts, documented: a driver before a VUS, then amplification before deep deletion.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_cna_calls.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.local import normalize_display  # noqa: E402
from cohortlab.style import BITS as B  # noqa: E402

GENOMIC = [{"track": "genomic", "dir": "asc"}]
MERGED = [{"label": "M", "genes": ["G1", "G2", "G3"]}]
MISSENSE = "Missense_Mutation"


def _members(genes):
    return [m for g in genes for m in ([g] if isinstance(g, str) else g["genes"])]


def contract(events, genes=None, display=None, unit="patient", cols=("A",)):
    genes = genes or ["TP53"]
    members = _members(genes)
    return assemble_contract(genes=genes, groups=[{"name": "all", "pids": list(cols)}], studies=["s"], events=list(events),
                             coverage=[{"pid": c, "genes": members} for c in cols],
                             is_driver=lambda r: bool(r.get("driver")), annotation_source="t", clinical=[], heatmap=[], derived=[],
                             sort=GENOMIC, line_gap=0, display=normalize_display(display or {}), unit=unit)


def cell(events, genes=None, display=None, unit="patient", col="A"):
    c = contract(events, genes, display, unit)
    label = "TP53" if genes is None else genes[0]["label"]
    t = next(x for x in c.tracks if x.label == label)
    return int(t.cells[list(c.columns).index(col)])


def has(code, bit):
    return bool(code & B[bit])


def call(code):
    kinds = [k for k, b in (("amp", "AMP"), ("homdel", "HOMDEL")) if has(code, b)]
    return ("+".join(kinds) or "none") + (" driver" if has(code, "CNA_DRIVER") else " VUS")


def cna(v, driver=False, gene="TP53", pid="A"):
    return {"pid": pid, "gene": gene, "vt": "cna", "cna": v, "driver": driver}


def mut(mt, driver=False, gene="TP53", pid="A"):
    return {"pid": pid, "gene": gene, "vt": "mutation", "mt": mt, "driver": driver, "germ": False}


C2 = [cna(2, False, "G1"), cna(-2, False, "G2"), cna(-2, False, "G3")]
C4 = [cna(2, True, "G1"), cna(-2, False, "G2"), cna(-2, False, "G3")]


class CnaCalls(unittest.TestCase):
    def test_c01_one_call_vus_amp(self):
        # DU 161-243
        x = cell([cna(2)])
        self.assertEqual(call(x), "amp VUS")
        self.assertFalse(has(x, "DRIVER"))

    def test_c02_merged_vus_amp_x1_homdel_x2_shows_homdel(self):
        # DU 126-158
        self.assertEqual(call(cell(C2, MERGED)), "homdel VUS")

    def test_c03_merged_amp_x2_homdel_x1_shows_amp(self):
        self.assertEqual(call(cell([cna(-2, False, "G1"), cna(2, False, "G2"), cna(2, False, "G3")], MERGED)), "amp VUS")

    def test_c04_driver_amp_x1_vus_homdel_x2_shows_vus_homdel(self):
        # DU 126-158: amp_rec has no render priority, the diff is NaN, the count decides
        x = cell(C4, MERGED)
        self.assertEqual(call(x), "homdel VUS")
        self.assertFalse(has(x, "CNA_DRIVER"))
        self.assertTrue(has(x, "DRIVER"))  # ours: the column still holds a driver alteration (the gutter's driver %)

    def test_c05_amp_and_amp_rec_counted_apart(self):
        # DU 185-189: driver amp x1, VUS amp x1, VUS homdel x2
        genes = [{"label": "M", "genes": ["G1", "G2", "G3", "G4"]}]
        ev = [cna(2, True, "G1"), cna(2, False, "G2"), cna(-2, False, "G3"), cna(-2, False, "G4")]
        self.assertEqual(call(cell(ev, genes)), "homdel VUS")

    def test_c06_driver_amp_x2_vus_homdel_x1_shows_driver_amp(self):
        x = cell([cna(2, True, "G1"), cna(2, True, "G2"), cna(-2, False, "G3")], MERGED)
        self.assertEqual(call(x), "amp driver")
        self.assertTrue(has(x, "DRIVER"))

    def test_c07_patient_mode_samples_amp_homdel_homdel_shows_homdel(self):
        # DU 161-243: every sample's event a row with the patient's id
        self.assertEqual(call(cell([cna(2), cna(-2), cna(-2)], unit="patient")), "homdel VUS")

    def test_c08_equal_counts_vus_amp_vus_homdel_ours_amp(self):
        # portal: the first event's kind; ours, documented: amp before homdel, whichever came first
        for ev in ([cna(2, False, "G1"), cna(-2, False, "G2")], [cna(-2, False, "G1"), cna(2, False, "G2")]):
            with self.subTest(order=[e["cna"] for e in ev]):
                self.assertEqual(call(cell(ev, MERGED)), "amp VUS")

    def test_c09_equal_counts_vus_amp_driver_homdel_ours_driver_homdel(self):
        for ev in ([cna(2, False, "G1"), cna(-2, True, "G2")], [cna(-2, True, "G1"), cna(2, False, "G2")]):
            with self.subTest(order=[e["cna"] for e in ev]):
                self.assertEqual(call(cell(ev, MERGED)), "homdel driver")

    def test_c10_driver_missense_stays_driver_cna_is_vus_homdel(self):
        # DU 205-216
        x = cell(C4 + [mut(MISSENSE, True, "G1")], MERGED)
        self.assertEqual(call(x), "homdel VUS")
        self.assertTrue(has(x, "MISSENSE"))
        self.assertTrue(has(x, "MUT_DRIVER"))
        self.assertTrue(has(x, "DRIVER"))

    def test_c11_hide_vus_hides_before_counting_driver_amp(self):
        self.assertEqual(call(cell(C4, MERGED, display={"hideVUS": True})), "amp driver")

    def test_c12_annotation_off_amp_x1_homdel_x2_shows_homdel(self):
        self.assertEqual(call(cell(C2, MERGED, display={"annotate": "none"})), "homdel VUS")
        # annotation off is applied by the driver callback itself (lib/annotation.ts isDriverEvent), which then
        # calls nothing a driver; the engine takes the callback's word, so that case is the one above


if __name__ == "__main__":
    unittest.main()
