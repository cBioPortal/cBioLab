// preRankedGsea checked against gseapy (enrichment scores) and against the Python port of our
// seeded null that the diffexpr view's script carries (NES and permutation p, which no library
// can reproduce because they rest on that null) — regenerate with `uv run python/golden/gsea.py`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preRankedGsea } from "../lib/stats.ts";
import { GSEA_NULL_PY } from "../lib/views/diffexpr/method.ts";

const golden = JSON.parse(readFileSync("test/fixtures/golden/gsea.json", "utf8"));
const res = preRankedGsea(golden.ranked, golden.sets, { permutations: golden.permutations });

for (const e of golden.expected) {
  test(e.name + ": ES matches gseapy " + golden.libraries.gseapy + "; NES and p match the Python port exactly", () => {
    const r = res.find((x) => x.name === e.name)!;
    assert.ok(r, "the set was tested");
    assert.equal(r.size, e.size);
    assert.ok(Math.abs(r.es - e.esGseapy) <= 5e-5, "ES " + r.es + " vs gseapy " + e.esGseapy);
    assert.ok(Math.abs(r.nes - e.nes) <= 5e-4, "NES " + r.nes + " vs " + e.nes);
    assert.equal(r.p, e.p, "the permutation p is a ratio of counts: equal, not close");
  });
}

test("the port the diffexpr script embeds is python/golden/gsea_null.py, character for character", () => {
  assert.equal(GSEA_NULL_PY, readFileSync("python/golden/gsea_null.py", "utf8"));
});
