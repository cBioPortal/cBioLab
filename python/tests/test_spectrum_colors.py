"""Edit colours on the mutation spectrum row in the Python port, from the case table.

The same cases as test/oncoprint-spectrum-colors.test.ts. Legacy source is cbioportal-frontend cd8c6df:
OU = src/shared/components/oncoprint/OncoprintUtils.ts 1416-1475 (each of the six categories' fill is the user's
colour for that category label, under the track's own name, else MUTATION_SPECTRUM_FILLS[i], ClinicalDataCache.ts 41-48).

Run from the repo root:  python/.venv/bin/python -m pytest -q python/tests/test_spectrum_colors.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab import style  # noqa: E402
from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.render import raster  # noqa: E402

LEGACY_FILLS = ["#3D6EB1", "#8EBFDC", "#DFF1F8", "#FCE08E", "#F78F5E", "#D62B23"]
CATS = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"]
LABEL = "MUTATION_SPECTRUM"
OVERRIDE = "#000000"


def stack_color(track, j, S=None, colors=None):
    """read through the module so a missing function fails each case, not the file"""
    return style.stack_color(track, j, S if S is not None else style.STYLE, colors)


def spectrum_contract():
    pids = ["A", "B", "C"]
    spec = {"A": "1,1,1,1,1,1", "B": "2,1,3,1,1,1", "C": "1,2,1,2,1,2"}
    c = assemble_contract(genes=["TP53"], groups=[{"name": "all", "pids": pids}], studies=["s"], events=[],
                          coverage=[{"pid": p, "genes": ["TP53"]} for p in pids], is_driver=lambda r: False, annotation_source="t",
                          clinical=[{"attr": LABEL, "values": spec}], heatmap=[], derived=[], sort=[], line_gap=0)
    t = next(t for t in c.tracks if t.label == LABEL)
    assert list(t.meta["stack"]) == CATS, "the fixture has a spectrum row"
    return c, t


def rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def raster_colours(c) -> set[tuple[int, int, int]]:
    img, _ = raster(c, width=300)
    return {tuple(int(v) for v in px) for px in img.reshape(-1, 3)}


class SpectrumColours(unittest.TestCase):
    def test_c1_no_override(self):
        """C1: no override: category j is MUTATION_SPECTRUM_FILLS[j] (OU 1466-1470)"""
        _, t = spectrum_contract()
        self.assertEqual([stack_color(t, j).upper() for j in range(6)], LEGACY_FILLS)
        self.assertEqual([stack_color(t, j, style.STYLE, {}).upper() for j in range(6)], LEGACY_FILLS)
        self.assertEqual([stack_color(t, j, style.STYLE, {LABEL: {}}).upper() for j in range(6)], LEGACY_FILLS)

    def test_c2_override(self):
        """C2: an override for C>T draws C>T in it and leaves the other five (OU 1468-1474)"""
        _, t = spectrum_contract()
        got = [stack_color(t, j, style.STYLE, {LABEL: {"C>T": OVERRIDE}}).upper() for j in range(6)]
        self.assertEqual(got, [OVERRIDE if CATS[j] == "C>T" else f for j, f in enumerate(LEGACY_FILLS)])

    def test_c3_other_track(self):
        """C3: an override under another track's label has no effect on the spectrum"""
        _, t = spectrum_contract()
        colors = {"Sex": {"C>T": OVERRIDE}, "OTHER_SPECTRUM": {"C>A": OVERRIDE}}
        self.assertEqual([stack_color(t, j, style.STYLE, colors).upper() for j in range(6)], LEGACY_FILLS)

    def test_c6_raster(self):
        """C6: the Python raster draws the spectrum row in display.colors' override, the other five in the defaults"""
        c, _ = spectrum_contract()
        before = raster_colours(c)
        self.assertIn(rgb("#DFF1F8"), before, "fixture: C>T drawn in its default")
        self.assertNotIn(rgb(OVERRIDE), before, "fixture: nothing drawn in the override colour without it")
        c.display = {**(c.display or {}), "colors": {LABEL: {"C>T": OVERRIDE}}}
        after = raster_colours(c)
        self.assertIn(rgb(OVERRIDE), after, "C>T drawn in the override")
        self.assertNotIn(rgb("#DFF1F8"), after, "the default C>T colour is gone")
        for f in LEGACY_FILLS:
            if f != "#DFF1F8":
                self.assertIn(rgb(f), after, f + " still drawn")

    def test_c6_raster_other_track(self):
        """C6 with C3: another track's override changes nothing in the raster"""
        c, _ = spectrum_contract()
        before = raster(c, width=300)[0]
        c.display = {**(c.display or {}), "colors": {"Sex": {"C>T": OVERRIDE}}}
        self.assertTrue((raster(c, width=300)[0] == before).all())


if __name__ == "__main__":
    unittest.main()
