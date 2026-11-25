// Planted bugs: the Mutations tab's statements run at once — the default columns' facts read off the
// counts' column summaries, one database's page asked for beside its counts, the lollipop's driver
// reads bounded to its genes and study, and the page's identical requests shared. How they are
// planted and run: scripts/check-mutants.ts.
import type { GuardCommands, Mutant } from "../types.ts";

export const guards: GuardCommands = {
  // the summaries and the lollipop's driver flags, run on the fixture study's connection b
  "tab-rounds-fixture": ["node", "--test", "test/table-summaries-fixture.test.ts", "test/lollipop-drivers-fixture.test.ts"],
};

export const mutants: Mutant[] = [
  { id: "summaries-follow-query", layer: "counts", guard: "tab-rounds-fixture", file: "lib/table-query.ts",
    effect: "A column's range is taken over the rows the table's search and filters keep, not every row, so a search can hide the Allele Freq (T) column.",
    find: "? \", min(\" + (col.num || col.text) + \") AS s\" + i + \"lo, max(\" + (col.num || col.text) + \") AS s\" + i + \"hi\"",
    replace: "? \", minIf(\" + (col.num || col.text) + \", \" + where + \") AS s\" + i + \"lo, maxIf(\" + (col.num || col.text) + \", \" + where + \") AS s\" + i + \"hi\"" },
  { id: "summaries-merge-drops-truncation", layer: "counts", guard: "unit", file: "lib/table-query.ts",
    effect: "A part with more than 500 distinct values merges as if it had them all, so the count of cancer types is finite where it is unknown.",
    find: "truncated: each.some((x) => !x.numeric && x.truncated) || all.size > VALUES_MAX };",
    replace: "truncated: all.size > VALUES_MAX };" },
  { id: "facts-count-blank-type", layer: "counts", guard: "unit", file: "lib/views/mutation-defaults.ts",
    effect: "A blank cancer type counts as a type, so a gene whose rows hold one type and some blanks shows Cancer Type Detailed by default.",
    find: "types.values.filter((x) => x !== \"\").length", replace: "types.values.length" },
  { id: "rows-summaries-partial", layer: "counts", guard: "unit", file: "lib/views/rows.ts",
    effect: "A count that carries no summaries (an older backend) is read as a part with no frequencies and no types, so the defaults drop Allele Freq (T) and Cancer Type Detailed instead of asking.",
    find: "for (const c of counts) { if (c.sums) sums.push(c.sums); else summarized = false; }",
    replace: "for (const c of counts) { if (c.sums) sums.push(c.sums); }" },
  { id: "early-page-past-end", layer: "counts", guard: "unit", file: "lib/views/rows.ts",
    effect: "A page asked for at or past the last row returns the rows the database sent instead of none.",
    find: "return want.offset < total ? e.ok : [];", replace: "return e.ok;" },
  { id: "lollipop-drivers-first-gene", layer: "counts", guard: "tab-rounds-fixture", file: "lib/federation.ts",
    effect: "The lollipop reads OncoKB's driver calls for its first gene only, so every other gene's OncoKB drivers are drawn as VUS.",
    find: "AND is_driver AND alteration_type = 'MUTATION' AND hugo_gene_symbol IN (\" + list + \"))\" +",
    replace: "AND is_driver AND alteration_type = 'MUTATION' AND hugo_gene_symbol IN (\" + list.split(\",\")[0] + \"))\" +" },
  { id: "shared-request-ignores-query", layer: "counts", guard: "unit", file: "app/lab/api.ts",
    effect: "Two requests for the same document under different query strings share one answer, so a page asking for SVG figures gets the spec-only answer (or the reverse).",
    find: "key = path + \"\\n\" + text;", replace: "key = path.split(\"?\")[0] + \"\\n\" + text;" },
];
