/**
 * Live check: each Explore clinical chart's `samples` — the selected samples with a value, the
 * numerator of the Add chart dialog's Freq — run against the fixture study's ClickHouse
 * (connection b, `cbiolab_peer_fixture`).
 *
 * Written from docs/legacy-spec/parity/add-chart-cases.md, row AC1: a sample attribute counts the
 * selected samples with a value; a patient attribute counts every selected sample whose patient has
 * a value. The fixture (test/fixtures/peer-study: 53 patients, 59 samples) gives FX-P01–FX-P04 two
 * samples each, a Primary and a Metastasis, and patient-level PATIENT_SCORE (FX-P01, FX-P02) and
 * PATIENT_FLAG (FX-P01): counted in patients they read 2 and 1, in samples 4 and 2.
 *
 * The expected counts come from the fixture's own files, for every attribute, with no filter and
 * filtered to the Metastasis samples.
 *
 * It also checks the gene panels' gene lists, from docs/legacy-spec/parity/gene-tables-cases.md:
 * GP7, each fixture panel's genes by Hugo symbol, A to Z, as its data_gene_panel_*.txt lists them;
 * GP9, WES lists no genes; GP10, a panel the database does not hold is refused, naming it.
 *
 * It also checks CS2 (study-cn-segments-cases.md): a study with no segments carries no seg flag.
 * It also checks GU3 (gene-tables-cases.md): a gene table is narrowed by its own checked genes.
 *
 * Run: node --env-file=.env.local scripts/check-chart-freq.ts
 * (connection b is `npm run peer-db`: export the CLICKHOUSE2_* lines it prints)
 */
import { readFileSync } from "node:fs";
import { connById } from "../lib/ch.ts";
import { buildExplore } from "../lib/explore.ts";
import { studiesFor, studyAbout } from "../lib/study-list.ts";
import { panelGenes } from "../lib/genes.ts";

const STUDY = "cbiolab_peer_fixture";

const conn = connById("b");
if (!conn) {
  console.log("FAIL connection b (CLICKHOUSE2_*) is not configured.\n" +
    "  Start the fixture database with `npm run peer-db` (or node --env-file=.env.local scripts/peer-db.ts)\n" +
    "  and export the CLICKHOUSE2_* lines it prints, then run this again.");
  process.exit(1);
}

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

/** a clinical file's header and rows */
function table(file: string): { head: string[]; rows: string[][] } {
  const lines = readFileSync(new URL("../test/fixtures/peer-study/" + file, import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"));
  return { head: lines[0].split("\t"), rows: lines.slice(1).map((l) => l.split("\t")) };
}
const samples = table("data_clinical_sample.txt"), patients = table("data_clinical_patient.txt");
/** a value the importer stores: not empty, not NA */
const has = (v: string | undefined) => v != null && v.trim() !== "" && v.trim().toUpperCase() !== "NA";

/** what each attribute's `samples` should read over the selected samples `sel` (sample ids) */
function expected(sel: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  const sid = samples.head.indexOf("SAMPLE_ID"), spid = samples.head.indexOf("PATIENT_ID");
  samples.head.forEach((a, i) => {
    if (i === sid || i === spid) return;
    out.set("sample|" + a, samples.rows.filter((r) => sel.has(r[sid]) && has(r[i])).length);
  });
  const pid = patients.head.indexOf("PATIENT_ID");
  patients.head.forEach((a, i) => {
    if (i === pid) return;
    const withValue = new Set(patients.rows.filter((r) => has(r[i])).map((r) => r[pid]));
    out.set("patient|" + a, samples.rows.filter((r) => sel.has(r[sid]) && withValue.has(r[spid])).length);
  });
  return out;
}

const sid = samples.head.indexOf("SAMPLE_ID"), stype = samples.head.indexOf("SAMPLE_TYPE");
const all = new Set(samples.rows.map((r) => r[sid]));
const metastasis = new Set(samples.rows.filter((r) => r[stype] === "Metastasis").map((r) => r[sid]));
ok("fixture files read", all.size === 59 && metastasis.size === 6, `${all.size} samples, ${metastasis.size} Metastasis`);

for (const [label, sel, draft] of [
  ["undrafted", all, undefined],
  ["SAMPLE_TYPE = Metastasis", metastasis, { all: [{ kind: "clinical", attribute: "SAMPLE_TYPE", values: ["Metastasis"] }] }],
] as const) {
  try {
    const r = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true, ...(draft ? { draft: draft as never } : {}) });
    const want = expected(sel);
    const got = new Map(r.clinical.map((c) => [c.per + "|" + c.attribute, c.samples]));
    const wrong = [...want].filter(([k, n]) => got.has(k) && got.get(k) !== n && !(k === "sample|SAMPLE_TYPE" && draft))
      .map(([k, n]) => `${k}: ${got.get(k)} (want ${n})`);
    const checked = [...want.keys()].filter((k) => got.has(k)).length;
    ok(`AC1 ${label}: every chart's samples with data match the files`, wrong.length === 0 && checked >= 15,
      wrong.length ? wrong.slice(0, 6).join("; ") : `${checked} attributes`);
    ok(`AC1 ${label}: PATIENT_SCORE counts its patients' selected samples`, got.get("patient|PATIENT_SCORE") === want.get("patient|PATIENT_SCORE"),
      `samples=${got.get("patient|PATIENT_SCORE")} want ${want.get("patient|PATIENT_SCORE")}, patients=${r.clinical.find((c) => c.attribute === "PATIENT_SCORE")?.patients}`);
    ok(`AC1 ${label}: the selection's samples`, r.totals?.samples === sel.size, `${r.totals?.samples} of ${sel.size}`);
  } catch (e) { ok(label, false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
}

// AC9: only an attribute the clinical query counted can read as "no data"
try {
  const r = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true, attributes: ["SEX"] });
  const d = new Map((r.declaredAttributes || []).map((x) => [x.attribute, x.counted]));
  ok("AC9 asked for SEX alone: SEX is counted, AGE (not asked for) is not", d.get("SEX") === true && d.get("AGE") === false,
    `SEX ${d.get("SEX")}, AGE ${d.get("AGE")}`);
  const all = await buildExplore({ study: STUDY, conn, skipGenes: true, skipBins: true });
  ok("AC9 asked for every attribute: every declared attribute is counted", (all.declaredAttributes || []).length > 0 && (all.declaredAttributes || []).every((x) => x.counted === true),
    (all.declaredAttributes || []).filter((x) => x.counted !== true).map((x) => x.attribute).join(", ") || "all counted");
} catch (e) { ok("AC9", false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }

/** a gene panel file's id and genes, as its `gene_list:` line lists them */
function panelFile(file: string): { id: string; genes: string[] } {
  const lines = readFileSync(new URL("../test/fixtures/peer-study/" + file, import.meta.url), "utf8").split("\n");
  const field = (k: string) => (lines.find((l) => l.startsWith(k + ":")) ?? "").slice(k.length + 1).trim();
  return { id: field("stable_id"), genes: field("gene_list").split("\t").map((g) => g.trim()).filter(Boolean) };
}

for (const file of ["data_gene_panel_PEERFIX_FULL.txt", "data_gene_panel_PEERFIX_NO_EGFR.txt"]) {
  const { id, genes } = panelFile(file);
  const want = [...genes].sort();
  try {
    const got = await panelGenes(id, conn);
    ok(`GP7 ${id}: the panel's genes A to Z`, want.length > 0 && JSON.stringify(got) === JSON.stringify(want),
      `${got.length} genes: ${got.join(",")}; want ${want.join(",")}`);
  } catch (e) { ok(`GP7 ${id}`, false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
}
try {
  const got = await panelGenes("WES", conn);
  ok("GP9 WES lists no genes", Array.isArray(got) && got.length === 0, `${got.length} genes`);
} catch (e) { ok("GP9 WES", false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }
try {
  const got = await panelGenes("NO_SUCH_PANEL", conn);
  ok("GP10 an unknown panel is refused", false, `answered ${got.length} genes`);
} catch (e) {
  const m = String((e as Error).message ?? e);
  ok("GP10 an unknown panel is refused, naming it", m.includes("NO_SUCH_PANEL"), m.split("\n")[0].slice(0, 300));
}

// GU3: a gene table is narrowed by its own checked genes (the portal sends its whole filter, the
// table's own gene filter included, to fetchMutatedGenes)
try {
  const muts = readFileSync(new URL("../test/fixtures/peer-study/data_mutations.txt", import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"));
  const mh = muts[0].split("\t"), gi = mh.indexOf("Hugo_Symbol"), si = mh.indexOf("Tumor_Sample_Barcode");
  const mutated = (gene: string) => new Set(muts.slice(1).map((l) => l.split("\t")).filter((r) => r[gi] === gene).map((r) => r[si]));
  const kras = mutated("KRAS"), tp53 = mutated("TP53");
  const both = [...tp53].filter((x) => kras.has(x)).length;
  const row = (r: Awaited<ReturnType<typeof buildExplore>>, g: string) => r.mutatedGenes?.find((x) => x.gene === g);
  const plain = await buildExplore({ study: STUDY, conn, skipBins: true });
  const own = await buildExplore({ study: STUDY, conn, skipBins: true, draft: { all: [{ kind: "oql", q: "KRAS" }] } as never });
  ok("GU3 unfiltered: KRAS and TP53 count their mutated samples", row(plain, "KRAS")?.altered === kras.size && row(plain, "TP53")?.altered === tp53.size,
    `KRAS ${row(plain, "KRAS")?.altered} want ${kras.size}, TP53 ${row(plain, "TP53")?.altered} want ${tp53.size}`);
  ok("GU3 under KRAS: the table is narrowed by its own gene — KRAS reads every selected sample", row(own, "KRAS")?.altered === kras.size && row(own, "KRAS")?.profiled === kras.size,
    `KRAS ${row(own, "KRAS")?.altered} of ${row(own, "KRAS")?.profiled}, want ${kras.size} of ${kras.size}`);
  ok("GU3 under KRAS: TP53 counts only the samples mutated in both", row(own, "TP53")?.altered === both && (row(own, "TP53")?.profiled ?? 0) <= kras.size,
    `TP53 ${row(own, "TP53")?.altered} of ${row(own, "TP53")?.profiled}, want ${both} of at most ${kras.size}`);
} catch (e) { ok("GU3", false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }

// SH1–SH3 (study-header-cases.md): the header's name, description and PubMed id are the study's own, as meta_study.txt gives them
try {
  const meta = Object.fromEntries(readFileSync(new URL("../test/fixtures/peer-study/meta_study.txt", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  const a = await studyAbout(STUDY, conn);
  ok("SH1-SH3 the fixture study's name, description and PubMed id, as meta_study.txt gives them",
    !!a && a.name === meta.name && a.description === meta.description && a.pmid === (meta.pmid || null),
    a ? `name ${JSON.stringify(a.name)}, pmid ${a.pmid}` : "no row");
  ok("SH1 a study this connection does not hold has none", (await studyAbout("no_such_study", conn)) === null);
} catch (e) { ok("SH1-SH3", false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }

// CS2 (study-cn-segments-cases.md): a study holding no copy-number segment offers no CN Segments tab
// (the fixture holds none, so the study list's seg flag reads false for it)
try {
  const rows = await studiesFor(conn);
  const mine = rows.find((r) => r.id === STUDY);
  ok("CS2 the fixture study, with no segments, carries no seg flag", !!mine && mine.caps.seg === false, mine ? "seg=" + mine.caps.seg : "not listed");
} catch (e) { ok("CS2", false, String((e as Error).message ?? e).split("\n")[0].slice(0, 300)); }

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
