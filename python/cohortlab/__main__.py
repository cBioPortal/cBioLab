"""python -m cohortlab: the same three sources and outputs as scripts/oncoprint-cli.ts.

  python -m cohortlab --events events.tsv [--clinical c.tsv] [--coverage cov.tsv] [--genes TP53,KRAS]
                      [--group-by CANCER_TYPE] [--sort CANCER_TYPE,-AGE] --out fig.png
  python -m cohortlab --spec spec.json --server http://localhost:3107 --out fig.svg
  python -m cohortlab --contract fig.opb1 --out cells.tsv
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from .api import Oncoprint


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="cohortlab", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--events"); p.add_argument("--clinical"); p.add_argument("--coverage")
    p.add_argument("--genes"); p.add_argument("--group-by"); p.add_argument("--sort"); p.add_argument("--patients"); p.add_argument("--study")
    p.add_argument("--spec"); p.add_argument("--server", default="http://localhost:3107")
    p.add_argument("--contract")
    p.add_argument("--display", help='viewing options as JSON, e.g. \'{"showUnaltered":false}\'')
    p.add_argument("--out"); p.add_argument("--width", type=int, default=1200); p.add_argument("--quiet", action="store_true")
    a = p.parse_args(argv)
    t0 = time.time()
    if a.contract:
        op = Oncoprint.from_file(a.contract)
    elif a.spec:
        with open(a.spec, encoding="utf-8") as f:
            op = Oncoprint.from_server(json.load(f), a.server)
    elif a.events:
        patients = None
        if a.patients:
            with open(a.patients, encoding="utf-8") as f:
                patients = [l.strip() for l in f if l.strip()]
        op = Oncoprint.from_tables(a.events, a.clinical, a.coverage, genes=a.genes.split(",") if a.genes else None,
                                   group_by=a.group_by, sort=a.sort, patients=patients, study=a.study,
                                   display=json.loads(a.display) if a.display else None)
    else:
        p.print_help()
        return 2
    if a.out:
        op.save(a.out, width=a.width)
    if not a.quiet:
        c = op.contract
        print(f"oncoprint: {c.n:,} columns · {len(c.tracks)} tracks · " + ", ".join(f'{g["name"]} ({g["count"]})' for g in c.groups)
              + f" · sort {', '.join(c.conventions.get('sort', []))} · {int((time.time() - t0) * 1000)} ms" + (f" → {a.out}" if a.out else ""))
        for t in c.genes():
            fp, dp = t.meta.get("freqPct"), t.meta.get("driverPct")
            print(f"  {t.label:<10}{('N/P' if fp is None else str(fp) + '%'):>7} any  {('N/P' if dp is None else str(dp) + '%'):>7} driver  {t.meta.get('profiled')} profiled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
