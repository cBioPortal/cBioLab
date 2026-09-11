/**
 * Differential check on the panel-aware denominator, against the live database.
 *
 * Two things are asserted, and the second is the one that matters:
 *
 *   1. ADDITIVITY. Faceting each study alone and summing the gene tables in JS
 *      must equal faceting them together. `altered` and `profiled` are both
 *      per-sample counts, so they decompose into sums — that is precisely why
 *      mergeExplore may add them, and why pooling the query across studies is
 *      safe. If a change breaks that, these two paths stop agreeing.
 *
 *   2. PINNED VALUES. Internal consistency is not enough: two compensating
 *      errors agree with each other. So a handful of (study, gene) denominators
 *      are pinned to fixtures. Those numbers come from the panel tables, and a
 *      shortcut that used a study total instead would move them.
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
import { buildExplore, buildExploreFederated } from "../lib/explore.ts";
import { studyProfiles } from "../lib/analysis.ts";
import type { GeneTableRow } from "../lib/types.ts";

const STUDIES = ["nsclc_ctdx_msk_2022", "msk_ch_2020", "brca_msk_erbb2_2026", "histiocytosis_cobi_msk_2019"];
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

// 1. additivity
for (const which of ["mut", "cna", "sv"] as const) {
  let checked = 0, bad: string[] = [];
  for (const r of together[which]) {
    const s = summed[which].get(key(r));
    if (!s) continue;                       // gene-table LIMIT can differ; only compare what both have
    checked++;
    if (s.altered !== r.altered || s.profiled !== r.profiled)
      bad.push(`${key(r)}: together ${r.altered}/${r.profiled} vs summed ${s.altered}/${s.profiled}`);
  }
  ok(`${which}: per-study sums equal the combined facet`, bad.length === 0 && checked > 0,
    bad.length ? bad.slice(0, 3).join("; ") : `${checked} gene rows agree`);
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
    const drift = Object.entries(fresh[s] || {})
      .filter(([k, v]) => pins[s]?.[k] && pins[s][k] !== v)
      .map(([k, v]) => `${k}: ${pins[s][k]} -> ${v}`);
    ok(`${s}: pinned altered/profiled unchanged`, drift.length === 0,
      drift.length ? drift.slice(0, 2).join("; ") : `${Object.keys(fresh[s] || {}).length} pins hold`);
  }
}

console.log(failures ? `\n${failures} denominator check(s) FAILED` : "\nall denominator checks passed");
process.exit(failures ? 1 : 0);
