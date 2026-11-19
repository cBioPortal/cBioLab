"""The gene legend's last two entries in the Python port, case for case with the TypeScript
(test/oncoprint-gene-legend.test.ts GL1-GL4): "No alterations" whenever a gene row is drawn,
"Not profiled" only when some is not, in that order, last.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_gene_legend.py -v
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.abspath(os.path.join(HERE, "..", "..")), "python"))

from cohortlab.style import STYLE, gene_legend, glyph_presence  # noqa: E402

B = STYLE["bits"]


def labels(codes):
    return [label for label, _, _ in gene_legend(STYLE, glyph_presence(codes))]


class GeneLegendTail(unittest.TestCase):
    def test_altered_and_unaltered(self):
        out = labels([B["MISSENSE"] | B["MUT_DRIVER"], 0])
        self.assertEqual(out[-2:], ["Missense Mutation (putative driver)", "No alterations"])
        self.assertNotIn("Not profiled", out)

    def test_altered_alone_still_lists_no_alterations(self):
        self.assertEqual(labels([B["AMP"]])[-1], "No alterations")

    def test_not_profiled_after_no_alterations(self):
        self.assertEqual(labels([B["AMP"], 0, -1])[-2:], ["No alterations", "Not profiled"])

    def test_nothing_profiled_still_lists_no_alterations(self):
        # the portal counts its always rule as used whenever a gene row is drawn
        self.assertEqual(labels([-1]), ["No alterations", "Not profiled"])

    def test_derived_event_before_the_closing_two(self):
        present = {**glyph_presence([0, -1]), "derived": True}
        self.assertEqual([x[0] for x in gene_legend(STYLE, present)], ["Derived event", "No alterations", "Not profiled"])

    def test_style_listing_names_both(self):
        self.assertEqual([x[0] for x in gene_legend(STYLE)][-2:], ["No alterations", "Not profiled"])


if __name__ == "__main__":
    unittest.main()
