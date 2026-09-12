/**
 * Live check: the number a gene-status facet SHOWS equals what clicking it
 * SELECTS.
 *
 * This is the whole contract of a filterable facet, and it is easy to break in a
 * way nobody notices — the count comes from one query and the cohort from a
 * compiled clause, and nothing forces them to agree. Two ways it already broke
 * while being built:
 *
 *   - "Mutated" was counted over all altered patients and clamped to the
 *     profiled total. 7 EGFR-mutant patients in genie_public are on no panel
 *     covering EGFR, so they landed in both the mutated and the not-profiled
 *     slice. The states still summed to the cohort, and were still wrong.
 *   - "Diploid" was computed as profiled minus amplified minus deleted. One
 *     patient is amplified in one sample and deleted in another, so subtracting
 *     both removed them twice: the facet said 152,241 where the click selected
 *     152,242.
 *
 * Neither is visible in the output's shape. Only comparing the two paths finds
 * them, which is what this does.
 *
 * Run: node --env-file=.env.local scripts/check-gene-facets.ts
 */
import { compileCohortDef } from "../lib/cohort2.ts";
import { buildExplore } from "../lib/explore.ts";
import { chQuery, connById } from "../lib/ch.ts";
import { studyProfiles } from "../lib/analysis.ts";

/**
 * Genes chosen because their panel coverage differs sharply. Each case runs
 * TWICE — undrafted, and with a draft applied — because the draft predicate is
 * threaded into these queries, and a version that worked undrafted returned a
 * 400 on every drafted request. An undrafted-only check passed it.
 */
const CASES = [
  { conn: "b", study: "genie_public", genes: ["EGFR", "TP53", "FAT1"] },
  { conn: "a", study: "nsclc_ctdx_msk_2022", genes: ["EGFR", "KRAS"] }
] as const;
/** applied as the second pass over every case */
const DRAFT = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] };

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

/** must stay identical to geneStateClauses() in app/analysis/page.tsx */
const clausesFor = (gene: string, type: "MUTATION" | "CNA", state: string): unknown[] => {
  const prof = { kind: "profiled", type, gene };
  const oql = (q: string) => ({ kind: "oql", q: gene + ": " + q });
  if (state === "notProfiled") return [{ not: prof }];
  if (state === "altered") return [prof, oql("MUT")];
  if (state === "amp") return [prof, oql("AMP")];
  if (state === "del") return [prof, oql("HOMDEL")];
  return [prof, { not: oql(type === "CNA" ? "AMP HOMDEL" : "MUT") }];
};

for (const c of CASES) for (const drafted of [false, true]) {
  const conn = connById(c.conn);
  if (!conn) { ok(`${c.study}: connection ${c.conn}`, false, "no such connection"); continue; }
  const tag = c.study + (drafted ? " (drafted)" : "");
  let facets: NonNullable<Awaited<ReturnType<typeof buildExplore>>["geneFacets"]> = [];
  try {
    const res = await buildExplore({
      study: c.study, conn, geneCharts: [...c.genes],
      ...(drafted ? { draft: DRAFT as never } : {}),
      ...(await studyProfiles(c.study))
    });
    facets = res.geneFacets || [];
  } catch (e) {
    // pull the database's own complaint out; the first line is just the wrapper
    const msg = String((e as Error).message);
    const detail = (/DB::Exception: [^"\\]{0,160}/.exec(msg) || [msg.split("\n")[0]])[0];
    ok(`${tag}: facets build at all`, false, detail.slice(0, 150));
    continue;
  }
  ok(`${tag}: facets built for every requested gene`,
    facets.length === c.genes.length * 2, `${facets.length} facets for ${c.genes.length} genes`);

  const bad: string[] = [];
  let checked = 0;
  for (const f of facets) {
    for (const st of f.states) {
      const sql = compileCohortDef({
        all: [...(drafted ? DRAFT.all : []), ...clausesFor(f.gene, f.type, st.state)]
      } as never, { study: c.study, db: conn.db });
      const got = Number((await chQuery<{ n: string }>(
        `SELECT uniqExact(pid) AS n FROM (${sql})`, conn)).data[0].n);
      checked++;
      if (got !== st.n) bad.push(`${f.gene}/${f.type}/${st.state}: shows ${st.n}, selects ${got}`);
    }
    // the mutation states DO partition the cohort; the CNA states do not, and
    // the facet reports by how much they over-sum
    if (f.type === "MUTATION") {
      const sum = f.states.reduce((a, x) => a + x.n, 0);
      if (sum !== f.total) bad.push(`${f.gene}/MUTATION states sum to ${sum}, cohort is ${f.total}`);
    } else {
      const sum = f.states.reduce((a, x) => a + x.n, 0);
      const expected = f.total + (f.overlap || 0);
      if (sum !== expected)
        bad.push(`${f.gene}/CNA states sum to ${sum}, expected cohort ${f.total} + overlap ${f.overlap || 0}`);
    }
  }
  ok(`${tag}: every state selects what it shows`, bad.length === 0 && checked > 0,
    bad.length ? bad.slice(0, 3).join("; ") : `${checked} states agree exactly`);
}

// DISJUNCTIVE FACETING. A gene already constrained in the draft must still be
// counted against the draft MINUS its own clauses, or clicking "Mutated" leaves
// its facet reading 100% mutated with every alternative at 0 and no way back —
// the disappearing-options bug, which arrives by default unless handled.
for (const c of CASES) {
  const conn = connById(c.conn);
  if (!conn) continue;
  const gene = c.genes[0];
  const [plain, selfDrafted] = await Promise.all([
    buildExplore({ study: c.study, conn, geneCharts: [gene], ...(await studyProfiles(c.study)) }),
    buildExplore({
      study: c.study, conn, geneCharts: [gene], ...(await studyProfiles(c.study)),
      draft: { all: [{ kind: "profiled", type: "MUTATION", gene }, { kind: "oql", q: gene + ": MUT" }] } as never
    })
  ]);
  const of = (r: typeof plain) => (r.geneFacets || []).find((f) => f.gene === gene && f.type === "MUTATION");
  const a = of(plain), b = of(selfDrafted);
  const same = !!a && !!b && a.total === b.total &&
    a.states.every((st, i) => st.n === b.states[i].n);
  ok(`${c.study}: ${gene}'s facet survives its own selection`, same,
    a && b ? `undrafted ${a.states.map((x) => x.n).join("/")} vs self-drafted ${b.states.map((x) => x.n).join("/")}`
           : "facet missing");

  // ...while a DIFFERENT gene's facet does narrow to that draft
  const [other] = c.genes.slice(1);
  if (other) {
    const r = await buildExplore({
      study: c.study, conn, geneCharts: [other], ...(await studyProfiles(c.study)),
      draft: { all: [{ kind: "profiled", type: "MUTATION", gene }, { kind: "oql", q: gene + ": MUT" }] } as never
    });
    const f = (r.geneFacets || []).find((x) => x.gene === other && x.type === "MUTATION");
    ok(`${c.study}: ${other}'s facet DOES narrow to a ${gene} draft`,
      !!f && !!a && f.total < a.total, f && a ? `${f.total} < ${a.total}` : "facet missing");
  }
}

console.log(failures ? `\n${failures} gene-facet check(s) FAILED` : "\nall gene-facet checks passed");
process.exit(failures ? 1 : 0);
