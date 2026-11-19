"""The OncoPrint's track groups (ONC-LY-1) in the Python port: the same keys and tops as the TypeScript.

Reads test/fixtures/oncoprint/track-groups.json, which test/oncoprint-rows.test.ts reads too
(legacy oncoprintjs modelutils calculateTrackAndHeaderTops; a group per heatmap profile).

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_track_groups.py
"""
from __future__ import annotations

import json
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.contract import Track  # noqa: E402
from cohortlab.render import track_group_key, track_tops  # noqa: E402

with open(os.path.join(ROOT, "test", "fixtures", "oncoprint", "track-groups.json"), encoding="utf-8") as f:
    FIX = json.load(f)


def track(d):
    meta = {k: v for k, v in d.items() if k not in ("kind", "label")}
    return Track(d["kind"], d["label"], np.zeros(1, dtype=np.int32), meta)


class TrackGroups(unittest.TestCase):
    def test_keys_as_typescript(self):
        self.assertEqual([track_group_key(track(t)) for t in FIX["tracks"]], FIX["keys"])

    def test_tops_as_typescript(self):
        self.assertEqual(track_tops([track(t) for t in FIX["tracks"]]), FIX["tops"])

    def test_a_gene_without_data_stays_in_its_profile(self):
        pids = ["P1", "P2"]
        c = assemble_contract(genes=["KRAS", "NRAS", "TP53"], groups=[{"name": "all", "pids": pids}], studies=["s"], events=[],
                              coverage=[{"pid": p, "genes": ["KRAS", "NRAS", "TP53"]} for p in pids], is_driver=lambda r: False,
                              annotation_source="t", clinical=[], derived=[], line_gap=90,
                              heatmap=[{"profileType": "mrna_zscore", "genes": ["KRAS", "NRAS", "TP53"], "isVaf": False,
                                        "values": {"P1|KRAS": 1.0, "P2|KRAS": -1.0, "P1|TP53": 0.5}}])
        heat = [t for t in c.tracks if t.kind == "heatmap" or "(no data)" in t.label]
        self.assertEqual([t.label.endswith("(no data)") for t in heat], [False, True, False])
        self.assertEqual({track_group_key(t) for t in heat}, {"heatmap:mrna_zscore"})


if __name__ == "__main__":
    unittest.main()
