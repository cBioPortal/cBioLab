// The cooccurrence view's runner (lib/views/cooccurrence/run.ts), driven with hand-made participants:
// each pair's tendency at a log₂ odds ratio of exactly 0 and −∞, and the results text with several
// studies, which reports the Mantel–Haenszel log₂ odds ratio the figure draws.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCooccurrence } from "../lib/views/cooccurrence/run.ts";
import { cooccurrenceKind } from "../lib/views/cooccurrence/kind.ts";
import type { ViewRun, EvaluatedCohort } from "../lib/views/run.ts";
import type { ViewResult, ViewParticipation } from "../lib/types.ts";
import type { PairCounts } from "../lib/federation.ts";
import { PRIMARY } from "../lib/ch.ts";
import { fmtNum } from "../lib/chart/format.ts";

type Cells = [both: number, onlyA: number, onlyB: number, neither: number];

function ctx(perStudy: Record<string, Cells>): ViewRun {
  const studies = Object.keys(perStudy);
  const cohort: EvaluatedCohort = {
    studies, count: 0, samples: 0, text: "",
    perStudy: Object.fromEntries(studies.map((st) => [st, { sql: "SELECT 1", count: 10, samples: 12, mode: "patient-level" }])),
  } as never;
  const site = (st: string) => ({
    instance: { id: "local", mode: "patient-level", label: "local", conn: PRIMARY },
    pairCounts: async (): Promise<PairCounts[]> => {
      const [both, onlyA, onlyB, neither] = perStudy[st];
      return [{ a: "TP53", b: "KRAS", both, onlyA, onlyB, neither } as PairCounts];
    },
  });
  return {
    doc: { study: studies[0], cohorts: { C: { study: studies[0] } }, views: [] } as never,
    cohorts: { C: cohort }, resolvers: Object.fromEntries(studies.map((st) => [st, site(st)])) as never, vNames: ["C"], vStudies: studies,
    participationFor: (s: string[], requiresPatientLevel: boolean): ViewParticipation =>
      ({ studies: s.map((study) => ({ study, mode: "patient-level" as const, instance: "local" })), requiresPatientLevel, aggregateOnly: [] }),
    pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  };
}
const run = async (perStudy: Record<string, Cells>) =>
  await runCooccurrence({ kind: "cooccurrence", genes: ["TP53", "KRAS"] } as never, ctx(perStudy)) as ViewResult;
const pair = (r: ViewResult) => (r as unknown as { pairs: { tendency: string | null; oddsRatioMH?: number; log2Odds: number | null }[] }).pairs[0];
const text = (r: ViewResult) => {
  const out: string[] = [];
  cooccurrenceKind.text!(r as never, { out, pFmt: (p: number) => p.toFixed(3), caveatOf: () => "", noteOf: () => "" } as never);
  return out.join("\n");
};

describe("cooccurrence: tendency (MEX: log₂ OR > 0 co-occurrence, ≤ 0 mutual exclusivity)", () => {
  test("a log₂ odds ratio of exactly 0 is mutual exclusivity, as the portal labels it", async () => {
    const p = pair(await run({ s1: [5, 5, 5, 5] }));
    assert.equal(p.log2Odds, 0);
    assert.equal(p.tendency, "mutual exclusivity");
  });
  test("a Mantel–Haenszel odds ratio of 0 across studies (log₂ −∞) is mutual exclusivity", async () => {
    const down = pair(await run({ s1: [0, 4, 3, 5], s2: [0, 3, 2, 6] }));
    assert.equal(down.oddsRatioMH, 0);
    assert.equal(down.tendency, "mutual exclusivity");
  });
  test("several studies: the text reports the Mantel–Haenszel log₂ OR, the pooled one beside it, and samples", async () => {
    const r = await run({ s1: [8, 2, 2, 8], s2: [1, 9, 9, 1] });
    const t = text(r);
    const mh = Math.log2(pair(r).oddsRatioMH!);
    assert.ok(t.includes("MH log2OR=" + fmtNum(mh) + " (pooled " + fmtNum(pair(r).log2Odds!) + ")"), t);
    assert.match(t, /among samples profiled for BOTH genes/);
    assert.match((r as unknown as { note: string }).note, /Denominators are the samples profiled/);
  });
});
