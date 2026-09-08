"""One object with three ways in and several ways out."""
from __future__ import annotations

import json
import urllib.request
from typing import Any

from .assemble import assemble_contract
from .contract import Contract, read_opb1, write_opb1
from .local import local_input, parse_tsv


def _read(path_or_text: str) -> str:
    if "\n" in path_or_text or "\t" in path_or_text:
        return path_or_text
    with open(path_or_text, encoding="utf-8") as f:
        return f.read()


class Oncoprint:
    def __init__(self, contract: Contract):
        self.contract = contract

    # ---- sources -------------------------------------------------------------
    @classmethod
    def from_tables(cls, events: str, clinical: str | None = None, coverage: str | None = None, **opts: Any) -> "Oncoprint":
        """Local Oncoprinter-style TSVs (paths or text). opts: genes, group_by, sort, patients, study."""
        return cls(assemble_contract(**local_input(parse_tsv(_read(events)),
                                                   parse_tsv(_read(clinical)) if clinical else None,
                                                   parse_tsv(_read(coverage)) if coverage else None, **opts)))

    @classmethod
    def from_rows(cls, **assemble_kwargs: Any) -> "Oncoprint":
        """Directly from assembler rows (see assemble_contract)."""
        return cls(assemble_contract(**assemble_kwargs))

    @classmethod
    def from_server(cls, spec: dict[str, Any], server: str = "http://localhost:3107", timeout: float = 300) -> "Oncoprint":
        """Ask a Cohort Lab instance to compile and run the spec; receive the binary contract."""
        req = urllib.request.Request(server.rstrip("/") + "/api/oncoprint?format=bin", data=json.dumps(spec).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.headers.get("Content-Type", "").startswith("application/json"):
                raise RuntimeError(json.loads(r.read()).get("error", "server error"))
            return cls(read_opb1(r.read()))

    @classmethod
    def from_file(cls, path: str) -> "Oncoprint":
        with open(path, "rb") as f:
            data = f.read()
        if path.endswith(".opb1"):
            return cls(read_opb1(data))
        return cls(Contract.from_json(json.loads(data)))

    # ---- views ----------------------------------------------------------------
    @property
    def columns(self) -> list[str]:
        return self.contract.columns

    @property
    def tracks(self) -> dict[str, Any]:
        return {t.label: t.cells for t in self.contract.tracks}

    def frequencies(self):
        return self.contract.frequencies()

    def to_frame(self):
        """pandas DataFrame, tracks × columns (pandas is optional and imported here)."""
        import pandas as pd
        rows = list(self.contract.rows())
        return pd.DataFrame([r[2:] for r in rows[1:]], index=[r[0] for r in rows[1:]], columns=rows[0][2:])

    # ---- outputs --------------------------------------------------------------
    def to_tsv(self, path: str | None = None) -> str:
        return self.contract.to_tsv(path)

    def to_json(self, path: str | None = None) -> dict[str, Any]:
        obj = self.contract.to_json()
        if path:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(obj, f)
        return obj

    def to_opb1(self, path: str) -> str:
        with open(path, "wb") as f:
            f.write(write_opb1(self.contract))
        return path

    def raster(self, width: int = 1200):
        from .render import raster
        return raster(self.contract, width=width)[0]

    def figure(self, width: int = 1200, **kw):
        from .render import figure
        return figure(self.contract, width=width, **kw)

    def save(self, path: str, width: int = 1200, **kw) -> str:
        if path.endswith(".tsv"):
            self.to_tsv(path)
            return path
        if path.endswith(".json"):
            self.to_json(path)
            return path
        if path.endswith(".opb1"):
            return self.to_opb1(path)
        from .render import save
        return save(self.contract, path, width=width, **kw)

    def __repr__(self) -> str:
        c = self.contract
        genes = ", ".join(f"{t.label} {t.meta.get('freqPct')}%" for t in c.genes())
        return f"<Oncoprint {c.n:,} columns · {len(c.tracks)} tracks · {genes}>"
