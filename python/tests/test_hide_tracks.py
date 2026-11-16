"""The Python port honours `hideTracks` as the TypeScript engine does (case table S13; S7, S9).

An oncoprint view's `hideTracks` names the automatic rows the reader switched off ("Study of
origin", "# Samples per Patient", "Profiled for <type>"); the local assemble omits them. The
legacy source is cbioportal-frontend cd8c6df ResultsViewOncoprint.tsx 356-400: the default
tracks are removable like any clinical track. Same fixture shape as test/oncoprint-hide-tracks.test.ts.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_hide_tracks.py -v
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402

PIDS = ["s1_P1", "s1_P2", "s2_P3", "s2_P4"]


def contract(studies, **kw):
    return assemble_contract(genes=["TP53"], groups=[{"name": "all", "pids": PIDS}], studies=studies, events=[],
                             coverage=[{"pid": p, "genes": ["TP53"]} for p in PIDS], is_driver=lambda r: False,
                             annotation_source="t", clinical=[{"attr": "TYPE", "values": {p: "x" for p in PIDS}}],
                             heatmap=[], derived=[], sort=[{"track": "genomic", "dir": "asc"}], line_gap=0,
                             study_of={p: p.split("_")[0] for p in PIDS}, **kw)


def labels(c):
    return [t.label for t in c.tracks]


class HideTracks(unittest.TestCase):
    def test_s13_hidden_study_of_origin_is_not_drawn(self):
        shown = contract(["s1", "s2"])
        self.assertIn("Study of origin", labels(shown))
        hidden = contract(["s1", "s2"], hide_tracks=["Study of origin"])
        self.assertNotIn("Study of origin", labels(hidden))
        self.assertEqual(labels(hidden), [x for x in labels(shown) if x != "Study of origin"],
                         "every other row as before, in the same order")
        self.assertEqual(list(hidden.columns), list(shown.columns))

    def test_s13_s9_hiding_a_row_the_figure_would_not_draw_changes_nothing(self):
        plain = contract(["s1"])
        self.assertEqual(labels(contract(["s1"], hide_tracks=["Study of origin"])), labels(plain))

    def test_s13_empty_hide_tracks_is_the_default(self):
        self.assertEqual(labels(contract(["s1", "s2"], hide_tracks=[])), labels(contract(["s1", "s2"])))


if __name__ == "__main__":
    unittest.main()
