/**
 * Live check: the gene panels a Study View gene-table row lists (the Freq cell's tooltip, "Gene
 * panels: …"), run against the committed fixture study on connection b. Rows GP3 and GP4 of
 * docs/legacy-spec/parity/gene-tables-cases.md:
 *
 *   GP3  each gene panel held by a SELECTED sample for the table's alteration type that lists the
 *        gene, whole-exome (`WES`) among them — the portal's getMatchingGenePanelIds
 *        (cbioportal ClickhouseAlterationMapper.xml:127-149: gene_panel_to_gene_derived restricted
 *        to the panels in sample_to_gene_panel_derived for the alteration type under the filter;
 *        `WES` lists every gene, clickhouse.sql:104-116)
 *   GP4  in A-to-Z order
 *
 * The expected lists are derived here from the fixture's own files, never read back from the
 * database: test/fixtures/peer-study/data_gene_panel_<ID>.txt (each panel's genes),
 * data_gene_panel_matrix.txt (each sample's panel per alteration type; a value that names no panel
 * file is a sample profiled without a panel, which the derived tables record as `WES`) and
 * data_clinical_sample.txt (each sample's patient). Then:
 *
 *   - undrafted: every row of the three tables lists exactly the panels its gene is on among the
 *     study's samples; EGFR's mutated row lists only PEERFIX_FULL (PEERFIX_NO_EGFR lacks it); a
 *     gene on both panels lists both
 *   - drafted to the patients whose samples are all on PEERFIX_NO_EGFR: no row lists PEERFIX_FULL
 *     (a panel counts only when a selected sample holds it), a gene on both panels lists
 *     PEERFIX_NO_EGFR alone, and EGFR (mutated there on no covering panel) lists none
 *
 * Run: node --env-file=.env.local scripts/check-gene-panels.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildExplore } from "../lib/explore.ts";
import { connById } from "../lib/ch.ts";
import { studyProfiles } from "../lib/analysis.ts";
import type { GeneTableRow } from "../lib/types.ts";

const STUDY = "cbiolab_peer_fixture";
const FIXTURE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "test", "fixtures", "peer-study");
const WES = "WES";
const FULL = "PEERFIX_FULL", NO_EGFR = "PEERFIX_NO_EGFR";

type Kind = "mutated" | "cna" | "sv";
const TABLE: Record<Kind, "mutatedGenes" | "cnaGenes" | "svGenes"> = { mutated: "mutatedGenes", cna: "cnaGenes", sv: "svGenes" };
/** the matrix column each table's alteration type reads */
const COLUMN: Record<Kind, string> = { mutated: "mutations", cna: "cna", sv: "structural_variants" };

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};
const done = () => {
  console.log(failures ? `\n${failures} gene-panel check(s) FAILED` : "\nall gene-panel checks passed");
  process.exit(failures ? 1 : 0);
};

// ---- the fixture's files ----
const tsv = async (file: string) => (await readFile(path.join(FIXTURE, file), "utf8"))
  .split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t"));

/** panel id → its genes */
const panels = new Map<string, Set<string>>();
for (const f of (await readdir(FIXTURE)).filter((f) => /^data_gene_panel_.+\.txt$/.test(f) && f !== "data_gene_panel_matrix.txt")) {
  const text = await readFile(path.join(FIXTURE, f), "utf8");
  const id = /^stable_id:\s*(\S+)/m.exec(text)?.[1];
  const genes = /^gene_list:\s*(.*)$/m.exec(text)?.[1];
  if (id && genes) panels.set(id, new Set(genes.split("\t").map((g) => g.trim()).filter(Boolean)));
}
const [mHead, ...mRows] = await tsv("data_gene_panel_matrix.txt");
/** sample → (matrix column → panel id, `WES` when the value names no panel) */
const panelOf = new Map<string, Record<string, string>>();
for (const row of mRows) {
  const rec: Record<string, string> = {};
  mHead.forEach((col, i) => { if (i > 0) rec[col] = panels.has(row[i]) ? row[i] : WES; });
  panelOf.set(row[0], rec);
}
const [sHead, ...sRows] = await tsv("data_clinical_sample.txt");
const sIdx = sHead.indexOf("SAMPLE_ID"), pIdx = sHead.indexOf("PATIENT_ID");
const patientOf = new Map(sRows.map((r) => [r[sIdx], r[pIdx]]));

/** GP3 + GP4: the panels a row of `kind` for `gene` should list, over the selected samples */
const expected = (kind: Kind, gene: string, samples: string[]): string[] => {
  const held = new Set<string>();
  for (const s of samples) {
    const p = panelOf.get(s)?.[COLUMN[kind]];
    if (p && (p === WES || panels.get(p)?.has(gene))) held.add(p);
  }
  return [...held].sort();
};

ok("fixture: both panels and the matrix read", panels.has(FULL) && panels.has(NO_EGFR) && panelOf.size > 0,
  `${[...panels.keys()].join(", ")}; ${panelOf.size} samples in the matrix`);
const allSamples = [...panelOf.keys()];
const wesBy = Object.fromEntries(Object.values(COLUMN).map((c) => [c, allSamples.filter((s) => panelOf.get(s)![c] === WES).length]));
console.log(`INFO samples profiled without a panel (WES), by alteration type: ${Object.entries(wesBy).map(([c, n]) => c + " " + n).join(", ")}`);

/** patients whose every sample is on PEERFIX_NO_EGFR for mutations */
const noEgfrPatients = [...new Set(allSamples.map((s) => patientOf.get(s)!))].filter((p) => {
  const mine = allSamples.filter((s) => patientOf.get(s) === p);
  return mine.length > 0 && mine.every((s) => panelOf.get(s)!.mutations === NO_EGFR);
}).sort();
const noEgfrSamples = allSamples.filter((s) => noEgfrPatients.includes(patientOf.get(s)!));
const bothPanels = [...panels.get(FULL)!].filter((g) => panels.get(NO_EGFR)!.has(g));
ok("fixture: some patients are wholly on PEERFIX_NO_EGFR", noEgfrPatients.length > 0, noEgfrPatients.join(", "));

// ---- connection b ----
const conn = connById("b");
if (!conn) {
  ok("connection b", false,
    "no connection b: set CLICKHOUSE2_* to the fixture database (`PEER_DB_PORT=<port> node --env-file=.env.local scripts/peer-db.ts` prints them)");
  done();
}

const run = async (tag: string, draft?: unknown) => {
  try {
    return await buildExplore({ study: STUDY, conn: conn!, skipBins: true, ...(draft ? { draft: draft as never } : {}), ...(await studyProfiles(STUDY)) });
  } catch (e) {
    ok(`${tag}: explore builds`, false, String((e as Error).message).split("\n")[0].slice(0, 200));
    return null;
  }
};
const panelsOf = (r: GeneTableRow): string[] | undefined => (r as GeneTableRow & { panels?: string[] }).panels;
const show = (p: string[] | undefined) => (p ? "[" + p.join(", ") + "]" : "no panels field");

/** every row of every table lists what the files say (GP3) in A-to-Z order (GP4) */
const checkAllRows = (tag: string, res: Awaited<ReturnType<typeof buildExplore>>, samples: string[], mayBeEmpty: Kind[] = []) => {
  for (const kind of ["mutated", "cna", "sv"] as Kind[]) {
    const rows = res[TABLE[kind]] || [];
    if (mayBeEmpty.includes(kind) && !rows.length) { console.log(`INFO ${tag}: the ${kind} table is empty`); continue; }
    ok(`${tag}: the ${kind} table has rows`, rows.length > 0, `${rows.length} rows`);
    if (!rows.length) continue;
    const missing = rows.filter((r) => !Array.isArray(panelsOf(r)));
    ok(`${tag}: every ${kind} row carries a panels list`, missing.length === 0,
      missing.length ? `${missing.length} of ${rows.length} without, e.g. ${missing.slice(0, 3).map((r) => r.gene).join(", ")}` : `${rows.length} rows`);
    const bad = rows.filter((r) => JSON.stringify(panelsOf(r)) !== JSON.stringify(expected(kind, r.gene, samples)));
    ok(`${tag}: every ${kind} row lists the panels its gene is on among the selected samples, A to Z`, bad.length === 0,
      bad.length ? bad.slice(0, 3).map((r) => `${r.gene}${r.cna != null ? "/" + r.cna : ""}: ${show(panelsOf(r))}, expected [${expected(kind, r.gene, samples).join(", ")}]`).join("; ")
        : `${rows.length} rows agree`);
  }
};
const mutRow = (res: Awaited<ReturnType<typeof buildExplore>>, gene: string) => (res.mutatedGenes || []).find((r) => r.gene === gene);

// ---- undrafted: the whole study ----
const all = await run("whole study");
if (all) {
  ok("whole study: connection b holds the fixture (its sample count is the matrix's)", all.totals?.samples === allSamples.length,
    `${all.totals?.samples ?? "no"} samples, the matrix has ${allSamples.length}`);
  checkAllRows("whole study", all, allSamples);
  const egfr = mutRow(all, "EGFR");
  ok("whole study: EGFR's mutated row lists only the panel that holds EGFR", !!egfr &&
    JSON.stringify(panelsOf(egfr)) === JSON.stringify([FULL]), egfr ? show(panelsOf(egfr)) : "no EGFR row");
  const both = (all.mutatedGenes || []).find((r) => bothPanels.includes(r.gene));
  ok("whole study: a gene on both panels lists both", !!both &&
    JSON.stringify(panelsOf(both)) === JSON.stringify([FULL, NO_EGFR].sort()), both ? `${both.gene}: ${show(panelsOf(both))}` : "no such row");
  const sv = all.svGenes || [];
  if (wesBy.structural_variants > 0)
    ok("whole study: structural-variant rows list WES (their samples have no panel)", sv.length > 0 && sv.every((r) => panelsOf(r)?.includes(WES)),
      `${sv.filter((r) => panelsOf(r)?.includes(WES)).length} of ${sv.length} rows`);
}

// ---- drafted: only patients on PEERFIX_NO_EGFR ----
const draft = { all: [{ kind: "patientList", ids: noEgfrPatients.map((p) => STUDY + ":" + p) }] };
const tag = `drafted to ${noEgfrPatients.length} PEERFIX_NO_EGFR patients`;
const sub = await run(tag, draft);
if (sub) {
  // the fixture's structural variants are on FX-P45–FX-P53, none of these patients
  checkAllRows(tag, sub, noEgfrSamples, ["sv"]);
  const rows = [...(sub.mutatedGenes || []), ...(sub.cnaGenes || []), ...(sub.svGenes || [])];
  const leaked = rows.filter((r) => panelsOf(r)?.includes(FULL));
  ok(`${tag}: no row lists ${FULL}, which no selected sample holds`, rows.length > 0 && rows.every((r) => Array.isArray(panelsOf(r))) && leaked.length === 0,
    leaked.length ? leaked.slice(0, 3).map((r) => `${r.gene}: ${show(panelsOf(r))}`).join("; ") : `${rows.length} rows`);
  const both = (sub.mutatedGenes || []).find((r) => bothPanels.includes(r.gene));
  ok(`${tag}: a gene on both panels lists ${NO_EGFR} alone`, !!both &&
    JSON.stringify(panelsOf(both)) === JSON.stringify([NO_EGFR]), both ? `${both.gene}: ${show(panelsOf(both))}` : "no such row");
  const egfr = mutRow(sub, "EGFR");
  ok(`${tag}: EGFR, mutated on no panel covering it, lists no panel`, !!egfr &&
    JSON.stringify(panelsOf(egfr)) === "[]", egfr ? show(panelsOf(egfr)) : "no EGFR row");
}

done();
