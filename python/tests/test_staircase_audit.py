"""Audit of the genetic-track staircase sort (PR #193) in the Python port, from the case table.

The same rows, fixtures and expected orders as test/oncoprint-staircase-audit.test.ts, written
without the implementation in view. Legacy source, cbioportal-frontend cd8c6df: SU = SortUtils.ts
getGeneticTrackSortComparator, DU = DataUtils.ts, DeU = DeltaUtils.ts, PC = precomputedcomparator.ts,
BS = bucketsort.ts, OM = oncoprintmodel.ts sortByTracks. mRNA / protein rows (18-21) are not here:
the Python port takes no overlays.

Columns are named by the table's letters; each letter's id runs the other way (A = P9, B = P8, ...),
so a tie that should not be one is not hidden by the id tie-break.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_staircase_audit.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.contract import NOT_PROFILED  # noqa: E402
from cohortlab.local import normalize_display  # noqa: E402

LETTERS = "ABCDEFGHI"
GENOMIC = [{"track": "genomic", "dir": "asc"}]
DESC = [{"track": "genomic", "dir": "desc"}]
TRUNC, SPLICE, INFRAME, PROMOTER, MISSENSE, OTHER = "Nonsense_Mutation", "Splice_Site", "In_Frame_Del", "5'Flank", "Missense_Mutation", "Targeted_Region"
MERGED = [{"label": "M", "genes": ["G1", "G2", "G3"]}]
TWO = ["KRAS", "TP53"]


def _pid(raw, letter):
    return letter if raw else "P" + str(9 - LETTERS.index(letter))


def _letter(raw, pid):
    return pid if raw else LETTERS[9 - int(pid[1:])]


def _members(genes):
    return [m for g in genes for m in ([g] if isinstance(g, str) else g["genes"])]


def contract(cols, events=(), genes=None, np=None, display=None, raw=False, unit="patient", studies=None, study_of=None, sort=GENOMIC):
    genes = genes or ["TP53"]
    members, np = _members(genes), np or {}
    evs = [{**e, "pid": _pid(raw, e["pid"])} for e in events]
    return assemble_contract(genes=genes, groups=[{"name": "all", "pids": [_pid(raw, c) for c in cols]}], studies=studies or ["s"], events=evs,
                             coverage=[{"pid": _pid(raw, c), "genes": [g for g in members if g not in np.get(c, [])]} for c in cols],
                             is_driver=lambda r: bool(r.get("driver")), annotation_source="t", clinical=[], heatmap=[], derived=[],
                             sort=sort, line_gap=0, study_of=study_of, display=normalize_display(display or {}), unit=unit)


def order(cols, **kw):
    raw = kw.get("raw", False)
    return [_letter(raw, p) for p in contract(cols, **kw).columns]


def tie(*ls):
    return sorted(ls, reverse=True)


def mut(pid, mt, driver=False, germ=False, gene="TP53"):
    # a promoter mutation as the warehouse stores one: type 5'Flank, protein change "Promoter" (the portal reads the change)
    return {"pid": pid, "gene": gene, "vt": "mutation", "mt": mt, **({"mv": "Promoter"} if mt == "5'Flank" else {}), "driver": driver, "germ": germ}


def cna(pid, v, driver=False, gene="TP53"):
    return {"pid": pid, "gene": gene, "vt": "cna", "cna": v, "driver": driver}


def sv(pid, driver=False, gene="TP53"):
    return {"pid": pid, "gene": gene, "vt": "structural_variant", "driver": driver}


class DisplayValues(unittest.TestCase):
    def test_d1_cna_2_and_minus_2_draw_amp_homdel_0_nothing(self):
        # DU 35-41, 184-193
        c = contract(["A", "B", "C"], [cna("A", 2), cna("B", -2), cna("C", 0)])
        t = next(x for x in c.tracks if x.label == "TP53")
        cell = lambda l: int(t.cells[list(c.columns).index(_pid(False, l))])  # noqa: E731
        self.assertTrue(cell("A") & 64)
        self.assertTrue(cell("B") & 128)
        self.assertEqual(cell("C"), 0)

    def test_d1_ours_documented_gain_hetloss_not_loaded_rank_as_unaltered(self):
        self.assertEqual(order(["A", "B", "C"], events=[cna("A", 1), cna("B", -1)]), tie("A", "B", "C"))

    def test_d2_driver_amp_before_vus_amp(self):
        self.assertEqual(order(["B", "A"], events=[cna("A", 2, True), cna("B", 2)]), ["A", "B"])

    def test_d3_driver_mutation_before_same_vus_type(self):
        self.assertEqual(order(["B", "A"], events=[mut("A", MISSENSE, True), mut("B", MISSENSE)]), ["A", "B"])

    def test_d4_sv_driver_before_sv_vus_before_unaltered(self):
        self.assertEqual(order(["C", "B", "A"], events=[sv("A", True), sv("B")]), ["A", "B", "C"])

    def test_d5_missense_rec_x1_and_vus_trunc_x3_ranks_as_missense_rec(self):
        # DU 42-55, 124-153
        ev = [mut("A", MISSENSE, True), mut("A", TRUNC), mut("A", TRUNC), mut("A", TRUNC), mut("B", MISSENSE, True), mut("C", TRUNC, True), mut("D", TRUNC)]
        self.assertEqual(order(["D", "C", "B", "A"], events=ev), ["C", *tie("A", "B"), "D"])

    def test_d6_same_key_counts_only(self):
        self.assertEqual(order(["A", "B"], events=[mut("A", TRUNC)] * 3 + [mut("B", TRUNC)]), tie("A", "B"))

    @unittest.skip("unreachable: every mutation display key has its own render priority (DU 42-55); the CNA form is D9")
    def test_d7_same_priority_count_decides(self):
        pass

    def test_d8_merged_amp_rec_x1_homdel_x2_count_wins_homdel_vus(self):
        # DU 63-68, 134-148: amp_rec has no render priority, NaN diff, larger count shown (gain not loaded, homdel used)
        ev = [cna("A", 2, True, "G1"), cna("A", -2, False, "G2"), cna("A", -2, False, "G3"), cna("B", 2, False, "G1"), cna("C", -2, False, "G1"), cna("D", 2, True, "G1")]
        self.assertEqual(order(["A", "B", "C", "D"], events=ev, genes=MERGED), ["D", "B", *tie("A", "C")])

    def test_d9_merged_vus_amp_x1_homdel_x2_count_wins_homdel(self):
        ev = [cna("A", 2, False, "G1"), cna("A", -2, False, "G2"), cna("A", -2, False, "G3"), cna("B", 2, False, "G1"), cna("C", -2, False, "G1")]
        self.assertEqual(order(["A", "B", "C"], events=ev, genes=MERGED), ["B", *tie("A", "C")])

    def test_d10_merged_sv_rec_x1_sv_x5_shows_sv_rec(self):
        ev = [sv("A", True, "G1"), sv("A", False, "G2"), sv("A", False, "G3"), sv("B", True, "G1"), sv("C", False, "G1")]
        self.assertEqual(order(["C", "B", "A"], events=ev, genes=MERGED), [*tie("A", "B"), "C"])

    def test_d11_germline_read_from_displayed_mutation_only(self):
        ev = [mut("A", MISSENSE, True), mut("A", TRUNC, False, True), mut("B", MISSENSE, True), mut("C", MISSENSE, True, True)]
        self.assertEqual(order(["A", "B", "C"], events=ev), ["C", *tie("A", "B")])

    def test_d12_no_profile_is_not_profiled(self):
        c = contract(["A", "B"], np={"A": ["TP53"]})
        t = next(x for x in c.tracks if x.label == "TP53")
        self.assertEqual(int(t.cells[list(c.columns).index("P9")]), NOT_PROFILED)
        self.assertEqual(int(t.cells[list(c.columns).index("P8")]), 0)


class SingleRow(unittest.TestCase):
    def test_01_sv_rec_before_amp_rec(self):
        self.assertEqual(order(["B", "A"], events=[sv("A", True), cna("B", 2, True)]), ["A", "B"])

    def test_02_vus_sv_before_driver_amp(self):
        self.assertEqual(order(["B", "A"], events=[sv("A"), cna("B", 2, True)]), ["A", "B"])

    def test_03_sv_rec_before_sv(self):
        self.assertEqual(order(["B", "A"], events=[sv("A", True), sv("B")]), ["A", "B"])

    def test_04_sv_before_unaltered(self):
        self.assertEqual(order(["B", "A"], events=[sv("A")]), ["A", "B"])

    def test_05_amp_rec_before_homdel_rec(self):
        self.assertEqual(order(["B", "A"], events=[cna("A", 2, True), cna("B", -2, True)]), ["A", "B"])

    def test_06_homdel_rec_before_vus_amp(self):
        self.assertEqual(order(["B", "A"], events=[cna("A", -2, True), cna("B", 2)]), ["A", "B"])

    def test_07_amp_homdel_unaltered(self):
        self.assertEqual(order(["C", "B", "A"], events=[cna("A", 2), cna("B", -2)]), ["A", "B", "C"])

    def test_08_cna_decides_before_mutation(self):
        self.assertEqual(order(["B", "A"], events=[cna("A", -2, True), cna("B", 2), mut("B", MISSENSE, True)]), ["A", "B"])

    def test_09_amp_plus_missense_before_amp_alone(self):
        self.assertEqual(order(["B", "A"], events=[cna("A", 2), mut("A", MISSENSE), cna("B", 2)]), ["A", "B"])

    def test_10_vus_amp_before_trunc_rec(self):
        self.assertEqual(order(["B", "A"], events=[cna("A", 2), mut("B", TRUNC, True)]), ["A", "B"])

    def test_11_driver_types_in_order(self):
        ts = [TRUNC, SPLICE, INFRAME, PROMOTER, MISSENSE, OTHER]
        self.assertEqual(order(list("FEDCBA"), events=[mut(LETTERS[i], t, True) for i, t in enumerate(ts)]), list("ABCDEF"))

    def test_12_missense_rec_before_vus_trunc(self):
        self.assertEqual(order(["B", "A"], events=[mut("A", MISSENSE, True), mut("B", TRUNC)]), ["A", "B"])

    def test_13_other_rec_before_vus_trunc(self):
        self.assertEqual(order(["B", "A"], events=[mut("A", OTHER, True), mut("B", TRUNC)]), ["A", "B"])

    def test_14_vus_types_in_order_then_unaltered(self):
        ts = [TRUNC, SPLICE, INFRAME, PROMOTER, MISSENSE, OTHER]
        self.assertEqual(order(list("GFEDCBA"), events=[mut(LETTERS[i], t) for i, t in enumerate(ts)]), list("ABCDEFG"))

    def test_15_germline_before_somatic(self):
        self.assertEqual(order(["B", "A"], events=[mut("A", MISSENSE, False, True), mut("B", MISSENSE)]), ["A", "B"])

    def test_16_germline_only_a_tie_break(self):
        self.assertEqual(order(["A", "B"], events=[mut("A", MISSENSE), mut("B", MISSENSE, True, True)]), ["B", "A"])
        self.assertEqual(order(["B", "A"], events=[mut("A", TRUNC, True), mut("B", MISSENSE, True, True)]), ["A", "B"])

    @unittest.skip("impossible in practice: an unaltered cell has no germline status to be false")
    def test_17(self):
        pass

    def test_22_unaltered_before_not_profiled(self):
        self.assertEqual(order(["B", "A"], np={"B": ["TP53"]}), ["A", "B"])

    def test_23_not_profiled_after_altered(self):
        self.assertEqual(order(["B", "A"], np={"A": ["TP53"]}, events=[mut("B", MISSENSE)]), ["B", "A"])


class Ids(unittest.TestCase):
    def test_24_p2_before_p10(self):
        self.assertEqual(order(["P10", "P2"], raw=True, unit="sample"), ["P2", "P10"])

    def test_25_tcga(self):
        self.assertEqual(order(["TCGA-AA-3864", "TCGA-AA-A00N"], raw=True), ["TCGA-AA-A00N", "TCGA-AA-3864"])

    def test_26_sa_before_s70(self):
        self.assertEqual(order(["S70", "SA"], raw=True), ["SA", "S70"])

    def test_27_s60_before_sa(self):
        self.assertEqual(order(["SA", "S60"], raw=True), ["S60", "SA"])

    def test_28_case_sensitive(self):
        self.assertEqual(order(["b1", "B1"], raw=True), ["B1", "b1"])

    def test_29_ours_documented_206_t11_p2_p02_then_full_id(self):
        # legacy keeps input order for ids that tie on the vector; ours then compares the full id
        self.assertEqual(order(["P2", "P02"], raw=True), ["P02", "P2"])
        self.assertEqual(order(["P02", "P2"], raw=True), ["P02", "P2"])

    def test_30_shorter_vector_first(self):
        self.assertEqual(order(["P1A", "P1"], raw=True), ["P1", "P1A"])

    def test_31_case_id_has_no_study(self):
        cols = ["study1_S10", "study2_S2"]
        self.assertEqual(order(cols, raw=True, unit="sample", studies=["study1", "study2"], study_of={p: p.split("_")[0] for p in cols}),
                         ["study2_S2", "study1_S10"])

    def test_32_ours_documented_206_t11_same_id_two_studies_full_id(self):
        cols = ["s2_S1", "s1_S1"]
        self.assertEqual(order(cols, raw=True, unit="sample", studies=["s2", "s1"], study_of={p: p.split("_")[0] for p in cols}), ["s1_S1", "s2_S1"])

    def test_33_patient_mode(self):
        self.assertEqual(order(["P10", "P2"], raw=True, unit="patient"), ["P2", "P10"])

    def test_34_ours_invariant_1_no_columns_refused(self):
        # legacy draws an empty oncoprint; ours refuses, naming why
        with self.assertRaisesRegex(Exception, "empty"):
            order([], raw=True)

    def test_35_one_column(self):
        self.assertEqual(order(["S1"], raw=True, events=[mut("S1", MISSENSE)]), ["S1"])

    def test_36_all_equal_by_id(self):
        self.assertEqual(order(["S3", "S1", "S2"], raw=True), ["S1", "S2", "S3"])

    def test_37_diploid_only_is_unaltered(self):
        self.assertEqual(order(["A", "B"], events=[cna("A", 0)]), tie("A", "B"))


NO_DRV, NO_TYPE, NEITHER, IGN = {"sortByDrivers": False}, {"sortByMutationType": False}, {"sortByMutationType": False, "sortByDrivers": False}, {"sortIgnoreVUS": True}


class Switches(unittest.TestCase):
    def test_t1_driver_off_trunc_ties_trunc_rec(self):
        self.assertEqual(order(["C", "B", "A"], display=NO_DRV, events=[mut("A", TRUNC), mut("B", TRUNC, True), mut("C", MISSENSE, True)]), [*tie("A", "B"), "C"])

    @unittest.skip("legacy ill-defined: amp_rec has no rank in the non-driver CNA metric (SU 65-73)")
    def test_t2(self):
        pass

    def test_t3_driver_off_sv_rec_ties_sv(self):
        self.assertEqual(order(["A", "B"], display=NO_DRV, events=[sv("A", True), sv("B")]), tie("A", "B"))

    def test_t4_type_off_trunc_rec_ties_missense_rec(self):
        self.assertEqual(order(["A", "B"], display=NO_TYPE, events=[mut("A", TRUNC, True), mut("B", MISSENSE, True)]), tie("A", "B"))

    def test_t5_type_off_missense_rec_before_vus_trunc(self):
        self.assertEqual(order(["B", "A"], display=NO_TYPE, events=[mut("A", MISSENSE, True), mut("B", TRUNC)]), ["A", "B"])

    def test_t6_type_off_vus_before_unaltered(self):
        self.assertEqual(order(["B", "A"], display=NO_TYPE, events=[mut("A", TRUNC)]), ["A", "B"])

    def test_t7_both_off_mutated_tie(self):
        self.assertEqual(order(["A", "B"], display=NEITHER, events=[mut("A", MISSENSE, True), mut("B", TRUNC)]), tie("A", "B"))

    def test_t8_both_off_mutated_before_unaltered(self):
        self.assertEqual(order(["B", "A"], display=NEITHER, events=[mut("A", MISSENSE)]), ["A", "B"])

    @unittest.skip("same as T2")
    def test_t9(self):
        pass

    def test_t10_ignore_vus_trunc_ties_unaltered(self):
        self.assertEqual(order(["A", "B"], display=IGN, events=[mut("A", TRUNC)]), tie("A", "B"))

    def test_t11_ignore_vus_trunc_rec_before_missense_rec(self):
        self.assertEqual(order(["A", "B"], display=IGN, events=[mut("A", MISSENSE, True), mut("B", TRUNC, True)]), ["B", "A"])

    def test_t12_ignore_vus_type_off_drivers_tie(self):
        self.assertEqual(order(["A", "B"], display={**IGN, **NO_TYPE}, events=[mut("A", TRUNC, True), mut("B", MISSENSE, True)]), tie("A", "B"))

    def test_t13_ignore_vus_amp_ties_unaltered(self):
        self.assertEqual(order(["A", "B"], display=IGN, events=[cna("A", 2)]), tie("A", "B"))

    def test_t14_ignore_vus_sv_ties_unaltered(self):
        self.assertEqual(order(["A", "B"], display=IGN, events=[sv("A")]), tie("A", "B"))

    def test_t15_ignore_vus_germline_vus_ties_unaltered(self):
        self.assertEqual(order(["A", "B"], display=IGN, events=[mut("A", MISSENSE, False, True)]), tie("A", "B"))

    def test_t16_ignore_vus_germline_driver_before_somatic_driver(self):
        self.assertEqual(order(["B", "A"], display=IGN, events=[mut("A", MISSENSE, True, True), mut("B", MISSENSE, True)]), ["A", "B"])

    def test_t17_ignore_vus_with_driver_off_is_off(self):
        # DeU 1030-1038
        self.assertEqual(order(["A", "B", "C"], display={"sortByDrivers": False, "sortIgnoreVUS": True}, events=[mut("B", MISSENSE, True), mut("C", TRUNC)]), ["C", "B", "A"])

    def test_t18_no_annotation_turns_ignore_vus_off(self):
        # DeU 1022-1038
        self.assertEqual(order(["A", "B", "C"], display={"annotate": "none", "sortIgnoreVUS": True}, events=[mut("B", MISSENSE), mut("C", TRUNC)]), ["C", "B", "A"])

    def test_t19_color_by_type_off_turns_type_sort_off(self):
        # DeU 1014-1020
        self.assertEqual(order(["A", "B"], display={"colorByType": False}, events=[mut("A", MISSENSE), mut("B", TRUNC)]), tie("A", "B"))


class Direction(unittest.TestCase):
    def test_r1_default_is_ascending(self):
        self.assertEqual(order(["B", "A"], events=[cna("A", 2)], sort=None), ["A", "B"])

    def test_r2_desc_unaltered_before_amp(self):
        self.assertEqual(order(["A", "B"], events=[cna("A", 2)], sort=DESC), ["B", "A"])

    def test_r3_desc_not_profiled_first(self):
        self.assertEqual(order(["B", "A"], np={"A": ["TP53"]}, sort=DESC), ["A", "B"])

    def test_r4_desc_ids_not_flipped(self):
        self.assertEqual(order(["P10", "P2"], raw=True, sort=DESC), ["P2", "P10"])


class Rows(unittest.TestCase):
    def test_m1_row1_decides(self):
        ev = [cna("A", 2, False, "KRAS"), mut("B", MISSENSE, True, False, "KRAS"), mut("B", TRUNC, True, False, "TP53")]
        self.assertEqual(order(["B", "A"], genes=TWO, events=ev), ["A", "B"])

    def test_m2_row1_tied_row2_decides(self):
        self.assertEqual(order(["B", "A"], genes=TWO, events=[mut("A", MISSENSE, True, False, "TP53")]), ["A", "B"])

    def test_m3_na_is_preferred_only_altered_row2_before_unaltered(self):
        # SU 235-244, OM 2449-2458
        self.assertEqual(order(["B", "A"], genes=TWO, np={"A": ["KRAS"]}, events=[mut("A", MISSENSE, False, False, "TP53")]), ["A", "B"])

    def test_m4_id_is_preferred_only(self):
        self.assertEqual(order(["P2", "P10"], raw=True, genes=TWO, events=[cna("P10", 2)]), ["P10", "P2"])

    def test_m5_all_tied_by_id(self):
        self.assertEqual(order(["P10", "P2"], raw=True, genes=TWO), ["P2", "P10"])

    def test_m6_both_na_row1_row2_decides(self):
        self.assertEqual(order(["A", "B"], genes=TWO, np={"A": ["KRAS"], "B": ["KRAS"]}, events=[mut("B", MISSENSE, False, False, "TP53")]), ["B", "A"])


if __name__ == "__main__":
    unittest.main()
