/**
 * Live check: a clinical violin table (STS-VI-1) counts the samples its rows say, from the values
 * the samples hold, over the cohort the portal draws it from.
 *
 * The table's counts come from one query (lib/explore.ts buildViolinFacets) and a row's click from
 * a categorical clause (lib/explore-selection.ts toggleValue) compiled by lib/cohort2.ts; nothing
 * but this forces them to agree. For each case, undrafted and under drafts, it checks that:
 *   - each row's # is exactly what its click selects among samples with a numeric value, the draft kept;
 *   - each row's values are the samples' own, a patient's value standing for each of its samples
 *     (read here by a separate join of the clinical rows), so the box and curve are drawn from them;
 *   - a filter on the numeric attribute narrows # but not the values drawn, as the portal's
 *     (StudyViewController.fetchClinicalDataViolinPlots removes it for the curve and box);
 *   - a filter on another attribute narrows both.
 *
 * Connection b's cases are the committed fixture study (test/fixtures/peer-study, served by
 * scripts/peer-db.ts): SEX is patient-level and FRACTION_GENOME_ALTERED sample-level,
 * PARSE_PROBE holds a value that is not a number ("12abc", not counted). Connection a's coadread
 * case is portal-checked: its rows and quartiles equal cbioportal.org's
 * /api/clinical-data-violin-plots/fetch (Colon Adenocarcinoma 376: 58.25 / 69 / 77).
 *
 * Run: node --env-file=.env.local scripts/check-violin.ts
 */
import { compileCohortDef } from "../lib/cohort2.ts";
import { buildViolinFacets } from "../lib/explore.ts";
import { chQuery, connById, type ChConn } from "../lib/ch.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { toggleValue } from "../lib/explore-selection.ts";
import { violinTable } from "../lib/study-view-violin.ts";
import { sq } from "../lib/compiler.ts";
import type { CohortDef } from "../lib/types.ts";

type Case = { conn: string; study: string; categorical: string; numeric: string; numericFilter: unknown; otherFilter: unknown;
  portal?: Record<string, [number, number, number, number]> };
const CASES: Case[] = [
  { conn: "b", study: "cbiolab_peer_fixture", categorical: "SEX", numeric: "FRACTION_GENOME_ALTERED",
    numericFilter: { kind: "clinical", attribute: "FRACTION_GENOME_ALTERED", range: { gt: 0.2 } },
    otherFilter: { kind: "clinical", attribute: "SMOKING_HISTORY", op: "=", value: "Former" } },
  { conn: "b", study: "cbiolab_peer_fixture", categorical: "CANCER_TYPE_DETAILED", numeric: "PARSE_PROBE",
    numericFilter: { kind: "clinical", attribute: "PARSE_PROBE", range: { lte: 20 } },
    otherFilter: { kind: "clinical", attribute: "SEX", op: "=", value: "Female" } },
  { conn: "a", study: "coadread_tcga_pan_can_atlas_2018", categorical: "CANCER_TYPE_DETAILED", numeric: "AGE",
    numericFilter: { kind: "clinical", attribute: "AGE", range: { gt: 50, lte: 60 } },
    otherFilter: { kind: "clinical", attribute: "SEX", op: "=", value: "Female" },
    // # / Q1 / median / Q3, as cbioportal.org answers
    portal: { "Colon Adenocarcinoma": [376, 58.25, 69, 77], "Rectal Adenocarcinoma": [155, 57, 65, 72],
      "Mucinous Adenocarcinoma of the Colon and Rectum": [61, 52.5, 67, 79.5] } },
];

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

/**
 * Each category's numeric values over a cohort, read here apart from the builder: every sample's own
 * row of each attribute, or its patient's, joined by hand; values that are not numbers left out.
 */
async function oracle(c: Case, conn: ChConn, def: unknown): Promise<Map<string, number[]>> {
  const ids = compileCohortDef((def || { all: [] }) as never, { study: c.study, db: conn.db });
  const valueOf = (attr: string) =>
    `(SELECT s.sample_unique_id AS su, any(cd.attribute_value) AS v FROM ${conn.db}.sample_derived s\n` +
    ` JOIN ${conn.db}.clinical_data_derived cd ON cd.cancer_study_identifier = s.cancer_study_identifier\n` +
    `   AND ((cd.type = 'sample' AND cd.sample_unique_id = s.sample_unique_id) OR (cd.type = 'patient' AND cd.patient_unique_id = s.patient_unique_id))\n` +
    ` WHERE s.cancer_study_identifier = ${sq(c.study)} AND cd.attribute_name = ${sq(attr)} AND cd.attribute_value NOT IN ('', 'NA', 'N/A', 'na', 'n/a', '[Not Available]')\n` +
    ` GROUP BY su)`;
  const r = await chQuery<{ c: string; v: number }>(
    `SELECT lower(trim(a.v)) AS c, toFloat64OrNull(b.v) AS v FROM ${valueOf(c.categorical)} a JOIN ${valueOf(c.numeric)} b ON a.su = b.su\n` +
    `WHERE v IS NOT NULL AND a.su IN (SELECT concat(${sq(c.study + "_")}, sid) FROM (${ids}))`, conn);
  const out = new Map<string, number[]>();
  for (const x of r.data) { const l = out.get(x.c) || []; l.push(Number(x.v)); out.set(x.c, l); }
  return out;
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b).join(",");

for (const c of CASES) {
  const conn = connById(c.conn);
  if (!conn) { ok(`${c.study}: connection ${c.conn}`, false, "no such connection"); continue; }
  const profiles = await studyProfiles(c.study);
  const facetOf = async (draft: unknown) => (await buildViolinFacets({
    studies: [c.study], connByStudy: new Map([[c.study, conn]]), profilesByStudy: new Map([[c.study, profiles]]),
    draft: draft as never, charts: [{ categorical: c.categorical, numeric: c.numeric }],
  }))[0];
  const drafts: [string, CohortDef | null, unknown][] = [
    ["", null, null],
    [" (another filter)", { all: [c.otherFilter] } as CohortDef, { all: [c.otherFilter] }],
    // drawn without the numeric attribute's own filter, counted with it
    [" (its numeric filter)", { all: [c.numericFilter] } as CohortDef, null],
  ];
  for (const [label, draft, drawnFrom] of drafts) {
    const tag = c.study + " " + c.categorical + " × " + c.numeric + label;
    const f = await facetOf(draft);
    ok(`${tag}: a row per category`, !f.error && f.categories.length > 0, f.error || f.categories.length + " categories");
    const want = await oracle(c, conn, drawnFrom);
    const bad: string[] = [];
    for (const cat of f.categories) {
      const got = cat.values.flatMap((x) => Array.from({ length: x.n }, () => x.v));
      const exp = want.get(cat.category.trim().toLowerCase()) || [];
      if (sorted(got) !== sorted(exp)) bad.push(`${cat.category}: draws ${got.length} values, the samples hold ${exp.length}`);
      // the click: the category, among samples with a numeric value, the draft kept
      const click = toggleValue(null, c.categorical, cat.category);
      if (!("draft" in click)) { bad.push(`${cat.category}: ${click.why}`); continue; }
      const has = { kind: "clinical", attribute: c.numeric, op: "!=", value: "" };
      const selected = await selects({ all: [...(draft?.all || []), ...click.draft.all!, has] }, c.study, conn);
      const shown = cat.values.reduce((n, x) => n + x.sel, 0);
      // a value that is not a number has a row but no place on the axis: the click may select more
      if (c.numeric === "PARSE_PROBE" ? shown > selected : shown !== selected) bad.push(`${cat.category}: # ${shown}, its click selects ${selected}`);
    }
    if (want.size !== f.categories.length) bad.push(`${f.categories.length} categories drawn, the samples hold ${want.size}`);
    ok(`${tag}: each row's values and # are the samples'`, bad.length === 0, bad.length ? bad.slice(0, 3).join("; ") : f.categories.length + " rows agree");
  }

  // its numeric filter: fewer counted in #, every value still drawn
  {
    const plain = await facetOf(null), own = await facetOf({ all: [c.numericFilter] });
    const sum = (f: typeof plain, k: "n" | "sel") => f.categories.reduce((a, x) => a + x.values.reduce((b, v) => b + v[k], 0), 0);
    ok(`${c.study} ${c.numeric}: its own filter narrows # and not the values drawn`, sum(own, "sel") < sum(plain, "sel") && sum(own, "n") === sum(plain, "n"),
      `# ${sum(own, "sel")} of ${sum(plain, "sel")}, drawn ${sum(own, "n")} = ${sum(plain, "n")}`);
  }

  if (c.portal) {
    const t = violinTable((await facetOf(null)).categories, false);
    const got = Object.fromEntries(t.rows.map((r) => [r.category, [r.n, r.box.q1, r.box.median, r.box.q3]]));
    ok(`${c.study}: rows and quartiles as cbioportal.org counts them`, JSON.stringify(got, Object.keys(c.portal).sort()) === JSON.stringify(c.portal, Object.keys(c.portal).sort()), JSON.stringify(got));
  }
}

console.log(failures ? `\n${failures} violin check(s) FAILED` : "\nall violin checks passed");
process.exit(failures ? 1 : 0);
