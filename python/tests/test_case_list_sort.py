"""The OncoPrint's "case list order" sort key (ONC-SO-3) in the Python port.

The same rows as test/oncoprint-case-list.test.ts CL6-CL7 (legacy ResultsViewOncoprint sortOrder,
ResultsViewPageStore givenSampleOrder).

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_case_list_sort.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402

PIDS = ["P1", "P2", "P3", "P4", "P5"]
RANK = {"P3": 0, "P1": 1, "P5": 2}


def contract(sort, rank=None):
    events = [{"pid": p, "gene": "TP53", "vt": "mutation", "mt": "Nonsense_Mutation"} for p in ("P5", "P4")]
    return assemble_contract(genes=["TP53"], groups=[{"name": "all", "pids": PIDS}], studies=["s"], events=events,
                             coverage=[{"pid": p, "genes": ["TP53"]} for p in PIDS], is_driver=lambda r: False,
                             annotation_source="t", clinical=[], heatmap=[], derived=[], sort=sort, line_gap=90,
                             case_list_rank=rank)


class CaseListSort(unittest.TestCase):
    def test_list_order_then_the_rest(self):
        c = contract([{"track": "caseList", "dir": "asc"}], RANK)
        self.assertEqual(c.columns, ["P3", "P1", "P5", "P4", "P2"])

    def test_descending_keeps_unlisted_last(self):
        c = contract([{"track": "caseList", "dir": "desc"}], RANK)
        self.assertEqual(c.columns, ["P5", "P1", "P3", "P4", "P2"])

    def test_refused_without_a_list(self):
        with self.assertRaisesRegex(ValueError, "user-defined case list"):
            contract([{"track": "caseList", "dir": "asc"}])

    def test_offered_only_with_a_list(self):
        self.assertTrue(contract([{"track": "genomic", "dir": "asc"}], RANK).conventions.get("caseList"))
        self.assertNotIn("caseList", contract([{"track": "genomic", "dir": "asc"}]).conventions)


if __name__ == "__main__":
    unittest.main()
