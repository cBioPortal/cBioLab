"""Local tables -> assembler input. Port of lib/oncoprint-local.ts; the formats are documented there."""
from __future__ import annotations

import re
from typing import Any

Table = list[dict[str, str]]


def parse_tsv(text: str) -> Table:
    lines = [l for l in text.splitlines() if l.strip() and not l.startswith("#")]
    if not lines:
        return []
    header = [h.strip() for h in lines[0].split("\t")]
    rows = []
    for l in lines[1:]:
        cells = l.split("\t")
        rows.append({h: (cells[i] if i < len(cells) else "").strip() for i, h in enumerate(header)})
    return rows


def _id_column(row: dict[str, str]) -> str:
    for k in row:
        if re.fullmatch(r"(patient|sample|case)(_?id)?", k, re.I):
            return k
    return next(iter(row))


_TYPE_MAP: dict[str, dict[str, Any]] = {
    "MISSENSE": {"vt": "mutation", "mt": "Missense_Mutation"},
    "INFRAME": {"vt": "mutation", "mt": "In_Frame_Del"},
    "TRUNC": {"vt": "mutation", "mt": "Nonsense_Mutation"},
    "SPLICE": {"vt": "mutation", "mt": "Splice_Site"},
    "PROMOTER": {"vt": "mutation", "mt": "Other"},
    "OTHER": {"vt": "mutation", "mt": "Other"},
    "FUSION": {"vt": "structural_variant"},
    "AMP": {"vt": "cna", "cna": 2}, "GAIN": {"vt": "cna", "cna": 1}, "HETLOSS": {"vt": "cna", "cna": -1}, "HOMDEL": {"vt": "cna", "cna": -2},
}


def _get(r: dict[str, str], *names: str) -> str:
    for n in names:
        if n in r:
            return r[n]
    return ""


def events_from_table(rows: Table) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        pid = r[_id_column(r)]
        gene = _get(r, "gene", "Gene", "GENE").upper().strip()
        typ = _get(r, "type", "Type", "TYPE").upper().strip()
        if not pid or not gene or not typ:
            continue
        driver = re.fullmatch(r"(1|true|yes|driver)", _get(r, "driver", "Driver"), re.I) is not None
        if typ.endswith("_DRIVER"):
            driver, typ = True, typ[:-7]
        if typ.endswith("_GERMLINE"):
            typ = typ[:-9]
        if typ.endswith("_DRIVER"):
            driver, typ = True, typ[:-7]
        m = _TYPE_MAP.get(typ)
        if m is None:
            raise ValueError(f"events: unknown type '{typ}' for {pid}/{gene} (accepted: {', '.join(_TYPE_MAP)}, optional _DRIVER suffix)")
        out.append({"pid": pid, "gene": gene, "vt": m["vt"], "mt": m.get("mt"), "cna": m.get("cna"), "mv": _get(r, "alteration", "Alteration"), "driver": driver})
    return out


def clinical_from_table(rows: Table) -> list[dict[str, Any]]:
    if not rows:
        return []
    id_col = _id_column(rows[0])
    out = []
    for raw in [k for k in rows[0] if k != id_col]:
        attr = re.sub(r"\((number|string|lognumber)\)\s*$", "", raw, flags=re.I).strip()
        values = {}
        for r in rows:
            v = r.get(raw)
            if v is not None and v != "" and v.upper() != "NA":
                values[r[id_col]] = v
        out.append({"attr": attr, "values": values})
    return out


def coverage_from_table(rows: Table) -> list[dict[str, Any]]:
    if not rows:
        return []
    id_col = _id_column(rows[0])
    by_pid: dict[str, list[str]] = {}
    for r in rows:
        genes = by_pid.setdefault(r[id_col], [])
        for x in re.split(r"[,;\s]+", _get(r, "genes", "gene", "Genes", "Gene")):
            if x and x.upper() not in genes:
                genes.append(x.upper())
    return [{"pid": p, "genes": g} for p, g in by_pid.items()]


def parse_sort(spec: str | list[str] | None) -> list[dict[str, str]]:
    items = spec if isinstance(spec, list) else [s.strip() for s in str(spec or "").split(",")]
    items = [s for s in items if s]
    if not items:
        return [{"track": "genomic", "dir": "asc"}]
    return [{"track": s[1:], "dir": "desc"} if s.startswith("-") else {"track": s, "dir": "asc"} for s in items]


DISPLAY_KEYS = ("showUnaltered", "whitespace", "gaps", "clinicalLegends", "colorByType", "hideVUS", "annotate", "style", "colors")
_GAP_MODES = ("none", "gaps", "pct")
_LEGEND_MODES = ("all", "none")
_ANNOTATE_MODES = ("oncokb", "none")


def normalize_display(d: dict[str, Any] | None) -> dict[str, Any]:
    """Viewing options with defaults filled in (port of normalizeDisplay in lib/oncoprint.ts)."""
    src = d or {}
    for k in src:
        if k not in DISPLAY_KEYS:
            raise ValueError(f"display: unknown option '{k}' (accepted: {', '.join(DISPLAY_KEYS)})")

    def boolean(k: str, dflt: bool) -> bool:
        v = src.get(k)
        if v is None:
            return dflt
        if not isinstance(v, bool):
            raise ValueError(f"display.{k} must be true or false")
        return v

    def one_of(k: str, allowed: tuple[str, ...], dflt: str) -> str:
        v = src.get(k)
        if v is None:
            return dflt
        if not isinstance(v, str) or v not in allowed:
            raise ValueError(f"display.{k}: '{v}' is not one of {', '.join(allowed)}")
        return v

    colors = src.get("colors")
    if colors is not None:
        if not isinstance(colors, dict):
            raise ValueError("display.colors must be {track: {value: color}}")
        for track, by_value in colors.items():
            if not isinstance(by_value, dict):
                raise ValueError(f"display.colors['{track}'] must be {{value: color}}")
            for value, color in by_value.items():
                if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                    raise ValueError(f"display.colors['{track}']['{value}']: '{color}' is not a #rrggbb colour")
    out: dict[str, Any] = {
        "showUnaltered": boolean("showUnaltered", True),
        "whitespace": boolean("whitespace", True),
        "gaps": one_of("gaps", _GAP_MODES, "none"),
        "clinicalLegends": one_of("clinicalLegends", _LEGEND_MODES, "all"),
        "colorByType": boolean("colorByType", True),
        "hideVUS": boolean("hideVUS", False),
        "annotate": one_of("annotate", _ANNOTATE_MODES, "oncokb"),
    }
    if src.get("style") is not None:
        out["style"] = src["style"]
    if colors is not None:
        out["colors"] = colors
    return out


def local_input(events: Table, clinical: Table | None = None, coverage: Table | None = None, genes: list[str] | None = None,
                group_by: str | None = None, patients: list[str] | None = None, sort: str | list[str] | None = None,
                study: str | None = None, annotation_source: str | None = None, display: dict[str, Any] | None = None,
                unit: str = "patient") -> dict[str, Any]:
    """Keyword arguments for `assemble_contract`, from local tables. Without coverage every column is covered for every gene."""
    ev = events_from_table(events)
    clin = clinical_from_table(clinical or [])
    gene_list = [g.upper() for g in (genes if genes else list(dict.fromkeys(e["gene"] for e in ev)))]
    if patients:
        pids = list(patients)
    else:
        pids = list(dict.fromkeys([e["pid"] for e in ev]
                                  + ([r[_id_column(clinical[0])] for r in clinical] if clinical else [])
                                  + ([r[_id_column(coverage[0])] for r in coverage] if coverage else [])))
    cov = coverage_from_table(coverage) if coverage else [{"pid": p, "genes": gene_list} for p in pids]
    if group_by:
        attr = next((c for c in clin if c["attr"] == group_by), None)
        if attr is None:
            raise ValueError(f"group_by: '{group_by}' is not a clinical attribute (have: {', '.join(c['attr'] for c in clin)})")
        by_val: dict[str, list[str]] = {}
        for p in pids:
            by_val.setdefault(attr["values"].get(p, "(none)"), []).append(p)
        groups = [{"name": k, "pids": v} for k, v in by_val.items()]
    else:
        groups = [{"name": "all", "pids": pids}]
    return dict(genes=gene_list, groups=groups, studies=[study or "local"], events=ev, coverage=cov,
                is_driver=lambda r: bool(r.get("driver")), annotation_source=annotation_source or "driver flags from the input",
                clinical=clin, heatmap=[], derived=[], sort=parse_sort(sort), line_gap=90, display=normalize_display(display), unit=unit)
