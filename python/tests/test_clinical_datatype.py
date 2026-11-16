"""A clinical track typed by its attribute's declared datatype in the Python port: case table rows D1, D2, D4.

The same cases as test/oncoprint-clinical-datatype.test.ts. Legacy source: cbioportal-frontend cd8c6df,
OU = src/shared/components/oncoprint/OncoprintUtils.ts 1421-1470: a clinical track is a number when the
attribute's datatype is NUMBER, a string when STRING; nothing looks at the values. An attribute with no
declaration keeps cBioLab's own rule (>=90% of values parse and >10 distinct).

Run from the repo root:  python/.venv/bin/python -m pytest -q python/tests/test_clinical_datatype.py
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402


def clinical_track(attr, vals, datatype=None):
    pids = ["P%02d" % (i + 1) for i in range(len(vals))]
    entry = {"attr": attr, "values": {p: v for p, v in zip(pids, vals) if v is not None}}
    if datatype is not None:
        entry["datatype"] = datatype
    c = assemble_contract(genes=["TP53"], groups=[{"name": "A", "pids": pids}], studies=["s"], events=[],
                          coverage=[{"pid": p, "genes": ["TP53"]} for p in pids], is_driver=lambda r: False,
                          annotation_source="fixture", clinical=[entry], heatmap=[], derived=[],
                          sort=[{"track": "genomic", "dir": "asc"}], line_gap=90)
    t = next(t for t in c.tracks if t.kind == "clinical" and t.label in (attr, attr + " (no data)"))
    return t, (lambda i: c.columns.index(pids[i]))


def test_d1_number_with_three_distinct_values_is_a_numeric_bar_track():
    t, col = clinical_track("N_STAGES", ["0", "1", "2", "1", "0", "2"], "NUMBER")
    assert t.meta.get("numeric") is True, "NUMBER is drawn as a number whatever its distinct count (OU 1421)"
    assert t.meta.get("bar") is True
    assert t.meta["min"] == 0 and t.meta["max"] == 2
    assert float(t.meta["values"][col(2)]) == 2
    assert "categories" not in t.meta


def test_d2_string_with_more_than_ten_numeric_values_is_categorical():
    vals = ["0.1", "0.5", "1.2", "2", "3.3", "4.1", "5", "6.8", "7.7", "9", "11", "12.5"]
    t, col = clinical_track("PSA", vals, "STRING")
    assert not t.meta.get("numeric"), "STRING is drawn as a string (OU 1455), never as bars"
    assert sorted(t.meta["categories"]) == sorted(vals), "every value is its own category"
    assert t.meta["categories"][int(t.cells[col(11)])] == "12.5"


def test_d2_d3_any_declared_datatype_but_number_is_categorical():
    vals = [str(i) for i in range(12)]
    t, _ = clinical_track("FLAG_COUNT", vals, "BOOLEAN")
    assert not t.meta.get("numeric")
    assert len(t.meta["categories"]) == 12


def test_d4_no_declaration_keeps_the_heuristic():
    many, _ = clinical_track("AGE", [str(40 + i) for i in range(12)])
    assert many.meta.get("numeric") is True, ">=90% parse and >10 distinct"
    few, _ = clinical_track("AGE", ["0", "1", "2", "1"])
    assert not few.meta.get("numeric"), "3 distinct values stay categorical without a declaration"
    assert sorted(few.meta["categories"]) == ["0", "1", "2"]


def test_d5_number_with_some_text_values_has_no_data_there():
    t, col = clinical_track("PSA_LEVEL", ["1", "unknown", "3", "N/A", "2"], "NUMBER")
    assert t.meta.get("numeric") is True
    assert t.meta["min"] == 1 and t.meta["max"] == 3
    for i in (1, 3):
        assert int(t.cells[col(i)]) == -1
        v = t.meta["values"][col(i)]  # a missing value is None in the contract (NaN before packing)
        assert v is None or math.isnan(float(v))
