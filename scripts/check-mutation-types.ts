/**
 * Live check: a gene's Mutation Type Counts table (STS-OT-3) counts what a click on its rows
 * SELECTS, over the cohort it says.
 *
 * The table's numbers come from one query (lib/explore.ts buildMutationTypeFacets) and a click's
 * cohort from a compiled genomicData MUTATION_TYPE clause (lib/cohort2.ts); nothing but this forces
 * them to agree. For every row, undrafted and under a draft, it checks that:
 *   - the row's # (samples) is exactly what its click selects, the draft kept;
 *   - its # Mut is at least its #, and the table's total is the selection's size;
 *   - the table is counted without its own filter, and with another gene's;
 *   - a type the study has no mutation of is refused by name, and matches nobody with ifHeld.
 *
 * Connection b's case is the committed fixture study (test/fixtures/peer-study, served by
 * scripts/peer-db.ts): EGFR has five types, germline rows among its missense ones; ATM has an
 * UNCALLED missense mutation (counted, as the portal counts it); STK11 has "Nonsense_Mutation" and
 * "nonsense" as two types. Connection a's are portal-checked: glioma_msk_2018 keeps its uncalled
 * mutations in a second profile (ABL1 Missense 10 / 6 on cbioportal.org), coadread KRAS 221 / 216.
 *
 * Run: node --env-file=.env.local scripts/check-mutation-types.ts
 */
import { compileCohortDef } from "../lib/cohort2.ts";
import { buildMutationTypeFacets } from "../lib/explore.ts";
import { chQuery, connById, type ChConn } from "../lib/ch.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { mutationTypesClause } from "../lib/gene-state-clauses.ts";

const CASES = [
  { conn: "b", study: "cbiolab_peer_fixture", genes: ["EGFR", "ATM", "STK11", "PTEN"], portal: null },
  { conn: "a", study: "glioma_msk_2018", genes: ["ABL1"], portal: { ABL1: { Missense_Mutation: [10, 6] } } },
  { conn: "a", study: "coadread_tcga_pan_can_atlas_2018", genes: ["KRAS"],
    portal: { KRAS: { Missense_Mutation: [221, 216], In_Frame_Ins: [1, 1], Nonsense_Mutation: [1, 1] } } },
] as const;
/** applied as the second pass over every case */
const DRAFT = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }] };

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

/** the samples a definition selects in one study */
const selects = async (def: unknown, study: string, conn: ChConn): Promise<number> => {
  const sql = compileCohortDef(def as never, { study, db: conn.db });
  return Number((await chQuery<{ n: string }>(`SELECT uniqExact(sid) AS n FROM (${sql})`, conn)).data[0].n);
};

for (const c of CASES) {
  const conn = connById(c.conn);
  if (!conn) { ok(`${c.study}: connection ${c.conn}`, false, "no such connection"); continue; }
  const facetsOf = async (draft: unknown, genes: readonly string[] = c.genes) => buildMutationTypeFacets({
    studies: [c.study], connByStudy: new Map([[c.study, conn]]), profilesByStudy: new Map([[c.study, await studyProfiles(c.study)]]),
    draft: draft as never, genes: [...genes],
  });
  const plain = await facetsOf(null);
  for (const drafted of [false, true]) {
    const tag = c.study + (drafted ? " (drafted)" : "");
    const facets = drafted ? await facetsOf(DRAFT) : plain;
    ok(`${tag}: a table for every gene`, facets.length === c.genes.length && facets.every((f) => f.rows.length > 0),
      facets.map((f) => f.gene + " " + f.rows.length + " types").join(", "));
    const bad: string[] = [];
    let checked = 0;
    const size = await selects(drafted ? DRAFT : { all: [] }, c.study, conn);
    for (const f of facets) {
      if (f.total !== size) bad.push(`${f.gene}: total ${f.total}, the selection is ${size}`);
      for (const r of f.rows) {
        const click = mutationTypesClause(f.gene, [r.type]);
        if (!("clauses" in click)) { bad.push(`${f.gene}/${r.type}: ${click.why}`); continue; }
        const got = await selects({ all: [...(drafted ? DRAFT.all : []), ...click.clauses] }, c.study, conn);
        checked++;
        if (got !== r.samples) bad.push(`${f.gene}/${r.type}: shows ${r.samples}, selects ${got}`);
        if (r.mutations < r.samples) bad.push(`${f.gene}/${r.type}: # Mut ${r.mutations} < # ${r.samples}`);
      }
      // every type at once selects the gene's mutated samples, each counted once
      const all = mutationTypesClause(f.gene, f.rows.map((r) => r.type));
      if ("clauses" in all && f.rows.length > 1) {
        const got = await selects({ all: [...(drafted ? DRAFT.all : []), ...all.clauses] }, c.study, conn);
        const most = Math.max(...f.rows.map((r) => r.samples)), sum = f.rows.reduce((n, r) => n + r.samples, 0);
        if (got < most || got > sum) bad.push(`${f.gene}: every type selects ${got}, outside [${most}, ${sum}]`);
      }
    }
    ok(`${tag}: every row selects what it shows`, bad.length === 0 && checked > 0,
      bad.length ? bad.slice(0, 3).join("; ") : `${checked} rows agree exactly`);
  }

  // the portal's numbers, where they were taken from cbioportal.org
  if (c.portal) for (const [gene, want] of Object.entries(c.portal)) {
    const f = plain.find((x) => x.gene === gene);
    const got = Object.fromEntries((f?.rows || []).map((r) => [r.type, [r.mutations, r.samples]]));
    ok(`${c.study}: ${gene} as cbioportal.org counts it`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  }

  // counted without its own filter, and with another gene's
  const [gene, other] = c.genes;
  const pick = plain[0].rows[0].type;
  const own = mutationTypesClause(gene, [pick]);
  if ("clauses" in own) {
    const self = await facetsOf({ all: own.clauses }, other ? [gene, other] : [gene]);
    const a = plain.find((f) => f.gene === gene)!, b = self.find((f) => f.gene === gene)!;
    ok(`${c.study}: ${gene}'s table survives its own filter`, a.total === b.total && JSON.stringify(a.rows) === JSON.stringify(b.rows) && b.disjunctive === true,
      `${a.total} vs ${b.total}`);
    if (other) {
      const o = self.find((f) => f.gene === other)!, size = await selects({ all: own.clauses }, c.study, conn);
      ok(`${c.study}: ${other}'s table narrows to a ${gene} filter`, o.total === size && o.total < a.total, `${o.total} = ${size} < ${a.total}`);
    }
  }

  // a type the study has no mutation of: refused by name, or nobody with ifHeld
  const typo = { kind: "genomicData", gene, profileType: "MUTATION_TYPE", values: ["Missense"] };
  let refusal = "";
  try { await selects({ all: [typo] }, c.study, conn); } catch (e) { refusal = String((e as Error).message); }
  ok(`${c.study}: an unknown mutation type is refused by name`, /no mutation in \S+ has type 'Missense'/.test(refusal), refusal.slice(0, 160));
  ok(`${c.study}: with ifHeld it matches nobody`, (await selects({ all: [{ ...typo, ifHeld: true }] }, c.study, conn)) === 0);
}

console.log(failures ? `\n${failures} mutation-type check(s) FAILED` : "\nall mutation-type checks passed");
process.exit(failures ? 1 : 0);
