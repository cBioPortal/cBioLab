// Properties that must hold for every input, not just the examples the other suites pick: each
// test states an invariant and fast-check searches for a counterexample (and shrinks any it finds
// to the smallest one). A failure prints that input; add it as an example test when fixing it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { sq } from "../lib/compiler.ts";
import { csvField } from "../lib/table-query.ts";
import { parseOql, oqlStatements } from "../lib/oql-parse.ts";
import { chooseArmValues, flattenSplits, unflattenSplits } from "../lib/partition-arms.ts";
import { kaplanMeier, logRank, benjaminiHochberg, fisherExact, type SurvRecord } from "../lib/stats.ts";
import type { CohortDef, SplitDef } from "../lib/types.ts";

/** A ClickHouse single-quoted literal read back, or null if it ends before the last character. */
function readLiteral(lit: string): string | null {
  if (lit[0] !== "'") return null;
  let out = "";
  for (let i = 1; i < lit.length; i++) {
    const ch = lit[i];
    if (ch === "\\") { out += lit[++i]; continue; }
    if (ch === "'") return i === lit.length - 1 ? out : null;
    out += ch;
  }
  return null;
}

/** One RFC 4180 field read back. */
function readCsvField(f: string): string {
  return f.startsWith('"') ? f.slice(1, -1).replace(/""/g, '"') : f;
}

describe("values reach SQL and CSV intact", () => {
  test("sq(): any string is one literal that reads back as itself, so none can end it early", () => {
    fc.assert(fc.property(fc.string({ unit: "binary" }), (s) => readLiteral(sq(s)) === s));
  });
  test("csvField(): any value is one field that reads back as itself", () => {
    fc.assert(fc.property(fc.string({ unit: "binary" }), (s) => {
      const f = csvField(s);
      if (/[",\r\n]/.test(s)) assert.match(f, /^"(?:[^"]|"")*"$/s, "quoted, with every quote doubled");
      else assert.equal(f, s);
      return readCsvField(f) === s;
    }));
  });
});

describe("the OQL parser", () => {
  const gene = fc.stringMatching(/^[A-Z][A-Z0-9]{0,7}$/);
  const token = fc.constantFrom("MUT", "AMP", "HOMDEL", "FUSION", "DRIVER", "MISSENSE", "TRUNC", "MUT_DRIVER", "MUT=V600E", "TRUNC_(1400-)", "EXP>2");
  const statement = fc.tuple(gene, fc.array(token, { maxLength: 3 })).map(([g, ts]) => ts.length ? g + ": " + ts.join(" ") : g);

  test("any input is parsed or refused with an Error, never anything else", () => {
    fc.assert(fc.property(fc.string({ maxLength: 120 }), (q) => {
      try { parseOql(q); } catch (e) { assert.ok(e instanceof Error && e.message.length > 0, "an Error that says why"); }
    }));
  });
  test("a query of valid statements gives one entry per statement, its gene upper-cased, its tokens kept", () => {
    fc.assert(fc.property(fc.array(statement, { minLength: 1, maxLength: 6 }), fc.constantFrom("; ", "\n", ", "), (stmts, sep) => {
      const entries = parseOql(stmts.join(sep));
      assert.equal(entries.length, oqlStatements(stmts.join(sep)).length);
      stmts.forEach((s, i) => {
        assert.equal(entries[i].gene, s.split(":")[0].toUpperCase());
        assert.equal(entries[i].specs.length, s.includes(":") ? s.split(": ")[1].split(" ").length : 1);
      });
    }));
  });
  test("case does not change what a query means", () => {
    fc.assert(fc.property(statement, (s) => {
      const g = s.split(":")[0];
      assert.deepEqual(parseOql(g.toLowerCase() + s.slice(g.length)), parseOql(s));
    }));
  });
});

describe("splits", () => {
  const counts = fc.uniqueArray(fc.record({ v: fc.string({ minLength: 1, maxLength: 6 }), n: fc.nat(60) }), { selector: (x) => x.v, maxLength: 20 });

  test("chooseArmValues: every value held by anyone lands in exactly one of own / pooled", () => {
    fc.assert(fc.property(counts, fc.integer({ min: 2, max: 9 }), fc.integer({ min: 1, max: 20 }), (vals, maxArms, minCount) => {
      const { own, pooled } = chooseArmValues(vals, maxArms, minCount);
      const seen = [...own, ...pooled].map((x) => x.v).sort();
      assert.deepEqual(seen, vals.filter((x) => x.n > 0).map((x) => x.v).sort());
      assert.equal(new Set(seen).size, seen.length);
    }));
  });
  test("chooseArmValues: at most maxArms-1 own arms, each held by minCount or more, none smaller than a pooled value that qualified", () => {
    fc.assert(fc.property(counts, fc.integer({ min: 2, max: 9 }), fc.integer({ min: 1, max: 20 }), (vals, maxArms, minCount) => {
      const { own, pooled } = chooseArmValues(vals, maxArms, minCount);
      assert.ok(own.length <= maxArms - 1);
      for (const o of own) assert.ok(o.n >= minCount);
      const smallestOwn = Math.min(...own.map((o) => o.n));
      for (const p of pooled) if (p.n >= minCount) assert.ok(p.n <= smallestOwn);
    }));
  });
  test("chooseArmValues: the order values arrive in does not change the arms", () => {
    fc.assert(fc.property(counts, fc.integer({ min: 2, max: 9 }), (vals, maxArms) => {
      const a = chooseArmValues(vals, maxArms, 1);
      const b = chooseArmValues([...vals].reverse(), maxArms, 1);
      assert.deepEqual(a.own, b.own);
    }));
  });

  // a split tree up to three levels deep; names never contain " / ", which joins them in a flat key
  const name = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ]{0,5}$/).filter((s) => !s.endsWith(" "));
  const where = { kind: "oql", q: "TP53: MUT" } as const;
  const split: fc.Memo<SplitDef> = fc.memo((depth) => fc.uniqueArray(name, { minLength: 1, maxLength: 3 }).chain((armNames) =>
    fc.record({
      arms: fc.tuple(...armNames.map((a) => depth > 1
        ? fc.option(fc.dictionary(name, split(depth - 1), { maxKeys: 2 }), { nil: undefined }).map((s) => ({ name: a, where, ...(s && Object.keys(s).length ? { splits: s } : {}) }))
        : fc.constant({ name: a, where }))),
    }).map((d) => d as SplitDef)));
  const cohorts = fc.dictionary(name, fc.option(fc.dictionary(name, split(3), { minKeys: 1, maxKeys: 2 }), { nil: undefined })
    .map((s): CohortDef => ({ all: [], ...(s ? { splits: s } : {}) })), { minKeys: 1, maxKeys: 3 });

  test("flattenSplits / unflattenSplits: the flat form writes back as the same tree", () => {
    // as plain JSON, the form a document arrives in
    fc.assert(fc.property(cohorts.map((c) => JSON.parse(JSON.stringify(c)) as Record<string, CohortDef>), (c) => {
      assert.deepEqual(unflattenSplits(c, flattenSplits(c)), c);
    }));
  });
});

describe("statistics", () => {
  const record = fc.record({ t: fc.integer({ min: 0, max: 120 }), event: fc.constantFrom(0, 1) });
  const records = fc.array(record, { minLength: 1, maxLength: 60 });

  test("Kaplan–Meier: S(t) starts at or below 1, never rises, never leaves [0, 1]", () => {
    fc.assert(fc.property(records, (rs) => {
      const { points } = kaplanMeier(rs);
      let prev = 1;
      for (const p of points) { assert.ok(p.s >= 0 && p.s <= prev + 1e-12, "S(" + p.t + ") = " + p.s); prev = p.s; }
    }));
  });
  test("Kaplan–Meier: the order of the records does not matter", () => {
    fc.assert(fc.property(records, (rs) => { assert.deepEqual(kaplanMeier([...rs].reverse()), kaplanMeier(rs)); }));
  });
  test("log-rank: swapping the two groups changes neither χ² nor p", () => {
    fc.assert(fc.property(records, records, (a, b) => {
      const ab = logRank([{ a, b }]), ba = logRank([{ a: b, b: a }]);
      assert.ok(Math.abs(ab.chi2 - ba.chi2) < 1e-9 && Math.abs(ab.p - ba.p) < 1e-9);
      assert.ok(ab.p >= 0 && ab.p <= 1);
    }));
  });
  test("log-rank: scaling every time by the same factor changes nothing (it reads only their order)", () => {
    fc.assert(fc.property(records, records, fc.integer({ min: 2, max: 30 }), (a, b, k) => {
      const scale = (rs: SurvRecord[]) => rs.map((r) => ({ ...r, t: r.t * k }));
      const x = logRank([{ a, b }]), y = logRank([{ a: scale(a), b: scale(b) }]);
      assert.ok(Math.abs(x.chi2 - y.chi2) < 1e-9);
    }));
  });
  test("Benjamini–Hochberg: q ≥ p, q ≤ 1, and a smaller p never gets a larger q", () => {
    fc.assert(fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 50 }), (ps) => {
      const qs = benjaminiHochberg(ps);
      assert.equal(qs.length, ps.length);
      ps.forEach((p, i) => { assert.ok(qs[i] >= p - 1e-12 && qs[i] <= 1); });
      for (let i = 0; i < ps.length; i++) for (let j = 0; j < ps.length; j++)
        if (ps[i] < ps[j]) assert.ok(qs[i] <= qs[j] + 1e-12);
    }));
  });
  test("Fisher's exact test: p in [0, 1], and the same for the table transposed or its rows swapped", () => {
    fc.assert(fc.property(fc.nat(40), fc.nat(40), fc.nat(40), fc.nat(40), (a, b, c, d) => {
      const p = fisherExact(a, b, c, d);
      assert.ok(p >= 0 && p <= 1 + 1e-12, "p = " + p);
      assert.ok(Math.abs(fisherExact(a, c, b, d) - p) < 1e-9, "transposed");
      assert.ok(Math.abs(fisherExact(c, d, a, b) - p) < 1e-9, "rows swapped");
    }));
  });
});
