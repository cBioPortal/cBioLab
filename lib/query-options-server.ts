// What the query page's controls offer for a set of studies (lib/query-options.ts): each study's
// profiles, as its catalog describes them, and its sample lists with their sizes. Vocabulary and
// counts only; it names no patient or sample. A study a federation peer holds has profiles (the
// peer's description) but no sample lists here, and is named as such.
import { chQuery, type ChConn, PRIMARY } from "./ch.ts";
import { sq } from "./compiler.ts";
import { studyRouting } from "./federation.ts";
import { studyProfilesMany } from "./analysis.ts";
import type { CaseSetInfo, QueryOptionsData } from "./query-options.ts";

/** the most studies one request describes: the Results page's own limit is lower */
export const QUERY_OPTIONS_MAX_STUDIES = 600;

/** every sample list of the studies, with the samples each holds (counted, not listed) */
export function caseSetsSql(db: string, studies: string[]): string {
  return "SELECT cs.cancer_study_identifier AS study, sl.stable_id AS id, any(sl.name) AS name, any(ifNull(toString(sl.description), '')) AS description,\n" +
    "       any(ifNull(toString(sl.category), '')) AS category, uniqExact(sll.sample_id) AS samples\n" +
    "FROM " + db + ".sample_list sl\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = sl.cancer_study_id\n" +
    "LEFT JOIN " + db + ".sample_list_list sll ON sll.list_id = sl.list_id\n" +
    "WHERE cs.cancer_study_identifier IN (" + studies.map(sq).join(", ") + ")\n" +
    "GROUP BY study, id ORDER BY study, id";
}

/** each profile's description and whether the study offers it on the query page (show_profile_in_analysis_tab), keyed "study|profile" */
export function profileNotesSql(db: string, studies: string[]): string {
  return "SELECT cs.cancer_study_identifier AS study, replaceOne(gp.stable_id, concat(cs.cancer_study_identifier, '_'), '') AS profile,\n" +
    "       ifNull(toString(gp.description), '') AS description, toInt32OrZero(ifNull(toString(gp.show_profile_in_analysis_tab), '')) AS shown\n" +
    "FROM " + db + ".genetic_profile gp\n" +
    "JOIN " + db + ".cancer_study cs ON cs.cancer_study_id = gp.cancer_study_id\n" +
    "WHERE cs.cancer_study_identifier IN (" + studies.map(sq).join(", ") + ")";
}

/** the query page's choices for these studies; `unavailable` names a study whose sample lists cannot be read here, and why */
export async function queryOptionsFor(studies: string[]): Promise<QueryOptionsData & { unavailable: { study: string; why: string }[] }> {
  const ids = [...new Set(studies)];
  if (!ids.length) throw new Error("name at least one study");
  if (ids.length > QUERY_OPTIONS_MAX_STUDIES) throw new Error("the query page describes at most " + QUERY_OPTIONS_MAX_STUDIES + " studies at once; " + ids.length + " were asked for");
  const bad = ids.filter((s) => !/^[A-Za-z0-9._-]{1,120}$/.test(s));
  if (bad.length) throw new Error("not a study id: " + bad.join(", "));
  const routing = await studyRouting();
  const unknown = ids.filter((s) => !routing.has(s));
  const { peerForStudy } = await import("./federation-remote.ts");
  const peers = new Set((await Promise.all(unknown.map(async (s) => ((await peerForStudy(s)) ? s : null)))).filter(Boolean) as string[]);
  const missing = unknown.filter((s) => !peers.has(s));
  if (missing.length) throw new Error("no study named " + missing.join(", ") + " on this deployment");
  const byConn = new Map<string, { conn: ChConn; studies: string[] }>();
  for (const s of ids) {
    if (peers.has(s)) continue;
    const conn = routing.get(s) || PRIMARY;
    const k = conn.id + "|" + conn.db;
    if (!byConn.has(k)) byConn.set(k, { conn, studies: [] });
    byConn.get(k)!.studies.push(s);
  }
  const conns = [...byConn.values()];
  const [profiles, lists, notes] = await Promise.all([
    studyProfilesMany(ids),
    Promise.all(conns.map(({ conn, studies: ss }) => chQuery(caseSetsSql(conn.db, ss), conn))),
    Promise.all(conns.map(({ conn, studies: ss }) => chQuery(profileNotesSql(conn.db, ss), conn))),
  ]);
  const noteOf = new Map(notes.flatMap((r) => r.data.map((x) => [x.study + "|" + x.profile, { description: String(x.description), shown: Number(x.shown) === 1 }] as const)));
  const caseSets: CaseSetInfo[] = lists.flatMap((r) => r.data.map((x) => ({
    id: String(x.id), study: String(x.study), name: String(x.name), description: String(x.description), category: String(x.category), samples: Number(x.samples) })));
  return {
    // a peer's profiles carry no notes here: offered, without a description
    profiles: ids.flatMap((s) => (profiles.get(s)?.catalog || []).map((p) => {
      const n = noteOf.get(s + "|" + p.profile);
      return { ...p, study: s, ...(n?.description ? { description: n.description } : {}), ...(n && !n.shown ? { analysis: false } : {}) };
    })),
    caseSets,
    unavailable: [...peers].map((s) => ({ study: s, why: s + " is held by a federation peer, whose sample lists this deployment cannot read" })),
  };
}
