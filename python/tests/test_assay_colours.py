"""A generic-assay heatmap track's range and colours (ONC-TT-8) in the Python port: case table rows G1-G12, G16.

The same cases as test/oncoprint-assay-colours.test.ts. Legacy source: cbioportal-frontend cd8c6df,
OU = src/shared/components/oncoprint/OncoprintUtils.ts getGenericAssayTrackRuleSetParams (316-496),
DeU = src/shared/components/oncoprint/DeltaUtils.ts 720-749, RS = packages/oncoprintjs/src/js/oncoprintruleset.ts.

`min`, `max`, `stops`, `colors` (track meta) are compared exactly; a drawn colour, heat_rgb of a cell's
code (one of 256), within one unit per channel of the legacy colour of the cell's exact value.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_assay_colours.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.style import heat_rgb  # noqa: E402

SIG = "mutational_signatures_contribution_SBS"
EXPR, METH = "rna_seq_v2_mrna_median_Zscores", "methylation_hm450"
DB, LB, LR, DR, W = [0, 114, 178], [204, 236, 255], [255, 226, 204], [213, 94, 0], [255, 255, 255]


def contract(entities, pivot=None, sort_order=None, profile_type=SIG, assay=True):
    n = max(len(v) for v in entities.values())
    pids = ["C%02d" % i for i in range(n)]
    hm = {"profileType": profile_type, "genes": list(entities), "isVaf": False,
          "values": {pids[i] + "|" + e: v for e, vals in entities.items() for i, v in enumerate(vals) if v is not None}}
    if assay:
        hm["assay"] = True
    if pivot is not None:
        hm["pivot"] = pivot
    if sort_order is not None:
        hm["sortOrder"] = sort_order
    c = assemble_contract(genes=["G"], groups=[{"name": "all", "pids": pids}], studies=["s"], events=[],
                          coverage=[{"pid": p, "genes": ["G"]} for p in pids], is_driver=lambda r: False,
                          annotation_source="t", clinical=[], heatmap=[hm], derived=[], sort=[], line_gap=0)
    return c, pids


def heat_tracks(c):
    return [t for t in c.tracks if t.kind == "heatmap"]


def hexrgb(rgb):
    return "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in rgb[:3])


def _ch(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


class AssayColours(unittest.TestCase):
    def near(self, got, want, where):
        ok = all(abs(a - b) <= 1 for a, b in zip(_ch(got), _ch(want)))
        self.assertTrue(ok, f"{where}: {got} is not within one unit per channel of {want}")

    def shape(self, t, lo, hi, stops, colors):
        m = t.meta
        self.assertEqual([m.get("min"), m.get("max")], [lo, hi], "range [min, max]")
        self.assertEqual(list(m.get("stops") or []), stops, "stops")
        self.assertEqual([list(x)[:3] for x in (m.get("colors") or [])], colors, "colors")

    def ends(self, t, lo, hi):
        self.near(hexrgb(heat_rgb(t.meta, 0)), hexrgb(lo), "heat_rgb(code 0)")
        self.near(hexrgb(heat_rgb(t.meta, 255)), hexrgb(hi), "heat_rgb(code 255)")

    def cells(self, c, pids, entity_values, t, want):
        """each column whose value (in entity_values, by column) is a key of want is drawn within one unit"""
        col_of = {p: i for i, p in enumerate(pids)}
        seen = set()
        for j, col in enumerate(c.columns):
            i = col_of.get(col)
            if i is None:
                i = next(k for p, k in col_of.items() if col.endswith(p))
            v = entity_values[i]
            if v is None or v not in want:
                continue
            seen.add(v)
            self.near(hexrgb(heat_rgb(t.meta, int(t.cells[j]))), want[v], f"value {v}: heat_rgb of its code")
        self.assertEqual(sorted(seen), sorted(want), "every expected value was drawn")

    def case(self, vals, want, **kw):
        c, pids = contract({"e1": vals}, **kw)
        t = heat_tracks(c)[0]
        return c, pids, t, lambda: self.cells(c, pids, vals, t, want)

    def test_g1_nonnegative_white_to_dark_red(self):
        # OU 397-413
        c, pids, t, cells = self.case([1, 2, 4], {1: "#f5d7bf", 2: "#eaaf80", 4: "#d55e00"})
        self.shape(t, 0, 4, [0, 4], [W, DR])
        self.ends(t, W, DR)
        self.near(hexrgb(heat_rgb(t.meta, 128)), "#eaaf80", "heat_rgb(code 128): halfway")
        cells()

    def test_g2_negative_min_blue(self):
        # OU 427-429
        c, pids, t, cells = self.case([-1, 1.5, 4], {-1: "#0072b2", 1.5: "#66afd9", 4: "#ccecff"})
        self.shape(t, -1, 4, [-1, 4], [DB, LB])
        self.ends(t, DB, LB)
        cells()

    def test_g3_nonpositive_range_includes_0(self):
        # OU 397-401, 427
        c, pids, t, cells = self.case([-4, -2, -1], {-4: "#0072b2", -2: "#66afd9", -1: "#99ceec"})
        self.shape(t, -4, 0, [-4, 0], [DB, LB])
        self.ends(t, DB, LB)
        cells()

    def test_g4_pivot_inside_nonnegative(self):
        # OU 414-425
        c, pids, t, cells = self.case([1, 2, 3, 4], {1: "#fff1e6", 2: "#ffe2cc", 3: "#eaa066", 4: "#d55e00"}, pivot=2)
        self.shape(t, 0, 4, [0, 2, 4], [W, LR, DR])
        self.ends(t, W, DR)
        cells()

    def test_g5_pivot_at_left_end(self):
        # OU 409-413
        c, pids, t, cells = self.case([1, 4], {1: "#f5d7bf", 4: "#d55e00"}, pivot=0)
        self.shape(t, 0, 4, [0, 4], [W, DR])
        self.ends(t, W, DR)
        cells()

    def test_g6_pivot_equals_max(self):
        # OU 427-429
        c, pids, t, cells = self.case([-4, -1], {-4: "#0072b2", -1: "#99ceec"}, pivot=-1)
        self.shape(t, -4, 0, [-4, 0], [DB, LB])
        self.ends(t, DB, LB)
        cells()

    def test_g7_pivot_equals_min(self):
        # OU 430-432
        c, pids, t, cells = self.case([-4, -0.5, 3], {-4: "#ffe2cc", -0.5: "#eaa066", 3: "#d55e00"}, pivot=-4)
        self.shape(t, -4, 3, [-4, 3], [LR, DR])
        self.ends(t, LR, DR)
        cells()

    def test_g8_pivot_inside_blue_to_red(self):
        # OU 433-464
        c, pids, t, cells = self.case([-4, -1.5, 0.9, 2, 3],
                                      {-4: "#0072b2", -1.5: "#66afd9", 0.9: "#c8eafd", 2: "#eaa066", 3: "#d55e00"}, pivot=1)
        self.shape(t, -4, 3, [-4, 1, 1, 3], [DB, LB, LR, DR])
        self.ends(t, DB, DR)
        cells()

    @unittest.expectedFailure  # a cell carries its value as one of 256 codes; the code nearest the pivot can fall on its other side (docs/PORTAL-PARITY.md)
    def test_g8_value_at_repeated_stop_is_light_red(self):
        # RS 965-990, BS 13-16: binarysearch hits index 2 of [-4, 1, 1, 3]; interval_t 0 -> colors[2]
        c, pids, t, cells = self.case([-4, 1, 3], {1: "#ffe2cc"}, pivot=1)
        cells()

    def test_g9_pivot_widens_max(self):
        # OU 393-396, 427
        c, pids, t, cells = self.case([-4, -2], {-4: "#0072b2", -2: "#2d8dc3"}, pivot=5)
        self.shape(t, -4, 5, [-4, 5], [DB, LB])
        self.ends(t, DB, LB)
        cells()

    def test_g10_desc_reverses_blue(self):
        # OU 467-470
        c, pids, t, cells = self.case([-1, 1.5, 4], {-1: "#ccecff", 1.5: "#66afd9", 4: "#0072b2"}, sort_order="DESC")
        self.shape(t, -1, 4, [-1, 4], [LB, DB])
        self.ends(t, LB, DB)
        cells()

    def test_g11_desc_reverses_white_red(self):
        # OU 467-470
        c, pids, t, cells = self.case([1, 2, 4], {1: "#e08640", 2: "#eaaf80", 4: "#ffffff"}, sort_order="DESC")
        self.shape(t, 0, 4, [0, 4], [DR, W])
        self.ends(t, DR, W)
        cells()
        _, _, asc, _ = self.case([1, 4], {}, sort_order="ASC")
        self.shape(asc, 0, 4, [0, 4], [W, DR])

    def test_g12_profile_wide_range(self):
        # DeU 720-749
        ents = {"eA": [1, 2], "eB": [5, 8]}
        c, pids = contract(ents)
        ts = heat_tracks(c)
        self.assertEqual(len(ts), 2)

        def find(e):
            return next(t for t in ts if t.meta.get("gene") == e or e in t.label)
        a, b = find("eA"), find("eB")
        self.shape(a, 0, 8, [0, 8], [W, DR])
        self.shape(b, 0, 8, [0, 8], [W, DR])
        self.cells(c, pids, ents["eA"], a, {1: "#faebdf", 2: "#f5d7bf"})
        self.cells(c, pids, ents["eB"], b, {5: "#e59a60", 8: "#d55e00"})

    def test_g16_molecular_heatmap_unchanged(self):
        # OU 220-286: fixed ramps, no stops, pivot and sort order ignored
        for kw in ({}, {"pivot": 1, "sort_order": "DESC"}):
            c, _ = contract({"G": [-10, 0, 25]}, profile_type=EXPR, assay=False, **kw)
            e = heat_tracks(c)[0]
            self.assertEqual([e.meta.get("ramp"), e.meta.get("min"), e.meta.get("max")], ["expression", -3, 3])
            self.assertIsNone(e.meta.get("stops"))
            self.near(hexrgb(heat_rgb(e.meta, 0)), "#0000ff", "expression code 0")
            self.near(hexrgb(heat_rgb(e.meta, 255)), "#ff0000", "expression code 255")
            c, _ = contract({"G": [0.4, 0.6]}, profile_type=METH, assay=False, **kw)
            m = heat_tracks(c)[0]
            self.assertEqual([m.meta.get("ramp"), m.meta.get("min"), m.meta.get("max")], ["methylation", 0, 1])
            self.assertIsNone(m.meta.get("stops"))
        c, _ = contract({"e1": [1, 4]})
        self.assertIsNone(heat_tracks(c)[0].meta.get("ramp"), "an assay track has no fixed ramp (OU 231-232)")


if __name__ == "__main__":
    unittest.main()


class RepeatedStop(unittest.TestCase):
    def test_value_on_a_repeated_stop_takes_the_colour_after_it(self):
        from cohortlab.style import ramp_rgb
        r = {"stops": [-4, 1, 1, 3], "colors": [[0, 114, 178], [204, 236, 255], [255, 226, 204], [213, 94, 0]]}
        self.assertEqual(tuple(ramp_rgb(r, 1)), (255, 226, 204))
        self.assertEqual(tuple(ramp_rgb({"stops": [0, 0.35, 1], "colors": [[0, 0, 255], [255, 255, 255], [255, 0, 0]]}, 0.35)), (255, 255, 255))
