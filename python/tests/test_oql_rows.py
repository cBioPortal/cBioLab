"""A gene row's OQL in the Python package: the local-tables path refuses it (O37), and a contract
whose row carries a sublabel draws it as the TypeScript renderers do (O38, invariant 8).

Legacy source (cbioportal-frontend at cd8c6df): packages/oncoprintjs/src/js/oncoprintlabelview.ts
343-356 (sublabels after the label, not bold, rgb(166,166,166), when "Show OQL filters" is on) and
259-268 / 508-510 (shortened past 18 characters: the first 15 and "...").

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_oql_rows.py -v
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

EVENTS = "patient\tgene\ttype\nP1\tKRAS\tMISSENSE\nP2\tKRAS\tAMP\nP2\tTP53\tTRUNC\n"


def _contract(sublabel: str | None, display: dict | None = None):
    from cohortlab.contract import DEFAULT_DISPLAY, Contract, Track
    meta = {"altered": 1, "profiled": 2, "freqPct": 50.0}
    if sublabel is not None:
        meta["sublabel"] = sublabel
    tracks = [Track("gene", "KRAS", np.asarray([64, 0], dtype=np.int32), meta),
              Track("gene", "TP53", np.asarray([0, 1], dtype=np.int32), {"altered": 1, "profiled": 2, "freqPct": 50.0})]
    return Contract("s", ["s"], [{"name": "all", "start": 0, "count": 2}], ["P1", "P2"], tracks, {}, {}, "patient",
                    {**DEFAULT_DISPLAY, **(display or {})})


def _texts(c, **kw):
    """Every text the matplotlib figure draws: (text, colour as #rrggbb, weight, x)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import to_hex
    from cohortlab.render import figure
    fig = figure(c, width=600, **kw)
    try:
        return [(t.get_text(), to_hex(t.get_color()), str(t.get_fontweight()), t.get_position()[0])
                for ax in fig.axes for t in ax.texts]
    finally:
        plt.close(fig)


class LocalTablesRefuseOql(unittest.TestCase):
    """O37: the local Oncoprinter-style path draws every alteration of a gene, so a row's OQL is refused, not dropped."""

    def test_text_gene_list_with_oql_is_refused(self):
        from cohortlab import Oncoprint
        for genes in ("KRAS: AMP", "KRAS: AMP MUT=G12D; TP53", "TP53 KRAS: MUT"):
            with self.subTest(genes=genes), self.assertRaises(ValueError):
                Oncoprint.from_tables(EVENTS, genes=genes)

    def test_list_entry_with_oql_is_refused_not_dropped(self):
        # invariant 1: an entry the path cannot honour is refused loudly; today the list form is
        # silently dropped by normalize_gene_tracks (it fails GENE_RE), leaving a figure without the row
        from cohortlab import Oncoprint
        for genes in (["KRAS: AMP"], ["TP53", "KRAS: AMP"]):
            with self.subTest(genes=genes), self.assertRaises(ValueError):
                Oncoprint.from_tables(EVENTS, genes=genes)


class SublabelData(unittest.TestCase):
    """O26/O38: what the sublabel is drawn from, without matplotlib."""

    def test_style_has_the_portal_sublabel_colour(self):
        from cohortlab.style import STYLE
        self.assertEqual(STYLE["palette"].get("sublabel"), "#a6a6a6")

    def test_sublabel_survives_opb1(self):
        back = read_opb1(write_opb1(_contract(": AMP")))
        self.assertEqual(back.tracks[0].meta.get("sublabel"), ": AMP")
        self.assertNotIn("sublabel", back.tracks[1].meta)


@unittest.skipUnless(HAVE_MPL, "cohortlab.render.figure needs matplotlib (the 'plot' extra), absent from this venv")
class Sublabels(unittest.TestCase):
    """O26/O27/O38: a gene row's sublabel, drawn by the figure after its label in the style's sublabel colour."""

    def test_figure_draws_the_sublabel_grey_after_the_label(self):
        texts = _texts(_contract(": AMP"))
        sub = [t for t in texts if t[0] == ": AMP"]
        self.assertEqual(len(sub), 1, "drew: %r" % [t[0] for t in texts])
        _, colour, weight, x = sub[0]
        self.assertEqual(colour, "#a6a6a6")
        self.assertNotIn("bold", weight)
        label = next(t for t in texts if t[0] == "KRAS")
        self.assertGreater(x, label[3], "after the label")
        self.assertEqual(sum(1 for t in texts if t[1] == "#a6a6a6"), 1, "TP53 has no sublabel")

    def test_no_sublabel_no_text(self):
        texts = _texts(_contract(None))
        self.assertFalse([t for t in texts if t[1] == "#a6a6a6" or t[0].startswith(": ")])

    def test_show_oql_false_draws_none(self):
        texts = _texts(_contract(": AMP", {"showOql": False}))
        self.assertFalse([t for t in texts if t[0] == ": AMP"], "drew: %r" % [t[0] for t in texts])

    def test_show_oql_true_draws_it(self):
        texts = _texts(_contract(": AMP", {"showOql": True}))
        self.assertEqual([t[0] for t in texts if t[0] == ": AMP"], [": AMP"])

    def test_long_sublabel_is_cut_like_a_portal_label(self):
        from cohortlab.style import track_sublabel_text
        self.assertEqual(track_sublabel_text({"sublabel": ": AMP MUT=G12D MUT=G13D"}), ": AMP MUT=G12D ...")
        self.assertEqual(track_sublabel_text({"sublabel": ": MUT=TRUNC_(1-99)"}), ": MUT=TRUNC_(1-99)", "18 characters is not cut")

    def test_sublabel_is_cut_to_the_room_before_the_pct(self):
        # ours alone: the gutter is fixed, so the figure cuts further rather than run into the row's %
        texts = _texts(_contract(": AMP MUT=G12D MUT=G13D"))
        sub = [t for t in texts if t[1] == "#a6a6a6"]
        self.assertEqual(len(sub), 1)
        self.assertTrue(sub[0][0].endswith("...") and ": AMP MUT=G12D".startswith(sub[0][0][:-3].rstrip()), sub[0][0])


class DisplayShowOql(unittest.TestCase):
    """O27: the port of normalizeDisplay keeps showOql — on by default, off kept — as the TypeScript does."""

    def test_default_and_off(self):
        from cohortlab.local import normalize_display
        self.assertIs(normalize_display(None).get("showOql"), True)
        self.assertIs(normalize_display({"showOql": False}).get("showOql"), False)
        with self.assertRaises(ValueError):
            normalize_display({"showOql": "no"})


if __name__ == "__main__":
    unittest.main()
