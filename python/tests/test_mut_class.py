"""A mutation's oncoprint glyph class in the Python port, case for case with the TypeScript
mutClassBit (test/oncoprint-mut-class.test.ts MC1-MC5): the portal's getOncoprintMutationType.

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_mut_class.py -v
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.abspath(os.path.join(HERE, "..", "..")), "python"))

from cohortlab.assemble import mut_class_bit  # noqa: E402
from cohortlab.style import STYLE  # noqa: E402

B = STYLE["bits"]
CASES = [
    ("5'Flank", "Promoter", "PROMOTER"), ("Missense_Mutation", "promoter", "PROMOTER"),
    ("Missense_Mutation", "G12D", "MISSENSE"), ("missense_variant", "G12D", "MISSENSE"),
    ("In_Frame_Del", "E746_A750del", "INFRAME"), ("indel", "x", "INFRAME"), ("nonframeshift_deletion", "x", "INFRAME"),
    ("Splice_Site", "X200_splice", "SPLICE"), ("Splice_Region", "x", "SPLICE"), ("splicing", "x", "SPLICE"),
    ("Nonsense_Mutation", "Q37*", "TRUNCATING"), ("stopgain_SNV", "x", "TRUNCATING"),
    ("Frame_Shift_Del", "x", "TRUNCATING"), ("Frame_Shift_Ins", "x", "TRUNCATING"), ("frameshift", "x", "TRUNCATING"),
    ("De_novo_Start_OutOfFrame", "x", "TRUNCATING"),
    ("Translation_Start_Site", "M1?", "TRUNCATING"), ("Start_Codon_SNP", "M1I", "TRUNCATING"),
    ("Nonstop_Mutation", "*1210Wext*?", "TRUNCATING"), ("Fusion", "EGFR-SEPT14", "TRUNCATING"),
    ("Silent", "x", "OTHER_MUT"), ("Intron", "x", "OTHER_MUT"), ("5'Flank", "c.-124C>T", "OTHER_MUT"),
    ("Targeted_Region", "x", "OTHER_MUT"), ("frame_shift", "x", "OTHER_MUT"), ("in_frame__del", "x", "OTHER_MUT"),
    ("TRANSLATION_START_SITE", "x", "TRUNCATING"), (None, None, "OTHER_MUT"), ("", "G12D", "OTHER_MUT"),
]


class MutClass(unittest.TestCase):
    def test_every_case(self):
        for mt, mv, want in CASES:
            with self.subTest(mt=mt, mv=mv):
                self.assertEqual(mut_class_bit(mt, mv), B[want])


if __name__ == "__main__":
    unittest.main()
