"""Audit of the OncoPrint Sort switches (cBioLab#195) in the Python port, from the case table (rows 1-24).

The same cases as test/oncoprint-sort-switches-audit.test.ts; legacy source cbioportal-frontend cd8c6df:
SU = SortUtils.ts getGeneticTrackSortComparator, DU = DeltaUtils.ts (effective switches 1013-1038),
DAT = DataUtils.ts, RVO = ResultsViewOncoprint.tsx. MT = sortByMutationType, DR = sortByDrivers,
IV = sortIgnoreVUS. Every case runs under two id assignments (forward A=c1.., reversed A=c5..), so
a wrong tie and a wrong rank both show; expectations are tie classes of letters, each class by id.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_sort_switches_audit.py
"""
from __future__ import annotations

import itertools
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.local import normalize_display  # noqa: E402

TRUNC, MIS = "Nonsense_Mutation", "Missense_Mutation"
NO_DRIVERS = {"oncokb": False, "custom": False, "tiers": []}


def mut(mt, driver=False, germ=False):
    e = {"vt": "mutation", "mt": mt, "driver": driver}
    if germ:
        e["germ"] = True
    return e


def cna(v, driver=False):
    return {"vt": "cna", "cna": v, "driver": driver}


def sv(driver=False):
    return {"vt": "structural_variant", "driver": driver}


def ids(cols, mapping):
    letters = list(cols)
    n = len(letters)
    return {l: "c" + str(i + 1 if mapping == "forward" else n - i) for i, l in enumerate(letters)}


def build(cols, mapping, display, drivers=None, not_profiled=()):
    idm = ids(cols, mapping)
    events = [{"pid": idm[l], "gene": "TP53", **e} for l in cols for e in cols[l]]
    return assemble_contract(genes=["TP53"], groups=[{"name": "all", "pids": [idm[l] for l in cols]}], studies=["s"], events=events,
                             coverage=[{"pid": idm[l], "genes": ["TP53"]} for l in cols if l not in not_profiled],
                             is_driver=lambda r: bool(r.get("driver")), annotation_source="t", clinical=[], heatmap=[], derived=[],
                             sort=[{"track": "genomic", "dir": "asc"}], line_gap=0, display=normalize_display(display, drivers))


def order(cols, mapping, display, drivers=None, not_profiled=()):
    back = {v: k for k, v in ids(cols, mapping).items()}
    return [back[p] for p in build(cols, mapping, display, drivers, not_profiled).columns]


def expected(cols, mapping, classes):
    idm = ids(cols, mapping)
    return [l for c in classes for l in sorted(c, key=lambda x: int(idm[x][1:]))]


def sw(mt, dr, iv):
    return {"sortByMutationType": mt, "sortByDrivers": dr, "sortIgnoreVUS": iv}


ALL = [(f"MT {mt}, DR {dr}, IV {iv}", sw(mt, dr, iv)) for mt, dr, iv in itertools.product([True, False], repeat=3)]

MUTS = {"A": [mut(MIS)], "B": [mut(TRUNC, True)], "C": [mut(MIS, True)], "D": [mut(TRUNC)], "E": []}
CNAS = {"A": [cna(2)], "B": [cna(-2, True)], "C": [cna(2, True)], "D": [cna(-2)], "E": []}   # D: homdel VUS for the table's gain VUS
SVS = {"A": [sv()], "B": [sv(True)], "C": []}


class SortSwitches(unittest.TestCase):
    def check(self, cols, display, classes, label, drivers=None, not_profiled=()):
        for m in ("forward", "reversed"):
            self.assertEqual(order(cols, m, display, drivers, not_profiled), expected(cols, m, classes), f"{label} ({m} ids)")

    def test_01_defaults_mt_on_dr_on_iv_off_rvo_230_250(self):
        for m in ("forward", "reversed"):
            self.assertEqual(order(MUTS, m, {}), order(MUTS, m, sw(True, True, False)), m)

    def test_02_mt_dr_on_drivers_before_vus_su_159_176(self):
        self.check(MUTS, sw(True, True, False), [["B"], ["C"], ["D"], ["A"], ["E"]], "B C D A E")

    def test_03_mt_on_dr_off_su_147_158(self):
        self.check(MUTS, sw(True, False, False), [["B", "D"], ["A", "C"], ["E"]], "[B D] [A C] E")

    def test_04_mt_off_dr_on_su_134_146(self):
        self.check(MUTS, sw(False, True, False), [["B", "C"], ["A", "D"], ["E"]], "[B C] [A D] E")

    def test_05_mt_off_dr_off_su_128_133(self):
        self.check(MUTS, sw(False, False, False), [["A", "B", "C", "D"], ["E"]], "[A B C D] E")

    def test_06_mt_dr_iv_on_su_106_115(self):
        self.check(MUTS, sw(True, True, True), [["B"], ["C"], ["A", "D", "E"]], "B C [A D E]")

    def test_07_mt_off_dr_iv_on_su_116_127(self):
        self.check(MUTS, sw(False, True, True), [["B", "C"], ["A", "D", "E"]], "[B C] [A D E]")

    def test_08a_iv_without_dr_has_no_effect_du_1030_1038(self):
        self.check(MUTS, sw(True, False, True), [["B", "D"], ["A", "C"], ["E"]], "MT on, DR off, IV on = row 3")
        self.check(MUTS, sw(False, False, True), [["A", "B", "C", "D"], ["E"]], "MT off, DR off, IV on = row 5")

    def test_08b_iv_without_driver_annotation_has_no_effect_du_1030_1038(self):
        no_ann = {"A": [mut(MIS)], "B": [mut(TRUNC)], "C": [mut(MIS)], "D": [mut(TRUNC)], "E": []}
        self.check(no_ann, sw(True, True, True), [["B", "D"], ["A", "C"], ["E"]], "no annotation, IV on = by type", NO_DRIVERS)

    def test_09_cna_dr_on_su_76_87(self):
        self.check(CNAS, sw(True, True, False), [["C"], ["B"], ["A"], ["D"], ["E"]], "C B A D E")

    def test_10_cna_dr_off_mt_no_effect_su_65_73(self):
        self.check(CNAS, sw(True, False, False), [["A", "C"], ["B", "D"], ["E"]], "MT on")
        self.check(CNAS, sw(False, False, False), [["A", "C"], ["B", "D"], ["E"]], "MT off")

    def test_11_cna_iv_on_su_56_64(self):
        self.check(CNAS, sw(True, True, True), [["C"], ["B"], ["A", "D", "E"]], "MT on")
        self.check(CNAS, sw(False, True, True), [["C"], ["B"], ["A", "D", "E"]], "MT off")

    def test_12_sv_su_183_189(self):
        self.check(SVS, sw(True, True, False), [["B"], ["A"], ["C"]], "DR on")
        self.check(SVS, sw(True, False, False), [["A", "B"], ["C"]], "DR off")
        self.check(SVS, sw(True, True, True), [["B"], ["A", "C"]], "IV on")

    def test_13_sv_before_cna_su_213_216(self):
        f = {"A": [sv()], "B": [cna(2, True)]}
        for name, s in ALL:
            if not s["sortIgnoreVUS"]:
                self.check(f, s, [["A"], ["B"]], name)

    def test_14_sv_vus_ignored_su_184_185(self):
        f = {"A": [sv()], "B": [cna(2, True)]}
        self.check(f, sw(True, True, True), [["B"], ["A"]], "IV on")

    def test_15_germline_vus_ignored_su_194_206(self):
        f = {"A": [mut(MIS, False, True)], "B": []}
        self.check(f, sw(True, True, True), [["A", "B"]], "IV on: tie")
        self.check(f, sw(True, True, False), [["A"], ["B"]], "IV off")

    def test_16_germline_driver_first_su_191(self):
        f = {"A": [mut(TRUNC, True, True)], "B": [mut(TRUNC, True)]}
        for name, s in ALL:
            if s["sortByDrivers"] or not s["sortIgnoreVUS"]:
                self.check(f, s, [["A"], ["B"]], name)

    @unittest.skip("17: the Python port's assemble_contract takes no mRNA/protein overlays")
    def test_17_mrna_protein(self):
        pass

    def test_18_not_profiled_last_su_235(self):
        f = {"A": [], "B": [], "C": [mut(MIS)]}
        for name, s in ALL:
            iv = s["sortIgnoreVUS"] and s["sortByDrivers"]
            self.check(f, s, [["B", "C"], ["A"]] if iv else [["C"], ["B"], ["A"]], name, not_profiled=("A",))

    def test_19_displayed_mutation_is_highest_priority_dat_42_55(self):
        f = {"A": [mut(MIS, True), mut(TRUNC)], "B": [mut(TRUNC)]}
        self.check(f, sw(True, False, False), [["B"], ["A"]], "MT on, DR off")
        self.check(f, sw(True, True, False), [["A"], ["B"]], "MT on, DR on")

    def test_20_mt_off_in_effect_without_colour_by_type_du_1013_1019(self):
        self.check(MUTS, {"colorByType": False, **sw(True, True, False)}, [["B", "C"], ["A", "D"], ["E"]], "= row 4")
        self.check(MUTS, {"colorByType": False, **sw(True, False, False)}, [["A", "B", "C", "D"], ["E"]], "= row 5")

    def test_21_dr_iv_off_in_effect_without_annotation_du_1021_1038(self):
        f = {"A": [mut(MIS)], "B": [mut(TRUNC)], "E": []}
        self.check(f, sw(True, True, True), [["B"], ["A"], ["E"]], "MT on, IV on", NO_DRIVERS)
        self.check(f, sw(False, True, True), [["A", "B"], ["E"]], "MT off, IV on", NO_DRIVERS)

    @unittest.skip("22: UI-only (menu disabled state, tooltip)")
    def test_22_ui(self):
        pass

    def test_23_iv_changes_no_count(self):
        for m in ("forward", "reversed"):
            off = next(t for t in build(MUTS, m, sw(True, True, False)).tracks if t.label == "TP53")
            on = next(t for t in build(MUTS, m, sw(True, True, True)).tracks if t.label == "TP53")
            self.assertEqual(on.altered, 4)
            for k in ("altered", "profiled", "driverAltered", "freqPct", "driverPct"):
                self.assertEqual(getattr(on, k), getattr(off, k), k)

    def test_24_switch_changes_no_cell(self):
        def cells(d):
            c = build(MUTS, "forward", d)
            t = next(x for x in c.tracks if x.label == "TP53")
            return {p: int(t.cells[i]) for i, p in enumerate(c.columns)}
        base = cells(sw(True, True, False))
        for name, s in ALL:
            self.assertEqual(cells(s), base, name)


if __name__ == "__main__":
    unittest.main()
