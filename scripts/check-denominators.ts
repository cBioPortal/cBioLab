/**
 * Differential check on the panel-aware denominator, against the live database.
 *
 * Three things are asserted, and the last two are the ones that matter:
 *
 *   1. NUMERATOR ADDITIVITY. `altered` is a distinct-sample count and sample ids
 *      are unique across studies, so faceting each study alone and summing must
 *      equal faceting them together, exactly. That is what lets Explore pool one
 *      query per connection instead of one per study.
 *
 *      The DENOMINATOR is deliberately NOT asserted equal the same way — pooled
 *      must be LARGER. A study that profiled a gene but never saw it altered
 *      contributes no row to its own gene table, so summing per-study tables
 *      drops its profiled samples and reports a frequency biased high.
 *
 *   2. AN INDEPENDENTLY SHAPED COUNT. Internal agreement is not enough: two
 *      compensating errors agree with each other. The builder sums per-panel
 *      counts, so the denominator is also checked against a statement that
 *      counts each sample once across the whole panel set. This is the check
 *      that catches an inflated denominator — the panel table holds one row per
 *      genetic profile, and every TCGA study publishes both a discrete and a
 *      linear CNA profile, which listed each sample twice and reported every CNA
 *      frequency at half its true value (brca_tcga MYC amplification 10.6% where
 *      cBioPortal says 21.2%) until the builder counted distinct samples.
 *
 *   3. PINNED VALUES. A handful of (study, gene) denominators pinned to fixtures,
 *      so a shortcut that used a study total instead would move them.
 *
 * The studies are chosen because the denominator genuinely varies within them —
 * nsclc_ctdx_msk_2022 has 8 CNA panels, msk_ch_2020 is 73% whole-exome,
 * brca_msk_erbb2_2026 has 7 panels and no WES at all. A study with one panel
 * would pass even a badly broken implementation.
 *
 * Run: node --env-file=.env.local scripts/check-denominators.ts
 *      UPDATE_DENOM=1 ... to re-pin after an intentional change.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildExplore, buildExploreFederated, geneTables } from "../lib/explore.ts";
import { chQuery, DB, PRIMARY } from "../lib/ch.ts";
import { studyProfiles } from "../lib/analysis.ts";
import type { GeneTableRow } from "../lib/types.ts";

const STUDIES = ["nsclc_ctdx_msk_2022", "msk_ch_2020", "brca_msk_erbb2_2026", "histiocytosis_cobi_msk_2019",
  // publishes BOTH a discrete and a linear CNA profile, so every sample appears
  // twice in the panel table: the shape that halved every CNA frequency
  "brca_tcga"];
const FIXTURE = new URL("../test/fixtures/denominators.json", import.meta.url);
const UPDATE = !!process.env.UPDATE_DENOM;

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const tables = (r: Awaited<ReturnType<typeof buildExplore>>) =>
  ({ mut: r.mutatedGenes || [], cna: r.cnaGenes || [], sv: r.svGenes || [] });
const key = (r: GeneTableRow) => r.gene + "|" + (r.cna ?? "");

// ---- per study, then summed in JS -----------------------------------------
const perStudy: Record<string, ReturnType<typeof tables>> = {};
const profilesByStudy = new Map<string, { profiles: string[]; gaProfiles: string[] }>();
for (const s of STUDIES) {
  profilesByStudy.set(s, await studyProfiles(s));
  perStudy[s] = tables(await buildExplore({ study: s, ...profilesByStudy.get(s)! }));
}
const summed: Record<string, Map<string, { altered: number; profiled: number }>> = {};
for (const which of ["mut", "cna", "sv"] as const) {
  const m = new Map<string, { altered: number; profiled: number }>();
  for (const s of STUDIES) for (const r of perStudy[s][which]) {
    const cur = m.get(key(r)) || { altered: 0, profiled: 0 };
    cur.altered += r.altered; cur.profiled += r.profiled;
    m.set(key(r), cur);
  }
  summed[which] = m;
}

// ---- all studies together --------------------------------------------------
const together = tables(await buildExploreFederated({ studies: STUDIES, profilesByStudy }));

// 1. NUMERATOR additivity — exact, in both directions.
// `altered` is a distinct-sample count and sample ids are unique across studies,
// so pooling the query must return precisely what summing the per-study tables
// returns. This is the arithmetic that lets Explore pool at all.
// Compared ONE GENE AT A TIME. Both tables are cut at GENE_TABLE_LIMIT, and a
// gene inside the pooled top-N can fall outside a single study's top-N — so
// comparing the two truncated lists would measure the cut, not the arithmetic.
// Narrowing to one gene puts both sides far below the limit, and then the two
// must agree to the sample.
{
  const GENES = ["TP53", "KRAS", "BRAF", "DNMT3A", "ERBB2", "CDKN2A", "MYC", "PTEN"];
  const conn = PRIMARY;
  const bad: string[] = [];
  let checked = 0;
  for (const gene of GENES) {
    const per = await Promise.all(STUDIES.map((s) =>
      geneTables({ studies: [s], db: DB, conn, geneSearch: gene })));
    const pooled = await geneTables({ studies: STUDIES, db: DB, conn, geneSearch: gene });
    for (const which of ["mutatedGenes", "cnaGenes", "svGenes"] as const)
      for (const p of (pooled[which] || []).filter((r) => r.gene === gene)) {
        const same = (r: GeneTableRow) => r.gene === gene && (r.cna ?? null) === (p.cna ?? null);
        const sum = per.reduce((n, g) => n + ((g[which] || []).find(same)?.altered || 0), 0);
        checked++;
        if (sum !== p.altered)
          bad.push(`${gene}${p.cna != null ? "[" + p.cna + "]" : ""} ${which}: pooled ${p.altered} vs summed ${sum}`);
      }
  }
  ok("pooled numerator equals the per-study sum, gene by gene", bad.length === 0 && checked > 0,
    bad.length ? bad.slice(0, 3).join("; ") : `${checked} (gene, table) pairs agree exactly`);
}

// The DENOMINATOR is deliberately NOT asserted equal to the per-study sum: it
// must be larger. A study that profiled a gene but never saw it altered produces
// no row in its own gene table, so summing per-study tables silently drops that
// study's profiled samples and reports a frequency biased high. Pooling counts
// them. Assert the direction, so a regression that loses them again is visible.
for (const which of ["mut", "cna", "sv"] as const) {
  let checked = 0, larger = 0; const bad: string[] = [];
  for (const r of together[which]) {
    const s = summed[which].get(key(r));
    if (!s) continue;
    checked++;
    if (r.profiled < s.profiled) bad.push(`${key(r)}: pooled ${r.profiled} < summed ${s.profiled}`);
    else if (r.profiled > s.profiled) larger++;
  }
  ok(`${which}: pooled denominator never smaller than the per-study sum`, bad.length === 0 && checked > 0,
    bad.length ? bad.slice(0, 3).join("; ") : `${larger} of ${checked} recover samples the per-study sum drops`);
}

// 1b. The denominator against an INDEPENDENT query.
// Internal agreement is not enough — the builder sums per-panel counts, so it is
// checked here against a differently shaped statement that counts each sample
// once across the whole panel set. This is what catches a denominator inflated
// by the table's one-row-per-genetic-profile shape: every TCGA study publishes a
// discrete AND a linear CNA profile, which listed each sample twice and halved
// every CNA frequency until the builder counted distinct samples.
const ALT: Record<string, string> = { mut: "MUTATION_EXTENDED", cna: "COPY_NUMBER_ALTERATION", sv: "STRUCTURAL_VARIANT" };
const inList = "(" + STUDIES.map((s) => "'" + s.replace(/'/g, "''") + "'").join(",") + ")";
for (const which of ["mut", "cna", "sv"] as const) {
  // Samples on two DIFFERENT panels for one alteration type are counted once per
  // panel by the builder's sum — a documented, bounded residual (the alternative
  // is the sample-level join that costs 13s). It is the ONLY slack allowed here.
  const slackRow = await chQuery<{ n: string }>(
    "SELECT countIf(panels > 1) AS n FROM (\n" +
    "  SELECT sample_unique_id, uniqExact(gene_panel_id) AS panels\n" +
    "  FROM " + DB + ".sample_to_gene_panel_derived\n" +
    "  WHERE cancer_study_identifier IN " + inList + " AND alteration_type = '" + ALT[which] + "'\n" +
    "  GROUP BY sample_unique_id HAVING count() > 1)", PRIMARY);
  const slack = Number(slackRow.data[0].n);

  const sample = together[which].slice(0, 8);
  const bad: string[] = [];
  for (const r of sample) {
    const truth = Number((await chQuery<{ n: string }>(
      "SELECT uniqExact(sample_unique_id) AS n FROM " + DB + ".sample_to_gene_panel_derived\n" +
      "WHERE cancer_study_identifier IN " + inList + " AND alteration_type = '" + ALT[which] + "'\n" +
      "  AND (gene_panel_id = 'WES' OR gene_panel_id IN (\n" +
      "    SELECT gene_panel_id FROM " + DB + ".gene_panel_to_gene_derived WHERE gene = '" +
      r.gene.replace(/'/g, "''") + "'))", PRIMARY)).data[0].n);
    if (r.profiled < truth || r.profiled > truth + slack)
      bad.push(`${key(r)}: builder ${r.profiled}, independent count ${truth} (+${slack} multi-panel allowed)`);
  }
  ok(`${which}: denominator matches an independently shaped count`, bad.length === 0 && sample.length > 0,
    bad.length ? bad.slice(0, 3).join("; ") : `${sample.length} genes within [truth, truth+${slack}]`);
}

// 2. pinned absolute values — catches compensating errors
const pins: Record<string, Record<string, string>> = existsSync(FIXTURE) && !UPDATE
  ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};
const fresh: Record<string, Record<string, string>> = {};
for (const s of STUDIES) {
  fresh[s] = {};
  for (const r of perStudy[s].mut.slice(0, 6)) fresh[s]["mut:" + key(r)] = `${r.altered}/${r.profiled}`;
  for (const r of perStudy[s].cna.slice(0, 4)) fresh[s]["cna:" + key(r)] = `${r.altered}/${r.profiled}`;
}
if (UPDATE || !existsSync(FIXTURE)) {
  writeFileSync(FIXTURE, JSON.stringify(fresh, null, 2) + "\n");
  console.log("PINNED denominators written to test/fixtures/denominators.json");
} else {
  for (const s of STUDIES) {
    // Count what was actually COMPARED, not what was produced: a study missing
    // from the fixture would otherwise report "10 pins hold" having checked none.
    const compared = Object.entries(fresh[s] || {}).filter(([k]) => pins[s]?.[k]);
    const drift = compared.filter(([k, v]) => pins[s][k] !== v).map(([k, v]) => `${k}: ${pins[s][k]} -> ${v}`);
    ok(`${s}: pinned altered/profiled unchanged`, drift.length === 0 && compared.length > 0,
      drift.length ? drift.slice(0, 2).join("; ")
        : compared.length ? `${compared.length} pins hold`
        : "NO PINS for this study — run npm run denominators:pin");
  }
}

console.log(failures ? `\n${failures} denominator check(s) FAILED` : "\nall denominator checks passed");
process.exit(failures ? 1 : 0);
