"""Audit of PR #192 in the Python port: the OncoPrint gutter % against the parity case table (rows 1-28).

The same cases and expectations as test/oncoprint-numbers-audit.test.ts, cited to cbioportal-frontend
cd8c6df: OU = src/shared/components/oncoprint/OncoprintUtils.ts (percentAltered 857-876),
TIV = packages/oncoprintjs/src/js/oncoprinttrackinfoview.ts (on-screen reformat 80-97). The legacy
on-screen gutter is double-rounded under 3 %: toFixed(1) (a trailing ".0" dropped), then parseFloat +
Math.round, "<1" for 0 < x < 1. Each row runs twice: format_gutter_pct fed the counts, and
assemble_contract's track counts fed to format_gutter_pct. The "any %" (after " / ") is compared;
cBioLab's driver % beside it is a deliberate documented divergence (row 28).

The renderer (cohortlab.render: SVG/PNG, gap labels) needs matplotlib, which this venv lacks, so the
SVG (29-32) and gap-label (33-37) rows are skipped here. The header rows (38-49) are TypeScript only.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_numbers_audit.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.style import format_gutter_pct  # noqa: E402


def ids(n: int) -> list[str]:
    return ["P%05d" % i for i in range(n)]


def mut(pid: str, gene: str = "G") -> dict:
    return {"pid": pid, "gene": gene, "vt": "mutation", "mt": "Missense_Mutation"}


def any_part(s: str) -> str:
    return s.split(" / ")[-1]


def contract(n, profiled, altered, genes=None, coverage=None, events=None, driver=0):
    pids = ids(n)
    return assemble_contract(
        genes=genes or ["G"], groups=[{"name": "all", "pids": pids}], studies=["s"],
        events=events if events is not None else [mut(p) for p in pids[:altered]],
        coverage=coverage if coverage is not None else [{"pid": p, "genes": ["G"]} for p in pids[:profiled]],
        is_driver=lambda r: pids.index(r["pid"]) < driver, annotation_source="t", clinical=[], sort=[], line_gap=0)


def engine_gutter(c) -> str:
    t = next(t for t in c.tracks if t.kind == "gene")
    return format_gutter_pct(t.meta, len(c.columns))


def style_gutter(n, profiled, altered, driver=0) -> str:
    return format_gutter_pct({"driverAltered": driver, "altered": altered, "profiled": profiled}, n)


# (row, case, n, profiled, altered, expected any %)
ROWS = [
    (1, "0 profiled: N/P (OU 858-860; TIV 86-88)", 50, 0, 0, "N/P"),
    (2, "0 of 50 (OU 869-873)", 50, 50, 0, "0%"),
    (3, "50 of 50 (OU 874-875)", 50, 50, 50, "100%"),
    (4, "1 of 1000, 0.1 % (OU 866; TIV 91)", 1000, 1000, 1, "<1%"),
    (5, "ours, docs/PORTAL-PARITY.md: 1 of 2500, 0.04 %: the portal prints 0%, ours <1% (OU 866-870; TIV 90-92)", 2500, 2500, 1, "<1%"),
    (6, "ours, as 5: 1 of 3000, 0.033 % (OU 866-870; TIV 90-92)", 3000, 3000, 1, "<1%"),
    (7, "1 of 2000, 0.05 % (OU 866)", 2000, 2000, 1, "<1%"),
    (8, "3 of 2000, 0.15 % (OU 866)", 2000, 2000, 3, "<1%"),
    (9, "24 of 2500, 0.96 %: raw 1% (OU 866-870; TIV 92)", 2500, 2500, 24, "1%"),
    (10, "73 of 5000, 1.46 %: raw 1.5% then round (OU 866; TIV 92)", 5000, 5000, 73, "2%"),
    (11, "22 of 1000 (OU 866)", 1000, 1000, 22, "2%"),
    (12, "1 of 40, 2.5 % (OU 866; TIV 92)", 40, 40, 1, "3%"),
    (13, "29 of 1000 (OU 866)", 1000, 1000, 29, "3%"),
    (14, "149 of 5000, 2.98 % (OU 866-870)", 5000, 5000, 149, "3%"),
    (15, "3 of 100, exactly 3 % (OU 865, 874)", 100, 100, 3, "3%"),
    (16, "1 of 8, 12.5 % (OU 874)", 8, 8, 1, "13%"),
    (17, "7 of 8, 87.5 % (OU 874)", 8, 8, 7, "88%"),
    (18, "5 of 11 (OU 874)", 11, 11, 5, "45%"),
    (19, "50 of 99 (spec 567)", 99, 99, 50, "51%"),
    (20, "1 of 3 (spec 138)", 3, 3, 1, "33%"),
    (21, "23 of 40, IEEE 57.4999... toFixed() 57 (OU 874)", 40, 40, 23, "57%"),
    (22, "partial: 5 of 10 profiled, 20 cases (OU 1167-1174; TIV 81)", 20, 10, 5, "50%*"),
    (23, "partial under 3 %: 1 of 400 profiled, 500 cases (OU 1167-1174; TIV 91)", 500, 400, 1, "<1%*"),
]


class GutterAuditTest(unittest.TestCase):
    def test_rows_style(self) -> None:
        for row, case, n, profiled, altered, expected in ROWS:
            with self.subTest("%d: %s [style format_gutter_pct]" % (row, case)):
                self.assertEqual(any_part(style_gutter(n, profiled, altered)), expected)

    def test_rows_engine(self) -> None:
        for row, case, n, profiled, altered, expected in ROWS:
            with self.subTest("%d: %s [engine]" % (row, case)):
                self.assertEqual(any_part(engine_gutter(contract(n, profiled, altered))), expected)

    def test_24_unprofiled_altered_not_in_numerator(self) -> None:
        """24: an altered case not profiled for the gene is not counted (OU 902-905, 913-916)"""
        p = ids(10)
        c = contract(10, 5, 0, events=[mut(p[0]), mut(p[1]), mut(p[7])])
        self.assertEqual(any_part(engine_gutter(c)), "40%*")

    def test_25_patient_mode(self) -> None:
        """25: patient mode, 3 profiled patients, 1 altered (OU 907-918, 1169); columns are already patients"""
        self.assertEqual(any_part(engine_gutter(contract(3, 3, 1))), "33%")
        self.assertEqual(any_part(engine_gutter(contract(4, 3, 1))), "33%*")

    def test_26_merged_track_union(self) -> None:
        """26: merged [A B], profiled is the union of A's and B's profiled cases (OU 895-910)"""
        p = ids(10)
        cov = [{"pid": x, "genes": ["A"]} for x in p[:4]] + [{"pid": x, "genes": ["B"]} for x in p[4:8]]
        c = contract(10, 0, 0, genes=[{"label": "AB", "genes": ["A", "B"]}], coverage=cov,
                     events=[mut(p[0], "A"), mut(p[5], "B"), mut(p[8], "A")])
        self.assertEqual(any_part(engine_gutter(c)), "25%*")

    @unittest.skip("27: the tooltip lines are TypeScript only (trackTooltipLines); no Python counterpart is exported")
    def test_27_tooltip(self) -> None:
        pass

    def test_28_driver_beside_any_deliberate_divergence(self) -> None:
        """28: driver % beside any % (legacy has one number, OU 1162-1189): deliberate documented divergence, portal format each"""
        self.assertEqual(style_gutter(1000, 1000, 22, driver=5), "<1% / 2%")
        self.assertEqual(engine_gutter(contract(1000, 1000, 22, driver=5)), "<1% / 2%")

    @unittest.skip("29-37: SVG and gap labels are drawn by cohortlab.render, which needs matplotlib (absent from this venv)")
    def test_29_37_renderer(self) -> None:
        pass


if __name__ == "__main__":
    unittest.main()
