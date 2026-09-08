"""Cohort Lab oncoprint: the render contract in Python.

    from cohortlab import Oncoprint
    op = Oncoprint.from_tables("events.tsv", clinical="clinical.tsv")   # local data, no server
    op = Oncoprint.from_server(spec, "http://localhost:3107")            # a Cohort Lab instance
    op = Oncoprint.from_file("fig.opb1")                                 # a saved contract
    op.frequencies(); op.to_tsv("cells.tsv"); op.save("fig.png", width=1400)
"""
from .contract import Contract, read_opb1, write_opb1, BITS, NOT_PROFILED
from .assemble import assemble_contract
from .local import local_input, parse_tsv
from .api import Oncoprint

__all__ = ["Oncoprint", "Contract", "read_opb1", "write_opb1", "assemble_contract", "local_input", "parse_tsv", "BITS", "NOT_PROFILED"]
