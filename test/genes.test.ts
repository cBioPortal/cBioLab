// The gene catalog behind the gene query dialog (lib/genes.ts): whether each symbol is a HUGO gene,
// an alias of one, or neither; genes and gene sets matching what is typed; a gene set's members,
// refused past the size a query takes. The warehouse is a stand-in (setChTransport) holding a few
// genes, aliases and sets, so the tests see the statements sent as well as what comes back.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.CLICKHOUSE_DB = "cbio";
const { setChTransport } = await import("../lib/ch.ts");
const { checkGenes, searchGenes, geneSetMembers, MAX_CHECK, MAX_SET_GENES } = await import("../lib/genes.ts");

/** the stand-in catalog */
const GENES: Record<string, string> = { TP53: "protein-coding", KRAS: "protein-coding", KRASP1: "pseudo", MIR21: "" };
const ALIASES: Record<string, string[]> = { P53: ["TP53"], KRAS2: ["KRAS"], AMB: ["TP53", "KRAS"], TP53: ["TP53"] };
const SETS: Record<string, { description: string; genes: string[] }> = {
  SMALL_SET: { description: "two genes", genes: ["TP53", "KRAS"] },
  BIG_SET: { description: "too many", genes: Array.from({ length: MAX_SET_GENES + 1 }, (_, i) => "G" + i) },
  EDGE_SET: { description: "exactly the limit", genes: Array.from({ length: MAX_SET_GENES }, (_, i) => "E" + i) },
};

let sent: string[] = [];
const json = (data: unknown[]) => JSON.stringify({ data, meta: [], rows: data.length });
const inList = (q: string) => [...(/IN \(([^)]*)\)/.exec(q)?.[1] ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]);
setChTransport(async (st) => {
  const q = st.query;
  sent.push(q);
  if (/FROM cbio\.gene\n/.test(q) && q.includes("IN ("))
    return json(inList(q).filter((s) => s in GENES).map((s) => ({ s, type: GENES[s] })));
  if (/FROM cbio\.gene_alias a/.test(q) && q.includes("IN ("))
    return json(inList(q).filter((a) => a in ALIASES).map((a) => ({ a, hugo: ALIASES[a] })));
  if (/FROM cbio\.gene\n/.test(q) && q.includes("startsWith")) {
    const p = /startsWith\(upper\(hugo_gene_symbol\), '([^']*)'\)/.exec(q)![1];
    return json(Object.keys(GENES).filter((s) => s.startsWith(p)).map((s) => ({ s, type: GENES[s] })));
  }
  if (/FROM cbio\.gene_alias a/.test(q)) {
    const a = /upper\(a\.gene_alias\) = '([^']*)'/.exec(q)![1];
    return json((ALIASES[a] ?? []).map((s) => ({ a, s })));
  }
  if (/FROM cbio\.geneset s\n/.test(q) && q.includes("positionCaseInsensitive")) {
    const p = /positionCaseInsensitive\(s\.name, '([^']*)'\)/.exec(q)![1].toUpperCase();
    return json(Object.entries(SETS).filter(([n]) => n.includes(p)).map(([name, s]) => ({ name, size: String(s.genes.length), description: s.description })));
  }
  if (/WHERE s\.name = /.test(q)) {
    const name = /WHERE s\.name = '((?:[^'\\]|\\.)*)'/.exec(q)![1];
    return json((SETS[name]?.genes ?? []).map((s) => ({ s })));
  }
  return json([]);
});
after(() => setChTransport(null));
beforeEach(() => { sent = []; });

test("each symbol is a gene, an alias (with the genes it stands for, sorted), or unknown", async () => {
  const r = await checkGenes(["tp53", " KRAS2 ", "AMB", "NOPE", "MIR21"]);
  assert.deepEqual(r, [
    { symbol: "TP53", status: "gene", type: "protein-coding" },
    { symbol: "KRAS2", status: "alias", hugo: ["KRAS"] },
    { symbol: "AMB", status: "alias", hugo: ["KRAS", "TP53"] },
    { symbol: "NOPE", status: "unknown" },
    { symbol: "MIR21", status: "gene", type: undefined },
  ]);
});

test("a symbol that is a gene is a gene, even when it is also some gene's alias", async () => {
  assert.deepEqual(await checkGenes(["TP53"]), [{ symbol: "TP53", status: "gene", type: "protein-coding" }]);
});

test("symbols are checked once each, upper-cased, and empty ones dropped", async () => {
  const r = await checkGenes(["kras", "KRAS", " Kras", "", "  "]);
  assert.deepEqual(r.map((x) => x.symbol), ["KRAS"]);
});

test("a symbol that cannot be a gene symbol is unknown without asking the warehouse, and never reaches SQL", async () => {
  assert.deepEqual(await checkGenes(["X'; DROP TABLE gene; --", "-LEAD"]), [
    { symbol: "X'; DROP TABLE GENE; --", status: "unknown" },
    { symbol: "-LEAD", status: "unknown" },
  ]);
  assert.equal(sent.length, 0);
  const mixed = await checkGenes(["TP53", "BAD SYMBOL"]);
  assert.deepEqual(mixed.map((x) => x.status), ["gene", "unknown"]);
  assert.ok(sent.every((q) => !q.includes("BAD SYMBOL")));
});

test("a request checks at most MAX_CHECK distinct symbols, refused with the limit named", async () => {
  const many = Array.from({ length: MAX_CHECK + 1 }, (_, i) => "G" + i);
  await assert.rejects(checkGenes(many), new RegExp("at most " + MAX_CHECK + " symbols; this has " + (MAX_CHECK + 1)));
  assert.deepEqual(sent, []);
  // duplicates are not counted twice
  assert.equal((await checkGenes([...many.slice(0, MAX_CHECK), "g0"])).length, MAX_CHECK);
});

test("search: genes starting with what is typed, an alias's gene first and marked as such", async () => {
  const r = await searchGenes("kras");
  assert.deepEqual(r.genes, [{ symbol: "KRAS", type: "protein-coding" }, { symbol: "KRASP1", type: "pseudo" }]);
  const a = await searchGenes("p53");
  assert.deepEqual(a.genes[0], { symbol: "TP53", type: "", aliasOf: "P53" });
});

test("search: an alias that is the gene's own symbol is not offered twice", async () => {
  const r = await searchGenes("TP53");
  assert.deepEqual(r.genes, [{ symbol: "TP53", type: "protein-coding" }]);
});

test("search: gene sets whose name holds what is typed, from three characters, with their size as a number", async () => {
  const r = await searchGenes("small set");
  assert.deepEqual(r.sets, [{ name: "SMALL_SET", size: 2, description: "two genes" }]);
  assert.ok(sent.some((q) => q.includes("'SMALL_SET'")), "spaces typed match the set name's underscores");
  sent = [];
  assert.deepEqual((await searchGenes("SM")).sets, []);
  assert.ok(!sent.some((q) => q.includes("geneset")), "two characters do not search gene sets");
});

test("search: what cannot be a symbol or set name returns nothing, and asks nothing", async () => {
  for (const q of ["", "  ", "'x", "-ab", "a;b", "x".repeat(41)]) assert.deepEqual(await searchGenes(q), { genes: [], sets: [] }, JSON.stringify(q));
  assert.deepEqual(sent, []);
});

test("search: a set name too long to be a symbol searches sets only", async () => {
  const r = await searchGenes("SMALL_SET_AND_MORE_THAN_TWENTY");
  assert.deepEqual(r.genes, []);
  assert.ok(!sent.some((q) => /FROM cbio\.gene\n/.test(q)));
});

test("a gene set's members, sorted as the warehouse gives them", async () => {
  assert.deepEqual(await geneSetMembers("SMALL_SET"), ["TP53", "KRAS"]);
  assert.equal((await geneSetMembers("EDGE_SET")).length, MAX_SET_GENES, "a set of exactly the limit is offered whole");
});

test("an unknown gene set is named; a set past the limit is refused with the limit named", async () => {
  await assert.rejects(geneSetMembers("NO_SUCH"), /no gene set named “NO_SUCH”/);
  await assert.rejects(geneSetMembers("BIG_SET"), new RegExp("“BIG_SET” has " + (MAX_SET_GENES + 1) + " genes; a query takes at most " + MAX_SET_GENES));
});

test("a gene set name reaches SQL only quoted", async () => {
  await assert.rejects(geneSetMembers("x' OR '1'='1"), /no gene set named/);
  assert.ok(sent.at(-1)!.includes("WHERE s.name = 'x\\' OR \\'1\\'=\\'1'"), String(sent.at(-1)));
});
