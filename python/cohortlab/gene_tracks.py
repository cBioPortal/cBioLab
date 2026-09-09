"""What a row of the oncoprint is — the port of lib/gene-tracks.ts.

A gene list entry is either a symbol, drawn as its own row, or a group of symbols drawn as one
merged row (cBioPortal's ``[TP53 MDM2 MDM4]``). A merged row is altered where any member is
altered and profiled where any member was profiled, so its denominator is the union of the
members' panels. Groups do not nest.
"""
from __future__ import annotations

import re
from typing import Any, NamedTuple

GENE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$")
MAX_GENE_TRACKS = 12
MAX_GENE_SYMBOLS = 32
_SEP = " \t\r\n,;"


class GeneTrack(NamedTuple):
    label: str
    members: list[str]


def _clean(g: Any) -> str:
    return str("" if g is None else g).upper().strip()


def normalize_gene_tracks(genes: Any) -> tuple[list[GeneTrack], list[str]]:
    """The rows, and the flat symbol list whose order the coverage mask bits follow."""
    tracks: list[GeneTrack] = []
    symbols: list[str] = []
    seen: set[str] = set()

    def take(g: str) -> None:
        if g not in seen:
            seen.add(g)
            symbols.append(g)

    for raw in genes or []:
        if isinstance(raw, (str, int, float)) and not isinstance(raw, bool):
            g = _clean(raw)
            if not GENE_RE.match(g):
                continue
            tracks.append(GeneTrack(g, [g]))
            take(g)
            continue
        if not isinstance(raw, dict) or not isinstance(raw.get("genes"), (list, tuple)):
            raise ValueError("gene list: an entry must be a gene symbol or {label?, genes: [...]}, got %r" % (raw,))
        if any(isinstance(m, (dict, list, tuple)) for m in raw["genes"]):
            raise ValueError("gene list: merged tracks do not nest")
        members: list[str] = []
        for m in raw["genes"]:
            g = _clean(m)
            if GENE_RE.match(g) and g not in members:
                members.append(g)
        if not members:
            raise ValueError("gene list: merged track %r has no valid gene symbols" % (raw.get("label") or raw["genes"],))
        label = str(raw["label"]).strip() if _clean(raw.get("label")) else " / ".join(members)
        tracks.append(GeneTrack(label, members))
        for m in members:
            take(m)

    labels: set[str] = set()
    for t in tracks:
        if t.label in labels:
            raise ValueError("gene list: two tracks are both labelled '%s'" % t.label)
        labels.add(t.label)
    if len(tracks) > MAX_GENE_TRACKS:
        raise ValueError("gene list: %d tracks, and %d is the most this draws" % (len(tracks), MAX_GENE_TRACKS))
    if len(symbols) > MAX_GENE_SYMBOLS:
        raise ValueError("gene list: %d distinct genes, and %d is the most panel coverage can be tracked for "
                         "(one bit per gene in a 32-bit mask)" % (len(symbols), MAX_GENE_SYMBOLS))
    return tracks, symbols


def gene_symbols(genes: Any) -> list[str]:
    """Just the symbols, flattened and deduplicated."""
    out: list[str] = []
    for raw in genes or []:
        members = [raw] if isinstance(raw, (str, int, float)) and not isinstance(raw, bool) else \
            list(raw["genes"]) if isinstance(raw, dict) and isinstance(raw.get("genes"), (list, tuple)) else []
        for m in members:
            g = _clean(m)
            if GENE_RE.match(g) and g not in out:
                out.append(g)
    return out


def to_gene_list(tracks: list[GeneTrack]) -> list[Any]:
    """The canonical authored form, so re-normalizing is a no-op."""
    return [t.members[0] if len(t.members) == 1 and t.label == t.members[0]
            else {"label": t.label, "genes": list(t.members)} for t in tracks]


def parse_gene_list(text: str) -> list[Any]:
    """cBioPortal's gene-list text: symbols, and ``["label" A B]`` for a merged row."""
    src = str(text or "")
    out: list[Any] = []
    i = 0

    def word() -> str:
        nonlocal i
        start = i
        while i < len(src) and src[i] not in _SEP and src[i] not in "[]":
            i += 1
        return src[start:i]

    while i < len(src):
        c = src[i]
        if c in _SEP:
            i += 1
            continue
        if c == "]":
            raise ValueError("gene list: a ']' with no '[' before it, at character %d" % (i + 1))
        if c == "[":
            i += 1
            label = None
            while i < len(src) and src[i] in _SEP:
                i += 1
            if i < len(src) and src[i] == '"':
                end = src.find('"', i + 1)
                if end < 0:
                    raise ValueError("gene list: a merged track's label is missing its closing quote")
                label = src[i + 1:end].strip()
                i = end + 1
            members: list[str] = []
            closed = False
            while i < len(src):
                if src[i] in _SEP:
                    i += 1
                    continue
                if src[i] == "]":
                    i += 1
                    closed = True
                    break
                if src[i] == "[":
                    raise ValueError("gene list: merged tracks do not nest")
                w = word()
                if not w:
                    break
                members.append(w)
            if not closed:
                raise ValueError("gene list: a '[' with no closing ']'")
            if not members:
                raise ValueError("gene list: an empty merged track '[]'")
            for m in members:
                _reject_per_gene_oql(m)
            out.append({"label": label, "genes": members} if label else {"genes": members})
            continue
        w = word()
        if not w:
            i += 1
            continue
        _reject_per_gene_oql(w)
        out.append(w)
    return out


def _reject_per_gene_oql(w: str) -> None:
    if ":" in w:
        raise ValueError("gene list: per-track OQL ('%s') is not supported — an oncoprint track here draws every "
                         "alteration type for its gene." % w[:24])


def format_gene_list(genes: Any) -> str:
    """The inverse of parse_gene_list."""
    parts = []
    for e in genes or []:
        if isinstance(e, (str, int, float)) and not isinstance(e, bool):
            parts.append(_clean(e))
            continue
        members = [_clean(m) for m in (e.get("genes") or [])]
        label = str(e.get("label")).strip() if _clean(e.get("label")) else ""
        prefix = '"%s" ' % label if label and label != " / ".join(members) else ""
        parts.append("[" + prefix + " ".join(members) + "]")
    return " ".join(parts)
