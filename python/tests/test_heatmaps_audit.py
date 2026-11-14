"""OncoPrint heatmap ramps and ranges in the Python port, from the PR #200 case table (rows C, D, E).

The same cases as test/oncoprint-heatmaps-audit.test.ts. Legacy source: cbioportal-frontend cd8c6df,
OU = src/shared/components/oncoprint/OncoprintUtils.ts, RS = packages/oncoprintjs/src/js/oncoprintruleset.ts.
The patient aggregation (section A) is SQL, which the Python port does not run; its values arrive here
already aggregated, so only the track's caption of the rule is checked.

Each colour is checked on both Python paths: ramp_rgb (the value itself) and heat_rgb of the track's
drawing code (what the raster draws).

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_heatmaps_audit.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.style import STYLE, heat_rgb, ramp_rgb  # noqa: E402

EXPR, METH = "rna_seq_v2_mrna_median_Zscores", "methylation_hm450"


def heat_track(profile_type, vals, is_vaf=False, assay=False):
    pids = ["C%02d" % i for i in range(len(vals))]
    gene = "e1" if assay else "G"
    hm = {"profileType": profile_type, "genes": [gene], "isVaf": is_vaf,
          "values": {p + "|" + gene: v for p, v in zip(pids, vals) if v is not None}}
    if assay:
        hm["assay"] = True
    c = assemble_contract(genes=["G"], groups=[{"name": "all", "pids": pids}], studies=["s"], events=[],
                          coverage=[{"pid": p, "genes": ["G"]} for p in pids], is_driver=lambda r: False,
                          annotation_source="t", clinical=[], heatmap=[hm], derived=[], sort=[], line_gap=0)
    return next(t for t in c.tracks if t.kind == "heatmap")


def hexrgb(rgb):
    return "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in rgb[:3])


class Ramps(unittest.TestCase):
    def colour_case(self, ramp, profile_type, v, want, is_vaf=False):
        self.assertEqual(hexrgb(ramp_rgb(STYLE["ramps"][ramp], v)), want, "ramp_rgb")
        t = heat_track(profile_type, [v], is_vaf=is_vaf)
        # a drawn cell carries its value as one of 256 codes: within one unit per channel (ours, docs/PORTAL-PARITY.md)
        got = hexrgb(heat_rgb(t.meta, int(t.cells[0])))
        near = all(abs(int(got[i:i + 2], 16) - int(want[i:i + 2], 16)) <= 1 for i in (1, 3, 5))
        self.assertTrue(near, f"drawing code -> heat_rgb: {got} is not within one unit per channel of {want}")

    # C. rule set params (OU:220-286)
    def test_c1_generic_assay_has_no_fixed_ramp(self):
        # OU:231-232
        self.assertIsNone(heat_track("sig", [1, 4], assay=True).meta.get("ramp"))

    def test_c2_methylation_range_0_1(self):
        # OU:233-242
        for p in ["methylation_hm450", "methylation_hm27"]:
            t = heat_track(p, [0.2, 0.9])
            self.assertEqual([t.ramp, t.min, t.max], ["methylation", 0, 1], p)
        self.assertEqual(STYLE["ramps"]["methylation"], {"stops": [0, 0.35, 1], "colors": [[0, 0, 255], [255, 255, 255], [255, 0, 0]]})

    def test_c3_vaf_range_0_1(self):
        # OU:243-252
        t = heat_track("mutations", [0.2, 0.4], is_vaf=True)
        self.assertEqual([t.ramp, t.min, t.max], ["vaf", 0, 1])

    def test_c4_everything_else_expression_minus3_3(self):
        # OU:254-263
        for p in ["rna_seq_v2_mrna_median_Zscores", "rna_seq_v2_mrna", "mrna", "rppa", "rppa_Zscores",
                  "protein_quantification", "linear_CNA", "gsva_scores"]:
            t = heat_track(p, [120, 4000, -50])
            self.assertEqual([t.ramp, t.min, t.max], ["expression", -3, 3], p)

    def test_c9_never_log_scale(self):
        # OU:265-283, RS:810
        for p, vaf in [("rna_seq_v2_mrna", False), (METH, False), ("mutations", True)]:
            self.assertFalse(heat_track(p, [0.1, 0.5, 100], is_vaf=vaf).meta.get("logScale"), p)

    # D. gradient colour (RS:925-1060)
    def test_d1_expression_0_black(self):
        self.colour_case("expression", EXPR, 0, "#000000")

    def test_d2_expression_1_5(self):
        self.colour_case("expression", EXPR, 1.5, "#800000")

    def test_d3_expression_minus_1_5(self):
        self.colour_case("expression", EXPR, -1.5, "#000080")

    def test_d4_expression_ends(self):
        self.colour_case("expression", EXPR, 3, "#ff0000")
        self.colour_case("expression", EXPR, -3, "#0000ff")

    def test_d5_expression_above_range_clamped(self):
        self.colour_case("expression", EXPR, 5, "#ff0000")

    def test_d6_expression_below_range_renders_blue(self):
        self.colour_case("expression", EXPR, -5, "#0000ff")

    def test_d9_methylation_white_at_0_35(self):
        self.colour_case("methylation", METH, 0.35, "#ffffff")

    def test_d10_methylation_0_175(self):
        self.colour_case("methylation", METH, 0.175, "#8080ff")

    def test_d11_methylation_0_675_table_corrected(self):
        # legacy's doubles: interval_t = 0.5000000000000001 -> 127.4999 -> 127 (RS:965-975), not the table's #ff8080
        self.colour_case("methylation", METH, 0.675, "#ff7f7f")

    def test_d12_methylation_ends_and_clamp(self):
        self.colour_case("methylation", METH, 0, "#0000ff")
        self.colour_case("methylation", METH, 1, "#ff0000")
        self.colour_case("methylation", METH, 1.4, "#ff0000")

    def test_d13_methylation_below_range_renders_blue(self):
        self.colour_case("methylation", METH, -0.5, "#0000ff")

    def test_d14_vaf(self):
        # OU:248-251
        self.colour_case("vaf", "mutations", 0, "#f1f2b5", is_vaf=True)
        self.colour_case("vaf", "mutations", 1, "#135058", is_vaf=True)
        self.colour_case("vaf", "mutations", 0.5, "#82a187", is_vaf=True)

    def test_d17_fixed_range_ignores_data(self):
        # RS:853-866
        self.assertEqual([heat_track(EXPR, [-10, 25]).min, heat_track(EXPR, [-10, 25]).max], [-3, 3])
        self.assertEqual([heat_track(METH, [0.4, 0.6]).min, heat_track(METH, [0.4, 0.6]).max], [0, 1])

    # E. generic assay ranges (OU:378-413); colours (pivot/sortOrder, ONC-TT-8) left out in PR #200
    def test_e3_range_minus1_4(self):
        t = heat_track("sig", [-1, 4], assay=True)
        self.assertEqual([t.min, t.max], [-1, 4])

    def test_e4_nonnegative_range_includes_0(self):
        t = heat_track("sig", [1, 4], assay=True)
        self.assertEqual([t.min, t.max], [0, 4])

    def test_e4b_nonpositive_range_includes_0(self):
        t = heat_track("sig", [-4, -1], assay=True)
        self.assertEqual([t.min, t.max], [-4, 0])

    # A. the aggregation rule as the track states it (PR #200: a patient's value furthest from 0)
    def test_a12_patient_track_states_the_abs_rule(self):
        note = heat_track(EXPR, [1.0]).meta.get("note", "")
        self.assertIn("furthest from 0", note)

    @unittest.skip("D7/D8/D15/D16/D18, C3b/C5-C8, E1/E2/E5-E11: as in the TypeScript file (no counterpart, undefined legacy result, or left out in PR #200)")
    def test_skipped_rows(self):
        pass


if __name__ == "__main__":
    unittest.main()
