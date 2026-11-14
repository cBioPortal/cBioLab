"""OncoPrint column sort ties and text tracks in the Python port, from the case table (rows T1-T11, S1-S7).

The same cases, fixtures and expected orders as test/oncoprint-sort-ties.test.ts; the legacy source
cited is cbioportal-frontend cd8c6df: SU = SortUtils.ts, NS = javascript-natural-sort 0.7.1
naturalSort.js, PC = oncoprintjs precomputedcomparator.ts, OM = oncoprintmodel.ts sortByTracks,
BS = bucketsort.ts stringToVector. Every fixture has no alterations and every column profiled, so
the genomic staircase ties everywhere and only the rule under test orders the columns.

The ids S-1, S-2, S-09, S-10 are where the two id orders disagree: naturalSort ascending is
S-09, S-1, S-2, S-10 (NS keeps "09" a string, "09" < "1"); stringToVector ascending is
S-1, S-2, S-09, S-10 (BS reads 09 as 9).

Run from the repo root:  python/.venv/bin/pytest python/tests/test_sort_ties.py
"""
from __future__ import annotations

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402

IDS = ["S-2", "S-10", "S-1", "S-09"]   # fetch order deliberately neither id order
NAT_ASC = ["S-09", "S-1", "S-2", "S-10"]
NAT_DESC = ["S-10", "S-2", "S-1", "S-09"]
NUMS = ["N" + str(i + 1).zfill(2) for i in range(11)]


def contract(pids, sort, clinical=None, heatmap=None, derived=None, studies=None, study_of=None):
    return assemble_contract(genes=["TP53"], groups=[{"name": "all", "pids": pids}], studies=studies or ["s"], events=[],
                             coverage=[{"pid": p, "genes": ["TP53"]} for p in pids], is_driver=lambda r: False, annotation_source="t",
                             clinical=clinical or [], heatmap=heatmap or [], derived=derived or [], sort=sort, line_gap=0,
                             study_of=study_of)


def cols(pids, sort, **kw) -> list[str]:
    return list(contract(pids, sort, **kw).columns)


def asc(track):
    return {"track": track, "dir": "asc"}


def desc(track):
    return {"track": track, "dir": "desc"}


def same(pids, v):
    return {p: v for p in pids}


def text_tie(attr="TYPE", v="x"):
    return dict(clinical=[{"attr": attr, "values": same(IDS, v)}])


# a numeric track (11 distinct values, > 10) on which the four S ids tie at 50
NUMERIC_TIE_PIDS = NUMS[:5] + IDS + NUMS[5:]
NUMERIC_TIE = dict(clinical=[{"attr": "TMB", "values": {**{p: str(i * 10 + 1) for i, p in enumerate(NUMS)}, **same(IDS, "50")}}])


def only_s(c):
    return [p for p in c if p.startswith("S-")]


class Ties(unittest.TestCase):
    def test_t1_tie_first_track_key_ascending_natural_sort(self):
        # SU 368 alphabeticalDefault: naturalSort(d1.sample, d2.sample); NS 37: "09" < "1" as strings
        self.assertEqual(cols(IDS, [asc("TYPE")], **text_tie()), ["S-09", "S-1", "S-2", "S-10"], "text track")
        self.assertEqual(only_s(cols(NUMERIC_TIE_PIDS, [asc("TMB")], **NUMERIC_TIE)), ["S-09", "S-1", "S-2", "S-10"], "numeric track, tied at 50")
        self.assertEqual(cols(IDS, [asc("treated")], derived=[{"label": "treated", "pids": set(IDS)}]), ["S-09", "S-1", "S-2", "S-10"], "derived track")

    def test_t2_tie_first_track_key_descending_natural_sort_descending(self):
        # PC 77 makeDirectedComparator: res * sort_direction, id comparison included
        self.assertEqual(cols(IDS, [desc("TYPE")], **text_tie()), ["S-10", "S-2", "S-1", "S-09"], "text track")
        self.assertEqual(only_s(cols(NUMERIC_TIE_PIDS, [desc("TMB")], **NUMERIC_TIE)), ["S-10", "S-2", "S-1", "S-09"], "numeric track, tied at 50")
        self.assertEqual(cols(IDS, [desc("treated")], derived=[{"label": "treated", "pids": set(IDS)}]), ["S-10", "S-2", "S-1", "S-09"], "derived track")

    def test_t3_two_track_keys_first_decides(self):
        # OM 2453: every mandatory value, then every preferred value in priority order
        clin = [{"attr": "A", "values": same(IDS, "x")}, {"attr": "B", "values": same(IDS, "y")}]
        self.assertEqual(cols(IDS, [desc("A"), asc("B")], clinical=clin), ["S-10", "S-2", "S-1", "S-09"])
        self.assertEqual(cols(IDS, [asc("A"), desc("B")], clinical=clin), ["S-09", "S-1", "S-2", "S-10"])

    def test_t4_genomic_only_string_to_vector_ascending_either_way(self):
        # SU 246: the genetic preferred vector ends with the id; PC 129-133 flips numbers only; BS 116-148
        self.assertEqual(cols(IDS, [asc("genomic")]), ["S-1", "S-2", "S-09", "S-10"])
        self.assertEqual(cols(IDS, [desc("genomic")]), ["S-1", "S-2", "S-09", "S-10"])

    def test_t5_heatmap_key_its_direction(self):
        # SU 415 heatmapTrackSortComparator: alphabeticalDefault(makeNumericalComparator); every value 1.0 ties
        hm = [{"profileType": "mrna_median_Zscores", "genes": ["TP53"], "isVaf": False, "values": {p + "|TP53": 1.0 for p in IDS}}]
        label = next(t.label for t in contract(IDS, [asc("genomic")], heatmap=hm).tracks if t.label.startswith("TP53 ") and t.label != "TP53")
        self.assertEqual(cols(IDS, [asc(label)], heatmap=hm), ["S-09", "S-1", "S-2", "S-10"])
        self.assertEqual(cols(IDS, [desc(label)], heatmap=hm), ["S-10", "S-2", "S-1", "S-09"])

    @unittest.skip("T6: the Python port has no mutation spectrum track (assemble.py reads MUTATION_SPECTRUM as plain text)")
    def test_t6_spectrum_key_its_direction(self):
        pass

    def test_t7_no_value_last_and_natural_sort_in_direction(self):
        # SU 254-257: no value is ±2, not flipped by PC 72-76; two no-values tie (SU 252) and go to SU 368, flipped by PC 77
        pids = ["S-2", "V-1", "S-10", "S-1", "V-2", "S-09"]
        text = dict(clinical=[{"attr": "TYPE", "values": same(["V-1", "V-2"], "x")}])
        self.assertEqual(cols(pids, [desc("TYPE")], **text), ["V-2", "V-1", "S-10", "S-2", "S-1", "S-09"])
        self.assertEqual(cols(pids, [asc("TYPE")], **text), ["V-1", "V-2", "S-09", "S-1", "S-2", "S-10"])
        num = dict(clinical=[{"attr": "TMB", "values": {p: str(i + 1) for i, p in enumerate(NUMS)}}])
        self.assertEqual(cols(IDS + NUMS, [desc("TMB")], **num), NUMS[::-1] + ["S-10", "S-2", "S-1", "S-09"])
        self.assertEqual(cols(IDS + NUMS, [asc("TMB")], **num), NUMS + ["S-09", "S-1", "S-2", "S-10"])

    def test_t8_track_key_after_genomic_decides_direction(self):
        # ours: the portal always sorts clinical before genetic (DU 217-244); the first track key decides
        self.assertEqual(cols(IDS, [asc("genomic"), desc("AGE")], **text_tie("AGE", "60")), ["S-10", "S-2", "S-1", "S-09"])

    def test_t9_explicit_id_key_as_now(self):
        # ours, unchanged: the id key compares stringToVector (BS 116-148)
        self.assertEqual(cols(IDS, [asc("id")], **text_tie()), ["S-1", "S-2", "S-09", "S-10"])
        self.assertEqual(cols(IDS, [desc("id")], **text_tie()), ["S-10", "S-09", "S-2", "S-1"])

    def test_t10_track_tie_natural_sort_genomic_tie_string_to_vector(self):
        # NS 8/31: a whole signed or decimal id is one number: -10 < -5 < 1.1 < 1.5
        # BS: "-" 45 and "." 46 are char codes: [1,46,5] < [1,46,10] < [45,5] < [45,10]
        pids = ["1.5", "-10", "1.10", "-5"]
        clin = [{"attr": "TYPE", "values": same(pids, "x")}]
        self.assertEqual(cols(pids, [asc("TYPE")], clinical=clin), ["-10", "-5", "1.10", "1.5"])
        self.assertEqual(cols(pids, [asc("genomic")], clinical=clin), ["1.5", "1.10", "-5", "-10"])
        self.assertEqual(cols(IDS, [asc("TYPE")], **text_tie()), ["S-09", "S-1", "S-2", "S-10"])
        self.assertEqual(cols(IDS, [asc("genomic")], **text_tie()), ["S-1", "S-2", "S-09", "S-10"])

    def test_t11_same_id_in_two_studies(self):
        # ours: the id without its study decides (P2 < P10, in the key's direction), then the full id ascending
        pids = ["luad_P2", "brca_P10", "luad_P10", "brca_P2"]
        kw = dict(studies=["luad", "brca"], study_of={p: p.split("_")[0] for p in pids}, clinical=[{"attr": "TYPE", "values": same(pids, "x")}])
        self.assertEqual(cols(pids, [asc("TYPE")], **kw), ["brca_P2", "luad_P2", "brca_P10", "luad_P10"])
        self.assertEqual(cols(pids, [desc("TYPE")], **kw), ["brca_P10", "luad_P10", "brca_P2", "luad_P2"])
        self.assertEqual(cols(pids, [asc("genomic")], **kw), ["brca_P2", "luad_P2", "brca_P10", "luad_P10"])

    def test_beyond_the_table_natural_sort_equal_ids_go_to_genomic_id_order(self):
        # NS 31: "1", "1.0", "1e0" all parseFloat to 1; the genetic preferred vector (SU 246, OM 2453) decides,
        # unflipped: BS [1] < [1,46,0] < [1,101,0]
        pids = ["1e0", "1.0", "1"]
        clin = [{"attr": "TYPE", "values": same(pids, "x")}]
        self.assertEqual(cols(pids, [asc("TYPE")], clinical=clin), ["1", "1.0", "1e0"])
        self.assertEqual(cols(pids, [desc("TYPE")], clinical=clin), ["1", "1.0", "1e0"])


# x10 three times, abc twice, the rest once: most frequent first is x10, abc, 9, x2, 10, x1
TEXT = {"C1": "x10", "C2": "abc", "C3": "9", "C4": "x2", "C5": "x10", "C6": "10", "C7": "x1", "C8": "abc", "C9": "x10"}
TEXT_PIDS = list(TEXT) + ["D1"]
TEXT_CLIN = [{"attr": "KIND", "values": TEXT}]


class TextTracks(unittest.TestCase):
    def test_s1_text_ascending_natural_sort(self):
        # SU 276 stringClinicalComparator: naturalSort of the values; NS 35 numbers before text; x2 < x10
        self.assertEqual(cols(TEXT_PIDS, [asc("KIND")], clinical=TEXT_CLIN), ["C3", "C6", "C2", "C8", "C7", "C4", "C1", "C5", "C9", "D1"])

    def test_s2_text_descending_reversed_no_value_last(self):
        # PC 72-77: values and id ties reversed, no value (D1) still last
        self.assertEqual(cols(TEXT_PIDS, [desc("KIND")], clinical=TEXT_CLIN), ["C9", "C5", "C1", "C4", "C7", "C8", "C2", "C6", "C3", "D1"])

    def test_s3_natural_sort_equal_values_go_to_next_key(self):
        # NS 15-16 strip surrounding spaces (" a" = "a"); NS 31 parseFloat ("1" = "1.0"); 1 < 2 < a; NEXT a < b
        pids = ["E1", "E2", "E3", "E4", "E5"]
        clin = [{"attr": "KIND", "values": {"E1": "1.0", "E2": "1", "E3": " a", "E4": "a", "E5": "2"}},
                {"attr": "NEXT", "values": {"E1": "b", "E2": "a", "E3": "b", "E4": "a", "E5": "a"}}]
        self.assertEqual(cols(pids, [asc("KIND"), asc("NEXT")], clinical=clin), ["E2", "E1", "E5", "E4", "E3"])

    def test_s4_case_sensitive(self):
        # NS 13: insensitive unset; NS 42 code units: A < B < a < b
        clin = [{"attr": "KIND", "values": {"F1": "a", "F2": "B", "F3": "b", "F4": "A", "F5": "b"}}]
        self.assertEqual(cols(["F1", "F2", "F3", "F4", "F5"], [asc("KIND")], clinical=clin), ["F4", "F2", "F1", "F3", "F5"])

    def test_s5_colours_and_legend_unchanged(self):
        c = contract(TEXT_PIDS, [asc("KIND")], clinical=TEXT_CLIN)
        t = c.track("KIND")
        self.assertEqual(list(t.categories), ["x10", "abc", "9", "x2", "10", "x1"])
        self.assertEqual([t.categories[int(t.cells[i])] if p in TEXT else None for i, p in enumerate(c.columns)],
                         [TEXT.get(p) for p in c.columns])

    def test_s6_study_track_is_a_text_track(self):
        # SU 381-399: the study names by naturalSort: brca < luad < s9 < s10
        pids = ["luad_P1", "brca_P1", "s10_P1", "s9_P1"]
        kw = dict(studies=["luad", "brca", "s10", "s9"], study_of={p: p.split("_")[0] for p in pids})
        self.assertEqual(cols(pids, [asc("Study of origin")], **kw), ["brca_P1", "luad_P1", "s9_P1", "s10_P1"])
        self.assertEqual(cols(pids, [desc("Study of origin")], **kw), ["s10_P1", "s9_P1", "luad_P1", "brca_P1"])
        self.assertEqual(list(contract(pids, [asc("Study of origin")], **kw).track("Study of origin").categories), ["luad", "brca", "s10", "s9"])

    def test_s7_derived_track_as_now(self):
        pids = ["D1", "D2", "D3", "D4"]
        der = [{"label": "treated", "pids": {"D1", "D3"}}]

        def in_set(c):
            return [1 if p in ("D1", "D3") else 0 for p in c]
        self.assertEqual(in_set(cols(pids, [asc("treated")], derived=der)), [0, 0, 1, 1])
        self.assertEqual(in_set(cols(pids, [desc("treated")], derived=der)), [1, 1, 0, 0])


class NaturalSort(unittest.TestCase):
    """style.natural_sort against javascript-natural-sort 0.7.1, on every pair recorded by test/oncoprint-sort-ties.test.ts."""

    def test_every_recorded_pair(self):
        from cohortlab import style
        with open(os.path.join(ROOT, "test", "fixtures", "golden", "natural-sort.json"), encoding="utf-8") as f:
            golden = json.load(f)
        natural_sort = getattr(style, "natural_sort", None)
        self.assertTrue(callable(natural_sort), "cohortlab.style has natural_sort")
        values, want = golden["values"], golden["cmp"]
        wrong = []
        for i, a in enumerate(values):
            for j, b in enumerate(values):
                got = natural_sort(a, b)
                if got != want[i][j]:
                    wrong.append(f"{a!r} vs {b!r}: {got}, the library {want[i][j]}")
        self.assertEqual(wrong[:25], [], f"{len(wrong)} of {len(values) ** 2} pairs differ")


if __name__ == "__main__":
    unittest.main()
