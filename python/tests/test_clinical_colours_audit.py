"""Audit of PR #197 (OncoPrint clinical track colours) in the Python port, from the case table.

The same rows as test/oncoprint-clinical-colours-audit.test.ts. Legacy source is
cbioportal-frontend cd8c6df: CDCU = ClinicalDataCacheUtils.ts, PU = plots/PlotUtils.ts,
COL = shared/lib/Colors.ts, RS = oncoprintjs oncoprintruleset.ts. The legacy rule is transcribed
below as an oracle, with JS Math.round (half up, floor(x + 0.5)) and not Python's round(), which
rounds .5 to even and so differs on any channel of 10 mod 20 (row 13).

Run from the repo root:  python/.venv/bin/python -m unittest python/tests/test_clinical_colours_audit.py
"""
from __future__ import annotations

import math
import os
import sys
import unittest


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))

from cohortlab.assemble import assemble_contract  # noqa: E402
from cohortlab.render import raster  # noqa: E402
from cohortlab.style import STYLE, clinical_color, reserved_color, resolve_style, track_category_color  # noqa: E402

YES, NO, FEMALE, MALE = "#1b9e77", "#d95f02", "#e0699e", "#2986e2"
LIGHT_GREY, DARK_GREY, DEFAULT_GREY = "#d3d3d3", "#a9a9a9", "#bebebe"

# COL:51-124, lower-cased
LEGACY_BASE = {
    "true": YES, "yes": YES, "positive": YES, "disease free": YES, "tumor free": YES, "living": YES, "alive": YES, "not progressed": YES,
    "false": NO, "no": NO, "negative": NO, "recurred": NO, "progressed": NO, "recurred/progressed": NO, "with tumor": NO, "deceased": NO,
    "female": FEMALE, "f": FEMALE, "male": MALE, "m": MALE, "other": DARK_GREY, "unknown": LIGHT_GREY, "na": LIGHT_GREY,
    "missense": "#008000", "inframe": "#993404", "truncating": "#000000", "fusion": "#8b00c9", "splice": "#e5802b",
    "promoter": "#00b7ce", "driver": "#008000", "vus": "#53d400",
    "1:deceased": NO, "1:recurred/progressed": NO, "1:recurred": NO, "1:progressed": NO, "1:yes": NO, "1:1": NO, "1:progression": NO,
    "1:event": NO, "1:dead of melanoma": NO, "1:dead with tumor": NO, "1:metastatic relapse": NO, "1:localized relapse": NO,
    "0:living": YES, "0:alive": YES, "0:diseasefree": YES, "0:no": YES, "0:0": YES, "0:progressionfree": YES, "0:no progression": YES,
    "0:not progressed": YES, "0:censored": YES, "0:censor": YES, "0:alive or censored": YES, "0:alive or dead tumor free": YES,
    "0:no relapse": YES, "0:progression free": YES, "0:censure": YES, "0:ned": YES,
    "wild type": DEFAULT_GREY, "no mutation": DEFAULT_GREY, "amplification": "#ff0000", "gain": "#ffb6c1", "diploid": DEFAULT_GREY,
    "unchanged": DEFAULT_GREY, "loss": "#8fd8d8", "shallow deletion": "#8fd8d8", "deep deletion": "#0000ff",
}


def _expand() -> dict[str, str]:
    """COL:131-150: the exact keys the OncoPrint path looks up."""
    m = dict(LEGACY_BASE)
    for key, color in LEGACY_BASE.items():
        ws = "".join(key.split())
        for k in (key.lower(), key.upper(), ws, ws.lower(), ws.upper(), key[0].upper() + key[1:].lower(),
                  " ".join(w[0].upper() + w[1:].lower() for w in key.split(" "))):
            m[k] = color
    return m


LEGACY_RESERVED = _expand()
D3 = ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477", "#66aa00", "#b82e2e", "#316395", "#994499",
      "#22aa99", "#aaaa11", "#6633cc", "#e67300", "#8b0707", "#651067", "#329262", "#5574a6", "#3b3eac", "#b77322", "#16d620", "#b91383",
      "#f4359e", "#9c5935", "#a9c413", "#2a778d", "#668d1c", "#bea413", "#0c5922", "#743411"]


def _darken(s: str) -> str:
    """PU:199-217, JS Math.round."""
    return "#" + "".join(format(math.floor(int(s[i:i + 2], 16) * 0.95 + 0.5), "02x") for i in (1, 3, 5))


def legacy_seq(n: int, init_used: tuple[str, ...] = ()) -> list[str]:
    """PU:219-279."""
    index, used, out = 0, set(init_used), []
    for _ in range(n):
        nxt = D3[index % len(D3)]
        while nxt in used:
            if index < len(D3):
                index += 1
                nxt = D3[index % len(D3)]
                continue
            d = _darken(nxt)
            if d == nxt:
                break
            nxt = d
        used.add(nxt)
        index += 1
        out.append(nxt)
    return out


def pid(i: int) -> str:
    return "P" + str(i).zfill(4)


def contract(values, attr="X", display=None):
    pids = [pid(i) for i in range(len(values))]
    clin = {p: v for p, v in zip(pids, values) if v is not None}
    kw = {"display": display} if display is not None else {}
    return assemble_contract(genes=["G"], groups=[{"name": "all", "pids": pids}], studies=["s"], events=[],
                             coverage=[{"pid": p, "genes": ["G"]} for p in pids], is_driver=lambda r: False, annotation_source="t",
                             clinical=[{"attr": attr, "values": clin}], heatmap=[], derived=[], sort=[], line_gap=0, **kw)


def track(c, label="X"):
    return next(t for t in c.tracks if t.label == label)


def engine_colors(values, colors=None):
    c = contract(values)
    t = track(c)
    cols = list(c.columns)
    out = []
    for i in range(len(values)):
        code = int(t.cells[cols.index(pid(i))])
        out.append(None if code < 0 else track_category_color(t, code, STYLE, colors).lower())
    return out


def engine_map(values):
    return dict(zip(values, engine_colors(values)))


def distinct(n: int) -> list[str]:
    return ["v_" + chr(97 + i % 26) + str(i // 26) for i in range(n)]


def rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def raster_column_has(values, i: int, hexes) -> bool:
    """the raster's pixel slice for column i contains each colour"""
    c = contract(values)
    n = len(values)
    w = n * 20
    img, _ = raster(c, width=w)
    j = list(c.columns).index(pid(i))
    x0, x1 = j * w // n, (j + 1) * w // n
    sl = img[:, x0 + 2:max(x0 + 3, x1 - 2), :].reshape(-1, 3)
    present = {tuple(int(v) for v in px) for px in sl}
    return all(rgb(h) in present for h in hexes)


class Oracle(unittest.TestCase):
    def test_oracle_gives_table_literals(self):
        s = legacy_seq(200)
        self.assertEqual([s[i] for i in (0, 30, 31, 32, 61, 62, 93, 199)],
                         ["#3366cc", "#743411", "#3061c2", "#d13611", "#6e3110", "#2e5cb8", "#2c57af", "#4b2696"])


class Categorical(unittest.TestCase):
    def test_01_one_value_is_3366cc(self):
        """1: one non-reserved value is #3366cc (CDCU:19-26, PU:261,275-278)"""
        self.assertEqual(engine_colors(["Adenocarcinoma"] * 3), ["#3366cc"] * 3)

    def test_01_raster_draws_3366cc(self):
        """1: the raster draws #3366cc"""
        self.assertTrue(raster_column_has(["Adenocarcinoma", "Adenocarcinoma"], 0, ["#3366cc"]))

    def test_02_equal_counts_arrival_order(self):
        """2: equal counts, arrival B, A, C -> #3366cc, #dc3912, #ff9900 (CDCU:23-26)"""
        self.assertEqual(engine_colors(["B", "A", "C"]), ["#3366cc", "#dc3912", "#ff9900"])

    def test_02_deliberate_divergence_most_frequent_first(self):
        """2: DELIBERATE DIVERGENCE (PR #197): most frequent first, not arrival order"""
        m = engine_map(["B", "A", "A", "A", "C", "C"])
        self.assertEqual([m["A"], m["C"], m["B"]], ["#3366cc", "#dc3912", "#ff9900"])

    def test_03_repeated_value_coloured_once(self):
        """3: a repeated value is one category (CDCU:24)"""
        vals = ["A", "B", "A", "A", "C", "A"]
        self.assertEqual(list(track(contract(vals)).categories), ["A", "B", "C"])
        self.assertEqual(engine_colors(vals), ["#3366cc", "#dc3912", "#3366cc", "#3366cc", "#ff9900", "#3366cc"])

    def test_04_nine_values_no_other(self):
        """4: nine values, palette[0..8], no 'Other' (CDCU:23-26)"""
        self.assertEqual(engine_colors(distinct(9)), D3[:9])

    def test_05_31st(self):
        """5: the 31st value is #743411 (PU:252)"""
        self.assertEqual(clinical_color(30), "#743411")

    def test_06_to_10_darkening(self):
        """6-10: #3061c2, #d13611, #6e3110, #2e5cb8, #2c57af (PU:262-273, PU:199-217)"""
        self.assertEqual([clinical_color(k) for k in (31, 32, 61, 62, 93)], ["#3061c2", "#d13611", "#6e3110", "#2e5cb8", "#2c57af"])
        self.assertEqual(engine_colors(distinct(63))[62], "#2e5cb8")

    def test_06_raster_draws_darkened(self):
        """6: the raster draws the 32nd value as #3061c2"""
        self.assertTrue(raster_column_has(distinct(32), 31, ["#3061c2"]))

    def test_11_200_values(self):
        """11: 200 values, the legacy sequence, 200th #4b2696 (PU:262-273)"""
        ours = [clinical_color(k) for k in range(200)]
        self.assertEqual(ours, legacy_seq(200))
        self.assertEqual(ours[199], "#4b2696")
        self.assertEqual(len(set(engine_colors(distinct(200)))), 200)

    def test_12_fixed_point(self):
        """12: a darkening fixed point (#000000) breaks the loop and reuses it (PU:270-272)"""
        S = resolve_style({"palette": {"clinical": ["#000000"]}})
        self.assertEqual([clinical_color(k, S) for k in range(3)], ["#000000"] * 3)

    def test_13_js_round_half_up(self):
        """13: 0x96 x 0.95 = 142.5 -> 143 (JS), not banker's 142: the 35th is #0f8f17, the 46th #db6d00 (PU:199-208)"""
        self.assertEqual(round(142.5), 142, "Python's round is banker's, which is why it must not be used")
        self.assertEqual(clinical_color(34), "#0f8f17")
        self.assertEqual(clinical_color(45), "#db6d00")
        self.assertEqual(engine_colors(distinct(35))[34], "#0f8f17")

    def _reserved(self, values, hexv):
        for v in values:
            self.assertEqual(LEGACY_RESERVED.get(v), hexv, "oracle " + v)
            self.assertEqual((reserved_color(v) or "").lower(), hexv, v)
        self.assertEqual(engine_colors(values + ["Zz_plain"]), [hexv] * len(values) + ["#3366cc"])

    def test_14_yes(self):
        self._reserved(["Yes", "yes", "YES"], YES)

    def test_15_no(self):
        self._reserved(["No", "no", "NO"], NO)

    def test_16_male(self):
        self._reserved(["Male", "male", "MALE", "M", "m"], MALE)

    def test_17_female(self):
        self._reserved(["Female", "F", "f", "FEMALE"], FEMALE)

    def test_14_17_raster(self):
        """14-17: the raster draws the reserved colours"""
        vals = ["Yes", "No", "Male", "Female"]
        for i, h in enumerate([YES, NO, MALE, FEMALE]):
            self.assertTrue(raster_column_has(vals, i, [h]), vals[i])

    def test_18_unknown_na(self):
        self._reserved(["Unknown", "unknown", "UNKNOWN", "NA", "na", "Na"], LIGHT_GREY)

    def test_19_other(self):
        self._reserved(["Other", "OTHER", "other"], DARK_GREY)

    def test_20_yes_words(self):
        self._reserved(["True", "TRUE", "true", "Positive", "Living", "Alive", "Disease Free", "Tumor Free", "Not Progressed"], YES)

    def test_21_no_words(self):
        self._reserved(["False", "Negative", "Recurred", "Progressed", "With Tumor", "Deceased"], NO)

    def test_21_table_correction_recurred_progressed(self):
        """21 (ours, docs/PORTAL-PARITY.md): reserved values match ignoring case and spaces; the portal reserves only its exact spellings"""
        self.assertIsNone(LEGACY_RESERVED.get("Recurred/Progressed"))
        self.assertEqual(engine_colors(["Recurred/Progressed", "Recurred/progressed"]), [NO, NO])

    def test_22_survival_event(self):
        """22: 1:DECEASED, 1:deceased, 1:1, 1:EVENT -> #d95f02 (COL:89-100)"""
        for v in ["1:DECEASED", "1:deceased", "1:1", "1:EVENT"]:
            self.assertEqual((reserved_color(v) or "").lower(), NO, v)

    def test_22_table_correction(self):
        """22: TABLE CORRECTION - '1:Recurred', '1:Event' are not legacy keys (COL:142-147)"""
        self.assertIsNone(LEGACY_RESERVED.get("1:Recurred"))
        self.assertEqual(engine_colors(["1:Recurred", "1:Event"]), [NO, NO])  # ours, as 21

    def test_23_survival_censored(self):
        """23: 0:LIVING, 0:0, 0:NED, 0:CENSORED -> #1b9e77 (COL:102-118)"""
        for v in ["0:LIVING", "0:living", "0:0", "0:NED", "0:CENSORED"]:
            self.assertEqual((reserved_color(v) or "").lower(), YES, v)

    def test_23_table_correction(self):
        """23: TABLE CORRECTION - '0:DiseaseFree', '0:Censored' are not legacy keys (COL:131-150)"""
        self.assertIsNone(LEGACY_RESERVED.get("0:Censored"))
        self.assertEqual(engine_colors(["0:DiseaseFree", "0:Censored"]), [YES, YES])  # ours, as 21

    def test_24_alteration_words(self):
        """24: mutation/CNA words (COL:80-87,120-128)"""
        want = [("Missense", "#008000"), ("Inframe", "#993404"), ("Truncating", "#000000"), ("Fusion", "#8b00c9"), ("Splice", "#e5802b"),
                ("Promoter", "#00b7ce"), ("Driver", "#008000"), ("VUS", "#53d400"), ("Wild Type", DEFAULT_GREY), ("No Mutation", DEFAULT_GREY),
                ("Diploid", DEFAULT_GREY), ("Unchanged", DEFAULT_GREY), ("Amplification", "#ff0000"), ("Gain", "#ffb6c1"), ("Loss", "#8fd8d8"),
                ("Shallow Deletion", "#8fd8d8"), ("Deep Deletion", "#0000ff")]
        self.assertEqual(engine_colors([v for v, _ in want]), [h for _, h in want])

    def test_25_mixed_case_not_reserved(self):
        """25: 'yEs', 'mAle', 'Unknown ' are not reserved (COL:131-150, CDCU:24)"""
        self.assertEqual(engine_colors(["yEs", "mAle", "Unknown "]), [YES, MALE, reserved_color("Unknown").lower()])  # ours, as 21

    def test_26_spaceless_camel_not_reserved(self):
        """26: 'DiseaseFree', 'NotProgressed' are not reserved (COL:136-139)"""
        self.assertEqual(engine_colors(["DiseaseFree", "NotProgressed"]), [YES, YES])  # ours, as 21

    def test_27_disease_free_variants_reserved(self):
        """27: 'Disease free', 'DISEASE FREE', 'diseasefree', 'DISEASEFREE' reserved (COL:132-145)"""
        self.assertEqual(engine_colors(["Disease free", "DISEASE FREE", "diseasefree", "DISEASEFREE"]), [YES] * 4)

    def test_28_whitespace_not_reserved(self):
        """28: ' Yes', 'Yes ' are their own categories with palette colours (CDCU:24)"""
        vals = ["Yes", " Yes", "Yes "]
        self.assertEqual(len(track(contract(vals)).categories), 3)
        self.assertEqual(engine_colors(vals), [YES, YES, YES])  # ours, as 21

    def test_29_case_whitespace_distinct(self):
        """29: 'Stage I', 'stage I', 'Stage I ' are three categories (CDCU:23-26)"""
        self.assertEqual(engine_colors(["Stage I", "stage I", "Stage I "]), ["#3366cc", "#dc3912", "#ff9900"])

    def test_30_empty_string_category(self):
        """30: '' is a category with the next palette colour (CDCU:24-25)"""
        self.assertEqual(engine_colors(["A", "", "B"]), ["#3366cc", "#dc3912", "#ff9900"])

    def test_31_no_data_is_na(self):
        """31: no data row -> NA (DU:651-659)"""
        self.assertEqual(engine_colors(["A", None, "B"]), ["#3366cc", None, "#dc3912"])

    def test_32_numbers_as_text(self):
        """32: '1', '10', '2' are categories in arrival order (CDCU:23-26)"""
        self.assertEqual(engine_colors(["1", "10", "2"]), ["#3366cc", "#dc3912", "#ff9900"])

    def test_33_no_normalising_lookup(self):
        """33: 'NOT progressed' is not reserved (COL:152-156 unused by OncoPrint)"""
        self.assertEqual(engine_colors(["NOT progressed"]), [YES])  # ours, as 21

    def test_34_comma_list_plain(self):
        """34: 'Yes, Male' is a plain category (COL:158-172 unused)"""
        self.assertEqual(engine_colors(["Yes, Male", "Female,Yes"]), ["#3366cc", "#dc3912"])

    def test_35_mixed(self):
        """35: 'Mixed' is coloured by oncoprintjs' getter: with A, B present -> #3061c2 (RS:717-723, RS:205-262)"""
        self.assertEqual(engine_map(["A", "B", "Mixed"])["Mixed"], "#3061c2")

    def test_37_user_colour(self):
        """37: a user colour overrides reserved and palette (OU:1416-1420,1457-1461)"""
        colors = {"X": {"Yes": "#123456", "Plain": "#abcdef"}}
        self.assertEqual(engine_colors(["Yes", "Plain", "Other2"], colors), ["#123456", "#abcdef", "#dc3912"])

    def test_40_palette_disjoint_from_reserved(self):
        """40: no palette colour is reserved, so the first 31 are the list verbatim (CDCU:19-21)"""
        self.assertFalse(set(D3) & set(LEGACY_RESERVED.values()))
        self.assertEqual([c.lower() for c in STYLE["palette"]["clinical"]], D3)
        self.assertEqual([clinical_color(k) for k in range(31)], D3)


if __name__ == "__main__":
    unittest.main()
