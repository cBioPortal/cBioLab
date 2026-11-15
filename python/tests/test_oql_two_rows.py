"""Two lines of one gene are two rows in the Python port (R19, invariant 8): a contract whose two
gene tracks are both labelled KRAS, told apart by their keys, is drawn as two rows, both "KRAS",
each with its own sublabel, in order.

Legacy source (cbioportal-frontend at cd8c6df): src/shared/components/oncoprint/OncoprintUtils.ts
makeGeneticTrackWith 1093-1190 (one genetic track per OQL line, labelled by its gene,
formatGeneticTrackLabel 203-210, its line the sublabel 191-201).

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_oql_two_rows.py -v
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

import numpy as np  # noqa: E402

from cohortlab import read_opb1, write_opb1  # noqa: E402

try:
    import matplotlib  # noqa: F401
    HAVE_MPL = True
except ImportError:  # the CI venv installs python[dev] only; the figure is the "plot" extra
    HAVE_MPL = False


def _contract():
    from cohortlab.contract import DEFAULT_DISPLAY, Contract, Track
    amp = {"altered": 1, "profiled": 2, "freqPct": 50.0, "key": "KRAS: AMP", "sublabel": ": AMP"}
    mut = {"altered": 1, "profiled": 2, "freqPct": 50.0, "key": "KRAS: MUT", "sublabel": ": MUT"}
    tracks = [Track("gene", "KRAS", np.asarray([0, 64], dtype=np.int32), amp),
              Track("gene", "KRAS", np.asarray([1, 0], dtype=np.int32), mut),
              Track("gene", "TP53", np.asarray([0, 1], dtype=np.int32), {"altered": 1, "profiled": 2, "freqPct": 50.0})]
    return Contract("s", ["s"], [{"name": "all", "start": 0, "count": 2}], ["P1", "P2"], tracks, {}, {}, "patient",
                    dict(DEFAULT_DISPLAY))


def _texts(c):
    """Every text the matplotlib figure draws: (text, y)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from cohortlab.render import figure
    fig = figure(c, width=600)
    try:
        return [(t.get_text(), t.get_position()[1]) for ax in fig.axes for t in ax.texts]
    finally:
        plt.close(fig)


class TwoRowsData(unittest.TestCase):
    """R19: the two KRAS rows and their keys, without matplotlib."""

    def test_keys_survive_opb1(self):
        back = read_opb1(write_opb1(_contract()))
        self.assertEqual([t.label for t in back.tracks], ["KRAS", "KRAS", "TP53"])
        self.assertEqual([t.meta.get("key") for t in back.tracks], ["KRAS: AMP", "KRAS: MUT", None])


@unittest.skipUnless(HAVE_MPL, "cohortlab.render.figure needs matplotlib (the 'plot' extra), absent from this venv")
class TwoRowsFigure(unittest.TestCase):
    """R19: the figure draws "KRAS" twice, each row with its own line, in order."""

    def test_figure_draws_kras_twice(self):
        texts = _texts(_contract())
        kras = [y for s, y in texts if s == "KRAS"]
        self.assertEqual(len(kras), 2, "drew: %r" % [s for s, _ in texts])
        self.assertNotEqual(kras[0], kras[1], "two rows, not one label drawn over another")

    def test_each_row_draws_its_own_line_in_order(self):
        texts = _texts(_contract())
        y_of = {s: y for s, y in texts if s in (": AMP", ": MUT", "TP53")}
        self.assertEqual(set(y_of), {": AMP", ": MUT", "TP53"}, "drew: %r" % [s for s, _ in texts])
        self.assertLess(y_of[": AMP"], y_of[": MUT"])
        self.assertLess(y_of[": MUT"], y_of["TP53"])


if __name__ == "__main__":
    unittest.main()
